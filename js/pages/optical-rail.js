/* =========================================================================
 * pages/optical-rail.js —— P7：把光学页的空间模型改成"位置即真实距离"
 *
 * 为什么需要（用户实测反馈）：
 *   ① 移动光屏条纹不变 —— 因为条纹只由面板 z₂ 决定，拖拽不回填（P3c 的代价）
 *   ② 凸透镜加入后毫无作用 —— 页面根本没有二次成像的计算
 *   ③ 改面板参数只有数字变、条纹不重绘
 *
 * 做法（尽量少碰原文件）：
 *   · CONFIG.scale 同时决定刻度换算与 mm 标签，把它设成 "画布宽px / 台面跨度mm"，
 *     导轨刻度就自动变成真实毫米标尺 —— 不用重写 drawRail。
 *   · DEVICE_TYPES 的宽高改成薄线符号（6–16 px），按比例摆放不重叠 —— 不用重写 drawDevice。
 *   · 元件位置仍用 px 存（原拖拽/命中测试照旧工作），通过 rail 映射换成 mm：
 *       mm = px × (跨度mm / 画布宽px) = px / CONFIG.scale
 *   · 面板 z₁/z₂ 与元件位置**双向同步**：拖拽 → 回填面板；改面板 → 移动元件。
 *   · 透镜参与计算：u = 透镜−棱脊，v = uf/(u−f)，|m| = v/u，d′ = |m|d，
 *     Δx′ = λ·|屏−像面|/d′。物在焦点内时如实标注"无实像"。
 *   · 条纹图锚定**固定屏面视场**（默认 ±3 mm），所以 Δx 一变，条纹数目立刻变——
 *     这样"移动光屏"才看得出来。
 * ========================================================================= */
