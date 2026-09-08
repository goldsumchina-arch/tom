// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件逻辑已锁定，未经用户明确同意禁止修改。除 CRM / LOST / WON / 个人佣金 四个模块内的“样板数据 / 演示数据”（清理演示数据用，仅删数据、不改逻辑）外，其余业务逻辑均正确，禁止改动。
// ============================================================
// 彻底删除（Purge）模块 · Cloudflare Worker + D1 + R2
//
// 背景：本项目没有任何数据库外键，也没有开启 PRAGMA foreign_keys，
// 所有"级联"都是手写代码逻辑，且历史上遗漏了不少：
//   · 删 WON 记录 → R2 里 won/ 附件全部变孤儿（本地 Flask 版会删，云端漏了）
//   · 删 CRM/LOST → approval_requests 里指向该记录的审批单残留
//   · 删 WON → 关联的 commission_records / commission_beneficiaries 残留
//   · 各种异常被 catch 吞掉 → R2 对象残留
//
// 设计原则：
//   1) 引用计数安全删除：同一个 R2 key 若仍被其它记录引用，绝不删除。
//      （"CRM 转失败"会同时产生 CRM + LOST 两条记录，共享同一批 pdf_* key，
//        删掉其中一条时另一条的附件不能变成死链。）
//   2) 全级联：附件 + 审批单 + 佣金记录，一次删干净。
//   3) 只认 DB 里的真实 key，不靠前缀假设：
//      crm.js 实际写的是 "crm-docs/" 前缀，而 files.js 里 PREFIX_CRM="crm/"，
//      两者并不一致，靠前缀猜会误删。
//   4) 失败不阻塞：单步失败记入报告，不阻断主记录删除（避免删不掉记录）。
//   5) 孤儿扫描兜底：R2 里没有任何 DB 引用的对象，可统一清理。
// ============================================================

const OWNER = "tom";

/** 受管理的业务前缀（孤儿扫描只清理这些前缀，绝不碰其它数据） */
const MANAGED_PREFIXES = ["won/", "crm", "lost/", "vault/"];

/** 存放文件引用的字段 */
const FILE_FIELDS = {
  crm_projects: ["pdf_equip", "pdf_install", "pdf_both"],
  lost_projects: ["pdf_equip", "pdf_install", "pdf_both"],
  // V45 新增：WON 设备合同 / 安装合同 PDF（R2 前缀 won-docs/），
  // 与 attachments(JSON 数组) 并存，三者都要纳入引用计数与级联删除。
  // doc_both 是历史字段，库中仍可能有数据，必须保留以防误删。
  won_projects: ["doc_equip", "doc_install", "doc_both"],
};

function errj(msg, status, extra) {
  return { __err: msg, __status: status || 400, __msg: extra };
}

