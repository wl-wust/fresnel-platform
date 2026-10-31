/* =========================================================================
 * core/fmt.js —— 唯一显示口径（第三层之前的格式化服务）
 * 依赖：physics.js（只为把 BiprismPhysics 挂到 BP.physics 这个统一入口上）
 * 规则（与任务书 §P1.1 一致，改这里之前先看 §2.3 那四条口径陷阱）：
 *   波长 3 位小数 nm；长度 4 位小数 mm；
 *   绝对不确定度 2 位有效数字，波长与它末位对齐；
 *   rel()  = 百分数 2 位小数        → 对齐表 5.2 的 0.10% / 0.13% / 0.14%
 *   pct()  = 百分数 4→3 位小数      → 对齐表 8.1 的 0.0006% / 0.100% / 0.030%
 * 其它模块禁止直接 .toFixed()。
 * ========================================================================= */
(function (global) {
  'use strict';

  var DASH = '—';
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // 定点；非有限值统一显示破折号
  function num(v, digits) {
    if (!isNum(v)) return DASH;
    return v.toFixed(digits == null ? 2 : digits);
  }

  // 2 位有效数字：返回 { text, decimals }，decimals 用于让波长与 u 末位对齐
  function sig2(v) {
    if (!isNum(v)) return null;
    if (v === 0) return { decimals: 2, text: '0.00' };
    var e = Math.floor(Math.log10(Math.abs(v)));
    var d = Math.max(0, Math.min(12, 1 - e));
    return { decimals: d, text: v.toFixed(d) };
  }

  function du(v) { var s = sig2(v); return s ? s.text : DASH; }

  function lam(v) { return isNum(v) ? v.toFixed(3) + ' nm' : DASH; }

  // '589.31 ± 0.42 nm'
  function lamU(v, u) {
    if (!isNum(v)) return DASH;
    var s = sig2(u);
    if (!s) return v.toFixed(3) + ' nm';
    return v.toFixed(s.decimals) + ' ± ' + s.text + ' nm';
  }

  // 路径级相对不确定度：百分数 2 位小数（任务书 §2.3 第二行，别改成"有效数字"）
  function rel(v) { return isNum(v) ? (v * 100).toFixed(2) + '%' : DASH; }

  // 分量级相对不确定度：百分数 4→3 位小数，复现表 8.1 的写法
  function pct(v) {
    if (!isNum(v)) return DASH;
    var s = (v * 100).toFixed(4);
    var m = /^(-?\d+)\.(\d+)$/.exec(s);
    if (!m) return s + '%';
    var f = m[2];
    while (f.length > 3 && f.charAt(f.length - 1) === '0') f = f.slice(0, -1);
    return m[1] + '.' + f + '%';
  }

  function mm(v) { return isNum(v) ? v.toFixed(4) : DASH; }
  function px(v) { return isNum(v) ? v.toFixed(1) : DASH; }
  function deg(v) { return isNum(v) ? v.toFixed(1) + '°' : DASH; }

  var SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
              '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

  // 通用数值：小量用科学计数（0.004 → 4.00×10⁻³）
  function sci(v, sig) {
    if (!isNum(v)) return DASH;
    if (v === 0) return '0';
    var a = Math.abs(v);
    // 阈值 10⁻²：0.0040 mm/px 这类量用 4.00×10⁻³ 更易读（任务书 §P1.1）
    if (a >= 1e-2 && a < 1e5) return num(v, sig == null ? 4 : sig);
    var e = Math.floor(Math.log10(a));
    var mant = v / Math.pow(10, e);
    var es = String(e).split('').map(function (c) { return SUP[c] || c; }).join('');
    return mant.toFixed(sig == null ? 2 : sig) + '×10' + es;
  }

  global.BP = global.BP || {};

  // 命名桥：physics.js 的导出名是 BiprismPhysics，平台统一入口是 BP.physics（任务书 §1.3）。
  // 这里只做一次赋值引用，不复制、不计算。
  if (!global.BP.physics && global.BiprismPhysics) global.BP.physics = global.BiprismPhysics;

  global.BP.fmt = {
    num: num, sig2: sig2, du: du, lam: lam, lamU: lamU,
    rel: rel, pct: pct, mm: mm, px: px, deg: deg, sci: sci, DASH: DASH
  };
})(typeof window !== 'undefined' ? window : globalThis);
