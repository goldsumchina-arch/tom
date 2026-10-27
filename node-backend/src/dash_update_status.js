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

  // 读取快照自身的生成时间 / 最新月份
  // ★DASH-STATUS-FIX-20261027★ 旧实现依赖 head().httpMetadata.lastModified，
  //   但本地文件版 R2 兼容层(filesshim.head)并不返回 httpMetadata →
  //   snapMeta 恒为 null，接口永远报 NO/NO_SNAPSHOT，等于没有监控。
  //   现在直接读快照内容里的 _meta.generated_at / _meta.newest_month（与 shim 无关）。
  let snapMeta = null;
  let snapErr = null;
  let snapNewest = "";
  let snapMonth = "";
  let snapUpdatedRaw = "";
  try {
    const obj = await env.FILES.get(PRICE_SNAPSHOT_KEY);
    if (!obj) {
      snapErr = null;
    } else {
      const snap = JSON.parse(await obj.text());
      const meta = (snap && snap._meta) || {};
      const g = meta.generated_at ? String(meta.generated_at) : "";
      if (g) {
        snapUpdatedRaw = g;
        snapMonth = g.slice(0, 7);            // "2026-10"
        snapMeta = new Date(g.replace(" ", "T") + "Z");
      }
      snapNewest = meta.newest_month ? String(meta.newest_month) : snapMonth;
      if (!snapMonth && snapNewest) snapMonth = snapNewest;
    }
  } catch (e) {
    snapErr = String(e.message || e);
  }

  const nowYm = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  let snapStatus = "NO";
  let snapReason = "NO_SNAPSHOT";
  let snapUpdated = snapUpdatedRaw;
  if (snapMonth) {
    if (snapMonth >= nowYm) {
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
