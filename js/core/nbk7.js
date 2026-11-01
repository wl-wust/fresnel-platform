/* =========================================================================
 * core/nbk7.js —— N-BK7 Sellmeier 色散与等效棱镜角反演
 * 依赖：无
 * 说明：A_eff 是由偏折角反演的等效棱镜角，不是分光计直接测角。
 * ========================================================================= */
(function (global) {
  'use strict';

  // Schott N-BK7 Sellmeier 系数，波长单位 μm。
  var B = [1.03961212, 0.231792344, 1.01046945];
  var C = [0.00600069867, 0.0200179144, 103.560653];

  function refractiveIndex(lambdaNm) {
    var lambda = Number(lambdaNm) / 1000;
    if (!(lambda > 0)) throw new Error('波长必须为正数');
    var n2 = 1;
    for (var i = 0; i < 3; i += 1) {
      var den = lambda * lambda - C[i];
      if (den === 0) throw new Error('波长落在 Sellmeier 极点');
      n2 += B[i] * lambda * lambda / den;
    }
    return Math.sqrt(n2);
  }

  function deflectionAngle(o) {
    var dx = Number(o.deltaXmm);
    var dw = Number(o.deltaWmm);
    if (!isFinite(dx) || !isFinite(dw) || dw === 0) {
      throw new Error('Δx 必须有限，Δw 必须非零');
    }
    var tanBeta = -2 * dx / dw;
    var betaRad = Math.atan(tanBeta);
    return {
      tanBeta: tanBeta,
      betaRad: betaRad,
      betaDeg: betaRad * 180 / Math.PI,
      formula: 'tan β = -2·Δx/Δw'
    };
  }

  function effectivePrismAngle(o) {
    var angle = deflectionAngle(o);
    var n = refractiveIndex(o.lambdaNm);
    var aEffRad = Math.abs(angle.betaRad) / (n - 1);
    return {
      lambdaNm: Number(o.lambdaNm),
      n: n,
      tanBeta: angle.tanBeta,
      betaRad: angle.betaRad,
      betaDeg: angle.betaDeg,
      aEffRad: aEffRad,
      aEffDeg: aEffRad * 180 / Math.PI,
      source: 'inverse-deflection',
      material: 'N-BK7',
      formula: 'A_eff = |β|/(n(λ)-1)'
    };
  }

  var API = {
    refractiveIndex: refractiveIndex,
    deflectionAngle: deflectionAngle,
    effectivePrismAngle: effectivePrismAngle
  };
  global.BP = global.BP || {};
  global.BP.nbk7 = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
