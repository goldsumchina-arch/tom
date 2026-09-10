// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件逻辑已锁定，未经用户明确同意禁止修改。除 CRM / LOST / WON / 个人佣金 四个模块内的“样板数据 / 演示数据”（清理演示数据用，仅删数据、不改逻辑）外，其余业务逻辑均正确，禁止改动。
// ============================================================
// AGI-PM 云端后端（Cloudflare Worker）
//
// 阶段 M7：附件上云(R2) + 用户权限管理 + DEMO 演示数据
//
// 已实现接口：
//   M3  POST /api/login            登录（明文密码无感升级为加密）
//       GET  /api/me               取用户信息
//       GET  /api/perm-version     权限版本号
//       POST /api/change-password  修改密码
//   M5  /api/crm-projects          潜在项目 CRUD + 转失败
//   M6  /api/won-projects          签约项目 CRUD（含 P345 佣金服务端剥离）
//       /api/lost-projects         失败项目 CRUD + 转回潜在
//       /api/approval-requests     审批流（发起/列表/处理/删除）
//   M7  /api/won-projects/<id>/attachments  附件上传/删除（存 R2）
//       GET  /api/files/<key>               附件下载/预览
//       /api/users                          用户增删改（含权限闸门）
//       /api/managers                       管理员任命
//       /api/demo/load  /api/demo/clear     演示数据还原/清空
//   M9  /api/metal-prices   /api/feed-prices  /api/fx-rates
//       /api/livestock-prices  /api/livestock-farmgate  /api/livestock-retail-raw
//                                          价格数据（从 R2 读预生成快照，秒开）
//   公用 GET  /api/health           健康检查
//       GET  /api/tables           数据表概况
//       GET  /                     欢迎页
// ============================================================

import { handleCrm } from "./crm.js";
import { handleWonLost } from "./wonlost.js";
import { handleApproval } from "./approval.js";
import { handleUsers } from "./users.js";
import { handleFiles } from "./files.js";
import { handlePrices } from "./prices.js";
import { handleCommission } from "./commission.js";
import { handleVault } from "./vault.js";
import { handlePurge } from "./purge.js";
import { handleDashUpdateStatus } from "./dash_update_status.js";
import { handleDashStats } from "./dash_stats.js";
import { handleTranslateFill } from "./translate_fill.js";
import { handleSync } from "./sync.js";
import { getD1Usage, quotaBlocks } from "./usage.js";

const PBKDF2_ITER = 10000; // 迭代次数：兼顾安全与 Cloudflare Worker 的 CPU 上限
const HASH_PREFIX = "pbkdf2$";

// ------------------------------------------------------------
// CORS（跨域许可）
// 前端部署在 Cloudflare Pages（agi-gs.pages.dev），
// 后端在 Workers（agi-gs.tomalso911.workers.dev），两者域名不同，
// 所以必须允许跨域调用。
//
// 注意：前端用了 credentials:'include'（携带 cookie），
// 这种情况 CORS 不能用通配符 *，必须回显具体的来源域名。
// ------------------------------------------------------------
function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Name, Authorization, X-Vault-Token",
    "Access-Control-Allow-Credentials": "true",
  };
}

function json(request, data, status = 200, noCache = false) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(request),
  };
  // 业务 API（CRM/WON/LOST/用户等）必须禁止浏览器/CDN 缓存，
  // 否则清空/加载数据后，浏览器仍显示旧响应。
  if (noCache || isBusinessApi(request)) {
    headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
    headers["Pragma"] = "no-cache";
    headers["Expires"] = "0";
  }
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

function isBusinessApi(request) {
  const u = new URL(request.url);
  const p = u.pathname;
  return p.startsWith("/api/") && !p.startsWith("/api/files/");
}

// ============================================================
// 密码工具
// ============================================================

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) {
    out[i / 2] = parseInt(s.substr(i, 2), 16);
  }
  return out;
}

/** 生成加密密码，格式：pbkdf2$<迭代次数>$<盐>$<哈希> */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
    key,
    256
  );
  return HASH_PREFIX + PBKDF2_ITER + "$" + toHex(salt) + "$" + toHex(bits);
}

/**
 * 校验密码。
 * - 存储值以 pbkdf2$ 开头 → 按加密方式校验
 * - 否则视为历史明文密码 → 直接比对（调用方会在成功后升级为加密）
 */
async function verifyPassword(stored, password) {
  if (!stored) return false;
  if (stored.startsWith(HASH_PREFIX)) {
    try {
      const parts = stored.split("$");
      const iter = parseInt(parts[1], 10) || PBKDF2_ITER;
      const salt = fromHex(parts[2]);
      const expected = parts[3];
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
      );
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
        key,
        256
      );
      return toHex(bits) === expected;
    } catch (e) {
      return false;
    }
  }
  return stored === password;
}

