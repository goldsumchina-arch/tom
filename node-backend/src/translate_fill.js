// ⛔ FROZEN (2026-09-08) V2026.09.07.05：本文件逻辑已锁定，未经用户明确同意禁止修改。除 CRM / LOST / WON / 个人佣金 四个模块内的“样板数据 / 演示数据”（清理演示数据用，仅删数据、不改逻辑）外，其余业务逻辑均正确，禁止改动。
// ============================================================
// M13：备注服务端补翻并持久化（V28）
// 目的：把"缺哪门语言就翻译哪门"从浏览器端挪到服务端——
//   前端每次拉列表时，Worker 把缺的 remark_zh/en/vi 翻好并写回 D1。
//   此后 rmLangVal 渲染时三语永远齐全，切表头语言立即正确显示。
// 触发：前端列表加载后 fire 调用 /api/translate-remarks?table=...&limit=N
// 缓存：同文本+目标语言命中内存缓存不再调 Google（同一 Worker 实例生命周期内）。
// 表结构差异：
//   crm_projects / lost_projects：remark_zh/en/vi 独立列（lost 缺列时自动 ALTER）
//   won_projects：三语以 JSON 打包在 cust/gs/agi_remark 三列（100列上限不加列）
// ============================================================

const MEM_CACHE = new Map(); // "text|target" -> translation

async function gt(text, target) {
  const key = text + '|' + target;
  if (MEM_CACHE.has(key)) return MEM_CACHE.get(key);
  const gurl = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl='
    + encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(text);
  const r = await fetch(gurl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('gt-' + r.status);
  const d = await r.json();
  const out = Array.isArray(d) && d[0] ? d[0].map(x => (x && x[0]) || '').join('') : '';
  if (!out) throw new Error('gt-empty');
  MEM_CACHE.set(key, out);
  return out;
}

// 三语解析：对象/JSON 字符串/纯文本（纯文本视为中文历史数据）
function parseTri(v) {
  if (v && typeof v === 'object') return { zh: v.zh || '', en: v.en || '', vi: v.vi || '' };
  const s = v == null ? '' : String(v);
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      return { zh: o.zh || '', en: o.en || '', vi: o.vi || '' };
    }
  } catch (e) { /* 纯文本 */ }
  return { zh: s, en: '', vi: '' };
}

const TABLES = {
  crm_projects:  { cols: ['remark'], json: false },
  lost_projects: { cols: ['remark'], json: false },
  won_projects:  { cols: ['cust_remark', 'gs_remark', 'agi_remark'], json: true },
};

export async function handleTranslateFill(request, env, url) {
  const table = url.searchParams.get('table') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '40', 10) || 40, 80);
  const conf = TABLES[table];
  if (!conf) return { ok: false, error: 'bad table' };

  // lost_projects 可能缺三语列：幂等 ALTER（crm 理论上已有，一并兜底）
  if (conf.cols.length === 1) {
    for (const s of ['zh', 'en', 'vi']) {
      try {
        await env.DB.prepare('ALTER TABLE ' + table + ' ADD COLUMN remark_' + s + " TEXT DEFAULT ''").run();
      } catch (e) { /* 列已存在 */ }
    }
  }

  const rs = await env.DB.prepare('SELECT * FROM ' + table).all();
  const rows = (rs && rs.results) || [];

  // 收集缺失任务
  const jobs = [];
  for (const row of rows) {
    for (const col of conf.cols) {
      const tri = parseTri(row[col]);
      const has = { zh: !!tri.zh.trim(), en: !!tri.en.trim(), vi: !!tri.vi.trim() };
      if (!has.zh && !has.en && !has.vi) continue;
      const missing = ['en', 'vi', 'zh'].filter(l => !has[l]);
      if (!missing.length) continue;
      const srcLang = has.zh ? 'zh' : (has.en ? 'en' : 'vi');
      const srcText = tri[srcLang];
      for (const lang of missing) jobs.push({ row, col, tri, lang, srcText });
    }
  }
  if (!jobs.length) return { ok: true, filled: 0, remaining: 0 };

  // 只对内存缓存未命中的占用翻译配额；并发的拉取会逐步把剩余填完
  const todo = jobs.filter(j => !MEM_CACHE.has(j.srcText + '|' + j.lang)).slice(0, limit);
  const results = await Promise.allSettled(todo.map(j => gt(j.srcText, j.lang)));
  todo.forEach((j, i) => {
    if (results[i].status === 'fulfilled') j.trans = results[i].value;
  });

  // 应用并持久化：
  // 先汇总每个 job 的翻译结果到 tri（保证同一行需要补翻多语时，三语都被写入），
  // 再按 row+col 去重构建 UPDATE（只推一条含完整三语的语句）。
  // 旧实现边设值边去重 push，会导致“需要补翻两种语言”的行只写进第一种，
  // 另一种永远缺 → 该行持续被判为缺翻 → filled 恒 >0 → 前端陷入无限重渲染（整表闪烁）。
  let filled = 0;
  for (const j of todo) {
    if (!j.trans) continue;
    j.tri[j.lang] = j.trans;
  }
  const stmts = [];
  const applied = new Set();
  for (const j of todo) {
    if (!j.trans) continue;
    const rk = j.row.id + '|' + j.col;
    if (applied.has(rk)) continue;
    applied.add(rk);
    if (conf.json) {
      stmts.push(env.DB.prepare('UPDATE ' + table + ' SET ' + j.col + '=? WHERE id=?')
        .bind(JSON.stringify({ zh: j.tri.zh, en: j.tri.en, vi: j.tri.vi }), j.row.id));
    } else {
      stmts.push(env.DB.prepare('UPDATE ' + table
        + ' SET remark_zh=?, remark_en=?, remark_vi=? WHERE id=?')
        .bind(j.tri.zh, j.tri.en, j.tri.vi, j.row.id));
    }
    filled++;
  }
  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }
  // remaining：仍缺翻且本轮未处理的任务数（翻译失败/超 limit），仅作信息；循环由 filled 驱动
  let remaining = 0;
  for (const j of jobs) {
    const key = j.srcText + '|' + j.lang;
    if (!(j.trans || MEM_CACHE.has(key))) remaining++;
  }
  return { ok: true, filled, remaining };
}
