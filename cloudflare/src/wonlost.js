// ⛔ FROZEN (2026-09-06) V2026.09.06.20：本文件逻辑已锁定，未经用户明确同意禁止修改。WON/LOST 后端逻辑均正确，仅数据可为演示数据。
// ============================================================
// 签约项目（WON）+ 失败项目（LOST）模块（M6）
// 复刻本地 app.py 逻辑，含 WON-P345 佣金字段服务端硬剥离
// ============================================================
import { migrateProvinceColumn, migrateBuColumn } from "./provinces.js";

// P3/P4/P5 佣金等敏感字段：隐藏时服务端直接剥离，客户端任何手段都拿不到
import { purgeWon, purgeLost, purgeCrm, extractKeysFromRow } from "./purge.js";

export const WON_P345_KEYS = [
  "gs_comm_pct", "gs_comm_rmb", "gs_comm_usd", "gs_comm_vnd",
  "gs_pay_count", "gs_paid_rmb", "gs_paid_usd", "gs_paid_vnd",
  "gs_unpaid_rmb", "gs_unpaid_usd", "gs_unpaid_vnd", "gs_remark",
  "agi_payable_rmb", "agi_payable_usd", "agi_payable_vnd",
  "agi_pay_count", "agi_paid_rmb", "agi_paid_usd", "agi_paid_vnd",
  "agi_unpaid_rmb", "agi_unpaid_usd", "agi_unpaid_vnd", "agi_remark",
  "doc_equip", "doc_install", "doc_both", "doc_addendum_cnt", "doc_remark",
];

// WON 业务字段（与 app.py 一致）
const WON_FIELDS = [
  "contract_no", "customer", "contract_date", "signing_parties", "contract_currency",
  "rate_rmb_vnd", "rate_usd_vnd", "incoterm", "include_install", "payment_terms", "salesperson",
  "equip_rmb", "equip_usd", "equip_vnd", "superv_rmb", "superv_usd", "superv_vnd",
  "fb_budget_rmb", "fb_budget_usd", "fb_budget_vnd", "fb_actual_rmb", "fb_actual_usd", "fb_actual_vnd",
  "cc_budget_rmb", "cc_budget_usd", "cc_budget_vnd", "cc_actual_rmb", "cc_actual_usd", "cc_actual_vnd",
  "total_equip_rmb", "total_equip_usd", "total_equip_vnd",
  "inst_budget_rmb", "inst_budget_usd", "inst_budget_vnd", "inst_actual_rmb", "inst_actual_usd", "inst_actual_vnd",
  "total_ei_rmb", "total_ei_usd", "total_ei_vnd",
  "vat_rmb", "vat_usd", "vat_vnd",
  "warranty_rmb", "warranty_usd", "warranty_vnd", "warranty_start", "warranty_end",
  "cust_pay_count", "cust_paid_rmb", "cust_paid_usd", "cust_paid_vnd",
  "cust_unpaid_rmb", "cust_unpaid_usd", "cust_unpaid_vnd", "cust_remark",
  "gs_comm_pct", "gs_comm_rmb", "gs_comm_usd", "gs_comm_vnd",
  "gs_pay_count", "gs_paid_rmb", "gs_paid_usd", "gs_paid_vnd",
  "gs_unpaid_rmb", "gs_unpaid_usd", "gs_unpaid_vnd", "gs_remark",
  "agi_payable_rmb", "agi_payable_usd", "agi_payable_vnd",
  "agi_pay_count", "agi_paid_rmb", "agi_paid_usd", "agi_paid_vnd",
  "agi_unpaid_rmb", "agi_unpaid_usd", "agi_unpaid_vnd", "agi_remark",
  "doc_equip", "doc_install", "doc_both", "doc_addendum_cnt", "doc_remark",
];

// 需要转整数的前缀，以及例外（这些虽匹配前缀但是文本/浮点）
const WON_NUM_PREFIX = ["equip_", "superv_", "fb_", "cc_", "inst_", "total_",
                        "cust_", "gs_", "agi_", "vat_", "doc_"];
const WON_NUM_EXCEPT = new Set(["cust_remark", "gs_remark", "gs_comm_pct",
                                 "agi_remark", "doc_remark", "doc_equip",
                                 "doc_install", "doc_both"]);

function isNumField(f) {
  if (WON_NUM_EXCEPT.has(f)) return false;
  return WON_NUM_PREFIX.some((p) => f.startsWith(p));
}

function num(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

// ============================================================
// ★ WON 省份（V40）：won_projects 已达 D1 单表 100 列上限无法加列，
//   省份存独立映射表 won_province_map(won_id PRIMARY KEY, province)。
//   WonList 读取时合并为 row.province，保存时 UPSERT 回映射表 —— 前端无感。
// ============================================================
const WON_PROV_FILL = [
  "Đồng Nai", "Tây Ninh", "Bắc Ninh", "Vĩnh Long", "Thái Nguyên",
  "An Giang", "Cần Thơ", "Quảng Ninh", "Đắk Lắk", "Thanh Hóa",
  "Khánh Hòa", "Gia Lai", "Lâm Đồng", "TP. Hồ Chí Minh", "Hà Nội",
  "Hải Phòng", "Đà Nẵng", "Nghệ An", "Hưng Yên", "Lạng Sơn",
];

async function ensureWonProvinceMap(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS won_province_map (won_id INTEGER PRIMARY KEY, province TEXT NOT NULL DEFAULT '')"
  ).run();
}