(function (global) {
  'use strict';

  var BP = global.BP || {};
  var doc = global.document;

  var RAIL_SPAN_MM = 1200;      // 台面总长：0 … 1200 mm
  var FOV_MM = 6;               // 屏面视场宽度（测微目镜量级）
  var LENS_F = 150;             // 凸透镜焦距默认值（报告：f′ = 150 mm）

  function $(id) { return doc && doc.getElementById(id); }
  function num(id, dflt) {
    var el = $(id);
    var v = el ? parseFloat(el.value) : NaN;
    return isFinite(v) ? v : dflt;
  }
  function setVal(id, v) { var el = $(id); if (el) el.value = v; }
  function setText(id, t) { var el = $(id); if (el) el.textContent = t; }

  /* ---------------- 取 optical_simulator.js 的 let/const 绑定 ---------------- */
  function getConfig() { try { return typeof CONFIG !== 'undefined' ? CONFIG : undefined; } catch (e) { return undefined; } }
  function getDevices() { try { return typeof devices !== 'undefined' ? devices : null; } catch (e) { return null; } }
  function getDpr() { return Math.max(1, Math.min(3, global.devicePixelRatio || 1)); }

  /* ---------------- 纯几何：mm ↔ px ---------------- */
  function pxPerMm(cssW) { return Math.max(1e-6, cssW / RAIL_SPAN_MM); }
  function pxToMm(px, cssW) { return px / pxPerMm(cssW); }
  function mmToPx(mm, cssW) { return mm * pxPerMm(cssW); }

  function cssWidth() {
    var cv = $('opticalCanvas');
    var box = cv && cv.parentElement ? cv.parentElement : cv;
    return Math.max(1, (box && box.clientWidth) || 800);
  }

  /* ---------------- 纯解算（无 DOM，Node 可直接测） ----------------
   * scene: {lamNm, n, Adeg, b, z1, z2, lens: {f, u} | null}
   *   无透镜：d = 2·z1·(n−1)·A，Δx = λ(z1+z2)/d
   *   有透镜：物距 u 由位置给出，v = uf/(u−f)，|m| = v/u，d′ = |m|d，
   *           Δx′ = λ·|屏−像面|/d′（像面在透镜后 v 处）
   */
  function solveScene(s) {
    var lamMm = +s.lamNm * 1e-6, n = +s.n, A = (+s.Adeg) * Math.PI / 180;
    var z1 = +s.z1, z2 = +s.z2;
    var err = [];
    if (!(lamMm > 0)) err.push('波长必须为正');
    if (!(n > 1)) err.push('折射率必须 > 1');
    if (!(A > 0)) err.push('顶角必须为正');
    if (!(z1 > 0)) err.push('z₁ 必须为正');
    if (!(z2 > 0)) err.push('z₂ 必须为正');
    if (err.length) { var e = new Error(err.join('；')); e.isInputError = true; throw e; }

    var d = 2 * z1 * (n - 1) * A;             // mm
    var out = {
      lamMm: lamMm, A: A, z1: z1, z2: z2, D: z1 + z2,
      d: d, dx: lamMm * (z1 + z2) / d,
      lens: null, dPrime: NaN, m: NaN, dxPrime: NaN, beta: NaN, note: null
    };

    if (s.lens && isFinite(s.lens.u) && s.lens.u > 0) {
      var f = +s.lens.f, u = +s.lens.u;
      if (!(f > 0)) throw new Error('焦距必须为正');
      if (u <= f) {
        out.lens = { f: f, u: u, v: NaN, m: NaN, image: false };
        out.note = '物距 u = ' + u.toFixed(1) + ' mm ≤ f′ = ' + f.toFixed(0) + ' mm，二次成像无实像';
      } else {
        var v = u * f / (u - f);              // 像距（透镜右侧为正）
        var m = v / u;                        // |β|，像间距放大率
        var imgPos = v;                       // 像面相对透镜的位置
        var L2 = +s.lens.L2;                  // 屏相对透镜的距离
        var dxP = lamMm * Math.abs(L2 - imgPos) / (m * d);
        out.lens = { f: f, u: u, v: v, m: m, image: true, L2: L2 };
        out.dPrime = m * d;
        out.m = m;
        out.dxPrime = dxP;
        out.beta = out.dx ? dxP / out.dx : NaN;
      }
    }
    return out;
  }

  /* ---------------- 元件位置 ↔ 面板 ---------------- */
  function find(t) {
    var ds = getDevices();
    if (!ds) return null;
    for (var i = 0; i < ds.length; i++) if (ds[i].type === t) return ds[i];
    return null;
  }

  function readScene() {
    var w = cssWidth();
    var cfg = getConfig();
    var scale = cfg && cfg.scale > 0 ? cfg.scale : 1;   // scale = mm/px 的倒数关系：mm = px/scale
    var mmOf = function (dev) { return dev ? (dev.x + dev.width / 2) / scale : NaN; };

    var slit = find('slit'), prism = find('prism'), screen = find('screen'), lens = find('lens');
    var lam = num('lambda', 589.3), n = num('n', 1.5168), Adeg = num('beta', 1.0), b = num('b', 0.08);

    var base = {
      lamNm: lam, n: n, Adeg: Adeg, b: b,
      z1: num('z1', 50), z2: num('z2', 950), lens: null
    };

    if (slit && prism && screen) {
      base.z1 = Math.max(1, mmOf(prism) - mmOf(slit));
      base.z2 = Math.max(1, mmOf(screen) - mmOf(prism));
    }
    if (lens) {
      var u = mmOf(lens) - (slit && prism ? mmOf(prism) : mmOf(slit));
      var L2 = screen ? (mmOf(screen) - mmOf(lens)) : NaN;
      if (u > 0) base.lens = { f: num('lens_f', LENS_F), u: u, L2: L2 };
    }
    return base;
  }

  // 面板/参数 → 元件位置（改面板时把元件挪到位，保证"位置即距离"）
  function layoutFromPanel() {
    var ds = getDevices();
    if (!ds) return;
    var cfg = getConfig();
    var scale = cfg && cfg.scale > 0 ? cfg.scale : 1;
    var slit = find('slit'), prism = find('prism'), screen = find('screen'), lens = find('lens'), src = find('source');
    if (!slit || !prism || !screen) return;
    var z1 = num('z1', 50), z2 = num('z2', 950);
    var x0 = 100;                                  // 单缝所在 mm
    var setMm = function (dev, mm) { if (dev) dev.x = mm * scale - dev.width / 2; };
    setMm(slit, x0);
    setMm(prism, x0 + z1);
    setMm(screen, x0 + z1 + z2);
    if (src) setMm(src, Math.max(10, x0 - 120));
    if (lens) setMm(lens, x0 + z1 + Math.min(z2 * 0.25, 250));
    if (typeof global.render === 'function') global.render();
  }

  // 元件位置 → 面板（拖拽结束时回填）
  function syncPanelFromDevices() {
    var w = cssWidth();
    var cfg = getConfig();
    var scale = cfg && cfg.scale > 0 ? cfg.scale : 1;
    var mmOf = function (dev) { return (dev.x + dev.width / 2) / scale; };
    var slit = find('slit'), prism = find('prism'), screen = find('screen');
    if (!slit || !prism || !screen) return null;
    var z1 = mmOf(prism) - mmOf(slit), z2 = mmOf(screen) - mmOf(prism);
    if (z1 > 0) setVal('z1', z1.toFixed(1));
    if (z2 > 0) setVal('z2', z2.toFixed(1));
    updateParams();
    simulateInterference();
    return { z1: z1, z2: z2 };
  }

  /* ---------------- 覆盖 updateParams / simulateInterference ---------------- */
  function updateParams() {
    if (!doc) return null;
    var scene, r;
    try { scene = readScene(); r = solveScene(scene); }
    catch (e) {
      setText('result_d', '—'); setText('result_dx', '—'); setText('result_D', '—');
      if (BP.ui && BP.ui.alert) BP.ui.alert(e.message);
      return null;
    }
    setText('result_D', r.D.toFixed(1) + ' mm');

    if (r.lens && r.lens.image) {
      // 有透镜：屏上看到的是像光源的条纹
      setText('result_d', r.d.toFixed(4) + ' mm → d′ ' + r.dPrime.toFixed(4));
      setText('result_dx', r.dxPrime.toFixed(4) + ' mm（像面）');
      setText('result_M', '|β| = ' + r.m.toFixed(2) + '，Δx′/Δx = ' + r.beta.toFixed(2));
    } else {
      setText('result_d', r.d.toFixed(4) + ' mm');
      setText('result_dx', r.dx.toFixed(4) + ' mm');
      setText('result_M', r.lens ? '无实像' : '本页未插透镜');
    }
    return r;
  }

  function drawFringe(r) {
    var cv = $('fringeCanvas');
    if (!cv || !cv.getContext) return;
    var box = $('fringeResult');
    if (box) box.style.display = 'block';

    var W = cv.width || 260, H = cv.height || 150;
    var ctx = cv.getContext('2d');
    // 锚定固定屏面视场：Δx 一变，条纹数目立刻变（这才是"移动光屏看得出来"的关键）
    var dxMm = r.lens && r.lens.image ? r.dxPrime : r.dx;
    var b = num('b', 0.08);

    for (var i = 0; i < W; i++) {
      var x = (i / (W - 1) - 0.5) * FOV_MM;               // mm，视场中心为 0
      var u = Math.PI * b * x / (r.lamMm * Math.max(1, r.D));
      var V = u === 0 ? 1 : Math.sin(u) / u;              // 扩展光源 ⇒ 衰减干涉项对比度
      var val = 0.5 * (1 + V * Math.cos(2 * Math.PI * x / dxMm));
      var g = Math.round(255 * (val < 0 ? 0 : val > 1 ? 1 : val));
      ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
      ctx.fillRect(i, 0, 1, H);
    }
    setText('theoretical_dx', dxMm.toFixed(4) + ' mm');
    var nFringe = FOV_MM / dxMm;
    setText('visibility', nFringe.toFixed(1) + ' 条 / ' + FOV_MM + ' mm 视场');
  }

  function simulateInterference() {
    if (!doc) return null;
    var r;
    try { r = updateParams(); } catch (e) { if (BP.ui) BP.ui.alert(e.message); return null; }
    if (!r) return null;
    drawFringe(r);
    return r;
  }

  /* ---------------- 薄线符号：按比例摆放才不会互相重叠 ---------------- */
  function slimDevices() {
    var D = null;
    try { D = typeof DEVICE_TYPES !== 'undefined' ? DEVICE_TYPES : null; } catch (e) { D = null; }
    if (!D) return;
    var spec = {
      source: { width: 10, height: 26 },
      slit: { width: 6, height: 34 },
      prism: { width: 14, height: 24 },
      lens: { width: 8, height: 34 },
      screen: { width: 6, height: 44 }
    };
    for (var k in spec) if (spec.hasOwnProperty(k) && D[k]) {
      D[k].width = spec[k].width;
      D[k].height = spec[k].height;
    }
  }

  /* ---------------- 刻度换算：CONFIG.scale = 画布宽 / 台面跨度 ---------------- */
  function applyScale() {
    var cfg = getConfig();
    if (!cfg) return;
    var w = cssWidth();
    cfg.scale = w / RAIL_SPAN_MM;      // mm = px / scale；drawRail 的标签 = x/scale → 真实 mm
    cfg.railSpanMm = RAIL_SPAN_MM;
  }

  /* ---------------- 包一层 addDevice：加透镜后立刻摆到合理位置 ----------------
   * 原 addDevice 把元件放在 x = 100 + n*100 px，换算成 mm 是任意值；
   * 加透镜后必须按面板几何重新布局，否则"插透镜"这个动作在数值上无意义。
   */
  function wrapAddDevice() {
    var orig = global.addDevice;
    if (typeof orig !== 'function' || orig.__p7wrapped) return;
    var wrapped = function (type) {
      var r = orig(type);
      if (type === 'lens') {
        layoutFromPanel();
        simulateInterference();
      }
      return r;
    };
    wrapped.__p7wrapped = true;
    global.addDevice = wrapped;
  }

  /* ---------------- 导出 ---------------- */
  var API = {
    solveScene: solveScene,
    readScene: readScene,
    layoutFromPanel: layoutFromPanel,
    syncPanelFromDevices: syncPanelFromDevices,
    updateParams: updateParams,
    simulateInterference: simulateInterference,
    applyScale: applyScale,
    slimDevices: slimDevices,
    RAIL_SPAN_MM: RAIL_SPAN_MM,
    FOV_MM: FOV_MM,
    pxToMm: pxToMm,
    mmToPx: mmToPx,
    pxPerMm: pxPerMm
  };

  global.updateParams = updateParams;
  global.simulateInterference = simulateInterference;
  global.syncPanelFromDevices = syncPanelFromDevices;

  if (doc) {
    slimDevices();
    applyScale();

    // 拖拽结束：位置 → 面板（这次是"位置即距离"，不是示意图换算）
    var cv = $('opticalCanvas');
    if (cv) {
      var onUp = function () { syncPanelFromDevices(); };
      cv.addEventListener('pointerup', onUp);
      cv.addEventListener('pointercancel', onUp);
      cv.addEventListener('mouseup', onUp);
    }

    // 改面板任一参数 → 立刻重绘条纹（修掉"只有运行仿真才刷新"）
    ['lambda', 'n', 'beta', 'b', 'z1', 'z2', 'lens_f'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', function () { simulateInterference(); });
    });

    global.addEventListener('resize', function () { applyScale(); });

    var boot = function () {
      applyScale();
      wrapAddDevice();
      // 首次进入按面板默认值摆放元件，保证"打开就是表 5.1 的装置"
      layoutFromPanel();
      simulateInterference();
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { global.setTimeout(boot, 200); });
    else global.setTimeout(boot, 200);
  }

  BP.pages = BP.pages || {};
  BP.pages.opticalRail = API;
  global.BP = BP;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
