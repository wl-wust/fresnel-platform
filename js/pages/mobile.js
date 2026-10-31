/* =========================================================================
 * pages/mobile.js —— 手机采集端（P4）全部页面胶水
 * 依赖：physics.js, core/fmt.js, core/ui.js, core/store.js
 * 职责：拍照/选图 → 标定 k（式 24）→ 快速校验（λ / A 类 / 合成）→ 导出 record.json
 * 铁律：不写物理公式，全部走 BP.physics；不放结论进 record，只放原始量。
 * 相机三件必须记住的坑（旧版 mobile_merged.js 全踩了）：
 *   ① getUserMedia 是 Promise，必须 await，不能直接赋给 video.srcObject；
 *   ② 拍照产物必须是 File（FormData/后续处理都要它），不能是 dataURL 字符串；
 *   ③ 旧文件里 openCamera/triggerCamera/calcUncertainty/comparePaths 各定义了两次，
 *      后定义的覆盖先定义的 —— 本文件每个函数只定义一次。
 * ========================================================================= */
(function (global) {
  'use strict';

  var BP = global.BP;
  var doc = global.document;
  var $ = BP.ui.$, F = BP.fmt;

  // 本文件用到的静态 DOM id（tools/check-ids.js 据此核对）
  var IDS = ['previewBox', 'video', 'cameraControls', 'fileInput',
             'param_d', 'param_D', 'curK', 'captureResult',
             'cal_k', 'cal_L', 'cal_N', 'calResult',
             'reticleFile', 'reticleCanvas', 'retPix', 'retL', 'retResult', 'currentK',
             'dataTableBody', 'uncInputs', 'uncResult',
             'combineBody', 'combineResult', 'recordFile', 'recordResult'];

  var REPORT = { d: 0.90213, D: 1000, k: 0.0040, nNa: 1.5168, nRef: 1.5145 };
  // 三条路径共用同一批 Δx（报告 8.2）；表 8.1 的 u(Δx)/Δx
  var COMMON_REL_U = 6.4e-6;

  var cam = { stream: null, file: null };
  var ret = { img: null, scale: 1, pts: [] };

  function num(id, dflt) {
    var el = $(id);
    if (!el) return dflt;
    var v = parseFloat(el.value);
    return isFinite(v) ? v : dflt;
  }
  function setText(id, t) { var el = $(id); if (el) el.textContent = t; }
  function show(id, on) { var el = $(id); if (el) el.style.display = on ? 'block' : 'none'; }
  function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
  function td(node) { var c = doc.createElement('td'); c.appendChild(node); return c; }
  function input(type, cls, val) {
    var i = doc.createElement('input'); i.type = type; i.className = cls;
    if (val != null) i.value = val;
    if (type === 'number') i.step = 'any';
    return i;
  }
  function delBtn(fn) {
    var b = doc.createElement('button'); b.textContent = '删除';
    b.addEventListener('click', function () { fn(b); });
    return b;
  }
  function fail(e) { BP.ui.alert(e && e.message ? e.message : String(e), 'error'); }

  /* ---------------- 页签 ---------------- */
  function switchTab(name, btn) {
    BP.ui.$$('.tab-btn').forEach(function (t) { t.classList.remove('active'); });
    BP.ui.$$('.tab-page').forEach(function (t) { t.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    // 读屏器靠 aria-selected 判断当前页签，必须与视觉 active 同步
    BP.ui.$('.tab-btn').forEach(function (t) { t.setAttribute('aria-selected', t === btn ? 'true' : 'false'); });

    var p = $(name); if (p) p.classList.add('active');
  }
  function bindTabs() {
    BP.ui.$$('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab, b); });
    });
  }
  function switchUI() { global.location.href = 'index.html'; }

  /* ---------------- 相机（① await、② File） ---------------- */
  function openCamera() {
    var v = $('video');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      BP.ui.alert('浏览器不支持相机，请用相册选择'); return Promise.resolve();
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    }).then(function (stream) {
      cam.stream = stream;
      v.srcObject = stream;
      return v.play();
    }).then(function () {
      v.style.display = 'block';
      $('previewBox').style.display = 'none';
      $('cameraControls').style.display = 'block';
    }).catch(function (e) {
      BP.ui.alert('无法访问相机：' + e.message + '（需 https 且由用户手势触发）');
    });
  }

  function stopCamera() {
    if (cam.stream) {
      cam.stream.getTracks().forEach(function (t) { t.stop(); });
      cam.stream = null;
    }
    var v = $('video');
    if (v) { v.srcObject = null; v.style.display = 'none'; }
    $('previewBox').style.display = 'flex';
    $('cameraControls').style.display = 'none';
  }

  function captureFromVideoToFile(name) {
    return new Promise(function (resolve, reject) {
      var v = $('video');
      if (!v || !v.videoWidth) { reject(new Error('相机还没就绪')); return; }
      var c = doc.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      c.toBlob(function (b) { resolve(new global.File([b], name || 'capture.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', 0.95);
    });
  }

  function capturePhoto() {
    captureFromVideoToFile('capture-' + Date.now() + '.jpg').then(function (file) {
      cam.file = file;
      showPreview(file, '已拍摄 ' + Math.round(file.size / 1024) + ' KB · ' + file.name);
      BP.ui.alert('拍摄成功；P5 接入条纹提取后可直接分析', 'ok');
    }).catch(fail);
  }

  function showPreview(file, note) {
    var box = $('captureResult');
    BP.ui.clear(box);
    var url = global.URL && global.URL.createObjectURL ? global.URL.createObjectURL(file) : '';
    if (url) {
      var img = doc.createElement('img');
      img.src = url; img.style.maxWidth = '100%'; img.style.borderRadius = '8px';
      box.appendChild(img);
    }
    var p = el('p', 'is-dim', note || '');
    box.appendChild(p);
    show('captureResult', true);
  }

  function handleFile(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    cam.file = f;
    showPreview(f, '已选择 ' + Math.round(f.size / 1024) + ' KB · ' + f.name);
  }

  /* ---------------- 标定（式 24：k = L/N） ---------------- */
  function renderK() {
    var k = BP.store.loadK();
    var txt = k && isFinite(k.value) ? F.sci(k.value) + ' mm/px' : '未标定';
    setText('curK', txt);
    setText('currentK', txt + (k && k.source ? '（' + k.source + '）' : ''));
    var inp = $('cal_k');
    if (inp && k && isFinite(k.value)) inp.value = k.value;
  }

  function saveK() {
    try {
      var v = num('cal_k');
      if (!(v > 0)) throw new Error('k 必须为正数');
      BP.store.saveK(v, { source: 'manual' });
      renderK();
      BP.ui.alert('已保存 k = ' + F.sci(v) + ' mm/px', 'ok');
    } catch (e) { fail(e); }
  }

  function calcK() {
    try {
      var r = BP.physics.pixelScale({ L: num('cal_L'), N: num('cal_N') });
      BP.store.saveK(r.k, { L: num('cal_L'), N: num('cal_N'), source: 'L/N' });
      renderK();
      BP.ui.result($('calResult'), [
        { label: 'k = L / N', value: F.sci(r.k) + ' mm/px', cls: 'is-key' },
        { label: 'N 反算', value: F.num(num('cal_L') / r.k, 1) + ' px' }
      ]);
      show('calResult', true);
    } catch (e) { fail(e); }
  }

  function clearK() { BP.store.clearK(); renderK(); BP.ui.alert('已清除标定', 'info'); }

  /* 两点标定：在分划板照片上点两条刻线 */
  function loadReticle(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var img = new global.Image();
    img.onload = function () {
      ret.img = img; ret.pts = [];
      var cv = $('reticleCanvas');
      var maxW = 360, s = Math.min(1, maxW / img.width);
      ret.scale = s;
      cv.width = Math.round(img.width * s);
      cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      setText('retPix', '—');
      BP.ui.alert('请在图上点两条刻线', 'info');
    };
    img.onerror = function () { BP.ui.alert('图片读取失败'); };
    img.src = global.URL.createObjectURL(f);
  }

  function onReticleClick(ev) {
    if (!ret.img) { BP.ui.alert('请先选择分划板照片'); return; }
    var cv = $('reticleCanvas'), r = cv.getBoundingClientRect();
    var x = (ev.clientX - r.left) * cv.width / r.width;
    var y = (ev.clientY - r.top) * cv.height / r.height;
    if (ret.pts.length >= 2) ret.pts = [];
    ret.pts.push({ x: x, y: y });
    var ctx = cv.getContext('2d');
    ctx.drawImage(ret.img, 0, 0, cv.width, cv.height);
    ret.pts.forEach(function (p, i) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#ffd93d' : '#00d4ff'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), p.x + 6, p.y - 6);
    });
    if (ret.pts.length === 2) {
      ctx.strokeStyle = '#00ff88'; ctx.beginPath();
      ctx.moveTo(ret.pts[0].x, ret.pts[0].y); ctx.lineTo(ret.pts[1].x, ret.pts[1].y); ctx.stroke();
      var dImg = dist(ret.pts[0], ret.pts[1]) / ret.scale;
      setText('retPix', dImg.toFixed(1) + ' px（图像原始像素）');
    }
  }

  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  function calcReticle() {
    try {
      if (ret.pts.length !== 2) throw new Error('请先在图上点两条刻线');
      var N = dist(ret.pts[0], ret.pts[1]) / ret.scale;
      var r = BP.physics.pixelScale({ L: num('retL'), N: N });
      BP.store.saveK(r.k, { L: num('retL'), N: N, source: '两点标定' });
      renderK();
      BP.ui.result($('retResult'), [
        { label: '两点像素距离 N', value: F.px(N) + ' px' },
        { label: '实际间距 L', value: F.mm(num('retL')) + ' mm' },
        { label: 'k = L / N', value: F.sci(r.k) + ' mm/px', cls: 'is-key' }
      ]);
      show('retResult', true);
    } catch (e) { fail(e); }
  }

  /* ---------------- 波长表 ---------------- */
  function addRow(d, D) {
    var tb = $('dataTableBody');
    if (!tb) return;
    var tr = doc.createElement('tr');
    tr.appendChild(el('td', null, String(tb.children.length + 1)));
    tr.appendChild(td(input('number', 'm-d', d == null ? REPORT.d : d)));
    tr.appendChild(td(input('number', 'm-D', D == null ? REPORT.D : D)));
    tr.appendChild(td(input('number', 'm-dx', '')));
    var lamTd = el('td', 'm-lam', '—'); tr.appendChild(lamTd);
    tr.appendChild(td(delBtn(function (b) {
      var r = b.closest('tr'); if (r) r.parentNode.removeChild(r); renumber();
    })));
    tb.appendChild(tr);
  }
  function renumber() {
    var tb = $('dataTableBody');
    Array.prototype.forEach.call(tb.children, function (tr, i) { tr.firstChild.textContent = String(i + 1); });
  }
  function rows() {
    return BP.ui.$$('#dataTableBody tr').map(function (tr) {
      return {
        tr: tr,
        d: parseFloat(tr.querySelector('.m-d').value),
        D: parseFloat(tr.querySelector('.m-D').value),
        dx: parseFloat(tr.querySelector('.m-dx').value),
        lamTd: tr.querySelector('.m-lam')
      };
    });
  }

  function calcRow(r) {
    var k = BP.store.loadK();
    var kv = k && isFinite(k.value) ? k.value : num('param_k', null);
    if (!kv) throw new Error('还没标定 k，请先到"标定"页');
    var out = BP.physics.wavelengthBasic({ d: r.d, D: r.D, dxPx: r.dx, k: kv });
    if (r.lamTd) r.lamTd.textContent = F.lam(out.value);
    return out;
  }

  function calcAll() {
    try {
      var ok = 0, bad = 0;
      rows().forEach(function (r) {
        try { calcRow(r); ok++; } catch (e) { bad++; if (r.lamTd) r.lamTd.textContent = '—'; }
      });
      BP.ui.alert('已计算 ' + ok + ' 行' + (bad ? '，' + bad + ' 行失败（缺 k 或 Δx）' : ''), bad ? 'error' : 'ok');
    } catch (e) { fail(e); }
  }

  function exportData() {
    var k = BP.store.loadK();
    var data = rows().filter(function (r) { return isFinite(r.dx); }).map(function (r) {
      var lam = '';
      try { lam = calcRow(r).value.toFixed(3); } catch (e) { lam = ''; }
      return [r.d, r.D, r.dx, k && k.value ? k.value : '', lam];
    });
    if (!data.length) { BP.ui.alert('没有可导出的数据'); return; }
    var csv = BP.store.toCSV(['d(mm)', 'D(mm)', 'Δx(px)', 'k(mm/px)', 'λ(nm)'], data);
    BP.store.download('fresnel-mobile-' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv');
  }

  function deleteAllData() {
    var tb = $('dataTableBody');
    BP.ui.clear(tb);
    addRow();
    BP.ui.alert('已清空', 'info');
  }

  /* ---------------- A 类不确定度 ---------------- */
  function addUncInput(v) {
    var box = $('uncInputs');
    if (!box) return;
    box.appendChild(input('number', 'unc-value', v == null ? '' : v));
  }

  function calcUncertainty() {
    try {
      var vals = BP.ui.$$('#uncInputs .unc-value').map(function (i) { return parseFloat(i.value); })
        .filter(function (v) { return isFinite(v); });
      var a = BP.physics.typeA(vals);
      BP.ui.result($('uncResult'), [
        { label: 'n', value: String(a.n) },
        { label: '平均值', value: F.num(a.mean, 3) + ' nm', cls: 'is-key' },
        { label: '标准差 s', value: F.num(a.sd, 3) + ' nm' },
        { label: 'u_A = s/√n', value: F.num(a.uA, 3) + ' nm', cls: 'is-key' },
        { label: '相对值', value: F.pct(a.relUA) }
      ]);
      show('uncResult', true);
    } catch (e) { fail(e); }
  }

  /* ---------------- 多路径合成 ---------------- */
  function addCombineRow(name, val, unc) {
    var tb = $('combineBody');
    if (!tb) return;
    var tr = doc.createElement('tr');
    tr.appendChild(td(input('text', 'c-name', name || '')));
    tr.appendChild(td(input('number', 'c-val', val == null ? '' : val)));
    tr.appendChild(td(input('number', 'c-unc', unc == null ? '' : unc)));
    tr.appendChild(td(delBtn(function (b) {
      var r = b.closest('tr'); if (r) r.parentNode.removeChild(r);
    })));
    tb.appendChild(tr);
  }

  function fillReportPaths() {
    BP.ui.clear($('combineBody'));
    addCombineRow('比值法', 589.33, 0.61);
    addCombineRow('横向放大率法', 589.28, 0.84);
    addCombineRow('光线追迹法', 589.30, 0.78);
    BP.ui.alert('已填入表 5.2 的三条路径', 'ok');
  }

  function calcWeightedCombine() {
    try {
      var names = BP.ui.$$('#combineBody .c-name');
      var vals = BP.ui.$$('#combineBody .c-val');
      var uncs = BP.ui.$$('#combineBody .c-unc');
      var paths = [];
      vals.forEach(function (v, i) {
        var val = parseFloat(v.value), u = parseFloat(uncs[i] ? uncs[i].value : '');
        if (!isFinite(val)) return;
        paths.push({ name: (names[i] && names[i].value) || ('路径' + (i + 1)), value: val, uncertainty: u });
      });
      if (!paths.length) throw new Error('请填入至少一条路径');
      var bad = paths.filter(function (p) { return !(p.uncertainty > 0); });
      if (bad.length) throw new Error('「' + bad[0].name + '」缺不确定度（必须为正）');

      var c = BP.physics.weightedCombine(paths, { standard: 589.3, commonRelU: COMMON_REL_U });
      BP.ui.result($('combineResult'), [
        { label: '加权平均 λ̂', value: F.lamU(c.mean, c.uCombined), cls: 'is-key' },
        { label: '相对不确定度', value: F.rel(c.relU) },
        { label: 'χ² / ν', value: F.num(c.chi2, 4) + ' / ' + c.dof },
        { label: '判据 χ²₀.₉₅', value: F.num(c.chi2Crit, 3) },
        { label: '结论', value: BP.ui.badge(c.consistent) },
        { label: '与 589.3 nm 偏差', value: F.num(c.bias, 3) + ' nm（' + F.rel(c.relBias) + '）' }
      ]);
      show('combineResult', true);
    } catch (e) { fail(e); }
  }

  /* ---------------- record.json（只存原始量） ---------------- */
  function buildRecord() {
    var k = BP.store.loadK();
    var frames = rows().filter(function (r) { return isFinite(r.dx); })
      .map(function (r) { return { dxPx: r.dx }; });
    return {
      schema: BP.store.RECORD_SCHEMA,
      created: new Date().toISOString(),
      device: (global.navigator && navigator.userAgent ? navigator.userAgent.slice(0, 48) : 'unknown'),
      k: k && isFinite(k.value) ? { value: k.value, L: k.L, N: k.N, source: k.source } : null,
      frames: frames,
      params: {
        a: null, A: 1.0, nNa: REPORT.nNa, nRef: REPORT.nRef,
        D: num('param_D', REPORT.D), d: num('param_d', REPORT.d), b: 0.08, lamRef: 650
      }
    };
  }

  function exportRecord() {
    try {
      var rec = buildRecord();
      BP.store.saveRecord(rec);
      BP.store.exportRecord();
      show('recordResult', true);
      BP.ui.result($('recordResult'), [
        { label: '记录已导出', value: 'record-*.json', cls: 'is-key' },
        { label: '帧数', value: String(rec.frames.length) },
        { label: 'k', value: rec.k ? F.sci(rec.k.value) : '未标定', cls: rec.k ? '' : 'is-warn' }
      ]);
    } catch (e) { fail(e); }
  }

  function importRecord(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    BP.store.importRecord(f).then(function (rec) {
      var dEl = $('param_d'), DEl = $('param_D');
      if (dEl && rec.params && isFinite(rec.params.d)) dEl.value = rec.params.d;
      if (DEl && rec.params && isFinite(rec.params.D)) DEl.value = rec.params.D;
      if (rec.k && isFinite(rec.k.value)) {
        BP.store.saveK(rec.k.value, { L: rec.k.L, N: rec.k.N, source: rec.k.source || 'record' });
        renderK();
      }
      BP.ui.clear($('dataTableBody'));
      (rec.frames || []).forEach(function (fr) { addRow(null, null).querySelector('.m-dx').value = fr.dxPx; });
      if (!(rec.frames || []).length) addRow();
      show('recordResult', true);
      BP.ui.result($('recordResult'), [
        { label: '已导入记录', value: rec.created || '（无时间）' },
        { label: '帧数', value: String((rec.frames || []).length) },
        { label: 'k', value: rec.k && isFinite(rec.k.value) ? F.sci(rec.k.value) : '无', cls: 'is-key' }
      ]);
    }).catch(fail);
  }

  /* ---------------- 图像分析占位（P5） ---------------- */
  function analyzeImage() {
    if (!cam.file) { BP.ui.alert('请先拍照或选择图片'); return; }
    BP.ui.alert('条纹提取将在 P5 接入（physics.js 的 fringePeriod 已就绪）', 'info');
  }

  /* ---------------- 导出到全局 ---------------- */
  var API = {
    switchTab: switchTab, switchUI: switchUI,
    openCamera: openCamera, stopCamera: stopCamera, capturePhoto: capturePhoto, handleFile: handleFile,
    saveK: saveK, calcK: calcK, clearK: clearK,
    loadReticle: loadReticle, calcReticle: calcReticle, onReticleClick: onReticleClick,
    addRow: addRow, calcAll: calcAll, exportData: exportData, deleteAllData: deleteAllData,
    addUncInput: addUncInput, calcUncertainty: calcUncertainty,
    addCombineRow: addCombineRow, calcWeightedCombine: calcWeightedCombine, fillReportPaths: fillReportPaths,
    exportRecord: exportRecord, importRecord: importRecord, analyzeImage: analyzeImage
  };
  for (var k2 in API) if (Object.prototype.hasOwnProperty.call(API, k2)) global[k2] = API[k2];

  function init() {
    bindTabs();
    renderK();
    addRow(); addRow();
    addUncInput(); addUncInput(); addUncInput();
    addCombineRow(); addCombineRow();
    var cv = $('reticleCanvas');
    if (cv) cv.addEventListener('click', onReticleClick);
    var dv = $('video'); if (dv) dv.muted = true;
  }
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
  }

  BP.pages = BP.pages || {};
  BP.pages.mobile = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
