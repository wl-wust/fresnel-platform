/* =========================================================================
 * physics.js —— 菲涅耳双棱镜干涉实验的纯前端计算库
 * 目标：不依赖任何后端，浏览器里直接算，三页（index / mobile / optical）共用。
 * 用法： <script src="js/physics.js"></script>
 *        const r = BiprismPhysics.wavelengthBasic({d:0.90213, D:1000, dxPx:163.3, k:0.004});
 * 说明：所有长度输入统一为 mm，波长为 nm；返回对象带 units 字段便于直接显示。
 * ========================================================================= */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;

  /* ---------------- 1. 基本公式法 -------------------------------------
   * λ = d·Δx/D，其中 Δx(mm) = Δx(px)·k
   */
  function wavelengthBasic(o) {
    var d = num(o.d), D = num(o.D), dxPx = num(o.dxPx), k = num(o.k);
    check(d > 0 && D > 0 && dxPx > 0 && k > 0,
          'd、D、Δx(px)、k 都必须为正数');
    var dxMm = dxPx * k;
    var lamMm = d * dxMm / D;
    return {
      value: lamMm * 1e6,            // nm
      unit: 'nm',
      dxMm: dxMm,
      relU: relU([uRel(o.uD, D), uRel(o.ud, d), uRel(o.udxPx, dxPx), uRel(o.uk, k)]),
      formula: 'λ = d·Δx·k / D'
    };
  }

  /* ---------------- 2. 比值法（含色散修正）----------------------------
   * λ_Na = λ_ref ·(Δx_Na/Δx_ref)·((n_Na-1)/(n_ref-1))
   * 最后一项是棱镜色散修正：BK7 在 589.3 nm / 650 nm 处 n = 1.5168 / 1.5145，
   * 修正量 (0.5168/0.5145 - 1) = +0.45%，漏掉它就是 +0.45% 的系统偏差。
   */
  function wavelengthRatio(o) {
    var dxNa = num(o.dxNaPx), dxRef = num(o.dxRefPx), lamRef = num(o.lamRef);
    var nNa = num(o.nNa, 1.5168), nRef = num(o.nRef, 1.5145);
    check(dxNa > 0 && dxRef > 0 && lamRef > 0 && nNa > 1 && nRef > 1,
          '两个条纹间距、参考波长必须为正数，折射率必须大于 1');
    var disp = (nNa - 1) / (nRef - 1);
    var lam = lamRef * (dxNa / dxRef) * disp;
    return {
      value: lam,
      unit: 'nm',
      dispersion: disp,                 // 1.0045 左右
      relU: relU([uRel(o.uLamRef, lamRef), uRel(o.udxNa, dxNa),
                  uRel(o.udxRef, dxRef),
                  uRel(o.unNa, nNa), uRel(o.unRef, nRef)]),
      formula: 'λ_Na = λ_ref·(Δx_Na/Δx_ref)·((n_Na-1)/(n_ref-1))'
    };
  }

  /* ---------------- 3. 横向放大率法 ------------------------------------
   * d = d′/β，代入 λ = d·Δx/D 得 λ = d′·Δx²/(Δx′·D)
   */
  function wavelengthMagnification(o) {
    var dPrime = num(o.dPrime), beta = num(o.beta);
    var dxNa = num(o.dxNaMm), D = num(o.D), dxPrime = num(o.dxPrimeMm);
    check(dPrime > 0 && beta > 0 && dxNa > 0 && D > 0 && dxPrime > 0,
          'd′、β、Δx、Δx′、D 都必须为正数');
    var d = dPrime / beta;
    return {
      value: (dPrime * dxNa * dxNa / (dxPrime * D)) * 1e6,
      unit: 'nm',
      dMm: d,
      relU: relU([uRel(o.udPrime, dPrime), uRel(o.ubeta, beta),
                  uRel(o.udxNa, dxNa), uRel(o.udxPrime, dxPrime), uRel(o.uD, D)]),
      formula: 'λ = d′·Δx²/(Δx′·D)'
    };
  }

  /* ---------------- 4. 不确定度 ---------------------------------------- */

  // 方和根合成若干相对分量
  function relU(list) {
    var s = 0;
    for (var i = 0; i < list.length; i++) if (isFinite(list[i])) s += list[i] * list[i];
    return Math.sqrt(s);
  }

  // 相对分量：给定绝对不确定度 u 与量值 x；u 缺省时返回 0
  function uRel(u, x) {
    return (u == null || !isFinite(u) || !x) ? 0 : Math.abs(u / x);
  }

  // A 类：重复测量的平均值与标准差
  function typeA(values) {
    var v = (values || []).map(Number).filter(isFinite);
    check(v.length >= 2, '至少需要 2 个测量值');
    var n = v.length, mean = v.reduce(function (a, b) { return a + b; }, 0) / n;
    var s2 = v.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (n - 1);
    var sd = Math.sqrt(s2);
    return {
      n: n, mean: mean, sd: sd,
      uA: sd / Math.sqrt(n),                 // 平均值的标准不确定度
      relUA: sd / Math.sqrt(n) / mean,
      range: Math.max.apply(null, v) - Math.min.apply(null, v)
    };
  }

  /* ---------------- 5. 多路径加权合成 + χ² 一致性检验 ------------------
   * λ̂ = Σw_iλ_i/Σw_i，w_i = 1/u_i²，u(λ̂) = 1/√Σw_i
   * χ² = Σ(λ_i-λ̂)²/u_i²，ν = n-1，判据 χ² ≤ χ²_0.95(ν)
   * 说明：三条路径共用同一批条纹数据（Δx、k），严格做法是先把 u(Δx)/Δx
   *       作为公共项单列（commonRelU），否则会低估合成不确定度。
   */
  function weightedCombine(paths, opts) {
    opts = opts || {};
    var list = (paths || []).filter(function (p) {
      return p && isFinite(p.value) && isFinite(p.uncertainty) && p.uncertainty > 0;
    });
    check(list.length >= 1, '至少需要 1 条有效路径（值 + 正的不确定度）');

    var sw = 0, swl = 0;
    list.forEach(function (p) { var w = 1 / (p.uncertainty * p.uncertainty); p.weight = w; sw += w; swl += w * p.value; });
    var mean = swl / sw;
    var uIndep = 1 / Math.sqrt(sw);                       // 只按独立分量合成

    // 公共项（例如 u(Δx)/Δx）单列后重新合成：公共项对每条路径的影响都等于 mean·c
    var c = num(opts.commonRelU, 0);
    var uWithCommon = Math.sqrt(uIndep * uIndep + (mean * c) * (mean * c));

    var chi2 = 0;
    list.forEach(function (p) { var t = (p.value - mean) / p.uncertainty; chi2 += t * t; });
    var dof = list.length - 1;
    var crit = chi2Crit95(dof);

    var standard = num(opts.standard);                     // 589.3 nm，可选
    return {
      mean: mean,
      uIndep: uIndep,
      uCombined: uWithCommon,
      relU: mean ? uWithCommon / mean : NaN,
      commonRelU: c,
      chi2: chi2,
      dof: dof,
      chi2Crit: crit,
      consistent: dof > 0 ? chi2 <= crit : true,
      bias: isFinite(standard) ? mean - standard : null,
      relBias: isFinite(standard) ? (mean - standard) / standard : null,
      paths: list
    };
  }

  // χ² 0.95 分位数（ν = 1..6 查表，超出用 Wilson–Hilferty 近似）
  var CHI2_95 = { 1: 3.841, 2: 5.991, 3: 7.815, 4: 9.488, 5: 11.070, 6: 12.592 };
  function chi2Crit95(dof) {
    if (dof < 1) return NaN;
    if (CHI2_95[dof]) return CHI2_95[dof];
    var a = 2 / (9 * dof), z = 0.05;                      // 1.645 对应 0.95
    var t = 1 - a + 1.645 * Math.sqrt(a);
    return dof * t * t * t;
  }

  /* ---------------- 6. 一维条纹周期（自相关选基频 + FFT/DFT 细化 + 零交叉检查）
   * 输入：一维强度数组 profile（沿垂直于条纹的方向投影得到）、像素间距 k(mm/px)
   * 输出：periodPx、deltaXmm、visibility、periodPxCross
   */
  function fringePeriod(profile, opts) {
    opts = opts || {};
    var n = profile.length;
    check(n >= 32, '条纹剖面太短（至少 32 像素）');

    // 6.1 去趋势：先减线性趋势，再减长尺度移动平均。
    // 真实图像里的圆形视场和暗角会形成很强的低频亮包络，只做线性去趋势
    // 会把 DC 附近的包络误当成"超长周期条纹"。
    var x = new Array(n), y = new Array(n), i;
    for (i = 0; i < n; i++) {
      x[i] = i; y[i] = profile[i];
      check(isFinite(y[i]), '条纹剖面里有非数字像素');
    }
    var fit = linfit(x, y);
    var det = new Array(n);
    for (i = 0; i < n; i++) det[i] = y[i] - (fit.a + fit.b * i);

    var hpWindow = Math.max(9, Math.round(n / 7));
    if (hpWindow % 2 === 0) hpWindow++;
    var smooth = movingAverage(det, hpWindow);
    var hp = new Float64Array(n), hpEnergy = 0;
    for (i = 0; i < n; i++) {
      hp[i] = det[i] - smooth[i];
      hpEnergy += hp[i] * hp[i];
    }
    check(hpEnergy > 1e-9, '图像只有低频亮度变化，未找到周期性条纹');

    // 6.2 自相关先锁基周期。自相关在 P、2P、3P 都有峰，
    // 取不低于全局峰 60% 的最早峰，可避免把第二谐波当成 Δx。
    var acf = autocorrelation(hp, Math.floor(n / 2));
    var lag = fundamentalLag(acf, 8);
    check(lag > 0, '未找到可靠的周期性峰');
    var acfPeriod = lag + parabolicOffset(acf[lag - 1], acf[lag], acf[lag + 1]);
    check(acfPeriod >= 8 && acfPeriod <= n / 2, '条纹周期超出可测范围');

    // 6.3 频谱细化和可见度使用仅线性去趋势的剖面；
    // 长周期正弦若再经过高通窗口，会因包络和边界产生约 0.1%~0.3% 的周期偏差。
    var pow = 1; while (pow < n * 4) pow <<= 1;
    var re = new Float64Array(pow), im = new Float64Array(pow), wsum = 0, w;
    for (i = 0; i < n; i++) {
      w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
      re[i] = det[i] * w; wsum += w;
    }
    fft(re, im);

    var kmin = Math.max(2, Math.ceil(pow / Math.max(1, n / 3)));
    var kmax = Math.min(pow / 2 - 1, Math.floor(pow / 8));
    var kmaxMag = -1, kx = -1;
    for (var k = kmin; k <= kmax; k++) {
      var m = re[k] * re[k] + im[k] * im[k];
      if (m > kmaxMag) { kmaxMag = m; kx = k; }
    }
    check(kx > 0, '未找到周期性峰，请检查图像或条纹方向');

    var f0 = kx / pow;
    var acfFreq = 1 / acfPeriod;
    var loBin = Math.max(kmin, Math.floor(pow * acfFreq * 0.94));
    var hiBin = Math.min(kmax, Math.ceil(pow * acfFreq * 1.06));
    var localMag = -1;
    for (var kb = loBin; kb <= hiBin; kb++) {
      var mb = re[kb] * re[kb] + im[kb] * im[kb];
      if (mb > localMag) { localMag = mb; f0 = kb / pow; }
    }

    // 6.4 在基频附近直接 DFT 细化（把频率分辨率提高两个量级）
    var best = { f: f0, mag: -1 };
    var lo = f0 * 0.98, hi = f0 * 1.02, steps = 401;
    for (var s = 0; s <= steps; s++) {
      var f = lo + (hi - lo) * s / steps, sr = 0, si = 0;
      for (i = 0; i < n; i++) {
        w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
        var ang = -2 * Math.PI * f * i;
        sr += det[i] * w * Math.cos(ang);
        si += det[i] * w * Math.sin(ang);
      }
      var mag = sr * sr + si * si;
      if (mag > best.mag) best = { f: f, mag: mag, re: sr, im: si };
    }
    var periodPx = 1 / best.f;

    // 6.5 可见度：取中央一半视场，平滑后按 V = (Imax-Imin)/(Imax+Imin)
    var vis = visibilityCenter(profile, periodPx);

    // 6.6 频谱信噪比：峰功率 / 有效频带中位数
    var band = [];
    for (var kk = kmin; kk <= kmax; kk++) band.push(re[kk] * re[kk] + im[kk] * im[kk]);
    band.sort(function (a, b) { return a - b; });
    var noiseFloor = band.length ? band[Math.floor(band.length / 2)] : 0;
    var spectralSnr = noiseFloor > 0 ? best.mag / noiseFloor : Infinity;

    // 6.7 时域交叉检查：低频包络强时，去趋势剖面可能出现漏计升沿；
    // 同时比较去趋势/高通两版，选用升沿数更接近期望周期数的一版。
    var crossDet = crossingStats(det, periodPx);
    var crossHp = crossingStats(hp, periodPx);
    var expectedCrossings = n / periodPx;
    var periodPxCross = Math.abs(crossDet.count - expectedCrossings) <=
                        Math.abs(crossHp.count - expectedCrossings)
                        ? crossDet.period : crossHp.period;

    return {
      periodPx: periodPx,
      periodPxCoarse: acfPeriod,
      periodPxCross: periodPxCross,
      deltaXmm: opts.k ? periodPx * opts.k : null,
      visibility: clamp01(vis),
      acfPeak: acf[lag],
      spectralSnr: spectralSnr,
      f: best.f,
      n: n
    };
  }

  // 变窗口移动平均：两端不补零，避免边界把低频背景重新带回剖面
  function movingAverage(profile, window) {
    var n = profile.length, out = new Float64Array(n);
    var half = Math.max(1, Math.floor(window / 2));
    for (var i = 0; i < n; i++) {
      var a = Math.max(0, i - half), b = Math.min(n - 1, i + half), sum = 0;
      for (var j = a; j <= b; j++) sum += profile[j];
      out[i] = sum / (b - a + 1);
    }
    return out;
  }

  // 归一化自相关；重叠区分别归一化，避免短滞后天然得分更高
  function autocorrelation(profile, maxLag) {
    var n = profile.length, out = new Float64Array(maxLag + 1);
    out[0] = 1;
    for (var lag = 1; lag <= maxLag; lag++) {
      var sxy = 0, sxx = 0, syy = 0;
      for (var i = 0; i + lag < n; i++) {
        var a = profile[i], b = profile[i + lag];
        sxy += a * b; sxx += a * a; syy += b * b;
      }
      out[lag] = (sxx > 1e-12 && syy > 1e-12) ? sxy / Math.sqrt(sxx * syy) : 0;
    }
    return out;
  }

  function fundamentalLag(acf, minLag) {
    var maxLag = acf.length - 2, globalMax = 0, lag;
    for (lag = minLag; lag <= maxLag; lag++) if (acf[lag] > globalMax) globalMax = acf[lag];
    if (!(globalMax > 0.02)) return -1;
    var threshold = Math.max(0.12, globalMax * 0.6);
    for (lag = minLag; lag <= maxLag; lag++) {
      if (acf[lag] > acf[lag - 1] && acf[lag] >= acf[lag + 1] && acf[lag] >= threshold) return lag;
    }
    for (lag = minLag; lag <= maxLag; lag++) {
      if (acf[lag] === globalMax) return lag;
    }
    return -1;
  }

  function parabolicOffset(ym1, y0, y1) {
    var den = ym1 - 2 * y0 + y1;
    if (Math.abs(den) < 1e-12) return 0;
    return Math.max(-0.5, Math.min(0.5, 0.5 * (ym1 - y1) / den));
  }

  // 中央一半视场内的可见度；滑动平均会把正弦幅度衰减 sinc(πL/P) 倍，这里直接补回来
  function visibilityCenter(profile, periodPx) {
    var n = profile.length;
    var a = Math.floor(n * 0.25), b = Math.floor(n * 0.75);
    var win = Math.max(1, Math.round(periodPx / 8));
    var sm = [];
    for (var i = a; i < b; i++) {
      var acc = 0, cnt = 0;
      for (var j = -win; j <= win; j++) {
        var t = i + j;
        if (t >= 0 && t < n) { acc += profile[t]; cnt++; }
      }
      sm.push(acc / cnt);
    }
    var mx = -Infinity, mn = Infinity;
    for (var k = 0; k < sm.length; k++) { if (sm[k] > mx) mx = sm[k]; if (sm[k] < mn) mn = sm[k]; }
    var v = (mx + mn) ? (mx - mn) / (mx + mn) : NaN;
    var L = 2 * win + 1, xx = Math.PI * L / periodPx;
    var att = Math.abs(xx < 1e-9 ? 1 : Math.sin(xx) / xx);
    return att > 1e-6 ? Math.min(1, v / att) : v;
  }

  // 过零点回归：先按 周期/6 做滑动平均压噪，再找升沿位置 x_k 对 k 回归，斜率即周期
  function crossingStats(det, d0) {
    var n = det.length, half = Math.max(2, Math.round((d0 || n / 10) / 6));
    var sm = new Array(n);
    for (var i = 0; i < n; i++) {
      var acc = 0, cnt = 0;
      for (var j = -half; j <= half; j++) {
        var t = i + j;
        if (t >= 0 && t < n) { acc += det[t]; cnt++; }
      }
      sm[i] = acc / cnt;
    }
    var xs = [];
    for (var i2 = 1; i2 < n; i2++) {
      if (sm[i2 - 1] <= 0 && sm[i2] > 0) {
        var frac = sm[i2 - 1] === sm[i2] ? 0 : sm[i2 - 1] / (sm[i2 - 1] - sm[i2]);
        xs.push(i2 - 1 + frac);
      }
    }
    if (xs.length < 3) return { period: NaN, count: xs.length };
    var ks = [], sx = 0, sy = 0, sxx = 0, sxy = 0, m = xs.length;
    for (var k = 0; k < m; k++) { ks.push(k); sx += k; sy += xs[k]; sxx += k * k; sxy += k * xs[k]; }
    var den = m * sxx - sx * sx;
    return { period: den ? (m * sxy - sx * sy) / den : NaN, count: m };
  }

  /* ---------------- 7. 像素当量：k = L/N ------------------------------- */
  function pixelScale(o) {
    var L = num(o.L), N = num(o.N);
    check(L > 0 && N > 0, '标定长度与像素数都必须为正数');
    return { k: L / N, unit: 'mm/px' };
  }

  /* ---------------- 工具 ------------------------------------------------- */
  function num(v, dflt) {
    var r = typeof v === 'string' ? parseFloat(v) : v;
    if (r == null || (typeof r === 'number' && !isFinite(r))) return dflt === undefined ? NaN : dflt;
    return r;
  }
  function check(cond, msg) { if (!cond) { var e = new Error(msg); e.isInputError = true; throw e; } }
  function clamp01(v) { return isFinite(v) ? Math.max(0, Math.min(1, v)) : NaN; }
  function linfit(xs, ys) {
    var n = xs.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    var den = n * sxx - sx * sx;
    var b = den ? (n * sxy - sx * sy) / den : 0;
    return { b: b, a: (sy - b * sx) / n };
  }
  // 迭代 radix-2 FFT（原地）
  function fft(re, im) {
    var n = re.length, i, j, k, m, len, ang, wr, wi, ur, ui, vr, vi;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (len = 2; len <= n; len <<= 1) {
      ang = -2 * Math.PI / len;
      wr = Math.cos(ang); wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          ur = re[i + k]; ui = im[i + k];
          vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  var API = {
    DEG: DEG,
    wavelengthBasic: wavelengthBasic,
    wavelengthRatio: wavelengthRatio,
    wavelengthMagnification: wavelengthMagnification,
    typeA: typeA,
    weightedCombine: weightedCombine,
    chi2Crit95: chi2Crit95,
    fringePeriod: fringePeriod,
    pixelScale: pixelScale,
    _fft: fft
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.BiprismPhysics = API;
})(typeof window !== 'undefined' ? window : globalThis);
