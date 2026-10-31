/* =========================================================================
 * pages/pc.js —— index.html 的全部页面胶水（第三层）
 * 依赖：physics.js, core/fmt.js, core/ui.js, core/store.js, core/fit.js,
 *       core/plot.js, core/api.js（按任务书 §1.4 的顺序引入）
 * 铁律：本文件不写任何物理公式，只做「读输入 → 调 BP.* → 交 BP.ui 渲染」。
 * 口径：默认值取自研究报告表 5.1；相对不确定度一律用 BP.fmt.rel/pct 显示。
 * ========================================================================= */
(function (global) {
  'use strict';

  var BP = global.BP;
  var doc = global.document;
  var $ = BP.ui.$;
  var F = BP.fmt;

  // 表 5.1（报告口径）。金标准的权威副本在 tools/golden.json，改这里之前先对报告。
  var REPORT = {
    d: 0.90213, D: 1000, k: 0.0040, dxPx: 163.3,
    dxNaPx: 163.3, dxRefPx: 180.9, lamRef: 650,
    nNa: 1.5168, nRef: 1.5145
  };
  // 三条路径共用同一批 Δx，公共项单列（报告 8.2）；表 8.1 的 u(Δx)/Δx
  var COMMON_REL_U = 6.4e-6;

  function num(id, dflt) {
    var el = $(id);
    if (!el) return dflt;
    var v = parseFloat(el.value);
    return isFinite(v) ? v : dflt;
  }
  function setVal(id, v) { var el = $(id); if (el) el.value = v; }
  function fail(e) { BP.ui.alert(e && e.message ? e.message : String(e), 'error'); }

  // 本文件用到的全部 DOM id。tools/check-ids.js 据此静态核对（缺一个就报错），
  // 这一行是"引用了不存在的元素"那类缺陷（报告 P2-5）的唯一防线，改代码时同步维护。
  var IDS = [
    'imageInput', 'analysisResult',
    'd_value', 'D_value', 'pixel_size', 'fringe_period_px', 'wavelengthResult',
    'fringe_sodium', 'fringe_laser', 'lambda_laser', 'n_na', 'n_ref', 'ratioResult',
    'unc_d_pc', 'unc_u_d_pc', 'unc_D_pc', 'unc_u_D_pc', 'unc_fringe_pc', 'enhancedUncResultPC',
    'fitTable', 'fitResult', 'fitResiduals', 'fitChartContainer', 'fitChart',
    'uncTable', 'uncertaintyResult',
    'pathTable', 'standard_value', 'compareResult', 'compareTable',
    'historyList'
  ];

  /* ---------------- 页签 ---------------- */
  function switchTab(name, btn) {
    BP.ui.$$('.tab').forEach(function (t) { t.classList.remove('active'); });
    BP.ui.$$('.tab-content').forEach(function (t) { t.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    var panel = $(name);
    if (panel) panel.classList.add('active');
  }
  function bindTabs() {
    BP.ui.$$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchTab(tab.dataset.tab, tab); });
    });
  }

  /* ---------------- 图像分析（P5 接入纯前端提取） ---------------- */
  function analyzeImage() {
    var input = $('imageInput');
    if (!input || !input.files || !input.files.length) { BP.ui.alert('请先选择图像文件'); return; }
    BP.ui.alert('图像分析将在 P5 接入纯前端实现（physics.js 的 fringePeriod 已就绪）', 'info');
  }

  /* ---------------- 波长计算：基本公式法 ---------------- */
  function calcWavelength() {
    try {
      var d = num('d_value'), D = num('D_value'), k = num('pixel_size'), dxPx = num('fringe_period_px');
      var r = BP.physics.wavelengthBasic({ d: d, D: D, dxPx: dxPx, k: k });
      BP.ui.result($('wavelengthResult'), [
        { label: '条纹间距 Δx', value: F.mm(r.dxMm) + ' mm', note: 'Δx = ' + F.px(dxPx) + ' px × k' },
        { label: '波长 λ', value: F.lam(r.value), cls: 'is-key' },
        { label: '公式', value: r.formula, cls: 'is-dim' }
      ]);
      BP.store.saveHistory('basic', { d: d, D: D, k: k, dxPx: dxPx, lamNm: r.value });
      renderHistory();
    } catch (e) { fail(e); }
  }

  /* ---------------- 比值法（含色散修正） ---------------- */
  function calcRatioMethod() {
    try {
      var dxNa = num('fringe_sodium'), dxRef = num('fringe_laser'), lamRef = num('lambda_laser');
      var nNa = num('n_na', REPORT.nNa), nRef = num('n_ref', REPORT.nRef);
      var r = BP.physics.wavelengthRatio({ dxNaPx: dxNa, dxRefPx: dxRef, lamRef: lamRef, nNa: nNa, nRef: nRef });
      var noFix = lamRef * (dxNa / dxRef);
      BP.ui.result($('ratioResult'), [
        { label: '色散修正因子', value: r.dispersion.toFixed(5), note: '(n_Na−1)/(n_ref−1)' },
        { label: '波长 λ_Na', value: F.lam(r.value), cls: 'is-key' },
        { label: '若漏掉修正', value: F.lam(noFix),
          note: '相差 ' + ((noFix - r.value) / r.value * 100).toFixed(2) + '%（报告论证过不可省略）' },
        { label: '公式', value: r.formula, cls: 'is-dim' }
      ]);
      BP.store.saveHistory('ratio', { dxNaPx: dxNa, dxRefPx: dxRef, lamRef: lamRef, nNa: nNa, nRef: nRef, lamNm: r.value });
      renderHistory();
    } catch (e) { fail(e); }
  }

  /* ---------------- 增强不确定度（单路径：u(d)/u(D)/u(Δx) 直接给） ----------------
   * 说明：本卡直接收 u(d)，不涉及 a、n、A 的折叠，因此没有 (n−1) 分母问题，
   *       用 wavelengthBasic 自带的方和根是**口径正确**的。
   *       表 8.1 的八分量折叠走「不确定度评定」页（P2）。
   */
  function calcUncertaintyPC() {
    try {
      var d = num('unc_d_pc'), D = num('unc_D_pc'), dxPx = num('unc_fringe_pc');
      var k = num('pixel_size', REPORT.k);
      if (!(dxPx > 0)) throw new Error('请填写条纹间距（px）');
      var ud = num('unc_u_d_pc', 0), uD = num('unc_u_D_pc', 0), udx = 0.5;   // 亚像素，明确写出
      var r = BP.physics.wavelengthBasic({ d: d, D: D, dxPx: dxPx, k: k, ud: ud, uD: uD, udxPx: udx });
      var rows = [
        { label: '波长 λ', value: F.lam(r.value), cls: 'is-key' },
        { label: 'u(d)/d', value: F.pct(d ? ud / d : 0) },
        { label: 'u(D)/D', value: F.pct(D ? uD / D : 0) },
        { label: 'u(Δx)/Δx', value: F.pct(udx / dxPx), note: 'u(Δx) 取 0.5 px（亚像素）；k 取 ' + F.sci(k) + ' mm/px' },
        { label: '合成相对不确定度', value: F.rel(r.relU), cls: 'is-key' },
        { label: 'u(λ)', value: F.du(r.value * r.relU) + ' nm' }
      ];
      BP.ui.result($('enhancedUncResultPC'), rows, {
        caption: '单路径（直接输入 u(d)）｜八分量折叠见「不确定度评定」页'
      });
      BP.store.saveHistory('unc-pc', { d: d, D: D, dxPx: dxPx, ud: ud, uD: uD, relU: r.relU });
      renderHistory();
    } catch (e) { fail(e); }
  }

  /* ---------------- 最小二乘拟合 ---------------- */
  function performFitTable() {
    try {
      var t = BP.fit.readTable($('fitTable').querySelector('tbody') || $('fitTable'));
      if (t.xs.length < 2) throw new Error('至少需要 2 个有效数据点');
      var f = BP.fit.linear(t.xs, t.ys);
      var rows = [
        { label: '斜率 k', value: F.num(f.slope, 6), cls: 'is-key' },
        { label: '截距 b', value: F.num(f.intercept, 6) },
        { label: '相关系数 R²', value: F.num(f.r2, 6) },
        { label: '残差标准差', value: F.num(f.sRes, 6) },
        { label: '数据点 n', value: String(f.n) },
        { label: '斜率的相对不确定度', value: F.rel(BP.fit.slopeRelU(f)) }
      ];
      BP.ui.result($('fitResult'), rows, { caption: 'y = k·x + b' });

      var resTable = f.residuals.map(function (r, i) {
        return [i + 1, F.num(f.x[i], 4), F.num(f.y[i], 4), F.num(r, 6)];
      });
      var host = $('fitResiduals');
      if (host) BP.ui.table(host, ['#', 'x', 'y', '残差'], resTable);

      var box = $('fitChartContainer'), cv = $('fitChart');
      if (box && cv && BP.plot) {
        box.style.display = 'block';
        var pts = f.x.map(function (x, i) { return [x, f.y[i]]; });
        BP.plot.scatter(cv, pts, { fitLine: { slope: f.slope, intercept: f.intercept }, title: '最小二乘拟合' });
      }
      BP.store.saveHistory('fit', { n: f.n, slope: f.slope, intercept: f.intercept, r2: f.r2 });
      renderHistory();
    } catch (e) { fail(e); }
  }

  /* ---------------- 不确定度评定（A 类） ---------------- */
  function calcUncertaintyTable() {
    try {
      var vals = BP.ui.$$('#uncTable .unc-value').map(function (i) { return parseFloat(i.value); })
        .filter(function (v) { return isFinite(v); });
      var a = BP.physics.typeA(vals);
      BP.ui.result($('uncertaintyResult'), [
        { label: '测量次数 n', value: String(a.n) },
        { label: '平均值', value: F.num(a.mean, 3) + ' nm', cls: 'is-key' },
        { label: '标准差 s', value: F.num(a.sd, 3) + ' nm' },
        { label: 'A 类不确定度 u_A = s/√n', value: F.num(a.uA, 3) + ' nm', cls: 'is-key' },
        { label: '相对值 u_A/x̄', value: F.pct(a.relUA) },
        { label: '极差', value: F.num(a.range, 3) + ' nm' }
      ], { caption: 'A 类（重复测量）｜B 类八分量见 P2 的表 8.1 折叠页' });
      BP.store.saveHistory('typeA', { n: a.n, mean: a.mean, sd: a.sd, uA: a.uA });
      renderHistory();
    } catch (e) { fail(e); }
  }

  /* ---------------- 多路径加权合成 + χ² ---------------- */
  function readPaths() {
    var names = BP.ui.$$('#pathTable .path-name');
    var vals = BP.ui.$$('#pathTable .path-value');
    var uncs = BP.ui.$$('#pathTable .path-unc');
    var out = [];
    vals.forEach(function (v, i) {
      var val = parseFloat(v.value), u = parseFloat(uncs[i] ? uncs[i].value : '');
      if (!isFinite(val)) return;
      out.push({
        name: (names[i] && names[i].value) ? names[i].value : ('路径' + (i + 1)),
        value: val,
        uncertainty: isFinite(u) ? u : NaN
      });
    });
    return out;
  }

  function comparePathsTable() {
    try {
      var paths = readPaths();
      if (!paths.length) throw new Error('请填入至少一条路径的值');
      var bad = paths.filter(function (p) { return !(p.uncertainty > 0); });
      if (bad.length) throw new Error('「' + bad[0].name + '」缺不确定度（必须为正）');
      var std = num('standard_value', 589.3);
      var c = BP.physics.weightedCombine(paths, { standard: std, commonRelU: COMMON_REL_U });

      BP.ui.result($('compareResult'), [
        { label: '加权平均值 λ̂', value: F.lamU(c.mean, c.uCombined), cls: 'is-key' },
        { label: '相对不确定度', value: F.rel(c.relU) },
        { label: '只按独立分量 u', value: F.du(c.uIndep) + ' nm', note: '公共项 u(Δx)/Δx = ' + F.pct(c.commonRelU) + ' 单列后抬到 ' + F.du(c.uCombined) + ' nm' },
        { label: 'χ² / 自由度 ν', value: F.num(c.chi2, 4) + ' / ' + c.dof },
        { label: 'χ²₀.₉₅(ν) 判据', value: F.num(c.chi2Crit, 3) },
        { label: '一致性结论', value: BP.ui.badge(c.consistent), cls: 'is-key' },
        { label: '与 ' + F.num(std, 1) + ' nm 的偏差', value: F.num(c.bias, 3) + ' nm（' + F.rel(c.relBias) + '）' }
      ], { caption: '式 (19)(20)：加权合成与 χ² 一致性检验' });

      var tb = $('compareTable');
      if (tb) {
        BP.ui.table(tb, ['路径', 'λ / nm', 'u / nm', '权重 w∝1/u²', '拉离 λ̂ 的 u 倍数'], paths.map(function (p) {
          return [p.name, F.num(p.value, 2), F.num(p.uncertainty, 2),
                  F.num(p.weight / c.paths[0].weight, 3), F.num((p.value - c.mean) / p.uncertainty, 2)];
        }));
      }
      BP.store.saveHistory('combine', { n: paths.length, mean: c.mean, u: c.uCombined, chi2: c.chi2, consistent: c.consistent });
      renderHistory();
    } catch (e) { fail(e); }
  }

  /* ---------------- 一键填入报告值 ---------------- */
  function fillReportParams() {
    setVal('d_value', REPORT.d); setVal('D_value', REPORT.D);
    setVal('pixel_size', REPORT.k); setVal('fringe_period_px', REPORT.dxPx);
    setVal('fringe_sodium', REPORT.dxNaPx); setVal('fringe_laser', REPORT.dxRefPx);
    setVal('lambda_laser', REPORT.lamRef);
    setVal('n_na', REPORT.nNa); setVal('n_ref', REPORT.nRef);
    BP.ui.alert('已填入研究报告表 5.1 参数', 'ok');
  }

  function fillReportPaths() {
    var names = ['比值法', '横向放大率法', '光线追迹法'];
    var vals = [[589.33, 0.61], [589.28, 0.84], [589.30, 0.78]];
    var tbody = $('pathTable').querySelector('tbody');
    BP.ui.clear(tbody);
    names.forEach(function (n, i) {
      var tr = doc.createElement('tr');
      tr.appendChild(cell(input('text', 'path-name', n)));
      tr.appendChild(cell(input('number', 'path-value', String(vals[i][0]))));
      tr.appendChild(cell(input('number', 'path-unc', String(vals[i][1]))));
      tr.appendChild(cell(delBtn(removePathRow)));
      tbody.appendChild(tr);
    });
    setVal('standard_value', 589.3);
    BP.ui.alert('已填入表 5.2 的三条路径', 'ok');
  }

  /* ---------------- 表格行操作（不用 innerHTML） ---------------- */
  function input(type, cls, val) {
    var el = doc.createElement('input');
    el.type = type; el.className = cls;
    if (val != null) el.value = val;
    if (type === 'number') el.step = 'any';
    return el;
  }
  function cell(node) { var td = doc.createElement('td'); td.appendChild(node); return td; }
  function delBtn(fn) {
    var b = doc.createElement('button');
    b.textContent = '删除';
    b.addEventListener('click', function () { fn(b); });
    return b;
  }
  function removeRow(btn) { var tr = btn.closest('tr'); if (tr) tr.parentNode.removeChild(tr); }

  function addFitRow() {
    var tb = $('fitTable').querySelector('tbody');
    var tr = doc.createElement('tr');
    tr.appendChild(cell(input('number', 'fit-x', '')));
    tr.appendChild(cell(input('number', 'fit-y', '')));
    tr.appendChild(cell(delBtn(removeFitRow)));
    tb.appendChild(tr);
  }
  function removeFitRow(btn) { removeRow(btn); }

  function addUncRow() {
    var tb = $('uncTable').querySelector('tbody');
    var tr = doc.createElement('tr');
    tr.appendChild(cell(input('number', 'unc-value', '')));
    tr.appendChild(cell(delBtn(removeUncRow)));
    tb.appendChild(tr);
  }
  function removeUncRow(btn) { removeRow(btn); }

  function addPathRow() {
    var tb = $('pathTable').querySelector('tbody');
    var tr = doc.createElement('tr');
    tr.appendChild(cell(input('text', 'path-name', '')));
    tr.appendChild(cell(input('number', 'path-value', '')));
    tr.appendChild(cell(input('number', 'path-unc', '')));
    tr.appendChild(cell(delBtn(removePathRow)));
    tb.appendChild(tr);
  }
  function removePathRow(btn) { removeRow(btn); }

  /* ---------------- 历史记录 ---------------- */
  function renderHistory() {
    var host = $('historyList');
    if (!host) return;
    BP.ui.clear(host);
    var list = BP.store.listHistory();
    if (!list.length) {
      var p = doc.createElement('p');
      p.className = 'is-dim';
      p.textContent = '暂无历史记录';
      host.appendChild(p);
      return;
    }
    BP.ui.table(host, ['时间', '类型', '内容'], list.map(function (h) {
      return [String(h.at || '').replace('T', ' ').slice(0, 19), h.type, JSON.stringify(h.data)];
    }));
  }
  function clearHistory() {
    if (!global.confirm) return;
    if (global.confirm('确定清空所有历史记录？')) { BP.store.clearHistory(); renderHistory(); }
  }
  function exportHistory() {
    if (!BP.store.listHistory().length) { BP.ui.alert('暂无历史记录'); return; }
    BP.store.exportHistory();
  }

  /* ---------------- 页面跳转 ---------------- */
  function switchToMobile() { global.location.href = 'mobile.html'; }

  /* ---------------- 导出到全局（index.html 的 onclick 用） ---------------- */
  var API = {
    switchTab: switchTab, switchToMobile: switchToMobile,
    analyzeImage: analyzeImage,
    calcWavelength: calcWavelength, calcRatioMethod: calcRatioMethod,
    calcUncertaintyPC: calcUncertaintyPC,
    performFitTable: performFitTable, addFitRow: addFitRow, removeFitRow: removeFitRow,
    calcUncertaintyTable: calcUncertaintyTable, addUncRow: addUncRow, removeUncRow: removeUncRow,
    comparePathsTable: comparePathsTable, addPathRow: addPathRow, removePathRow: removePathRow,
    fillReportParams: fillReportParams, fillReportPaths: fillReportPaths,
    clearHistory: clearHistory, exportHistory: exportHistory, renderHistory: renderHistory
  };
  for (var k in API) if (Object.prototype.hasOwnProperty.call(API, k)) global[k] = API[k];

  if (doc) {
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', function () { bindTabs(); renderHistory(); });
    } else { bindTabs(); renderHistory(); }
  }

  BP.pages = BP.pages || {};
  BP.pages.pc = API;
})(typeof window !== 'undefined' ? window : globalThis);