// ============================================================
// 会话（Session Token）机制 —— M10 安全加固
// 登录成功后服务端签发随机 token 并存 D1 sessions 表；
// 之后所有业务接口必须携带 Authorization: Bearer <token>，
// 服务端据此核验真实身份，不再信任前端自报的 X-User-Name。
// 好处：token 可随时在后端 DELETE（强制某人下线），且无法伪造。
// ============================================================

const SESSION_TTL_HOURS = 168; // token 有效期（小时），超时需重新登录。默认 7 天，避免每天上班都要重新登录。

/** 首次调用时确保 sessions 表存在 */
async function ensureSessionsTable(env) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS sessions (" +
        "token TEXT PRIMARY KEY, " +
        "username TEXT NOT NULL, " +
        "created_at TEXT DEFAULT '', " +
        "expires_at TEXT DEFAULT ''" +
      ")"
    ).run();
  } catch (e) { /* 表已存在则忽略 */ }
}

/** 生成高强度随机 token */
function genToken() {
  const buf = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function nowLocalStr() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function expiresLocalStr() {
  const d = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * 校验请求中的 Bearer token，返回真实 username；无效/过期返回 null。
 * 同时把受信 username 写回请求头 X-User-Name，使下游业务模块零改动即可获得可信身份。
 */
async function authenticate(request, env) {
  if (!env.DB) return null;
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;
  try {
    const row = await env.DB.prepare(
      "SELECT username, expires_at FROM sessions WHERE token=?"
    ).bind(token).first();
    if (!row) return null;
    if (row.expires_at) {
      const exp = Date.parse(row.expires_at.replace(" ", "T") + "Z");
      if (!isNaN(exp) && Date.now() > exp) {
        // 过期：顺手清理
        await env.DB.prepare("DELETE FROM sessions WHERE token=?").bind(token).run();
        return null;
      }
    }
    // ★ 滑动续期：每次有效请求都把过期时间延后 SESSION_TTL_HOURS，
    //   避免活跃用户因“登录后固定 7 天”到点被踢；最长离线时间仍受 TTL 限制。
    try {
      await env.DB.prepare(
        "UPDATE sessions SET expires_at=? WHERE token=?"
      ).bind(expiresLocalStr(), token).run();
    } catch (e) { /* 续期失败不影响本次请求 */ }
    return String(row.username || "").trim();
  } catch (e) {
    return null;
  }
}

// ============================================================
// 权限处理
// ============================================================

/** 把审批人列表里的数字 ID 统一换成用户名（兼容历史数据） */
function normApprovers(approvers, byId, byNameLower) {
  if (!Array.isArray(approvers)) return [];
  const seen = new Set();
  const out = [];
  for (const v of approvers) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    const uname = /^\d+$/.test(s) ? byId[s] : byNameLower[s.toLowerCase()];
    if (!uname) continue;
    if (!seen.has(uname)) {
      seen.add(uname);
      out.push(uname);
    }
  }
  return out;
}

/** 规范化用户权限 JSON 中的所有审批人字段 */
function normUserPerms(perms, users) {
  if (!perms || typeof perms !== "object") return perms || {};
  const byId = {};
  const byNameLower = {};
  for (const u of users) {
    byId[String(u.id)] = u.username;
    byNameLower[String(u.username).toLowerCase()] = u.username;
  }
  for (const [bid, p] of Object.entries(perms)) {
    if (p && typeof p === "object" && Array.isArray(p.approvers)) {
      p.approvers = normApprovers(p.approvers, byId, byNameLower);
    }
  }
  return perms;
}

/** 判断是否为管理员：在 managers 表中，或 role 为"管理员" */
async function isManager(env, username) {
  if (!username) return false;
  const m = await env.DB.prepare(
    "SELECT 1 AS x FROM managers WHERE username=?"
  )
    .bind(username)
    .first();
  if (m) return true;
  const u = await env.DB.prepare("SELECT role FROM users WHERE username=?")
    .bind(username)
    .first();
  return !!(u && u.role === "管理员");
}

/** 权限版本号 +1（前端轮询到变化就刷新缓存） */
async function bumpPermVersion(env, username) {
  const key = "permver:" + username;
  const row = await env.DB.prepare(
    "SELECT value FROM app_meta WHERE key=?"
  )
    .bind(key)
    .first();
  const next = row ? (parseInt(row.value, 10) || 0) + 1 : 1;
  await env.DB.prepare(
    "INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) " +
      "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  )
    .bind(key, String(next))
    .run();
  return next;
}

/** 组装返回给前端的用户对象（字段与本地 Python 版保持一致） */
function buildUser(row, admin, perms) {
  const c = (k, d = "") => (row[k] === null || row[k] === undefined ? d : row[k]);
  const parseIds = (raw) => {
    try {
      const v = JSON.parse(raw || "[]");
      return Array.isArray(v) ? v.map(Number).filter(x => !isNaN(x)) : [];
    } catch (e) { return []; }
  };
  return {
    username: c("username"),
    real_name: c("real_name"),
    role: c("role"),
    position: c("position"),
    is_admin: !!admin,
    status: c("status", "active"),
    vis_he_can_see: parseIds(c("vis_he_can_see", "[]")),
    vis_can_see_me: parseIds(c("vis_can_see_me", "[]")),
    perms: perms,
  };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    // ========================================================
    // POST /api/login  登录
    // ========================================================
    if (url.pathname === "/api/login" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
        return json(request, { ok: false, error: "请求格式错误" }, 400);
      }

      // 统一转小写：手机键盘默认首字母大写，用户很容易输入 "Tom"/"TOM"，
      // 而数据库存的是小写 "tom"，SQLite 的 = 比较大小写敏感 → 登录失败。
      // 这里归一化成小写，保证任何大小写输入都能登录成功。
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!username || !password) {
        return json(request, { ok: false, error: "请输入用户名和密码" });
      }

      // ---- 维护锁（暗门）：仅在允许名单内的人可以登录 ----
      // 配置：wrangler.toml [vars] LOGIN_ONLY_USERS = "tom"（多人用逗号分隔，如 "tom,admin"）
      // 留空或不设 = 不限制，所有人照常登录。
      // 用途：tom 调整权限/机密配置时，锁住他人登录，避免刷新页面看到未完成的内容。
      const only = String(env.LOGIN_ONLY_USERS || "").trim();
      if (only) {
        const allow = only.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!allow.includes(username)) {
          return json(request, {
            ok: false,
            error: "系统维护中：暂时仅管理员可登录，请稍后再试。",
          }, 403);
        }
      }

      // ---- D1 每日读额度 95% 熔断：超额后禁止非 tom 登录 ----
      const quotaLockLogin = await quotaBlocks(env, username);
      if (quotaLockLogin) {
        return json(request, {
          ok: false,
          code: "D1_QUOTA_LOCKED",
          error: "今日云端额度已用尽（D1 免费套餐 500 万行读/天），系统已临时限制：仅管理员可继续使用，请稍后再试。",
          usage: quotaLockLogin,
        }, 403);
      }

      const row = await env.DB.prepare("SELECT * FROM users WHERE username=?")
        .bind(username)
        .first();

      // 说明：error 保留中文原文（前端有依赖该文案的判断逻辑，不能改），
      //      同时附带 errKey 错误码，前端据此显示 中/英/越 对应文案。
      if (!row) {
        return json(request, { ok: false, error: "用户名不存在", errKey: "USER_NOT_FOUND" });
      }
      if (row.status !== "active") {
        return json(request, { ok: false, error: "该账号已被禁用", errKey: "ACCOUNT_DISABLED" });
      }

      const ok = await verifyPassword(row.password, password);
      if (!ok) {
        return json(request, { ok: false, error: "密码错误", errKey: "BAD_PASSWORD" });
      }

      // ---- 密码无感升级：老明文密码验证通过后，自动转成加密存储 ----
      // 用户完全无感知，22 个老账号无需改密码。
      let upgraded = false;
      if (!String(row.password).startsWith(HASH_PREFIX)) {
        try {
          const hashed = await hashPassword(password);
          await env.DB.prepare("UPDATE users SET password=? WHERE id=?")
            .bind(hashed, row.id)
            .run();
          upgraded = true;
        } catch (e) {
          // 升级失败不影响本次登录，下次会再试
        }
      }

      // ---- 记录登录历史 ----
      try {
        const ip = request.headers.get("CF-Connecting-IP") || "";
        const ua = (request.headers.get("User-Agent") || "").slice(0, 200);
        const now = new Date().toISOString().replace("T", " ").slice(0, 19);
        try {
          await env.DB.prepare(
            "ALTER TABLE login_history ADD COLUMN login_time TEXT DEFAULT ''"
          ).run();
        } catch (e) { /* 列已存在则忽略 */ }
        await env.DB.prepare(
          "INSERT INTO login_history (username, ip_address, user_agent, login_time) VALUES (?, ?, ?, ?)"
        )
          .bind(username, ip, ua, now)
          .run();
      } catch (e) {
        /* 登录历史失败不影响登录 */
      }

      // ---- 组装权限 ----
      let perms = {};
      try {
        perms = row.perms ? JSON.parse(row.perms) : {};
      } catch (e) {
        perms = {};
      }
      const users = await env.DB.prepare(
        "SELECT id, username FROM users"
      ).all();
      perms = normUserPerms(perms, users.results || []);
      const admin = await isManager(env, username);

      // ---- 签发会话 token（M10 安全加固）----
      let token = "";
      try {
        await ensureSessionsTable(env);
        token = genToken();
        await env.DB.prepare(
          "INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)"
        ).bind(token, username, nowLocalStr(), expiresLocalStr()).run();
      } catch (e) {
        token = "";
      }

      return json(request, {
        ok: true,
        password_upgraded: upgraded,
        token: token,
        user: buildUser(row, admin, perms),
      });
    }

    // ========================================================
    // POST /api/logout  注销（销毁当前会话 token）
    // ========================================================
    if (url.pathname === "/api/logout" && request.method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      const m = /^Bearer\s+(.+)$/i.exec(auth);
      if (m && env.DB) {
        try {
          await env.DB.prepare("DELETE FROM sessions WHERE token=?")
            .bind(m[1].trim()).run();
        } catch (e) { /* ignore */ }
      }
      return json(request, { ok: true });
    }

    // ========================================================
    // GET /api/session  校验当前 token 是否有效，返回用户
    // ========================================================
    if (url.pathname === "/api/session" && request.method === "GET") {
      const uname = await authenticate(request, env);
      if (!uname) {
        return json(request, { ok: false, error: "未登录或会话已过期" }, 401);
      }
      const row = await env.DB.prepare(
        "SELECT * FROM users WHERE username=?"
      ).bind(uname).first();
      if (!row) {
        return json(request, { ok: false, error: "用户不存在", errKey: "USER_NOT_FOUND" }, 401);
      }
      let perms = {};
      try { perms = row.perms ? JSON.parse(row.perms) : {}; } catch (e) { perms = {}; }
      const users = await env.DB.prepare("SELECT id, username FROM users").all();
      perms = normUserPerms(perms, users.results || []);
      const admin = await isManager(env, uname);
      return json(request, { ok: true, user: buildUser(row, admin, perms) });
    }

    // ========================================================
    // GET /api/login-history  登录记录统计（仪表盘 US-LH 区块）
    // 前端只需要 userMonthly（当月各用户次数）与 userYearly（当年各用户次数）
    // D1 不支持 strftime，改用 JS 在 login_time 上分组
    // ========================================================
    if (url.pathname === "/api/login-history" && request.method === "GET") {
      try {
        await env.DB.prepare(
          "ALTER TABLE login_history ADD COLUMN login_time TEXT DEFAULT ''"
        ).run();
      } catch (e) { /* 列已存在则忽略 */ }
      const rows = await env.DB.prepare(
        "SELECT username, login_time FROM login_history"
      ).all();
      const now = new Date();
      const curY = now.getFullYear();
      const curM = now.getMonth() + 1; // 1-12
      const monthMap = {};
      const yearMap = {};
      for (const r of rows.results || []) {
        const lt = r.login_time || "";
        // login_time 形如 2026-09-01 12:34:56
        const ym = (lt.slice(0, 7) || "").split("-"); // ["2026","09"]
        const y = parseInt(ym[0], 10);
        const m = parseInt(ym[1], 10);
        if (y === curY) {
          if (m === curM) {
            monthMap[r.username] = (monthMap[r.username] || 0) + 1;
          }
          yearMap[r.username] = (yearMap[r.username] || 0) + 1;
        }
      }
      const userMonthly = Object.keys(monthMap)
        .map((u) => ({ username: u, count: monthMap[u] }))
        .sort((a, b) => b.count - a.count || (a.username < b.username ? -1 : 1));
      const userYearly = Object.keys(yearMap)
        .map((u) => ({ username: u, count: yearMap[u] }))
        .sort((a, b) => b.count - a.count || (a.username < b.username ? -1 : 1));
      return json(request, { ok: true, userMonthly, userYearly });
    }

    // ========================================================
    // GET /api/me  取用户信息
    // ========================================================
    if (url.pathname === "/api/me") {
      const username = String(url.searchParams.get("username") || "").trim();
      if (!username) {
        return json(request, { ok: false, error: "missing username" }, 400);
      }
      // ---- 维护锁（暗门）第二道：已登录的人刷新页面时走这条接口恢复会话，
      // 若不拦，非白名单用户刷新后仍能进来。这里对非白名单一律拒绝，
      // 前端收到后会自动退出到登录页，无法看到任何页面内容。
      const onlyMe = String(env.LOGIN_ONLY_USERS || "").trim();
      if (onlyMe) {
        const allowMe = onlyMe.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!allowMe.includes(username)) {   // username 已在上方统一小写
          return json(request, { ok: false, error: "系统维护中：暂时仅管理员可登录。" }, 403);
        }
      }
      const row = await env.DB.prepare("SELECT * FROM users WHERE username=?")
        .bind(username)
        .first();
      if (!row) {
        return json(request, { ok: false, error: "user not found" }, 404);
      }
      let perms = {};
      try {
        perms = row.perms ? JSON.parse(row.perms) : {};
      } catch (e) {
        perms = {};
      }
      const users = await env.DB.prepare(
        "SELECT id, username FROM users"
      ).all();
      perms = normUserPerms(perms, users.results || []);
      const admin = await isManager(env, username);
      return json(request, { ok: true, user: buildUser(row, admin, perms) });
    }

    // ========================================================
    // GET /api/perm-version  权限版本号
    // ========================================================
    if (url.pathname === "/api/perm-version") {
      const username = String(url.searchParams.get("username") || "").trim();
      if (!username) {
        return json(request, { ok: false, error: "missing username" }, 400);
      }
      let version = 0;
      try {
        const row = await env.DB.prepare(
          "SELECT value FROM app_meta WHERE key=?"
        )
          .bind("permver:" + username)
          .first();
        version = row ? parseInt(row.value, 10) || 0 : 0;
      } catch (e) {
        /* app_meta 表不存在时返回 0 */
      }
      return json(request, { ok: true, username, version });
    }

    // ========================================================
    // POST /api/change-password  修改密码
    // ========================================================
    if (url.pathname === "/api/change-password" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
        return json(request, { ok: false, error: "请求格式错误" }, 400);
      }
      const username = String(body.username || "").trim();
      const oldPw = String(body.old_password || "");
      const newPw = String(body.new_password || "");

      if (!username) {
        return json(request, { ok: false, error: "缺少用户名" }, 400);
      }
      if (newPw.length < 6) {
        return json(request, { ok: false, error: "新密码长度至少 6 位" });
      }

      const row = await env.DB.prepare("SELECT * FROM users WHERE username=?")
        .bind(username)
        .first();
      if (!row) {
        return json(request, { ok: false, error: "用户名不存在" }, 404);
      }
      const ok = await verifyPassword(row.password, oldPw);
      if (!ok) {
        return json(request, { ok: false, error: "旧密码错误" });
      }

      const hashed = await hashPassword(newPw);
      await env.DB.prepare("UPDATE users SET password=? WHERE username=?")
        .bind(hashed, username)
        .run();
      await bumpPermVersion(env, username);

      return json(request, { ok: true, message: "密码修改成功" });
    }

    // ========================================================
    // 统一会话鉴权（M10 安全加固）
    // 所有业务接口（除 login/logout/session/me/change-password/health/files 静态下载）
    // 必须携带 Authorization: Bearer <token>，否则 401。
    // 校验通过后，用服务端确认的真实用户名覆盖 X-User-Name，
    // 使下游 7 个业务模块无需改动即可获得可信身份（不再信任前端伪造）。
    // ========================================================
    const PUBLIC_PATHS = new Set([
      "/api/login", "/api/logout", "/api/session", "/api/me",
      "/api/change-password", "/api/health", "/api/tables",
      "/api/perm-version", "/api/translate",
      // 看板价格/汇率数据只读，不涉敏感信息，允许未登录时直接读取（避免登录页/会话恢复前的 401）
      "/api/metal-prices", "/api/feed-prices", "/api/livestock-prices",
      "/api/livestock-farmgate", "/api/fx-rates", "/api/livestock-retail-raw",
      "/",
    ]);
    // 附件直链（<img src>/<a href>）浏览器无法自动带 Authorization 头，故免鉴权；
    // 安全性依赖 key 的不可猜测性（UUID）。如未来改为 fetch+blob 预览可再加鉴权。
    const isPublicFile = url.pathname.startsWith("/api/files/");
    // 私密空间走独立的 PIN token 体系（vault.js 内部校验 X-Vault-Token / ?vt=），
    // 且下载/预览是 <a>/<img> 直链带不了会话头，故在会话门外放行。
    const isVaultPath = url.pathname.startsWith("/api/vault/");
    if (url.pathname.startsWith("/api/") && !PUBLIC_PATHS.has(url.pathname) && !isPublicFile && !isVaultPath) {
      const authUser = await authenticate(request, env);
      if (!authUser) {
        return json(request,
          { ok: false, error: "未登录或会话已过期，请重新登录", code: "NO_AUTH" },
          401);
      }
      // 覆盖 X-User-Name 为受信身份（前端自报值被忽略）
      const newHeaders = new Headers(request.headers);
      newHeaders.set("X-User-Name", authUser);
      request = new Request(request, { headers: newHeaders });

      // ---- D1 每日读额度 95% 熔断 ----
      // 官方统计显示当日行读已达 95% 时，只放行 tom，其余人全部拒绝，
      // 避免把最后一点额度用光导致连管理员都进不去。
      // 注意：用量来自 Cloudflare 官方分析 API，不消耗 D1 额度。
      const quotaLock = await quotaBlocks(env, authUser);
      if (quotaLock) {
        return json(request, {
          ok: false,
          code: "D1_QUOTA_LOCKED",
          error: "今日云端额度已用尽（D1 免费套餐 500 万行读/天），系统已临时限制：仅管理员可继续使用，请稍后再试。",
          usage: quotaLock,
        }, 403);
      }

      // ---- tom 专属：D1 用量报告（长按头像 3 秒打开）----
      // GET /api/d1-usage?refresh=1
      if (url.pathname === "/api/d1-usage" && request.method === "GET") {
        if (String(authUser).toLowerCase() !== "tom") {
          return json(request, {
            ok: false,
            error: "仅管理员可查看用量报告",
            code: "FORBIDDEN",
          }, 403);
        }
        const usage = await getD1Usage(env, url.searchParams.get("refresh") === "1");
        return json(request, {
          ok: true,
          usage: usage,
          username: authUser,
          // 诊断信息（仅 tom 可见，不含任何密钥内容）
          debug: {
            tokenLen: String(env.CF_ANALYTICS_TOKEN || "").length,
            hasAcct: !!env.CF_ACCOUNT_ID,
            hasDbId: !!env.CF_D1_DATABASE_ID,
          },
        });
      }
    }

    // ========================================================
    // 翻译中转（M11）：服务端代调 Google，前端 ptTranslateViaGoogle 优先走此端点。
    // 目的：翻译与系统其它 API 走同一鉴权/网络路径，绕开浏览器端扩展/证书/网络
    //      对 translate.googleapis.com 直连的干扰。
    // GET /api/translate?q=<text>&target=<zh|en|vi>  →  {ok:true, text:"..."}
    // ========================================================
    if (url.pathname === "/api/translate" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "").slice(0, 1000);
      const target = (url.searchParams.get("target") || "en").toLowerCase();
      if (!q) return json(request, { ok: false, error: "empty q" }, 400);
      if (!["zh", "en", "vi"].includes(target)) {
        return json(request, { ok: false, error: "bad target" }, 400);
      }
      // MyMemory 不支持 Autodetect 作为 source，必须给 ISO 源语言码
      const detectLangMyMemory = (text) => {
        if (/[\u4e00-\u9fa5]/.test(text)) return "zh-CN";
        if (/[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/i.test(text)) return "vi-VN";
        return "en-US";
      };
      // ★ 主后端：Workers AI 多语翻译模型，运行在 Cloudflare 网络内，
      //   不受 Google 对 Cloudflare 出口 IP 的自动化封锁影响，也无外部配额限制。
      const tryWorkersAI = async () => {
        if (!env || !env.AI) throw new Error("ai-no-binding");
        const aiSrc = { "zh-CN": "zh", "vi-VN": "vi", "en-US": "en" };
        const source = aiSrc[detectLangMyMemory(q)] || "en";
        const tgt = { zh: "zh", en: "en", vi: "vi" }[target] || "en";
        let lastErr = null;
        // 冷启动偶发失败：最多重试 2 次，平滑首调抖动
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await env.AI.run("@cf/meta/m2m100-1.2b", {
              text: q,
              source_lang: source,
              target_lang: tgt
            });
            const text = (res && (res.translated_text || res.text)) || "";
            if (!text) { lastErr = new Error("ai-empty"); continue; }
            return text;
          } catch (e) { lastErr = e; }
        }
        throw lastErr || new Error("ai-fail");
      };
      const tryMyMemory = async (sourceGuess) => {
        const tmap = { zh: "zh-CN", en: "en-US", vi: "vi-VN" };
        const source = sourceGuess || detectLangMyMemory(q);
        const pair = source + "|" + (tmap[target] || target);
        const murl = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(q)
          + "&langpair=" + encodeURIComponent(pair)
          + "&de=translate@agi-pm.app";
        const mr = await fetch(murl, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!mr.ok) throw new Error("mm-" + mr.status);
        const md = await mr.json();
        const mt = md && md.responseData && md.responseData.translatedText;
        const umt = (mt || "").toUpperCase();
        if (!mt || umt === "NO TRANSLATION" || umt.indexOf("PLEASE SELECT") !== -1 || umt.indexOf("MYMEMORY WARNING") !== -1) throw new Error("mm-empty");
        // 如果 MyMemory 报错“INVALID SOURCE”，回退到检测出的源语言再试一次
        if (umt.indexOf("INVALID SOURCE") !== -1) {
          if (sourceGuess) throw new Error("mm-invalid-source");
          return await tryMyMemory(detectLangMyMemory(q));
        }
        return mt;
      };
      const tryLibre = async (sourceGuess) => {
        const tmap = { zh: "zh", en: "en", vi: "vi" };
        const src = sourceGuess || (detectLangMyMemory(q).split("-")[0]);
        const tgt = tmap[target] || target;
        const instances = ["https://libretranslate.de", "https://translate.argosopentech.com"];
        let lastErr = null;
        for (const base of instances) {
          try {
            const lr = await fetch(base + "/translate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ q: q, source: src, target: tgt, format: "text" })
            });
            if (!lr.ok) { lastErr = new Error("lt-" + lr.status); continue; }
            const ld = await lr.json();
            if (ld && ld.translatedText) return ld.translatedText;
            lastErr = new Error("lt-empty");
          } catch (err) { lastErr = err; }
        }
        throw lastErr || new Error("lt-fail");
      };

      // 翻译后端链（按可用性排序）：
      //   1) Workers AI（Cloudflare 网络内，主用，无外部配额限制）
      //   2) clients5.google.com（Chrome 词典扩展端点，抗 Google 自动化封锁）
      //   3) translate.googleapis.com（gtx）
      //   4) MyMemory（带邮箱提额）
      //   5) Libre 公共实例（最后兜底）
      const tryGoogleChrome = async () => {
        const gurl = "https://clients5.google.com/translate_a/t?client=dict-chrome-ext&sl=auto&tl="
          + encodeURIComponent(target) + "&dt=t&q=" + encodeURIComponent(q);
        const gr = await fetch(gurl, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!gr.ok) throw new Error("gc-" + gr.status);
        const gd = await gr.json();
        const arr = (gd && gd.value) || [];
        const text = arr.slice(0, -1).join("") || (arr[0] || "");
        if (!text) throw new Error("gc-empty");
        return text;
      };
      try {
        const text = await tryWorkersAI();
        return json(request, { ok: true, text });
      } catch (e) {
        try {
          const text = await tryGoogleChrome();
          return json(request, { ok: true, text });
        } catch (e2) {
          try {
            const gurl = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl="
              + encodeURIComponent(target) + "&dt=t&q=" + encodeURIComponent(q);
            const gr = await fetch(gurl, { headers: { "User-Agent": "Mozilla/5.0" } });
            if (!gr.ok) throw new Error("gt-" + gr.status);
            const gd = await gr.json();
            const text = Array.isArray(gd) && gd[0] ? gd[0].map((x) => (x && x[0]) || "").join("") : "";
            if (!text) throw new Error("gt-empty");
            return json(request, { ok: true, text });
          } catch (e3) {
            try {
              const text = await tryMyMemory();
              return json(request, { ok: true, text });
            } catch (e4) {
              try {
                const text = await tryLibre();
                return json(request, { ok: true, text });
              } catch (e5) {
                return json(request, { ok: false, error: String((e5 && e5.message) || e5 || e4 || e3 || e2 || e) }, 200);
              }
            }
          }
        }
      }
    }

    // ========================================================
    // 备注服务端补翻（M13）：GET /api/translate-remarks?table=...&limit=N
    // 把缺的 remark_zh/en/vi 在服务端翻译并写回 D1；前端列表加载后 fire 触发。
    // ========================================================
    if (url.pathname === "/api/translate-remarks" && request.method === "GET") {
      const res = await handleTranslateFill(request, env, url);
      return json(request, res, res.ok ? 200 : 400);
    }

    // ========================================================
    // 业务模块（M5 CRM / M6 签约+失败+审批 / M7 附件+用户+DEMO）
    // 各模块内部自行判断是否接管该路径，未接管则返回 null
    // ========================================================
    for (const handler of [
      handleSync,
      handleCrm, handleWonLost, handleApproval,
      handleUsers, handleFiles, handlePrices,
      handleCommission, handleVault, handlePurge, handleDashUpdateStatus, handleDashStats,
    ]) {
      let out = null;
      try {
        out = await handler(request, env, url, url.pathname);
      } catch (e) {
        return json(request, { error: String((e && e.message) || e) }, 500);
      }
      if (out) {
        // 附件模块直接返回原始 Response（二进制流）
        // 补 CORS 头：前端预览组件（PDF.js/mammoth/SheetJS）需要用 fetch 读取文件字节，
        // 跨域读取必须有 Access-Control-Allow-Origin，否则 Word/Excel 预览全部失败
        if (out.__raw) {
          try {
            const cors = corsHeaders(request);
            for (const k of Object.keys(cors)) {
              if (!out.__raw.headers.has(k)) out.__raw.headers.set(k, cors[k]);
            }
          } catch (e) { /* 补头失败不影响原响应 */ }
          return out.__raw;
        }
        if (out.__err) {
          return json(request,
            { error: out.__err, message: out.__msg || out.__err },
            out.__status || 400);
        }
        return json(request, out.body !== undefined ? out.body : out,
          out.status || 200);
      }
    }

    // ========================================================
    // GET /api/health  健康检查
    // ========================================================
    if (url.pathname === "/api/health") {
      const info = {
        ok: true,
        stage: "M3",
        message: "云端后端运行正常",
        time: new Date().toISOString(),
        services: { r2_files: !!env.FILES, d1_database: !!env.DB },
      };
      if (env.DB) {
        try {
          const tables = [
            "users", "managers", "crm_projects", "won_projects",
            "lost_projects", "approval_requests", "login_history",
            "password_requests",
          ];
          const counts = {};
          for (const t of tables) {
            const r = await env.DB.prepare(
              "SELECT COUNT(*) AS n FROM " + t
            ).first();
            counts[t] = r ? r.n : 0;
          }
          info.tables = counts;
        } catch (e) {
          info.dbError = String(e);
        }
      }
      return json(request, info);
    }

    // ========================================================
    // GET /api/tables  数据表概况
    // ========================================================
    if (url.pathname === "/api/tables") {
      if (!env.DB) return json(request, { ok: false, error: "数据库未接入" }, 500);
      try {
        const meta = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).all();
        const names = (meta.results || []).map((r) => r.name);
        const counts = {};
        for (const n of names) {
          const r = await env.DB.prepare(
            "SELECT COUNT(*) AS c FROM " + n
          ).first();
          counts[n] = r ? r.c : 0;
        }
        return json(request, { ok: true, tables: counts });
      } catch (e) {
        return json(request, { ok: false, error: String(e) }, 500);
      }
    }

    // ========================================================
    // GET /  欢迎页
    // ========================================================
    if (url.pathname === "/") {
      return new Response(welcomePage(url), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return json(request, { ok: false, error: "接口不存在: " + url.pathname }, 404);
  },
};

