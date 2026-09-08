// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件逻辑已锁定，未经用户明确同意禁止修改。除 CRM / LOST / WON / 个人佣金 四个模块内的“样板数据 / 演示数据”（清理演示数据用，仅删数据、不改逻辑）外，其余业务逻辑均正确，禁止改动。
// 看板聚合统计接口（2026-09-06）
// 合并 CRM / WON / LOST 的计数与三币汇总，单次返回，
// 避免前端为渲染看板卡片而全量拉取三张表（大幅降低 D1 行读）。
import { getCrmStats } from "./crm.js";
import { getWonStats, getLostStats } from "./wonlost.js";

export async function handleDashStats(request, env, url, pathname) {
  if (pathname !== "/api/dashboard-stats" || request.method !== "GET") return null;
  const username = (
    request.headers.get("X-User-Name") ||
    url.searchParams.get("me") ||
    ""
  ).trim();
  try {
    const [crm, won, lost] = await Promise.all([
      getCrmStats(env, username),
      getWonStats(env, username),
      getLostStats(env, username),
    ]);
    return { body: { ok: true, crm, won, lost }, status: 200 };
  } catch (e) {
    return { body: { ok: false, error: String((e && e.message) || e) }, status: 500 };
  }
}
