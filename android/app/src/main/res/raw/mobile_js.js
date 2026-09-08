/* AGI-PM mobile runtime patch (injected by MainActivity)
   Injected in BOTH onPageStarted (early stub) and onPageFinished (final patch).
   This file is injected at runtime; index.html itself is not modified.
   __AGI_PM_VERSION__ is replaced at runtime with the APK versionName. */
(function () {
  // ============================================================
  // Phase 1 — as early as possible (onPageStarted)
  // Install a stub _ovMakeChart so any chart creation that happens
  // BEFORE Chart.js has finished loading gets queued instead of
  // being replaced by a permanent "Loading chart library…" message.
  // ============================================================
  if (!window.__agi_pm_phase1_done) {
    window.__agi_pm_phase1_done = true;
    window.__agi_chart_queue = window.__agi_chart_queue || [];

    window.__agi_stub = function (canvasId, cfg) {
      if (typeof Chart !== 'undefined' && window.__agi_real_make_chart) {
        return window.__agi_real_make_chart(canvasId, cfg);
      }
      window.__agi_chart_queue.push({ canvasId: canvasId, cfg: cfg });
      return null;
    };

    // Only install the stub if the page hasn't already defined the real function
    if (typeof window._ovMakeChart !== 'function') {
      window._ovMakeChart = window.__agi_stub;
    }
  }

  // ============================================================
  // Phase 2 — after page DOM is ready (onPageFinished)
  // Wrap the real _ovMakeChart, flush any queued requests, patch the
  // login version label, and handle rotation resize.
  // ============================================================
  if (window.__agi_pm_phase2_done) return;
  window.__agi_pm_phase2_done = true;

  // --- 1) Patch login footer version to match APK version ---
  try {
    var lv = document.getElementById('loginVer');
    if (lv) lv.textContent = '__AGI_PM_VERSION__';
  } catch (e) {}

  // --- 2) Wrap real _ovMakeChart ---
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
        // Retry once after layout has settled (common on rotation / dynamic sizing)
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

  if (typeof window._ovMakeChart === 'function' && window._ovMakeChart !== window.__agi_stub) {
    // Real function already defined by the page
    window.__agi_real_make_chart = window._ovMakeChart;
    window._ovMakeChart = makeWrapper(window.__agi_real_make_chart);
  } else if (window.__agi_stub) {
    // Real function not yet defined — keep stub active but upgrade it to wrap
    window._ovMakeChart = makeWrapper(function (canvasId, cfg) {
      if (window.__agi_real_make_chart) {
        return window.__agi_real_make_chart(canvasId, cfg);
      }
      window.__agi_chart_queue.push({ canvasId: canvasId, cfg: cfg });
      return null;
    });
  }

  // --- 3) Poll until Chart.js arrives, then flush queue ---
  function pollChartReady() {
    if (typeof Chart !== 'undefined') {
      flushQueue();
    } else {
      setTimeout(pollChartReady, 300);
    }
  }
  pollChartReady();

  // Also flush when the existing loader finishes
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

  // --- 4) Rotation / resize handling ---
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
