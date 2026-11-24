/* =========================================================================
 * core/report-errors.js —— 报告误差、准确度与一致性计算
 * 原则：只传播已定义来源的输入；缺失或预设值必须由调用方显式标记。
 * ========================================================================= */
(function (global) {
  'use strict';

  var CHI2_95 = { 1: 3.841, 2: 5.991, 3: 7.815, 4: 9.488, 5: 11.070, 6: 12.592 };

  function finite(value) {
    return value !== null && value !== '' && Number.isFinite(Number(value));
  }

  function num(value) {
    return finite(value) ? Number(value) : NaN;
  }

  function mean(values) {
    var list = (values || []).map(Number).filter(Number.isFinite);
    if (!list.length) return null;
    return list.reduce(function (sum, value) { return sum + value; }, 0) / list.length;
  }

  /* 样本统计统一采用 n−1 标准差；uA 为“均值”的标准误差。 */
  function sampleStats(values) {
    var list = (values || []).map(Number).filter(Number.isFinite);
    var avg = mean(list);
    var sd = null;
    var uA = null;
    if (list.length > 1) {
      var variance = list.reduce(function (sum, value) {
        return sum + (value - avg) * (value - avg);
      }, 0) / (list.length - 1);
      sd = Math.sqrt(variance);
      uA = sd / Math.sqrt(list.length);
    }
    return {
      n: list.length,
      mean: avg,
      sd: sd,
      uA: uA,
      cv: avg ? sd / Math.abs(avg) : null,
      relativeUA: avg && uA !== null ? uA / Math.abs(avg) : null
    };
  }

  function summaryFromStats(stats) {
    if (!stats) return null;
    var meanValue = finite(stats.mean) ? stats.mean : stats.meanPx;
    var sdValue = finite(stats.sd) ? stats.sd : stats.sdPx;
    var uaValue = finite(stats.uA) ? stats.uA : stats.uAPx;
    if (!finite(meanValue) || !(Number(meanValue) > 0)) return null;
    var n = finite(stats.n) && Number(stats.n) > 0 ? Number(stats.n) : 0;
    var sd = finite(sdValue) ? Number(sdValue) : null;
    var uA = finite(uaValue) ? Number(uaValue) : null;
    if (uA === null && sd !== null && n > 0) uA = sd / Math.sqrt(n);
    return {
      n: n,
      mean: Number(meanValue),
      sd: sd,
      uA: uA
    };
  }

  function relativeTerm(value, uncertainty) {
    var v = num(value);
    var u = num(uncertainty);
    if (!(v > 0) || !Number.isFinite(u)) return null;
    return Math.abs(u / v);
  }

  function rootSumSquare(parts) {
    return Math.sqrt(parts.reduce(function (sum, value) {
      return sum + (Number.isFinite(value) ? value * value : 0);
    }, 0));
  }

  /* 比值法（钠光标准 → 红光待测）：
   * λ_R = λ_Na·(Δx_R/Δx_Na)·((n_R−1)/(n_Na−1))
   * standard 角色 = 钠光条纹，target 角色 = 红光条纹；两者都必须是真实数据。
   */
  function ratioConditional(inputs) {
    inputs = inputs || {};
    if (inputs.lamRef !== undefined && inputs.lambdaStandardNm === undefined) {
      throw new Error('比值法方向已改为“钠光标准→红光待测”：请改传 lambdaStandardNm / nStandard / nTarget');
    }
    var std = summaryFromStats(inputs.standard || inputs.sodium);
    var tgt = summaryFromStats(inputs.target || inputs.reference);
    if (!std || !tgt) throw new Error('比值法需要钠光标准与红光待测两组有效帧');
    if (!(num(inputs.lambdaStandardNm) > 0)) throw new Error('钠光标准波长必须为正数');
    if (!(num(inputs.nStandard) > 1) || !(num(inputs.nTarget) > 1)) {
      throw new Error('两组折射率都必须大于 1');
    }

    var lamStd = num(inputs.lambdaStandardNm);
    var nStd = num(inputs.nStandard);
    var nTgt = num(inputs.nTarget);
    var dispersion = (nTgt - 1) / (nStd - 1);
    var valueNm = lamStd * (tgt.mean / std.mean) * dispersion;

    var terms = [
      {
        key: 'dxStandard',
        label: 'u(Δx_Na)/Δx_Na',
        relU: std.uA !== null ? std.uA / std.mean : 0,
        source: '钠光标准条纹多帧均值标准误差'
      },
      {
        key: 'dxTarget',
        label: 'u(Δx_R)/Δx_R',
        relU: tgt.uA !== null ? tgt.uA / tgt.mean : 0,
        source: '红光待测条纹多帧均值标准误差'
      },
      {
        key: 'lambdaStandard',
        label: 'u(λ_Na)/λ_Na',
        relU: relativeTerm(lamStd, inputs.uLambdaStandard) || 0,
        source: '钠光标准波长（标准值 589.3 nm，不计入测量不确定度）'
      },
      {
        key: 'nStandard',
        label: 'u(n_Na)/(n_Na−1)',
        relU: relativeTerm(nStd - 1, inputs.uNStandard) || 0,
        source: '钠光折射率（N-BK7 假设值）'
      },
      {
        key: 'nTarget',
        label: 'u(n_R)/(n_R−1)',
        relU: relativeTerm(nTgt - 1, inputs.uNTarget) || 0,
        source: '红光折射率（N-BK7 假设值）'
      }
    ];
    var relativeU = rootSumSquare(terms.map(function (item) { return item.relU; }));
    /* 650 nm 只是激光器标称值，仅作比较，不作为已校准真值。 */
    var accuracyResult = accuracy(valueNm, inputs.nominalTargetNm || 650);

    return {
      valueNm: valueNm,
      uNm: valueNm * relativeU,
      relativeU: relativeU,
      biasNm: accuracyResult.biasNm,
      relativeBias: accuracyResult.relativeBias,
      dispersion: dispersion,
      conditional: inputs.conditional !== false,
      targetOnly: inputs.referenceOnly === true,
      standard: std,
      target: tgt,
      terms: terms,
      accuracy: accuracyResult,
      accuracyBasis: '与激光器标称 650 nm 的比较（非已校准真值）',
      formula: 'λ_R = λ_Na·(Δx_R/Δx_Na)·((n_R−1)/(n_Na−1))'
    };
  }

  /* 双侧 95% 的 t 分位（ν 为有效自由度），表值 + 线性插值。
   * ν_eff 由 Welch–Satterthwaite 合成，只用于“仅 A 类重复性”的扩展不确定度。
   */
  var T95 = [
    [1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571],
    [6, 2.447], [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228],
    [12, 2.179], [15, 2.131], [20, 2.086], [25, 2.060], [30, 2.042],
    [40, 2.021], [50, 2.009], [60, 2.000], [80, 1.990], [100, 1.984],
    [120, 1.980], [1e9, 1.960]
  ];

  function t95(nu) {
    var v = num(nu);
    if (!(v > 0)) return 1.960;
    for (var i = 0; i < T95.length - 1; i++) {
      var a = T95[i], b = T95[i + 1];
      if (v <= b[0]) {
        var span = b[0] - a[0];
        var w = span > 0 ? (v - a[0]) / span : 1;
        return a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, w));
      }
    }
    return 1.960;
  }

  /* 绝对不确定度保留 1 位有效数字并“只进不舍”（课堂幻灯片规则）。 */
  function roundUpOneSig(value) {
    var v = Math.abs(num(value));
    if (!(v > 0)) return 0;
    var exp = Math.floor(Math.log10(v));
    var scale = Math.pow(10, exp);
    var scaled = v / scale;
    var up = Math.ceil(scaled * 1.0000001);
    return up * scale;
  }

  /* 五步 A 类（重复性）预算：钠光标准 → 红光待测。
   * 只传播两项条纹间距的重复性；λ_Na、n_R、n_Na 的 B 类分量没有有效来源，
   * 一律标为“未定量”，不以 0 补齐，也不并入 U_r。
   */
  function ratioTypeABudget(inputs) {
    inputs = inputs || {};
    var std = summaryFromStats(inputs.standard);
    var tgt = summaryFromStats(inputs.target);
    if (!std || !tgt) throw new Error('A 类预算需要钠光标准与红光待测两组有效帧');
    var lamStd = num(inputs.lambdaStandardNm);
    var nStd = num(inputs.nStandard);
    var nTgt = num(inputs.nTarget);
    if (!(lamStd > 0) || !(nStd > 1) || !(nTgt > 1)) {
      throw new Error('标准波长与两组折射率必须有效');
    }

    /* ---- 第 1 步：测量值 ---- */
    var dispersion = (nTgt - 1) / (nStd - 1);
    var ratio = tgt.mean / std.mean;
    var valueNm = lamStd * ratio * dispersion;

    /* ---- 第 2 步：A 类相对不确定度 ---- */
    var uAT = tgt.uA !== null ? tgt.uA / tgt.mean : null;
    var uAS = std.uA !== null ? std.uA / std.mean : null;
    var uARel = Math.sqrt((uAT || 0) * (uAT || 0) + (uAS || 0) * (uAS || 0));
    var uANm = valueNm * uARel;

    /* 有效自由度（Welch–Satterthwaite），只含这两个 A 类项 */
    var nuEff = null;
    var sT = (uAT || 0) * (uAT || 0);
    var sS = (uAS || 0) * (uAS || 0);
    var dofT = tgt.uA !== null ? tgt.n - 1 : 0;
    var dofS = std.uA !== null ? std.n - 1 : 0;
    var denom = (dofT > 0 ? Math.pow(sT, 2) / dofT : 0) +
                (dofS > 0 ? Math.pow(sS, 2) / dofS : 0);
    if (denom > 0) nuEff = Math.pow(sT + sS, 2) / denom;

    /* ---- 第 3 步：扩展相对不确定度 ---- */
    var tFactor = t95(nuEff);
    var ur95 = tFactor * uARel;

    /* ---- 第 4 步：绝对不确定度（内部不提前舍入） ---- */
    var u95Nm = valueNm * ur95;
    var u95Rounded = roundUpOneSig(u95Nm);

    /* ---- 第 5 步：结果表达式 ---- */
    var decimals = Math.max(0, -Math.floor(Math.log10(u95Rounded)));
    var expression = '(' + valueNm.toFixed(decimals) + ' ± ' + u95Rounded.toFixed(decimals) + ') nm';

    /* ---- 与理论/标称值的比较（650 nm 未独立校准） ---- */
    var nominal = num(inputs.nominalTargetNm);
    var comparison = null;
    if (nominal > 0) {
      var delta = valueNm - nominal;
      var rel = delta / nominal;
      comparison = {
        nominalNm: nominal,
        deltaNm: delta,
        deltaAligned: delta.toFixed(decimals) * 1,
        deltaText: '(' + delta.toFixed(decimals) + ' ± ' + u95Rounded.toFixed(decimals) + ') nm',
        relativeDiff: rel,
        relativeDiffPercent: rel * 100,
        basis: '与理论/标称 ' + nominal + ' nm 比较；该值未独立校准，不得写作“真实误差”或“方法误差”'
      };
    }

    /* ---- 误差传播：五项，缺依据的标未定量 ---- */
    var terms = [
      {
        key: 'dxTarget', label: 'u(Δx_R)/Δx_R',
        relU: uAT, value: tgt.mean, unit: 'mm',
        source: '红光待测条纹 ' + tgt.n + ' 帧，s/√n',
        quantified: uAT !== null, kind: 'A'
      },
      {
        key: 'dxStandard', label: 'u(Δx_Na)/Δx_Na',
        relU: uAS, value: std.mean, unit: 'mm',
        source: '钠光标准条纹 ' + std.n + ' 帧，s/√n',
        quantified: uAS !== null, kind: 'A'
      },
      {
        key: 'lambdaStandard', label: 'u(λ_Na)/λ_Na',
        relU: null, value: lamStd, unit: 'nm',
        source: '钠黄光标准波长（国际标准值）',
        quantified: false, kind: 'B',
        note: '未定量：作为标准值使用，不再引入测量不确定度'
      },
      {
        key: 'nTarget', label: 'u(n_R)/(n_R−1)',
        relU: null, value: nTgt, unit: '',
        source: 'N-BK7 折射率假设值',
        quantified: false, kind: 'B',
        note: '未定量：缺材料证书与色散实测'
      },
      {
        key: 'nStandard', label: 'u(n_Na)/(n_Na−1)',
        relU: null, value: nStd, unit: '',
        source: 'N-BK7 折射率假设值',
        quantified: false, kind: 'B',
        note: '未定量：缺材料证书与色散实测'
      }
    ];

    return {
      valueNm: valueNm,
      dispersion: dispersion,
      ratio: ratio,
      standard: std,
      target: tgt,
      /* 第 2 步 */
      uATargetRel: uAT,
      uAStandardRel: uAS,
      uARel: uARel,
      uANm: uANm,
      /* 第 3 步 */
      degrees: { target: tgt.n - 1, standard: std.n - 1 },
      nuEff: nuEff,
      tFactor: tFactor,
      ur95: ur95,
      /* 第 4、5 步 */
      u95Nm: u95Nm,
      u95Rounded: u95Rounded,
      expression: expression,
      ur95Percent: ur95 * 100,
      /* 说明 */
      scope: '仅 A 类重复性项（P=95%）',
      isCompleteBudget: false,
      terms: terms,
      unquantified: terms.filter(function (x) { return !x.quantified; }),
      comparison: comparison,
      /* 单帧重复性（与均值扩展不确定度是两个口径） */
      singleFrameRelative: tgt.sd !== null && tgt.mean ? tgt.sd / tgt.mean : null,
      singleFrameNm: tgt.sd !== null ? tgt.sd * valueNm / tgt.mean : null
    };
  }

  function accuracy(value, standard) {
    var v = num(value);
    var s = num(standard);
    if (!Number.isFinite(v) || !(s > 0)) {
      return { standardNm: s, biasNm: null, relativeBias: null };
    }
    return {
      standardNm: s,
      biasNm: v - s,
      relativeBias: (v - s) / s
    };
  }

  function chi2Critical95(dof) {
    var df = Number(dof);
    if (!(df >= 1)) return null;
    if (CHI2_95[df]) return CHI2_95[df];
    var a = 2 / (9 * df);
    var t = 1 - a + 1.645 * Math.sqrt(a);
    return df * t * t * t;
  }

  function chiSquareConsistency(paths) {
    var list = (paths || []).filter(function (path) {
      return path && Number.isFinite(Number(path.value)) &&
        Number.isFinite(Number(path.uncertainty)) && Number(path.uncertainty) > 0;
    }).map(function (path) {
      return {
        name: path.name || '未命名路径',
        value: Number(path.value),
        uncertainty: Number(path.uncertainty)
      };
    });
    if (!list.length) {
      return {
        mean: null, chi2: null, dof: null, critical95: null,
        consistent: null, paths: []
      };
    }
    var sumWeight = 0;
    var sumWeightValue = 0;
    list.forEach(function (path) {
      path.weight = 1 / (path.uncertainty * path.uncertainty);
      sumWeight += path.weight;
      sumWeightValue += path.weight * path.value;
    });
    var weightedMean = sumWeightValue / sumWeight;
    var chi2 = list.reduce(function (sum, path) {
      var residual = (path.value - weightedMean) / path.uncertainty;
      path.residual = residual;
      return sum + residual * residual;
    }, 0);
    var dof = list.length - 1;
    var critical = chi2Critical95(dof);
    return {
      mean: weightedMean,
      uncertainty: list.length >= 1 ? 1 / Math.sqrt(sumWeight) : null,
      chi2: chi2,
      dof: dof,
      critical95: critical,
      consistent: dof > 0 && critical !== null ? chi2 <= critical : null,
      paths: list
    };
  }

  var API = {
    finite: finite,
    mean: mean,
    sampleStats: sampleStats,
    ratioConditional: ratioConditional,
    accuracy: accuracy,
    chi2Critical95: chi2Critical95,
    chiSquareConsistency: chiSquareConsistency,
    ratioTypeABudget: ratioTypeABudget,
    roundUpOneSig: roundUpOneSig,
    t95: t95,
  };

  global.BP = global.BP || {};
  global.BP.reportErrors = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
