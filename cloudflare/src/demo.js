// ============================================================
// DEMO 演示数据模块（v2：与用户名录彻底解耦）
//
// ★ 铁律（用户明确要求）：
//   DEMO 的加载/清空【只操作 4 张业务表】
//   （crm_projects / lost_projects / won_projects / approval_requests），
//   绝不增删改 users / managers 表 —— 不管真实账号还是曾经的"演示账号"，
//   系统里的全部用户一律视为正式用户，一个不拉。
//   删用户只能走「用户与授权」页的删除审批流程。
//
// 还原数据来源：R2 里的 demo_snapshot.json（只读取其中的业务表，
//   快照里即使带有 users 表也一律忽略，绝不写回）。
//
// ★ 固化（freeze）：POST /api/demo/freeze（tom 专属，vault PIN token 鉴权）
//   把 D1 当前 CRM/LOST/WON/审批 四张业务表的案例数据整批写入 R2 快照，
//   替换快照中对应四段（不再"原样保留"旧 WON/审批，改为快照当前 live 数据），
//   并把四表全部行打 is_demo=1 —— 此后「加载 DEMO」灌回的就是这批案例数据。
//   WON 省份在独立映射表 won_province_map（按 won_id），因还原时 won 会重新自增 id，
//   故省份按 contract_no 记录进 snap.won_province_map，loadDemo 还原后再回填。
// ============================================================

import { authOk } from "./vault.js";

// 业务表（会被清空/还原）
const DEMO_TABLES = ["crm_projects", "lost_projects", "won_projects", "approval_requests"];

function errj(msg, status, detail) {
  const o = { __err: msg, __status: status };
  if (detail) o.__msg = detail;
  return o;
}

/** 清空：仅清 4 张业务表中的【演示行】（is_demo=1）；真实录入的数据（is_demo=0）一律保留；
 *  用户/管理员表一个字都不碰 */
async function clearDemo(env) {
  const removed = {};

  // 先清掉「将被删除的演示 WON」对应的省份映射（孤儿行清理；真实 WON 不受影响）
  try {
    await env.DB.prepare(
      "DELETE FROM won_province_map WHERE won_id IN (SELECT id FROM won_projects WHERE is_demo=1)"
    ).run();
  } catch (e) { /* 表不存在或不兼容不阻塞 */ }

  for (const t of DEMO_TABLES) {
    try {
      const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM " + t + " WHERE is_demo=1").first();
      removed[t] = r ? r.n : 0;
      await env.DB.prepare("DELETE FROM " + t + " WHERE is_demo=1").run();
    } catch (e) {
      removed[t] = "失败: " + e;
    }
  }

  // ★ 用户/管理员表完全不碰（DEMO 与用户名录彻底解耦）
  removed.demo_users = 0;
  removed.demo_managers = 0;

  return removed;
}

/** 还原：仅还原 4 张业务表；快照里的 users 段一律忽略 */
async function loadDemo(env) {
  const obj = await env.FILES.get("demo_snapshot.json");
  if (!obj) {
    return errj("快照文件不存在",
      500, "云端未上传 demo_snapshot.json，无法还原演示数据");
  }

  let snap;
  try {
    snap = JSON.parse(await obj.text());
  } catch (e) {
    return errj("快照解析失败", 500, String(e));
  }

  // 先清空（只清业务表）
  const removed = await clearDemo(env);
  const restored = {};

  const tables = snap.tables || {};

  // 逐表逐行还原业务数据。
  // 必须按【每行自己的字段】构建 SQL：快照里原有行带 id，新增行不带 id（靠自增），
  // 若统一用第一行的列插入，新增行的 id 会被绑成 NULL 而互相覆盖。
  for (const t of Object.keys(tables)) {
    if (!DEMO_TABLES.includes(t)) continue;   // ★ 只还原业务表，users 等一律跳过
    const rows = tables[t] || [];
    if (!rows.length) { restored[t] = 0; continue; }

    let ok = 0;
    let skipped = 0;
    for (const row of rows) {
      // 去掉 id：避免 INSERT 覆盖真实行（真实行用自增 id，互不冲突）；
      // 末尾追加 is_demo=1 标记，供「清空 DEMO」精确删除、不误伤真实数据。
      const cols = Object.keys(row).filter((c) => c !== "id");
      cols.push("is_demo");
      if (!cols.length) { skipped++; continue; }
      const ph = cols.map(() => "?").join(",");
      const stmt = "INSERT OR REPLACE INTO " + t +
                   " (" + cols.join(",") + ") VALUES (" + ph + ")";
      const vals = cols.map((c) => (c === "is_demo" ? 1 : row[c]));
      try {
        await env.DB.prepare(stmt).bind(...vals).run();
        ok++;
      } catch (e) {
        skipped++;   // 单行失败不影响其余
      }
    }
    restored[t] = ok;
    if (skipped) restored[t + "_skipped"] = skipped;
  }

  // ★ 用户/管理员表完全不碰
  restored.demo_users = 0;
  restored.demo_managers = 0;

  // WON 省份回填：按 contract_no 把快照省份映射到刚还原（is_demo=1）的 won 新 id
  if (Array.isArray(snap.won_province_map) && snap.won_province_map.length) {
    try {
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS won_province_map (won_id INTEGER PRIMARY KEY, province TEXT NOT NULL DEFAULT '')"
      ).run();
      const rs = await env.DB.prepare("SELECT id, contract_no FROM won_projects WHERE is_demo=1").all();
      const idByCn = {};
      for (const r of (rs.results || [])) idByCn[r.contract_no] = r.id;
      let n = 0;
      for (const pm of snap.won_province_map) {
        const nid = idByCn[pm.contract_no];
        if (!nid || !pm.province) continue;
        await env.DB.prepare(
          "INSERT INTO won_province_map (won_id, province) VALUES (?, ?) " +
          "ON CONFLICT(won_id) DO UPDATE SET province=excluded.province"
        ).bind(nid, pm.province).run();
        n++;
      }
      restored.won_province_map = n;
    } catch (e) { restored.won_province_map_err = String((e && e.message) || e); }
  }

  return {
    body: { ok: true, removed, restored, mode: "business_only" },
    status: 200,
  };
}

