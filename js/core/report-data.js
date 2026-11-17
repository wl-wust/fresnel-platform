/* =========================================================================
 * core/report-data.js —— AI 实验数据报告的归一化与来源审计
 * 输入：bp.record/2 或 bp.report/1
 * 原则：实测、报告预设、模型追迹、仅参考、缺失分栏保存，不互相覆盖。
 * ========================================================================= */
(function (global) {
  'use strict';

  var Errors = global.BP && global.BP.reportErrors
    ? global.BP.reportErrors
    : (typeof require === 'function' ? require('./report-errors.js') : null);

  var SOURCE_TYPES = [
    'measured', 'reportPreset', 'modelTrace', 'manual', 'referenceOnly', 'missing'
  ];

  var REPORT_PRESET = {
    schema: 'bp.report-preset/1',
    label: '研究报告表 5.1 条件参数',
    A_deg: 1.0,
    nNa: 1.5168,
    nRef: 1.5145,
    a_mm: 50,
    D_mm: 1000,
    k_mm_px: 0.004,
    lamRef_nm: 650,
    standardNm: 589.3,
    dTrace_mm: 0.90213,
    dParaxial_mm: 0.90199,
    waistUm: 0.68
  };

  var HISTORICAL_SIMULATION = {
    label: '历史模型 / 仿真，非本轮实测',
    ratio: { valueNm: 589.33, uNm: 0.61, relU: 0.0010 },
    magnification: { valueNm: 589.28, uNm: 0.84, relU: 0.0014 },
    trace: { valueNm: 589.30, uNm: 0.78, relU: 0.0013 },
    combined: {
      valueNm: 589.31, uNm: 0.42, relU: 0.0007,
      chi2: 0.0025, dof: 2, critical95: 5.991, consistent: true
    }
  };

  /*
   * 2026-11-17 手写记录：放大像、缩小像的位置差给出 d1、d2；
   * a 与 z2 由同一轮导轨读数给出。这里保留原始观测，派生量统一现算。
   */
  var ACTUAL_SECONDARY_IMAGING = {
    schema: 'bp.secondary-imaging/1',
    label: '2026-11-17 二次成像手写记录',
    experimentDate: '2026-11-17',
    nGlass: REPORT_PRESET.nNa,
    aCm: [9.60, 9.60, 9.60],
    z2Cm: [53.22, 53.25, 53.24],
    magnifiedPositionsMm: [
      [3.595, 5.095],
      [3.597, 5.087],
      [3.538, 5.055]
    ],
    reducedPositionsMm: [
      [2.756, 3.350],
      [2.217, 2.754],
      [2.190, 2.742]
    ],
    u1Cm: [16.51],
    u2Cm: [31.22, 31.21, 31.23],
    note: 'd1、d2 为同组放大像/缩小像两位置的水平差；a+z2 给出二次成像观察距离。'
  };

  var METHOD_ROLES = {
    ratio: '消除 d、D、k 的公共误差，用钠光与红光两套同口径角色数据比较；必须同时具备 sodium 与 reference。',
    trace: '用严格折射几何分析 a、A、n 对虚光源间距的影响；若 A 由本轮 d 反算，则结果只能作同源校核。',
    magnification: '用放大像与缩小像的位置差得到 d=√(d1d2)、β=√(d1/d2)，再结合 D=a+z2、Δx 与 k 求波长。'
  };

  var ROLE_LABEL = {
    sodium: '钠光条纹',
    reference: '红光参考条纹',
    no_lens: '无透镜条纹',
    with_lens: '加透镜条纹',
    calibration: '标定图'
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function finite(value) {
    return value !== null && value !== '' && Number.isFinite(Number(value));
  }

  function numberOrNull(value) {
    return finite(value) ? Number(value) : null;
  }

  function isSourceType(value) {
    return SOURCE_TYPES.indexOf(value) >= 0;
  }

  function mean(values) {
    var list = (values || []).filter(finite).map(Number);
    if (!list.length) return null;
    return list.reduce(function (sum, value) { return sum + value; }, 0) / list.length;
  }

  function positionDifferences(pairs) {
    return (pairs || []).map(function (pair) {
      return Math.abs(Number(pair[1]) - Number(pair[0]));
    }).filter(function (value) {
      return Number.isFinite(value) && value > 0;
    });
  }

  function relativeUncertainty(value, uncertainty) {
    return finite(value) && Number(value) > 0 && finite(uncertainty)
      ? Math.abs(Number(uncertainty) / Number(value))
      : null;
  }

  function rootSumSquares(values) {
    return Math.sqrt((values || []).reduce(function (sum, value) {
      return sum + (finite(value) ? Number(value) * Number(value) : 0);
    }, 0));
  }

  /*
   * d1、d2 先各自做多组均值和均值标准误差，再按乘除传播；
   * A 是等效棱镜角，由 d=2a(n−1)tanA 反算，不是分光计直接测角。
   */
  function deriveSecondaryGeometry(input) {
    input = input || ACTUAL_SECONDARY_IMAGING;
    var aMm = (input.aCm || []).map(function (value) { return Number(value) * 10; });
    var z2Mm = (input.z2Cm || []).map(function (value) { return Number(value) * 10; });
    var d1Values = input.d1Mm && input.d1Mm.length
      ? input.d1Mm.map(Number)
      : positionDifferences(input.magnifiedPositionsMm);
    var d2Values = input.d2Mm && input.d2Mm.length
      ? input.d2Mm.map(Number)
      : positionDifferences(input.reducedPositionsMm);
    var a = Errors.sampleStats(aMm);
    var z2 = Errors.sampleStats(z2Mm);
    var d1 = Errors.sampleStats(d1Values);
    var d2 = Errors.sampleStats(d2Values);
    if (!(a.mean > 0) || !(z2.mean > 0) || !(d1.mean > 0) || !(d2.mean > 0)) {
      throw new Error('二次成像记录缺少 a、z2、d1 或 d2');
    }

    var d = Math.sqrt(d1.mean * d2.mean);
    var beta = Math.sqrt(d1.mean / d2.mean);
    var dRelativeU = d1.uA !== null && d2.uA !== null
      ? 0.5 * rootSumSquares([
        relativeUncertainty(d1.mean, d1.uA),
        relativeUncertainty(d2.mean, d2.uA)
      ])
      : null;
    var betaRelativeU = dRelativeU;
    var D = a.mean + z2.mean;
    var DUA = rootSumSquares([a.uA || 0, z2.uA || 0]);
    var n = finite(input.nGlass) ? Number(input.nGlass) : REPORT_PRESET.nNa;
    var Arad = Math.atan(d / (2 * a.mean * (n - 1)));
    var Adeg = Arad * 180 / Math.PI;

    return {
      schema: 'bp.secondary-geometry/1',
      label: input.label || ACTUAL_SECONDARY_IMAGING.label,
      experimentDate: input.experimentDate || '',
      sourceType: 'measured',
      observations: {
        aCm: (input.aCm || []).slice(),
        z2Cm: (input.z2Cm || []).slice(),
        d1Mm: d1Values,
        d2Mm: d2Values,
        u1Cm: (input.u1Cm || []).slice(),
        u2Cm: (input.u2Cm || []).slice()
      },
      stats: {
        aMm: a.mean,
        uA_aMm: a.uA,
        z2Mm: z2.mean,
        uA_z2Mm: z2.uA,
        d1Mm: d1.mean,
        sd1Mm: d1.sd,
        uA_d1Mm: d1.uA,
        d2Mm: d2.mean,
        sd2Mm: d2.sd,
        uA_d2Mm: d2.uA,
        dMm: d,
        uA_dMm: dRelativeU !== null ? d * dRelativeU : null,
        relativeU_d: dRelativeU,
        beta: beta,
        uA_beta: betaRelativeU !== null ? beta * betaRelativeU : null,
        DMm: D,
        uA_DMm: DUA,
        nGlass: n,
        Adeg: Adeg,
        Arad: Arad,
        uA_Adeg: DUA > 0 || dRelativeU !== null
          ? Adeg * rootSumSquares([dRelativeU, relativeUncertainty(D, DUA)])
          : null
      },
      formulas: [
        'd1 = |x1,mag − x2,mag|，d2 = |x1,red − x2,red|',
        'd = √(d1d2)，β = √(d1/d2)',
        'D = a + z2',
        'A_eff = atan[d/(2a(n−1))]'
      ],
      note: input.note || ACTUAL_SECONDARY_IMAGING.note
    };
  }

  function collectRole(sessions, role) {
    var frames = [];
    (sessions || []).forEach(function (session) {
      (session.frames || []).forEach(function (frame) {
        if (!frame || frame.excluded || frame.role !== role) return;
        frames.push(Object.assign({}, frame, { sessionId: session.id, method: session.method }));
      });
    });
    return frames;
  }

  function roleStats(frames) {
    var values = frames.map(function (frame) { return numberOrNull(frame.deltaXPx); })
      .filter(function (value) { return value !== null && value > 0; });
    var stripes = frames.map(function (frame) { return numberOrNull(frame.stripeCount); })
      .filter(function (value) { return value !== null && value > 0; });
    var stats = Errors.sampleStats(values);
    var referenceOnly = frames.some(function (frame) {
      return frame.selection && frame.selection.referenceOnly === true;
    });
    return {
      n: stats.n,
      meanPx: stats.mean,
      sdPx: stats.sd,
      uAPx: stats.uA,
      cv: stats.cv,
      meanStripeCount: mean(stripes),
      referenceOnly: referenceOnly,
      sourceType: stats.n ? (referenceOnly ? 'referenceOnly' : 'measured') : 'missing',
      frames: frames.map(function (frame) {
        return {
          id: frame.id || null,
          sessionId: frame.sessionId || null,
          deltaXPx: numberOrNull(frame.deltaXPx),
          stripeCount: numberOrNull(frame.stripeCount),
          source: frame.source || '',
          sourceName: frame.sourceName || '',
          capturedAt: numberOrNull(frame.capturedAt),
          qualityScore: numberOrNull(frame.qualityScore),
          referenceOnly: !!(frame.selection && frame.selection.referenceOnly)
        };
      })
    };
  }

  function sessionCalibration(sessions) {
    var found = null;
    (sessions || []).some(function (session) {
      var calibration = session && session.calibration;
      if (calibration && finite(calibration.k_mm_px) && Number(calibration.k_mm_px) > 0) {
        found = calibration;
        return true;
      }
      return false;
    });
    return found;
  }

  function sessionParam(sessions, key) {
    var value = null;
    (sessions || []).some(function (session) {
      if (session && session.params && finite(session.params[key])) {
        value = Number(session.params[key]);
        return true;
      }
      return false;
    });
    return value;
  }

  function provenance(field, value, sourceType, sourceDetail) {
    return {
      field: field,
      value: value,
      sourceType: isSourceType(sourceType) ? sourceType : 'missing',
      sourceDetail: sourceDetail || ''
    };
  }

  function missing(role, reason) {
    return { role: role, reason: reason };
  }

  function buildRatio(stats, sessions, warnings) {
    var missingItems = [];
    if (!stats.sodium.n) missingItems.push(missing('sodium', '缺少钠光条纹有效帧'));
    if (!stats.reference.n) missingItems.push(missing('reference', '缺少红光参考条纹有效帧'));
    if (missingItems.length) {
      return {
        valueNm: null,
        uNm: null,
        relativeU: null,
        sourceType: 'missing',
        missing: missingItems,
        sourceItems: [],
        formula: 'λ_Na = λ_ref·(Δx_Na/Δx_ref)·((n_Na−1)/(n_ref−1))'
      };
    }

    var lamRef = sessionParam(sessions, 'lamRef');
    var nNa = sessionParam(sessions, 'nNa');
    var nRef = sessionParam(sessions, 'nRef');
    var conditional = lamRef === null || nNa === null || nRef === null;
    lamRef = lamRef === null ? REPORT_PRESET.lamRef_nm : lamRef;
    nNa = nNa === null ? REPORT_PRESET.nNa : nNa;
    nRef = nRef === null ? REPORT_PRESET.nRef : nRef;

    var result = Errors.ratioConditional({
      sodium: stats.sodium,
      reference: stats.reference,
      lamRef: lamRef,
      nNa: nNa,
      nRef: nRef,
      standardNm: REPORT_PRESET.standardNm,
      conditional: conditional,
      referenceOnly: stats.reference.referenceOnly
    });
    if (stats.reference.referenceOnly) {
      warnings.push('红光参考仅 ' + stats.reference.n + ' 个有效帧且波动偏大，比值法只能作参考性条件计算。');
    }
    return {
      valueNm: result.valueNm,
      uNm: result.uNm,
      relativeU: result.relativeU,
      sourceType: conditional ? 'reportPreset' : 'measured',
      missing: [],
      conditional: conditional,
      referenceOnly: stats.reference.referenceOnly,
      accuracy: result.accuracy,
      terms: result.terms,
      sourceItems: [
        provenance('Δx_Na', stats.sodium.meanPx, 'measured',
          '当前导入会话 sodium 角色 ' + stats.sodium.n + ' 帧均值'),
        provenance('Δx_ref', stats.reference.meanPx, stats.reference.referenceOnly ? 'referenceOnly' : 'measured',
          '当前导入会话 reference 角色 ' + stats.reference.n + ' 帧均值'),
        provenance('λ_ref', lamRef, conditional ? 'reportPreset' : 'manual', '参考波长输入'),
        provenance('n_Na', nNa, conditional ? 'reportPreset' : 'manual', '钠光折射率'),
        provenance('n_ref', nRef, conditional ? 'reportPreset' : 'manual', '参考光折射率')
      ],
      formula: result.formula
    };
  }

  function tracePreset(sessions) {
    var found = null;
    (sessions || []).some(function (session) {
      if (session && session.trace && finite(session.trace.d_mm)) {
        found = session.trace;
        return true;
      }
      return false;
    });
    return found;
  }

  function buildTrace(stats, sessions, warnings, geometry, options) {
    options = options || {};
    var missingItems = [];
    if (!stats.sodium.n) missingItems.push(missing('sodium', '缺少钠光条纹有效帧'));
    var cal = sessionCalibration(sessions);
    var k = cal ? numberOrNull(cal.k_mm_px) : null;
    var kSourceType = cal ? 'manual' : 'missing';
    if (!(k > 0) && options.allowReportPreset) {
      k = REPORT_PRESET.k_mm_px;
      kSourceType = 'reportPreset';
    }
    if (!(k > 0)) missingItems.push(missing('calibration', '缺少有效像素当量 k'));
    var trace = tracePreset(sessions);
    var d = trace ? numberOrNull(trace.d_mm) : (geometry ? geometry.stats.dMm : null);
    var D = sessionParam(sessions, 'D');
    if (!(D > 0)) D = geometry ? geometry.stats.DMm : null;
    if (!(d > 0)) missingItems.push(missing('trace', '缺少光线追迹 d_trace'));
    if (!(D > 0)) missingItems.push(missing('D', '缺少观察距离 D'));
    if (missingItems.length) {
      return {
        valueNm: null,
        uNm: null,
        sourceType: 'missing',
        missing: missingItems,
        dTraceMm: d,
        DMm: D,
        formula: 'λ = d_trace·Δx·k / D',
        note: '追迹法需要钠光 Δx、可信 k 与 D；缺失项不会用零补齐。'
      };
    }

    var value = global.BP && global.BP.physics
      ? global.BP.physics.wavelengthBasic({ d: d, D: D, dxPx: stats.sodium.meanPx, k: k }).value
      : d * stats.sodium.meanPx * k / D * 1e6;
    var fluxRelU = stats.sodium.uAPx !== null
      ? stats.sodium.uAPx / stats.sodium.meanPx
      : null;
    var dRelU = trace && finite(trace.u_d_mm)
      ? Number(trace.u_d_mm) / d
      : (geometry ? geometry.stats.relativeU_d : null);
    var DRelU = geometry ? relativeUncertainty(D, geometry.stats.uA_DMm) : null;
    var relativeU = fluxRelU !== null && dRelU !== null && DRelU !== null
      ? rootSumSquares([fluxRelU, dRelU, DRelU])
      : null;
    var sameSource = !trace && !!geometry;
    if (sameSource) {
      warnings.push('本轮 A 由二次成像 d、a 反算；再用该 A 追迹得到的 d 与放大率法同源，不能当作独立实验验证。');
    }
    warnings.push('追迹法使用 k=' + k.toPrecision(6) + ' mm/px；该值未由本轮可信刻线尺寸证实，波长只作条件结果。');
    return {
      valueNm: value,
      uNm: relativeU !== null ? value * relativeU : null,
      relativeU: relativeU,
      sourceType: 'modelTrace',
      conditional: true,
      sameSource: sameSource,
      dTraceMm: d,
      uA_dTraceMm: trace && finite(trace.u_d_mm)
        ? Number(trace.u_d_mm)
        : (geometry ? geometry.stats.uA_dMm : null),
      kMmPx: k,
      DMm: D,
      uA_DMm: geometry ? geometry.stats.uA_DMm : null,
      missing: [],
      accuracy: Errors.accuracy(value, REPORT_PRESET.standardNm),
      sourceItems: [
        provenance('Δx_Na', stats.sodium.meanPx, 'measured',
          '当前导入会话 sodium 角色 ' + stats.sodium.n + ' 帧均值'),
        provenance('k', k, kSourceType,
          cal && cal.source
            ? String(cal.source)
            : '报告表 5.1 预设，待本轮刻线尺寸核实'),
        provenance('d_trace', d, 'modelTrace',
          trace && trace.label
            ? String(trace.label)
            : '由本轮 d、a、n 反算 A 后的严格追迹（与二次成像同源）'),
        provenance('D', D, sessionParam(sessions, 'D') !== null ? 'manual' : 'measured',
          sessionParam(sessions, 'D') !== null ? '当前会话观察距离' : 'a+z2 二次成像实测')
      ],
      formula: 'λ = d_trace·Δx·k / D',
      note: sameSource
        ? '与横向放大率法使用同一组 d1、d2；当前数值只说明追迹公式自洽，不是第三条独立实测。'
        : 'd_trace 来自会话中的独立追迹参数。'
    };
  }

  function parameterFromSessions(sessions, key) {
    return sessionParam(sessions, key);
  }

  function buildMagnification(stats, sessions, warnings, geometry, options) {
    options = options || {};
    var missingItems = [];
    if (!stats.sodium.n) missingItems.push(missing('sodium', '缺少钠光条纹有效帧'));
    if (!geometry) missingItems.push(missing('secondaryImaging', '缺少 d1、d2、a、z2 二次成像记录'));
    var cal = sessionCalibration(sessions);
    var k = cal ? numberOrNull(cal.k_mm_px) : null;
    var kSourceType = cal ? 'manual' : 'missing';
    if (!(k > 0) && options.allowReportPreset) {
      k = REPORT_PRESET.k_mm_px;
      kSourceType = 'reportPreset';
    }
    if (!(k > 0)) missingItems.push(missing('calibration', '缺少有效像素当量 k'));
    var d = geometry ? geometry.stats.dMm : null;
    var beta = geometry ? geometry.stats.beta : null;
    var D = geometry ? geometry.stats.DMm : null;
    if (missingItems.length) {
      warnings.push('横向放大率法缺少同口径二次成像角色或参数，未生成条件数值。');
      return {
        valueNm: null,
        uNm: null,
        sourceType: 'missing',
        missing: missingItems,
        formula: 'λ = √(d1d2)·Δx·k/(a+z2)',
        note: '需要双方位像间距、导轨距离、钠光条纹与像素当量。'
      };
    }

    var value = d * stats.sodium.meanPx * k / D * 1e6;
    var fluxRelU = stats.sodium.uAPx !== null
      ? stats.sodium.uAPx / stats.sodium.meanPx
      : null;
    var DRelU = relativeUncertainty(D, geometry.stats.uA_DMm);
    var relativeU = fluxRelU !== null && geometry.stats.relativeU_d !== null && DRelU !== null
      ? rootSumSquares([fluxRelU, geometry.stats.relativeU_d, DRelU])
      : null;
    warnings.push('放大率法的 d 与 D 已由二次成像记录计算；k=' + k.toPrecision(6) +
      ' mm/px 若仍来自报告预设，则波长准确度受像素当量系统误差支配。');
    return {
      valueNm: value,
      uNm: relativeU !== null ? value * relativeU : null,
      relativeU: relativeU,
      sourceType: kSourceType === 'reportPreset' ? 'reportPreset' : 'measured',
      conditional: true,
      dMm: d,
      beta: beta,
      DMm: D,
      kMmPx: k,
      missing: [],
      accuracy: Errors.accuracy(value, REPORT_PRESET.standardNm),
      sourceItems: [
        provenance('Δx_Na', stats.sodium.meanPx, 'measured',
          '当前导入会话 sodium 角色 ' + stats.sodium.n + ' 帧均值'),
        provenance('k', k, kSourceType,
          cal ? (cal.source || '当前会话像素当量') : '报告表 5.1 预设，待本轮刻线尺寸核实'),
        provenance('d1', geometry.stats.d1Mm, 'measured',
          '放大像两位置水平差均值，n=' + geometry.observations.d1Mm.length),
        provenance('d2', geometry.stats.d2Mm, 'measured',
          '缩小像两位置水平差均值，n=' + geometry.observations.d2Mm.length),
        provenance('d', d, 'measured', '由本轮 d1、d2 按 √(d1d2) 计算'),
        provenance('β', beta, 'measured', '由本轮 d1、d2 按 √(d1/d2) 计算'),
        provenance('D', D, 'measured', 'a+z2 二次成像实测')
      ],
      formula: 'λ = √(d1d2)·Δx·k/(a+z2)',
      note: 'd、β、D 均来自本轮手写记录；k 的来源决定结果是否仍为条件计算。'
    };
  }

  function deriveDataset(dataset) {
    dataset = dataset || {};
    var sessions = dataset.sessions || [];
    var geometryInput = dataset.actualGeometry || dataset.secondaryImaging;
    if (!geometryInput) {
      (sessions || []).some(function (session) {
        if (session && session.secondaryImaging) {
          geometryInput = session.secondaryImaging;
          return true;
        }
        return false;
      });
    }
    var geometry = null;
    if (geometryInput) {
      try {
        geometry = geometryInput.stats && geometryInput.formulas
          ? geometryInput
          : deriveSecondaryGeometry(geometryInput);
      } catch (error) {
        geometry = null;
      }
    }
    var options = {
      allowReportPreset: dataset.useReportPreset === true
    };
    var collectedStats = {
      sodium: roleStats(collectRole(sessions, 'sodium')),
      reference: roleStats(collectRole(sessions, 'reference')),
      no_lens: roleStats(collectRole(sessions, 'no_lens')),
      with_lens: roleStats(collectRole(sessions, 'with_lens')),
      calibration: roleStats(collectRole(sessions, 'calibration'))
    };
    /*
     * 报告快照可以直接携带真实汇总统计（帧数、均值、标准差），
     * 避免为了复用聚合器而复制或伪造个体帧。
     */
    var stats = dataset.roleStats && dataset.roleStats.sodium
      ? dataset.roleStats
      : collectedStats;
    var warnings = [];
    if (stats.reference.referenceOnly) {
      warnings.push('红光参考被强制标记为 referenceOnly，不得作为正式钠光实验数据。');
    }
    if (geometry) {
      warnings.push('本轮 d=√(d1d2)、β=√(d1/d2)、D=a+z2 均为手写记录派生量；A 由 d、a、n 反算。');
    }
    var methods = {
      ratio: buildRatio(stats, sessions, warnings),
      trace: buildTrace(stats, sessions, warnings, geometry, options),
      magnification: buildMagnification(stats, sessions, warnings, geometry, options)
    };
    dataset.actualGeometry = geometry;
    dataset.roleStats = stats;
    dataset.methods = methods;
    dataset.warnings = Array.from(new Set(warnings));
    dataset.rayTrace = rayTraceCurve({ geometry: geometry });
    dataset.historicalSimulation = clone(HISTORICAL_SIMULATION);
    dataset.provenance = (dataset.provenance || []).filter(function (item) {
      return item && isSourceType(item.sourceType);
    });
    if (geometry) {
      dataset.provenance.push(
        provenance('d1', geometry.stats.d1Mm, 'measured', geometry.label + '，放大像位置差'),
        provenance('d2', geometry.stats.d2Mm, 'measured', geometry.label + '，缩小像位置差'),
        provenance('d', geometry.stats.dMm, 'measured', 'd=√(d1d2)'),
        provenance('β', geometry.stats.beta, 'measured', 'β=√(d1/d2)'),
        provenance('a', geometry.stats.aMm, 'measured', '单缝到棱脊距离均值'),
        provenance('z2', geometry.stats.z2Mm, 'measured', '第二共轭位置导轨读数均值'),
        provenance('D', geometry.stats.DMm, 'measured', 'D=a+z2'),
        provenance('A_eff', geometry.stats.Adeg, 'reportPreset',
          'A=atan[d/(2a(n−1))]；d、a 实测，n 使用报告预设 ' + geometry.stats.nGlass),
        provenance('uA_A_eff', geometry.stats.uA_Adeg, 'reportPreset',
          '由 d、D 的均值标准误差近似传播；不含 n 与棱镜厚度系统误差')
      );
    }
    Object.keys(methods).forEach(function (key) {
      (methods[key].sourceItems || []).forEach(function (item) {
        dataset.provenance.push(item);
      });
    });
    dataset.provenance.push(
      provenance('标准波长', REPORT_PRESET.standardNm, 'reportPreset', '钠黄光标准值，仅用于准确度评价'),
      provenance('历史 d_trace', REPORT_PRESET.dTrace_mm, 'modelTrace', '报告表 5.1 MATLAB 严格追迹标称值'),
      provenance('报告 A', REPORT_PRESET.A_deg, 'reportPreset', '研究报告表 5.1 条件值，不作为本轮实测'),
      provenance('报告 D', REPORT_PRESET.D_mm, 'reportPreset', '研究报告表 5.1 条件值，不作为本轮实测'),
      provenance('k 情景计算', REPORT_PRESET.k_mm_px, 'reportPreset',
        '仅用于展示条件波长；L=5 mm 与刻线像素间距的对应关系仍待核实')
    );
    return dataset;
  }

  function exampleRecord() {
    var now = new Date().toISOString();
    return {
      schema: 'bp.record/2',
      exportedAt: now,
      activeSessionId: 'ratio-demo',
      sessions: [{
        schema: 'bp.session/2',
        id: 'ratio-demo',
        method: 'ratio',
        title: '比值法示例',
        created: now,
        calibration: null,
        params: {},
        paramsSources: {},
        frames: [
          {
            schema: 'bp.frame/1', id: 'sodium-1', role: 'sodium',
            deltaXPx: 104.9, stripeCount: 11, source: 'video',
            sourceName: 'VID_20261103_152203.mp4', selection: { referenceOnly: false }
          },
          {
            schema: 'bp.frame/1', id: 'sodium-2', role: 'sodium',
            deltaXPx: 105.0, stripeCount: 11, source: 'video',
            sourceName: 'VID_20261103_152203.mp4', selection: { referenceOnly: false }
          },
          {
            schema: 'bp.frame/1', id: 'reference-1', role: 'reference',
            deltaXPx: 114.8, stripeCount: 8, source: 'video',
            sourceName: 'VID_20261117_144210.mp4', selection: { referenceOnly: true }
          },
          {
            schema: 'bp.frame/1', id: 'reference-2', role: 'reference',
            deltaXPx: 114.8, stripeCount: 8, source: 'video',
            sourceName: 'VID_20261117_144210.mp4', selection: { referenceOnly: true }
          }
        ]
      }]
    };
  }

  function emptyRecord() {
    return {
      schema: 'bp.record/2',
      sessions: [{
        schema: 'bp.session/2',
        id: 'empty',
        method: 'ratio',
        title: '空会话',
        frames: []
      }]
    };
  }

  function createDefaultDataset() {
    return deriveDataset({
      schema: 'bp.dataset/1',
      meta: {
        title: '菲涅耳双棱镜三种方法联合实验数据报告',
        generatedAt: new Date().toISOString(),
        source: '两次真实实验目录 + 本地视频识别 + 历史仿真基准',
        experimentDate: '2026-11-03 / 2026-11-17'
      },
      useReportPreset: true,
      actualGeometry: clone(ACTUAL_SECONDARY_IMAGING),
      sessions: [],
      roleStats: {
        sodium: {
          n: 20,
          meanPx: 104.9543787227124,
          sdPx: 0.1677835503,
          uAPx: 0.1677835503 / Math.sqrt(20),
          cv: 0.001599,
          meanStripeCount: 10.95,
          referenceOnly: false,
          sourceType: 'measured',
          frames: [],
          sourceName: 'VID_20261103_152203.mp4',
          durationSeconds: 44.159
        },
        reference: {
          n: 5,
          meanPx: 114.76325484473463,
          sdPx: 1.8032065225,
          uAPx: 1.8032065225 / Math.sqrt(5),
          cv: 0.015712,
          meanStripeCount: 7.8,
          referenceOnly: true,
          sourceType: 'referenceOnly',
          frames: [],
          sourceName: 'VID_20261117_144210.mp4',
          durationSeconds: 8.692
        },
        no_lens: {
          n: 0, meanPx: null, sdPx: null, uAPx: null, cv: null,
          meanStripeCount: null, referenceOnly: false, sourceType: 'missing',
          frames: []
        },
        with_lens: {
          n: 0, meanPx: null, sdPx: null, uAPx: null, cv: null,
          meanStripeCount: null, referenceOnly: false, sourceType: 'missing',
          frames: []
        },
        calibration: {
          n: 0, meanPx: null, sdPx: null, uAPx: null, cv: null,
          meanStripeCount: null, referenceOnly: false, sourceType: 'missing',
          frames: []
        }
      },
      images: [],
      provenance: []
    });
  }

  function validateImport(record) {
    var errors = [];
    if (!record || typeof record !== 'object') {
      return {
        ok: false, kind: 'unknown',
        errors: [{ field: '$', message: 'JSON 顶层必须是对象' }],
        summary: '未识别文件'
      };
    }
    if (record.schema === 'bp.record/2') {
      if (!Array.isArray(record.sessions)) {
        errors.push({ field: 'sessions', message: 'bp.record/2 必须包含 sessions 数组' });
      }
      var frames = (record.sessions || []).reduce(function (sum, session) {
        return sum + (Array.isArray(session && session.frames) ? session.frames.length : 0);
      }, 0);
      return {
        ok: errors.length === 0,
        kind: 'bp.record/2',
        errors: errors,
        summary: (record.sessions || []).length + ' 个会话 / ' + frames + ' 帧',
        dataset: errors.length === 0 ? fromRecord(record) : null
      };
    }
    if (record.version === 'bp.report/1' || record.schema === 'bp.report/1') {
      if (!record.dataset || typeof record.dataset !== 'object') {
        errors.push({ field: 'dataset', message: 'bp.report/1 必须包含 dataset 对象' });
      }
      if (record.dataset && !Array.isArray(record.dataset.sessions)) {
        errors.push({ field: 'dataset.sessions', message: 'dataset.sessions 必须是数组' });
      }
      return {
        ok: errors.length === 0,
        kind: 'bp.report/1',
        errors: errors,
        summary: record.dataset
          ? ((record.dataset.sessions || []).length + ' 个会话 / ' +
            ((record.dataset.images || []).length) + ' 张精选图')
          : '报告快照不完整',
        dataset: errors.length === 0 ? fromReport(record) : null
      };
    }
    errors.push({
      field: 'schema',
      message: '需要 bp.record/2 或 bp.report/1，实际为 ' +
        (record.schema || record.version || '未声明')
    });
    return { ok: false, kind: 'unknown', errors: errors, summary: '版本不兼容' };
  }

  function fromRecord(record) {
    if (!record || record.schema !== 'bp.record/2') throw new Error('需要 bp.record/2');
    var sessions = Array.isArray(record.sessions) ? clone(record.sessions) : [];
    return deriveDataset({
      schema: 'bp.dataset/1',
      meta: {
        title: '导入的平台实验记录',
        generatedAt: new Date().toISOString(),
        source: record.exportedAt ? '导入于 ' + record.exportedAt : 'bp.record/2',
        experimentDate: ''
      },
      useReportPreset: false,
      sessions: sessions,
      images: [],
      provenance: []
    });
  }

  function fromReport(snapshot) {
    if (!snapshot || !snapshot.dataset) throw new Error('需要 bp.report/1');
    var dataset = clone(snapshot.dataset);
    if (!dataset.roleStats || !dataset.methods) dataset = deriveDataset(dataset);
    if (!dataset.rayTrace) dataset.rayTrace = rayTraceCurve();
    if (Array.isArray(snapshot.imageManifest) && snapshot.imageManifest.length) {
      dataset.images = clone(snapshot.imageManifest);
    }
    return dataset;
  }

  function toSnapshot(dataset, methodSettings) {
    return {
      version: 'bp.report/1',
      generatedAt: new Date().toISOString(),
      methodSettings: methodSettings || {},
      dataset: clone(dataset),
      imageManifest: clone(dataset.images || [])
    };
  }

  /*
   * 严格追迹曲线用 tan(A) 几何，傍轴曲线用 A(rad)。
   * 默认优先使用本轮反算的等效 A 和实测 a，并单独标出同源限制。
   */
  function rayTraceCurve(options) {
    options = options || {};
    var geometry = options.geometry || null;
    var n = numberOrNull(options.n) ||
      (geometry && numberOrNull(geometry.stats.nGlass)) ||
      REPORT_PRESET.nNa;
    var Adeg = numberOrNull(options.Adeg) ||
      (geometry && numberOrNull(geometry.stats.Adeg)) ||
      REPORT_PRESET.A_deg;
    var nominalA = numberOrNull(options.nominalA) ||
      (geometry && numberOrNull(geometry.stats.aMm)) ||
      REPORT_PRESET.a_mm;
    var minA = numberOrNull(options.minA) || Math.max(10, Math.floor(nominalA * 0.25));
    var maxA = numberOrNull(options.maxA) || Math.max(80, Math.ceil(nominalA * 1.3));
    var steps = 61;
    var Arad = Adeg * Math.PI / 180;
    var points = [];
    for (var i = 0; i < steps; i += 1) {
      var a = minA + (maxA - minA) * i / (steps - 1);
      var dTrace = 2 * a * (n - 1) * Math.tan(Arad);
      var dParaxial = 2 * a * (n - 1) * Arad;
      points.push({
        aMm: a,
        dTraceMm: dTrace,
        dParaxialMm: dParaxial,
        residualMm: dTrace - dParaxial,
        relativeResidual: dParaxial ? (dTrace - dParaxial) / dParaxial : null
      });
    }
    return {
      sourceType: 'modelTrace',
      sameSource: !!geometry,
      model: geometry
        ? '严格追迹趋势（采用本轮反算 A 与实测 a）；d_par=2a(n−1)A'
        : '严格追迹趋势（报告标称参数）；d_par=2a(n−1)A',
      nominal: {
        aMm: nominalA,
        n: n,
        Adeg: Adeg,
        dTraceMm: 2 * nominalA * (n - 1) * Math.tan(Arad),
        dParaxialMm: 2 * nominalA * (n - 1) * Arad,
        measuredDMm: geometry ? geometry.stats.dMm : null,
        uA_dMm: geometry ? geometry.stats.uA_dMm : null
      },
      points: points
    };
  }

  var API = {
    SOURCE_TYPES: SOURCE_TYPES,
    REPORT_PRESET: REPORT_PRESET,
    HISTORICAL_SIMULATION: HISTORICAL_SIMULATION,
    ACTUAL_SECONDARY_IMAGING: ACTUAL_SECONDARY_IMAGING,
    METHOD_ROLES: METHOD_ROLES,
    ROLE_LABEL: ROLE_LABEL,
    deriveSecondaryGeometry: deriveSecondaryGeometry,
    isSourceType: isSourceType,
    createDefaultDataset: createDefaultDataset,
    deriveDataset: deriveDataset,
    exampleRecord: exampleRecord,
    emptyRecord: emptyRecord,
    validateImport: validateImport,
    fromRecord: fromRecord,
    fromReport: fromReport,
    toSnapshot: toSnapshot,
    rayTraceCurve: rayTraceCurve
  };

  global.BP = global.BP || {};
  global.BP.reportData = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
