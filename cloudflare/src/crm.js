// ⛔ FROZEN (2026-09-06) V2026.09.06.20：本文件逻辑已锁定，未经用户明确同意禁止修改。CRM 后端逻辑均正确，仅数据可为演示数据。
import { purgeCrm } from "./purge.js";
import { migrateProvinceColumn, migrateBuColumn } from "./provinces.js";

// ============================================================
// CRM 潜在项目模块（M5）
// 严格复刻本地 app.py 的权限逻辑，包括：
//   - 可见范围过滤（_visible_scope）
//   - 写操作归属校验（_owns_row）
//   - 权限闸门（_perm_gate）
// ============================================================

// 允许写入的业务字段（与 app.py 的 CRM_FIELDS 完全一致，顺序也一致）
export const CRM_FIELDS = [
  "quote_no", "project_name", "province", "customer", "bu", "construction",
  "startup_pct", "sign_pct", "manager", "manager_phone", "company_info",
  "initial_quote_date", "est_purchase_date", "est_ship_date", "quote_version",
  "last_quote_date", "rate_rmb_vnd", "rate_usd_vnd", "incoterm",
  "install_quoted", "salesperson", "remark", "pdf_equip", "pdf_install", "pdf_both",
  "remark_zh", "remark_en", "remark_vi",
  "q1_rmb", "q1_usd", "q1_vnd",
  "q2_rmb", "q2_usd", "q2_vnd",
  "q3_rmb", "q3_usd", "q3_vnd",
  "q4_rmb", "q4_usd", "q4_vnd",
  "q5_rmb", "q5_usd", "q5_vnd",
  "q6_rmb", "q6_usd", "q6_vnd",
  "q7_rmb", "q7_usd", "q7_vnd",
];

// 数值字段（写入时强制转整数）
const CRM_NUM_FIELDS = new Set([
  "q1_rmb", "q1_usd", "q1_vnd", "q2_rmb", "q2_usd", "q2_vnd",
  "q3_rmb", "q3_usd", "q3_vnd", "q4_rmb", "q4_usd", "q4_vnd",
  "q5_rmb", "q5_usd", "q5_vnd", "q6_rmb", "q6_usd", "q6_vnd",
  "q7_rmb", "q7_usd", "q7_vnd",
]);

