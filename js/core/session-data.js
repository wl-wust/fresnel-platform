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
    trace: '追迹预设'
  };
  var METHOD_LABEL = {
    basic: '基本公式',
    ratio: '比值法',
    magnification: '横向放大率法',
    trace: '光线追迹法'
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
  function sourceForRole(label, n) {
    return n ? SOURCE.auto + '（' + label + '，' + n + ' 帧均值）' : null;
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
    return value || fallback;
  }
  function calibration(session, options) {
    var c = session && session.calibration;
    var v = c ? numberOrNull(c.k_mm_px) : null;
    if (v !== null && v > 0) return v;
    v = options ? numberOrNull(options.k) : null;
    return v !== null && v > 0 ? v : null;
  }
  function roleFrameList(session, role) {
    var all = session && session.frames ? session.frames : [];
    return all.filter(function (frame) {
      return frame && frame.role === role && !frame.excluded;
    });
  }
  function roleData(session, role, k) {
    var frames = roleFrameList(session, role);
    var px = [];
    var mm = [];
    frames.forEach(function (frame) {
      var dxPx = numberOrNull(frame.deltaXPx);
      var dxMm = numberOrNull(frame.deltaXmm);
      if (dxPx !== null) px.push(dxPx);
      if (dxMm === null && dxPx !== null && k > 0) dxMm = dxPx * k;
      if (dxMm !== null) mm.push(dxMm);
    });
    var pxStats = sampleStats(px);
    var mmStats = sampleStats(mm);
    return {
      role: role,
      frames: frames,
      n: Math.max(px.length, mm.length),
      nPx: px.length,
      nMm: mm.length,
      meanPx: pxStats.mean,
      sdPx: pxStats.sd,
      meanMm: mmStats.mean,
      sdMm: mmStats.sd
    };
  }
  function roleSource(result, role, label, data, unit) {
    if (!data.n) {
      missing(result.missing, unit, label, '缺少“' + label + '”的有效识别帧');
      result.values[unit] = null;
      return;
    }
    result.sources[unit] = SOURCE.auto;
    result.sourceDetails[unit] = sourceForRole(label, data.n);
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
    var k = calibration(session, options);
    var sodium = roleData(session, 'sodium', k);
    roleSource(result, 'sodium', '钠光条纹', sodium, 'dxNaPx');
    if (sodium.meanPx !== null) result.values.dxNaPx = sodium.meanPx;
    put(result, 'k', k, '像素当量 k', SOURCE.calibration);
    var d = put(result, 'd', param(session, 'd'), '虚光源间距 d',
      paramSource(session, 'd', SOURCE.session));
    var D = put(result, 'D', param(session, 'D'), '观察距离 D',
      paramSource(session, 'D', SOURCE.session));
    result.stats.sodium = sodium;

    if (sodium.meanPx !== null && k !== null && d !== null && D !== null && global.BP.physics) {
      var lam = global.BP.physics.wavelengthBasic({ d: d, D: D, dxPx: sodium.meanPx, k: k });
      var frameLam = lambdaStats(sodium, function (frame) {
        return global.BP.physics.wavelengthBasic({
          d: d, D: D, dxPx: frame.deltaXPx, k: k
        }).value;
      });
      setLambda(result, lam.value, frameLam);
    } else {
      setLambda(result, null);
    }
  }

  function ratio(session, result, options) {
    var k = calibration(session, options);
    var sodium = roleData(session, 'sodium', k);
    var reference = roleData(session, 'reference', k);
    roleSource(result, 'sodium', '钠光条纹', sodium, 'dxNaPx');
    roleSource(result, 'reference', '激光参考条纹', reference, 'dxRefPx');
    if (sodium.meanPx !== null) result.values.dxNaPx = sodium.meanPx;
    if (reference.meanPx !== null) result.values.dxRefPx = reference.meanPx;
    var lamRef = put(result, 'lamRef', param(session, 'lamRef'), '参考光波长',
      paramSource(session, 'lamRef', SOURCE.session));
    var nNa = put(result, 'nNa', param(session, 'nNa'), '钠光折射率',
      paramSource(session, 'nNa', SOURCE.session));
    var nRef = put(result, 'nRef', param(session, 'nRef'), '参考光折射率',
      paramSource(session, 'nRef', SOURCE.session));
    result.stats.sodium = sodium;
    result.stats.reference = reference;

    if (sodium.meanPx !== null && reference.meanPx !== null &&
        lamRef !== null && nNa !== null && nRef !== null && global.BP.physics) {
      var lam = global.BP.physics.wavelengthRatio({
        dxNaPx: sodium.meanPx, dxRefPx: reference.meanPx,
        lamRef: lamRef, nNa: nNa, nRef: nRef
      });
      var frameLam = lambdaStats(sodium, function (frame) {
        return global.BP.physics.wavelengthRatio({
          dxNaPx: frame.deltaXPx, dxRefPx: reference.meanPx,
          lamRef: lamRef, nNa: nNa, nRef: nRef
        }).value;
      });
      setLambda(result, lam.value, frameLam);
    } else {
      setLambda(result, null);
    }
  }

  function magnification(session, result, options) {
    var k = calibration(session, options);
    var noLens = roleData(session, 'no_lens', k);
    var withLens = roleData(session, 'with_lens', k);
    roleSource(result, 'no_lens', '无透镜条纹', noLens, 'dxNaMm');
    roleSource(result, 'with_lens', '加透镜条纹', withLens, 'dxPrimeMm');
    if (noLens.meanMm !== null) result.values.dxNaMm = noLens.meanMm;
    if (withLens.meanMm !== null) result.values.dxPrimeMm = withLens.meanMm;
    var dPrime = put(result, 'dPrime', param(session, 'dPrime'), '像间距 d′',
      paramSource(session, 'dPrime', SOURCE.session));
    var beta = put(result, 'beta', param(session, 'beta'), '放大率 β',
      paramSource(session, 'beta', SOURCE.session));
    var D = put(result, 'D', param(session, 'D'), '观察距离 D',
      paramSource(session, 'D', SOURCE.session));
    result.stats.noLens = noLens;
    result.stats.withLens = withLens;

    if (noLens.meanMm !== null && withLens.meanMm !== null &&
        dPrime !== null && beta !== null && D !== null && global.BP.physics) {
      var lam = global.BP.physics.wavelengthMagnification({
        dPrime: dPrime, beta: beta, dxNaMm: noLens.meanMm,
        D: D, dxPrimeMm: withLens.meanMm
      });
      var frameLam = lambdaStats(noLens, function (frame) {
        var dxMm = finite(frame.deltaXmm) ? Number(frame.deltaXmm) : Number(frame.deltaXPx) * k;
        return global.BP.physics.wavelengthMagnification({
          dPrime: dPrime, beta: beta, dxNaMm: dxMm,
          D: D, dxPrimeMm: withLens.meanMm
        }).value;
      });
      setLambda(result, lam.value, frameLam);
    } else {
      setLambda(result, null);
    }
  }

  function trace(session, result, options) {
    var k = calibration(session, options);
    var sodium = roleData(session, 'sodium', k);
    roleSource(result, 'sodium', '钠光条纹', sodium, 'dxNaPx');
    if (sodium.meanPx !== null) result.values.dxNaPx = sodium.meanPx;
    put(result, 'k', k, '像素当量 k', SOURCE.calibration);
    var preset = session && session.trace ? session.trace :
      (global.BP.sessions ? global.BP.sessions.TRACE_PRESET : null);
    var d = put(result, 'd', preset ? preset.d_mm : null, '追迹 d', SOURCE.trace);
    var DValue = param(session, 'D');
    var D = put(result, 'D',
      DValue !== null ? DValue : (preset ? preset.D_mm : null),
      '观察距离 D', DValue !== null ? paramSource(session, 'D', SOURCE.session) : SOURCE.trace);
    result.stats.sodium = sodium;

    if (sodium.meanPx !== null && k !== null && d !== null && D !== null && global.BP.physics) {
      var lam = global.BP.physics.wavelengthBasic({ d: d, D: D, dxPx: sodium.meanPx, k: k });
      var frameLam = lambdaStats(sodium, function (frame) {
        return global.BP.physics.wavelengthBasic({
          d: d, D: D, dxPx: frame.deltaXPx, k: k
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
