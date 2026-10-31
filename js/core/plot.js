/* =========================================================================
 * core/plot.js —— 纯 Canvas 绘图（替代 205 KB 的 Chart.js）
 * 依赖：无
 * 用途：条纹剖面、频谱峰、拟合残差、三路径误差棒、Δx–L₃ 直线
 * 约定：所有绘制用 CSS 像素坐标；DPR 由 setup() 内的 setTransform 处理。
 * ========================================================================= */
(function (global) {
  'use strict';

  var PAD = { l: 46, r: 12, t: 14, b: 30 };
  var GRID = 'rgba(255,255,255,0.12)';
  var AXIS = 'rgba(255,255,255,0.55)';
  var INK = '#dfe7f5';

  function range(a) {
    var mn = Infinity, mx = -Infinity;
    for (var i = 0; i < a.length; i++) {
      if (!isFinite(a[i])) continue;
      if (a[i] < mn) mn = a[i];
      if (a[i] > mx) mx = a[i];
    }
    if (!isFinite(mn)) { mn = 0; mx = 1; }
    if (mn === mx) { mn -= 1; mx += 1; }
    return { mn: mn, mx: mx };
  }

  // 统一准备：DPR 变换 + 画布尺寸 + 坐标映射
  function setup(canvas, xs, ys, opts) {
    if (!canvas || !canvas.getContext) return null;
    var dpr = global.devicePixelRatio || 1;
    var box = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
    var cw = Math.max(60, Math.round(box.width || canvas.clientWidth || 300));
    var ch = Math.max(60, Math.round(box.height || canvas.clientHeight || 180));
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    var xr = opts && opts.xRange ? opts.xRange : range(xs);
    var yr = opts && opts.yRange ? opts.yRange : range(ys);
    var w = cw - PAD.l - PAD.r, h = ch - PAD.t - PAD.b;
    if (w <= 0 || h <= 0) return null;
    var X = function (v) { return PAD.l + (v - xr.mn) / (xr.mx - xr.mn) * w; };
    var Y = function (v) { return PAD.t + h - (v - yr.mn) / (yr.mx - yr.mn) * h; };
    return { ctx: ctx, cw: cw, ch: ch, w: w, h: h, X: X, Y: Y, xr: xr, yr: yr };
  }

  function axes(g, opts) {
    var ctx = g.ctx;
    ctx.strokeStyle = AXIS; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, PAD.t + g.h);
    ctx.lineTo(PAD.l + g.w, PAD.t + g.h);
    ctx.stroke();

    ctx.fillStyle = INK;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    var ticks = (opts && opts.yTicks) || 4;
    for (var i = 0; i <= ticks; i++) {
      var v = g.yr.mn + (g.yr.mx - g.yr.mn) * i / ticks;
      var y = g.Y(v);
      ctx.fillText(String(Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(3)), PAD.l - 6, y);
      ctx.strokeStyle = GRID;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + g.w, y); ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var xt = (opts && opts.xTicks) || 4;
    for (i = 0; i <= xt; i++) {
      var xv = g.xr.mn + (g.xr.mx - g.xr.mn) * i / xt;
      ctx.fillText(String(Math.abs(xv) >= 1000 ? xv.toFixed(0) : xv.toFixed(3)), g.X(xv), PAD.t + g.h + 6);
    }
    if (opts && opts.title) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = INK;
      ctx.fillText(opts.title, PAD.l, 2);
    }
  }

  // 折线（剖面、频谱、拟合直线）
  function line(canvas, xs, ys, opts) {
    opts = opts || {};
    var g = setup(canvas, xs, ys, opts);
    if (!g) return null;
    axes(g, opts);
    var ctx = g.ctx;
    ctx.strokeStyle = opts.color || '#64b5f6';
    ctx.lineWidth = opts.width || 1.6;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < xs.length && i < ys.length; i++) {
      if (!isFinite(xs[i]) || !isFinite(ys[i])) continue;
      var px = g.X(xs[i]), py = g.Y(ys[i]);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
    return g;
  }

  // 散点（残差、Δx–L₃ 数据点）
  function scatter(canvas, pts, opts) {
    opts = opts || {};
    pts = pts || [];
    var xs = pts.map(function (p) { return p[0]; });
    var ys = pts.map(function (p) { return p[1]; });
    var g = setup(canvas, xs, ys, opts);
    if (!g) return null;
    axes(g, opts);
    var ctx = g.ctx;
    ctx.fillStyle = opts.color || '#ffcc00';
    pts.forEach(function (p) {
      if (!isFinite(p[0]) || !isFinite(p[1])) return;
      ctx.beginPath();
      ctx.arc(g.X(p[0]), g.Y(p[1]), opts.r || 2.6, 0, Math.PI * 2);
      ctx.fill();
    });
    // 可选拟合直线：{ slope, intercept }
    if (opts.fitLine && isFinite(opts.fitLine.slope)) {
      ctx.strokeStyle = opts.fitColor || 'rgba(255,107,107,0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(g.X(g.xr.mn), g.Y(opts.fitLine.slope * g.xr.mn + opts.fitLine.intercept));
      ctx.lineTo(g.X(g.xr.mx), g.Y(opts.fitLine.slope * g.xr.mx + opts.fitLine.intercept));
      ctx.stroke();
    }
    return g;
  }

  // 误差棒（三路径 λ ± u）
  function errorBars(canvas, items, opts) {
    opts = opts || {};
    items = items || [];
    var xs = items.map(function (_, i) { return i; });
    var lo = Infinity, hi = -Infinity;
    items.forEach(function (it) {
      if (!isFinite(it.value)) return;
      var u = isFinite(it.u) ? it.u : 0;
      lo = Math.min(lo, it.value - u);
      hi = Math.max(hi, it.value + u);
    });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    var pad = (hi - lo) * 0.25 || 0.5;
    var g = setup(canvas, xs, [lo - pad, hi + pad], { xRange: { mn: -0.6, mx: Math.max(1, items.length - 0.4) },
                                                     yRange: { mn: lo - pad, mx: hi + pad }, title: opts.title, yTicks: 3 });
    if (!g) return null;
    axes(g, { yTicks: 3, xTicks: 0 });
    var ctx = g.ctx;
    ctx.strokeStyle = '#64b5f6'; ctx.fillStyle = '#ffcc00'; ctx.lineWidth = 1.4;
    items.forEach(function (it, i) {
      if (!isFinite(it.value)) return;
      var x = g.X(i), y = g.Y(it.value), u = isFinite(it.u) ? it.u : 0;
      var y1 = g.Y(it.value - u), y2 = g.Y(it.value + u);
      ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 6, y1); ctx.lineTo(x + 6, y1);
      ctx.moveTo(x - 6, y2); ctx.lineTo(x + 6, y2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
    });
    if (opts.standard != null) {
      var ys = g.Y(opts.standard);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(PAD.l, ys); ctx.lineTo(PAD.l + g.w, ys); ctx.stroke();
      ctx.setLineDash([]);
    }
    return g;
  }

  global.BP = global.BP || {};
  global.BP.plot = { line: line, scatter: scatter, errorBars: errorBars, PAD: PAD };
})(typeof window !== 'undefined' ? window : globalThis);
