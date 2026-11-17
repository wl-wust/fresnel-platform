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

  /* 比值法：λ_Na = λ_ref·(Δx_Na/Δx_ref)·((n_Na−1)/(n_ref−1))。 */
  function ratioConditional(inputs) {
    inputs = inputs || {};
    var sodium = summaryFromStats(inputs.sodium);
    var reference = summaryFromStats(inputs.reference);
    if (!sodium || !reference) throw new Error('比值法需要钠光与参考两组有效帧');
    if (!(num(inputs.lamRef) > 0)) throw new Error('参考波长必须为正数');
    if (!(num(inputs.nNa) > 1) || !(num(inputs.nRef) > 1)) {
      throw new Error('两组折射率都必须大于 1');
    }

    var lamRef = num(inputs.lamRef);
    var nNa = num(inputs.nNa);
    var nRef = num(inputs.nRef);
    var dispersion = (nNa - 1) / (nRef - 1);
    var valueNm = lamRef * (sodium.mean / reference.mean) * dispersion;

    var terms = [
      {
        key: 'dxNa',
        label: 'u(Δx_Na)/Δx_Na',
        relU: sodium.uA !== null ? sodium.uA / sodium.mean : 0,
        source: '钠光多帧均值标准误差'
      },
      {
        key: 'dxRef',
        label: 'u(Δx_ref)/Δx_ref',
        relU: reference.uA !== null ? reference.uA / reference.mean : 0,
        source: '红光参考多帧均值标准误差'
      },
      {
        key: 'lamRef',
        label: 'u(λ_ref)/λ_ref',
        relU: relativeTerm(lamRef, inputs.uLamRef) || 0,
        source: '参考波长输入'
      },
      {
        key: 'nNa',
        label: 'u(n_Na)/(n_Na−1)',
        relU: relativeTerm(nNa - 1, inputs.uNNa) || 0,
        source: '钠光折射率输入'
      },
      {
        key: 'nRef',
        label: 'u(n_ref)/(n_ref−1)',
        relU: relativeTerm(nRef - 1, inputs.uNRef) || 0,
        source: '参考光折射率输入'
      }
    ];
    var relativeU = rootSumSquare(terms.map(function (item) { return item.relU; }));
    var accuracyResult = accuracy(valueNm, inputs.standardNm || 589.3);

    return {
      valueNm: valueNm,
      uNm: valueNm * relativeU,
      relativeU: relativeU,
      biasNm: accuracyResult.biasNm,
      relativeBias: accuracyResult.relativeBias,
      dispersion: dispersion,
      conditional: inputs.conditional !== false,
      referenceOnly: inputs.referenceOnly === true,
      sodium: sodium,
      reference: reference,
      terms: terms,
      accuracy: accuracyResult,
      formula: 'λ_Na = λ_ref·(Δx_Na/Δx_ref)·((n_Na−1)/(n_ref−1))'
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
    chiSquareConsistency: chiSquareConsistency
  };

  global.BP = global.BP || {};
  global.BP.reportErrors = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