async function loadWonProvinceMap(env) {
  const rs = await env.DB.prepare("SELECT won_id, province FROM won_province_map").all();
  const m = {};
  for (const r of rs.results || []) m[r.won_id] = r.province || "";
  return m;
}

async function getWonProvince(env, wonId) {
  const r = await env.DB.prepare("SELECT province FROM won_province_map WHERE won_id=?")
    .bind(wonId).first();
  return (r && r.province) || "";
}

async function upsertWonProvince(env, wonId, province) {
  if (province === undefined) return;
  const v = String(province == null ? "" : province).trim();
  if (!v) return; // 空值不写映射，保留自动填充结果
  await env.DB.prepare(
    "INSERT INTO won_province_map (won_id, province) VALUES (?, ?) " +
    "ON CONFLICT(won_id) DO UPDATE SET province=excluded.province"
  ).bind(wonId, v).run();
}

// 自动填充：还没有省份映射的 WON 项目按列表循环分配（幂等，只补缺省行）
async function migrateWonProvinceFill(env) {
  const rs = await env.DB.prepare(
    "SELECT id FROM won_projects WHERE id NOT IN (SELECT won_id FROM won_province_map) ORDER BY id"
  ).all();
  const rows = rs.results || [];
  if (!rows.length) return 0;
  const stmts = rows.map((r, i) =>
    env.DB.prepare("INSERT INTO won_province_map (won_id, province) VALUES (?, ?)")
      .bind(r.id, WON_PROV_FILL[i % WON_PROV_FILL.length])
  );
  for (let i = 0; i < stmts.length; i += 90) {
    await env.DB.batch(stmts.slice(i, i + 90));
  }
  return stmts.length;
}

// JSON 字段：写库时序列化
const WON_JSON_FIELDS = ["attachments", "supp_summary", "cust_view_detail", "gs_view_detail"];
// 这两个是纯字符串（AGI 明细、补充协议），原样存储
const WON_TEXT_FIELDS = ["agi_view_detail", "doc_view_addendum"];

function errj(msg, status) {
  return { __err: msg, __status: status };
}

// ★ 三语备注：won_projects 已达 D1 单表 100 列上限，无法再加列；
//   改用 JSON 存入现有 cust_remark / gs_remark / agi_remark 三列。
//   读时拆包成 _zh/_en/_vi 子字段（前端收发不变），写时打包回 JSON。
const WON_RM_BASES = ["cust_remark", "gs_remark", "agi_remark"];
let _rmColsEnsured = false;
async function ensureRemarkCols(env) {
  // 无需 ALTER；旧单语数据在读时按 zh 兼容
  _rmColsEnsured = true;
}
function expandWonRemarks(row) {
  if (!row) return row;
  for (const b of WON_RM_BASES) {
    let obj = null;
    try { obj = row[b] ? JSON.parse(row[b]) : null; } catch (e) { obj = null; }
    if (obj && typeof obj === "object") {
      row[b + "_zh"] = obj.zh || "";
      row[b + "_en"] = obj.en || "";
      row[b + "_vi"] = obj.vi || "";
    } else {
      const old = (row[b] == null ? "" : String(row[b]));
      row[b + "_zh"] = old;
      row[b + "_en"] = "";
      row[b + "_vi"] = "";
    }
  }
  return row;
}
function packWonRemarks(data) {
  if (!data || typeof data !== "object") return data;
  for (const b of WON_RM_BASES) {
    const zh = data[b + "_zh"], en = data[b + "_en"], vi = data[b + "_vi"];
    if (zh !== undefined || en !== undefined || vi !== undefined) {
      data[b] = JSON.stringify({ zh: zh || "", en: en || "", vi: vi || "" });
    } else if (data[b] != null && data[b] !== "") {
      try { JSON.parse(String(data[b])); } catch (e) {
        data[b] = JSON.stringify({ zh: String(data[b]), en: "", vi: "" });
      }
    }
    delete data[b + "_zh"];
    delete data[b + "_en"];
    delete data[b + "_vi"];
  }
  return data;
}

// ★ 付款方式三语：云端 won_projects 已达 100 列上限，用 JSON 存进 payment_terms 列
function expandPaymentTerms(row) {
  if (!row) return row;
  let raw = (row.payment_terms == null ? "" : String(row.payment_terms));
  let obj = null;
  if (raw && raw.trim().startsWith("{")) {
    try { obj = JSON.parse(raw); } catch (e) { obj = null; }
  }
  if (obj && typeof obj === "object") {
    row.payment_terms_zh = obj.zh || "";
    row.payment_terms_en = obj.en || "";
    row.payment_terms_vi = obj.vi || "";
    // 兼容旧显示逻辑：payment_terms 保留原 JSON，前端显示优先取 _zh/_en/_i
  } else {
    const old = raw;
    row.payment_terms_zh = old;
    row.payment_terms_en = old;
    row.payment_terms_vi = old;
  }
  return row;
}
function packPaymentTerms(data) {
  if (!data || typeof data !== "object") return data;
  const zh = data.payment_terms_zh, en = data.payment_terms_en, vi = data.payment_terms_vi;
  if (zh !== undefined || en !== undefined || vi !== undefined) {
    data.payment_terms = JSON.stringify({ zh: zh || "", en: en || "", vi: vi || "" });
  } else if (data.payment_terms != null && data.payment_terms !== "") {
    try { JSON.parse(String(data.payment_terms)); } catch (e) {
      data.payment_terms = JSON.stringify({ zh: String(data.payment_terms), en: "", vi: "" });
    }
  }
  delete data.payment_terms_zh;
  delete data.payment_terms_en;
  delete data.payment_terms_vi;
  return data;
}

