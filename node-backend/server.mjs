// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件（腾讯云入口）逻辑已锁定，未经用户明确同意禁止修改。除 CRM / LOST / WON / 个人佣金 四个模块内的“样板数据 / 演示数据”（清理演示数据用，仅删数据、不改逻辑）外，其余业务逻辑均正确，禁止改动。
// ============================================================
// AGI-PM 腾讯云版后端入口（腾讯云轻量应用服务器 2C4G / 香港）
// - Express 托管前端静态资源（node-backend/dist）
// - 复用业务后端逻辑（./src/index.js 的 fetch，原 后端 代码已搬入本目录）
// - env 适配：DB→SQLite(D1兼容层)，FILES→本地磁盘(R2兼容层)，AI 留空
//   （翻译自动回退 Google / MyMemory / Libre，香港出网顺畅）
// ============================================================
import express from "express";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { webcrypto } from "node:crypto";
import Database from "better-sqlite3";

// Node 18/20 下保证 Web Crypto 全局可用（Worker 代码用 crypto.subtle / getRandomValues）
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { makeD1 } from "./d1shim.mjs";
import { makeFiles } from "./filesshim.mjs";
// 复用 ./src 的业务代码（已从 node-backend/src 搬入，单一源，不复制）
import worker from "./src/index.js";
import { authenticateRequest, getTencentUsage, getDiskUsage } from "./tencent-usage.mjs";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });

// ---- SQLite 初始化（首次运行建表；之后跳过，避免重复 CREATE）----
const DB_PATH = path.join(DATA, process.env.DB_FILE || "agi.db");
const db = new Database(DB_PATH);
const schemaPath = path.join(ROOT, "schema.sql");
if (fs.existsSync(schemaPath)) {
  const hasUsers = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    .get();
  if (!hasUsers) {
    db.exec(fs.readFileSync(schemaPath, "utf8"));
    console.log("[db] schema initialized");
  }
}

// ---- ★INST-LIB-PORT-20261125★ 独立项目资料（从 choice-lite 只读移植，不修改 choice-lite）----
const LIB_DIR = path.join(DATA, "library");
fs.mkdirSync(LIB_DIR, { recursive: true });
db.exec(`
  CREATE TABLE IF NOT EXISTS library_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER DEFAULT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    uploader TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    size INTEGER DEFAULT 0,
    is_contract INTEGER DEFAULT 0
  )
`);
try { db.exec("CREATE INDEX IF NOT EXISTS idx_library_project ON library_files(project_id)"); } catch (e) {}

// ---- 首次启动种管理员（空库时）----
// 全新部署（方案 A）库为空，必须有一个可登录的管理员，否则任何人都登不进。
// 密码用明文 66668888（与 Worker 新建用户分支一致，verifyPassword 对明文有兜底）。
// role='管理员' 使 is_admin=true，拥有用户与权限管理全部权限。
(() => {
  try {
    const cnt = db.prepare("SELECT COUNT(*) AS c FROM users").get();
    if (!cnt || cnt.c === 0) {
      db.prepare(
        "INSERT INTO users (username, password, real_name, role, position, status, " +
        "vis_can_see_me, vis_he_can_see, perms, forgot_approvers, created_at, sort_order) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
      ).run(
        "tom", "66668888", "Tom", "管理员", "管理者", "active",
        "[]", "[]", "{}", '["tom"]',
        new Date().toISOString().slice(0, 19).replace("T", " "), 0
      );
      db.prepare("INSERT OR IGNORE INTO managers (username) VALUES (?)").run("tom");
      console.log("[seed] 已创建初始管理员  tom / 密码 66668888（请登录后尽快修改）");
    }
  } catch (e) {
    console.error("[seed] 创建初始管理员失败：", e && e.message);
  }
})();

