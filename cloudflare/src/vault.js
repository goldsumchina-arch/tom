// ============================================================
// 私密空间（Vault，tom 专属）· Cloudflare 版
//
// 接口（与前端 index.html 对应）：
//   POST   /api/vault/unlock          PIN 解锁 → 签发有时效 token
//   GET    /api/vault/files           文件列表（扁平相对路径，前端渲染文件夹树）
//   POST   /api/vault/upload          上传（FormData: file + path 保留文件夹结构）
//   GET    /api/vault/download?n=     下载（?n=完整相对名，?vt=token）
//   GET    /api/vault/preview?n=      预览（同上）
//   DELETE /api/vault/delete/<name>   删除单条（兼容旧路径式）
//   POST   /api/vault/delete          批量删除 {names:[...]}（文件夹由前端展开成文件列表）
//
// 存储：
//   文件内容 → R2（key = vault/<ts>_<rand>_<相对路径>）
//   展示名/大小/时间 → D1 表 vault_files（name 含文件夹路径，如 docs/合同/a.docx）
//   token → D1 表 vault_tokens；防爆破状态 → D1 表 vault_sec
//   旧版平铺文件（vault/<ts>_文件名）首次列表时自动迁入清单（去掉时间戳前缀）
//
// 安全：
//   仅 tom 可解锁；PIN 错 5 次锁 60 秒；token 30 分钟过期；
//   路径段过滤 .. 与首尾斜杠，杜绝穿越；下载/预览支持 ?vt=（浏览器直链带不了自定义头）
// ============================================================

const VAULT_PREFIX = "vault/";
const VAULT_OWNER = "tom";
const VAULT_TTL_MS = 30 * 60 * 1000;
const VAULT_TTL_SEC = 30 * 60;
const VAULT_TOKEN_BYTES = 24;
const VAULT_MAX_FAIL = 5;
const VAULT_LOCK_SECONDS = 60;

const VAULT_BLOCKED_EXT = [
  ".exe", ".bat", ".cmd", ".com", ".scr", ".msi",
  ".sh", ".js", ".vbs", ".ps1", ".jar", ".dll",
];

// 扩展名 → MIME（服务端兜底）：手机文件选择器上传的 File.type 常为空，
// 若按上传时的 contentType 存（octet-stream），PDF/图片/文档预览全部失效，
// 因此下载/预览时按扩展名强制给出正确类型
const MIME_MAP = {
  ".pdf": "application/pdf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".csv": "text/csv", ".json": "application/json",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4": "video/mp4", ".mp3": "audio/mpeg",
  ".zip": "application/zip", ".rar": "application/vnd.rar",
};

function mimeOf(name, fallback) {
  const m = MIME_MAP[extOf(name)];
  return m || fallback || "application/octet-stream";
}

const CREATE_TOKENS_SQL = `
CREATE TABLE IF NOT EXISTS vault_tokens (
  token TEXT PRIMARY KEY,
  expires_at INTEGER
)`;

const CREATE_SEC_SQL = `
CREATE TABLE IF NOT EXISTS vault_sec (
  key TEXT PRIMARY KEY,
  value TEXT
)`;

const CREATE_FILES_SQL = `
CREATE TABLE IF NOT EXISTS vault_files (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  uploaded_at TEXT DEFAULT ''
)`;

let _tablesReady = false;
async function ensureTables(env) {
  if (_tablesReady) return;
  for (const sql of [CREATE_TOKENS_SQL, CREATE_SEC_SQL, CREATE_FILES_SQL]) {
    try {
      await env.DB.prepare(sql).run();
    } catch (e) { /* 并发建表冲突忽略 */ }
  }
  _tablesReady = true;
}

/** 展示名唯一化：重名自动加 (n)（百度网盘同款行为） */
async function uniqueName(env, name) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let cand = name;
  for (let i = 1; i <= 99; i++) {
    const hit = await env.DB.prepare(
      "SELECT key FROM vault_files WHERE name=?"
    ).bind(cand).first();
    if (!hit) return cand;
    cand = stem + " (" + i + ")" + ext;
  }
  return stem + " (" + Date.now() + ")" + ext;
}