/** 复刻 _won_p345_hidden：P3/P4/P5 是否隐藏 */
async function wonP345Hidden(env, username) {
  if (!username) return false;
  const row = await env.DB.prepare("SELECT perms, position FROM users WHERE username=?")
    .bind(username)
    .first();
  if (!row) return false;
  let dec = "";
  try {
    const p = JSON.parse(row.perms || "{}");
    dec = String(((p && p["WON-P345"]) || {}).decision || "").trim().toLowerCase();
  } catch (e) {
    dec = "";
  }
  if (dec) return dec === "hide";
  const pos = String(row.position || "").trim();
  return ["销售", "销售总监", "观察者"].includes(pos);
}

/** 复刻 _strip_won_p345：剥离敏感字段 */
function stripWonP345(rows) {
  for (const d of rows) {
    for (const k of WON_P345_KEYS) delete d[k];
  }
  return rows;
}

// ============================================================
// 共用权限函数（与 crm.js 保持一致，此处独立实现避免循环依赖）
// ============================================================

async function isManager(env, username) {
  if (!username) return false;
  const m = await env.DB.prepare("SELECT 1 AS x FROM managers WHERE username=?")
    .bind(username).first();
  if (m) return true;
  const u = await env.DB.prepare("SELECT role FROM users WHERE username=?")
    .bind(username).first();
  return !!(u && u.role === "管理员");
}

async function hasFullCompany(env, username, blockId) {
  if (!username || !blockId) return false;
  const row = await env.DB.prepare("SELECT perms FROM users WHERE username=?")
    .bind(username).first();
  if (!row || !row.perms) return false;
  let p;
  try { p = JSON.parse(row.perms); } catch (e) { return false; }
  const blk = p && p[blockId];
  if (!blk || typeof blk !== "object") return false;
  // 与桌面 app.py 保持一致：decision 为 "all" 或 "company" 均表示“看全公司”
  const _dec = String(blk.decision || "").trim().toLowerCase();
  return _dec === "all" || _dec === "company";
}

async function visibleScope(env, username, blockId) {
  if (!username) return { clause: "", params: [] };
  const user = await env.DB.prepare(
    "SELECT id, vis_he_can_see FROM users WHERE username=?"
  ).bind(username).first();
  if (!user) return { clause: "", params: [] };
  if (await isManager(env, username)) return { clause: "", params: [] };
  if (await hasFullCompany(env, username, blockId)) return { clause: "", params: [] };

  const visible = [String(username).toLowerCase()];
  let vs = [];
  try { vs = user.vis_he_can_see ? JSON.parse(user.vis_he_can_see) : []; } catch (e) { vs = []; }
  const idList = [], nameList = [];
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
    ).bind(...idList).all();
    for (const r of rs.results || []) nameList.push(String(r.username).trim().toLowerCase());
  }
  for (const n of nameList) if (n && !visible.includes(n)) visible.push(n);

  try {
    const others = await env.DB.prepare(
      "SELECT username, vis_can_see_me FROM users WHERE username<>? " +
      "AND vis_can_see_me IS NOT NULL AND vis_can_see_me<>'' AND vis_can_see_me<>'[]'"
    ).bind(username).all();
    for (const r of others.results || []) {
      let arr = [];
      try { arr = r.vis_can_see_me ? JSON.parse(r.vis_can_see_me) : []; } catch (e) { arr = []; }
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
  } catch (e) { /* ignore */ }

  try {
    const del = await env.DB.prepare(
      "SELECT username FROM users WHERE delegate_to=? AND status<>'active' AND username<>?"
    ).bind(username, username).all();
    for (const d of del.results || []) visible.push(String(d.username).trim().toLowerCase());
  } catch (e) { /* ignore */ }

  const ph = visible.map(() => "?").join(",");
  // owner_user_id（录入人）或 salesperson（实际销售）任一命中可见集合即可见，
  // 这样正向/反向授权看某人数据时，其作为销售员的记录也能被正确纳入。
  const clause =
    "lower(owner_user_id) IN (" + ph + ") OR lower(salesperson) IN (" + ph + ")";
  return { clause, params: visible.concat(visible) };
}

async function ownsRow(env, table, pid, username) {
  if (!username) return true;
  if (await isManager(env, username)) return true;
  const row = await env.DB.prepare(
    "SELECT owner_user_id, salesperson FROM " + table + " WHERE id=?"
  ).bind(pid).first();
  if (!row) return false;
  const me = String(username).trim().toLowerCase();
  const owner = String(row.owner_user_id || "").trim().toLowerCase();
  if (owner) return owner === me;
  return String(row.salesperson || "").trim().toLowerCase() === me;
}