function num(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

// 统一的错误返回（主入口会识别 __err 并转成 {error, message}）
function errj(msg, status) {
  return { __err: msg, __status: status };
}

// ============================================================
// 权限：可见范围
// ============================================================

/** 当前用户是否为管理员 */
async function isManager(env, username) {
  if (!username) return false;
  const m = await env.DB.prepare("SELECT 1 AS x FROM managers WHERE username=?")
    .bind(username)
    .first();
  if (m) return true;
  const u = await env.DB.prepare("SELECT role FROM users WHERE username=?")
    .bind(username)
    .first();
  return !!(u && u.role === "管理员");
}

/** 是否拥有"特别授权看全公司" */
async function hasFullCompany(env, username, blockId) {
  if (!username || !blockId) return false;
  const row = await env.DB.prepare("SELECT perms FROM users WHERE username=?")
    .bind(username)
    .first();
  if (!row || !row.perms) return false;
  let perms;
  try {
    perms = JSON.parse(row.perms);
  } catch (e) {
    return false;
  }
  const blk = perms && perms[blockId];
  if (!blk || typeof blk !== "object") return false;
  // 与桌面 app.py 保持一致：decision 为 "all" 或 "company" 均表示“看全公司”
  const _dec = String(blk.decision || "").trim().toLowerCase();
  return _dec === "all" || _dec === "company";
}

/**
 * 复刻 app.py 的 _visible_scope
 * 返回 { clause, params }，clause 为空表示看全部
 */
async function visibleScope(env, username, blockId) {
  if (!username) return { clause: "", params: [] };

  const user = await env.DB.prepare(
    "SELECT id, role, vis_he_can_see FROM users WHERE username=?"
  )
    .bind(username)
    .first();
  if (!user) return { clause: "", params: [] };

  if (await isManager(env, username)) return { clause: "", params: [] };
  if (await hasFullCompany(env, username, blockId)) return { clause: "", params: [] };

  const visible = [String(username).toLowerCase()];

  // vis_he_can_see：我可以看到谁（支持 ID 和用户名两种格式）
  let vs = [];
  try {
    vs = user.vis_he_can_see ? JSON.parse(user.vis_he_can_see) : [];
  } catch (e) {
    vs = [];
  }
  const idList = [];
  const nameList = [];
  for (const v of vs) {
    const s = String(v == null ? "" : v).trim();
    if (!s) continue;
    if (/^\d+$/.test(s)) idList.push(parseInt(s, 10));
    else nameList.push(s.toLowerCase());
  }
  if (idList.length) {
    const ph = idList.map(() => "?").join(",");
    const rs = await env.DB.prepare(
      "SELECT username FROM users WHERE id IN (" + ph + ")"
    )
      .bind(...idList)
      .all();
    for (const r of rs.results || []) {
      nameList.push(String(r.username).trim().toLowerCase());
    }
  }
  for (const n of nameList) {
    if (n && !visible.includes(n)) visible.push(n);
  }

  // 反向授权：别人的 vis_can_see_me 里包含我 → 他的数据对我可见
  try {
    const others = await env.DB.prepare(
      "SELECT username, vis_can_see_me FROM users WHERE username<>? " +
        "AND vis_can_see_me IS NOT NULL AND vis_can_see_me<>'' AND vis_can_see_me<>'[]'"
    )
      .bind(username)
      .all();
    for (const r of others.results || []) {
      let arr = [];
      try {
        arr = r.vis_can_see_me ? JSON.parse(r.vis_can_see_me) : [];
      } catch (e) {
        arr = [];
      }
      for (const v of arr) {
        const s = String(v == null ? "" : v).trim();
        if (!s) continue;
        const hit = /^\d+$/.test(s)
          ? user.id != null && parseInt(s, 10) === user.id
          : s.toLowerCase() === String(username).toLowerCase();
        if (hit) {
          const u2 = String(r.username).trim().toLowerCase();
          if (u2 && !visible.includes(u2)) visible.push(u2);
          break;
        }
      }
    }
  } catch (e) {
    /* 反向授权失败不影响主流程 */
  }

  // 离职代理：被代理人的 delegate_to 是我 → 可见其数据
  try {
    const del = await env.DB.prepare(
      "SELECT username FROM users WHERE delegate_to=? AND status<>'active' AND username<>?"
    )
      .bind(username, username)
      .all();
    for (const d of del.results || []) {
      visible.push(String(d.username).trim().toLowerCase());
    }
  } catch (e) {
    /* 忽略 */
  }

  const ph = visible.map(() => "?").join(",");
  // owner_user_id（录入人）或 salesperson（实际销售）任一命中可见集合即可见，
  // 这样正向/反向授权看某人数据时，其作为销售员的记录也能被正确纳入。
  const clause =
    "lower(owner_user_id) IN (" + ph + ") OR lower(salesperson) IN (" + ph + ")";
  return { clause, params: visible.concat(visible) };
}

// ============================================================
// 权限：写操作
// ============================================================

/** 复刻 _owns_row：是否拥有该行的写权限 */
async function ownsRow(env, table, pid, username) {
  if (!username) return true;
  if (await isManager(env, username)) return true;
  const row = await env.DB.prepare(
    "SELECT owner_user_id, salesperson FROM " + table + " WHERE id=?"
  )
    .bind(pid)
    .first();
  if (!row) return false;
  const me = String(username).trim().toLowerCase();
  const owner = String(row.owner_user_id || "").trim().toLowerCase();
  if (owner) return owner === me;
  const sp = String(row.salesperson || "").trim().toLowerCase();
  return sp === me;
}

/**
 * ★ 写权限（数据范围语义，与权限标签一致）：
 *    行归属者本人，或该行落在用户的可见数据范围内（CRM-L1）即可写。
 *    实际放行仍受 CRM-D2/D3/F1 决策闸（permGate）控制：
 *      hide → 403；approve → 必须有已通过的单次审批；default/company → 放行。
 *    （此前仅限"行归属者本人"，导致非本人行即使权限放行也不显示/不执行按钮）
 */
async function canModifyRow(env, table, pid, username) {
  if (!username) return true;
  if (await isManager(env, username)) return true;
  if (await ownsRow(env, table, pid, username)) return true;
  const vs = await visibleScope(env, username, "CRM-L1");
  if (!vs.clause) return true; // 看全部（特别授权/管理层）
  const row = await env.DB.prepare(
    "SELECT owner_user_id, salesperson FROM " + table + " WHERE id=?"
  )
    .bind(pid)
    .first();
  if (!row) return false;
  const list = (vs.params || []).map(function (s) {
    return String(s).toLowerCase();
  });
  const owner = String(row.owner_user_id || "").trim().toLowerCase();
  const sp = String(row.salesperson || "").trim().toLowerCase();
  return (owner && list.indexOf(owner) >= 0) || (sp && list.indexOf(sp) >= 0);
}

/**
 * 复刻 _perm_gate
 * 返回 null = 放行；返回对象 = 拒绝 { error, message, status }
 */
async function permGate(env, username, bid, targetId) {
  if (!username) return null;
  if (await isManager(env, username)) return null;

  const row = await env.DB.prepare("SELECT perms FROM users WHERE username=?")
    .bind(username)
    .first();
  if (!row || !row.perms) return null;

  let dec = "";
  try {
    const p = JSON.parse(row.perms);
    dec = String(((p && p[bid]) || {}).decision || "").trim().toLowerCase();
  } catch (e) {
    return null;
  }
  if (!dec || dec === "default" || dec === "company") return null;

  if (dec === "hide") {
    return {
      error: "forbidden_hidden",
      message: "无权限：该模块已被隐藏",
      status: 403,
    };
  }
  if (dec === "approve") {
    const tid = String(targetId == null ? "" : targetId);
    const g = await env.DB.prepare(
      "SELECT id FROM approval_requests WHERE requester=? AND block_id=? AND target_id=? " +
        "AND status='approved' AND persist='single-use' AND COALESCE(consumed,0)=0 " +
        "ORDER BY id DESC LIMIT 1"
    )
      .bind(username, bid, tid)
      .first();
    if (!g) {
      return {
        error: "approval_required",
        message: "该操作需审批人通过后才能执行",
        status: 403,
      };
    }
    await env.DB.prepare("UPDATE approval_requests SET consumed=1 WHERE id=?")
      .bind(g.id)
      .run();
    return null;
  }
  return null;
}

// ============================================================
// 路由
// ============================================================

// ★ CRM 备注三语列：D1 迁移（幂等，仅进程首次请求执行）
let _crmRmEnsured = false;
async function ensureCrmRemarkCols(env) {
  if (_crmRmEnsured) return;
  for (const s of ["zh", "en", "vi"]) {
    try {
      await env.DB.prepare("ALTER TABLE crm_projects ADD COLUMN remark_" + s + " TEXT DEFAULT ''").run();
    } catch (e) {
      const m = String(e && e.message || e).toLowerCase();
      if (!m.includes("duplicate") && !m.includes("already exists") && !m.includes("exists")) {
        throw new Error("CRM 备注三语列迁移失败(remark_" + s + "): " + (e && e.message || e));
      }
    }
  }
  try {
    await env.DB.prepare(
      "UPDATE crm_projects SET remark_zh = remark " +
      "WHERE (remark_zh IS NULL OR remark_zh = '') AND remark IS NOT NULL AND remark != ''"
    ).run();
  } catch (e) { /* 回填失败不阻塞 */ }
  _crmRmEnsured = true;
}

export async function handleCrm(request, env, url, pathname) {
  const username = (
    request.headers.get("X-User-Name") ||
    url.searchParams.get("me") ||
    ""
  ).trim();

  try { await ensureCrmRemarkCols(env); } catch (e) { return errj("数据库迁移失败: " + (e && e.message || e), 500); }
  // ★ 省份归一化迁移（幂等）：英文/中文变体 → 标准名，无法匹配的 → 西宁省（用户指定）
  try { await migrateProvinceColumn(env, "crm_projects", "Tây Ninh"); } catch (e) { /* 不阻塞请求 */ }
  // ★ BU 归一化迁移：假数据 BU-X → 随机四场（蛋鸡/猪/肉鸡/蛋鸭）
  try { await migrateBuColumn(env, "crm_projects"); } catch (e) { /* 不阻塞请求 */ }

  // ---- GET /api/crm-projects  列表 ----
  if (pathname === "/api/crm-projects" && request.method === "GET") {
    const scope = (url.searchParams.get("scope") || "").trim();
    // 潜在项目只展示 active（含历史空值），并排除内部占位记录
    let sql = "SELECT * FROM crm_projects WHERE (status='active' OR status IS NULL OR status='') " +
      "AND lower(salesperson) <> 'agi-gs internal'";
    const params = [];
    if (scope !== "all") {
      const vs = await visibleScope(env, username, "CRM-L1");
      if (vs.clause) {
        sql += " AND (" + vs.clause + ")";
        vs.params.forEach((p) => params.push(p));
      }
    }
    sql += " ORDER BY id ASC";
    const rs = await env.DB.prepare(sql).bind(...params).all();
    return { body: rs.results || [], status: 200 };
  }

  // ---- POST /api/crm-projects  新增 ----
  if (pathname === "/api/crm-projects" && request.method === "POST") {
    let data;
    try {
      data = await request.json();
    } catch (e) {
      return errj("请求格式错误", 400);
    }
    // ★ 新增受「新增潜在项目 CRM-N1」控制（此前误用 CRM-D2，
    //   导致 CRM-N1 权限行在服务端完全无效、而"编辑"权限反而管着新增）
    const gate = await permGate(env, username, "CRM-N1", "");
    if (gate) return gate;

    const cols = [];
    const vals = [];
    for (const f of CRM_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(data, f)) {
        cols.push(f);
        vals.push(CRM_NUM_FIELDS.has(f) ? num(data[f]) : data[f]);
      }
    }
    cols.push("owner_user_id");
    vals.push(String(username).toLowerCase());
    cols.push("status");
    vals.push("active");

    const ph = cols.map(() => "?").join(",");
    const ins = await env.DB.prepare(
      "INSERT INTO crm_projects (" + cols.join(",") + ") VALUES (" + ph + ")"
    )
      .bind(...vals)
      .run();

    const newId = ins.meta && ins.meta.last_row_id;
    await env.DB.prepare(
      "UPDATE crm_projects SET updated_at=datetime('now','localtime') WHERE id=?"
    )
      .bind(newId)
      .run();
    const row = await env.DB.prepare("SELECT * FROM crm_projects WHERE id=?")
      .bind(newId)
      .first();
    return { body: row, status: 201 };
  }

  // ---- 单条记录操作 /api/crm-projects/<id> ----
  let m = /^\/api\/crm-projects\/(\d+)$/.exec(pathname);
  if (m) {
    const pid = parseInt(m[1], 10);

    // GET 单条
    if (request.method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM crm_projects WHERE id=?")
        .bind(pid)
        .first();
      if (!row) return errj("not found", 404);
      return { body: row, status: 200 };
    }

    // PUT 修改
    if (request.method === "PUT") {
      const exists = await env.DB.prepare(
        "SELECT id FROM crm_projects WHERE id=?"
      )
        .bind(pid)
        .first();
      if (!exists) return errj("not found", 404);
      if (!(await canModifyRow(env, "crm_projects", pid, username))) {
        return errj("forbidden", 403);
      }
      const gate = await permGate(env, username, "CRM-D2", String(pid));
      if (gate) return gate;

      let data;
      try {
        data = await request.json();
      } catch (e) {
        return errj("请求格式错误", 400);
      }
      const sets = [];
      const vals = [];
      for (const f of CRM_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(data, f)) {
          sets.push(f + "=?");
          vals.push(CRM_NUM_FIELDS.has(f) ? num(data[f]) : data[f]);
        }
      }
      if (sets.length) {
        sets.push("updated_at=datetime('now','localtime')");
        vals.push(pid);
        await env.DB.prepare(
          "UPDATE crm_projects SET " + sets.join(", ") + " WHERE id=?"
        )
          .bind(...vals)
          .run();
      }
      const row = await env.DB.prepare("SELECT * FROM crm_projects WHERE id=?")
        .bind(pid)
        .first();
      return { body: row, status: 200 };
    }

    // DELETE 删除
    if (request.method === "DELETE") {
      const exists = await env.DB.prepare(
        "SELECT id FROM crm_projects WHERE id=?"
      )
        .bind(pid)
        .first();
      if (!exists) return errj("not found", 404);
      if (!(await canModifyRow(env, "crm_projects", pid, username))) {
        return errj("forbidden", 403);
      }
      const gate = await permGate(env, username, "CRM-D3", String(pid));
      if (gate) return gate;

      // 彻底删除：报价单附件(R2 crm-docs/) + 审批单(CRM-*) → 主记录
      // 用引用计数安全删除：CRM 转失败后 CRM 与 LOST 共享同一批 pdf key，
      // 只要 LOST 那边还在引用，文件就不能删，否则 LOST 的附件会变死链。
      const rep = await purgeCrm(env, pid);
      return { body: { ok: true, purge: rep }, status: 200 };
    }
  }

  // ---- POST /api/crm-projects/<id>/documents  报价单 PDF 上传（设备/安装/设备&安装 槽位）----
  // 存 R2（key 前缀 crm-docs/），带 slot 时删除被替换的旧文件；返回 {filename, url}
  m = /^\/api\/crm-projects\/(\d+)\/documents$/.exec(pathname);
  if (m && request.method === "POST") {
    const pid = parseInt(m[1], 10);
    let f = null, slot = "";
    try {
      const form = await request.formData();
      const got = form.get("file");
      if (got && typeof got !== "string") f = got;
      const s = form.get("slot");
      if (s && typeof s === "string") slot = s;
    } catch (e) { f = null; }
    if (!f) return errj("no file", 400);
    const origName = String(f.name || "");
    if (!/\.pdf$/i.test(origName)) return errj("所选文件不是PDF格式", 400);
    if (slot && !["pdf_equip", "pdf_install", "pdf_both"].includes(slot)) {
      return errj("invalid slot", 400);
    }
    const buf = await f.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 5));
    if (String.fromCharCode(...head) !== "%PDF-") {
      return errj("文件不是有效的PDF格式（二次校验未通过）", 400);
    }

    const safe = origName.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(-100);
    const rbuf = new Uint8Array(4);
    crypto.getRandomValues(rbuf);
    let rh = "";
    for (const b of rbuf) rh += b.toString(16).padStart(2, "0");
    const key = "crm-docs/" + Date.now() + "_" + rh + "_" + safe;

    // slot 替换：旧值是 /api/files/<key> 才能定位删除；旧版存的纯文件名无 R2 对象，跳过
    if (slot) {
      const row = await env.DB.prepare(
        "SELECT " + slot + " AS v FROM crm_projects WHERE id=?"
      ).bind(pid).first();
      const oldV = row && row.v ? String(row.v) : "";
      const mo = /^\/api\/files\/(.+)$/.exec(oldV);
      if (mo) {
        try { await env.FILES.delete(decodeURIComponent(mo[1])); } catch (e) { /* 忽略 */ }
      }
    }

    await env.FILES.put(key, buf, {
      httpMetadata: { contentType: "application/pdf" },
    });
    return {
      body: { ok: true, filename: safe, url: "/api/files/" + key },
      status: 200,
    };
  }

  // ---- POST /api/crm-projects/<id>/failed  转失败项目 ----
  m = /^\/api\/crm-projects\/(\d+)\/failed$/.exec(pathname);
  if (m && request.method === "POST") {
    const pid = parseInt(m[1], 10);
    // 幂等：确保来源关联列存在（下方 vals 映射会写入 crm_origin_id）
    try { await env.DB.prepare("ALTER TABLE lost_projects ADD COLUMN crm_origin_id INTEGER DEFAULT 0").run(); } catch (e) { /* 已存在 */ }
    const exists = await env.DB.prepare("SELECT id FROM crm_projects WHERE id=?")
      .bind(pid)
      .first();
    if (!exists) return errj("not found", 404);
    if (!(await canModifyRow(env, "crm_projects", pid, username))) {
      return errj("forbidden", 403);
    }
    const gate = await permGate(env, username, "CRM-F1", String(pid));
    if (gate) return gate;

    const crm = await env.DB.prepare("SELECT * FROM crm_projects WHERE id=?")
      .bind(pid)
      .first();

    // 取 lost_projects 的列顺序，按列名一一映射
    const cols = await env.DB.prepare("PRAGMA table_info(lost_projects)").all();
    const lostCols = (cols.results || []).map((c) => c.name);

    let failReason = "";
    try {
      const d = await request.json();
      failReason = (d && d.fail_reason) || "";
    } catch (e) {
      failReason = "";
    }

    const today = new Date().toISOString().slice(0, 10);
    const vals = lostCols.map((col) => {
      if (col === "id" || col === "created_at" || col === "updated_at") return null;
      if (col === "crm_origin_id") return pid;
      if (col === "fail_reason") return failReason;
      if (col === "fail_date") return today;
      if (col === "status") return "failed";
      return crm[col] === undefined ? null : crm[col];
    });

    const ph = lostCols.map(() => "?").join(",");
    await env.DB.prepare(
      "INSERT INTO lost_projects (" + lostCols.join(",") + ") VALUES (" + ph + ")"
    )
      .bind(...vals)
      .run();

    await env.DB.prepare(
      "UPDATE crm_projects SET status='failed', updated_at=datetime('now','localtime') WHERE id=?"
    )
      .bind(pid)
      .run();

    return { body: { ok: true }, status: 200 };
  }

  return null; // 不是本模块的路由
}

