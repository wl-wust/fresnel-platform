'use strict';

const assert = require('assert');
const N = require('../js/core/nbk7.js');

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

check('N-BK7 589.3 nm 折射率', () => {
  const n = N.refractiveIndex(589.3);
  assert(Math.abs(n - 1.5168) < 0.0002, n.toFixed(8));
  return n.toFixed(8);
});

check('N-BK7 650 nm 折射率', () => {
  const n = N.refractiveIndex(650);
  assert(Math.abs(n - 1.5145) < 0.0002, n.toFixed(8));
  return n.toFixed(8);
});

check('偏折角公式与 A_eff 输出', () => {
  const r = N.effectivePrismAngle({
    deltaXmm: 0.5,
    deltaWmm: -25,
    lambdaNm: 589.3
  });
  assert(Math.abs(r.tanBeta - 0.04) < 1e-12, String(r.tanBeta));
  assert(r.betaDeg > 0 && r.aEffDeg > 0, String(r.aEffDeg));
  assert(r.source === 'inverse-deflection' && r.material === 'N-BK7');
  return 'β=' + r.betaDeg.toFixed(4) + '°, A_eff=' + r.aEffDeg.toFixed(4) + '°';
});

console.log(pass + ' pass / ' + fail + ' fail');
if (fail) process.exit(1);
