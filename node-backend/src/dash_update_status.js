// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件逻辑已锁定，未经用户明确同意禁止修改。除 CRM / LOST / WON / 个人佣金 四个模块内的“样板数据 / 演示数据”（清理演示数据用，仅删数据、不改逻辑）外，其余业务逻辑均正确，禁止改动。
// ============================================================
// 看板当月更新情况检查（M??）
// GET /api/dashboard-update-status
// 检查 R2 price_snapshot.json 等快照生成时间，返回自动按月更新项目状态。
// 价格走势类依赖 price_snapshot.json；看板统计类为实时计算，始终 YES。
// ============================================================

const PRICE_SNAPSHOT_KEY = "price_snapshot.json";

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

export async function handleDashUpdateStatus(request, env, url, pathname) {
  if (pathname !== "/api/dashboard-update-status" || request.method !== "GET") return null;

  const username = request.headers.get("X-User-Name") || "";
  if (!username) {
    return {
      status: 401,
      body: { ok: false, error: "未登录或会话已过期", code: "NO_AUTH" },
    };
  }

  // 权限检查：管理员或 DB-UP 决策不是 hide 的用户可查看
  let perms = {};
  let isAdmin = false;
  try {
    const row = await env.DB.prepare(
      "SELECT perms, role FROM users WHERE username=?"
    )
      .bind(username)
      .first();
    if (row) {
      isAdmin = row.role === "管理员";
      try {
        perms = row.perms ? JSON.parse(row.perms) : {};
      } catch (e) {}
    }
  } catch (e) {
    return {
      status: 500,
      body: { ok: false, error: "读取用户权限失败: " + String(e) },
    };
  }
  const up = perms["DB-UP"] || {};
  if (!isAdmin && up.decision === "hide") {
    return { status: 403, body: { ok: false, error: "无权限查看当月更新情况" } };
  }

  const now = new Date();
  const som = startOfMonth(now);

  // 读取 R2 快照最新修改时间
  let snapMeta = null;
  let snapErr = null;
  try {
    const obj = await env.FILES.head(PRICE_SNAPSHOT_KEY);
    if (obj && obj.httpMetadata && obj.httpMetadata.lastModified) {
      snapMeta = new Date(obj.httpMetadata.lastModified);
    }
  } catch (e) {
    snapErr = String(e.message || e);
  }

  let snapStatus = "NO";
  let snapReason = "NO_SNAPSHOT";
  let snapUpdated = "";
  if (snapMeta) {
    snapUpdated = snapMeta.toISOString();
    if (snapMeta >= som) {
      snapStatus = "YES";
      snapReason = "OK";
    } else {
      snapReason = "NOT_CURRENT_MONTH";
    }
  } else if (snapErr) {
    snapReason = "R2_ERROR";
  }

  // 按月/按实时 分类的项目
  const items = [
    { id: 1, category: "price", key: "metal", auto: "monthly", status: snapStatus, reasonKey: snapReason, updatedAt: snapUpdated },
    { id: 2, category: "price", key: "feed", auto: "monthly", status: snapStatus, reasonKey: snapReason, updatedAt: snapUpdated },
    { id: 3, category: "price", key: "livestock", auto: "monthly", status: snapStatus, reasonKey: snapReason, updatedAt: snapUpdated },
    { id: 4, category: "price", key: "farmgate", auto: "monthly", status: snapStatus, reasonKey: snapReason, updatedAt: snapUpdated },
    { id: 5, category: "price", key: "fx", auto: "monthly", status: snapStatus, reasonKey: snapReason, updatedAt: snapUpdated },
    { id: 6, category: "price", key: "retail_raw", auto: "monthly", status: snapStatus, reasonKey: snapReason, updatedAt: snapUpdated },
    { id: 7, category: "dashboard", key: "login_stats", auto: "live", status: "YES", reasonKey: "LIVE", updatedAt: now.toISOString() },
    { id: 8, category: "dashboard", key: "project_stats", auto: "live", status: "YES", reasonKey: "LIVE", updatedAt: now.toISOString() },
  ];

  return {
    status: 200,
    body: {
      ok: true,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      generatedAt: now.toISOString(),
      snapshotKey: PRICE_SNAPSHOT_KEY,
      snapshotError: snapErr,
      items,
    },
  };
}
