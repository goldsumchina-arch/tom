// ⛔ FROZEN (2026-09-06) V2026.09.06.20：本文件逻辑已锁定，未经用户明确同意禁止修改。个人佣金后端逻辑均正确，仅数据可为演示数据。
// ============================================================
// 个人佣金 · 修改金额审批模块
//
// 业务规则（用户确认）：
//   1. 后门三人组固定为 tom / cuong / travis，只有这三人能发起佣金金额修改。
//   2. 请求者发起后，审批发给【另外两人】（请求者本人不参与自己的审批）。
//   3. 只要这两人都同意 → 通过，系统自动把金额改成请求者填写的新值。
//      任意一人拒绝 → 作废。
//   4. 只支持修改金额，不支持修改付款日期。
//   5. 这类审批只在「个人佣金 → 查看与审批」里出现，不混入全局审批页。
//
// 数据表：comm_amt_requests
// ============================================================

const COMMISSION_APPROVERS = ["tom", "cuong", "travis"];

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS comm_amt_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  req_key TEXT NOT NULL,
  contract_no TEXT DEFAULT '',
  beneficiary TEXT DEFAULT '',
  pay_no TEXT DEFAULT '',
  currency TEXT DEFAULT '',
  old_amount TEXT DEFAULT '',
  new_amount TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  requester TEXT NOT NULL,
  approver1 TEXT NOT NULL,
  approver2 TEXT NOT NULL,
  dec1 TEXT DEFAULT '',
  dec2 TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created_at TEXT,
  resolved_at TEXT
)`;

// 佣金记录主表（案例数据打 is_demo=1，便于精确清除，不误伤真实数据）
const CREATE_REC_SQL = `
CREATE TABLE IF NOT EXISTS commission_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract TEXT NOT NULL,
  parties TEXT DEFAULT '',
  group_name TEXT DEFAULT '',
  sign_date TEXT DEFAULT '',
  deposit_date TEXT DEFAULT '',
  currency TEXT DEFAULT '',
  equip_rmb TEXT DEFAULT '',
  equip_usd TEXT DEFAULT '',
  equip_vnd TEXT DEFAULT '',
  rate_rmb TEXT DEFAULT '',
  rate_usd TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  is_demo INTEGER DEFAULT 0,
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT ''
)`;

// 受益人表（payments 为 JSON 字符串，存 1~N 期支付明细）
const CREATE_BEN_SQL = `
CREATE TABLE IF NOT EXISTS commission_beneficiaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL,
  ben_index INTEGER DEFAULT 0,
  name TEXT DEFAULT '',
  currency TEXT DEFAULT '',
  total_rmb TEXT DEFAULT '',
  total_usd TEXT DEFAULT '',
  total_vnd TEXT DEFAULT '',
  sign_date TEXT DEFAULT '',
  deposit_date TEXT DEFAULT '',
  paid_rmb TEXT DEFAULT '',
  paid_usd TEXT DEFAULT '',
  paid_vnd TEXT DEFAULT '',
  pay_count INTEGER DEFAULT 0,
  unpaid_rmb TEXT DEFAULT '',
  unpaid_usd TEXT DEFAULT '',
  unpaid_vnd TEXT DEFAULT '',
  pay_nature TEXT DEFAULT '',
  note TEXT DEFAULT '',
  payments TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT ''
)`;

function nowStr() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

async function ensureTable(env) {
  for (const sql of [CREATE_SQL, CREATE_REC_SQL, CREATE_BEN_SQL]) {
    try {
      await env.DB.prepare(sql).run();
    } catch (e) {
      /* 并发建表可能冲突，忽略 */
    }
  }
}

/** 计算审批人：三人中除请求者外的另外两人 */
function approversFor(requester) {
  const r = String(requester || "").trim().toLowerCase();
  return COMMISSION_APPROVERS.filter((u) => u !== r);
}

/** 佣金记录行 → 前端 COMM_RECORDS 元素 */
async function recToDict(row, env) {
  const d = row;
  const bens = await env.DB.prepare(
    "SELECT * FROM commission_beneficiaries WHERE record_id=? ORDER BY ben_index"
  )
    .bind(d.id)
    .all();
  const beneficiaries = (bens.results || []).map((b) => {
    let payments = [];
    try {
      payments = JSON.parse(b.payments || "[]");
    } catch (e) {
      payments = [];
    }
    return {
      name: b.name || "",
      currency: b.currency || "",
      totalRMB: b.total_rmb || "",
      totalUSD: b.total_usd || "",
      totalVND: b.total_vnd || "",
      signDate: b.sign_date || "",
      depositDate: b.deposit_date || "",
      paidRMB: b.paid_rmb || "",
      paidUSD: b.paid_usd || "",
      paidVND: b.paid_vnd || "",
      payCount: b.pay_count || 0,
      unpaidRMB: b.unpaid_rmb || "",
      unpaidUSD: b.unpaid_usd || "",
      unpaidVND: b.unpaid_vnd || "",
      payNature: b.pay_nature || "",
      note: b.note || "",
      payments,
    };
  });
  return {
    id: d.id,
    contract: d.contract || "",
    parties: d.parties || "",
    group: d.group_name || "",
    date: d.sign_date || "",
    depositDate: d.deposit_date || "",
    currency: d.currency || "",
    equipRMB: d.equip_rmb || "",
    equipUSD: d.equip_usd || "",
    equipVND: d.equip_vnd || "",
    rateRMB: d.rate_rmb || "",
    rateUSD: d.rate_usd || "",
    remark: d.remark || "",
    isDemo: parseInt(d.is_demo, 10) || 0,
    beneficiaries,
  };
}

export async function handleCommission(request, env, url, pathname) {
  const base = "/api/commission/amount-requests";

  // ---------- 佣金记录列表 ----------
  if (pathname === "/api/commission/records" && request.method === "GET") {
    await ensureTable(env);
    const rows = await env.DB.prepare(
      "SELECT * FROM commission_records ORDER BY id"
    ).all();
    const items = [];
    for (const r of rows.results || []) {
      items.push(await recToDict(r, env));
    }
    return { body: { ok: true, items }, status: 200 };
  }

  // ---------- 佣金记录保存（按 contract upsert）----------
  if (pathname === "/api/commission/records" && request.method === "POST") {
    await ensureTable(env);
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return { __err: "请求格式错误", __status: 400 };
    }
    const rec = body.record || {};
    const contract = String(rec.contract || "").trim();
    if (!contract) {
      return { __err: "缺少合同编号", __status: 400 };
    }
    const isDemo = body.isDemo || rec.isDemo ? 1 : 0;
    const bens = rec.beneficiaries || [];

    let rid;
    const exist = await env.DB.prepare(
      "SELECT id FROM commission_records WHERE contract=?"
    )
      .bind(contract)
      .first();
    if (exist) {
      rid = exist.id;
      await env.DB.prepare(
        `UPDATE commission_records SET parties=?, group_name=?, sign_date=?,
         deposit_date=?, currency=?, equip_rmb=?, equip_usd=?, equip_vnd=?,
         rate_rmb=?, rate_usd=?, remark=?, is_demo=?, updated_at=? WHERE id=?`
      )
        .bind(
          String(rec.parties || ""),
          String(rec.group || ""),
          String(rec.date || ""),
          String(rec.depositDate || ""),
          String(rec.currency || ""),
          String(rec.equipRMB || ""),
          String(rec.equipUSD || ""),
          String(rec.equipVND || ""),
          String(rec.rateRMB || ""),
          String(rec.rateUSD || ""),
          String(rec.remark || ""),
          isDemo,
          nowStr(),
          rid
        )
        .run();
    } else {
      const cur = await env.DB.prepare(
        `INSERT INTO commission_records
         (contract, parties, group_name, sign_date, deposit_date, currency,
          equip_rmb, equip_usd, equip_vnd, rate_rmb, rate_usd, remark, is_demo, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
        .bind(
          contract,
          String(rec.parties || ""),
          String(rec.group || ""),
          String(rec.date || ""),
          String(rec.depositDate || ""),
          String(rec.currency || ""),
          String(rec.equipRMB || ""),
          String(rec.equipUSD || ""),
          String(rec.equipVND || ""),
          String(rec.rateRMB || ""),
          String(rec.rateUSD || ""),
          String(rec.remark || ""),
          isDemo,
          nowStr(),
          nowStr()
        )
        .run();
      rid = cur.meta && cur.meta.last_row_id ? cur.meta.last_row_id : null;
      if (!rid) {
        const nw = await env.DB.prepare(
          "SELECT id FROM commission_records WHERE contract=?"
        )
          .bind(contract)
          .first();
        rid = nw ? nw.id : null;
      }
    }

    // 受益人整组替换
    await env.DB.prepare(
      "DELETE FROM commission_beneficiaries WHERE record_id=?"
    )
      .bind(rid)
      .run();
    for (let i = 0; i < bens.length; i++) {
      const b = bens[i];
      if (!b || typeof b !== "object") continue;
      await env.DB.prepare(
        `INSERT INTO commission_beneficiaries
         (record_id, ben_index, name, currency, total_rmb, total_usd, total_vnd,
          sign_date, deposit_date, paid_rmb, paid_usd, paid_vnd, pay_count,
          unpaid_rmb, unpaid_usd, unpaid_vnd, pay_nature, note, payments, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
        .bind(
          rid,
          i,
          String(b.name || ""),
          String(b.currency || ""),
          String(b.totalRMB || ""),
          String(b.totalUSD || ""),
          String(b.totalVND || ""),
          String(b.signDate || ""),
          String(b.depositDate || ""),
          String(b.paidRMB || ""),
          String(b.paidUSD || ""),
          String(b.paidVND || ""),
          parseInt(b.payCount, 10) || 0,
          String(b.unpaidRMB || ""),
          String(b.unpaidUSD || ""),
          String(b.unpaidVND || ""),
          String(b.payNature || ""),
          String(b.note || ""),
          JSON.stringify(b.payments || []),
          nowStr()
        )
        .run();
    }
    return { body: { ok: true, id: rid, saved: bens.length }, status: 200 };
  }

  // ---------- 列表 ----------
  if (pathname === base && request.method === "GET") {
    await ensureTable(env);
    const rows = await env.DB.prepare(
      "SELECT * FROM comm_amt_requests ORDER BY id DESC"
    ).all();
    return { body: { ok: true, items: rows.results || [] }, status: 200 };
  }

  // ---------- 发起 ----------
  if (pathname === base && request.method === "POST") {
    await ensureTable(env);
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return { __err: "请求格式错误", __status: 400 };
    }

    const requester = String(body.requester || "").trim().toLowerCase();
    if (COMMISSION_APPROVERS.indexOf(requester) === -1) {
      return { __err: "只有授权人员可以发起佣金金额修改", __status: 403 };
    }

    const oldAmount = String(body.old_amount || "").trim();
    const newAmount = String(body.new_amount || "").trim();
    if (!newAmount || newAmount === oldAmount) {
      return { __err: "请填写与原来不同的新金额", __status: 400 };
    }

    const [a1, a2] = approversFor(requester);
    const reqKey = [
      body.contract_no || "",
      body.beneficiary || "",
      body.pay_no || "",
    ].join("||");

    // 同一笔支付已有待审请求 → 不重复发起
    const dup = await env.DB.prepare(
      "SELECT id FROM comm_amt_requests WHERE req_key=? AND status='pending'"
    )
      .bind(reqKey)
      .first();
    if (dup) {
      return { __err: "该笔金额已有待审批的修改申请", __status: 409 };
    }

    await env.DB.prepare(
      `INSERT INTO comm_amt_requests
       (req_key, contract_no, beneficiary, pay_no, currency,
        old_amount, new_amount, reason, requester, approver1, approver2,
        status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?)`
    )
      .bind(
        reqKey,
        String(body.contract_no || ""),
        String(body.beneficiary || ""),
        String(body.pay_no || ""),
        String(body.currency || ""),
        oldAmount,
        newAmount,
        String(body.reason || ""),
        requester,
        a1,
        a2,
        nowStr()
      )
      .run();

    return { body: { ok: true, approvers: [a1, a2] }, status: 200 };
  }

  // ---------- 处理（同意 / 拒绝）----------
  const m = /^\/api\/commission\/amount-requests\/(\d+)\/resolve$/.exec(pathname);
  if (m && request.method === "POST") {
    await ensureTable(env);
    const id = m[1];
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return { __err: "请求格式错误", __status: 400 };
    }

    const action = String(body.action || "").trim().toLowerCase(); // approve | reject
    const resolver = String(body.resolver || "").trim().toLowerCase();
    if (action !== "approve" && action !== "reject") {
      return { __err: "操作无效", __status: 400 };
    }

    const row = await env.DB.prepare(
      "SELECT * FROM comm_amt_requests WHERE id=?"
    )
      .bind(id)
      .first();
    if (!row) return { __err: "审批不存在", __status: 404 };
    if (row.status !== "pending") {
      return { __err: "该审批已结束", __status: 409 };
    }
    if (resolver !== row.approver1 && resolver !== row.approver2) {
      return { __err: "你不是该笔审批的审批人", __status: 403 };
    }

    // 写入该审批人的决定
    const decField = resolver === row.approver1 ? "dec1" : "dec2";
    await env.DB.prepare(
      `UPDATE comm_amt_requests SET ${decField}=? WHERE id=?`
    )
      .bind(action, id)
      .run();

    // 重新读取，判定最终状态
    const cur = await env.DB.prepare(
      "SELECT * FROM comm_amt_requests WHERE id=?"
    )
      .bind(id)
      .first();

    let status = "pending";
    const decs = [cur.dec1, cur.dec2];
    if (decs.indexOf("reject") !== -1) {
      status = "rejected";
    } else if (cur.dec1 === "approve" && cur.dec2 === "approve") {
      status = "approved"; // 两人都同意 → 通过，前端据此外挂新金额
    }

    if (status !== "pending") {
      await env.DB.prepare(
        "UPDATE comm_amt_requests SET status=?, resolved_at=? WHERE id=?"
      )
        .bind(status, nowStr(), id)
        .run();
    }

    return {
      body: {
        ok: true,
        status,
        // 通过时回传新金额，前端直接落值（系统自动改金额）
        new_amount: status === "approved" ? cur.new_amount : null,
      },
      status: 200,
    };
  }

  return null;
}

