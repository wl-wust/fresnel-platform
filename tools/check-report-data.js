'use strict';

/* 报告数据内核自检：先锁定来源口径，再验证可复算结果。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let E;
let D;

try {
  E = require(path.join(root, 'js/core/report-errors.js'));
  D = require(path.join(root, 'js/core/report-data.js'));
} catch (error) {
  console.error('无法加载报告数据内核：' + error.message);
  process.exit(1);
}

let pass = 0;
function check(name, fn) {
  const detail = fn();
  pass += 1;
  console.log('PASS  ' + name + (detail ? '  ' + detail : ''));
}

function almost(actual, expected, tol, label) {
  assert(Math.abs(actual - expected) <= tol,
    label + '：实际 ' + actual + '，期望 ' + expected + ' ± ' + tol);
}

function formalFrame(role, deltaXPx, deltaXmm, kMmPx, extra) {
  return Object.assign({
    schema: 'bp.frame/1',
    id: role + '-' + deltaXPx,
    role: role,
    deltaXPx: deltaXPx,
    deltaXmm: deltaXmm,
    stripeCount: 10,
    calibrationStatus: 'autoAccepted',
    localCalibration: {
      status: 'autoAccepted',
      kMmPx: kMmPx,
      lineCount: 5,
      relativeRms: 0.004
    },
    // 默认构造可进入正式统计的帧；需要“仅参考”时由用例显式打开。
    selection: { referenceOnly: false }
  }, extra || {});
}

check('样本统计使用 n−1 标准差与均值标准误差', () => {
  const s = E.sampleStats([1, 2, 3, 4, 5]);
  assert.strictEqual(s.n, 5);
  almost(s.mean, 3, 1e-12, '均值');
  almost(s.sd, Math.sqrt(2.5), 1e-12, '标准差');
  almost(s.uA, Math.sqrt(2.5) / Math.sqrt(5), 1e-12, '均值标准误差');
  return s.n + ' 帧';
});

check('比值法条件计算：钠光标准 589.3 → 红光待测', () => {
  const stdMean = 104.9543787227124;
  const tgtMean = 114.76325484473463;
  const result = E.ratioConditional({
    standard: { mean: stdMean, sd: 0.1677835503, n: 20 },
    target: { mean: tgtMean, sd: 1.8032065225, n: 5 },
    lambdaStandardNm: 589.3,
    nStandard: 1.5168,
    nTarget: 1.5145,
    uLambdaStandard: 0,
    uNStandard: 0,
    uNTarget: 0
  });
  // λ_R = λ_Na·(Δx_R/Δx_Na)·((n_R−1)/(n_Na−1))
  const expected = 589.3 * (tgtMean / stdMean) * (0.5145 / 0.5168);
  almost(result.valueNm, expected, 1e-9, '条件结果');
  almost(result.dispersion, 0.5145 / 0.5168, 1e-12, '色散修正 <1');
  assert.ok(result.uNm > 0, '条件误差必须为正');
  assert.strictEqual(result.conditional, true, '有报告预设时必须标记条件计算');
  return result.valueNm.toFixed(3) + ' ± ' + result.uNm.toFixed(2) + ' nm';
});

check('准确度只相对 589.3 nm 报告标准值计算', () => {
  const r = E.accuracy(597.101535156, 589.3);
  almost(r.biasNm, 7.801535156, 1e-9, '绝对偏差');
  almost(r.relativeBias, 0.013239, 1e-5, '相对偏差');
  return '+' + r.biasNm.toFixed(3) + ' nm';
});

check('三路径一致性检验复现历史仿真基线', () => {
  const r = E.chiSquareConsistency([
    { name: '比值法', value: 589.33, uncertainty: 0.61 },
    { name: '横向放大率法', value: 589.28, uncertainty: 0.84 },
    { name: '光线追迹法', value: 589.30, uncertainty: 0.78 }
  ]);
  almost(r.chi2, 0.0025, 0.0002, 'χ²');
  assert.strictEqual(r.dof, 2);
  almost(r.critical95, 5.991, 1e-12, '临界值');
  assert.strictEqual(r.consistent, true);
  return 'χ²=' + r.chi2.toFixed(4) + ' / ν=' + r.dof;
});

check('来源类型白名单完整且拒绝未知来源', () => {
  assert.deepStrictEqual(D.SOURCE_TYPES, [
    'measured', 'reportPreset', 'modelTrace', 'manual', 'referenceOnly', 'nominal', 'missing'
  ]);
  assert.strictEqual(D.isSourceType('reportPreset'), true);
  assert.strictEqual(D.isSourceType('nominal'), true);
  assert.strictEqual(D.isSourceType('simulatedAsMeasurement'), false);
  return D.SOURCE_TYPES.length + ' 类';
});

check('空报告模板不伪造实测、几何量或方法结果', () => {
  const dataset = D.createEmptyDataset();
  assert.strictEqual(dataset.methods.ratio.valueNm, null);
  assert.strictEqual(dataset.methods.trace.valueNm, null);
  assert.strictEqual(dataset.methods.magnification.valueNm, null);
  assert.strictEqual(dataset.roleStats.sodium.n, 0);
  assert.strictEqual(dataset.roleStats.reference.n, 0);
  assert.strictEqual(dataset.actualGeometry, null);
  return '空模板 / 三种方法均缺项';
});

check('默认实测快照复算 672.0 ± 0.9 nm 且条纹数保持待补', () => {
  const file = path.join(root, 'data/reports/fresnel-sodium-red-2026-11-24.json');
  assert.strictEqual(fs.existsSync(file), true, '缺少默认实测快照');
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(snapshot.scenarioId, 'fresnel-sodium-red-2026-11-24');
  const preview = D.validateImport(snapshot);
  assert.strictEqual(preview.ok, true);
  const dataset = preview.dataset;
  const ratio = dataset.methods.ratio;
  const sodium = dataset.roleStats.sodium;
  const reference = dataset.roleStats.reference;
  assert.strictEqual(dataset.scenarioId, 'fresnel-sodium-red-2026-11-24');
  assert.strictEqual(sodium.nMm, 55);
  assert.strictEqual(reference.nMm, 50);
  assert.strictEqual(reference.referenceOnly, false);
  assert.strictEqual(sodium.meanStripeCount, null);
  assert.strictEqual(reference.meanStripeCount, null);
  assert.strictEqual(sodium.stripeCountStatus, 'pending');
  assert.strictEqual(reference.stripeCountStatus, 'pending');
  almost(ratio.valueNm, 672.022, 0.01, '默认比值法结果');
  assert.strictEqual(ratio.uncertainty.expression, '(672.0 ± 0.9) nm');
  assert.strictEqual(ratio.uncertainty.unquantified.length, 3);
  assert(ratio.sourceItems.some(item => item.field === '650 nm' && item.sourceType === 'nominal'));
  assert.strictEqual(D.ROLE_LABEL.reference, '红光待测条纹');
  return ratio.uncertainty.expression + ' / 55·50 帧';
});

check('默认数据明确隔离钠光实测与红光仅参考', () => {
  const dataset = D.createDefaultDataset();
  const sodium = dataset.roleStats.sodium;
  const reference = dataset.roleStats.reference;
  assert.strictEqual(sodium.n, 0);
  assert.strictEqual(reference.n, 0);
  assert.strictEqual(sodium.nEvidence, 20);
  assert.strictEqual(reference.nEvidence, 5);
  assert.strictEqual(sodium.nPx, 20);
  assert.strictEqual(reference.nPx, 5);
  assert.strictEqual(sodium.nMm, 0);
  assert.strictEqual(reference.nMm, 0);
  assert.strictEqual(reference.referenceOnly, true);
  assert.strictEqual(dataset.methods.ratio.valueNm, null);
  assert(dataset.methods.ratio.missing.some(item => item.role === 'calibration'));
  assert.strictEqual(dataset.legacyConditional.ratio.valueNm !== null, true);
  assert.strictEqual(dataset.legacyConditional.ratio.sourceType, 'reportPreset');
  return sodium.nEvidence + ' / ' + reference.nEvidence + ' 帧像素证据，0 帧正式毫米值';
});

check('二次成像记录复算 d、β、D 与 A_eff', () => {
  const g = D.deriveSecondaryGeometry();
  almost(g.stats.d1Mm, 1.502333333, 1e-9, 'd1');
  almost(g.stats.d2Mm, 0.561, 1e-12, 'd2');
  almost(g.stats.dMm, 0.918046295, 1e-9, 'd');
  almost(g.stats.uA_dMm, 0.014164027, 1e-9, 'uA(d)');
  almost(g.stats.beta, 1.636446159, 1e-9, 'β');
  almost(g.stats.DMm, 628.366666667, 1e-9, 'D=a+z2');
  almost(g.stats.Adeg, 0.530091804, 1e-9, 'A_eff');
  almost(g.stats.uA_Adeg, 0.008178831, 1e-9, 'uA(A)');
  return g.stats.dMm.toFixed(6) + ' mm / ' + g.stats.Adeg.toFixed(6) + '°';
});

check('默认像素汇总不冒充逐帧毫米标定', () => {
  const dataset = D.createDefaultDataset();
  const method = dataset.methods.magnification;
  assert.strictEqual(method.valueNm, null);
  assert(method.missing.some(item => item.role === 'calibration'));
  const legacy = dataset.legacyConditional.magnification;
  almost(legacy.valueNm, 613.355123, 0.001, '条件波长');
  almost(legacy.uNm, 9.466047, 0.001, '条件误差');
  assert.strictEqual(legacy.sourceType, 'reportPreset');
  assert(legacy.sourceItems.some(item => item.field === 'k' && item.sourceType === 'reportPreset'));
  return legacy.valueNm.toFixed(3) + ' ± ' + legacy.uNm.toFixed(3) + ' nm（仅条件情景）';
});

check('追迹法条件情景明确标记与二次成像同源', () => {
  const dataset = D.createDefaultDataset();
  const trace = dataset.legacyConditional.trace;
  almost(trace.valueNm, dataset.legacyConditional.magnification.valueNm, 1e-9, '同源数值');
  assert.strictEqual(trace.sameSource, true);
  assert(dataset.warnings.some(text => /不能当作独立实验验证/.test(text)));
  return 'sameSource=true';
});

check('缺失角色不补零且方法显示不可计算', () => {
  const dataset = D.fromRecord(D.emptyRecord());
  assert.strictEqual(dataset.methods.ratio.valueNm, null);
  assert(dataset.methods.ratio.missing.some(item => item.role === 'sodium'));
  assert(dataset.methods.ratio.missing.some(item => item.role === 'reference'));
  assert.strictEqual(dataset.roleStats.sodium.n, 0);
  assert.strictEqual(dataset.methods.magnification.sourceType, 'missing');
  assert(dataset.methods.magnification.missing.some(item => item.role === 'calibration'));
  return dataset.methods.ratio.missing.length + ' 个缺失项';
});

check('bp.record/2 导入时按角色聚合真实帧', () => {
  const record = D.exampleRecord();
  const preview = D.validateImport(record);
  assert.strictEqual(preview.ok, true);
  assert.strictEqual(preview.kind, 'bp.record/2');
  const dataset = D.fromRecord(record);
  assert.strictEqual(dataset.roleStats.sodium.n, 2);
  assert.strictEqual(dataset.roleStats.reference.n, 0);
  assert.strictEqual(dataset.roleStats.reference.nEvidence, 2);
  assert.strictEqual(dataset.roleStats.reference.nMm, 0);
  almost(dataset.roleStats.sodium.meanPx, 104.95, 1e-9, '钠光均值');
  assert(isFinite(dataset.roleStats.sodium.meanMm));
  assert.strictEqual(dataset.roleStats.reference.referenceOnly, true);
  return preview.summary;
});

check('报告只使用逐帧正式毫米值，旧全局 k 不进入正式方法', () => {
  const record = {
    schema: 'bp.record/2',
    sessions: [{
      schema: 'bp.session/2',
      id: 'per-frame',
      method: 'magnification',
      calibration: { k_mm_px: 0.001 },
      params: { D: 628.3666667, dPrime: 0.918046295, beta: 1.636446159 },
      paramsSources: { D: '实测', dPrime: '实测', beta: '实测' },
      secondaryImaging: {
        aCm: [9.6],
        z2Cm: [53.2366667],
        d1Mm: [1.5023333],
        d2Mm: [0.561],
        nGlass: 1.5168
      },
      frames: [
        formalFrame('sodium', 100, 0.5, 0.005),
        Object.assign(formalFrame('sodium', 100, 0.5, 0.005), {
          id: 'pending',
          calibrationStatus: 'pending',
          deltaXmm: 0.1,
          localCalibration: {
            status: 'pending',
            kMmPx: 0.005,
            lineCount: 3,
            relativeRms: 0.018
          }
        }),
        Object.assign(formalFrame('sodium', 100, 1, 0.01), {
          id: 'legacy',
          calibrationStatus: 'legacyGlobalK',
          localCalibration: null
        })
      ]
    }]
  };
  const dataset = D.fromRecord(record);
  assert.strictEqual(dataset.roleStats.sodium.n, 1);
  assert.strictEqual(dataset.roleStats.sodium.nPx, 3);
  assert.strictEqual(dataset.roleStats.sodium.nEvidence, 3);
  assert.strictEqual(dataset.roleStats.sodium.pending, 1);
  assert.strictEqual(dataset.roleStats.sodium.legacyGlobalK, 1);
  almost(dataset.roleStats.sodium.meanMm, 0.5, 1e-12, '正式毫米均值');
  almost(
    dataset.methods.magnification.valueNm,
    Math.sqrt(1.5023333 * 0.561) * 0.5 / 628.3666667 * 1e6,
    1e-6,
    '按 0.5 mm 计算'
  );
  return '0.5 mm，未乘会话全局 k=0.001';
});

check('比值法只接受两种角色的正式毫米值', () => {
  const record = {
    schema: 'bp.record/2',
    sessions: [{
      schema: 'bp.session/2',
      id: 'ratio-formal',
      method: 'ratio',
      params: { lambdaStandardNm: 589.3, nStandard: 1.5168, nTarget: 1.5145 },
      paramsSources: { lambdaStandardNm: '标准值', nStandard: 'N-BK7 假设', nTarget: 'N-BK7 假设' },
      frames: [
        formalFrame('sodium', 100, 0.5, 0.005),
        formalFrame('reference', 100, 0.6, 0.006)
      ]
    }]
  };
  const dataset = D.fromRecord(record);
  const method = dataset.methods.ratio;
  assert.strictEqual(method.sourceType, 'measured');
  almost(method.valueNm, 589.3 * (0.6 / 0.5) * ((1.5145 - 1) / (1.5168 - 1)), 1e-9,
    '钠光标准→红光的角色毫米比');
  assert.strictEqual(method.kMmPx, undefined);
  return method.valueNm.toFixed(3) + ' nm';
});

check('五步 A 类预算复现 672.0 ± 0.9 nm', () => {
  const b = E.ratioTypeABudget({
    standard: { mean: 0.219040, sd: 0.000184, n: 55 },
    target: { mean: 0.250904, sd: 0.001055, n: 50 },
    lambdaStandardNm: 589.3,
    nStandard: 1.5168,
    nTarget: 1.5145,
    nominalTargetNm: 650
  });
  almost(b.valueNm, 672.022, 0.01, '第 1 步 测量值');
  almost(b.uARel, 0.000605, 2e-6, '第 2 步 A 类相对不确定度');
  almost(b.uANm, 0.407, 0.01, '第 2 步 A 类绝对不确定度');
  assert.ok(b.nuEff > 40 && b.nuEff < 70, '有效自由度合理');
  almost(b.tFactor, 2.01, 0.01, 't 因子');
  almost(b.ur95Percent, 0.12, 0.01, '第 3 步 U_r,95');
  almost(b.u95Nm, 0.814, 0.02, '第 4 步 未舍入');
  assert.strictEqual(b.u95Rounded, 0.9, '第 4 步 进位到 0.9');
  assert.strictEqual(b.expression, '(672.0 ± 0.9) nm', '第 5 步 结果表达式');
  almost(b.comparison.deltaNm, 22.02, 0.01, '与标称 650 的差');
  almost(b.comparison.relativeDiffPercent, 3.39, 0.01, '百分差');
  assert.strictEqual(b.unquantified.length, 3, '三项 B 类必须标未定量');
  return b.expression + '  Ur=' + b.ur95Percent.toFixed(4) + '%';
});
check('bp.report/1 导出后往返一致', () => {
  const dataset = D.createDefaultDataset();
  const snapshot = D.toSnapshot(dataset, { selectedView: 'summary' });
  assert.strictEqual(snapshot.version, 'bp.report/1');
  const validated = D.validateImport(snapshot);
  assert.strictEqual(validated.ok, true);
  assert.strictEqual(validated.kind, 'bp.report/1');
  const restored = D.fromReport(snapshot);
  almost(restored.methods.ratio.valueNm, dataset.methods.ratio.valueNm, 1e-9, '往返值');
  return 'bp.report/1';
});

check('无效 schema 返回字段级错误而不是归零', () => {
  const preview = D.validateImport({ schema: 'bp.report/999' });
  assert.strictEqual(preview.ok, false);
  assert(preview.errors.some(item => /schema/.test(item.field)));
  return preview.errors[0].message;
});

check('光线追迹 d-a 曲线使用实测 a 与反算 A', () => {
  const dataset = D.createDefaultDataset();
  const curve = dataset.rayTrace;
  assert(curve.points.length >= 41);
  const nominal = curve.nominal;
  almost(nominal.aMm, 96, 1e-12, '实测 a');
  almost(nominal.Adeg, 0.530091804, 1e-9, '反算 A');
  almost(nominal.dTraceMm, 0.918046295, 1e-9, '实测几何追迹');
  almost(nominal.dParaxialMm, 0.918020101, 1e-9, '傍轴近似');
  const relativeResidual = (nominal.dTraceMm - nominal.dParaxialMm) / nominal.dParaxialMm;
  assert(isFinite(relativeResidual));
  assert(curve.sameSource);
  return curve.points.length + ' 个点';
});

check('方法作用说明覆盖三种正式路径', () => {
  assert(D.METHOD_ROLES.ratio.length > 20);
  assert(D.METHOD_ROLES.trace.length > 20);
  assert(D.METHOD_ROLES.magnification.length > 20);
  return 'ratio / trace / magnification';
});

console.log('\n' + pass + ' 项报告数据检查通过');
