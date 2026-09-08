// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件逻辑已锁定，未经用户明确同意禁止修改。除 CRM / LOST / WON / 个人佣金 四个模块内的“样板数据 / 演示数据”（清理演示数据用，仅删数据、不改逻辑）外，其余业务逻辑均正确，禁止改动。
// ============================================================
// D1 用量统计（走 Cloudflare 官方 GraphQL Analytics API）
//
// ★ 关键：查询这个 API 不消耗任何 D1 行读 / 行写（它读的是 Cloudflare
//   自己的分析数据集，不是我们的业务库），所以对免费额度是【零开销】。
//   之前考虑过的"自建 usage_daily 计量表"因此完全不需要了。
//
// 数据源：d1AnalyticsAdaptiveGroups
//   sum { rowsRead rowsWritten }  按 date + databaseId 过滤
//   也就是 Cloudflare 后台 D1 → Metrics 页面显示的那些数字。
//
// 免费额度（Workers Free）：500 万行读/天，UTC 00:00 重置。
// ============================================================

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

// Workers Free 的 D1 每日行读上限；可用 env.D1_DAILY_READ_LIMIT 覆盖
const DEFAULT_DAILY_READ_LIMIT = 5000000;
// 达到该百分比后熔断：只放行 tom，其余人禁止使用
const LOCK_PCT = 95;
// 每个 Worker 实例的缓存时间（毫秒）：避免每请求都打 Cloudflare API
const CACHE_TTL_MS = 60000;

// 每个 Worker 实例独立缓存（无需 KV / D1，零存储依赖）
let CACHE = { ts: 0, day: "", rowsRead: 0, rowsWritten: 0, ok: false };
// 最近一次查询失败的原因（诊断用，只暴露给 tom，不含任何密钥信息）
let LAST_QERR = "";

function todayUTC() {
  // D1 配额按 UTC 00:00 重置，所以"今天"必须按 UTC 算
  return new Date().toISOString().slice(0, 10);
}

function dailyLimit(env) {
  const n = Number(env.D1_DAILY_READ_LIMIT);
  return n > 0 ? n : DEFAULT_DAILY_READ_LIMIT;
}

/**
 * 调用官方 GraphQL Analytics API 取当日行读/行写。
 * 失败返回 null（调用方保持"开放"状态，绝不因为统计失效误伤用户）。
 */
async function queryGraphQL(env, day) {
  // ★ 必须 trim：密钥经管道写入时可能带上 \r\n（HTTP 400 / token 长度多 2 的根因）
  const token = String(env.CF_ANALYTICS_TOKEN || "").trim();
  const accountTag = env.CF_ACCOUNT_ID;
  if (!token || !accountTag) return null;

  const databaseId = env.CF_D1_DATABASE_ID || "";
  const query =
    "query($accountTag:string!, $start:Date, $end:Date, $databaseId:string){" +
    "viewer{accounts(filter:{accountTag:$accountTag}){" +
    "d1AnalyticsAdaptiveGroups(limit:1," +
    "filter:{date_geq:$start, date_leq:$end, databaseId:$databaseId}){" +
    "sum{rowsRead rowsWritten}}}}}";

  const variables = { accountTag, start: day, end: day, databaseId };

  try {
    const r = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!r.ok) {
      LAST_QERR = "HTTP " + r.status;
      return null;
    }
    const j = await r.json();
    if (j && j.errors && j.errors.length) {
      LAST_QERR = String((j.errors[0] && j.errors[0].message) || "graphql error");
      return null;
    }
    const groups =
      (j &&
        j.data &&
        j.data.viewer &&
        j.data.viewer.accounts &&
        j.data.viewer.accounts[0] &&
        j.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups) ||
      [];
    const s = (groups[0] && groups[0].sum) || {};
    LAST_QERR = "";
    return {
      rowsRead: Number(s.rowsRead || 0),
      rowsWritten: Number(s.rowsWritten || 0),
    };
  } catch (e) {
    LAST_QERR = String((e && e.message) || e);
    return null;
  }
}

function decorate(c, env, day) {
  const limit = dailyLimit(env);
  const used = Number(c.rowsRead || 0);
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  return {
    day: day,
    limit: limit,
    rowsRead: used,
    rowsWritten: Number(c.rowsWritten || 0),
    remaining: Math.max(0, limit - used),
    pct: Math.round(pct * 100) / 100,
    locked: pct >= LOCK_PCT,
    // stale=true 表示拿不到官方数据（未配置 token 或 API 故障），
    // 此时一律不熔断，保证业务可用
    stale: !c.ok,
    err: c.ok ? "" : LAST_QERR,
  };
}

/**
 * 取当日用量（带 60 秒实例级缓存）。
 * force=true 时强制刷新（tom 点开报告时用，保证看到最新值）。
 */
export async function getD1Usage(env, force) {
  const day = todayUTC();
  const now = Date.now();

  if (!force && CACHE.ok && CACHE.day === day && now - CACHE.ts < CACHE_TTL_MS) {
    return decorate(CACHE, env, day);
  }

  const fresh = await queryGraphQL(env, day);
  if (fresh) {
    CACHE = { ts: now, day: day, ...fresh, ok: true };
    return decorate(CACHE, env, day);
  }

  // 查不到：沿用上次成功的值（跨天则归零），并标记 stale
  if (CACHE.ok && CACHE.day === day) return decorate(CACHE, env, day);
  return decorate({ rowsRead: 0, rowsWritten: 0, ok: false }, env, day);
}

/**
 * 95% 熔断判断：tom 永远放行；其余人在超额时返回用量对象（表示被拦）。
 * 未超额 / 拿不到数据时返回 null（放行）。
 */
export async function quotaBlocks(env, username) {
  const u = String(username || "").trim().toLowerCase();
  if (!u || u === "tom") return null; // tom 不受限
  const usage = await getD1Usage(env);
  if (usage.stale) return null; // 统计不可用时不拦人
  return usage.locked ? usage : null;
}
