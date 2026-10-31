/* =========================================================================
 * pages/optical-fix.js —— P3a：光学页的数值与参数口径修正（覆盖层）
 *
 * 为什么是"覆盖层"而不是重写 optical_simulator.js：
 *   拖拽、命中测试、元件绘制这些交互代码本身没错（报告 P2-7 只是缺 Pointer Events），
 *   真正错的是单位口径（P1-2：px 当 mm，d 偏大 500 倍）和参数读取（P1-1：把缝宽当顶角）。
 *   本文件在 optical_simulator.js **之后**加载，只重新定义那几个函数，
 *   不改原文件一行 —— 出错可以整段删掉回退。
 *
 * 覆盖的函数：updateParams / simulateInterference / loadPreset
 * 新增的函数：syncPanelFromDevices（拖拽后把几何反填回面板）
 *
 * 口径（报告表 5.1）：λ=589.3 nm、n=1.5168、A=1.0°、b=0.08 mm、z₁=50 mm、z₂=950 mm（D=1000）
 *   ⇒ d = 2·z₁·(n−1)·A = 0.9020 mm（傍轴），Δx = λ·D/d = 0.6532 mm
 *   与 MATLAB 严格追迹的 0.90213 mm 差 0.02%，页面须标注"傍轴近似"。
 * ========================================================================= */