/** 清洗相对路径：逐段过滤，拒绝 .. 与空段 */
function sanitizeRelPath(p) {
  const segs = String(p || "").split(/[\\/]+/);
  const out = [];
  for (const s of segs) {
    const seg = s.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").trim();
    if (!seg || seg === "." || seg === "..") continue;
    out.push(seg.slice(0, 120));
  }
  return out.slice(0, 12).join("/");
}

function safeName(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function extOf(name) {
  const i = String(name || "").lastIndexOf(".");
  return i < 0 ? "" : String(name).slice(i).toLowerCase();
}

function randHex(n) {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += b.toString(16).padStart(2, "0");
  return s;
}

export async function authOk(request, env, url) {
  let tok = request.headers.get("X-Vault-Token") || "";
  if (!tok) tok = url.searchParams.get("vt") || "";
  tok = String(tok).trim();
  if (!tok) return false;
  try {
    const row = await env.DB.prepare(
      "SELECT expires_at FROM vault_tokens WHERE token=?"
    ).bind(tok).first();
    if (!row) return false;
    const exp = parseInt(row.expires_at, 10) || 0;
    if (Date.now() > exp) {
      await env.DB.prepare("DELETE FROM vault_tokens WHERE token=?")
        .bind(tok).run();
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

async function getLock(env) {
  const rows = await env.DB.prepare(
    "SELECT key, value FROM vault_sec WHERE key IN ('fail_count','lock_until')"
  ).all();
  const map = {};
  for (const r of rows.results || []) map[r.key] = parseInt(r.value, 10) || 0;
  const lockUntil = map.lock_until || 0;
  if (lockUntil > Date.now()) {
    return { locked: true, remain: Math.ceil((lockUntil - Date.now()) / 1000), failCount: map.fail_count || 0 };
  }
  return { locked: false, remain: 0, failCount: map.fail_count || 0 };
}

async function setSec(env, key, value) {
  await env.DB.prepare(
    "INSERT INTO vault_sec (key, value) VALUES (?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).bind(key, String(value)).run();
}

/** R2 uploaded 时间 → UTC+7 展示格式 */
function fmtMtime(date) {
  const d = new Date((date ? date.getTime() : Date.now()) + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

/** 旧版平铺文件自动迁入清单（只跑一次的幂等操作） */
let _migrated = false;
async function migrateLegacy(env) {
  if (_migrated) return;
  _migrated = true;
  try {
    const list = await env.FILES.list({ prefix: VAULT_PREFIX });
    for (const o of list.objects || []) {
      const key = o.key;
      const hit = await env.DB.prepare(
        "SELECT key FROM vault_files WHERE key=?"
      ).bind(key).first();
      if (hit) continue;
      const disp = key.slice(VAULT_PREFIX.length).replace(/^\d+_(?!$)/, "");
      const clean = sanitizeRelPath(disp);
      if (!clean) continue;
      await env.DB.prepare(
        "INSERT INTO vault_files (key, name, size, uploaded_at) VALUES (?,?,?,?) " +
        "ON CONFLICT(key) DO NOTHING"
      ).bind(key, clean, o.size || 0, fmtMtime(o.uploaded)).run();
    }
  } catch (e) { /* 迁移失败不阻塞列表 */ }
}

function errj(msg, status) {
  return { __err: msg, __status: status };
}

export async function handleVault(request, env, url, pathname) {
  if (!pathname.startsWith("/api/vault/")) return null;
  await ensureTables(env);

  // ---------- POST /api/vault/unlock ----------
  if (pathname === "/api/vault/unlock" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch (e) { body = {}; }
    const username = String(body.username || "").trim();
    const pin = String(body.pin || "").trim();

    const lock = await getLock(env);
    if (lock.locked) {
      return { body: { ok: false, error: "尝试过多，请 " + lock.remain + " 秒后再试", lock: lock.remain }, status: 429 };
    }
    if (username.toLowerCase() !== VAULT_OWNER) {
      return { body: { ok: false, error: "无权限访问该空间" }, status: 403 };
    }
    const vaultPin = String(env.VAULT_PIN || "1116");
    if (pin !== vaultPin) {
      const failCount = lock.failCount + 1;
      if (failCount >= VAULT_MAX_FAIL) {
        await setSec(env, "lock_until", Date.now() + VAULT_LOCK_SECONDS * 1000);
        await setSec(env, "fail_count", 0);
        return { body: { ok: false, error: "错误次数过多，已锁定 " + VAULT_LOCK_SECONDS + " 秒", lock: VAULT_LOCK_SECONDS }, status: 429 };
      }
      await setSec(env, "fail_count", failCount);
      return { body: { ok: false, error: "密码错误", fail: failCount }, status: 401 };
    }

    await setSec(env, "fail_count", 0);
    const tok = randHex(VAULT_TOKEN_BYTES);
    await env.DB.prepare(
      "INSERT INTO vault_tokens (token, expires_at) VALUES (?, ?)"
    ).bind(tok, Date.now() + VAULT_TTL_MS).run();
    try {
      await env.DB.prepare("DELETE FROM vault_tokens WHERE expires_at < ?")
        .bind(Date.now()).run();
    } catch (e) { /* 清理失败不影响 */ }
    return { body: { ok: true, token: tok, ttl: VAULT_TTL_SEC }, status: 200 };
  }

  // ---------- 以下接口全部要求 vault token ----------

  // GET /api/vault/files
  if (pathname === "/api/vault/files" && request.method === "GET") {
    if (!(await authOk(request, env, url))) {
      return { body: { ok: false, error: "invalid token" }, status: 401 };
    }
    await migrateLegacy(env);
    const rows = await env.DB.prepare(
      "SELECT name, size, uploaded_at FROM vault_files ORDER BY name"
    ).all();
    const files = (rows.results || []).map((r) => ({
      name: r.name,
      size: r.size || 0,
      mtime: r.uploaded_at || "",
    }));
    return { body: { ok: true, files }, status: 200 };
  }

  // POST /api/vault/upload
  if (pathname === "/api/vault/upload" && request.method === "POST") {
    if (!(await authOk(request, env, url))) {
      return { body: { ok: false, error: "invalid token" }, status: 401 };
    }
    let f = null, relPath = "";
    try {
      const form = await request.formData();
      const got = form.get("file");
      if (got && typeof got !== "string") f = got;
      const p = form.get("path");
      if (p && typeof p === "string") relPath = p;
    } catch (e) { f = null; }
    if (!f) return errj("no file", 400);

    // 相对路径优先用 path 字段；否则退化用文件名
    const display = sanitizeRelPath(relPath || f.name);
    if (!display) return errj("invalid path", 400);

    const ext = extOf(display);
    if (VAULT_BLOCKED_EXT.includes(ext)) {
      return errj("不允许上传可执行文件：" + ext, 400);
    }

    const buffer = await f.arrayBuffer();
    if (ext === ".pdf") {
      const head = new Uint8Array(buffer.slice(0, 5));
      const sig = String.fromCharCode(...head);
      if (sig !== "%PDF-") return errj("invalid pdf", 400);
    }

    const key = VAULT_PREFIX + Date.now() + "_" + randHex(4) + "_" + display;
    await env.FILES.put(key, buffer, {
      httpMetadata: { contentType: f.type || "application/octet-stream" },
    });
    const name = await uniqueName(env, display);
    await env.DB.prepare(
      "INSERT INTO vault_files (key, name, size, uploaded_at) VALUES (?,?,?,?)"
    ).bind(key, name, buffer.byteLength, fmtMtime(null)).run();
    return { body: { ok: true, name, original: f.name }, status: 200 };
  }

  // 名称解析：优先 ?n= 查询参数（完整相对路径），退化取 URL 路径捕获
  // 返回 null 表示非法
  function resolveName(captured) {
    let n = url.searchParams.get("n") || captured || "";
    try { n = decodeURIComponent(n); } catch (e) { /* 保持原样 */ }
    n = String(n).replace(/^\/+/, "");
    if (!n || /(^|\/)\.\.(\/|$)/.test(n)) return null;
    return n;
  }

  // ---------- 下载 / 预览 ----------
  const mDl = /^\/api\/vault\/(download|preview)\/(.*)$/.exec(pathname);
  if (mDl && request.method === "GET") {
    if (!(await authOk(request, env, url))) {
      return { body: { ok: false, error: "invalid token" }, status: 401 };
    }
    const name = resolveName(mDl[2]);
    if (!name) return errj("文件不存在", 404);
    const mrow = await env.DB.prepare(
      "SELECT key FROM vault_files WHERE name=?"
    ).bind(name).first();
    const key = mrow ? mrow.key : VAULT_PREFIX + name;
    const obj = await env.FILES.get(key);
    if (!obj) return errj("文件不存在", 404);

    const headers = new Headers();
    headers.set("Content-Type", mimeOf(name, obj.httpMetadata?.contentType));
    if (mDl[1] === "download") {
      const base = name.split("/").pop();
      headers.set("Content-Disposition",
        'attachment; filename="' + encodeURIComponent(base) + '"');
    } else {
      headers.set("Content-Disposition", "inline");
    }
    headers.set("Cache-Control", "private, max-age=300");
    return { __raw: new Response(obj.body, { status: 200, headers }) };
  }

  // ---------- DELETE /api/vault/delete/<name>（路径式，兼容旧调用） ----------
  const mDel = /^\/api\/vault\/delete\/(.+)$/.exec(pathname);
  if (mDel && request.method === "DELETE") {
    if (!(await authOk(request, env, url))) {
      return { body: { ok: false, error: "invalid token" }, status: 401 };
    }
    const name = resolveName(mDel[1]);
    if (!name) return errj("文件不存在", 404);
    const mrow = await env.DB.prepare(
      "SELECT key FROM vault_files WHERE name=?"
    ).bind(name).first();
    if (mrow) {
      // 必须先删 R2 再删 D1：若 R2 删除失败却把 D1 记录删掉，
      // 这个 R2 对象就再也没有引用能定位到它 → 永久变成孤儿垃圾。
      // 所以 R2 失败时保留 D1 记录并返回错误，让用户可重试（不产生孤儿）。
      try {
        await env.FILES.delete(mrow.key);
      } catch (e) {
        return errj("存储对象删除失败，请重试（文件记录已保留）", 500);
      }
      await env.DB.prepare("DELETE FROM vault_files WHERE key=?")
        .bind(mrow.key).run();
      return { body: { ok: true, deleted: name }, status: 200 };
    }
    return errj("文件不存在", 404);
  }

  // ---------- POST /api/vault/delete 批量 ----------
  if (pathname === "/api/vault/delete" && request.method === "POST") {
    if (!(await authOk(request, env, url))) {
      return { body: { ok: false, error: "invalid token" }, status: 401 };
    }
    let body = {};
    try { body = await request.json(); } catch (e) { body = {}; }
    const names = Array.isArray(body.names) ? body.names : [];
    if (!names.length) {
      return { body: { ok: false, error: "没有选择文件" }, status: 400 };
    }
    const deleted = [], missing = [], blocked = [];
    for (const raw of names) {
      let n = String(raw);
      try { n = decodeURIComponent(n); } catch (e) { /* 保持原样 */ }
      n = n.replace(/^\/+/, "");
      if (!n || /(^|\/)\.\.(\/|$)/.test(n)) { blocked.push(raw); continue; }
      const mrow = await env.DB.prepare(
        "SELECT key FROM vault_files WHERE name=?"
      ).bind(n).first();
      if (!mrow) { missing.push(n); continue; }
      try {
        await env.FILES.delete(mrow.key);
        await env.DB.prepare("DELETE FROM vault_files WHERE key=?")
          .bind(mrow.key).run();
        deleted.push(n);
      } catch (e) {
        missing.push(n);
      }
    }
    return { body: { ok: true, deleted, missing, blocked }, status: 200 };
  }

  return null;
}
