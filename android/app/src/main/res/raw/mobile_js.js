/* AGI-PM mobile runtime patch (injected by MainActivity at onPageFinished)
   Injected at runtime; index.html itself is not modified.
   __AGI_PM_VERSION__ is replaced at runtime with the APK versionName.

   作用：
   1) 把登录页脚的版本号改写为 APK 真实版本（覆盖网页写死的 V2026.09.08.03）。
   2) 包裹 _ovMakeChart：Chart.js 未就绪时的建图请求先排队，等库加载完成再自动重绘，
      彻底解决页面 _ovLoadChartLib 内 2.5s 超时回调在 Chart 未到位时把卡片写成
      永久「图表库加载中…」的问题。
   3) 旋转 / resize 时让 Chart.js 响应式图表重新适应宽度。 */
(function () {
  if (window.__agi_pm_done) return;
  window.__agi_pm_done = true;

  window.__agi_chart_queue = [];

  function flushQueue() {
    if (typeof Chart === 'undefined' || !window.__agi_chart_queue.length) return;
    var q = window.__agi_chart_queue;
    window.__agi_chart_queue = [];
    var fn = window.__agi_real_make_chart || window._ovMakeChart;
    for (var i = 0; i < q.length; i++) {
      try {
        var item = q[i];
        var c = document.getElementById(item.canvasId);
        if (c && c.tagName.toLowerCase() === 'canvas') {
          fn(item.canvasId, item.cfg);
        }
      } catch (e) {}
    }
  }

  function makeWrapper(fn) {
    return function (canvasId, cfg) {
      if (typeof Chart === 'undefined') {
        window.__agi_chart_queue.push({ canvasId: canvasId, cfg: cfg });
        return null;
      }
      try {
        return fn(canvasId, cfg);
      } catch (e) {
        // 布局未稳时重试一次（旋转 / 动态尺寸常见）
        setTimeout(function () {
          try {
            var c = document.getElementById(canvasId);
            if (c && c.tagName.toLowerCase() === 'canvas') fn(canvasId, cfg);
          } catch (e2) {}
        }, 300);
        return null;
      }
    };
  }

  // 1) 登录页脚版本号 → APK 版本
  try {
    var lv = document.getElementById('loginVer');
    if (lv) lv.textContent = '__AGI_PM_VERSION__';
  } catch (e) {}

  // 2) 包裹真实 _ovMakeChart（此时页面已完整解析，函数已定义）
  if (typeof window._ovMakeChart === 'function') {
    window.__agi_real_make_chart = window._ovMakeChart;
    window._ovMakeChart = makeWrapper(window.__agi_real_make_chart);
  }

  // 3) 轮询直到 Chart.js 就绪，再 flush 排队图表
  function pollChartReady() {
    if (typeof Chart !== 'undefined') {
      flushQueue();
    } else {
      setTimeout(pollChartReady, 300);
    }
  }
  pollChartReady();

  // 库加载完成回调里也 flush 一次（双保险）
  if (typeof window._ovLoadChartLib === 'function' && !window._ovLoadChartLib.__agiWrapped) {
    var origLoad = window._ovLoadChartLib;
    window._ovLoadChartLib = function (cb) {
      return origLoad.call(this, function () {
        try { if (typeof cb === 'function') cb(); } catch (e) {}
        setTimeout(flushQueue, 0);
      });
    };
    window._ovLoadChartLib.__agiWrapped = true;
  }

  // 4) 旋转 / resize 处理
  window.addEventListener('orientationchange', function () {
    setTimeout(function () {
      window.dispatchEvent(new Event('resize'));
      if (window._ovCharts && window._ovCharts.length) {
        for (var i = 0; i < window._ovCharts.length; i++) {
          try {
            var ch = window._ovCharts[i];
            if (ch && typeof ch.resize === 'function') ch.resize();
          } catch (e) {}
        }
      }
      flushQueue();
    }, 400);
  });
})();

/* 离线只读横幅：断网时显示三语"离线缓存模式 + 最近同步时间"，随系统/界面语言自动切换 */
(function () {
  if (window.__agi_offline_done) return;
  window.__agi_offline_done = true;

  var AGI_OFF_I18N = {
    zh: { bar: '⚠ 离线缓存模式 · 最近同步 ' },
    en: { bar: '⚠ Offline cache mode · Last sync ' },
    vi: { bar: '⚠ Chế độ bộ nhớ ngoại tuyến · Đồng bộ cuối ' }
  };
  function agiLang() {
    // ★ 只信任网页真实的 CUR_LANG。页面刚加载、CUR_LANG 尚未就绪时【绝不】
    //   回退到 navigator.language（设备系统语言）——那会把原生侧语言污染成系统语言，
    //   导致 App 内提示语与界面所选语言不一致（历史 bug 的真根因）。
    //   未就绪时返回 null，表示"本次不推送语言"，让原生保持上一次的正确值。
    var l = window.CUR_LANG;
    return (l === 'en' || l === 'vi' || l === 'zh') ? l : null;
  }
  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  var bar = document.createElement('div');
  bar.id = 'agi-offline-bar';
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
    'text-align:center;font-size:11px;line-height:18px;color:#fff;' +
    'background:rgba(214,120,0,0.92);pointer-events:none;display:none;' +
    'font-family:sans-serif;letter-spacing:.3px;';
  (document.body || document.documentElement).appendChild(bar);

  function update() {
    try {
      if (!window.AndroidBridge || !window.AndroidBridge.cacheStatus) return;
      var lang = agiLang();
      try { if (lang && window.AndroidBridge.setLang) window.AndroidBridge.setLang(lang); } catch (e) {}
      var st = JSON.parse(window.AndroidBridge.cacheStatus());
      if (st.offline) {
        var t = fmtTime(st.lastSync);
        bar.textContent = (AGI_OFF_I18N[lang] || AGI_OFF_I18N.zh).bar + (t || '');
        bar.style.display = 'block';
      } else {
        bar.style.display = 'none';
      }
    } catch (e) {}
  }
  update();
  setInterval(update, 5000);
})();

/* 移除"请横屏使用"紫色遮罩（用户不需要）。
   ★ 性能教训：这里【绝不能】用 MutationObserver 观察 body 的 subtree ——
     页面是 1.6MB 的单文件应用，加载期间 DOM 变化极其频繁，全树监听会触发
     海量回调把主线程压死，表现为"点开 APP 白屏好几秒"（曾经的线上问题）。
     改为在几个固定时间点各清一次即可；CSS 里还有 display:none 兜底。 */
(function () {
  function killRotateGate() {
    try {
      var g = document.getElementById('rotate-gate');
      if (g && g.parentNode) g.parentNode.removeChild(g);
    } catch (e) {}
  }
  try { sessionStorage.removeItem('_rg_bypass'); } catch (e) {}
  killRotateGate();
  [200, 800, 2000, 4000].forEach(function (t) { setTimeout(killRotateGate, t); });
})();

