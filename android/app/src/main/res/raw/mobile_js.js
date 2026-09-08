/* AGI-PM mobile runtime patch (injected by MainActivity)
   - Fixes Chart.js race condition that leaves charts stuck at "Loading chart library…"
   - Triggers chart resize when the phone is rotated
   This file is injected at runtime; index.html itself is not modified. */
(function () {
  if (window.__agi_pm_mobile_js_injected) return;
  window.__agi_pm_mobile_js_injected = true;

  // ============================================================
  // 1) Chart.js race-condition fix
  // ============================================================
  var chartQueue = [];
  var origMakeChart = window._ovMakeChart;

  function makeWrapper(canvasId, cfg) {
    if (typeof Chart === 'undefined') {
      // queue the request instead of showing "Loading chart library…" forever
      chartQueue.push({ canvasId: canvasId, cfg: cfg });
      return null;
    }
    return origMakeChart ? origMakeChart.call(this, canvasId, cfg) : null;
  }

  // Only wrap if the function exists and hasn't been wrapped yet
  if (typeof window._ovMakeChart === 'function' && !window._ovMakeChart.__agiWrapped) {
    makeWrapper.__agiWrapped = true;
    window._ovMakeChart = makeWrapper;
  }

  function flushChartQueue() {
    if (typeof Chart === 'undefined' || !chartQueue.length) return;
    var q = chartQueue;
    chartQueue = [];
    for (var i = 0; i < q.length; i++) {
      try {
        var item = q[i];
        var c = document.getElementById(item.canvasId);
        if (c && c.parentNode) {
          c.parentNode.removeAttribute('data-chart-queued');
        }
        window._ovMakeChart(item.canvasId, item.cfg);
      } catch (e) {
        // ignore single-chart failures
      }
    }
  }

  // Poll until Chart.js becomes available, then replay queued charts
  function pollChartReady() {
    if (typeof Chart !== 'undefined') {
      flushChartQueue();
    } else {
      setTimeout(pollChartReady, 300);
    }
  }
  pollChartReady();

  // Also hook into the library loader if present
  if (typeof window._ovLoadChartLib === 'function' && !window._ovLoadChartLib.__agiWrapped) {
    var origLoad = window._ovLoadChartLib;
    window._ovLoadChartLib = function (cb) {
      return origLoad.call(this, function () {
        try { if (typeof cb === 'function') cb(); } catch (e) {}
        setTimeout(flushChartQueue, 0);
      });
    };
    window._ovLoadChartLib.__agiWrapped = true;
  }

  // ============================================================
  // 2) Resize / re-render charts on orientation change
  // ============================================================
  window.addEventListener('orientationchange', function () {
    // give the layout a moment to settle after rotation
    setTimeout(function () {
      window.dispatchEvent(new Event('resize'));

      // Chart.js responsive charts auto-resize on window resize, but force it anyway
      if (window._ovCharts && window._ovCharts.length) {
        for (var i = 0; i < window._ovCharts.length; i++) {
          try {
            var ch = window._ovCharts[i];
            if (ch && typeof ch.resize === 'function') ch.resize();
          } catch (e) {}
        }
      }

      // Charts queued before rotation may now be renderable
      flushChartQueue();
    }, 400);
  });
})();
