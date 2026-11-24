/* =========================================================================
 * core/session-data.js —— 把测量会话映射为各方法的计算参数
 * 依赖：core/sessions.js、physics.js（仅用于读取多帧波长统计）
 * 原则：识别值只来自当前会话帧；未知参数留空并标记缺失，不塞报告默认值。
 * ========================================================================= */
(function (global) {
  'use strict';

  var SOURCE = {
    auto: '自动识别',
    calibration: '来自标定',
    session: '当前会话继承',
    report: '报告预设',
    manual: '手动输入',
    trace: '追迹预设',
    unknown: '来源未标注'
  };
  var METHOD_LABEL = {
    basic: '基本公式',
    ratio: '比值法',
    magnification: '横向放大率法',
    trace: '光线追迹法'
  };
  var ROLE_LABEL = {
    sodium: '钠光标准条纹',
    reference: '红光待测条纹',
    no_lens: '无透镜条纹',
    with_lens: '加透镜条纹'
  };

  function finite(value) {
    return value !== null && value !== '' && isFinite(value);
  }
  function numberOrNull(value) {
    return finite(value) ? Number(value) : null;
  }
  function mean(values) {
    if (!values.length) return null;
    return values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
  }
  function sd(values, avg) {
    if (values.length < 2) return null;
    var variance = values.reduce(function (sum, value) {
      return sum + (value - avg) * (value - avg);
    }, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }
  function sampleStats(values) {
    var avg = mean(values);
    var sigma = sd(values, avg);
    return {
      n: values.length,
      mean: avg,
      sd: sigma,
      uA: sigma === null ? null : sigma / Math.sqrt(values.length)
    };
  }
  function frameStatus(frame) {
    if (global.BP && global.BP.frameCalibration &&
        typeof global.BP.frameCalibration.calibrationStatus === 'function') {
      return global.BP.frameCalibration.calibrationStatus(frame);
    }
    if (frame && frame.localCalibration && frame.localCalibration.status) {
      return frame.localCalibration.status;
    }
    return frame && frame.calibrationStatus ? frame.calibrationStatus : 'legacyGlobalK';
  }
  function isFormalFrame(frame) {
    var status = frameStatus(frame);
    var referenceOnly = !!(frame && frame.selection &&
      frame.selection.referenceOnly === true);
    return !!frame &&
      frame.excluded !== true &&
      !referenceOnly &&
      (status === 'autoAccepted' || status === 'manualAccepted') &&
      numberOrNull(frame.deltaXmm) !== null &&
      Number(frame.deltaXmm) > 0;
  }
  function sourceForRole(label, data, unit) {
    var count = data && (unit === 'mm' ? data.nMm : data.nPx);
    if (!count) return null;
    // 旧会话可能没有条纹数；严格数值判断可避免把 null 误显示成 0.0 条。
    var stripes = Number.isFinite(data.meanStripeCount)
      ? '，平均 ' + Number(data.meanStripeCount).toFixed(1) + ' 条条纹'
      : '';
    var quality = data.qualityStatus === 'reference-only' ? '，波动偏大，仅参考' : '';
    var value = unit === 'mm'
      ? '，毫米值来自逐帧同框标定'
      : '，像素值来自真实识别证据帧';
    return SOURCE.auto + '（' + label + '，' + count +
      (unit === 'mm' ? ' 个正式帧' : ' 个像素证据帧') +
      value + stripes + quality + '）';
  }
  function missing(list, key, label, reason) {
    list.push({ key: key, label: label, reason: reason });
  }
  function put(result, key, value, label, source, required) {
    var v = numberOrNull(value);
    if (v === null) {
      if (required !== false) missing(result.missing, key, label, '当前会话没有可用数据');
      result.values[key] = null;
      return null;
    }
    result.values[key] = v;
    result.sources[key] = source;
    return v;
  }
  function param(session, key) {
    return session && session.params ? numberOrNull(session.params[key]) : null;
  }
  function paramSource(session, key, fallback) {
    var sources = session && session.paramsSources;
    var value = sources ? sources[key] : null;
    // 旧记录若没有逐项来源，不能把数值推定成实测或会话继承。
    return value || fallback || SOURCE.unknown;
  }
  function calibrationDetail(data) {
    if (!data || !(data.meanKMmPx > 0)) return '';
    var range = finite(data.kMinMmPx) && finite(data.kMaxMmPx)
      ? '，范围 ' + data.kMinMmPx.toPrecision(5) + '–' +
        data.kMaxMmPx.toPrecision(5) + ' mm/px'
      : '';
    return '逐帧同框刻线：k 均值 ' + data.meanKMmPx.toPrecision(6) +
      ' mm/px' + range + '；刻线数 ' +
      (finite(data.meanLineCount) ? data.meanLineCount.toFixed(1) : '—') +
      '，最大相对残差 ' +
      (finite(data.maxRelativeRms) ? data.maxRelativeRms.toPrecision(3) : '—');
  }
  function roleFrameList(session, role) {
    var all = session && session.frames ? session.frames : [];
    return all.filter(function (frame) {
      return frame && frame.role === role && !frame.excluded;
    });
  }
  function roleData(session, role) {
    var evidenceFrames = roleFrameList(session, role);
    var frames = evidenceFrames.filter(isFormalFrame);
    var px = [];
    var mm = [];
    var stripes = [];
    var kValues = [];
    var lineCounts = [];
    var relativeRms = [];
    evidenceFrames.forEach(function (frame) {
      var dxPx = numberOrNull(frame.deltaXPx);
      if (dxPx !== null && dxPx > 0) px.push(dxPx);
      var stripeCount = numberOrNull(frame.stripeCount);
      if (stripeCount !== null && stripeCount > 0) stripes.push(stripeCount);
    });
    frames.forEach(function (frame) {
      var dxMm = numberOrNull(frame.deltaXmm);
      if (dxMm !== null) mm.push(dxMm);
      var local = frame.localCalibration;
      var kValue = local ? numberOrNull(local.kMmPx) : null;
      if (kValue !== null && kValue > 0) kValues.push(kValue);
      var lineCount = local ? numberOrNull(local.lineCount) : null;
      if (lineCount !== null && lineCount > 0) lineCounts.push(lineCount);
      var rms = local ? numberOrNull(local.relativeRms) : null;
      if (rms !== null && rms >= 0) relativeRms.push(rms);
    });
    var pxStats = sampleStats(px);
    var mmStats = sampleStats(mm);
    var referenceOnly = evidenceFrames.some(function (frame) {
      return frame.selection && frame.selection.referenceOnly === true;
    });
    var statusCounts = evidenceFrames.reduce(function (counts, frame) {
      var status = frameStatus(frame);
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    return {
      role: role,
      label: ROLE_LABEL[role] || role,
      frames: frames,
      n: frames.length,
      nEvidence: evidenceFrames.length,
      nPx: px.length,
      nMm: mm.length,
      meanPx: pxStats.mean,
      sdPx: pxStats.sd,
      meanMm: mmStats.mean,
      sdMm: mmStats.sd,
      meanStripeCount: mean(stripes),
      meanKMmPx: mean(kValues),
      kMinMmPx: kValues.length ? Math.min.apply(null, kValues) : null,
      kMaxMmPx: kValues.length ? Math.max.apply(null, kValues) : null,
      meanLineCount: mean(lineCounts),
      maxRelativeRms: relativeRms.length ? Math.max.apply(null, relativeRms) : null,
      autoAccepted: statusCounts.autoAccepted || 0,
      manualAccepted: statusCounts.manualAccepted || 0,
      pending: statusCounts.pending || 0,
      rejected: statusCounts.rejected || 0,
      legacyGlobalK: statusCounts.legacyGlobalK || 0,
      qualityStatus: referenceOnly ? 'reference-only' : 'standard'
    };
  }
  function roleSource(result, role, label, data, pixelKey, mmKey) {
    if (!data.nMm) {
      missing(result.missing, mmKey, label + '毫米值',
        '缺少“' + label + '”的人工/自动确认同帧标定帧');
      result.values[mmKey] = null;
      if (data.nPx) {
        result.values[pixelKey] = data.meanPx;
        result.sources[pixelKey] = SOURCE.auto;
        result.sourceDetails[pixelKey] = sourceForRole(label, data, 'px') +
          '；无正式同帧标定，不能换算毫米值';
      } else {
        result.values[pixelKey] = null;
      }
      return;
    }
    result.values[pixelKey] = data.meanPx;
    result.values[mmKey] = data.meanMm;
    result.sources[pixelKey] = SOURCE.auto;
    result.sources[mmKey] = SOURCE.calibration;
    result.sourceDetails[pixelKey] = sourceForRole(label, data, 'px');
    result.sourceDetails[mmKey] = sourceForRole(label, data, 'mm');
  }
  function lambdaStats(primary, fn) {
    var values = [];
    primary.frames.forEach(function (frame) {
      var value = fn(frame);
      if (finite(value) && value > 0) values.push(Number(value));
    });
    var stats = sampleStats(values);
    return {
      n: stats.n,
      meanNm: stats.mean,
      sdNm: stats.sd,
      uANm: stats.uA,
      single: stats.n === 1
    };
  }
  function setLambda(result, value, stats) {
    result.values.lambdaNm = numberOrNull(value);
    result.stats.lambda = stats || { n: 0, meanNm: null, sdNm: null, uANm: null, single: false };
    if (result.values.lambdaNm === null) {
      missing(result.missing, 'lambdaNm', '波长', '完成方法参数并至少有一帧有效条纹后才能计算');
    } else {
      result.sources.lambdaNm = '由当前会话计算';
    }
  }

  function basic(session, result, options) {
    var sodium = roleData(session, 'sodium');
    roleSource(result, 'sodium', '钠光条纹', sodium, 'dxNaPx', 'dxNaMm');
    var kValue = put(result, 'k', sodium.meanKMmPx, '像素当量 k', SOURCE.calibration);
    if (kValue !== null) result.sourceDetails.k = calibrationDetail(sodium);
    var d = put(result, 'd', param(session, 'd'), '虚光源间距 d',
      paramSource(session, 'd'));
    var D = put(result, 'D', param(session, 'D'), '观察距离 D',
      paramSource(session, 'D'));
    result.stats.sodium = sodium;

    if (sodium.meanMm !== null && d !== null && D !== null && global.BP.physics) {
      // 毫米值已经由每帧自己的 k_i 得到，这里令 k=1，避免再次乘会话全局值。
      var lam = global.BP.physics.wavelengthBasic({ d: d, D: D, dxPx: sodium.meanMm, k: 1 });
      var frameLam = lambdaStats(sodium, function (frame) {
        return global.BP.physics.wavelengthBasic({
          d: d, D: D, dxPx: frame.deltaXmm, k: 1
        }).value;
      });
      setLambda(result, lam.value, frameLam);
    } else {
      setLambda(result, null);
    }
  }

  function ratio(session, result, options) {
    var sodium = roleData(session, 'sodium');
    var reference = roleData(session, 'reference');
    roleSource(result, 'sodium', '钠光标准条纹', sodium, 'dxNaPx', 'dxNaMm');
    roleSource(result, 'reference', '红光待测条纹', reference, 'dxRefPx', 'dxRefMm');
    /*
     * 只读取新方向的语义化参数。旧会话若仍保存 lamRef/nNa/nRef，
     * 这里会明确显示缺项，避免把“参考激光反算钠光”的旧方向静默反转。
     */
    var lambdaStandardNm = put(result, 'lambdaStandardNm',
      param(session, 'lambdaStandardNm'), '钠光标准波长',
      paramSource(session, 'lambdaStandardNm'));
    var nStandard = put(result, 'nStandard', param(session, 'nStandard'),
      '钠光折射率（N-BK7 假设）', paramSource(session, 'nStandard'));
    var nTarget = put(result, 'nTarget', param(session, 'nTarget'),
      '红光折射率（N-BK7 假设）', paramSource(session, 'nTarget'));
    result.stats.sodium = sodium;
    result.stats.reference = reference;

    if (sodium.meanMm !== null && reference.meanMm !== null &&
        lambdaStandardNm !== null && nStandard !== null && nTarget !== null &&
        global.BP.physics) {
      var lam = global.BP.physics.wavelengthRatio({
        // 比值法的长度单位相消；两角色都使用同帧标定后的毫米值。
        deltaXStandardPx: sodium.meanMm,
        deltaXTargetPx: reference.meanMm,
        lambdaStandardNm: lambdaStandardNm,
        nStandard: nStandard,
        nTarget: nTarget
      });
      var frameLam = lambdaStats(sodium, function (frame) {
        return global.BP.physics.wavelengthRatio({
          deltaXStandardPx: frame.deltaXmm,
          deltaXTargetPx: reference.meanMm,
          lambdaStandardNm: lambdaStandardNm,
          nStandard: nStandard,
          nTarget: nTarget
        }).value;
      });
      setLambda(result, lam.value, frameLam);
    } else {
      setLambda(result, null);
    }
  }

  function magnification(session, result, options) {
    var noLens = roleData(session, 'no_lens');
    var withLens = roleData(session, 'with_lens');
    roleSource(result, 'no_lens', '无透镜条纹', noLens, 'dxNaPx', 'dxNaMm');
    roleSource(result, 'with_lens', '加透镜条纹', withLens, 'dxPrimePx', 'dxPrimeMm');
    if (noLens.meanMm !== null) result.values.dxNaMm = noLens.meanMm;
    if (withLens.meanMm !== null) result.values.dxPrimeMm = withLens.meanMm;
    var dPrime = put(result, 'dPrime', param(session, 'dPrime'), '像间距 d′',
      paramSource(session, 'dPrime'));
    var beta = put(result, 'beta', param(session, 'beta'), '放大率 β',
      paramSource(session, 'beta'));
    var D = put(result, 'D', param(session, 'D'), '观察距离 D',
      paramSource(session, 'D'));
    result.stats.noLens = noLens;
    result.stats.withLens = withLens;

    if (noLens.meanMm !== null && withLens.meanMm !== null &&
        dPrime !== null && beta !== null && D !== null && global.BP.physics) {
      var lam = global.BP.physics.wavelengthMagnification({
        dPrime: dPrime, beta: beta, dxNaMm: noLens.meanMm,
        D: D, dxPrimeMm: withLens.meanMm
      });
      var frameLam = lambdaStats(noLens, function (frame) {
        return global.BP.physics.wavelengthMagnification({
          dPrime: dPrime, beta: beta, dxNaMm: frame.deltaXmm,
          D: D, dxPrimeMm: withLens.meanMm
        }).value;
      });
      setLambda(result, lam.value, frameLam);
    } else {
      setLambda(result, null);
    }
  }

  function trace(session, result, options) {
    var sodium = roleData(session, 'sodium');
    roleSource(result, 'sodium', '钠光条纹', sodium, 'dxNaPx', 'dxNaMm');
    var kValue = put(result, 'k', sodium.meanKMmPx, '像素当量 k', SOURCE.calibration);
    if (kValue !== null) result.sourceDetails.k = calibrationDetail(sodium);
    var preset = session && session.trace ? session.trace :
      (global.BP.sessions ? global.BP.sessions.TRACE_PRESET : null);
    var d = put(result, 'd', preset ? preset.d_mm : null, '追迹 d', SOURCE.trace);
    var DValue = param(session, 'D');
    var D = put(result, 'D',
      DValue !== null ? DValue : (preset ? preset.D_mm : null),
      '观察距离 D', DValue !== null ? paramSource(session, 'D') : SOURCE.trace);
    result.stats.sodium = sodium;

    if (sodium.meanMm !== null && d !== null && D !== null && global.BP.physics) {
      var lam = global.BP.physics.wavelengthBasic({
        d: d, D: D, dxPx: sodium.meanMm, k: 1
      });
      var frameLam = lambdaStats(sodium, function (frame) {
        return global.BP.physics.wavelengthBasic({
          d: d, D: D, dxPx: frame.deltaXmm, k: 1
        }).value;
      });
      setLambda(result, lam.value, frameLam);
    } else {
      setLambda(result, null);
    }
  }

  function build(session, options) {
    if (!session) throw new Error('没有当前测量会话');
    var method = session.method || 'basic';
    if (METHOD_LABEL[method] === undefined) throw new Error('未知测量方法：' + method);
    var result = {
      schema: 'bp.session-data/1',
      method: method,
      label: METHOD_LABEL[method],
      values: {},
      stats: {},
      sources: {},
      sourceDetails: {},
      missing: [],
      complete: false
    };
    if (method === 'ratio') ratio(session, result, options);
    else if (method === 'magnification') magnification(session, result, options);
    else if (method === 'trace') trace(session, result, options);
    else basic(session, result, options);
    result.complete = result.missing.length === 0;
    return result;
  }

  var API = {
    SOURCE: SOURCE,
    METHOD_LABEL: METHOD_LABEL,
    build: build
  };
  global.BP = global.BP || {};
  global.BP.sessionData = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