/**
 * ★ 写权限（数据范围语义，与权限标签一致，适用于 WON / LOST）：
 *    行归属者本人，或该行落在用户的可见数据范围内（blockId = WON-L1 / LOST-L1）即可写。
 *    实际放行仍受对应决策闸（permGate）控制：hide→403；approve→需已通过的单次审批；
 *    default/company→放行。
 *    （此前仅限"行归属者本人"，导致数据范围内他人行的按钮不显示/不执行，与标签矛盾）
 */
async function canModifyRow(env, table, pid, username, blockId) {
  if (!username) return true;
  if (await isManager(env, username)) return true;
  if (await ownsRow(env, table, pid, username)) return true;
  const vs = await visibleScope(env, username, blockId);
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

async function permGate(env, username, bid, targetId) {
  if (!username) return null;
  if (await isManager(env, username)) return null;
  const row = await env.DB.prepare("SELECT perms FROM users WHERE username=?")
    .bind(username).first();
  if (!row || !row.perms) return null;
  let dec = "";
  try {
    const p = JSON.parse(row.perms);
    dec = String(((p && p[bid]) || {}).decision || "").trim().toLowerCase();
  } catch (e) { return null; }
  if (!dec || dec === "default" || dec === "company") return null;
  if (dec === "hide") return { __err: "forbidden_hidden", __msg: "无权限：该模块已被隐藏", __status: 403 };
  if (dec === "approve") {
    const tid = String(targetId == null ? "" : targetId);
    const g = await env.DB.prepare(
      "SELECT id FROM approval_requests WHERE requester=? AND block_id=? AND target_id=? " +
      "AND status='approved' AND persist='single-use' AND COALESCE(consumed,0)=0 " +
      "ORDER BY id DESC LIMIT 1"
    ).bind(username, bid, tid).first();
    if (!g) return { __err: "approval_required", __msg: "该操作需审批人通过后才能执行", __status: 403 };
    await env.DB.prepare("UPDATE approval_requests SET consumed=1 WHERE id=?").bind(g.id).run();
    return null;
  }
  return null;
}

// ============================================================
/** 定位一条 LOST 记录的来源 CRM（status='failed' 僵尸记录）：
 *  优先用 crm_origin_id（新数据，CRM 转失败时写入）；
 *  旧数据退化为共享 pdf key 反查；无附件的老 LOST 无法定位，返回 0（不误删）。 */
async function findOriginCrmId(env, lostRow) {
  const oid = Number((lostRow && lostRow.crm_origin_id) || 0);
  if (oid) {
    const c = await env.DB.prepare("SELECT status FROM crm_projects WHERE id=?").bind(oid).first();
    return (c && c.status === "failed") ? oid : 0;
  }
  try {
    const keys = extractKeysFromRow("lost_projects", lostRow);
    if (!keys.length) return 0;
    const cond = keys.map(() => "pdf_equip=? OR pdf_install=? OR pdf_both=?").join(" OR ");
    const binds = [];
    for (const k of keys) binds.push(k, k, k);
    const rs = await env.DB.prepare(
      "SELECT id FROM crm_projects WHERE status='failed' AND (" + cond + ") LIMIT 1"
    ).bind(...binds).first();
    return rs ? Number(rs.id) : 0;
  } catch (e) { return 0; }
}

// 主路由
// ============================================================

export async function handleWonLost(request, env, url, pathname) {
  const username = (
    request.headers.get("X-User-Name") || url.searchParams.get("me") || ""
  ).trim();

  try { await ensureRemarkCols(env); } catch (e) { return errj("数据库迁移失败: " + (e && e.message || e), 500); }
  // ★ WON 省份映射表（V40）：建表 + 自动填充缺省省份（幂等，不阻塞请求）
  try { await ensureWonProvinceMap(env); } catch (e) { /* 不阻塞请求 */ }
  try { await migrateWonProvinceFill(env); } catch (e) { /* 不阻塞请求 */ }
  // ★ 省份归一化迁移（幂等）：lost_projects 的英文/中文变体 → 标准名
  //   无匹配省份默认：LOST → 清化省（用户指定 V28）。won_projects 无 province 列
  //   （100 列上限，省份走 won_province_map 映射表，见 V40），不再调用迁移。
  try {
    await env.DB.prepare("UPDATE lost_projects SET province='Thanh Hóa' WHERE province='Tây Ninh'").run();
  } catch (e) { /* 不阻塞请求 */ }
  try { await migrateProvinceColumn(env, "lost_projects", "Thanh Hóa"); } catch (e) { /* 不阻塞请求 */ }
  // ★ BU 归一化迁移：假数据 BU-X → 随机四场（蛋鸡/猪/肉鸡/蛋鸭）
  try { await migrateBuColumn(env, "lost_projects"); } catch (e) { /* 不阻塞请求 */ }
  // ★ CRM→LOST 来源关联列（幂等）：删 LOST / 转回 CRM 时据此清理来源 CRM 的 failed 僵尸记录
  try { await env.DB.prepare("ALTER TABLE lost_projects ADD COLUMN crm_origin_id INTEGER DEFAULT 0").run(); } catch (e) { /* 已存在 */ }

  // ================= WON 签约项目 =================

  // GET /api/won-projects
  if (pathname === "/api/won-projects" && request.method === "GET") {
    const vs = await visibleScope(env, username, "WON-L1");
    let sql = "SELECT * FROM won_projects WHERE lower(salesperson) <> 'agi-gs internal'";
    const params = [];
    if (vs.clause) {
      sql += " AND (" + vs.clause + ")";
      vs.params.forEach((p) => params.push(p));
    }
    sql += " ORDER BY id DESC";
    const rs = await env.DB.prepare(sql).bind(...params).all();
    const out = rs.results || [];
    // V40：合并省份映射（won_projects 表无 province 列）
    try {
      const pm = await loadWonProvinceMap(env);
      out.forEach((r) => { r.province = pm[r.id] || ""; });
    } catch (e) { /* 映射表异常不阻塞列表 */ }
    if (await wonP345Hidden(env, username)) stripWonP345(out);
    out.forEach(expandWonRemarks);
    out.forEach(expandPaymentTerms);
    return { body: out, status: 200 };
  }

  // POST /api/won-projects
  if (pathname === "/api/won-projects" && request.method === "POST") {
    // ★ 服务端权限闸（与 LOST 对齐）：新增签约项目受 WON-N1 决策控制
    const gN1 = await permGate(env, username, "WON-N1", "");
    if (gN1) return errj(gN1.__msg, gN1.__status || 403);
    let data;
    try { data = await request.json(); } catch (e) { return errj("请求格式错误", 400); }
    packWonRemarks(data);  // 三语备注：_zh/_en/_vi 打包为 JSON 存入 base 列
    packPaymentTerms(data);  // 付款方式三语打包为 JSON 存入 payment_terms 列

    const cols = [], vals = [];
    for (const f of WON_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(data, f)) {
        cols.push(f);
        vals.push(isNumField(f) ? num(data[f]) : data[f]);
      }
    }
    for (const f of WON_JSON_FIELDS) {
      cols.push(f);
      vals.push(JSON.stringify(data[f] || []));
    }
    cols.push("owner_user_id");
    vals.push(String(username).toLowerCase());
    for (const k of WON_TEXT_FIELDS) {
      if (data[k] != null) { cols.push(k); vals.push(data[k]); }
    }

    const ph = cols.map(() => "?").join(",");
    const ins = await env.DB.prepare(
      "INSERT INTO won_projects (" + cols.join(",") + ") VALUES (" + ph + ")"
    ).bind(...vals).run();
    const newId = ins.meta && ins.meta.last_row_id;
    await env.DB.prepare(
      "UPDATE won_projects SET updated_at=datetime('now','localtime') WHERE id=?"
    ).bind(newId).run();
    // V40：保存省份映射
    try { await upsertWonProvince(env, newId, data.province); } catch (e) { /* 不阻塞 */ }
    const row = await env.DB.prepare("SELECT * FROM won_projects WHERE id=?")
      .bind(newId).first();
    try { row.province = await getWonProvince(env, newId); } catch (e) { row.province = ""; }
    expandWonRemarks(row);
    expandPaymentTerms(row);
    if (await wonP345Hidden(env, username)) stripWonP345([row]);
    return { body: row, status: 201 };
  }

  // ---- POST /api/won-projects/<id>/documents  设备/安装合同 PDF 上传（V45）----
  // 存 R2（key 前缀 won-docs/），slot=doc_equip/doc_install；替换时删除旧文件；返回 {filename, url}
  // DB 更新由前端保存表单时一并提交（与 CRM 报价 PDF 同机制）。
  const wm = /^\/api\/won-projects\/(\d+)\/documents$/.exec(pathname);
  if (wm && request.method === "POST") {
    const wpid = parseInt(wm[1], 10);
    let f = null, slot = "", oldfile = "";
    try {
      const form = await request.formData();
      const got = form.get("file");
      if (got && typeof got !== "string") f = got;
      const s = form.get("slot");
      if (s && typeof s === "string") slot = s;
      const of = form.get("oldfile");
      if (of && typeof of === "string") oldfile = of;
    } catch (e) { f = null; }
    if (!f) return errj("no file", 400);
    const origName = String(f.name || "");
    if (!/\.pdf$/i.test(origName)) return errj("所选文件不是PDF格式", 400);
    // ★ V 补充协议附件：doc_addendum（每协议行独立文件，旧文件由前端以 oldfile 传入）
    const ADD_SLOTS = ["doc_equip", "doc_install", "doc_addendum"];
    if (!ADD_SLOTS.includes(slot)) {
      return errj("invalid slot", 400);
    }
    const wExists = await env.DB.prepare("SELECT id FROM won_projects WHERE id=?").bind(wpid).first();
    if (!wExists) return errj("not found", 404);
    const wbuf = await f.arrayBuffer();
    // ★ 二次校验（与前端同标准）：按 Adobe 规范在前 1024 字节内查找 %PDF- 魔数，
    //   容忍头部杂字节但绝不放过伪装文件
    const wArr = new Uint8Array(wbuf.slice(0, 1024 + 5));
    let wFound = -1;
    for (let wi = 0; wi + 5 <= wArr.length && wi < 1024; wi++) {
      if (wArr[wi] === 0x25 && wArr[wi+1] === 0x50 && wArr[wi+2] === 0x44 && wArr[wi+3] === 0x46 && wArr[wi+4] === 0x2D) { wFound = wi; break; }
    }
    if (wFound < 0) {
      return errj("文件不是有效的PDF格式（二次校验未通过）", 400);
    }
    const wSafe = origName.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(-100);
    const wRbuf = new Uint8Array(4);
    crypto.getRandomValues(wRbuf);
    let wRh = "";
    for (const b of wRbuf) wRh += b.toString(16).padStart(2, "0");
    const wKey = (slot === "doc_addendum" ? "won-docs/addm/" : "won-docs/") + Date.now() + "_" + wRh + "_" + wSafe;
    if (slot === "doc_addendum") {
      // 补充协议：每行独立文件，旧文件由前端以 oldfile 传入（覆盖=旧版立即删除）
      if (oldfile) {
        try { await env.FILES.delete("won-docs/addm/" + oldfile); } catch (e) { /* 忽略 */ }
      }
    } else {
      // slot 替换：删被替换的旧 R2 对象
      const wOldRow = await env.DB.prepare(
        "SELECT " + slot + " AS v FROM won_projects WHERE id=?"
      ).bind(wpid).first();
      const wOldV = wOldRow && wOldRow.v ? String(wOldRow.v) : "";
      const wMo = /^\/api\/files\/(.+)$/.exec(wOldV);
      if (wMo) {
        try { await env.FILES.delete(decodeURIComponent(wMo[1])); } catch (e) { /* 忽略 */ }
      }
    }
    await env.FILES.put(wKey, wbuf, { httpMetadata: { contentType: "application/pdf" } });
    return { body: { ok: true, filename: wSafe, url: "/api/files/" + wKey }, status: 200 };
  }

  // /api/won-projects/<id>
  let m = /^\/api\/won-projects\/(\d+)$/.exec(pathname);
  if (m) {
    const pid = parseInt(m[1], 10);

    if (request.method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM won_projects WHERE id=?")
        .bind(pid).first();
      if (!row) return errj("not found", 404);
      const d = Object.assign({}, row);
      try { d.province = await getWonProvince(env, pid); } catch (e) { d.province = ""; }
      if (await wonP345Hidden(env, username)) stripWonP345([d]);
      expandWonRemarks(d);
      expandPaymentTerms(d);
      return { body: d, status: 200 };
    }

    if (request.method === "PUT") {
      const ex = await env.DB.prepare("SELECT id FROM won_projects WHERE id=?")
        .bind(pid).first();
      if (!ex) return errj("not found", 404);
      if (!(await canModifyRow(env, "won_projects", pid, username, "WON-L1"))) return errj("forbidden", 403);
      // ★ 服务端权限闸：编辑签约项目受 WON-D2 决策控制（hide=403；approve=需已通过的单次审批）
      const gD2 = await permGate(env, username, "WON-D2", String(pid));
      if (gD2) return errj(gD2.__msg, gD2.__status || 403);

      let data;
      try { data = await request.json(); } catch (e) { return errj("请求格式错误", 400); }
      packWonRemarks(data);  // 三语备注：_zh/_en/_vi 打包为 JSON 存入 base 列
      packPaymentTerms(data);  // 付款方式三语打包为 JSON 存入 payment_terms 列
      const sets = [], vals = [];
      for (const f of WON_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(data, f)) {
          sets.push(f + "=?");
          vals.push(isNumField(f) ? num(data[f]) : data[f]);
        }
      }
      for (const f of WON_JSON_FIELDS.concat(WON_TEXT_FIELDS)) {
        if (Object.prototype.hasOwnProperty.call(data, f)) {
          sets.push(f + "=?");
          vals.push(
            WON_JSON_FIELDS.includes(f)
              ? (typeof data[f] === "string" ? data[f] : JSON.stringify(data[f] || []))
              : (data[f] || "")
          );
        }
      }
      if (sets.length) {
        sets.push("updated_at=datetime('now','localtime')");
        vals.push(pid);
        await env.DB.prepare(
          "UPDATE won_projects SET " + sets.join(", ") + " WHERE id=?"
        ).bind(...vals).run();
      }
      // V40：更新省份映射（data.province 存在时才写，避免旧客户端误清）
      try { await upsertWonProvince(env, pid, data.province); } catch (e) { /* 不阻塞 */ }
      const row = await env.DB.prepare("SELECT * FROM won_projects WHERE id=?")
        .bind(pid).first();
      try { row.province = await getWonProvince(env, pid); } catch (e) { row.province = ""; }
      expandWonRemarks(row);
      expandPaymentTerms(row);
      if (await wonP345Hidden(env, username)) stripWonP345([row]);
      return { body: row, status: 200 };
    }

    if (request.method === "DELETE") {
      const ex = await env.DB.prepare("SELECT id FROM won_projects WHERE id=?")
        .bind(pid).first();
      if (!ex) return errj("not found", 404);
      if (!(await canModifyRow(env, "won_projects", pid, username, "WON-L1"))) return errj("forbidden", 403);
      // ★ 服务端权限闸：删除签约项目受 WON-D3 决策控制（approve=消耗对应的单次审批）
      const gD3 = await permGate(env, username, "WON-D3", String(pid));
      if (gD3) return errj(gD3.__msg, gD3.__status || 403);
      // 彻底删除：R2 附件(won/) + 审批单(WON-*) + 佣金记录 → 主记录
      const rep = await purgeWon(env, pid);
      // V40：顺带清理省份映射
      try { await env.DB.prepare("DELETE FROM won_province_map WHERE won_id=?").bind(pid).run(); } catch (e) { /* 不阻塞 */ }
      return { body: { ok: true, purge: rep }, status: 200 };
    }
  }

  // PUT /api/won-projects/<id>/supp-summary
  m = /^\/api\/won-projects\/(\d+)\/supp-summary$/.exec(pathname);
  if (m && request.method === "PUT") {
    const pid = parseInt(m[1], 10);
    let data;
    try { data = await request.json(); } catch (e) { return errj("请求格式错误", 400); }
    const val = data && data.supp_summary !== undefined
      ? data.supp_summary
      : data;
    await env.DB.prepare(
      "UPDATE won_projects SET supp_summary=?, updated_at=datetime('now','localtime') WHERE id=?"
    ).bind(JSON.stringify(val || []), pid).run();
    return { body: { ok: true }, status: 200 };
  }

  // ================= LOST 失败项目 =================

  // GET /api/lost-projects
  if (pathname === "/api/lost-projects" && request.method === "GET") {
    const vs = await visibleScope(env, username, "LOST-L1");
    let sql = "SELECT * FROM lost_projects WHERE lower(salesperson) <> 'agi-gs internal'";
    const params = [];
    if (vs.clause) {
      sql += " AND (" + vs.clause + ")";
      vs.params.forEach((p) => params.push(p));
    }
    sql += " ORDER BY id ASC";
    const rs = await env.DB.prepare(sql).bind(...params).all();
    return { body: rs.results || [], status: 200 };
  }

  // POST /api/lost-projects
  if (pathname === "/api/lost-projects" && request.method === "POST") {
    let data;
    try { data = await request.json(); } catch (e) { return errj("请求格式错误", 400); }
    const gate = await permGate(env, username, "LOST-D2", "");
    if (gate) return gate;

    const cols = [], vals = [];
    for (const f of CRM_AND_LOST_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(data, f)) {
        cols.push(f);
        vals.push(CRM_NUM.has(f) ? num(data[f]) : data[f]);
      }
    }
    cols.push("owner_user_id");
    vals.push(String(username).toLowerCase());
    const ph = cols.map(() => "?").join(",");
    const ins = await env.DB.prepare(
      "INSERT INTO lost_projects (" + cols.join(",") + ") VALUES (" + ph + ")"
    ).bind(...vals).run();
    const newId = ins.meta && ins.meta.last_row_id;
    const row = await env.DB.prepare("SELECT * FROM lost_projects WHERE id=?")
      .bind(newId).first();
    return { body: row, status: 201 };
  }

  // /api/lost-projects/<id>
  m = /^\/api\/lost-projects\/(\d+)$/.exec(pathname);
  if (m) {
    const pid = parseInt(m[1], 10);

    if (request.method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM lost_projects WHERE id=?")
        .bind(pid).first();
      if (!row) return errj("not found", 404);
      return { body: row, status: 200 };
    }

    if (request.method === "PUT") {
      const ex = await env.DB.prepare("SELECT id FROM lost_projects WHERE id=?")
        .bind(pid).first();
      if (!ex) return errj("not found", 404);
      if (!(await ownsRow(env, "lost_projects", pid, username))) return errj("forbidden", 403);
      const gate = await permGate(env, username, "LOST-D2", String(pid));
      if (gate) return gate;

      let data;
      try { data = await request.json(); } catch (e) { return errj("请求格式错误", 400); }
      const sets = [], vals = [];
      for (const f of CRM_AND_LOST_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(data, f)) {
          sets.push(f + "=?");
          vals.push(CRM_NUM.has(f) ? num(data[f]) : data[f]);
        }
      }
      if (sets.length) {
        sets.push("updated_at=datetime('now','localtime')");
        vals.push(pid);
        await env.DB.prepare(
          "UPDATE lost_projects SET " + sets.join(", ") + " WHERE id=?"
        ).bind(...vals).run();
      }
      const row = await env.DB.prepare("SELECT * FROM lost_projects WHERE id=?")
        .bind(pid).first();
      return { body: row, status: 200 };
    }

    if (request.method === "DELETE") {
      const ex = await env.DB.prepare("SELECT id FROM lost_projects WHERE id=?")
        .bind(pid).first();
      if (!ex) return errj("not found", 404);
      if (!(await ownsRow(env, "lost_projects", pid, username))) return errj("forbidden", 403);
      const gate = await permGate(env, username, "LOST-D3", String(pid));
      if (gate) return gate;
      // 彻底删除：来源 CRM(failed 僵尸记录) + 附件 + 审批单(LOST-*) → 主记录
      // ★ 用户规则：LOST 100% 由 CRM 转来，删 LOST 时来源 CRM 一并删除——
      //   先删 CRM（此刻 LOST 仍引用附件 → 文件保留），再删 LOST 本体
      //   （附件失去全部引用 → R2 文件引用计数删除）。
      try {
        const lrow = await env.DB.prepare("SELECT * FROM lost_projects WHERE id=?")
          .bind(pid).first();
        const oid = lrow ? await findOriginCrmId(env, lrow) : 0;
        if (oid) await purgeCrm(env, oid);
      } catch (e) { /* 来源清理失败不阻塞主删除 */ }
      const rep = await purgeLost(env, pid);
      return { body: { ok: true, purge: rep }, status: 200 };
    }
  }

  // POST /api/lost-projects/<id>/restore  转回潜在项目
  m = /^\/api\/lost-projects\/(\d+)\/restore$/.exec(pathname);
  if (m && request.method === "POST") {
    const pid = parseInt(m[1], 10);
    const row = await env.DB.prepare("SELECT * FROM lost_projects WHERE id=?")
      .bind(pid).first();
    if (!row) return errj("not found", 404);
    if (!(await ownsRow(env, "lost_projects", pid, username))) return errj("forbidden", 403);
    const gate = await permGate(env, username, "LOST-R1", String(pid));
    if (gate) return gate;

    // 按 CRM 字段顺序回写
    const cols = CRM_LIST.slice();
    const vals = cols.map((c) => (CRM_NUM.has(c) ? num(row[c]) : (row[c] === undefined ? "" : row[c])));
    cols.push("status");
    vals.push("active");
    cols.push("owner_user_id");
    // ★ 归属人随流转保留：LOST 行的 owner 来自当初 CRM 转失败时保留的归属，
    //   转回潜在必须延续同一归属人，不得改写为当前操作人，否则三模块数据授权链在 LOST→CRM 处断裂。
    vals.push((row.owner_user_id && String(row.owner_user_id).trim() !== "")
      ? String(row.owner_user_id).toLowerCase()
      : String(username).toLowerCase());

    const ph = cols.map(() => "?").join(",");
    await env.DB.prepare(
      "INSERT INTO crm_projects (" + cols.join(",") + ") VALUES (" + ph + ")"
    ).bind(...vals).run();
    // ★ 转回时清掉来源 CRM 的 failed 僵尸记录（历史漏洞：它从未被清理，会留下重复项目）。
    //   此刻新 CRM 已插入并引用同一批附件 → purgeCrm 只删记录、附件保留，无死链风险。
    try {
      const oid = await findOriginCrmId(env, row);
      if (oid) await purgeCrm(env, oid);
    } catch (e) { /* 旧记录清理失败不阻塞转回 */ }
    await env.DB.prepare("DELETE FROM lost_projects WHERE id=?").bind(pid).run();
    return { body: { ok: true }, status: 200 };
  }

  return null;
}