(function (global) {
  'use strict';

  var BP = global.BP || {};
  var doc = global.document;

  /* ---------------- 唯一换算常量（报告 P1-2 的根因：散落的 ×1000） ---------------- */
  // 导轨刻度由 optical_simulator.js 的 CONFIG.scale 决定：CONFIG.scale = 0.5 ⇒ 1 px = 2 mm
  function mmPerPx() {
    var cfg = global.CONFIG;
    var s = cfg && isFinite(cfg.scale) && cfg.scale > 0 ? cfg.scale : 0.5;
    return 1 / s;
  }
  function px2mm(px) { return px * mmPerPx(); }

  /* ---------------- 纯解算（无 DOM，Node 可直接测） ---------------- */
  function solve(p) {
    var lamNm = +p.lamNm, n = +p.n, Adeg = +p.Adeg, z1 = +p.z1, z2 = +p.z2;
    var err = [];
    if (!(lamNm > 0)) err.push('波长必须为正');
    if (!(n > 1)) err.push('折射率必须 > 1');
    if (!(Adeg > 0)) err.push('顶角必须为正');
    if (!(z1 > 0)) err.push('z₁ 必须为正');
    if (!(z2 > 0)) err.push('z₂ 必须为正');
    if (err.length) { var e = new Error(err.join('；')); e.isInputError = true; throw e; }

    var lamMm = lamNm * 1e-6;                  // nm → mm
    var A = Adeg * Math.PI / 180;
    var D = z1 + z2;                           // mm
    var d = 2 * z1 * (n - 1) * A;              // mm，傍轴式 2aα，α=(n−1)A；不要再乘 1000
    var dx = lamMm * D / d;                    // mm，不要再乘 1000
    return { lamMm: lamMm, A: A, D: D, d: d, dx: dx };
  }

  /* ---------------- 参数读写 ---------------- */
  function readParams() {
    var g = function (id, dflt) {
      var el = doc && doc.getElementById(id);
      var v = el ? parseFloat(el.value) : NaN;
      return isFinite(v) ? v : dflt;
    };
    return {
      lamNm: g('lambda', 589.3), n: g('n', 1.5168), Adeg: g('beta', 1.0),
      b: g('b', 0.08), z1: g('z1', 50), z2: g('z2', 950)
    };
  }

  function setText(id, txt) {
    var el = doc && doc.getElementById(id);
    if (el) el.textContent = txt;
  }

  function num6(v) { return isFinite(v) ? v.toFixed(4) : '—'; }

  /* ---------------- 覆盖 updateParams ---------------- */
  function updateParams() {
    if (!doc) return null;
    var p = readParams(), r;
    try { r = solve(p); }
    catch (e) {
      setText('result_d', '—'); setText('result_dx', '—'); setText('result_D', '—');
      if (BP.ui && BP.ui.alert) BP.ui.alert(e.message);
      return null;
    }
    setText('result_d', num6(r.d) + ' mm');
    setText('result_dx', num6(r.dx) + ' mm');
    setText('result_D', r.D.toFixed(1) + ' mm');
    // result_M（放大率）恒为 '-' 的假显示：本页不做二次成像，直接标注不做
    var mx = doc.getElementById('result_M');
    if (mx) mx.textContent = '本页不做';
    return r;
  }

  /* ---------------- 覆盖 simulateInterference ---------------- */
  function simulateInterference() {
    if (!doc) return null;
    var p = readParams(), r;
    try { r = solve(p); } catch (e) { if (BP.ui) BP.ui.alert(e.message); return null; }

    var cv = doc.getElementById('fringeCanvas');
    if (!cv || !cv.getContext) { updateParams(); return r; }
    var box = doc.getElementById('fringeResult');
    if (box) box.style.display = 'block';

    var W = cv.width || 260, H = cv.height || 150;
    var ctx = cv.getContext('2d');

    // 视场按"显示约 14 个条纹"自适应（报告 P1-3：原来固定 ±20 mm，40 mm 里塞 23 万条）
    var xMax = 7 * r.dx;
    // 强度模型：I(x) = ½·[1 + V(x)·cos(2πx/Δx)]，V(x) = sinc(π·b·x/(λ·D))
    //   有限缝宽 ＝ 扩展光源 ⇒ 衰减的是**干涉项的对比度**（加性），不是把整幅强度乘 sinc²。
    //   原来 env·cos² 的形式会把极小值恒压到 0，于是 (max−min)/(max+min) 恒等于 1，
    //   "调缝宽看可见度"永远没反应 —— 正是报告 P1-4 那个毛病。
    var I = new Array(W), i, x, u, V;
    for (i = 0; i < W; i++) {
      x = (i / (W - 1)) * 2 * xMax - xMax;                     // mm
      u = Math.PI * p.b * x / (r.lamMm * r.D);
      V = u === 0 ? 1 : Math.sin(u) / u;                       // 可正可负（负值＝对比度反转）
      var val = 0.5 * (1 + V * Math.cos(2 * Math.PI * x / r.dx));
      I[i] = val < 0 ? 0 : (val > 1 ? 1 : val);
    }

    for (i = 0; i < W; i++) {
      var g = Math.round(255 * I[i]);
      ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
      ctx.fillRect(i, 0, 1, H);
    }

    // 边缘条纹可见度 V(±7Δx) = |sinc(π·b·xMax/(λD))|
    // 中视场处的对比度按模型恒为 1（不含背景光），变化体现在外圈条纹上，所以报边缘值。
    u = Math.PI * p.b * xMax / (r.lamMm * r.D);
    var vEdge = Math.abs(u === 0 ? 1 : Math.sin(u) / u);
    setText('theoretical_dx', r.dx.toFixed(4) + ' mm');
    setText('visibility', (vEdge * 100).toFixed(1) + '%');

    updateParams();
    return r;
  }

  /* ---------------- 拖拽后把几何反填回面板（面板 = 唯一真值） ---------------- */
  function syncPanelFromDevices() {
    if (!doc) return;
    var devs = global.devices;
    if (!devs || !devs.length) return;
    var find = function (t) {
      for (var i = 0; i < devs.length; i++) if (devs[i].type === t) return devs[i];
      return null;
    };
    var slit = find('slit'), prism = find('prism'), scr = find('screen');
    if (!slit || !prism || !scr) return;
    var z1 = px2mm(prism.x - slit.x), z2 = px2mm(scr.x - prism.x);
    if (z1 > 0) { var e1 = doc.getElementById('z1'); if (e1) e1.value = z1.toFixed(1); }
    if (z2 > 0) { var e2 = doc.getElementById('z2'); if (e2) e2.value = z2.toFixed(1); }
    updateParams();
  }

  /* ---------------- 语义化预设（替换"图2a/图3a/图6a"） ---------------- */
  var PRESETS = {
    standard: { name: '标准装置（表 5.1）', v: { lambda: 589.3, n: 1.5168, beta: 1.0, b: 0.08, z1: 50, z2: 950 } },
    a20:      { name: '减小 a（a=20 mm）',  v: { lambda: 589.3, n: 1.5168, beta: 1.0, b: 0.08, z1: 20, z2: 980 } },
    a80:      { name: '增大 a（a=80 mm）',  v: { lambda: 589.3, n: 1.5168, beta: 1.0, b: 0.08, z1: 80, z2: 920 } },
    lens:     { name: '插透镜二次成像',     v: { lambda: 589.3, n: 1.5168, beta: 1.0, b: 0.08, z1: 50, z2: 950 } }
  };

  function loadPreset(key) {
    if (!doc) return;
    var p = PRESETS[key] || PRESETS.standard;
    for (var id in p.v) {
      if (!Object.prototype.hasOwnProperty.call(p.v, id)) continue;
      var el = doc.getElementById(id);
      if (el) el.value = p.v[id];
    }
    // 二次成像预设：确保导轨上有一个凸透镜元件
    if (key === 'lens' && typeof global.addDevice === 'function') {
      var devs = global.devices || [];
      var has = false;
      for (var i = 0; i < devs.length; i++) if (devs[i].type === 'lens') has = true;
      if (!has) global.addDevice('lens');
    }
    if (BP.ui && BP.ui.alert) {
      var extra = key === 'lens' ? '；二次成像：β = Δx′/Δx，用放大率法解 λ' : '';
      BP.ui.alert('已载入「' + p.name + '」' + extra, 'ok');
    }
    if (typeof global.render === 'function') global.render();
    updateParams();
    simulateInterference();
  }

  /* ---------------- 导出 ---------------- */
  var API = {
    solve: solve, readParams: readParams, updateParams: updateParams,
    simulateInterference: simulateInterference,
    syncPanelFromDevices: syncPanelFromDevices,
    loadPreset: loadPreset, PRESETS: PRESETS,
    mmPerPx: mmPerPx, px2mm: px2mm
  };

  // 覆盖全局：optical.html 的 onclick 在点击时才解析 window 上的函数，所以覆盖有效
  global.updateParams = updateParams;
  global.simulateInterference = simulateInterference;
  global.loadPreset = loadPreset;
  global.syncPanelFromDevices = syncPanelFromDevices;

  if (doc) {
    // 拖拽结束就反填面板（Pointer 与 Mouse 都挂，P3b 会统一成 Pointer 一套）
    var cv = doc.getElementById('opticalCanvas');
    if (cv) {
      var onUp = function () { syncPanelFromDevices(); };
      cv.addEventListener('pointerup', onUp);
      cv.addEventListener('pointercancel', onUp);
      cv.addEventListener('mouseup', onUp);
    }
    var go = function () { updateParams(); simulateInterference(); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', go);
    else global.setTimeout(go, 0);
  }

  BP.pages = BP.pages || {};
  BP.pages.optical = API;
  global.BP = BP;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
