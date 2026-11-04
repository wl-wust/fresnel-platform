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
  const videoFrame = await S.addFrame(ratio.id, {
    role: 'sodium',
    deltaXPx: 163.3,
    source: 'video',
    sourceName: 'lab.mp4',
    capturedAt: 1200,
    qualityScore: 0.86,
    selection: { target: 20, cv: 0.002 }
  });
  await S.addFrame(ratio.id, { role: 'sodium', deltaXPx: 163.5 });
  await S.addFrame(ratio.id, { role: 'reference', deltaXPx: 180.9 });

  check('比值法角色定义', () => {
    assert.deepStrictEqual(S.requiredRoles('ratio'), ['sodium', 'reference']);
    return S.requiredRoles('ratio').join(',');
  });
  check('多帧不覆盖', () => {
    assert.strictEqual(S.listFrames(ratio.id, 'sodium').length, 2);
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
  check('角色统计隔离', () => {
    const sodium = S.roleStats(ratio.id, 'sodium');
    const reference = S.roleStats(ratio.id, 'reference');
    assert.strictEqual(sodium.n, 2);
    assert.strictEqual(reference.n, 1);
    return sodium.meanPx.toFixed(2) + ' / ' + reference.meanPx.toFixed(2);
  });
  check('追迹预设', () => {
    assert.strictEqual(S.TRACE_PRESET.d_mm, 0.90213);
    assert.strictEqual(S.TRACE_PRESET.source, 'matlab-strict');
    return S.TRACE_PRESET.label;
  });
  check('record/2 导出', () => {
    const rec = S.exportRecord();
    assert.strictEqual(rec.schema, 'bp.record/2');
    assert(rec.sessions.length >= 1);
    return rec.sessions.length + ' sessions';
  });

  console.log(pass + ' pass / ' + fail + ' fail');
  if (fail) process.exit(1);
})();
