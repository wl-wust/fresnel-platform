'use strict';

const assert = require('assert');
const physics = require('../js/physics.js');
const S = require('../js/core/sessions.js');
const D = require('../js/core/session-data.js');

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    const detail = await fn();
    pass += 1;
    console.log('PASS  ' + name + (detail ? '  ' + detail : ''));
  } catch (e) {
    fail += 1;
    console.log('FAIL  ' + name + '  ' + e.message);
  }
}

async function createWithFrames(method, frames, extra) {
  const session = S.createSession(Object.assign({ method }, extra || {}));
  for (const frame of frames) await S.addFrame(session.id, frame);
  return S.getSession(session.id);
}

(async () => {
  global.BP = global.BP || {};
  global.BP.physics = physics;

  await check('基本公式法构建多帧波长与来源', async () => {
    const session = await createWithFrames('basic', [
      { role: 'sodium', deltaXPx: 163.0 },
      { role: 'sodium', deltaXPx: 163.6 }
    ], {
      calibration: { k_mm_px: 0.004, source: 'L/N' },
      params: { d: 0.90213, D: 1000 }
    });
    const out = D.build(session);
    assert.strictEqual(out.method, 'basic');
    assert(Math.abs(out.values.dxNaPx - 163.3) < 1e-9);
    assert(Math.abs(out.values.k - 0.004) < 1e-12);
    assert(Math.abs(out.values.lambdaNm - 589.2713) < 0.01);
    assert.strictEqual(out.stats.lambda.n, 2);
    assert(out.stats.lambda.sdNm > 0);
    assert.strictEqual(out.sources.dxNaPx, '自动识别');
    assert.strictEqual(out.sources.k, '来自标定');
    assert.strictEqual(out.sources.d, '当前会话继承');
    assert.strictEqual(out.complete, true);
  });

  await check('比值法缺参考条纹时明确标记缺失', async () => {
    const session = await createWithFrames('ratio', [
      { role: 'sodium', deltaXPx: 163.3 }
    ], {
      calibration: { k_mm_px: 0.004 },
      params: { lamRef: 650, nNa: 1.5168, nRef: 1.5145 }
    });
    const out = D.build(session);
    assert.strictEqual(out.values.dxNaPx, 163.3);
    assert.strictEqual(out.values.dxRefPx, null);
    assert.strictEqual(out.complete, false);
    assert(out.missing.some(item => item.key === 'dxRefPx'));
  });

  await check('放大率法用毫米帧值且不伪造 d′/β', async () => {
    const session = await createWithFrames('magnification', [
      { role: 'no_lens', deltaXPx: 163.33, deltaXmm: 0.65332 },
      { role: 'with_lens', deltaXPx: 718.65, deltaXmm: 2.8746 }
    ], {
      calibration: { k_mm_px: 0.004 },
      params: { D: 1000 }
    });
    const out = D.build(session);
    assert(Math.abs(out.values.dxNaMm - 0.65332) < 1e-12);
    assert(Math.abs(out.values.dxPrimeMm - 2.8746) < 1e-12);
    assert.strictEqual(out.values.dPrime, null);
    assert.strictEqual(out.values.beta, null);
    assert.strictEqual(out.complete, false);
    assert(out.missing.some(item => item.key === 'dPrime'));
    assert(out.missing.some(item => item.key === 'beta'));
  });

  await check('追迹法继承追迹 d 与标定 k', async () => {
    const session = await createWithFrames('trace', [
      { role: 'sodium', deltaXPx: 163.3 }
    ], {
      calibration: { k_mm_px: 0.004 },
      params: { D: 1000 }
    });
    const out = D.build(session);
    assert.strictEqual(out.values.d, S.TRACE_PRESET.d_mm);
    assert.strictEqual(out.sources.d, '追迹预设');
    assert.strictEqual(out.values.k, 0.004);
    assert.strictEqual(out.complete, true);
  });

  await check('没有会话参数时不使用报告默认值冒充数据', async () => {
    const session = await createWithFrames('basic', [
      { role: 'sodium', deltaXPx: 163.3 }
    ], {
      calibration: { k_mm_px: 0.004 }
    });
    const out = D.build(session);
    assert.strictEqual(out.values.d, null);
    assert.strictEqual(out.values.D, null);
    assert.strictEqual(out.complete, false);
    assert(out.missing.some(item => item.key === 'd'));
    assert(out.missing.some(item => item.key === 'D'));
  });

  await check('会话保留 d/D 的参数来源标记', async () => {
    const session = await createWithFrames('basic', [
      { role: 'sodium', deltaXPx: 163.3 }
    ], {
      calibration: { k_mm_px: 0.004 },
      params: { d: 0.90213, D: 1000 },
      paramsSources: { d: '报告预设', D: '手动输入' }
    });
    const out = D.build(session);
    assert.strictEqual(out.sources.d, '报告预设');
    assert.strictEqual(out.sources.D, '手动输入');
  });

  console.log(pass + ' pass / ' + fail + ' fail');
  if (fail) process.exit(1);
})();
