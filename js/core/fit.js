/* =========================================================================
 * core/fit.js —— 最小二乘拟合（PC 拟合页 + Δx–L₃ 斜率法）
 * 依赖：physics.js 的 linfit（禁止在这里另写一份统计公式）
 * 报告对应：式(13)(17)，图 5.1 的 Δx–L₃ 直线，斜率 = λ/d
 * ========================================================================= */
(function (global) {
  'use strict';

  var BP = global.BP = global.BP || {};

  function phys() { return BP.physics || global.BiprismPhysics; }

  function linfit() {
    var P = phys();
    if (!P || typeof P.linfit !== 'function') throw new Error('fit.js 需要先加载 physics.js');
    return P.linfit;
  }

  // linear(xs, ys) → { slope, intercept, r2, sRes, n, residuals, x, y }
  function linear(xs, ys) {
    var x = (xs || []).map(Number), y = (ys || []).map(Number);
    var n = Math.min(x.length, y.length);
    x = x.slice(0, n); y = y.slice(0, n);
    var bad = 0;
    for (var i = 0; i < n; i++) if (!isFinite(x[i]) || !isFinite(y[i])) bad++;
    if (n - bad < 2) throw new Error('拟合至少需要 2 个有效数据点');
    if (bad) throw new Error('有 ' + bad + ' 个数据点不是有效数字，请先修正');
    if (n < 2) throw new Error('拟合至少需要 2 个数据点');

    var f = linfit()(x, y);
    var meanY = 0;
    for (i = 0; i < n; i++) meanY += y[i];
    meanY /= n;

    var ssRes = 0, ssTot = 0, res = [];
    for (i = 0; i < n; i++) {
      var r = y[i] - (f.a + f.b * x[i]);
      res.push(r);
      ssRes += r * r;
      ssTot += (y[i] - meanY) * (y[i] - meanY);
    }
    var dof = n - 2;
    return {
      slope: f.b, intercept: f.a, n: n,
      r2: ssTot ? 1 - ssRes / ssTot : NaN,
      sRes: dof > 0 ? Math.sqrt(ssRes / dof) : NaN,   // 残差标准差（单位同 y）
      residuals: res, x: x, y: y
    };
  }

  // 斜率的相对标准不确定度：s_res / |slope| / √n
  function slopeRelU(fit) {
    if (!fit || !fit.n || !isFinite(fit.slope) || fit.slope === 0) return NaN;
    return fit.sRes / Math.abs(fit.slope) / Math.sqrt(fit.n);
  }

  // Δx–L₃ 直线：Δx(mm) = (λ/d)·L₃(mm) ⇒ slope = λ/d ⇒ λ = slope·d
  function dxOverL3(Ls, dxsMm, dMm) {
    var fit = linear(Ls, dxsMm);
    return {
      fit: fit,
      slope: fit.slope,
      relU: slopeRelU(fit),
      lamNm: (isFinite(dMm) && dMm > 0) ? fit.slope * dMm * 1e6 : NaN
    };
  }

  // 从表格读两列数字（DOM 只在浏览器里用）
  function readTable(rowsEl) {
    var xs = [], ys = [];
    if (!rowsEl) return { xs: xs, ys: ys };
    var trs = rowsEl.querySelectorAll ? rowsEl.querySelectorAll('tr') : [];
    Array.prototype.forEach.call(trs, function (tr) {
      var xi = tr.querySelector('.fit-x'), yi = tr.querySelector('.fit-y');
      if (!xi || !yi) return;
      var vx = parseFloat(xi.value), vy = parseFloat(yi.value);
      if (isFinite(vx) && isFinite(vy)) { xs.push(vx); ys.push(vy); }
    });
    return { xs: xs, ys: ys };
  }

  BP.fit = {
    linear: linear,
    slopeRelU: slopeRelU,
    dxOverL3: dxOverL3,
    readTable: readTable
  };
})(typeof window !== 'undefined' ? window : globalThis);
