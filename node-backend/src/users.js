// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件逻辑已锁定，未经用户明确同意禁止修改。除 CRM / LOST / WON / 个人佣金 四个模块内的“样板数据 / 演示数据”（清理演示数据用，仅删数据、不改逻辑）外，其余业务逻辑均正确，禁止改动。
// 2026-09-06 修复：GET 返回 vis_he_can_see/vis_can_see_me/forgot_approvers 数字数组（兼容旧格式字符串用户名）；
// 审批落地逻辑在 approval.js 的 resolve 分支实现（USR-D1/D2/D3 经三人组审批后真正写入 users 表）。
// ============================================================
// 用户与权限管理模块（M7）
// 复刻本地 app.py 的 /api/users 与 /api/managers
// ============================================================

const TRI_APPROVERS = ["tom", "cuong", "james"];
const DEFAULT_INIT_PASSWORD = "66668888";

// 销售/销售总监的 WON 锁死权限：这 5 项一律强制 hide
const SALES_LOCKED_WON_PERMS = ["WON-D2", "WON-D3", "WON-N1", "WON-C1", "WON-P345"];

// 观察者预设模板：仅在区块【完全未配置】时填初始值（管理员可自由修改）
const OBSERVER_FIXED_PERMS = {
  "DB-S1": "default", "DB-P1": "default", "DB-B1": "default", "DB-C1": "default",
  "US-LH1": "default", "US-LH2": "default",
  "DB-MT1": "default", "DB-FD1": "default", "DB-LS1": "default", "DB-FX1": "default",
  "CRM-L1": "all", "CRM-D1": "default", "CRM-D2": "hide", "CRM-D3": "hide",
  "CRM-F1": "approve", "CRM-N1": "hide", "CRM-E1": "default",
  "WON-L1": "default", "WON-D1": "default", "WON-D2": "hide", "WON-D3": "hide",
  "WON-D4": "default", "WON-E1": "default", "WON-N1": "hide", "WON-C1": "hide",
  "WON-P345": "hide",
  "LOST-L1": "all", "LOST-D1": "default", "LOST-D2": "hide", "LOST-D3": "hide",
  "LOST-R1": "approve", "LOST-E1": "default",
};

function errj(msg, status) {
  return { __err: msg, __status: status };
}

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
         " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

async function isManager(env, username) {
  if (!username) return false;
  const m = await env.DB.prepare("SELECT 1 AS x FROM managers WHERE username=?")
    .bind(username).first();
  if (m) return true;
  const u = await env.DB.prepare("SELECT role FROM users WHERE username=?")
    .bind(username).first();
  return !!(u && u.role === "管理员");
}

async function managerUsernames(env) {
  const rs = (await env.DB.prepare("SELECT username FROM managers ORDER BY username").all()).results || [];
  return rs.map((r) => r.username);
}

/** 规范化 perms 中的审批人（数字 ID -> 用户名） */
export async function normUserPerms(env, perms) {
  if (!perms || typeof perms !== "object") return perms || {};
  const users = (await env.DB.prepare("SELECT id, username FROM users").all()).results || [];
  const byId = {}, byName = {};
  for (const u of users) {
    byId[String(u.id)] = u.username;
    byName[String(u.username).toLowerCase()] = u.username;
  }
  for (const bid of Object.keys(perms)) {
    const p = perms[bid];
    if (p && typeof p === "object" && Array.isArray(p.approvers)) {
      const seen = new Set(), out = [];
      for (const v of p.approvers) {
        if (v == null) continue;
        const s = String(v).trim();
        if (!s) continue;
        const name = /^\d+$/.test(s) ? byId[s] : byName[s.toLowerCase()];
        if (name && !seen.has(name)) { seen.add(name); out.push(name); }
      }
      p.approvers = out;
    }
  }
  return perms;
}

/** 销售/销售总监的 WON 权限锁死为 hide */
export function forceSalesLockedPerms(perms, position) {
  const pos = String(position || "").trim();
  if (pos !== "销售" && pos !== "销售总监") return perms;
  if (!perms || typeof perms !== "object") return perms;
  for (const bid of SALES_LOCKED_WON_PERMS) {
    const blk = perms[bid];
    if (blk && typeof blk === "object") {
      blk.decision = "hide";
      blk.approvers = [];
    } else {
      perms[bid] = { decision: "hide", approvers: [] };
    }
  }
  return perms;
}