// ---- env 适配层 ----
const env = {
  DB: makeD1(db),
  FILES: makeFiles(path.join(DATA, "files")),
  KV: undefined,
  AI: undefined, // 不给 AI binding → /api/translate 自动回退 Google/MyMemory/Libre
  VAULT_PIN: process.env.VAULT_PIN || "1116",
  LOGIN_ONLY_USERS: process.env.LOGIN_ONLY_USERS || "",
  AUTO_CLEAR_ON_LOGIN: process.env.AUTO_CLEAR_ON_LOGIN || "0",
  // 故意不提供 CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_ANALYTICS_TOKEN
  // → getD1Usage 取不到数据 → quotaBlocks 永远放行（无每日读额度限制）
};

// 让清理报告的容量上限基于本机系统盘（默认 10 TB 是 对象存储 假设，自托管版用实际磁盘）
try {
  const disk = await getDiskUsage();
  if (disk && disk.total > 0) {
    env.STORAGE_CAPACITY_GB = Math.ceil(disk.total / 1e9);
    console.log(`[env] 文件存储容量上限按系统盘设为 ${env.STORAGE_CAPACITY_GB} GB`);
  }
} catch (e) {
  console.error("[env] 读取系统盘容量失败：", e && e.message);
}

const ctx = { waitUntil() {}, passThroughOnException() {} };

// ---- 读取请求原始 body（用于 JSON / multipart 上传）----
function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const app = express();
app.set("trust proxy", true);

// 同源部署版前端：由根目录前端文件构建到 node-backend/dist，CLOUD_API/CLOUD_ONLY/API_BASE 已清空，
// 所有 /api 请求走本服务器（同源），不再转发 云端。
const DIST = path.join(ROOT, "dist");
// ★NO-CACHE-HTML-20261103★ 前端 index.html 强制 no-store，避免浏览器/代理缓存旧的 HTML（曾导致用户长时间看到旧版本）。
app.use(express.static(DIST, {
  extensions: ["html"],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

// ---- ★INST-LIB-PORT-20261125★ 独立项目资料 API（逻辑对齐 choice-lite，只读移植）----
function libUser(req) {
  let u = "";
  try { u = authenticateRequest(req, db) || ""; } catch (e) {}
  return String(u || req.get("X-User-Name") || "tom").toLowerCase();
}
function libSafeName(s) {
  return String(s || "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 180) || "file";
}
function libMime(name) {
  const ext = String(path.extname(name || "").toLowerCase());
  const m = {
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword", ".zip": "application/zip"
  };
  return m[ext] || "application/octet-stream";
}
function parseMultipart(buf, boundary) {
  const out = [];
  if (!boundary) return out;
  const delim = Buffer.from("--" + boundary);
  let idx = 0;
  while ((idx = buf.indexOf(delim, idx)) !== -1) {
    let start = idx + delim.length;
    if (buf.slice(start, start + 2).toString() === "--") break;
    if (buf.slice(start, start + 2).toString() === "\r\n") start += 2;
    const he = buf.indexOf("\r\n\r\n", start);
    if (he < 0) break;
    const head = buf.slice(start, he).toString("utf8");
    const ds = he + 4;
    const nx = buf.indexOf(delim, ds);
    if (nx < 0) break;
    let de = nx;
    if (buf.slice(de - 2, de).toString() === "\r\n") de -= 2;
    const nm = /name="([^"]*)"/i.exec(head);
    const fm = /filename="([^"]*)"/i.exec(head);
    out.push({ name: nm ? nm[1] : "", filename: fm ? fm[1] : null, data: buf.slice(ds, de) });
    idx = nx;
  }
  return out;
}