export async function handleDemo(request, env, url, pathname) {
  if (pathname === "/api/demo/load" && request.method === "POST") {
    return await loadDemo(env);
  }

  if (pathname === "/api/demo/clear" && request.method === "POST") {
    const removed = await clearDemo(env);
    return { body: { ok: true, removed }, status: 200 };
  }

  return null;
}

export { DEMO_TABLES };

/** 固化：把 D1 当前 CRM/LOST 案例数据写入 R2 快照（tom 专属，vault PIN 鉴权）。
 *
 *  1. 校验 vault token（X-Vault-Token 头 或 ?vt= 参数）
 *  2. 备份 R2 现有快照为 demo_snapshot.json.bak-<时间戳>
 *  3. SELECT * 读 crm_projects / lost_projects 全部行（去 id / is_demo 两列）
 *  4. 替换快照 tables.crm_projects / tables.lost_projects 两段；
 *     won_projects / approval_requests 段【原样保留】（WON 用户还在编辑中）
 *  5. UPDATE 两表 SET is_demo=1（案例数据=演示数据，「加载 DEMO」先清 is_demo=1
 *     再灌快照 → 结果恒等于固化样本，绝不与残留行重复）
 *  6. 写回 R2 demo_snapshot.json（contentType: application/json）
 */
export async function freezeDemo(request, env, url) {
  if (!(await authOk(request, env, url))) {
    return { ok: false, error: "vault token 无效或已过期" };
  }

  const key = "demo_snapshot.json";
  let snap = null;
  let oldText = "";
  try {
    const oldObj = await env.FILES.get(key);
    if (oldObj) {
      oldText = await oldObj.text();
      try { snap = JSON.parse(oldText); } catch (e) { snap = null; }
    }
  } catch (e) { /* 读旧快照失败按无快照处理 */ }
  if (!snap || typeof snap !== "object") {
    snap = { _meta: { note: "AGI-PM 演示数据快照" }, tables: {}, demo_users: [], demo_managers: [] };
  }
  if (!snap.tables || typeof snap.tables !== "object") snap.tables = {};

  // 备份旧快照（R2 内同名 + 时间戳后缀），固化操作可回滚
  if (oldText) {
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    try {
      await env.FILES.put(key + ".bak-" + ts, oldText,
        { httpMetadata: { contentType: "application/json" } });
    } catch (e) { /* 备份失败不阻断固化 */ }
  }

  const FREEZE_TABLES = ["crm_projects", "lost_projects", "won_projects", "approval_requests"];
  const counts = {};
  const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const t of FREEZE_TABLES) {
    let rows = [];
    try {
      const r = await env.DB.prepare("SELECT * FROM " + t).all();
      rows = (r && r.results) || [];
    } catch (e) {
      return { ok: false, error: "读取 " + t + " 失败: " + String((e && e.message) || e) };
    }
    // 去 id（还原时自增）/ 去 is_demo（loadDemo 灌回时统一强制 1，避免列重复导致整行插入失败）
    const clean = [];
    for (const row of rows) {
      const o = {};
      for (const k of Object.keys(row)) {
        if (k === "id" || k === "is_demo") continue;
        o[k] = row[k];
      }
      clean.push(o);
    }
    snap.tables[t] = clean;
    counts[t] = clean.length;
    // 打标：当前全部案例行 = 演示数据（「清空 DEMO」可整体清场，「加载 DEMO」整批还原）
    try {
      await env.DB.prepare("UPDATE " + t + " SET is_demo=1").run();
    } catch (e) { /* 打标失败不阻断固化 */ }
  }

  // WON 省份：省份在独立映射表 won_province_map（按 won_id），还原时 won 会重新自增 id，
  // 故快照按 contract_no 记录省份，loadDemo 还原后再按 contract_no 回填映射。
  try {
    const prs = await env.DB.prepare(
      "SELECT w.contract_no AS cn, COALESCE(m.province,'') AS p " +
      "FROM won_projects w LEFT JOIN won_province_map m ON m.won_id=w.id"
    ).all();
    const arr = [];
    for (const r of (prs.results || [])) arr.push({ contract_no: r.cn, province: r.p || "" });
    snap.won_province_map = arr;
    counts.won_province_map = arr.length;
  } catch (e) { /* 省份快照失败不阻断固化 */ }

  if (!snap._meta || typeof snap._meta !== "object") snap._meta = {};
  snap._meta.frozen_at = nowIso;
  snap._meta.frozen_note =
    "CRM/LOST/WON/审批 已固化为当前案例数据（freeze）；含 WON 省份映射（按 contract_no）；个人佣金保持独立不并入";

  try {
    await env.FILES.put(key, JSON.stringify(snap),
      { httpMetadata: { contentType: "application/json" } });
  } catch (e) {
    return { ok: false, error: "写回 R2 快照失败: " + String((e && e.message) || e) };
  }

  return { ok: true, frozen_at: nowIso, counts: counts, backed_up: oldText ? true : false };
}