/** 观察者：未配置的区块按模板填初始值（已有配置不动） */
export function forceObserverPerms(perms, position) {
  if (String(position || "").trim() !== "观察者") return perms;
  if (!perms || typeof perms !== "object") perms = {};
  for (const [bid, dec] of Object.entries(OBSERVER_FIXED_PERMS)) {
    if (!(bid in perms)) perms[bid] = { decision: dec, approvers: [] };
  }
  return perms;
}

/** 用户管理写操作闸门：direct=直达 / allow=需审批 / deny=无权限 */
async function usrOpGate(env, op, bid) {
  if (!op) return "deny";
  if (TRI_APPROVERS.some((x) => x.toLowerCase() === op.toLowerCase())) return "direct";
  if (await isManager(env, op)) return "direct";
  const row = await env.DB.prepare("SELECT perms FROM users WHERE username=?")
    .bind(op).first();
  if (row && row.perms) {
    try {
      const p = JSON.parse(row.perms);
      const dec = String(((p && p[bid]) || {}).decision || "").trim().toLowerCase();
      if (dec === "allow") return "allow";
    } catch (e) { /* ignore */ }
  }
  return "deny";
}

/** 权限版本号 +1 */
async function bumpPermVersion(env, username) {
  const key = "permver:" + username;
  const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key=?")
    .bind(key).first();
  const next = row ? (parseInt(row.value, 10) || 0) + 1 : 1;
  await env.DB.prepare(
    "INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) " +
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  ).bind(key, String(next)).run();
}

