'use strict';

const assert = require('assert');
const S = require('../js/core/sessions.js');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    const detail = fn();
    pass += 1;
    console.log('PASS  ' + name + (detail ? '  ' + detail : ''));
  } catch (e) {
    fail += 1;
    console.log('FAIL  ' + name + '  ' + e.message);
  }
}

(async () => {
  const ratio = S.createSession({ method: 'ratio', title: 'ratio test' });
  const acceptedCalibration = {
    schema: 'bp.frame-calibration/1',
    status: 'autoAccepted',
    source: 'auto',
    tickSpacingMm: 1,
    tickSpacingPx: 250,
    kMmPx: 0.004,
    lineCount: 4,
    relativeRms: 0.004,
    fringeBand: { y0: 120, y1: 360 }
  };
  const videoFrame = await S.addFrame(ratio.id, {
    role: 'sodium',
    deltaXPx: 163.3,
    deltaXmm: 0.6532,
    stripeCount: 11,
    localCalibration: acceptedCalibration,
    calibrationStatus: 'autoAccepted',
    sourcePixels: {
      width: 1920,
      height: 1080,
      analysisWidth: 1280,
      analysisHeight: 720,
      analysisScale: 2 / 3,
      fringeBand: { y0: 80, y1: 240 }
    },
    source: 'video',
    sourceName: 'lab.mp4',
    capturedAt: 1200,
    qualityScore: 0.86,
    selection: { target: 20, cv: 0.002 }
  });
  await S.addFrame(ratio.id, {
    role: 'sodium',
    deltaXPx: 163.5,
    deltaXmm: 0.654,
    stripeCount: 10,
    localCalibration: acceptedCalibration,
    calibrationStatus: 'autoAccepted'
  });
  await S.addFrame(ratio.id, {
    role: 'reference',
    deltaXPx: 180.9,
    deltaXmm: 0.7236,
    stripeCount: 8,
    localCalibration: Object.assign({}, acceptedCalibration, {
      status: 'manualAccepted',
      source: 'manual'
    }),
    calibrationStatus: 'manualAccepted'
  });
  const emptyFrame = await S.addFrame(ratio.id, {
    role: 'reference',
    deltaXPx: null,
    deltaXmm: null,
    quality: null
  });
  await S.addFrame(ratio.id, {
    role: 'sodium',
    deltaXPx: 1000,
    deltaXmm: 4,
    calibrationStatus: 'pending'
  });
  await S.addFrame(ratio.id, {
    role: 'sodium',
    deltaXPx: 2000,
    deltaXmm: 8,
    calibrationStatus: 'rejected'
  });
  await S.addFrame(ratio.id, {
    role: 'sodium',
    deltaXPx: 1500,
    deltaXmm: 6
  });
  const referenceOnly = S.createSession({ method: 'ratio', title: 'reference-only test' });
  await S.addFrame(referenceOnly.id, {
    role: 'reference',
    deltaXPx: 180.9,
    deltaXmm: 0.7236,
    stripeCount: 8,
    localCalibration: acceptedCalibration,
    calibrationStatus: 'autoAccepted',
    selection: { referenceOnly: true }
  });

  check('比值法角色定义', () => {
    assert.deepStrictEqual(S.requiredRoles('ratio'), ['sodium', 'reference']);
    assert.strictEqual(S.ROLE_LABEL.sodium, '钠光标准条纹');
    assert.strictEqual(S.ROLE_LABEL.reference, '红光待测条纹');
    return S.requiredRoles('ratio').join(',');
  });
  check('多帧不覆盖', () => {
    assert.strictEqual(S.listFrames(ratio.id, 'sodium').length, 5);
    return S.listFrames(ratio.id, 'sodium').length + ' frames';
  });
  check('视频来源与评分元数据', () => {
    assert.strictEqual(videoFrame.source, 'video');
    assert.strictEqual(videoFrame.sourceName, 'lab.mp4');
    assert.strictEqual(videoFrame.capturedAt, 1200);
    assert.strictEqual(videoFrame.qualityScore, 0.86);
    assert.strictEqual(videoFrame.selection.target, 20);
    return videoFrame.source + ' / ' + videoFrame.qualityScore;
  });
  check('同帧标定证据完整持久化', () => {
    assert.strictEqual(videoFrame.calibrationStatus, 'autoAccepted');
    assert.strictEqual(videoFrame.localCalibration.status, 'autoAccepted');
    assert.strictEqual(videoFrame.localCalibration.tickSpacingPx, 250);
    assert.strictEqual(videoFrame.localCalibration.lineCount, 4);
    assert.strictEqual(videoFrame.sourcePixels.width, 1920);
    assert.strictEqual(videoFrame.sourcePixels.analysisScale, 2 / 3);
    return 'k_i=' + videoFrame.localCalibration.kMmPx + ' / 4 lines';
  });
  check('空测量值保存为 null 而不是 0', () => {
    assert.strictEqual(emptyFrame.deltaXPx, null);
    assert.strictEqual(emptyFrame.deltaXmm, null);
    assert.strictEqual(emptyFrame.quality, null);
  });
  check('仅参考帧保留像素证据但禁止进入正式毫米统计', () => {
    const stat = S.roleStats(referenceOnly.id, 'reference');
    assert.strictEqual(stat.n, 0);
    assert.strictEqual(stat.nEvidence, 1);
    assert.strictEqual(stat.nPx, 1);
    assert.strictEqual(stat.nMm, 0);
    assert.strictEqual(stat.referenceOnly, true);
  });
  check('角色统计隔离', () => {
    const sodium = S.roleStats(ratio.id, 'sodium');
    const reference = S.roleStats(ratio.id, 'reference');
    assert.strictEqual(sodium.n, 2);
    assert.strictEqual(reference.n, 1);
    assert.strictEqual(sodium.nEvidence, 5);
    assert.strictEqual(reference.nEvidence, 2);
    assert.strictEqual(sodium.nPx, 5);
    assert.strictEqual(reference.nPx, 1);
    assert(Math.abs(sodium.meanMm - 0.6536) < 1e-12);
    assert(Math.abs(reference.meanMm - 0.7236) < 1e-12);
    return 'formal=' + sodium.n + '/' + reference.n +
      '；证据=' + sodium.nEvidence + '/' + reference.nEvidence;
  });
  check('待定、拒绝和旧全局 k 帧只留证据不入正式统计', () => {
    const sodium = S.roleStats(ratio.id, 'sodium');
    assert.strictEqual(sodium.n, 2);
    assert.strictEqual(sodium.nEvidence, 5);
    assert.strictEqual(sodium.nPx, 5);
    assert.strictEqual(sodium.pending, 1);
    assert.strictEqual(sodium.rejected, 1);
    assert.strictEqual(sodium.legacyGlobalK, 1);
    assert(Math.abs(sodium.meanPx - 965.36) < 1e-12);
    assert(Math.abs(sodium.meanMm - 0.6536) < 1e-12);
    return 'formal=' + sodium.n + ' / evidence=' + sodium.nEvidence +
      ' / pending=1 / rejected=1 / legacy=1';
  });
  check('追迹预设', () => {
    assert.strictEqual(S.TRACE_PRESET.d_mm, 0.90213);
    assert.strictEqual(S.TRACE_PRESET.source, 'matlab-strict');
    return S.TRACE_PRESET.label;
  });
  check('报告预设逐项标注来源', () => {
    const preset = S.reportParams('ratio');
    assert.strictEqual(preset.params.lambdaStandardNm, 589.3);
    assert.strictEqual(preset.params.nStandard, 1.5168);
    assert.strictEqual(preset.params.nTarget, 1.5145);
    assert.strictEqual(preset.sources.lambdaStandardNm, '标准值（报告预设，非实测）');
    assert.strictEqual(preset.sources.nStandard, 'N-BK7 折射率报告预设，非实测');
    return 'ratio 参数 3 项';
  });
  check('record/2 导出', () => {
    const rec = S.exportRecord();
    assert.strictEqual(rec.schema, 'bp.record/2');
    assert(rec.sessions.length >= 1);
    return rec.sessions.length + ' sessions';
  });
  check('同 ID 记录导入应覆盖旧会话', () => {
    const rec = S.exportRecord();
    const incoming = rec.sessions.find(item => item.id === ratio.id);
    incoming.title = 'ratio corrected';
    incoming.frames.find(item => item.id === videoFrame.id).deltaXPx = 164.2;
    S.importRecord(rec);
    assert.strictEqual(S.getSession(ratio.id).title, 'ratio corrected');
    assert.strictEqual(S.listFrames(ratio.id).find(item => item.id === videoFrame.id).deltaXPx, 164.2);
  });

  console.log(pass + ' pass / ' + fail + ' fail');
  if (fail) process.exit(1);
})();
