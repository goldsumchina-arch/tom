// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件逻辑已锁定，未经用户明确同意禁止修改。除 CRM / LOST / WON / 个人佣金 四个模块内的“样板数据 / 演示数据”（清理演示数据用，仅删数据、不改逻辑）外，其余业务逻辑均正确，禁止改动。
// ============================================================
// 桌面版 ↔ 云端 D1 双向同步（M12 + Phase B 权限分级）
//
// 目标：桌面版（离线本机 SQLite）改的数据，联网后能同步到 D1，
//       网页端 / 手机端立刻看到；云端的改动也能拉回桌面版。
//
// 接口（均在统一会话鉴权之后，需 Authorization: Bearer <token>）：
//   GET  /api/sync/pull?tables=a,b,c  拉取【当前登录用户权限范围内】的行 + 服务端时间
//   POST /api/sync/push               上传本机的新增/修改/删除（写操作按归属校验）
//
// 设计要点：
//   1) 只允许白名单表，杜绝任意 SQL。
//   2) 列集合以【云端 D1 实际列】为准（SELECT * LIMIT 1 探测，
//      空表时回退 PRAGMA / sqlite_master 解析），
//      避免本机多出的列（如 remark_zh）把 D1 写崩。
//   3) 冲突策略：updated_at 后写胜（last-write-wins）。
//   4) D1 单次查询最多 100 个绑定参数，而 won_projects 有 100+ 列，
//      故写入按 80 列分块，否则会直接报 too many parameters。
//   5) ★ Phase B（权限分级本地数据）：
//      /api/sync/pull 按登录用户权限过滤行——管理员看全量，普通用户只拉取
//      「owner_user_id / salesperson / 受益人 / 申请人 属于本人可见范围」的行。
//      这样每台桌面端本机 SQLite 只保存其权限范围内可看的数据，
//      即便本地库被打开也看不到别人的业务数据。
//      （本地 app.py 未同步 users 表，其「未找到本地用户→看全部本地行」的兜底
//       渲染的正是这份已过滤的本地库，故离线视图 == 在线权限视图，且不会越权泄露。）
// ============================================================

// 参与同步的业务表（数据量大且可重建的缓存表不参与）
export const SYNC_TABLES = [
  "crm_projects", "won_projects", "lost_projects",
  "approval_requests",
  "commission_records", "commission_beneficiaries", "comm_amt_requests",
  "password_requests",
];
// ⚠️ 以下表【故意不参与同步】，原因（改动前务必先读）：
//   users —— 密码哈希 + 两端 id 不一致，错误合并会覆盖云端真实密码或破坏 id 关联。
//            权限分级改由【云端 pull 按权限过滤行】实现，无需把 users 拉回本机。
//   managers —— 主键是 username，当前按 id 归并逻辑不适用。
//   login_history —— 审计流水，自增 id 跨端必然冲突。
//   sessions / app_meta —— 云端专用。

// D1 单次绑定参数上限
const MAX_PARAMS = 100;
const CHUNK = 80; // 每块列数，留足余量给 WHERE id=?

const colCache = {}; // tbl -> string[]（同一个 Worker 实例内缓存）


/** 校验 Bearer token，返回真实 username；无效/过期返回 null。
 *  与 index.js 的 authenticate 同源：sessions(token) -> username + expires_at。 */
async function authenticateSync(request, env) {
  if (!env || !env.DB) return null;
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
      if (!isNaN(exp) && Date.now() > exp) return null;
    }
    return String(row.username || "").trim();
  } catch (e) {
    return null;
  }
}

/** 是否为管理员（看全部）：在 managers 表，或 role=admin。 */
async function isManager(env, username) {
  if (!username) return false;
  try {
    const r = await env.DB.prepare(
      "SELECT 1 AS x FROM managers WHERE username=?"
    ).bind(username).first();
    if (r) return true;
  } catch (e) { /* ignore */ }
  try {
    const r = await env.DB.prepare(
      "SELECT role FROM users WHERE username=?"
    ).bind(username).first();
    if (r && (r.role === "admin" || (r.role || "").indexOf("管理") >= 0)) return true;
  } catch (e) { /* ignore */ }
  return false;
}

