// ============================================================
// 最新一期汇率（CRM 报价汇率自动填充用）
//
// GET /api/fx-latest
//   → { ok, date, is_today, usd_vnd, usd_cny, cny_vnd, source }
//
// 取值优先级：
//   ① Yahoo Finance 日线（USDVND=X / USDCNY=X）的最后一个收盘价 —— 即"当日汇率"；
//      若当日还没收盘/未同步，返回的 date 就是上一交易日，前端据此提示"沿用上一日汇率"。
//   ② Yahoo 失败（数据中心 IP 被限流等）时，回退到 R2 里 price_snapshot.json 的
//      fx.json（月度聚合）最后一个非空点，保证接口永远有值。
//
// 结果在内存里缓存 10 分钟：CRM 每次开弹窗都会请求，不能每次都打外网。
// ============================================================

const CACHE_MS = 10 * 60 * 1000;
let _cache = { at: 0, data: null };

function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
}

async function yahooLastClose(symbol) {
  const u = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) +
    "?range=15d&interval=1d";
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error("yahoo HTTP " + r.status);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.timestamp) throw new Error("yahoo empty");
  const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0]
    && res.indicators.quote[0].close) || [];
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] !== null && closes[i] !== undefined) {
      return { value: Number(closes[i]), date: ymd(new Date(res.timestamp[i] * 1000)) };
    }
  }
  throw new Error("yahoo no close");
}

function lastNonNull(arr) {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined) return Number(arr[i]);
  }
  return null;
}

async function fromR2(env) {
  const obj = await env.FILES.get("price_snapshot.json");
  if (!obj) return null;
  const snap = JSON.parse(await obj.text());
  const fx = (snap && snap.data && snap.data["fx.json"]) || {};
  const s = fx.series || {};
  const usdVnd = lastNonNull(s.usd_vnd);
  const usdCny = lastNonNull(s.usd_cny);
  if (!usdVnd || !usdCny) return null;
  return {
    usd_vnd: usdVnd,
    usd_cny: usdCny,
    date: (fx.labels || []).slice(-1)[0] || "",
    source: "r2-monthly",
  };
}

async function build(env) {
  const today = ymd(new Date());
  let usdVnd = null, usdCny = null, date = "", source = "";
  try {
    const [a, b] = await Promise.all([yahooLastClose("USDVND=X"), yahooLastClose("USDCNY=X")]);
    usdVnd = a.value; usdCny = b.value;
    date = a.date > b.date ? a.date : b.date;
    source = "yahoo-daily";
  } catch (e) {
    source = "fallback";
  }
  if (!usdVnd || !usdCny) {
    try {
      const f = await fromR2(env);
      if (f) {
        usdVnd = f.usd_vnd; usdCny = f.usd_cny; date = f.date;
        source = source === "fallback" ? "r2-monthly" : source;
      }
    } catch (e) { /* 忽略 */ }
  }
  const data = {
    ok: !!(usdVnd && usdCny),
    date: date,
    today: today,
    is_today: date === today,
    usd_vnd: usdVnd ? Math.round(usdVnd) : null,
    usd_cny: usdCny ? Number(usdCny) : null,
    cny_vnd: (usdVnd && usdCny) ? Math.round(usdVnd / usdCny) : null,
    source: source,
  };
  return data;
}

export async function handleFxLatest(request, env, url, pathname) {
  if (pathname !== "/api/fx-latest") return null;
  if (request.method !== "GET") return { body: { ok: false, error: "method not allowed" }, status: 405 };
  try {
    if (_cache.data && Date.now() - _cache.at < CACHE_MS) {
      return { body: _cache.data, status: 200 };
    }
    const data = await build(env);
    // 只有拿到真实值才缓存，否则下次继续重试（避免把失败结果钉死 10 分钟）
    if (data.ok) _cache = { at: Date.now(), data };
    return { body: data, status: 200 };
  } catch (e) {
    return { body: { ok: false, error: String((e && e.message) || e) }, status: 200 };
  }
}