// ============================================================
// 看板聚合统计（2026-09-06）：仅返回计数与三币汇总，避免前端全表扫描
// 金额取值规则复刻前端 _dashSum：优先 q1_<c>，为空则 equip_<c>
// ============================================================
function _amtSumSQL(primary, fallback) {
  return "SUM(CASE WHEN " + primary + " IS NULL THEN COALESCE(CAST(" + fallback + " AS REAL),0) ELSE CAST(" + primary + " AS REAL) END)";
}

export async function getCrmStats(env, username) {
  // 看板顶部统计卡受 DB-S1 数据范围控制，与 CRM-L1 列表独立
  const vs = await visibleScope(env, username, "DB-S1");
  let sql = "SELECT COUNT(*) AS cnt, " +
    _amtSumSQL("q1_rmb", "0") + " AS rmb, " +
    _amtSumSQL("q1_usd", "0") + " AS usd, " +
    _amtSumSQL("q1_vnd", "0") + " AS vnd " +
    " FROM crm_projects WHERE (status='active' OR status IS NULL OR status='') " +
    "AND lower(salesperson) <> 'agi-gs internal'";
  const params = [];
  if (vs.clause) { sql += " AND (" + vs.clause + ")"; vs.params.forEach((p) => params.push(p)); }
  const row = await env.DB.prepare(sql).bind(...params).first();
  return {
    count: (row && row.cnt) ? row.cnt : 0,
    rmb: Math.round((row && row.rmb) || 0),
    usd: Math.round((row && row.usd) || 0),
    vnd: Math.round((row && row.vnd) || 0),
  };
}
