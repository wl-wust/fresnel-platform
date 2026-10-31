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

  /* ---------------- 6. 一维条纹周期（FFT + 抛物线细化 + 相位法交叉检查）
   * 输入：一维强度数组 profile（沿垂直于条纹的方向投影得到）、像素间距 k(mm/px)
   * 输出：periodPx、deltaXmm、visibility、periodPxPhase（交叉检查）
   */
  function fringePeriod(profile, opts) {
    opts = opts || {};
    var n = profile.length;
    check(n >= 32, '条纹剖面太短（至少 32 像素）');

    // 6.1 去趋势：减线性最小二乘
    var x = new Array(n), y = new Array(n), i;
    for (i = 0; i < n; i++) { x[i] = i; y[i] = profile[i]; }
    var fit = linfit(x, y);
    var det = new Array(n);
    for (i = 0; i < n; i++) det[i] = y[i] - (fit.a + fit.b * i);

    // 6.2 加 Hann 窗，补零到 2 的幂
    var pow = 1; while (pow < n * 4) pow <<= 1;
    var re = new Float64Array(pow), im = new Float64Array(pow), wsum = 0, w;
    for (i = 0; i < n; i++) {
      w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
      re[i] = det[i] * w; wsum += w;
    }
    fft(re, im);

    // 6.3 找峰值（跳过 DC 与很低的频率）
    var kmin = Math.max(2, Math.floor(pow / 4096)), kmax = pow / 2 - 1, kmaxMag = -1, kx = -1;
    for (var k = kmin; k <= kmax; k++) {
      var m = re[k] * re[k] + im[k] * im[k];
      if (m > kmaxMag) { kmaxMag = m; kx = k; }
    }
    check(kx > 0, '未找到周期性峰，请检查图像或条纹方向');

    var f0 = kx / pow;                                    // cycles/px（补零后仍按原采样率）
    var dx0 = 1 / f0;

    // 6.4 在 ±2% 范围内直接 DFT 细化（把频率分辨率提高两个量级）
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

    // 6.6 时域交叉检查：数过零点（升沿）并做线性回归
    var periodPxCross = crossingPeriod(det, dx0);

    return {
      periodPx: periodPx,
      periodPxCoarse: dx0,
      periodPxCross: periodPxCross,
      deltaXmm: opts.k ? periodPx * opts.k : null,
      visibility: clamp01(vis),
      f: best.f,
      n: n
    };
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
  function crossingPeriod(det, d0) {
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
    if (xs.length < 3) return NaN;
    var ks = [], sx = 0, sy = 0, sxx = 0, sxy = 0, m = xs.length;
    for (var k = 0; k < m; k++) { ks.push(k); sx += k; sy += xs[k]; sxx += k * k; sxy += k * xs[k]; }
    var den = m * sxx - sx * sx;
    return den ? (m * sxy - sx * sy) / den : NaN;
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

  /* ---------------- 8. 不确定度预算：表 8.1 八分量 → 三路径折叠 ----------
   * 口径（与研究报告表 8.1 一致，也是本平台最容易错的一处）：
   *   1) 8 个输入全部是"相对标准不确定度"（无量纲、非负，缺省 0）；
   *   2) n 的分母是 (n−1)，**不是** n。同一份 u(n)，按 u(n)/n 记只有
   *      0.5168/1.5168 ≈ 34% 那么大；若按 u(n)/n 输入，比值法会从
   *      0.0973% 掉到 0.0575%，而报告表 5.2 是 0.10%。
   *      → wavelengthRatio() 自带的 relU 只作内部参考，界面一律用本节的 relU。
   *   3) 三条路径的折叠规则（λ 对各自变量的相对灵敏系数）：
   *        基本式/追迹法 λ = d·Δx/D
   *          relU = √[(u(d)/d)² + (u(D)/D)² + (u(Δx)/Δx)²]
   *          u(d)/d = √[(u(a)/a)² + (u(n)/(n−1))² + (u(A)/A)²]      ← foldD()
   *        比值法 λ = λ_ref·(Δx_Na/Δx_ref)·((n_Na−1)/(n_ref−1))
   *          relU = √[u(λ_ref)² + 2·(u(n)/(n−1))² + 2·(u(Δx)/Δx)²]
   *        放大率法 λ = d′·Δx²/(Δx′·D)，取 β = Δx′/Δx 折叠成 λ = d′·Δx/(β·D)
   *          relU = √[(u(β)/β)² + (u(d′)/d′)² + (u(D)/D)² + (u(Δx)/Δx)²]
   *          （β 由同一批 Δx、Δx′ 得出，已含一份 u(Δx)，故 Δx 只计一次）
   * 金标准（表 8.1 输入 → 表 5.2 结果，tools/selftest.js 断言）：
   *   u(d)/d = 0.1199%；基本式/追迹法 0.1299%；比值法 0.0973%；放大率法 0.1393%
   */
  var BUDGET_KEYS = ['dx', 'a', 'A', 'nMinus1', 'D', 'beta', 'dPrime', 'lamRef'];

  var BUDGET_PATHS = {
    basic: { name: '基本公式法', formula: 'λ = d·Δx/D',
             uses: ['a', 'nMinus1', 'A', 'D', 'dx'] },
    trace: { name: '光线追迹法', formula: 'λ = d·Δx/D（d 由追迹给出）',
             uses: ['a', 'nMinus1', 'A', 'D', 'dx'] },
    ratio: { name: '比值法', formula: 'λ_Na = λ_ref·(Δx_Na/Δx_ref)·((n_Na−1)/(n_ref−1))',
             uses: ['lamRef', 'nMinus1', 'dx'] },
    mag:   { name: '横向放大率法', formula: 'λ = d′·Δx/(β·D)',
             uses: ['beta', 'dPrime', 'D', 'dx'] }
  };

  // 补齐/清洗 8 个相对分量：缺省 0，负数与非有限值一律记 0
  function normComps(comps) {
    var src = comps || {}, out = {}, i, k, v;
    for (i = 0; i < BUDGET_KEYS.length; i++) {
      k = BUDGET_KEYS[i]; v = num(src[k], 0);
      out[k] = (isFinite(v) && v >= 0) ? v : 0;
    }
    return out;
  }

  // d = 2·a·(n−1)·A ⇒ u(d)/d 由 a、n、A 三个相对分量合成
  function foldD(comps) {
    var c = normComps(comps);
    return relU([c.a, c.nMinus1, c.A]);
  }

  // 按路径折叠；opts: {path, comps 或 8 个键直接平铺, value?(nm)}
  function uncertaintyBudget(opts) {
    opts = opts || {};
    var path = String(opts.path || 'basic'), rule = BUDGET_PATHS[path];
    check(!!rule, '未知的解算路径：' + path + '（可选 basic / trace / ratio / mag）');
    var c = normComps(opts.comps || opts);
    var fd = foldD(c), rel;
    if (path === 'ratio') rel = relU([c.lamRef, c.nMinus1, c.nMinus1, c.dx, c.dx]);
    else if (path === 'mag') rel = relU([c.beta, c.dPrime, c.D, c.dx]);
    else rel = relU([fd, c.D, c.dx]);
    var value = num(opts.value);
    return {
      path: path, name: rule.name, formula: rule.formula,
      relU: rel,                 // 相对标准不确定度（无量纲）
      uAbs: isFinite(value) ? rel * value : NaN,
      foldedD: fd,               // u(d)/d，basic / trace 会用到
      uses: rule.uses.slice(),   // 该路径实际用到的分量键，界面据此高亮
      comps: c
    };
  }

  // 表 8.1 的 8 个分量（默认值 + 中文名 + 来源），界面可直接铺成输入表
  function budgetPreset() {
    return [
      { key: 'dx',      label: 'u(Δx)/Δx',       source: '条纹提取（30 帧统计）',      relU: 0.000006 },
      { key: 'a',       label: 'u(a)/a',         source: '单缝—棱脊距离（导轨）',      relU: 0.00100 },
      { key: 'A',       label: 'u(A)/A',         source: '折射棱角（自准直）',         relU: 0.00030 },
      { key: 'nMinus1', label: 'u(n)/(n−1)',     source: '折射率（最小偏向角，单支）', relU: 0.00059 },
      { key: 'D',       label: 'u(D)/D',         source: '观察距离（导轨）',           relU: 0.00050 },
      { key: 'beta',    label: 'u(β)/β',         source: '放大率（二次成像）',         relU: 0.00120 },
      { key: 'dPrime',  label: 'u(d′)/d′',       source: '像间距（像斑质心）',         relU: 0.00050 },
      { key: 'lamRef',  label: 'u(λ_ref)/λ_ref', source: '激光波长标定',               relU: 0.00050 }
    ];
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
    linfit: linfit,
    pixelScale: pixelScale,
    relU: relU,
    foldD: foldD,
    uncertaintyBudget: uncertaintyBudget,
    budgetPreset: budgetPreset,
    BUDGET_PATHS: BUDGET_PATHS,
    _fft: fft
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.BiprismPhysics = API;
})(typeof window !== 'undefined' ? window : globalThis);