/**
 * 计算当前用户可见的用户名集合（小写）。
 * 返回 null 表示「看全部」（管理员/总经理等）；返回 string[] 表示仅该集合内的行可见。
 * 逻辑与 app.py 的 _visible_scope 对齐：
 *   visible = {self} ∪ vis_he_can_see（数字 id 解析为用户名）∪ 反向 vis_can_see_me ∪ 离职代理。
 */
async function visibleScope(env, username) {
  if (!username) return [];
  if (await isManager(env, username)) return null; // 看全部
  const self = username.trim().toLowerCase();
  const visible = new Set([self]);

  // 正向授权 vis_he_can_see（数字 id 或用户名）
  const me = await env.DB.prepare(
    "SELECT id, vis_he_can_see FROM users WHERE username=?"
  ).bind(username).first();
  const myId = me ? me.id : null;
  if (me && me.vis_he_can_see) {
    let vs = [];
    try { vs = JSON.parse(me.vis_he_can_see || "[]"); } catch (e) { vs = []; }
    const ids = [];
    for (const v of vs) {
      const s = String(v).trim();
      if (!s) continue;
      if (/^\d+$/.test(s)) ids.push(parseInt(s, 10));
      else visible.add(s.toLowerCase());
    }
    if (ids.length) {
      const ph = ids.map(() => "?").join(",");
      const rs = await env.DB.prepare(
        "SELECT username FROM users WHERE id IN (" + ph + ")"
      ).bind(...ids).all();
      for (const r of (rs.results || [])) {
        visible.add(String(r.username).trim().toLowerCase());
      }
    }
  }

  // 反向授权：其他用户的 vis_can_see_me 包含 self（按 id 或用户名）
  const rev = await env.DB.prepare(
    "SELECT username, vis_can_see_me FROM users " +
    "WHERE username<>? AND vis_can_see_me IS NOT NULL AND vis_can_see_me<>'' AND vis_can_see_me<>'[]'"
  ).bind(username).all();
  for (const r of (rev.results || [])) {
    let arr = [];
    try { arr = JSON.parse(r.vis_can_see_me || "[]"); } catch (e) { arr = []; }
    let hit = false;
    for (const v of arr) {
      const s = String(v).trim();
      if (!s) continue;
      if (/^\d+$/.test(s)) {
        if (myId !== null && parseInt(s, 10) === myId) { hit = true; break; }
      } else if (s.toLowerCase() === self) { hit = true; break; }
    }
    if (hit) visible.add(String(r.username).trim().toLowerCase());
  }

  // 离职代理：当前用户是被代理人的 delegate_to 且被代理人非 active
  const del = await env.DB.prepare(
    "SELECT username FROM users WHERE delegate_to=? AND status<>'active' AND username<>?"
  ).bind(username, username).all();
  for (const r of (del.results || [])) {
    visible.add(String(r.username).trim().toLowerCase());
  }

  return Array.from(visible);
}

/**
 * 返回某表的权限过滤子句 + 绑定参数。
 * visible === null → 看全部（返回空子句）。
 * 注意：含多个 IN(?) 的表需把 visible 重复拼进 params。
 */
function scopeWhere(t, visible) {
  if (visible === null) return { suffix: "", params: [] };
  const ph = visible.map(() => "?").join(",");
  switch (t) {
    case "commission_beneficiaries":
      return { suffix: " WHERE lower(name) IN (" + ph + ")", params: visible };
    case "commission_records":
      return {
        suffix: " WHERE id IN (SELECT record_id FROM commission_beneficiaries WHERE lower(name) IN (" + ph + "))",
        params: visible,
      };
    case "comm_amt_requests":
      return {
        suffix: " WHERE lower(requester) IN (" + ph + ") OR lower(beneficiary) IN (" + ph + ")",
        params: visible.concat(visible),
      };
    case "approval_requests":
      return {
        suffix: " WHERE lower(requester) IN (" + ph + ") OR lower(resolver) IN (" + ph + ")",
        params: visible.concat(visible),
      };
    case "password_requests":
      return { suffix: " WHERE lower(username) IN (" + ph + ")", params: visible };
    default:
      // crm_projects / won_projects / lost_projects
      return {
        suffix: " WHERE (owner_user_id <> '' AND lower(owner_user_id) IN (" + ph + ")) " +
                "OR (owner_user_id = '' AND lower(salesperson) IN (" + ph + "))",
        params: visible.concat(visible),
      };
  }
}


