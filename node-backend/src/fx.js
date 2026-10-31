// ============================================================
// 最新一期汇率（CRM 报价汇率自动填充用）
//
// GET /api/fx-latest
//   → { ok, date, today, is_today, usd_vnd, usd_cny, cny_vnd, source }
//
// 数据源按顺序尝试，谁先成功用谁（服务器在腾讯云，Yahoo 常返回 429）：
//   ① jsDelivr · @fawazahmed0/currency-api —— 免费日更，CDN 可达性好
//   ② open.er-api.com —— 免费无 key，每日更新
//   ③ Yahoo Finance 日线 —— 数据中心 IP 常被限流，仅作第三选择
//   ④ R2 里 price_snapshot.json 的 fx.json（月度聚合）—— 永远兜底，保证有值
//
// "当日汇率" 的语义：返回的 date 就是数据日期；
// 若 date !== today，说明当日尚未同步，前端提示「沿用上一可用日」。
//
// 结果内存缓存 10 分钟（CRM 每次开弹窗都会请求，不能每次都打外网）。
// ============================================================

const CACHE_MS = 10 * 60 * 1000;
let _cache = { at: 0, data: null };

function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
}

function fetchJson(url, ms) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms || 8000) : null;
  return fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (AGI-CRM fx)" },
    signal: ctl ? ctl.signal : undefined,
  })
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .finally(() => { if (timer) clearTimeout(timer); });
}

// ① jsDelivr currency-api：{"date":"2026-10-30","usd":{"vnd":25900,"cny":7.1,...}}
async function srcJsd() {
  const j = await fetchJson("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json");
  const u = (j && j.usd) || {};
  if (!u.vnd || !u.cny) throw new Error("jsd empty");
  return { usdVnd: Number(u.vnd), usdCny: Number(u.cny), date: String(j.date || ""), source: "jsdelivr" };
}

// ② open.er-api.com：{"result":"success","time_last_update_unix":...,"rates":{"VND":...,"CNY":...}}
async function srcErApi() {
  const j = await fetchJson("https://open.er-api.com/v6/latest/USD");
  const r = (j && j.rates) || {};
  if (!r.VND || !r.CNY) throw new Error("er-api empty");
  const d = j.time_last_update_unix ? new Date(j.time_last_update_unix * 1000) : new Date();
  return { usdVnd: Number(r.VND), usdCny: Number(r.CNY), date: ymd(d), source: "er-api" };
}

// ③ Yahoo Finance 日线
async function yahooLastClose(symbol) {
  const j = await fetchJson("https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) + "?range=15d&interval=1d");
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.timestamp) throw new Error("yahoo empty");
  const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0] &&
    res.indicators.quote[0].close) || [];
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] !== null && closes[i] !== undefined) {
      return { value: Number(closes[i]), date: ymd(new Date(res.timestamp[i] * 1000)) };
    }
  }
  throw new Error("yahoo no close");
}
async function srcYahoo() {
  const [a, b] = await Promise.all([yahooLastClose("USDVND=X"), yahooLastClose("USDCNY=X")]);
  return { usdVnd: a.value, usdCny: b.value, date: a.date > b.date ? a.date : b.date, source: "yahoo" };
}

// ④ R2 快照兜底（月度聚合）
function lastNonNull(arr) {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined) return Number(arr[i]);
  }
  return null;
}
async function srcR2(env) {
  const obj = await env.FILES.get("price_snapshot.json");
  if (!obj) throw new Error("no snapshot");
  const snap = JSON.parse(await obj.text());
  const fx = (snap && snap.data && snap.data["fx.json"]) || {};
  const s = fx.series || {};
  const usdVnd = lastNonNull(s.usd_vnd);
  const usdCny = lastNonNull(s.usd_cny);
  if (!usdVnd || !usdCny) throw new Error("r2 empty");
  return { usdVnd: usdVnd, usdCny: usdCny, date: (fx.labels || []).slice(-1)[0] || "", source: "r2-monthly" };
}

async function build(env) {
  const tries = [
    () => srcJsd(),
    () => srcErApi(),
    () => srcYahoo(),
    () => srcR2(env),
  ];
  let hit = null;
  const errs = [];
  for (const fn of tries) {
    try {
      hit = await fn();
      if (hit && hit.usdVnd && hit.usdCny) break;
    } catch (e) {
      errs.push(String((e && e.message) || e));
      hit = null;
    }
  }
  const today = ymd(new Date());
  if (!hit) {
    return { ok: false, date: "", today: today, is_today: false, usd_vnd: null, usd_cny: null, cny_vnd: null, source: "none", errors: errs };
  }
  return {
    ok: true,
    date: hit.date || "",
    today: today,
    is_today: hit.date === today,
    usd_vnd: Math.round(hit.usdVnd),
    usd_cny: Number(hit.usdCny),
    cny_vnd: Math.round(hit.usdVnd / hit.usdCny),
    source: hit.source,
  };
}

export async function handleFxLatest(request, env, url, pathname) {
  if (pathname !== "/api/fx-latest") return null;
  if (request.method !== "GET") return { body: { ok: false, error: "method not allowed" }, status: 405 };
  try {
    if (_cache.data && Date.now() - _cache.at < CACHE_MS) {
      return { body: _cache.data, status: 200 };
    }
    const data = await build(env);
    // 只有拿到真实日线数据才缓存；兜底/失败结果下次继续重试
    if (data.ok && data.source !== "r2-monthly") _cache = { at: Date.now(), data };
    return { body: data, status: 200 };
  } catch (e) {
    return { body: { ok: false, error: String((e && e.message) || e) }, status: 200 };
  }
}