// LOST 用 CRM 字段 + 失败原因
const CRM_LIST = [
  "quote_no", "project_name", "province", "customer", "bu", "construction",
  "startup_pct", "sign_pct", "manager", "manager_phone", "company_info",
  "initial_quote_date", "est_purchase_date", "est_ship_date", "quote_version",
  "last_quote_date", "rate_rmb_vnd", "rate_usd_vnd", "incoterm",
  "install_quoted", "salesperson", "remark", "pdf_equip", "pdf_install", "pdf_both",
  "q1_rmb", "q1_usd", "q1_vnd", "q2_rmb", "q2_usd", "q2_vnd",
  "q3_rmb", "q3_usd", "q3_vnd", "q4_rmb", "q4_usd", "q4_vnd",
  "q5_rmb", "q5_usd", "q5_vnd", "q6_rmb", "q6_usd", "q6_vnd",
  "q7_rmb", "q7_usd", "q7_vnd",
];
const CRM_NUM = new Set([
  "q1_rmb", "q1_usd", "q1_vnd", "q2_rmb", "q2_usd", "q2_vnd",
  "q3_rmb", "q3_usd", "q3_vnd", "q4_rmb", "q4_usd", "q4_vnd",
  "q5_rmb", "q5_usd", "q5_vnd", "q6_rmb", "q6_usd", "q6_vnd",
  "q7_rmb", "q7_usd", "q7_vnd",
]);
const CRM_AND_LOST_FIELDS = CRM_LIST.concat(["fail_reason", "fail_date"]);

