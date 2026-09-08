// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件逻辑已锁定，未经用户明确同意禁止修改。除 CRM / LOST / WON / 个人佣金 四个模块内的“样板数据 / 演示数据”（清理演示数据用，仅删数据、不改逻辑）外，其余业务逻辑均正确，禁止改动。
// ============================================================
// 价格模块（M9）· 从 R2 读取预生成快照
//
// 设计说明：
//   价格数据的计算很重（月度聚合 + 波峰波谷降采样 + 三币种换算），
//   放在 Worker 里实时算会慢且容易超时。
//   改为：本地 Python 脚本用原 Flask 代码生成好最终响应，存成 JSON 放 R2，
//   这里只负责按 key 读出来直接返回 —— 零计算、秒开。
//
//   数据需要更新时，重跑 build_price_snapshot.py 再上传 R2 即可。
// ============================================================

// 接口路径 -> R2 中的 key
const ROUTE_MAP = {
  "/api/metal-prices": (q) => "metal_" + normCur(q, "USD") + ".json",
  "/api/feed-prices": (q) => "feed_" + normCur(q, "USD") + ".json",
  "/api/livestock-prices": (q) => "livestock_" + normCur(q, "RMB") + ".json",
  "/api/livestock-farmgate": (q) => "farmgate_" + normCur(q, "USD") + ".json",
  "/api/fx-rates": () => "fx.json",
  "/api/livestock-retail-raw": () => "retail_raw.json",
};

function normCur(params, dflt) {
  const c = String(params.get("cur") || dflt).toUpperCase();
  return ["USD", "RMB", "VND"].includes(c) ? c : dflt;
}

export async function handlePrices(request, env, url, pathname) {
  const fn = ROUTE_MAP[pathname];
  if (!fn) return null;

  const key = "price_snapshot.json";
  let snap;
  try {
    const obj = await env.FILES.get(key);
    if (!obj) {
      return {
        __err: "价格数据暂未生成",
        __msg: "云端缺少 price_snapshot.json，请运行 build_price_snapshot.py 后上传 R2",
        __status: 503,
      };
    }
    snap = JSON.parse(await obj.text());
  } catch (e) {
    return { __err: "价格数据读取失败", __msg: String(e), __status: 500 };
  }

  const data = (snap && snap.data) || {};
  const subKey = fn(url.searchParams);
  const payload = data[subKey];

  if (payload === undefined) {
    return {
      __err: "价格数据缺失",
      __msg: "快照中找不到 " + subKey + "，请重新生成快照",
      __status: 503,
    };
  }

  // 附加数据来源标记，便于前端/调试确认
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    payload._src = "r2:" + subKey;
    payload._updated = (snap._meta && snap._meta.generated_at) || "";
  }

  return { body: payload, status: 200 };
}
