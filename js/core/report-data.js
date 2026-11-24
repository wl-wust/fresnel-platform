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
    'measured', 'reportPreset', 'modelTrace', 'manual', 'referenceOnly', 'nominal', 'missing'
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
    reference: '红光待测条纹',
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

  function formalFrame(frame) {
    var status = frameStatus(frame);
    var deltaXmm = numberOrNull(frame && frame.deltaXmm);
    var referenceOnly = !!(frame && frame.selection &&
      frame.selection.referenceOnly === true);
    return !!frame &&
      frame.excluded !== true &&
      !referenceOnly &&
      (status === 'autoAccepted' || status === 'manualAccepted') &&
      deltaXmm !== null &&
      deltaXmm > 0;
  }

  function calibrationSummary(frames) {
    var kValues = [];
    var lineCounts = [];
    var residuals = [];
    frames.forEach(function (frame) {
      var local = frame && frame.localCalibration;
      var k = numberOrNull(local && local.kMmPx);
      var lineCount = numberOrNull(local && local.lineCount);
      var residual = numberOrNull(local && local.relativeRms);
      if (k !== null && k > 0) kValues.push(k);
      if (lineCount !== null && lineCount > 0) lineCounts.push(lineCount);
      if (residual !== null && residual >= 0) residuals.push(residual);
    });
    return {
      nK: kValues.length,
      meanKMmPx: mean(kValues),
      kMinMmPx: kValues.length ? Math.min.apply(null, kValues) : null,
      kMaxMmPx: kValues.length ? Math.max.apply(null, kValues) : null,
      meanLineCount: mean(lineCounts),
      maxRelativeRms: residuals.length ? Math.max.apply(null, residuals) : null
    };
  }

  function roleStats(evidenceFrames) {
    var frames = (evidenceFrames || []).filter(formalFrame);
    var mmValues = frames.map(function (frame) { return numberOrNull(frame.deltaXmm); })
      .filter(function (value) { return value !== null && value > 0; });
    // 像素间距与条纹数来自真实识别证据帧；毫米值仍只取确认过的正式帧。
    var pxValues = (evidenceFrames || []).map(function (frame) {
      return numberOrNull(frame.deltaXPx);
    })
      .filter(function (value) { return value !== null && value > 0; });
    var stripes = (evidenceFrames || []).map(function (frame) {
      return numberOrNull(frame.stripeCount);
    })
      .filter(function (value) { return value !== null && value > 0; });
    var mmStats = Errors.sampleStats(mmValues);
    var pxStats = Errors.sampleStats(pxValues);
    var calibration = calibrationSummary(frames);
    var referenceOnly = (evidenceFrames || []).some(function (frame) {
      return frame.selection && frame.selection.referenceOnly === true;
    });
    var statusCounts = (evidenceFrames || []).reduce(function (counts, frame) {
      var status = frameStatus(frame);
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    return {
      n: mmStats.n,
      nEvidence: (evidenceFrames || []).length,
      nPx: pxStats.n,
      nMm: mmStats.n,
      meanMm: mmStats.mean,
      sdMm: mmStats.sd,
      uAMm: mmStats.uA,
      cv: mmStats.mean && mmStats.sd !== null ? mmStats.sd / mmStats.mean : null,
      meanPx: pxStats.mean,
      sdPx: pxStats.sd,
      uAPx: pxStats.uA,
      cvPx: pxStats.mean && pxStats.sd !== null ? pxStats.sd / pxStats.mean : null,
      meanStripeCount: mean(stripes),
      meanKMmPx: calibration.meanKMmPx,
      kMinMmPx: calibration.kMinMmPx,
      kMaxMmPx: calibration.kMaxMmPx,
      nK: calibration.nK,
      meanLineCount: calibration.meanLineCount,
      maxRelativeRms: calibration.maxRelativeRms,
      autoAccepted: statusCounts.autoAccepted || 0,
      manualAccepted: statusCounts.manualAccepted || 0,
      pending: statusCounts.pending || 0,
      rejected: statusCounts.rejected || 0,
      legacyGlobalK: statusCounts.legacyGlobalK || 0,
      referenceOnly: referenceOnly,
      sourceType: referenceOnly ? 'referenceOnly' : (mmStats.n ? 'measured' : 'missing'),
      frames: (evidenceFrames || []).map(function (frame) {
        return {
          id: frame.id || null,
          sessionId: frame.sessionId || null,
          deltaXPx: numberOrNull(frame.deltaXPx),
          deltaXmm: numberOrNull(frame.deltaXmm),
          stripeCount: numberOrNull(frame.stripeCount),
          source: frame.source || '',
          sourceName: frame.sourceName || '',
          capturedAt: numberOrNull(frame.capturedAt),
          qualityScore: numberOrNull(frame.qualityScore),
          referenceOnly: !!(frame.selection && frame.selection.referenceOnly),
          calibrationStatus: frameStatus(frame),
          localCalibration: frame.localCalibration || null
        };
      })
    };
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

  function sessionParamSource(sessions, key) {
    var source = null;
    (sessions || []).some(function (session) {
      var sources = session && session.paramsSources;
      if (sources && sources[key]) {
        source = String(sources[key]);
        return true;
      }
      return false;
    });
    return source;
  }

  function sourceTypeForParam(source) {
    if (!source) return 'missing';
    if (/预设/.test(source)) return 'reportPreset';
    if (/实测|测量|输入/.test(source)) return 'measured';
    return 'manual';
  }

  function methodParam(sessions, key, presetValue, allowPreset) {
    var value = sessionParam(sessions, key);
    var source = sessionParamSource(sessions, key);
    var sourceType = sourceTypeForParam(source);
    if (value === null && allowPreset && finite(presetValue)) {
      value = Number(presetValue);
      sourceType = 'reportPreset';
      source = '研究报告条件参数';
    }
    return { value: value, source: source || '', sourceType: sourceType };
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

  function buildRatio(stats, sessions, warnings, options) {
    options = options || {};
    var missingItems = [];
    if (!stats.sodium.nMm) {
      missingItems.push(missing('sodium', '缺少钠光逐帧同框标定后的正式帧'));
    }
    if (!stats.reference.nMm) {
      missingItems.push(missing('reference', '缺少红光待测逐帧同框标定后的正式帧'));
    }
    if (!stats.sodium.nMm || !stats.reference.nMm) {
      missingItems.push(missing('calibration', '正式比值法要求两段角色都使用各自帧内的刻线像素当量'));
    }
    /* 钠光标准值来自报告预设（589.3 nm 为国际公认标准波长，不作实测）。
     * 红光折射率与钠光折射率都来自 N-BK7 假设，必须在来源审计里标注。
     */
    var lamStd = methodParam(sessions, 'lambdaStandardNm', REPORT_PRESET.standardNm,
      options.allowReportPreset);
    var nStd = methodParam(sessions, 'nStandard', REPORT_PRESET.nNa, options.allowReportPreset);
    var nTgt = methodParam(sessions, 'nTarget', REPORT_PRESET.nRef, options.allowReportPreset);
    if (lamStd.value === null) missingItems.push(missing('lambdaStandardNm', '缺少钠光标准波长'));
    if (nStd.value === null) missingItems.push(missing('nStandard', '缺少钠光折射率（N-BK7 假设）'));
    if (nTgt.value === null) missingItems.push(missing('nTarget', '缺少红光折射率（N-BK7 假设）'));
    if (missingItems.length) {
      return {
        valueNm: null,
        uNm: null,
        relativeU: null,
        sourceType: 'missing',
        missing: missingItems,
        sourceItems: [],
        kStats: calibrationSummary(stats.sodium.frames),
        formula: 'λ_R = λ_Na·(Δx_R/Δx_Na)·((n_R−1)/(n_Na−1))'
      };
    }

    var conditional = lamStd.sourceType === 'reportPreset' ||
      nStd.sourceType === 'reportPreset' ||
      nTgt.sourceType === 'reportPreset';

    var result = Errors.ratioConditional({
      standard: {
        mean: stats.sodium.meanMm,
        sd: stats.sodium.sdMm,
        n: stats.sodium.nMm
      },
      target: {
        mean: stats.reference.meanMm,
        sd: stats.reference.sdMm,
        n: stats.reference.nMm
      },
      lambdaStandardNm: lamStd.value,
      nStandard: nStd.value,
      nTarget: nTgt.value,
      nominalTargetNm: REPORT_PRESET.lamRef_nm,
      conditional: conditional,
      referenceOnly: stats.reference.referenceOnly
    });
    if (stats.reference.referenceOnly) {
      warnings.push('红光待测条纹有 ' + stats.reference.nEvidence +
        ' 个像素证据帧，但正式毫米帧为 ' + stats.reference.nMm +
        '；未人工确认同帧刻线前，比值法只能作参考性条件计算。旧记录的 referenceOnly 标签不会自动改写，' +
        '重新导入时需明确选择“红光待测”。');
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
      /* 五步 A 类预算：只含条纹间距重复性，B 类项标未定量。 */
      uncertainty: (function () {
        try {
          return Errors.ratioTypeABudget({
            standard: { mean: stats.sodium.meanMm, sd: stats.sodium.sdMm, n: stats.sodium.nMm },
            target: { mean: stats.reference.meanMm, sd: stats.reference.sdMm, n: stats.reference.nMm },
            lambdaStandardNm: lamStd.value,
            nStandard: nStd.value,
            nTarget: nTgt.value,
            nominalTargetNm: REPORT_PRESET.lamRef_nm
          });
        } catch (err) {
          return null;
        }
      })(),
      accuracyBasis: result.accuracyBasis,
      terms: result.terms,
      sourceItems: [
        provenance('Δx_Na', stats.sodium.meanMm, 'measured',
          'sodium 角色 ' + stats.sodium.nMm + ' 个正式帧的逐帧 k_i 毫米均值'),
        provenance('Δx_R', stats.reference.meanMm,
          stats.reference.referenceOnly ? 'referenceOnly' : 'measured',
          'reference 角色（红光待测）' + stats.reference.nMm + ' 个正式帧的逐帧 k_i 毫米均值'),
        provenance('λ_Na', lamStd.value, lamStd.sourceType,
          lamStd.source || '钠光标准值 589.3 nm（标准，不作实测）'),
        provenance('n_Na', nStd.value, nStd.sourceType,
          nStd.source || '钠光折射率（N-BK7 假设）'),
        provenance('n_R', nTgt.value, nTgt.sourceType,
          nTgt.source || '红光折射率（N-BK7 假设）'),
        provenance('650 nm', REPORT_PRESET.lamRef_nm, 'nominal',
          '激光器标称值，仅用于偏差比较，不作为已校准真值')
      ],
      kStats: calibrationSummary(stats.sodium.frames),
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
    if (!stats.sodium.nMm) {
      missingItems.push(missing('sodium', '缺少钠光逐帧同框标定后的正式帧'));
      missingItems.push(missing('calibration', '缺少与条纹同框的逐帧刻线像素当量'));
    }
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
        kStats: calibrationSummary(stats.sodium.frames),
        formula: 'λ = d_trace·Δx·k / D',
        note: '正式追迹法需要钠光逐帧毫米值、可信 d 与 D；不会用全局 k 或零补齐。'
      };
    }

    var value = global.BP && global.BP.physics
      ? global.BP.physics.wavelengthBasic({ d: d, D: D, dxPx: stats.sodium.meanMm, k: 1 }).value
      : d * stats.sodium.meanMm / D * 1e6;
    var fluxRelU = stats.sodium.uAMm !== null
      ? stats.sodium.uAMm / stats.sodium.meanMm
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
    return {
      valueNm: value,
      uNm: relativeU !== null ? value * relativeU : null,
      relativeU: relativeU,
      sourceType: 'modelTrace',
      conditional: sameSource,
      sameSource: sameSource,
      dTraceMm: d,
      uA_dTraceMm: trace && finite(trace.u_d_mm)
        ? Number(trace.u_d_mm)
        : (geometry ? geometry.stats.uA_dMm : null),
      DMm: D,
      uA_DMm: geometry ? geometry.stats.uA_DMm : null,
      missing: [],
      accuracy: Errors.accuracy(value, REPORT_PRESET.standardNm),
      sourceItems: [
        provenance('Δx_Na', stats.sodium.meanMm, 'measured',
          'sodium 角色 ' + stats.sodium.nMm + ' 个正式帧的逐帧 k_i 毫米均值'),
        provenance('d_trace', d, 'modelTrace',
          trace && trace.label
            ? String(trace.label)
            : '由本轮 d、a、n 反算 A 后的严格追迹（与二次成像同源）'),
        provenance('D', D, sessionParam(sessions, 'D') !== null ? 'manual' : 'measured',
          sessionParam(sessions, 'D') !== null ? '当前会话观察距离' : 'a+z2 二次成像实测')
      ],
      kStats: calibrationSummary(stats.sodium.frames),
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
    if (!stats.sodium.nMm) {
      missingItems.push(missing('sodium', '缺少钠光逐帧同框标定后的正式帧'));
      missingItems.push(missing('calibration', '缺少与条纹同框的逐帧刻线像素当量'));
    }
    if (!geometry) missingItems.push(missing('secondaryImaging', '缺少 d1、d2、a、z2 二次成像记录'));
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
        note: '需要双方位像间距、导轨距离，以及钠光条纹的逐帧同框毫米值。',
        kStats: calibrationSummary(stats.sodium.frames)
      };
    }

    var value = d * stats.sodium.meanMm / D * 1e6;
    var fluxRelU = stats.sodium.uAMm !== null
      ? stats.sodium.uAMm / stats.sodium.meanMm
      : null;
    var DRelU = relativeUncertainty(D, geometry.stats.uA_DMm);
    var relativeU = fluxRelU !== null && geometry.stats.relativeU_d !== null && DRelU !== null
      ? rootSumSquares([fluxRelU, geometry.stats.relativeU_d, DRelU])
      : null;
    warnings.push('放大率法的 d 与 D 已由二次成像记录计算；Δx 使用每个条纹帧自己的刻线像素当量。');
    return {
      valueNm: value,
      uNm: relativeU !== null ? value * relativeU : null,
      relativeU: relativeU,
      sourceType: 'measured',
      conditional: false,
      dMm: d,
      beta: beta,
      DMm: D,
      missing: [],
      accuracy: Errors.accuracy(value, REPORT_PRESET.standardNm),
      sourceItems: [
        provenance('Δx_Na', stats.sodium.meanMm, 'measured',
          'sodium 角色 ' + stats.sodium.nMm + ' 个正式帧的逐帧 k_i 毫米均值'),
        provenance('d1', geometry.stats.d1Mm, 'measured',
          '放大像两位置水平差均值，n=' + geometry.observations.d1Mm.length),
        provenance('d2', geometry.stats.d2Mm, 'measured',
          '缩小像两位置水平差均值，n=' + geometry.observations.d2Mm.length),
        provenance('d', d, 'measured', '由本轮 d1、d2 按 √(d1d2) 计算'),
        provenance('β', beta, 'measured', '由本轮 d1、d2 按 √(d1/d2) 计算'),
        provenance('D', D, 'measured', 'a+z2 二次成像实测')
      ],
      kStats: calibrationSummary(stats.sodium.frames),
      formula: 'λ = √(d1d2)·Δx·k/(a+z2)',
      note: 'd、β、D 均来自本轮手写记录；Δx 只采用当前会话中自动或人工确认的逐帧同框标定帧。'
    };
  }

  /*
   * 旧全局 k 只保留为“条件情景”，用于解释历史结果为何偏离；
   * 该对象与 methods 严格分开，不参与正式准确度评价。
   */
  function buildLegacyConditional(stats, geometry) {
    var ratio = {
      valueNm: null,
      uNm: null,
      relativeU: null,
      sourceType: 'missing',
      missing: []
    };
    var magnification = {
      valueNm: null,
      uNm: null,
      relativeU: null,
      sourceType: 'missing',
      missing: []
    };
    var trace = {
      valueNm: null,
      uNm: null,
      relativeU: null,
      sourceType: 'missing',
      missing: []
    };
    if (!stats || !stats.sodium || !stats.reference ||
        !(stats.sodium.meanPx > 0) || !(stats.reference.meanPx > 0)) {
      ratio.missing.push(missing('roles', '条件情景缺少钠光或红光像素统计'));
    } else {
      var ratioResult = Errors.ratioConditional({
        standard: {
          mean: stats.sodium.meanPx,
          sd: stats.sodium.sdPx,
          n: stats.sodium.nPx || stats.sodium.n
        },
        target: {
          mean: stats.reference.meanPx,
          sd: stats.reference.sdPx,
          n: stats.reference.nPx || stats.reference.n
        },
        lambdaStandardNm: REPORT_PRESET.standardNm,
        nStandard: REPORT_PRESET.nNa,
        nTarget: REPORT_PRESET.nRef,
        nominalTargetNm: REPORT_PRESET.lamRef_nm,
        conditional: true,
        referenceOnly: stats.reference.referenceOnly
      });
      ratio = {
        valueNm: ratioResult.valueNm,
        uNm: ratioResult.uNm,
        relativeU: ratioResult.relativeU,
        sourceType: 'reportPreset',
        conditional: true,
        missing: [],
        accuracy: ratioResult.accuracy,
        uncertainty: (function () {
          try {
            return Errors.ratioTypeABudget({
              standard: { mean: stats.sodium.meanPx, sd: stats.sodium.sdPx, n: stats.sodium.nPx || stats.sodium.n },
              target: { mean: stats.reference.meanPx, sd: stats.reference.sdPx, n: stats.reference.nPx || stats.reference.n },
              lambdaStandardNm: REPORT_PRESET.standardNm,
              nStandard: REPORT_PRESET.nNa,
              nTarget: REPORT_PRESET.nRef,
              nominalTargetNm: REPORT_PRESET.lamRef_nm
            });
          } catch (err) {
            return null;
          }
        })(),
        accuracyBasis: ratioResult.accuracyBasis,
        terms: ratioResult.terms,
        formula: ratioResult.formula,
        sourceItems: [
          provenance('Δx_Na', stats.sodium.meanPx, 'measured', '钠光标准条纹像素均值，未进入正式毫米口径'),
          provenance('Δx_R', stats.reference.meanPx,
            stats.reference.referenceOnly ? 'referenceOnly' : 'measured',
            '红光待测条纹像素均值，未进入正式毫米口径'),
          provenance('λ_Na', REPORT_PRESET.standardNm, 'reportPreset', '钠光标准值 589.3 nm（标准，非实测）'),
          provenance('n_Na', REPORT_PRESET.nNa, 'reportPreset', '钠光折射率（N-BK7 假设）'),
          provenance('n_R', REPORT_PRESET.nRef, 'reportPreset', '红光折射率（N-BK7 假设）'),
          provenance('650 nm', REPORT_PRESET.lamRef_nm, 'nominal', '激光器标称值，仅作偏差比较')
        ],
        note: '仅用于说明像素比与报告光学参数下的条件偏差，不是逐帧标定实测。'
      };
    }
    if (stats && stats.sodium && stats.sodium.meanPx > 0 && geometry) {
      var gm = geometry.stats;
      var fluxRelU = stats.sodium.uAPx !== null
        ? stats.sodium.uAPx / stats.sodium.meanPx
        : null;
      var dRelU = gm.relativeU_d;
      var dRelUValue = relativeUncertainty(gm.DMm, gm.uA_DMm);
      var relU = fluxRelU !== null && dRelU !== null && dRelUValue !== null
        ? rootSumSquares([fluxRelU, dRelU, dRelUValue])
        : null;
      var value = gm.dMm * stats.sodium.meanPx * REPORT_PRESET.k_mm_px / gm.DMm * 1e6;
      magnification = {
        valueNm: value,
        uNm: relU !== null ? value * relU : null,
        relativeU: relU,
        sourceType: 'reportPreset',
        conditional: true,
        missing: [],
        accuracy: Errors.accuracy(value, REPORT_PRESET.standardNm),
        dMm: gm.dMm,
        beta: gm.beta,
        DMm: gm.DMm,
        kMmPx: REPORT_PRESET.k_mm_px,
        formula: 'λ = √(d1d2)·Δx_px·k_预设/(a+z2)',
        sourceItems: [
          provenance('Δx_Na', stats.sodium.meanPx, 'measured', '历史像素均值'),
          provenance('k', REPORT_PRESET.k_mm_px, 'reportPreset', '照片报告表旧全局像素当量'),
          provenance('d', gm.dMm, 'measured', '二次成像记录'),
          provenance('D', gm.DMm, 'measured', 'a+z2 二次成像记录')
        ],
        note: '旧全局 k 条件情景；不得称为逐帧刻线实测误差。'
      };
      trace = {
        valueNm: value,
        uNm: relU !== null ? value * relU : null,
        relativeU: relU,
        sourceType: 'modelTrace',
        conditional: true,
        sameSource: true,
        dTraceMm: gm.dMm,
        DMm: gm.DMm,
        kMmPx: REPORT_PRESET.k_mm_px,
        missing: [],
        accuracy: Errors.accuracy(value, REPORT_PRESET.standardNm),
        formula: 'λ = d_trace·Δx_px·k_预设/D',
        note: '与横向放大率条件情景同源，只核对公式自洽。'
      };
    } else if (stats && stats.sodium && stats.sodium.meanPx > 0) {
      magnification.missing.push(missing('secondaryImaging', '缺少二次成像记录'));
      trace.missing.push(missing('secondaryImaging', '缺少二次成像记录'));
    } else {
      magnification.missing.push(missing('sodium', '缺少钠光像素统计'));
      trace.missing.push(missing('sodium', '缺少钠光像素统计'));
    }
    return { ratio: ratio, trace: trace, magnification: magnification };
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
    var stats = {};
    ['sodium', 'reference', 'no_lens', 'with_lens', 'calibration'].forEach(function (role) {
      var supplied = dataset.roleStats && dataset.roleStats[role]
        ? dataset.roleStats[role]
        : {};
      stats[role] = Object.assign({}, collectedStats[role], supplied);
      // 聚合快照允许只存角色汇总，不复制个体帧；缺失时统一补空数组供审计使用。
      if (!Array.isArray(stats[role].frames)) stats[role].frames = [];
      stats[role].referenceOnly = stats[role].referenceOnly === true;
    });
    var warnings = [];
    if (stats.reference.referenceOnly) {
      warnings.push('红光待测记录带有旧版 referenceOnly 标记，需人工确认后才能用于正式比值法。');
    }
    if (geometry) {
      warnings.push('本轮 d=√(d1d2)、β=√(d1/d2)、D=a+z2 均为手写记录派生量；A 由 d、a、n 反算。');
    }
    var methods = {
      ratio: buildRatio(stats, sessions, warnings, options),
      trace: buildTrace(stats, sessions, warnings, geometry, options),
      magnification: buildMagnification(stats, sessions, warnings, geometry, options)
    };
    dataset.actualGeometry = geometry;
    dataset.roleStats = stats;
    dataset.methods = methods;
    dataset.legacyConditional = buildLegacyConditional(stats, geometry);
    if (geometry) {
      warnings.push('旧全局 k 条件情景中的追迹值与放大率法同源；它只核对公式自洽，不能当作独立实验验证。');
    }
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
        '仅用于历史条件波长；相邻刻线虽确认 1 mm，但自动刻线残差仍待人工确认')
    );
    return dataset;
  }

  function exampleRecord() {
    var now = new Date().toISOString();
    function frame(id, role, deltaXPx, stripeCount, referenceOnly) {
      var kMmPx = role === 'sodium' ? 0.004 : 0.0042;
      return {
        schema: 'bp.frame/1',
        id: id,
        role: role,
        deltaXPx: deltaXPx,
        deltaXmm: deltaXPx * kMmPx,
        stripeCount: stripeCount,
        source: 'video',
        sourceName: role === 'sodium'
          ? 'VID_20261103_152203.mp4'
          : 'VID_20261117_144210.mp4',
        calibrationStatus: 'autoAccepted',
        localCalibration: {
          schema: 'bp.frame-calibration/1',
          status: 'autoAccepted',
          method: 'auto-same-frame',
          kMmPx: kMmPx,
          tickSpacingMm: 1,
          lineCount: 5,
          relativeRms: 0.004,
          source: '示例同框刻线'
        },
        selection: { referenceOnly: !!referenceOnly }
      };
    }
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
          frame('sodium-1', 'sodium', 104.9, 11, false),
          frame('sodium-2', 'sodium', 105.0, 11, false),
          frame('reference-1', 'reference', 114.8, 8, true),
          frame('reference-2', 'reference', 114.8, 8, true)
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
          n: 0,
          nEvidence: 20,
          nPx: 20,
          nMm: 0,
          meanPx: 104.9543787227124,
          sdPx: 0.1677835503,
          uAPx: 0.1677835503 / Math.sqrt(20),
          cv: 0.001599,
          meanStripeCount: 10.95,
          referenceOnly: false,
          sourceType: 'missing',
          frames: [],
          sourceName: 'VID_20261103_152203.mp4',
          durationSeconds: 44.159
        },
        reference: {
          n: 0,
          nEvidence: 5,
          nPx: 5,
          nMm: 0,
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
          n: 0, nEvidence: 0, nPx: 0, nMm: 0,
          meanPx: null, sdPx: null, uAPx: null, cv: null,
          meanStripeCount: null, referenceOnly: false, sourceType: 'missing',
          frames: []
        },
        with_lens: {
          n: 0, nEvidence: 0, nPx: 0, nMm: 0,
          meanPx: null, sdPx: null, uAPx: null, cv: null,
          meanStripeCount: null, referenceOnly: false, sourceType: 'missing',
          frames: []
        },
        calibration: {
          n: 0, nEvidence: 0, nPx: 0, nMm: 0,
          meanPx: null, sdPx: null, uAPx: null, cv: null,
          meanStripeCount: null, referenceOnly: false, sourceType: 'missing',
          frames: []
        }
      },
      images: [],
      provenance: []
    });
  }

  /*
   * 空模板只建立结构，不填入任何实测、预设或模型结果。
   * 当本机缓存与默认快照都不可用时，报告页用它显示“尚未导入实测数据”。
   */
  function createEmptyDataset() {
    return deriveDataset({
      schema: 'bp.dataset/1',
      scenarioId: '',
      scenarioLabel: '尚未导入实测数据',
      meta: {
        title: '菲涅耳双棱镜实验数据报告',
        generatedAt: new Date().toISOString(),
        source: '空报告模板',
        experimentDate: ''
      },
      useReportPreset: false,
      sessions: [],
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
    // 旧快照可能保存了全局 k 方法值；重新按当前逐帧正式口径派生，避免旧口径复活。
    dataset = deriveDataset(dataset);
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
    createEmptyDataset: createEmptyDataset,
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