app.get("/api/library/projects", (req, res) => {
  try {
    const rows = db.prepare("SELECT id, contract_no, customer FROM won_projects ORDER BY id DESC").all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});
app.get("/api/library/files", (req, res) => {
  try {
    const pid = req.query.project_id;
    const rows = (pid === undefined || pid === "" || pid === "null")
      ? db.prepare("SELECT id, project_id, filename, original_name, uploader, created_at, size, is_contract FROM library_files WHERE project_id IS NULL ORDER BY created_at DESC").all()
      : db.prepare("SELECT id, project_id, filename, original_name, uploader, created_at, size, is_contract FROM library_files WHERE project_id=? ORDER BY created_at DESC").all(Number(pid));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});
app.post("/api/library/upload", async (req, res) => {
  try {
    const buf = await rawBody(req);
    const ct = String(req.get("content-type") || "");
    const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    const boundary = bm ? String(bm[1] || bm[2] || "").trim() : "";
    const parts = parseMultipart(buf, boundary);
    const files = parts.filter((p) => p.filename);
    if (!files.length) return res.status(400).json({ error: "no file" });
    const qp = req.query.project_id;
    let pid = (qp === undefined || qp === "" || qp === "null") ? null : Number(qp);
    const paths = parts.filter((p) => p.name === "paths").map((p) => p.data.toString("utf8"));
    const user = libUser(req);
    const uploaded = [];
    files.forEach((p, i) => {
      const rel = String(paths[i] || "").replace(/\\/g, "/").trim();
      const display = rel || libSafeName(String(p.filename).replace(/\\/g, "/").split("/").pop());
      const ext = path.extname(display).toLowerCase() || ".bin";
      const fname = "lib_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10) + ext;
      fs.writeFileSync(path.join(LIB_DIR, fname), p.data);
      const info = db.prepare("INSERT INTO library_files (project_id, filename, original_name, uploader, size, is_contract) VALUES (?,?,?,?,?,0)").run(pid, fname, display, user, p.data.length);
      uploaded.push({ ok: true, id: Number(info.lastInsertRowid), filename: fname, original_name: display, size: p.data.length });
    });
    res.json({ ok: true, uploaded, count: uploaded.length });
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});
app.delete("/api/library/files/:id", (req, res) => {
  try {
    const row = db.prepare("SELECT filename FROM library_files WHERE id=?").get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "not found" });
    db.prepare("DELETE FROM library_files WHERE id=?").run(Number(req.params.id));
    if (row.filename) {
      try { const fp = path.join(LIB_DIR, row.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});
app.put("/api/library/files/:id/rename", async (req, res) => {
  try {
    const raw = await rawBody(req);
    const data = JSON.parse(raw.toString("utf8") || "{}");
    const name = String(data.original_name || "").trim();
    if (!name) return res.status(400).json({ error: "empty name" });
    const info = db.prepare("UPDATE library_files SET original_name=? WHERE id=?").run(name, Number(req.params.id));
    if (!info.changes) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});
app.get(["/api/library/files/:id/download", "/api/library/files/:id/raw", "/api/library/files/:id/preview"], (req, res) => {
  try {
    const row = db.prepare("SELECT filename, original_name FROM library_files WHERE id=?").get(Number(req.params.id));
    if (!row || !row.filename) return res.status(404).json({ error: "not found" });
    const fp = path.join(LIB_DIR, row.filename);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: "not found" });
    res.setHeader("Content-Type", libMime(row.original_name || row.filename));
    if (/\/download$/.test(req.path)) {
      res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(row.original_name || row.filename));
    } else if (/\/preview$/.test(req.path)) {
      res.setHeader("Content-Disposition", "inline; filename*=UTF-8''" + encodeURIComponent(row.original_name || row.filename));
      res.setHeader("X-Content-Type-Options", "nosniff");
    }
    fs.createReadStream(fp).pipe(res);
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});

app.get("/api/tencent-usage", async (req, res) => {
  const username = authenticateRequest(req, db);
  if (!username || String(username).toLowerCase() !== "tom") {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    const data = await getTencentUsage();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

app.all("*", async (req, res) => {
  // 非 API 请求走 SPA（前端同进程托管）
  if (!req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.sendFile(path.join(DIST, "index.html"));
  }
  try {
    const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    let body;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await rawBody(req);
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
    // Worker 登录历史读 CF-Connecting-IP；这里注入真实客户端 IP
    headers.set("CF-Connecting-IP", req.ip || (req.socket && req.socket.remoteAddress) || "");

    const request = new Request(url, { method: req.method, headers, body });
    const response = await worker.fetch(request, env, ctx);

    response.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (lk === "content-length" || lk === "transfer-encoding" || lk === "connection") return;
      try { res.set(k, v); } catch (e) { /* 忽略不可设头 */ }
    });
    res.status(response.status);

    if (response.body) {
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AGI-PM Node 后端已启动： http://0.0.0.0:${PORT}`);
});