export async function handleUsers(request, env, url, pathname) {
  const op = String(
    request.headers.get("X-User-Name") || url.searchParams.get("me") || ""
  ).trim();

  // ================= GET /api/users =================
  if (pathname === "/api/users" && request.method === "GET") {
    const managers = await managerUsernames(env);
    const mgrSet = new Set(managers);
    const rs = (await env.DB.prepare("SELECT * FROM users ORDER BY sort_order ASC, id ASC").all()).results || [];
    // 用户名 -> id 映射，用于把旧格式（存字符串用户名）的数据范围授权归一化为数字 id
    const nameToId = {};
    for (const r of rs) nameToId[String(r.username).toLowerCase()] = r.id;
    const users = [];
    for (const r of rs) {
      let perms = {};
      try { perms = r.perms ? JSON.parse(r.perms) : {}; } catch (e) { perms = {}; }
      perms = await normUserPerms(env, perms);
      const parseIds = (raw) => {
        try {
          const v = JSON.parse(raw || "[]");
          if (!Array.isArray(v)) return [];
          const out = [];
          for (const x of v) {
            if (typeof x === "number" && !isNaN(x)) { out.push(x); }
            else if (typeof x === "string") {
              const s = x.trim();
              if (/^\d+$/.test(s)) { out.push(parseInt(s, 10)); }       // 数字字符串
              else if (nameToId[s.toLowerCase()] != null) { out.push(nameToId[s.toLowerCase()]); } // 旧格式用户名
            }
          }
          return out;
        } catch (e) { return []; }
      };
      users.push({
        id: r.id,
        username: r.username,
        real_name: r.real_name || "",
        role: r.role || "user",
        position: r.position || "",
        status: r.status || "active",
        is_manager: mgrSet.has(r.username),
        vis_can_see_me: parseIds(r.vis_can_see_me),
        vis_he_can_see: parseIds(r.vis_he_can_see),
        perms: perms,
        delegate_to: r.delegate_to || "",
        forgot_approvers: parseIds(r.forgot_approvers),
        created_at: r.created_at || "",
      });
    }
    return { body: { ok: true, users, managers: managers.sort() }, status: 200 };
  }

  // ================= POST /api/users  新增 =================
  if (pathname === "/api/users" && request.method === "POST") {
    let data;
    try { data = await request.json(); } catch (e) { return errj("请求格式错误", 400); }

    const gate = await usrOpGate(env, op, "USR-D2");
    if (gate !== "direct") {
      return errj(gate === "deny" ? "无权限：新增用户未对你开放" : "该操作需经审批流程", 403);
    }

    // 账号一律小写（与登录名一致）：避免同名不同大小写造成权限、数据范围、
    // 销售归属统计错乱。前端已限制，这里做服务端兜底，接口直接调用也逃不掉。
    const username = String(data.username || "").trim().toLowerCase();
    const realName = String(data.real_name || "").trim();
    const position = data.position || "";
    const status = data.status || "active";
    const visMe = data.vis_can_see_me || [];
    const visHe = data.vis_he_can_see || [];
    let perms = data.perms || {};
    let forgot = data.forgot_approvers || ["tom"];

    if (!username || !realName) return errj("姓名和账号不能为空", 400);
    // 账号只允许小写字母和数字（与前端规则一致，接口层面再拦一次）
    if (!/^[a-z0-9]+$/.test(username)) {
      return errj("登录账号只能使用小写字母和数字", 400);
    }

    perms = await normUserPerms(env, perms);
    perms = forceSalesLockedPerms(perms, position);
    perms = forceObserverPerms(perms, position);

    const exists = await env.DB.prepare("SELECT id FROM users WHERE username=?")
      .bind(username).first();
    if (exists) return errj("账号已存在", 400);

    // 忘记密码审批人：tom 必在，最多 3 人
    let fa = (Array.isArray(forgot) ? forgot : [])
      .map((x) => String(x).trim()).filter(Boolean);
    if (!fa.includes("tom")) fa.unshift("tom");
    fa = fa.slice(0, 3);

    // 新建用户默认排在末尾：取当前最大 sort_order + 1000
    const maxRow = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM users").first();
    const sortOrder = (maxRow && Number(maxRow.m) || 0) + 1000;

    const ins = await env.DB.prepare(
      "INSERT INTO users (username, password, real_name, role, position, status, " +
      "vis_can_see_me, vis_he_can_see, perms, forgot_approvers, created_at, sort_order) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      username, DEFAULT_INIT_PASSWORD, realName, "user", position, status,
      JSON.stringify(visMe), JSON.stringify(visHe), JSON.stringify(perms),
      JSON.stringify(fa), nowStr(), sortOrder
    ).run();

    return { body: { ok: true, id: ins.meta && ins.meta.last_row_id, message: "保存成功" }, status: 200 };
  }

  // ================= GET /api/managers =================
  if (pathname === "/api/managers" && request.method === "GET") {
    return { body: { ok: true, managers: (await managerUsernames(env)).sort() }, status: 200 };
  }

  // ================= PUT /api/managers  任命管理员 =================
  if (pathname === "/api/managers" && request.method === "PUT") {
    let data;
    try { data = await request.json(); } catch (e) { return errj("请求格式错误", 400); }

    let managers = (data.managers || [])
      .map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    managers = [...new Set(managers)].sort();

    if (!managers.includes("tom")) return errj("tom 必须是管理员之一", 400);
    if (managers.length < 2 || managers.length > 4) return errj("管理人员数量必须在 2-4 人之间", 400);

    const ph = managers.map(() => "?").join(",");
    const rs = (await env.DB.prepare(
      "SELECT username FROM users WHERE lower(username) IN (" + ph + ")"
    ).bind(...managers).all()).results || [];
    const existing = new Set(rs.map((r) => String(r.username).toLowerCase()));
    const missing = managers.filter((m) => !existing.has(m));
    if (missing.length) return errj("以下账号不存在: " + missing.join(", "), 400);

    await env.DB.prepare("DELETE FROM managers").run();
    for (const m of managers) {
      await env.DB.prepare("INSERT INTO managers (username) VALUES (?)").bind(m).run();
    }
    return { body: { ok: true, managers }, status: 200 };
  }

  // ================= /api/users/<uid> =================
  const m = /^\/api\/users\/(\d+)$/.exec(pathname);
  if (m) {
    const uid = parseInt(m[1], 10);

    // PUT 修改
    if (request.method === "PUT") {
      let data;
      try { data = await request.json(); } catch (e) { return errj("请求格式错误", 400); }

      const gate = await usrOpGate(env, op, "USR-D1");
      if (gate !== "direct") {
        return errj(gate === "deny" ? "无权限：编辑用户权限未对你开放" : "该操作需经审批流程", 403);
      }

      const realName = String(data.real_name || "").trim();
      const position = data.position || "";
      const status = data.status || "active";
      const visMe = data.vis_can_see_me || [];
      const visHe = data.vis_he_can_see || [];
      let perms = data.perms || {};
      const delegateTo = String(data.delegate_to || "").trim();
      const forgotApprovers = data.forgot_approvers;

      if (!realName) return errj("姓名不能为空", 400);

      perms = await normUserPerms(env, perms);
      perms = forceSalesLockedPerms(perms, position);
      perms = forceObserverPerms(perms, position);

      const row = await env.DB.prepare("SELECT id, username, position FROM users WHERE id=?")
        .bind(uid).first();
      if (!row) return errj("用户不存在", 404);

      // 职位从销售改为其他：若 WON-L1 仍是销售缺省的 hide，则改回 default
      const oldPos = String(row.position || "").trim();
      const newPos = String(position || "").trim();
      if ((oldPos === "销售" || oldPos === "销售总监") &&
          newPos !== "销售" && newPos !== "销售总监") {
        const blk = perms["WON-L1"];
        if (blk && typeof blk === "object" && blk.decision === "hide") blk.decision = "default";
      }

      // 离职代理不能指向本人
      if (delegateTo && row.username === delegateTo) return errj("离职代理不能设置为本人", 400);

      await env.DB.prepare(
        "UPDATE users SET real_name=?, position=?, status=?, vis_can_see_me=?, " +
        "vis_he_can_see=?, perms=?, delegate_to=? WHERE id=?"
      ).bind(
        realName, position, status, JSON.stringify(visMe), JSON.stringify(visHe),
        JSON.stringify(perms), delegateTo, uid
      ).run();

      if (forgotApprovers != null) {
        let fa = (Array.isArray(forgotApprovers) ? forgotApprovers : [])
          .map((x) => String(x).trim()).filter(Boolean);
        if (!fa.includes("tom")) fa.unshift("tom");
        await env.DB.prepare("UPDATE users SET forgot_approvers=? WHERE id=?")
          .bind(JSON.stringify(fa.slice(0, 3)), uid).run();
      }

      await bumpPermVersion(env, row.username);
      return { body: { ok: true, message: "保存成功" }, status: 200 };
    }

    // DELETE 删除
    if (request.method === "DELETE") {
      const gate = await usrOpGate(env, op, "USR-D3");
      if (gate !== "direct") {
        return errj(gate === "deny" ? "无权限：删除/停用用户未对你开放" : "该操作需经审批流程", 403);
      }
      const row = await env.DB.prepare("SELECT username FROM users WHERE id=?")
        .bind(uid).first();
      await env.DB.prepare("DELETE FROM users WHERE id=?").bind(uid).run();
      if (row) {
        await env.DB.prepare("DELETE FROM managers WHERE lower(username)=lower(?)")
          .bind(row.username).run();
        await bumpPermVersion(env, row.username);
      }
      return { body: { ok: true, message: "删除成功" }, status: 200 };
    }
  }

  // ================= PUT /api/users/reorder  调整用户顺序 =================
  if (pathname === "/api/users/reorder" && request.method === "PUT") {
    let data;
    try { data = await request.json(); } catch (e) { return errj("请求格式错误", 400); }

    // 仅 tom/cuong/james 或管理员可调整顺序
    const direct = TRI_APPROVERS.some((x) => x.toLowerCase() === op.toLowerCase()) || await isManager(env, op);
    if (!direct) return errj("无权限：仅管理员或指定审批人可调整顺序", 403);

    const orders = data.orders || [];
    for (const o of orders) {
      const uid = o.id;
      const so = o.sort_order;
      if (uid == null || so == null) continue;
      await env.DB.prepare("UPDATE users SET sort_order=? WHERE id=?").bind(Number(so), Number(uid)).run();
    }
    return { body: { ok: true, message: "顺序已保存" }, status: 200 };
  }

  return null;
}
