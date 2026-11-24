// ============================================================
// ★INSTALL-MGMT-20261124★ 安装管理（占位数据接口）
// ------------------------------------------------------------
// 与【签约项目】按 project_id 关联（won_projects.id）。
// 本轮页面内容为占位（标题 + 敬请期待），接口先就绪，下一轮接入真实功能时直接复用。
//
// 接口（都在统一会话鉴权之后，非 PUBLIC_PATHS）：
//   GET  /api/install/projects                  签约项目列表（id / 合同号 / 客户 / 签约日）
//   GET  /api/install/mgmt?project_id=<id>      读取某项目的安装管理数据（无记录返回空对象）
//   PUT  /api/install/mgmt                      写入（body: {project_id, data, me?}）
//
// 表：install_mgmt(project_id UNIQUE, data TEXT, created_at, updated_at, updated_by)
// 首次访问时 CREATE TABLE IF NOT EXISTS 兜底，不依赖手工建库（本地 SQLite 与云端 D1 通用）。
// ============================================================

const TABLE = "install_mgmt";
let _tableReady = false;

async function ensureInstallTable(env) {
  if (_tableReady || !env || !env.DB) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS " + TABLE + " (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "project_id TEXT NOT NULL UNIQUE," +
      "data TEXT DEFAULT '{}'," +
      "created_at TEXT DEFAULT ''," +
      "updated_at TEXT DEFAULT ''," +
      "updated_by TEXT DEFAULT ''" +
    ")"
  ).run();
  _tableReady = true;
}

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
  );
}

function parseData(raw) {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v === null ? {} : v;
  } catch (e) {
    return {};
  }
}

export async function handleInstall(request, env, url, pathname) {
  if (!pathname || pathname.indexOf("/api/install/") !== 0) return null;
  if (!env || !env.DB) {
    return { body: { ok: false, error: "数据库未接入" }, status: 500 };
  }

  try {
    await ensureInstallTable(env);
  } catch (e) {
    return { body: { ok: false, error: "建表失败: " + String((e && e.message) || e) }, status: 500 };
  }

  const me = (
    request.headers.get("X-User-Name") ||
    url.searchParams.get("me") ||
    ""
  ).trim();

  // ---------------- 签约项目列表（供下一轮做项目下拉） ----------------
  if (pathname === "/api/install/projects" && request.method === "GET") {
    try {
      const rs = await env.DB.prepare(
        "SELECT id, contract_no, customer, contract_date FROM won_projects ORDER BY id DESC"
      ).all();
      const items = (rs.results || []).map((r) => ({
        id: r.id,
        contract_no: r.contract_no || "",
        customer: r.customer || "",
        contract_date: r.contract_date || "",
      }));
      return { body: { ok: true, items }, status: 200 };
    } catch (e) {
      return { body: { ok: false, error: String((e && e.message) || e) }, status: 500 };
    }
  }

  // ---------------- 读取某项目的安装管理数据 ----------------
  if (pathname === "/api/install/mgmt" && request.method === "GET") {
    const pid = String(url.searchParams.get("project_id") || "").trim();
    if (!pid) return { body: { ok: false, error: "缺少 project_id" }, status: 400 };
    try {
      const row = await env.DB.prepare(
        "SELECT project_id, data, created_at, updated_at, updated_by FROM " + TABLE + " WHERE project_id=?"
      ).bind(pid).first();
      return {
        body: {
          ok: true,
          item: row
            ? {
                project_id: row.project_id,
                data: parseData(row.data),
                created_at: row.created_at || "",
                updated_at: row.updated_at || "",
                updated_by: row.updated_by || "",
              }
            : { project_id: pid, data: {}, created_at: "", updated_at: "", updated_by: "" },
        },
        status: 200,
      };
    } catch (e) {
      return { body: { ok: false, error: String((e && e.message) || e) }, status: 500 };
    }
  }

  // ---------------- 写入（新增或更新） ----------------
  if (pathname === "/api/install/mgmt" && (request.method === "PUT" || request.method === "POST")) {
    let body = {};
    try { body = (await request.json()) || {}; } catch (e) { body = {}; }
    const pid = String(body.project_id || "").trim();
    if (!pid) return { body: { ok: false, error: "缺少 project_id" }, status: 400 };
    const payload = JSON.stringify(body.data === undefined ? {} : body.data);
    const who = String(body.me || me || "").trim();
    const ts = nowStr();
    try {
      await env.DB.prepare(
        "INSERT INTO " + TABLE + " (project_id, data, created_at, updated_at, updated_by) VALUES (?,?,?,?,?) " +
        "ON CONFLICT(project_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, updated_by=excluded.updated_by"
      ).bind(pid, payload, ts, ts, who).run();
      return {
        body: {
          ok: true,
          item: { project_id: pid, data: parseData(payload), updated_at: ts, updated_by: who },
        },
        status: 200,
      };
    } catch (e) {
      return { body: { ok: false, error: String((e && e.message) || e) }, status: 500 };
    }
  }

  return { body: { ok: false, error: "接口不存在: " + pathname }, status: 404 };
}