/** 探测云端表的真实列集合 */
async function getColumns(env, t) {
  if (colCache[t]) return colCache[t];

  // ① 先试 SELECT * LIMIT 1（最稳，纯普通查询）
  try {
    const r = await env.DB.prepare("SELECT * FROM " + t + " LIMIT 1").first();
    if (r && Object.keys(r).length) {
      colCache[t] = Object.keys(r);
      return colCache[t];
    }
  } catch (e) { /* 继续回退 */ }

  // ② PRAGMA table_info
  try {
    const r = await env.DB.prepare("PRAGMA table_info(" + t + ")").all();
    const names = (r.results || []).map((x) => x.name).filter(Boolean);
    if (names.length) {
      colCache[t] = names;
      return colCache[t];
    }
  } catch (e) { /* 继续回退 */ }

  // ③ 解析 CREATE TABLE 语句（去掉 -- 注释后取每个字段的首个标识符）
  try {
    const r = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name=?"
    ).bind(t).first();
    if (r && r.sql) {
      let body = String(r.sql);
      body = body.slice(body.indexOf("(") + 1);
      body = body.replace(/--[^\n]*/g, ""); // 去行注释
      const names = [];
      for (const raw of body.split(",")) {
        const line = raw.trim().replace(/\s+/g, " ");
        if (!line) continue;
        const m = /^"?([A-Za-z_][A-Za-z0-9_]*)"?\s/.exec(line + " ");
        if (!m) continue;
        const kw = line.toUpperCase();
        if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/.test(kw)) continue;
        names.push(m[1]);
      }
      if (names.length) {
        colCache[t] = names;
        return colCache[t];
      }
    }
  } catch (e) { /* 放弃 */ }

  return [];
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * 单表 upsert。
 * 先查 id 是否存在：存在则分块 UPDATE；不存在则分块 INSERT + 补 UPDATE。
 */
async function upsertRow(env, t, row, cols) {
  const id = row.id;
  if (id === undefined || id === null) return { ok: false, error: "missing id" };

  // 只写云端真实存在的列，且排除 id（id 单独处理）
  const keys = cols.filter(
    (c) => c !== "id" && Object.prototype.hasOwnProperty.call(row, c)
  );

  // 冲突判定：updated_at 后写胜
  if (row.updated_at) {
    try {
      const cur = await env.DB.prepare(
        "SELECT updated_at FROM " + t + " WHERE id=?"
      ).bind(id).first();
      if (cur && cur.updated_at && String(cur.updated_at) > String(row.updated_at)) {
        return { ok: true, skipped: true };
      }
    } catch (e) { /* 查询失败则继续尝试写入 */ }
  }

  const exists = await env.DB.prepare(
    "SELECT 1 AS x FROM " + t + " WHERE id=?"
  ).bind(id).first();

  if (exists) {
    if (!keys.length) return { ok: true };
    // 分块 UPDATE，每块 ≤ CHUNK 列 + WHERE id
    for (const part of chunk(keys, CHUNK)) {
      const sets = part.map((c) => c + "=?").join(",");
      const vals = part.map((c) => row[c]);
      await env.DB.prepare(
        "UPDATE " + t + " SET " + sets + " WHERE id=?"
      ).bind(...vals, id).run();
    }
    return { ok: true, updated: true };
  }

  // 新行：先插入前 MAX_PARAMS-10 列，余下再用 UPDATE 补
  const head = keys.slice(0, MAX_PARAMS - 10);
  const rest = keys.slice(head.length);
  const insCols = ["id"].concat(head);
  const ph = insCols.map(() => "?").join(",");
  await env.DB.prepare(
    "INSERT INTO " + t + " (" + insCols.join(",") + ") VALUES (" + ph + ")"
  ).bind(id, ...head.map((c) => row[c])).run();

  for (const part of chunk(rest, CHUNK)) {
    const sets = part.map((c) => c + "=?").join(",");
    await env.DB.prepare(
      "UPDATE " + t + " SET " + sets + " WHERE id=?"
    ).bind(...part.map((c) => row[c]), id).run();
  }
  return { ok: true, inserted: true };
}

