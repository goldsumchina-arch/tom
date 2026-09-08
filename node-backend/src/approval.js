// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件逻辑已锁定，未经用户明确同意禁止修改。除 CRM / LOST / WON / 个人佣金 四个模块内的“样板数据 / 演示数据”（清理演示数据用，仅删数据、不改逻辑）外，其余业务逻辑均正确，禁止改动。
// ============================================================
// 审批流模块（M6）
// 复刻本地 app.py 的 /api/approval-requests 逻辑
// ============================================================

// 用户与权限管理审批：审批人锁死为固定三人组，任一人审批即结束
const TRI_APPROVERS = ["tom", "cuong", "james"];
const USR_BLOCKS = ["USR-L1", "USR-D1", "USR-D2", "USR-D3"];
const DEFAULT_INIT_PASSWORD = "66668888";

// 复用用户模块的权限归一化逻辑（销售锁死 / 观察者模板 / 审批人 ID->用户名）
import { normUserPerms, forceSalesLockedPerms, forceObserverPerms } from "./users.js";

function errj(msg, status) {
  return { __err: msg, __status: status };
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

/** 把审批人列表里的数字 ID 换成用户名（兼容历史数据） */
async function normApprovers(env, approvers) {
  if (!Array.isArray(approvers)) return [];
  const users = (await env.DB.prepare("SELECT id, username FROM users").all()).results || [];
  const byId = {}, byName = {};
  for (const u of users) {
    byId[String(u.id)] = u.username;
    byName[String(u.username).toLowerCase()] = u.username;
  }
  const seen = new Set(), out = [];
  for (const v of approvers) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    const name = /^\d+$/.test(s) ? byId[s] : byName[s.toLowerCase()];
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

/** 兜底审批人：tom + 全体管理员 */
async function mgrFallback(env) {
  const fb = ["tom"];
  const rs = (await env.DB.prepare("SELECT username FROM managers").all()).results || [];
  for (const m of rs) if (!fb.includes(m.username)) fb.push(m.username);
  return fb;
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

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
         " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

export async function handleApproval(request, env, url, pathname) {
  // ============ POST /api/approval-requests  发起审批 ============
  if (pathname === "/api/approval-requests" && request.method === "POST") {
    let data;
    try { data = await request.json(); } catch (e) { return errj("请求格式错误", 400); }

    const requester = String(data.requester || "").trim();
    if (!requester) return errj("未登录", 401);

    const blockId = data.block_id || "";
    const blockName = data.block_name || blockId;
    const title = data.title || blockName;
    const content = data.content || "";
    let approvers = data.approvers || [];

    // 审批人以数据库真源为准（避免前端权限快照过期）
    try {
      const row = await env.DB.prepare("SELECT perms FROM users WHERE username=?")
        .bind(requester).first();
      if (row && row.perms) {
        const p = JSON.parse(row.perms);
        const dbApprovers = ((p && p[blockId]) || {}).approvers || [];
        const cleaned = dbApprovers.map((a) => String(a).trim()).filter(Boolean);
        if (cleaned.length) approvers = cleaned;
      }
    } catch (e) { /* 解析失败则用前端传来的 */ }

    if (!approvers || !approvers.length) approvers = await mgrFallback(env);

    const persist = String(data.persist || "persistent").toLowerCase();
    const persistVal = persist === "single-use" ? "single-use" : "persistent";
    const targetId = String(data.target_id || "").trim();

    // 防重复：同一区块同一目标已有待审批则不再创建
    let dupSql = "SELECT id FROM approval_requests WHERE requester=? AND block_id=? AND status='pending' AND persist=?";
    const dupParams = [requester, blockId, persistVal];
    if (persistVal === "single-use") {
      dupSql += " AND target_id=?";
      dupParams.push(targetId);
    }
    const dup = await env.DB.prepare(dupSql).bind(...dupParams).first();
    if (dup) return errj("该操作已存在待审批请求", 409);

    // 用户与权限管理审批：审批人锁死三人组
    if (USR_BLOCKS.includes(blockId)) approvers = TRI_APPROVERS.slice();

    approvers = await normApprovers(env, approvers);

    // 过滤不存在的用户，为空则兜底
    const existing = new Set(
      ((await env.DB.prepare("SELECT username FROM users").all()).results || [])
        .map((u) => u.username)
    );
    approvers = approvers.filter((a) => existing.has(a));
    if (!approvers.length) {
      approvers = (await mgrFallback(env)).filter((a) => existing.has(a));
    }
    if (!approvers.length) return errj("系统中没有可用的审批人", 400);

    await env.DB.prepare(
      "INSERT INTO approval_requests (title, requester, requester_name, block_id, block_name, " +
      "action_name, approvers, status, created_at, content, persist, target_id, payload) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      title, requester, data.requester_name || "", blockId, blockName,
      data.action_name || "", JSON.stringify(approvers), "pending", nowStr(),
      content, persistVal, targetId, data.payload || ""
    ).run();

    return { body: { ok: true }, status: 200 };
  }

  // ============ POST /api/forget-password  忘记密码（免登录）============
  // 用户忘记密码时尚未登录，因此本接口不校验登录态。
  // 流程：按该用户配置的 forgot_approvers 创建一条 PWD-FORGET 审批，
  //       任一审批人"通过"后，密码自动重置为初始密码（见下方 resolve 分支）。
  // 说明：线上此前缺失本接口，导致登录页点「忘记密码」提交后直接失败。
  if (pathname === "/api/forget-password" && request.method === "POST") {
    let data;
    try { data = await request.json(); } catch (e) { return errj("请求格式错误", 400); }

    const username = String(data.username || "").trim().toLowerCase();
    if (!username) return errj("请输入用户名", 400);

    const row = await env.DB.prepare("SELECT * FROM users WHERE username=?")
      .bind(username).first();
    if (!row) return errj("用户名不存在", 404);

    // 该用户的忘记密码审批人（默认 tom；为空则兜底 tom + 全体管理员）
    let approvers = [];
    try {
      approvers = row.forgot_approvers ? JSON.parse(row.forgot_approvers) : [];
    } catch (e) { approvers = []; }
    approvers = approvers.map((a) => String(a).trim()).filter(Boolean);
    if (!approvers.length) approvers = await mgrFallback(env);

    // 只保留系统中真实存在的用户，避免审批单指派给已删除账号
    const existing = new Set(
      ((await env.DB.prepare("SELECT username FROM users").all()).results || [])
        .map((u) => u.username)
    );
    approvers = approvers.filter((a) => existing.has(a));
    if (!approvers.length) return errj("系统中没有可用的审批人", 400);

    // 防重复：同一用户已有待处理的忘记密码审批则不再新建
    const dup = await env.DB.prepare(
      "SELECT id FROM approval_requests WHERE block_id='PWD-FORGET' AND target_id=? AND status='pending'"
    ).bind(username).first();
    if (dup) {
      return { body: { ok: true, message: "already_pending", approvers }, status: 200 };
    }

    const realName = row.real_name || username;
    const now = nowStr();
    await env.DB.prepare(
      "INSERT INTO approval_requests (title, requester, requester_name, block_id, block_name, " +
      "action_name, approvers, status, created_at, content, persist, target_id, payload) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      "忘记密码重置", username, realName, "PWD-FORGET", "Password Reset",
      "忘记密码重置", JSON.stringify(approvers), "pending", now,
      realName + "(" + username + ") 申请重置登录密码", "single-use", username, ""
    ).run();

    await env.DB.prepare(
      "INSERT INTO password_requests (username, status, requested_at, note) VALUES (?,?,?,?)"
    ).bind(username, "pending", now, "sent_to_approvers").run();

    await bumpPermVersion(env, username);
    return { body: { ok: true, message: "sent_to_approvers", approvers }, status: 200 };
  }

  // ============ GET /api/approval-requests  列表 ============
  if (pathname === "/api/approval-requests" && request.method === "GET") {
    const scope = url.searchParams.get("scope") || "all";
    const me = String(url.searchParams.get("me") || "").trim();

    const rs = await env.DB.prepare(
      "SELECT * FROM approval_requests ORDER BY id DESC"
    ).all();
    let items = rs.results || [];

    // 规范化审批人（数字 ID -> 用户名）
    for (const x of items) {
      let arr = [];
      try { arr = x.approvers ? JSON.parse(x.approvers) : []; } catch (e) { arr = []; }
      x.approvers = await normApprovers(env, arr);
    }

    if (scope === "mine") {
      items = items.filter((x) => x.requester === me);
    } else if (scope === "todo") {
      // 待我审批：直接指派给我，或我是某离职审批人的代理人
      const delegated = new Set();
      if (me) {
        const du = (await env.DB.prepare(
          "SELECT username FROM users WHERE delegate_to=? AND status<>'active' AND username<>?"
        ).bind(me, me).all()).results || [];
        for (const d of du) delegated.add(String(d.username));
      }
      items = items.filter(
        (x) => x.status === "pending" &&
          (x.approvers.includes(me) || x.approvers.some((a) => delegated.has(a)))
      );
    }
    return { body: { ok: true, items }, status: 200 };
  }

  // ============ POST /api/approval-requests/<id>/resolve  处理审批 ============
  let m = /^\/api\/approval-requests\/(\d+)\/resolve$/.exec(pathname);
  if (m && request.method === "POST") {
    const rid = parseInt(m[1], 10);
    let data;
    try { data = await request.json(); } catch (e) { return errj("请求格式错误", 400); }

    const action = data.action;
    const resolver = String(data.resolver || "").trim();
    if (action !== "approve" && action !== "reject") return errj("invalid action", 400);

    const row = await env.DB.prepare("SELECT * FROM approval_requests WHERE id=?")
      .bind(rid).first();
    if (!row) return errj("not found", 404);
    if (row.status !== "pending") return errj("已处理", 409);

    let approvers = [];
    try { approvers = row.approvers ? JSON.parse(row.approvers) : []; } catch (e) { approvers = []; }
    approvers = await normApprovers(env, approvers);

    // 校验审批人资格（含离职代理）
    let allowed = approvers.includes(resolver);
    if (!allowed && approvers.length) {
      const ph = approvers.map(() => "?").join(",");
      const dg = (await env.DB.prepare(
        "SELECT username FROM users WHERE delegate_to=? AND status<>'active' AND username IN (" + ph + ")"
      ).bind(resolver, ...approvers).all()).results || [];
      allowed = dg.length > 0;
    }
    if (!allowed) return errj("您不是该审批单的指定审批人", 403);

    const newStatus = action === "approve" ? "approved" : "rejected";
    const note = data.note || data.result_note || "";

    await env.DB.prepare(
      "UPDATE approval_requests SET status=?, resolved_at=?, resolver=?, resolver_name=?, " +
      "result_note=?, approvers=? WHERE id=?"
    ).bind(
      newStatus, nowStr(), resolver, data.resolver_name || "", note,
      JSON.stringify(approvers), rid
    ).run();

    // 忘记密码审批：通过 → 密码重置为初始密码
    if (row.block_id === "PWD-FORGET") {
      const target = row.target_id || row.requester;
      if (newStatus === "approved") {
        await env.DB.prepare("UPDATE users SET password=? WHERE username=?")
          .bind(DEFAULT_INIT_PASSWORD, target).run();
        await env.DB.prepare(
          "UPDATE password_requests SET status='processed', processed_at=?, note='approved_reset' " +
          "WHERE username=? AND status='pending'"
        ).bind(nowStr(), target).run();
      } else {
        await env.DB.prepare(
          "UPDATE password_requests SET status='rejected', processed_at=?, note='rejected' " +
          "WHERE username=? AND status='pending'"
        ).bind(nowStr(), target).run();
      }
      await bumpPermVersion(env, row.requester);
      return { body: { ok: true, status: newStatus }, status: 200 };
  }

  // ============ 用户与权限管理审批：通过后按 payload 落地 ============
  // 设计：被授权人（USR-D1/D2/D3=允许）提交后须经 tom/cuong/james 任一人审批，
  //       审批通过后由本分支真正写入 users 表（此前实现漏掉了这步，导致授权“提交即丢失”）。
  if (USR_BLOCKS.includes(row.block_id)) {
    let pl = {};
    try { pl = row.payload ? JSON.parse(row.payload) : {}; } catch (e) { pl = {}; }
    if (newStatus === "approved") {
      if (row.block_id === "USR-D2") {
        // 新增用户：审批通过后建号（初始密码 66668888）
        const username = String(pl.login || "").trim().toLowerCase();
        const realName = String(pl.name || "").trim();
        if (username && realName) {
          const exist = await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first();
          if (!exist) {
            const maxRow = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM users").first();
            const sortOrder = (maxRow && Number(maxRow.m) || 0) + 1000;
            const visMe = Array.isArray(pl.vis_can_see_me) ? pl.vis_can_see_me : [];
            const visHe = Array.isArray(pl.vis_he_can_see) ? pl.vis_he_can_see : [];
            let perms = pl.perms || {};
            perms = forceSalesLockedPerms(perms, pl.position);
            perms = forceObserverPerms(perms, pl.position);
            perms = await normUserPerms(env, perms);
            let forgot = Array.isArray(pl.forgot_approvers) ? pl.forgot_approvers : ["tom"];
            forgot = forgot.map((x) => String(x).trim()).filter(Boolean);
            if (!forgot.includes("tom")) forgot.unshift("tom");
            await env.DB.prepare(
              "INSERT INTO users (username, password, real_name, role, position, status, " +
              "vis_can_see_me, vis_he_can_see, perms, forgot_approvers, created_at, sort_order) " +
              "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
            ).bind(
              username, DEFAULT_INIT_PASSWORD, realName, "user", pl.position || "", pl.status || "active",
              JSON.stringify(visMe), JSON.stringify(visHe), JSON.stringify(perms),
              JSON.stringify(forgot.slice(0, 3)), nowStr(), sortOrder
            ).run();
          }
        }
      } else if (row.block_id === "USR-D1") {
        // 编辑用户权限：写 perms + 数据范围（vis_*）+ 基础资料
        const uid = parseInt(pl.uid, 10);
        if (uid) {
          const tgt = await env.DB.prepare("SELECT id, username FROM users WHERE id=?").bind(uid).first();
          if (tgt) {
            const visMe = Array.isArray(pl.vis_can_see_me) ? pl.vis_can_see_me : [];
            const visHe = Array.isArray(pl.vis_he_can_see) ? pl.vis_he_can_see : [];
            let perms = pl.perms || {};
            perms = forceSalesLockedPerms(perms, pl.position);
            perms = forceObserverPerms(perms, pl.position);
            perms = await normUserPerms(env, perms);
            const delegateTo = String(pl.delegate_to || "").trim();
            await env.DB.prepare(
              "UPDATE users SET real_name=?, position=?, status=?, vis_can_see_me=?, " +
              "vis_he_can_see=?, perms=?, delegate_to=? WHERE id=?"
            ).bind(
              pl.name || "", pl.position || "", pl.status || "active",
              JSON.stringify(visMe), JSON.stringify(visHe), JSON.stringify(perms), delegateTo, uid
            ).run();
          }
        }
      } else if (row.block_id === "USR-D3") {
        // 删除/停用用户：审批通过后物理删除
        const uid = parseInt(pl.uid, 10);
        if (uid) {
          await env.DB.prepare("DELETE FROM users WHERE id=?").bind(uid).run();
        }
      }
      // 同步管理员名单（payload 携带期望名单；仅在有值时覆盖，避免误清空）
      if (Array.isArray(pl.managers) && pl.managers.length) {
        const managers = pl.managers.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
        if (managers.length) {
          await env.DB.prepare("DELETE FROM managers").run();
          for (const mg of managers) {
            await env.DB.prepare("INSERT INTO managers (username) VALUES (?)").bind(mg).run();
          }
        }
      }
    }
    await bumpPermVersion(env, row.requester);
    return { body: { ok: true, status: newStatus }, status: 200 };
  }

    await bumpPermVersion(env, row.requester);
    return { body: { ok: true, status: newStatus }, status: 200 };
  }

  // ============ DELETE /api/approval-requests/<id> ============
  m = /^\/api\/approval-requests\/(\d+)$/.exec(pathname);
  if (m && request.method === "DELETE") {
    const rid = parseInt(m[1], 10);
    await env.DB.prepare("DELETE FROM approval_requests WHERE id=?").bind(rid).run();
    return { body: { ok: true }, status: 200 };
  }

  return null;
}