function welcomePage(url) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AGI-PM 云端后端</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    background: linear-gradient(135deg,#6b5ce7 0%,#8b7cf8 100%);
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 20px; color: #fff;
  }
  .card {
    background: rgba(255,255,255,.15); backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,.25); border-radius: 20px;
    padding: 36px 28px; max-width: 480px; width: 100%;
    box-shadow: 0 12px 40px rgba(0,0,0,.2);
  }
  h1 { font-size: 24px; margin-bottom: 6px; }
  .sub { opacity: .85; font-size: 14px; margin-bottom: 24px; }
  .row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 14px; margin-bottom: 10px; border-radius: 12px;
    background: rgba(255,255,255,.12); font-size: 14px;
  }
  .tag { padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .on  { background: #10b981; }
  code {
    background: rgba(0,0,0,.25); padding: 2px 7px; border-radius: 5px;
    font-size: 13px; word-break: break-all;
  }
  .foot { margin-top: 20px; font-size: 12px; opacity: .75; line-height: 1.8; }
</style>
</head>
<body>
<div class="card">
  <h1>AGI-PM 云端后端已上线</h1>
  <p class="sub">阶段 M3 · 登录认证已上云</p>

  <div class="row"><span>R2 文件柜（agi-pm-files）</span><span class="tag on">已连接</span></div>
  <div class="row"><span>D1 数据库（agi-pm-db）</span><span class="tag on">已连接</span></div>
  <div class="row"><span>登录接口</span><span class="tag on">已启用</span></div>
  <div class="row"><span>密码加密</span><span class="tag on">登录时自动升级</span></div>

  <p class="foot">
    健康检查：<code>${url.origin}/api/health</code><br>
    数据表概况：<code>${url.origin}/api/tables</code><br>
    当前时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
  </p>
</div>
</body>
</html>`;
}