/** 从 /api/files/<key> 或裸 key 里解析出 R2 key */
export function parseFileRef(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  const mo = /^\/api\/files\/(.+)$/.exec(s);
  if (mo) {
    try { return decodeURIComponent(mo[1]); } catch (e) { return mo[1]; }
  }
  // 裸 key（含 / 且不是 http 链接）
  if (/^https?:\/\//i.test(s)) return null;
  if (s.indexOf("/") > 0) return s;
  return null;
}

/**
 * 从一条记录里提取它引用的所有 R2 key
 * @param {string} table crm_projects / lost_projects / won_projects
 * @param {object} row 该行数据（只需含相关字段）
 */
export function extractKeysFromRow(table, row) {
  const out = [];
  if (!row) return out;

  // WON：attachments 是 JSON 数组，元素形如 {filename, original, ext, url}
  if (table === "won_projects") {
    // V45 设备/安装合同：直接存在 doc_equip / doc_install 两个文本列里
    for (const f of FILE_FIELDS.won_projects || []) {
      const k = parseFileRef(row[f]);
      if (k) out.push(k);
    }
    let atts = [];
    try { atts = row.attachments ? JSON.parse(row.attachments) : []; } catch (e) { atts = []; }
    if (Array.isArray(atts)) {
      for (const a of atts) {
        if (!a) continue;
        const k = a.filename || parseFileRef(a.url);
        if (k) out.push(k);
      }
    }
    return out;
  }

  // CRM / LOST：pdf_equip / pdf_install / pdf_both
  const fields = FILE_FIELDS[table] || [];
  for (const f of fields) {
    const k = parseFileRef(row[f]);
    if (k) out.push(k);
  }
  return out;
}

/**
 * 收集整个数据库里被引用的所有 R2 key
 * @returns {Promise<Set<string>>}
 */
export async function collectReferencedKeys(env) {
  const refs = new Set();
  const add = (k) => { if (k) refs.add(k); };

  // CRM / LOST 的 pdf 槽位
  for (const t of ["crm_projects", "lost_projects"]) {
    let rs;
    try {
      rs = await env.DB.prepare(
        `SELECT ${FILE_FIELDS[t].join(", ")} FROM ${t}`
      ).all();
    } catch (e) { continue; }
    for (const r of rs.results || []) {
      extractKeysFromRow(t, r).forEach(add);
    }
  }

  // WON：设备/安装合同（doc_equip/doc_install/doc_both）+ attachments JSON 数组 + 补充协议文件
  try {
    const wonFields = (FILE_FIELDS.won_projects || []).concat(["attachments", "doc_view_addendum", "supp_summary"]);
    const rs = await env.DB.prepare(
      `SELECT ${wonFields.join(", ")} FROM won_projects`
    ).all();
    for (const r of rs.results || []) {
      extractKeysFromRow("won_projects", r).forEach(add);
      // 补充协议文件（won-docs/addm/...）也计入引用，否则 purge-orphans 会误删
      for (const jsonCol of ["doc_view_addendum", "supp_summary"]) {
        try {
          const arr = r[jsonCol] ? JSON.parse(r[jsonCol]) : [];
          if (Array.isArray(arr)) {
            for (const a of arr) {
              if (!a) continue;
              const k = parseFileRef(a.file || a.filename || a.url);
              if (k) add(k);
            }
          }
        } catch (e) { /* 单条解析失败忽略 */ }
      }
    }
  } catch (e) { /* 表不存在则跳过 */ }

  // 私密空间文件
  try {
    const rs = await env.DB.prepare("SELECT key FROM vault_files").all();
    for (const r of rs.results || []) add(r.key);
  } catch (e) { /* 表不存在则跳过 */ }

  return refs;
}

/**
 * 安全删除 R2 对象：仅当没有其它记录仍在引用它时才真正删除
 * @param {object} exclude {table, id} 正在被删除的记录（自身引用不算数）
 */
export async function deleteFileIfOrphan(env, key, exclude) {
  if (!key) return { deleted: false, reason: "empty" };
  const refs = await collectReferencedKeys(env);
  // 如果这条记录本身还在（比如只是替换文件），它自己的引用要排除掉
  if (exclude && exclude.table && exclude.id != null) {
    try {
      const row = await env.DB.prepare(
        `SELECT * FROM ${exclude.table} WHERE id=?`
      ).bind(exclude.id).first();
      if (row) {
        // 该记录自身的引用不计入"其它引用"
        for (const k of extractKeysFromRow(exclude.table, row)) refs.delete(k);
      }
    } catch (e) { /* 忽略 */ }
  }

  if (refs.has(key)) return { deleted: false, reason: "still-referenced" };
  try {
    await env.FILES.delete(key);
    return { deleted: true };
  } catch (e) {
    return { deleted: false, reason: "r2-error:" + String((e && e.message) || e) };
  }
}

/** 删除某个 block 前缀下指向该记录的审批单 */
async function purgeApprovals(env, prefix, pid) {
  try {
    const rs = await env.DB.prepare(
      "DELETE FROM approval_requests WHERE block_id LIKE ? AND target_id=?"
    ).bind(prefix + "%", String(pid)).run();
    return (rs && rs.meta && rs.meta.changes) || 0;
  } catch (e) { return 0; }
}

/** 删除该合同号关联的佣金记录（主表 + 受益人表） */
async function purgeCommission(env, contractNo, report) {
  if (!contractNo) return;
  try {
    const rs = await env.DB.prepare(
      "SELECT id FROM commission_records WHERE contract=?"
    ).bind(contractNo).all();
    const ids = (rs.results || []).map((r) => r.id);
    if (!ids.length) return;
    const ph = ids.map(() => "?").join(",");
    const b = await env.DB.prepare(
      `DELETE FROM commission_beneficiaries WHERE record_id IN (${ph})`
    ).bind(...ids).run();
    const r = await env.DB.prepare(
      `DELETE FROM commission_records WHERE id IN (${ph})`
    ).bind(...ids).run();
    report.commission_records += (r && r.meta && r.meta.changes) || 0;
    report.commission_beneficiaries += (b && b.meta && b.meta.changes) || 0;
  } catch (e) { /* 表不存在则跳过 */ }
}

function newReport() {
  return {
    files_deleted: 0, files_kept: 0, files_failed: 0,
    approvals_deleted: 0,
    commission_records: 0, commission_beneficiaries: 0,
    record_deleted: false, errors: [],
  };
}

/**
 * 彻底删除一条 WON 记录（签名项目）
 *   附件(R2 won/) + 审批单(WON-*) + 佣金记录(按合同号) + 主记录
 */
export async function purgeWon(env, pid) {
  const report = newReport();
  const row = await env.DB.prepare("SELECT * FROM won_projects WHERE id=?")
    .bind(pid).first();
  if (!row) return report;

  // 1) 附件（R2 won/）
  for (const key of extractKeysFromRow("won_projects", row)) {
    const r = await deleteFileIfOrphan(env, key, { table: "won_projects", id: pid });
    if (r.deleted) report.files_deleted++;
    else if (r.reason === "still-referenced") report.files_kept++;
    else { report.files_failed++; report.errors.push(key + ": " + r.reason); }
  }

  // 2) 审批单
  report.approvals_deleted += await purgeApprovals(env, "WON-", pid);

  // 3) 佣金记录（按合同号关联）
  await purgeCommission(env, row.contract_no, report);

  // 4) 主记录
  await env.DB.prepare("DELETE FROM won_projects WHERE id=?").bind(pid).run();
  report.record_deleted = true;
  return report;
}

/**
 * 彻底删除一条 CRM 记录（报价/跟进）
 *   报价单附件(R2 crm-docs/) + 审批单(CRM-*) + 主记录
 */
export async function purgeCrm(env, pid) {
  const report = newReport();
  const row = await env.DB.prepare("SELECT * FROM crm_projects WHERE id=?")
    .bind(pid).first();
  if (!row) return report;

  for (const key of extractKeysFromRow("crm_projects", row)) {
    const r = await deleteFileIfOrphan(env, key, { table: "crm_projects", id: pid });
    if (r.deleted) report.files_deleted++;
    else if (r.reason === "still-referenced") report.files_kept++;
    else { report.files_failed++; report.errors.push(key + ": " + r.reason); }
  }

  report.approvals_deleted += await purgeApprovals(env, "CRM-", pid);
  await env.DB.prepare("DELETE FROM crm_projects WHERE id=?").bind(pid).run();
  report.record_deleted = true;
  return report;
}

/**
 * 彻底删除一条 LOST 记录（失败项目）
 *   报价单附件 + 审批单(LOST-*) + 主记录
 */
export async function purgeLost(env, pid) {
  const report = newReport();
  const row = await env.DB.prepare("SELECT * FROM lost_projects WHERE id=?")
    .bind(pid).first();
  if (!row) return report;

  for (const key of extractKeysFromRow("lost_projects", row)) {
    const r = await deleteFileIfOrphan(env, key, { table: "lost_projects", id: pid });
    if (r.deleted) report.files_deleted++;
    else if (r.reason === "still-referenced") report.files_kept++;
    else { report.files_failed++; report.errors.push(key + ": " + r.reason); }
  }

  report.approvals_deleted += await purgeApprovals(env, "LOST-", pid);
  await env.DB.prepare("DELETE FROM lost_projects WHERE id=?").bind(pid).run();
  report.record_deleted = true;
  return report;
}

/**
 * 孤儿文件扫描清理
 *   遍历 R2，删除所有"没有任何 DB 记录引用"的业务对象。
 * @param {object} opts {dryRun:boolean, limit:number}
 */
export async function sweepOrphanFiles(env, opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const maxDelete = opts.limit || 1000;
  const refs = await collectReferencedKeys(env);

  const orphans = [];
  let scanned = 0, deleted = 0, skipped = 0, truncated = true, cursor = undefined;

  while (truncated && orphans.length < maxDelete) {
    const list = await env.FILES.list({ cursor, limit: 1000 });
    for (const obj of list.objects || []) {
      scanned++;
      // 只清理受管理的业务前缀，其它数据一律不碰
      if (!MANAGED_PREFIXES.some((p) => obj.key.indexOf(p) === 0)) { skipped++; continue; }
      if (refs.has(obj.key)) continue;
      orphans.push(obj.key);
      if (dryRun) continue;
      try {
        await env.FILES.delete(obj.key);
        deleted++;
      } catch (e) { /* 记录后继续 */ }
      if (deleted >= maxDelete) break;
    }
    truncated = !!list.truncated;
    cursor = list.cursor;
  }

  return {
    scanned, orphan_found: orphans.length,
    deleted: dryRun ? 0 : deleted, skipped, dryRun,
    sample: orphans.slice(0, 50),
  };
}

/** 清理私密空间的垃圾：防爆破状态表 + 过期 token */
export async function purgeVaultJunk(env) {
  const out = { tokens_deleted: 0, sec_deleted: 0 };
  try {
    const now = Date.now();
    const t = await env.DB.prepare(
      "DELETE FROM vault_tokens WHERE expires_at < ?"
    ).bind(now).run();
    out.tokens_deleted = (t && t.meta && t.meta.changes) || 0;
  } catch (e) { /* 表不存在 */ }
  try {
    // vault_sec 只存一行防爆破状态（fail_count / lock_until），
    // 锁已过期就整体清掉，避免永久残留
    const row = await env.DB.prepare("SELECT * FROM vault_sec LIMIT 1").first();
    if (row) {
      const until = Number(row.lock_until || 0);
      if (!until || until < Date.now()) {
        const s = await env.DB.prepare("DELETE FROM vault_sec").run();
        out.sec_deleted = (s && s.meta && s.meta.changes) || 0;
      }
    }
  } catch (e) { /* 表不存在 */ }
  return out;
}

const DEFAULT_CAPACITY_GB = 10000; // 默认总容量 10 TB（可在 wrangler.toml 用 STORAGE_CAPACITY_GB 覆盖）

const STORAGE_CATEGORIES = [
  { key: "won", name: "WON", prefixes: ["won-docs/", "won/"] },
  { key: "crm", name: "CRM", prefixes: ["crm-docs/", "crm/"] },
  { key: "lost", name: "LOST", prefixes: ["lost-docs/", "lost/"] },
  { key: "vault", name: "Vault", prefixes: ["vault/"] },
  { key: "snapshots", name: "Snapshots", keys: ["demo_snapshot.json", "price_snapshot.json"] },
];

function matchStorageCategory(key) {
  for (const cat of STORAGE_CATEGORIES) {
    if (cat.keys && cat.keys.some((k) => key === k || key.indexOf(k + ".") === 0)) return cat.key;
    if (cat.prefixes && cat.prefixes.some((p) => key.indexOf(p) === 0)) return cat.key;
  }
  return "other";
}

/** 统计 R2 容量分布（只读） */
export async function storageReport(env) {
  const capacityGB = Math.max(1, Number(env.STORAGE_CAPACITY_GB || DEFAULT_CAPACITY_GB));
  const capacityBytes = capacityGB * 1e9; // GB 按十进制计
  let usedBytes = 0;
  const areas = { won: 0, crm: 0, lost: 0, vault: 0, snapshots: 0, other: 0 };
  let truncated = true, cursor = undefined;
  while (truncated) {
    const list = await env.FILES.list({ cursor, limit: 1000 });
    for (const obj of list.objects || []) {
      const size = Number(obj.size || 0);
      usedBytes += size;
      const cat = matchStorageCategory(obj.key);
      areas[cat] = (areas[cat] || 0) + size;
    }
    truncated = !!list.truncated;
    cursor = list.cursor;
  }
  const freeBytes = Math.max(0, capacityBytes - usedBytes);
  const areaArr = Object.keys(areas)
    .map((k) => {
      const cat = STORAGE_CATEGORIES.find((c) => c.key === k) || { key: "other", name: "Other" };
      return { key: k, name: cat.name, bytes: areas[k], percent: capacityBytes ? (areas[k] / capacityBytes * 100) : 0 };
    })
    .filter((a) => a.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  return {
    capacity_bytes: capacityBytes,
    capacity_gb: capacityGB,
    used_bytes: usedBytes,
    used_gb: +(usedBytes / 1e9).toFixed(2),
    free_bytes: freeBytes,
    free_gb: +(freeBytes / 1e9).toFixed(2),
    used_percent: capacityBytes ? +(usedBytes / capacityBytes * 100).toFixed(2) : 0,
    free_percent: capacityBytes ? +(freeBytes / capacityBytes * 100).toFixed(2) : 0,
    areas: areaArr,
  };
}

/** 统计当前残留情况（只读，不改动任何数据） */
export async function purgeReport(env) {
  const refs = await collectReferencedKeys(env);
  let scanned = 0, orphans = [], truncated = true, cursor = undefined;
  while (truncated) {
    const list = await env.FILES.list({ cursor, limit: 1000 });
    for (const obj of list.objects || []) {
      scanned++;
      if (!MANAGED_PREFIXES.some((p) => obj.key.indexOf(p) === 0)) continue;
      if (refs.has(obj.key)) continue;
      orphans.push(obj.key);
    }
    truncated = !!list.truncated;
    cursor = list.cursor;
  }
  const cnt = async (sql) => {
    try {
      const r = await env.DB.prepare(sql).first();
      return r ? Object.values(r)[0] : 0;
    } catch (e) { return -1; }
  };
  return {
    r2_total: scanned,
    r2_orphans: orphans.length,
    r2_orphan_sample: orphans.slice(0, 30),
    db: {
      approval_requests: await cnt("SELECT COUNT(*) c FROM approval_requests"),
      commission_records: await cnt("SELECT COUNT(*) c FROM commission_records"),
      vault_files: await cnt("SELECT COUNT(*) c FROM vault_files"),
      vault_tokens: await cnt("SELECT COUNT(*) c FROM vault_tokens"),
      vault_sec: await cnt("SELECT COUNT(*) c FROM vault_sec"),
    },
    referenced_keys: refs.size,
  };
}

// ============================================================
// 路由（仅 tom 可用）
//   GET  /api/admin/purge-report        查看残留报告（只读）
//   POST /api/admin/purge-orphans       清理孤儿文件（可带 {dryRun:true}）
//   POST /api/admin/purge-vault-junk    清理私密空间垃圾
// ============================================================
export async function handlePurge(request, env, url, pathname) {
  if (pathname.indexOf("/api/admin/") !== 0) return null;
  const username = String(request.headers.get("X-User-Name") || "").toLowerCase();
  if (username !== OWNER) {
    return errj("forbidden: owner only", 403);
  }

  // GET /api/admin/purge-report
  if (pathname === "/api/admin/purge-report" && request.method === "GET") {
    const r = await purgeReport(env);
    return { body: { ok: true, report: r }, status: 200 };
  }

  // GET /api/admin/storage-report
  if (pathname === "/api/admin/storage-report" && request.method === "GET") {
    const r = await storageReport(env);
    return { body: { ok: true, storage: r }, status: 200 };
  }

  // POST /api/admin/purge-orphans
  if (pathname === "/api/admin/purge-orphans" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch (e) { body = {}; }
    const r = await sweepOrphanFiles(env, {
      dryRun: !!body.dryRun,
      limit: body.limit || 1000,
    });
    return { body: { ok: true, result: r }, status: 200 };
  }

  // POST /api/admin/purge-vault-junk
  if (pathname === "/api/admin/purge-vault-junk" && request.method === "POST") {
    const r = await purgeVaultJunk(env);
    return { body: { ok: true, result: r }, status: 200 };
  }

  return null;
}