// ============================================================
// 看板聚合统计（2026-09-06）：仅返回计数与三币汇总，避免前端全表扫描
// WON 金额规则复刻前端 _dashWonSum：优先 total_ei_<c>，为空则 equip_<c>
// LOST 金额规则复刻前端 _dashSum：优先 q1_<c>，为空则 equip_<c>
// ============================================================
function _amtSumSQL(primary, fallback) {
  return "SUM(CASE WHEN " + primary + " IS NULL THEN COALESCE(CAST(" + fallback + " AS REAL),0) ELSE CAST(" + primary + " AS REAL) END)";
}

export async function getWonStats(env, username) {
  // 看板顶部统计卡受 DB-S1 数据范围控制，与 WON-L1 列表独立
  const vs = await visibleScope(env, username, "DB-S1");
  let sql = "SELECT COUNT(*) AS cnt, " +
    _amtSumSQL("total_ei_rmb", "equip_rmb") + " AS rmb, " +
    _amtSumSQL("total_ei_usd", "equip_usd") + " AS usd, " +
    _amtSumSQL("total_ei_vnd", "equip_vnd") + " AS vnd FROM won_projects " +
    "WHERE lower(salesperson) <> 'agi-gs internal'";
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

export async function getLostStats(env, username) {
  // 看板顶部统计卡受 DB-S1 数据范围控制，与 LOST-L1 列表独立
  const vs = await visibleScope(env, username, "DB-S1");
  let sql = "SELECT COUNT(*) AS cnt, " +
    _amtSumSQL("q1_rmb", "0") + " AS rmb, " +
    _amtSumSQL("q1_usd", "0") + " AS usd, " +
    _amtSumSQL("q1_vnd", "0") + " AS vnd FROM lost_projects " +
    "WHERE lower(salesperson) <> 'agi-gs internal'";
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