export async function handleSync(request, env, url, pathname) {
  // ---------------- GET /api/sync/users ----------------
  // 桌面版【离线登录】专用：把云端用户目录单向同步到本机（只下发，绝不上传）。
  // password 列是 PBKDF2 哈希（pbkdf2$迭代$盐$哈希），本机用同一算法离线校验；
  // managers 一并下发，供本机判断 is_admin。业务数据仍走 /api/sync/pull 的权限范围过滤。
  if (pathname === "/api/sync/users" && request.method === "GET") {
    const username = await authenticateSync(request, env);
    if (!username) {
      return { __err: "未登录或会话已失效" };
    }
    let users = [];
    try {
      const r = await env.DB.prepare(
        "SELECT username, password, real_name, role, position, status, perms, " +
        "vis_he_can_see, vis_can_see_me FROM users"
      ).all();
      users = r.results || [];
    } catch (e) {
      return { __err: "读取用户表失败" };
    }
    let managers = [];
    try {
      const m = await env.DB.prepare("SELECT username FROM managers").all();
      managers = (m.results || []).map((x) => x.username);
    } catch (e) {}
    return { ok: true, users: users, managers: managers };
  }

  // ---------------- GET /api/sync/pull ----------------
  if (pathname === "/api/sync/pull" && request.method === "GET") {
    const username = await authenticateSync(request, env);
    if (!username) {
      return { __err: "未登录或会话已失效" };
    }
    const want = (url.searchParams.get("tables") || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => SYNC_TABLES.indexOf(s) >= 0);
    const tables = want.length ? want : SYNC_TABLES;

    // 报告每张表在云端是否真实存在
    const present = {};
    for (const t of tables) {
      try {
        const r = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        ).bind(t).first();
        present[t] = !!r;
      } catch (e) {
        present[t] = false;
      }
    }

    // ★ 计算当前用户可见范围（null=看全部）
    const visible = await visibleScope(env, username);

    const data = {};
    for (const t of tables) {
      data[t] = [];
      if (!present[t]) continue;
      try {
        const { suffix, params } = scopeWhere(t, visible);
        const r = await env.DB.prepare("SELECT * FROM " + t + suffix).bind(...params).all();
        data[t] = r.results || [];
      } catch (e) {
        data[t] = [];
      }
    }
    return {
      ok: true,
      username: username,
      now: new Date().toISOString().replace("T", " ").slice(0, 19),
      tables: tables,
      present: present,
      data: data,
    };
  }

  // ---------------- POST /api/sync/push ----------------
  if (pathname === "/api/sync/push" && request.method === "POST") {
    const username = await authenticateSync(request, env);
    if (!username) {
      return { __err: "未登录或会话已失效" };
    }
    const isMgr = await isManager(env, username);

    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return { __err: "请求格式错误" };
    }

    const changes = Array.isArray(body.changes) ? body.changes : [];
    let applied = 0;
    let skipped = 0;
    const errors = [];

    for (const ch of changes) {
      const t = String((ch && ch.table) || "");
      if (SYNC_TABLES.indexOf(t) < 0) {
        errors.push("不允许同步的表: " + t);
        continue;
      }

      // ★ 写权限归属校验：crm/won/lost 非管理员只能改自己归属的行
      if (!isMgr && (t === "crm_projects" || t === "won_projects" || t === "lost_projects")) {
        const row = ch.row || {};
        const me = username.trim().toLowerCase();
        const owner = String(row.owner_user_id || "").trim().toLowerCase();
        const sp = String(row.salesperson || "").trim().toLowerCase();
        if (owner && owner !== me) { skipped++; continue; }
        if (!owner && sp && sp !== me) { skipped++; continue; }
      }

      try {
        if (ch.op === "delete") {
          await env.DB.prepare("DELETE FROM " + t + " WHERE id=?")
            .bind(ch.id).run();
          applied++;
          continue;
        }
        const cols = await getColumns(env, t);
        if (!cols.length) {
          errors.push("无法确定云端列: " + t);
          continue;
        }
        const res = await upsertRow(env, t, ch.row || {}, cols);
        if (res.ok) {
          if (res.skipped) skipped++;
          else applied++;
        } else {
          errors.push(t + "#" + (ch.row && ch.row.id) + ": " + res.error);
        }
      } catch (e) {
        errors.push(t + ": " + String((e && e.message) || e));
      }
    }

    return {
      ok: errors.length === 0,
      applied: applied,
      skipped: skipped,
      errors: errors,
      now: new Date().toISOString().replace("T", " ").slice(0, 19),
    };
  }

  return null;
}
