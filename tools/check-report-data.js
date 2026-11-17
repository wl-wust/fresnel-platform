'use strict';

/* 报告数据内核自检：先锁定来源口径，再验证可复算结果。 */
const assert = require('assert');
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

check('样本统计使用 n−1 标准差与均值标准误差', () => {
  const s = E.sampleStats([1, 2, 3, 4, 5]);
  assert.strictEqual(s.n, 5);
  almost(s.mean, 3, 1e-12, '均值');
  almost(s.sd, Math.sqrt(2.5), 1e-12, '标准差');
  almost(s.uA, Math.sqrt(2.5) / Math.sqrt(5), 1e-12, '均值标准误差');
  return s.n + ' 帧';
});

check('比值法条件计算复现 597.10 ± 4.20 nm', () => {
  const result = E.ratioConditional({
    sodium: { mean: 104.9543787227124, sd: 0.1677835503, n: 20 },
    reference: { mean: 114.76325484473463, sd: 1.8032065225, n: 5 },
    lamRef: 650,
    nNa: 1.5168,
    nRef: 1.5145,
    uLamRef: 0,
    uNNa: 0,
    uNRef: 0
  });
  almost(result.valueNm, 597.101535156, 0.001, '条件结果');
  almost(result.uNm, 4.20, 0.02, '条件误差');
  almost(result.relativeBias, 0.013239, 1e-5, '相对偏差');
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
    'measured', 'reportPreset', 'modelTrace', 'manual', 'referenceOnly', 'missing'
  ]);
  assert.strictEqual(D.isSourceType('reportPreset'), true);
  assert.strictEqual(D.isSourceType('simulatedAsMeasurement'), false);
  return D.SOURCE_TYPES.length + ' 类';
});

check('默认数据明确隔离钠光实测与红光仅参考', () => {
  const dataset = D.createDefaultDataset();
  const sodium = dataset.roleStats.sodium;
  const reference = dataset.roleStats.reference;
  assert.strictEqual(sodium.n, 20);
  assert.strictEqual(reference.n, 5);
  assert.strictEqual(reference.referenceOnly, true);
  assert.strictEqual(dataset.methods.ratio.valueNm !== null, true);
  assert.strictEqual(dataset.methods.ratio.sourceType, 'reportPreset');
  return sodium.meanPx.toFixed(3) + ' / ' + reference.meanPx.toFixed(3) + ' px';
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

check('放大率法用本轮几何量并显式标记 k 预设', () => {
  const dataset = D.createDefaultDataset();
  const method = dataset.methods.magnification;
  almost(method.valueNm, 613.355123, 0.001, '条件波长');
  almost(method.uNm, 9.466047, 0.001, '条件误差');
  almost(method.accuracy.biasNm, 24.055123, 0.001, '绝对偏差');
  assert.strictEqual(method.sourceType, 'reportPreset');
  assert(method.sourceItems.some(item => item.field === 'k' && item.sourceType === 'reportPreset'));
  assert(method.sourceItems.some(item => item.field === 'd' && item.sourceType === 'measured'));
  return method.valueNm.toFixed(3) + ' ± ' + method.uNm.toFixed(3) + ' nm';
});

check('追迹法明确标记与二次成像同源', () => {
  const dataset = D.createDefaultDataset();
  const trace = dataset.methods.trace;
  almost(trace.valueNm, dataset.methods.magnification.valueNm, 1e-9, '同源数值');
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
  assert.strictEqual(dataset.roleStats.reference.n, 2);
  almost(dataset.roleStats.sodium.meanPx, 104.95, 1e-9, '钠光均值');
  return preview.summary;
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
