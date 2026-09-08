// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件（腾讯云入口）逻辑已锁定，未经用户明确同意禁止修改。除 CRM / LOST / WON / 个人佣金 四个模块内的“样板数据 / 演示数据”（清理演示数据用，仅删数据、不改逻辑）外，其余业务逻辑均正确，禁止改动。
// ============================================================
// AGI-PM 腾讯云版后端入口（腾讯云轻量应用服务器 2C4G / 香港）
// - Express 托管前端静态资源（node-backend/dist）
// - 复用业务后端逻辑（./src/index.js 的 fetch，原 Cloudflare Worker 代码已搬入本目录）
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
// 复用 ./src 的业务代码（已从 cloudflare/src 搬入，单一源，不复制）
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

// 让清理报告的容量上限基于本机系统盘（默认 10 TB 是 Cloudflare R2 假设，自托管版用实际磁盘）
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
// 所有 /api 请求走本服务器（同源），不再转发 Cloudflare。
const DIST = path.join(ROOT, "dist");
app.use(express.static(DIST, { extensions: ["html"] }));

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
