/* =========================================================================
 * core/fringe.js —— 图像 → 一维剖面 → 条纹间距（P5）
 *
 * 设计要点：
 *   ① 纯函数优先：synthesizeProfile / profileFromImageData / analyzeProfile 都不碰 DOM，
 *      因此 Node 里可以直接跑门禁（tools/check-fringe.js），不依赖浏览器和真照片。
 *   ② 方向判定：横竖两个方向各跑一次，取"峰更锐、周期与交叉检查更一致"的那个，
 *      避免"投影方向错 → 周期无穷大"（审查报告 §6.3 的注）。
 *   ③ 合成条纹图自带真值：没有实验仪器时也能验证整条链路 ——
 *      这也正是报告表 6.1 的方法（已知真值下检验提取偏差）。
 * ========================================================================= */
(function (global) {
  'use strict';

  var BP = global.BP = global.BP || {};

  // physics.js 的导出名是 BiprismPhysics；BP.physics 是 core/fmt.js 建的命名桥。
  // 这里自己兜一层，避免本模块依赖脚本加载顺序（Node 门禁里就没加载 fmt.js）。
  function phys() { return BP.physics || global.BiprismPhysics; }

  /* ---------------- 合成一维条纹剖面（带真值，用于自检） ----------------
   * I(x) = 0.5·[1 + V·cos(2πx/P + φ)] + noise + 线性漂移
   * 随机数用固定种子的 LCG，保证同参数结果可复现（报告 表 6.1 的可复现性要求）。
   */
  function synthesizeProfile(opts) {
    opts = opts || {};
    var n = opts.n || 1200;
    var P = opts.periodPx || 163.3;
    var V = opts.visibility == null ? 0.6 : opts.visibility;
    var noise = opts.noise == null ? 0.02 : opts.noise;
    var phi = opts.phi == null ? 0.7 : opts.phi;
    var drift = opts.drift == null ? 0.03 : opts.drift;
    var seed = opts.seed == null ? 1 : opts.seed;

    var s = seed;
    function rnd() { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; }

    var out = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var env = 1;
      if (opts.gaussEnvelope) env = Math.exp(-Math.pow((i - n / 2) / (n / 3), 2));
      out[i] = 0.5 * (1 + V * env * Math.cos(2 * Math.PI * i / P + phi))
               + noise * rnd() + drift * (i / n);
    }
    return out;
  }

  /* ---------------- RGBA → 一维剖面（纯函数） ----------------
   * axis='x'：按列求平均，得到随 x 变化的剖面（条纹竖直时用这个）
   * axis='y'：按行求平均，得到随 y 变化的剖面（条纹水平时用这个）
   * 亮度用 ITU-R BT.601 加权，与 Canvas 灰度化一致。
   */
  function profileFromImageData(data, width, height, axis) {
    var i, x, y, p, acc;
    if (axis === 'y') {
      var rows = new Float64Array(height);
      for (y = 0; y < height; y++) {
        acc = 0;
        for (x = 0; x < width; x++) {
          p = (y * width + x) * 4;
          acc += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
        }
        rows[y] = acc / width;
      }
      return rows;
    }
    var cols = new Float64Array(width);
    for (x = 0; x < width; x++) {
      acc = 0;
      for (y = 0; y < height; y++) {
        p = (y * width + x) * 4;
        acc += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      }
      cols[x] = acc / height;
    }
    return cols;
  }

  /* ---------------- 单条剖面 → Δx（纯函数） ---------------- */
  function analyzeProfile(profile, opts) {
    opts = opts || {};
    var P = phys();
    if (!P || typeof P.fringePeriod !== 'function') {
      throw new Error('core/fringe.js 需要先加载 physics.js');
    }
    var arr = Array.prototype.slice.call(profile);

    // 前置判定：纯平场 / 过曝 / 没对准视场时，fringePeriod 会返回 pow/2 这样的假周期，
    // 必须在这里拦掉，否则用户会拿到一个"看起来合理"的错数。
    var mn = Infinity, mx = -Infinity, i;
    for (i = 0; i < arr.length; i++) {
      if (!isFinite(arr[i])) throw new Error('剖面里有非数字像素，请重新导出图片');
      if (arr[i] < mn) mn = arr[i];
      if (arr[i] > mx) mx = arr[i];
    }
    if (!(mx - mn > 1e-9)) throw new Error('图像没有明暗变化，未找到周期性条纹');
    var contrast = (mx - mn) / (mx + mn > 0 ? (mx + mn) : 1);
    if (contrast < 0.005) throw new Error('条纹对比度太低（' + (contrast * 100).toFixed(2) + '%），请检查是否过曝或未对准视场');

    var r = P.fringePeriod(arr, { k: opts.k });
    if (!isFinite(r.periodPx) || r.periodPx < 4 || r.periodPx > arr.length / 2) {
      throw new Error('未找到可靠的条纹周期（测得 ' + (isFinite(r.periodPx) ? r.periodPx.toFixed(1) : '—') +
                      ' px），请确认条纹等间距且周期 ≥ 8 像素');
    }
    r.score = scoreOf(r);
    return r;
  }

  // 峰越锐、两种算法越一致，分数越高（用于横竖方向择取）
  function scoreOf(r) {
    if (!r || !isFinite(r.periodPx) || r.periodPx <= 0) return -1;
    var cross = isFinite(r.periodPxCross) ? Math.abs(r.periodPx - r.periodPxCross) / r.periodPx : 1;
    var v = isFinite(r.visibility) ? r.visibility : 0;
    return v / (1 + 10 * cross);
  }

  /* ---------------- 二维图像 → 选方向 → Δx ---------------- */
  function analyzeImageData(data, width, height, opts) {
    opts = opts || {};
    var attempts = [];
    ['x', 'y'].forEach(function (axis) {
      try {
        var prof = profileFromImageData(data, width, height, axis);
        var r = analyzeProfile(prof, opts);
        r.axis = axis;
        r.profile = prof;
        attempts.push(r);
      } catch (e) {
        attempts.push({ axis: axis, error: e.message, score: -1 });
      }
    });
    attempts.sort(function (a, b) { return (b.score || -1) - (a.score || -1); });
    var best = attempts[0];
    if (!best || !isFinite(best.periodPx)) {
      throw new Error('横竖两个方向都没找到周期性条纹，请确认图片里是等间距条纹且周期 ≥ 8 像素');
    }
    best.other = attempts[1];
    best.width = width; best.height = height;
    return best;
  }

  /* ---------------- 浏览器：文件 → 像素 → Δx ---------------- */
  function canvasOf(w, h) {
    var d = global.document;
    if (d && d.createElement) {
      var c = d.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
    if (typeof global.OffscreenCanvas === 'function') return new global.OffscreenCanvas(w, h);
    return null;
  }

  // opts: {k, maxSide}  maxSide 默认 1600，超大图先等比缩小（只影响像素口径，k 需按原图算）
  function pixelDataOf(source, width, height, maxSide) {
    var m = maxSide || 1600;
    var sc = Math.min(1, m / Math.max(width, height));
    var w = Math.max(32, Math.round(width * sc)), h = Math.max(32, Math.round(height * sc));
    var c = canvasOf(w, h);
    if (!c) throw new Error('当前环境不支持 canvas');
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0, w, h);
    var img = g.getImageData(0, 0, w, h);
    return { data: img.data, width: w, height: h, scale: sc };
  }

  function analyzeFile(file, opts) {
    opts = opts || {};
    return Promise.resolve().then(function () {
      if (typeof global.createImageBitmap === 'function') return global.createImageBitmap(file);
      return new Promise(function (res, rej) {
        var img = new global.Image();
        img.onload = function () { res(img); };
        img.onerror = function () { rej(new Error('图片解码失败')); };
        img.src = global.URL.createObjectURL(file);
      });
    }).then(function (src) {
      var w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
      var px = pixelDataOf(src, w, h, opts.maxSide);
      // 缩小过的话，像素当量要按缩小比例折算，才能得到原图的 mm
      var kEff = (opts.k && px.scale !== 1) ? opts.k / px.scale : opts.k;
      var r = analyzeImageData(px.data, px.width, px.height, { k: kEff });
      r.scale = px.scale;
      r.sourceSize = { width: w, height: h };
      return r;
    });
  }

  /* ---------------- 多帧统计（表 6.1 的口径） ----------------
   * ⚠ 单帧必须能走通：typeA 要求 ≥2 个值，若直接调它，
   *   一条只有 1 帧的 record.json 就会以"至少需要 2 个测量值"整条导入失败。
   *   n=1 时返回 mean 与 single=true，sd/uA 留 NaN，由页面显示"—"。
   */
  function framesStats(values) {
    var v = (values || []).map(Number).filter(function (x) { return isFinite(x); });
    if (!v.length) throw new Error('没有可用的帧');
    if (v.length === 1) {
      return { n: 1, mean: v[0], sd: NaN, uA: NaN, relSd: NaN, single: true };
    }
    var P = phys();
    if (!P || typeof P.typeA !== 'function') throw new Error('core/fringe.js 需要先加载 physics.js');
    var a = P.typeA(v);
    return { n: a.n, mean: a.mean, sd: a.sd, uA: a.uA,
             relSd: isFinite(a.relUA) ? a.relUA : (a.mean ? a.sd / a.mean : NaN), single: false };
  }
  /* ---------------- 多帧统计（表 6.1 的口径） ---------------- */
  function analyzeFrames(files, opts) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return Promise.reject(new Error('没有选择图片'));
    var per = [];
    return list.reduce(function (p, f) {
      return p.then(function () {
        return analyzeFile(f, opts).then(function (r) {
          per.push({ name: f.name, periodPx: r.periodPx, deltaXmm: r.deltaXmm,
                     visibility: r.visibility, periodPxCross: r.periodPxCross, axis: r.axis });
        }, function (e) { per.push({ name: f.name, error: e.message }); });
      });
    }, Promise.resolve()).then(function () {
      var ok = per.filter(function (x) { return isFinite(x.deltaXmm); });
      if (!ok.length) throw new Error('所有帧都没提取成功');
      var st = framesStats(ok.map(function (x) { return x.deltaXmm; }));
      return { n: st.n, failed: per.length - st.n, meanMm: st.mean, sdMm: st.sd,
               relSd: st.relSd, single: st.single, perFrame: per };
    });
  }

  /* ---------------- 自检：合成已知真值的条纹图并当场提取 ---------------- */
  // opts: {periodPx, visibility, noise, k, axisTest?}
  function selfTest(opts) {
    opts = opts || {};
    var P = opts.periodPx == null ? 163.3 : opts.periodPx;
    var k = opts.k == null ? 0.004 : opts.k;
    var prof = synthesizeProfile({
      n: opts.n || 1600, periodPx: P,
      visibility: opts.visibility == null ? 0.6 : opts.visibility,
      noise: opts.noise == null ? 0.02 : opts.noise,
      seed: opts.seed || 1, gaussEnvelope: true
    });
    var r = analyzeProfile(prof, { k: k });
    var truth = P * k;                       // mm
    r.truth = { periodPx: P, deltaXmm: truth, visibility: opts.visibility == null ? 0.6 : opts.visibility };
    r.relErr = r.deltaXmm ? (r.deltaXmm - truth) / truth : NaN;
    return r;
  }

  BP.fringe = {
    synthesizeProfile: synthesizeProfile,
    profileFromImageData: profileFromImageData,
    analyzeProfile: analyzeProfile,
    analyzeImageData: analyzeImageData,
    analyzeFile: analyzeFile,
    analyzeFrames: analyzeFrames,
    framesStats: framesStats,
    selfTest: selfTest,
    scoreOf: scoreOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = BP.fringe;
})(typeof window !== 'undefined' ? window : globalThis);
