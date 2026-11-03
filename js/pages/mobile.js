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
             'sessionSelect', 'methodSelect', 'roleSelect', 'roleStatus',
             'roleSummary', 'frameGallery',
             'aeff_dx', 'aeff_dw', 'aeff_lambda', 'aeffResult',
             'cal_k', 'cal_L', 'cal_N', 'calResult',
             'reticleFile', 'reticleCanvas', 'retPix', 'retL', 'retResult', 'currentK',
             'dataTableBody', 'uncInputs', 'uncResult',
             'combineBody', 'combineResult', 'recordFile', 'recordResult'];

  var REPORT = { d: 0.90213, D: 1000, k: 0.0040, nNa: 1.5168, nRef: 1.5145 };
  // 三条路径共用同一批 Δx（报告 8.2）；表 8.1 的 u(Δx)/Δx
  var COMMON_REL_U = 6.4e-6;

  var cam = { stream: null, file: null };
  var ret = {
    img: null, scale: 1, pts: [], lines: [], spacingPx: 0,
    analysisScale: 1, detection: null
  };
  var METHOD_LABEL = {
    basic: '基本公式',
    ratio: '比值法',
    magnification: '横向放大率法',
    trace: '光线追迹法'
  };

  function num(id, dflt) {
    var el = $(id);
    if (!el) return dflt;
    var v = parseFloat(el.value);
    return isFinite(v) ? v : dflt;
  }
  function setText(id, t) { var el = $(id); if (el) el.textContent = t; }
  function show(id, on) { var el = $(id); if (el) el.style.display = on ? 'block' : 'none'; }
  function syncKToSession(k, meta) {
    var session = activeSession();
    if (!session || !S()) return;
    BP.sessions.updateSession(session.id, {
      calibration: {
        k_mm_px: k,
        source: (meta && meta.source) || 'manual',
        L_mm: meta && meta.L,
        N_px: meta && meta.N,
        at: new Date().toISOString()
      }
    });
  }
  function syncParamsToSession() {
    var session = activeSession();
    if (!session || !S()) return;
    BP.sessions.updateSession(session.id, {
      params: {
        d: num('param_d', REPORT.d),
        D: num('param_D', REPORT.D),
        a: 50,
        A: 1.0,
        nNa: REPORT.nNa,
        nRef: REPORT.nRef,
        b: 0.08,
        lamRef: 650
      }
    });
  }
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
    BP.ui.$$('.tab-btn').forEach(function (t) { t.setAttribute('aria-selected', t === btn ? 'true' : 'false'); });

    var p = $(name); if (p) p.classList.add('active');
  }
  function bindTabs() {
    BP.ui.$$('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab, b); });
    });
  }
  function switchUI() { global.location.href = 'index.html'; }

  /* ---------------- 方法优先：测量会话与角色 ---------------- */
  function S() { return BP.sessions; }
  function activeSession() { return S() && S().getActiveSession(); }
  function methodLabel(method) { return METHOD_LABEL[method] || method; }
  function sessionText(s) {
    return methodLabel(s.method) + ' · ' + (s.title || s.id) +
      ' · ' + String(s.created || '').replace('T', ' ').slice(0, 16);
  }

  function ensureSession() {
    var current = activeSession();
    if (current) return current;
    var method = $('methodSelect') ? $('methodSelect').value : 'ratio';
    return S().createSession({
      method: method,
      title: '现场采集'
    });
  }

  function renderSessions() {
    var sel = $('sessionSelect');
    if (!sel || !S()) return;
    var sessions = S().listSessions();
    var active = activeSession();
    BP.ui.clear(sel);
    sessions.forEach(function (s) {
      var option = doc.createElement('option');
      option.value = s.id;
      option.textContent = sessionText(s);
      if (active && active.id === s.id) option.selected = true;
      sel.appendChild(option);
    });
    if (active && $('methodSelect')) $('methodSelect').value = active.method;
  }

  function renderRoleOptions() {
    var sel = $('roleSelect');
    if (!sel || !S()) return;
    var session = activeSession();
    var method = session ? session.method : ($('methodSelect') ? $('methodSelect').value : 'ratio');
    var roles = S().requiredRoles(method).concat(['calibration']);
    var previous = sel.value;
    BP.ui.clear(sel);
    roles.forEach(function (role) {
      var option = doc.createElement('option');
      option.value = role;
      option.textContent = S().ROLE_LABEL[role] || role;
      sel.appendChild(option);
    });
    if (roles.indexOf(previous) >= 0) sel.value = previous;
  }

  function renderRoleStatus() {
    var host = $('roleStatus');
    var session = activeSession();
    if (!host || !session || !S()) return;
    BP.ui.clear(host);
    var roles = S().requiredRoles(session.method);
    roles.forEach(function (role) {
      var stat = S().roleStats(session.id, role);
      var chip = el('span', 'role-chip ' + (stat.n ? 'is-done' : 'is-missing'));
      chip.textContent = stat.label + '：' + stat.n + ' 帧';
      host.appendChild(chip);
    });
    if (session.method === 'trace') {
      var trace = el('span', 'role-chip is-done',
        'MATLAB 严格追迹 d=' + S().TRACE_PRESET.d_mm.toFixed(5) + ' mm');
      host.appendChild(trace);
    }
  }

  function renderRoleSummary() {
    var host = $('roleSummary');
    var session = activeSession();
    var role = $('roleSelect') ? $('roleSelect').value : 'sodium';
    if (!host || !session || !S()) return;
    var stat = S().roleStats(session.id, role);
    if (!stat.n) {
      show('roleSummary', false);
      return;
    }
    BP.ui.result(host, [
      { label: '角色', value: stat.label, cls: 'is-key' },
      { label: '启用帧数', value: String(stat.n) },
      { label: 'Δx 均值', value: isFinite(stat.meanPx) ? F.px(stat.meanPx) + ' px' : '—' },
      { label: 'Δx 标准差', value: isFinite(stat.sdPx) ? F.px(stat.sdPx) + ' px' : '—（单帧）' }
    ], { caption: sessionText(session) });
    show('roleSummary', true);
  }

  function renderFrameGallery() {
    var host = $('frameGallery');
    var session = activeSession();
    var role = $('roleSelect') ? $('roleSelect').value : 'sodium';
    if (!host || !session || !S()) return;
    BP.ui.clear(host);
    var frames = S().listFrames(session.id, role);
    if (!frames.length) {
      host.appendChild(el('p', 'is-dim', '当前角色还没有照片。拍照后会追加到这里，不会覆盖旧照片。'));
      return;
    }
    frames.forEach(function (frame, index) {
      var card = el('div', 'frame-card' + (frame.excluded ? ' is-excluded' : ''));
      var img = doc.createElement('img');
      img.alt = 'frame ' + (index + 1);
      card.appendChild(img);
      S().getFrameBlob(frame.imageKey).then(function (blob) {
        if (blob) img.src = global.URL.createObjectURL(blob);
      }).catch(function () {});
      var meta = el('div', 'frame-meta',
        '#' + (index + 1) + ' · ' +
        (isFinite(frame.deltaXPx) ? frame.deltaXPx.toFixed(1) + ' px' : '未识别'));
      card.appendChild(meta);
      var actions = el('div', 'frame-actions');
      var toggle = el('button', 'btn-mini', frame.excluded ? '启用' : '排除');
      toggle.addEventListener('click', function () {
        S().setFrameExcluded(session.id, frame.id, !frame.excluded);
        renderAllSessionUI();
      });
      var remove = el('button', 'btn-mini btn-danger', '删除');
      remove.addEventListener('click', function () {
        S().removeFrame(session.id, frame.id).then(renderAllSessionUI).catch(fail);
      });
      actions.appendChild(toggle);
      actions.appendChild(remove);
      card.appendChild(actions);
      host.appendChild(card);
    });
  }

  function renderAllSessionUI() {
    renderSessions();
    renderRoleOptions();
    renderRoleStatus();
    renderRoleSummary();
    renderFrameGallery();
  }

  function createSessionFromUI() {
    try {
      var method = $('methodSelect') ? $('methodSelect').value : 'ratio';
      S().createSession({
        method: method,
        title: '现场采集'
      });
      renderAllSessionUI();
      BP.ui.alert('已新建' + methodLabel(method) + '会话', 'ok');
    } catch (e) { fail(e); }
  }

  function onSessionChange() {
    var sel = $('sessionSelect');
    if (!sel) return;
    S().setActiveSession(sel.value);
    renderAllSessionUI();
  }

  function onRoleChange() {
    renderRoleSummary();
    renderFrameGallery();
  }

  function addCapturedFile(file) {
    var session = ensureSession();
    syncParamsToSession();
    var role = $('roleSelect') ? $('roleSelect').value : 'sodium';
    var k = BP.store.loadK();
    var kv = k && isFinite(k.value) && k.value > 0 ? k.value : 0.004;
    BP.ui.loading(true);
    var analysisPromise = BP.fringe && BP.fringe.analyzeFile
      ? BP.fringe.analyzeFile(file, { k: kv })
      : Promise.reject(new Error('条纹识别模块未加载'));
    return analysisPromise.then(function (r) {
      return S().addFrame(session.id, {
        role: role,
        blob: file,
        name: file.name,
        size: file.size,
        deltaXPx: r.periodPx,
        deltaXmm: r.deltaXmm,
        quality: r.visibility,
        analysis: {
          axis: r.axis,
          visibility: r.visibility,
          periodPxCross: r.periodPxCross,
          stripeAngleDeg: r.stripeAngleDeg,
          roi: r.roi,
          signal: r.signal,
          spectralSnr: r.spectralSnr,
          acfPeak: r.acfPeak
        }
      }).then(function (frame) {
        cam.file = file;
        var dev = r.axis === 'x'
          ? Math.abs(r.stripeAngleDeg - 90)
          : (r.axis === 'y' ? Math.min(r.stripeAngleDeg, 180 - r.stripeAngleDeg) : NaN);
        showPreview(file,
          '已加入 ' + (S().ROLE_LABEL[role] || role) +
          ' · Δx=' + r.periodPx.toFixed(2) + ' px ' +
          '(' + r.deltaXmm.toFixed(4) + ' mm)' +
          ' · ' + (r.axis === 'oblique' ? '斜条纹 ' + r.stripeAngleDeg.toFixed(1) + '°'
                                          : '倾角 ' + dev.toFixed(1) + '°'));
        renderAllSessionUI();
        return frame;
      });
    }).catch(function (e) {
      return S().addFrame(session.id, {
        role: role,
        blob: file,
        name: file.name,
        size: file.size,
        analysisError: e.message
      }).then(function () {
        showPreview(file, '已保存，但识别失败：' + e.message);
        renderAllSessionUI();
      });
    }).then(function () {
      BP.ui.loading(false);
    }, function (e) {
      BP.ui.loading(false);
      fail(e);
    });
  }

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
      return addCapturedFile(file);
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
    addCapturedFile(f);
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
      syncKToSession(v, { source: 'manual' });
      renderK();
      BP.ui.alert('已保存 k = ' + F.sci(v) + ' mm/px', 'ok');
    } catch (e) { fail(e); }
  }

  function calcK() {
    try {
      var r = BP.physics.pixelScale({ L: num('cal_L'), N: num('cal_N') });
      BP.store.saveK(r.k, { L: num('cal_L'), N: num('cal_N'), source: 'L/N' });
      syncKToSession(r.k, { L: num('cal_L'), N: num('cal_N'), source: 'L/N' });
      renderK();
      BP.ui.result($('calResult'), [
        { label: 'k = L / N', value: F.sci(r.k) + ' mm/px', cls: 'is-key' },
        { label: 'N 反算', value: F.num(num('cal_L') / r.k, 1) + ' px' }
      ]);
      show('calResult', true);
    } catch (e) { fail(e); }
  }

  function clearK() { BP.store.clearK(); renderK(); BP.ui.alert('已清除标定', 'info'); }

  /* ---------------- 分划板标定 ----------------
   * 自动识别优先利用多条等距竖线；手点仅作兜底，并只取水平差，避免高度差污染 N。
   */
  function reticlePercentile(gray, sampleStep) {
    var hist = new Uint32Array(256), total = 0, i, v;
    for (i = 0; i < gray.length; i += sampleStep) {
      v = gray[i];
      v = v < 0 ? 0 : (v > 255 ? 255 : Math.round(v));
      hist[v]++; total++;
    }
    function at(q) {
      var want = Math.max(1, Math.round(total * q)), acc = 0;
      for (var k = 0; k < hist.length; k++) {
        acc += hist[k];
        if (acc >= want) return k;
      }
      return 255;
    }
    return { p40: at(0.40), p95: at(0.95), at: at };
  }

  function reticlePeakAt(profile, x, radius) {
    var from = Math.max(0, x - radius), to = Math.min(profile.length - 1, x + radius);
    for (var i = from; i <= to; i++) {
      if (i !== x && profile[i] > profile[x] + 1e-9) return false;
      if (i < x && profile[i] === profile[x]) return false;
    }
    return true;
  }

  function reticleMedian(values) {
    if (!values.length) return 0;
    var a = values.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /* 纯函数：RGBA 图像 → 分划板刻线坐标（分析图坐标）。
   * 先做水平局部背景残差，保留窄暗竖线；再找等间距峰值序列，抑制宽干涉条纹。
   */
  function detectReticleLines(data, width, height, opts) {
    opts = opts || {};
    if (!data || !(width > 20) || !(height > 20) || data.length < width * height * 4) {
      return { lines: [], spacingPx: NaN, count: 0, error: '图像数据无效' };
    }

    var n = width * height;
    var gray = new Float32Array(n);
    var i, x, y, p;
    for (i = 0; i < n; i++) {
      p = i * 4;
      gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }

    // 用亮度分布圈出有效视场，避免把四周纯黑背景算进刻线评分。
    var pct = reticlePercentile(gray, Math.max(1, Math.floor(n / 50000)));
    var fieldThreshold = pct.p40 + 0.35 * Math.max(1, pct.p95 - pct.p40);
    var rowCount = new Uint32Array(height), colCount = new Uint32Array(width);
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        if (gray[y * width + x] > fieldThreshold) {
          rowCount[y]++;
          colCount[x]++;
        }
      }
    }
    function bounds(counts, minCount) {
      var first = -1, last = -1;
      for (var q = 0; q < counts.length; q++) {
        if (counts[q] >= minCount) {
          if (first < 0) first = q;
          last = q;
        }
      }
      return first < 0 ? null : { start: first, end: last };
    }
    var rb = bounds(rowCount, Math.max(6, width * 0.08));
    var cb = bounds(colCount, Math.max(6, height * 0.08));
    var fx0 = cb ? cb.start : Math.round(width * 0.05);
    var fx1 = cb ? cb.end : Math.round(width * 0.95);
    var fy0 = rb ? rb.start : Math.round(height * 0.08);
    var fy1 = rb ? rb.end : Math.round(height * 0.62);
    var fieldH = Math.max(1, fy1 - fy0);
    var y0 = Math.max(1, Math.round(fy0 + fieldH * 0.08));
    var y1 = Math.min(height - 2, Math.round(fy0 + fieldH * 0.58));
    var x0 = Math.max(2, fx0);
    var x1 = Math.min(width - 3, fx1);
    if (y1 - y0 < 30 || x1 - x0 < 60) {
      return { lines: [], spacingPx: NaN, count: 0, error: '有效视场过小' };
    }

    var radius = Math.max(6, Math.min(20, Math.round(width * 0.012)));
    var yStep = Math.max(1, Math.round(height / 700));
    var rowIds = [];
    for (y = y0; y <= y1; y += yStep) rowIds.push(y);
    var rows = rowIds.length;
    var residual = new Float32Array(width * rows);
    var prefix = new Float32Array(width + 1);
    var rowDark = new Float32Array(width);

    for (var ri = 0; ri < rows; ri++) {
      y = rowIds[ri];
      var base = y * width;
      rowDark.fill(0);
      prefix[0] = 0;
      for (x = 0; x < width; x++) prefix[x + 1] = prefix[x] + gray[base + x];
      for (x = x0; x <= x1; x++) {
        var left = Math.max(0, x - radius), right = Math.min(width - 1, x + radius);
        var localMean = (prefix[right + 1] - prefix[left]) / (right - left + 1);
        var dark = localMean - gray[base + x];
        rowDark[x] = dark > 0 ? dark : 0;
      }
      // 轻微倾斜的刻线在相邻列也保留响应，提升手机拍摄容错。
      for (x = x0; x <= x1; x++) {
        var q = ri * width + x;
        var ql = x > 0 ? rowDark[x - 1] : 0;
        var qr = x + 1 < width ? rowDark[x + 1] : 0;
        residual[q] = Math.max(rowDark[x], ql, qr);
      }
    }

    var profile = new Float32Array(width);
    var meanProfile = new Float32Array(width);
    for (x = x0; x <= x1; x++) {
      var maxAtX = 0, rr;
      for (rr = 0; rr < rows; rr++) maxAtX = Math.max(maxAtX, residual[rr * width + x]);
      var runThreshold = Math.max(0.75, maxAtX * 0.22);
      var bestLen = 0, curLen = 0, bestSum = 0, curSum = 0;
      for (rr = 0; rr < rows; rr++) {
        var valAt = residual[rr * width + x];
        if (valAt >= runThreshold) {
          curLen++; curSum += valAt;
          if (curLen > bestLen) { bestLen = curLen; bestSum = curSum; }
        } else {
          curLen = 0; curSum = 0;
        }
      }
      if (bestLen) {
        meanProfile[x] = bestSum / bestLen;
        profile[x] = meanProfile[x] * Math.sqrt(bestLen);
      }
    }
    var smooth = new Float32Array(width);
    var smoothRadius = 3;
    for (x = x0; x <= x1; x++) {
      var sum = 0, cnt = 0;
      for (var sx = Math.max(x0, x - smoothRadius); sx <= Math.min(x1, x + smoothRadius); sx++) {
        sum += profile[sx]; cnt++;
      }
      smooth[x] = sum / cnt;
    }
    profile = smooth;

    var maxProfile = 0, maxMean = 0;
    for (x = x0; x <= x1; x++) {
      maxProfile = Math.max(maxProfile, profile[x]);
      maxMean = Math.max(maxMean, meanProfile[x]);
    }
    if (maxMean < 3.5) return { lines: [], spacingPx: NaN, count: 0, error: '刻线对比度不足' };

    var peakRadius = Math.max(2, Math.round(width * 0.005));
    var promRadius = Math.max(10, Math.round(width * 0.04));
    var minProm = Math.max(0.25, maxProfile * 0.025);
    var minScore = Math.max(0.75, maxProfile * 0.20);
    var peaks = [];
    for (x = x0 + peakRadius; x <= x1 - peakRadius; x++) {
      if (profile[x] < minScore || !reticlePeakAt(profile, x, peakRadius)) continue;
      var lo = Math.max(x0, x - promRadius), hi = Math.min(x1, x + promRadius);
      var localMin = profile[x];
      for (var px = lo; px <= hi; px++) localMin = Math.min(localMin, profile[px]);
      var prom = profile[x] - localMin;
      if (prom >= minProm) peaks.push({ x: x, score: profile[x], prom: prom });
    }
    if (peaks.length < 3) {
      return {
        lines: [], spacingPx: NaN, count: 0, error: '候选刻线不足',
        debug: { maxProfile: maxProfile, peakCount: peaks.length, y0: y0, y1: y1,
                 x0: x0, x1: x1, fieldThreshold: fieldThreshold,
                 peaks: peaks.slice(0, 20).map(function (q4) { return q4.x; }) }
      };
    }
    var minS = Math.max(12, width * 0.045);
    var maxS = width * 0.28;
    var best = null;
    var maxLines = 8;
    function consider(a, b, gap) {
      if (!(b.x > a.x)) return;
      var S = (b.x - a.x) / gap;
      if (!(S >= minS && S <= maxS)) return;
      var tol = Math.max(2.5, S * 0.04);
      var assigned = [];
      for (var k = -8; k <= 8; k++) {
        var want = a.x + k * S;
        if (want < x0 || want > x1) continue;
        var nearest = null, nearestErr = Infinity;
        for (var j = 0; j < peaks.length; j++) {
          var e = Math.abs(peaks[j].x - want);
          if (e < nearestErr) { nearestErr = e; nearest = peaks[j]; }
        }
        if (nearest && nearestErr <= tol) {
          assigned.push({ line: nearest, idx: k, err: nearestErr });
        }
      }
      if (assigned.length < 3 || assigned.length > maxLines) return;
      assigned.sort(function (u, v) { return u.idx - v.idx; });
      var qsum = 0, errsum = 0;
      assigned.forEach(function (a1) {
        qsum += Math.pow(a1.line.score, 1.5);
        errsum += a1.err;
      });
      var score = qsum * (1 + 0.12 * (assigned.length - 3)) - errsum * 0.35;
      if (!best || score > best.score) best = { score: score, step: S, assigned: assigned };
    }
    for (i = 0; i < peaks.length; i++) {
      for (var j2 = i + 1; j2 < peaks.length; j2++) {
        for (var gap = 1; gap <= 4; gap++) consider(peaks[i], peaks[j2], gap);
      }
    }
    if (!best) return { lines: [], spacingPx: NaN, count: 0, error: '未找到等距刻线' };

    // 对命中的刻线做线性拟合，缺失一条时仍能得到单格间距。
    var assigned = best.assigned;
    var meanK = 0, meanX = 0;
    assigned.forEach(function (q1) { meanK += q1.idx; meanX += q1.line.x; });
    meanK /= assigned.length; meanX /= assigned.length;
    var num = 0, den = 0;
    assigned.forEach(function (q2) {
      num += (q2.idx - meanK) * (q2.line.x - meanX);
      den += (q2.idx - meanK) * (q2.idx - meanK);
    });
    var step = den > 0 ? num / den : best.step;
    var rms = 0;
    var lines = assigned.map(function (q3) {
      var err = q3.line.x - (meanX + step * (q3.idx - meanK));
      rms += err * err;
      return q3.line.x;
    });
    rms = Math.sqrt(rms / lines.length);
    var consistency = rms / Math.max(1, step);
    if (consistency > 0.035) {
      return { lines: [], spacingPx: NaN, count: 0, error: '刻线间距一致性不足' };
    }
    return {
      lines: lines,
      spacingPx: step,
      count: lines.length,
      scores: assigned.map(function (q6) { return q6.line.score; }),
      consistency: consistency,
      score: best.score,
      y0: y0,
      y1: y1,
      width: width,
      height: height
    };
  }

  function manualReticlePixels(a, b, scale) {
    scale = scale > 0 ? scale : 1;
    return Math.abs(a.x - b.x) / scale;
  }

  function drawReticle() {
    var cv = $('reticleCanvas');
    if (!cv || !ret.img) return;
    var ctx = cv.getContext('2d');
    ctx.drawImage(ret.img, 0, 0, cv.width, cv.height);
    if (ret.lines.length >= 3 && ret.detection) {
      var y0 = ret.detection.y0 / ret.analysisScale * ret.scale;
      var y1 = ret.detection.y1 / ret.analysisScale * ret.scale;
      ret.lines.forEach(function (x, i) {
        var dx = x * ret.scale;
        ctx.strokeStyle = 'rgba(0,255,136,0.95)';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(dx, y0); ctx.lineTo(dx, y1); ctx.stroke();
        ctx.fillStyle = '#00ff88';
        ctx.fillText(String(i + 1), dx + 3, Math.max(12, y0 - 4));
      });
    }
    ret.pts.forEach(function (p, i) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#ffd93d' : '#00d4ff'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), p.x + 6, p.y - 6);
    });
    if (ret.pts.length === 2) {
      ctx.strokeStyle = '#00ff88'; ctx.beginPath();
      ctx.moveTo(ret.pts[0].x, ret.pts[0].y); ctx.lineTo(ret.pts[1].x, ret.pts[1].y); ctx.stroke();
    }
  }

  function detectReticle() {
    if (!ret.img) { BP.ui.alert('请先选择分划板照片'); return; }
    try {
      var maxW = 1080, s = Math.min(1, maxW / ret.img.width);
      var c = doc.createElement('canvas');
      c.width = Math.round(ret.img.width * s);
      c.height = Math.round(ret.img.height * s);
      var ctx = c.getContext('2d');
      ctx.drawImage(ret.img, 0, 0, c.width, c.height);
      var imageData = ctx.getImageData(0, 0, c.width, c.height);
      var r = detectReticleLines(imageData.data, c.width, c.height);
      if (!r || r.count < 3) throw new Error((r && r.error) || '自动识别失败');
      ret.analysisScale = s;
      ret.detection = r;
      ret.lines = r.lines.map(function (x) { return x / s; });
      ret.spacingPx = r.spacingPx / s;
      ret.pts = [];
      drawReticle();
      setText('retPix', '自动识别 ' + r.count + ' 条 · 相邻 ' + ret.spacingPx.toFixed(1) + ' px');
      BP.ui.alert('已识别 ' + r.count + ' 条等距刻线，请确认绿线位置', 'ok');
    } catch (e) {
      ret.lines = []; ret.spacingPx = 0; ret.detection = null;
      drawReticle();
      setText('retPix', '自动识别失败：' + e.message);
      BP.ui.alert(e.message + '，可在图上点两条刻线兜底', 'error');
    }
  }

  /* 读取分划板照片并优先自动识别刻线 */
  function loadReticle(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var img = new global.Image();
    img.onload = function () {
      ret.img = img; ret.pts = []; ret.lines = []; ret.spacingPx = 0; ret.detection = null;
      var cv = $('reticleCanvas');
      var maxW = 360, s = Math.min(1, maxW / img.width);
      ret.scale = s;
      cv.width = Math.round(img.width * s);
      cv.height = Math.round(img.height * s);
      drawReticle();
      setText('retPix', '正在自动识别刻线…');
      global.setTimeout(detectReticle, 0);
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
    if (!ret.pts.length) {
      ret.lines = []; ret.spacingPx = 0; ret.detection = null;
    }
    ret.pts.push({ x: x, y: y });
    drawReticle();
    if (ret.pts.length === 2) {
      var dImg = manualReticlePixels(ret.pts[0], ret.pts[1], ret.scale);
      setText('retPix', dImg.toFixed(1) + ' px（水平差，图像原始像素）');
    }
  }

  function calcReticle() {
    try {
      var N, source, nLabel;
      if (ret.lines.length >= 3 && ret.spacingPx > 0) {
        N = ret.spacingPx;
        source = '自动刻线标定';
        nLabel = '相邻刻线间距 N';
      } else if (ret.pts.length === 2) {
        N = manualReticlePixels(ret.pts[0], ret.pts[1], ret.scale);
        source = '两点水平标定';
        nLabel = '两点水平像素差 N';
      } else {
        throw new Error('请等待自动识别，或手点两条刻线');
      }
      var r = BP.physics.pixelScale({ L: num('retL'), N: N });
      BP.store.saveK(r.k, { L: num('retL'), N: N, source: source });
      syncKToSession(r.k, { L: num('retL'), N: N, source: source });
      renderK();
      BP.ui.result($('retResult'), [
        { label: nLabel, value: F.px(N) + ' px' },
        { label: '相邻刻线实际间距 L', value: F.mm(num('retL')) + ' mm' },
        { label: '标定方式', value: source },
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
      syncParamsToSession();
      var rec = BP.sessions && BP.sessions.listSessions().length
        ? BP.sessions.exportRecord()
        : buildRecord();
      rec.legacy = buildRecord();
      BP.store.download(
        'record-' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify(rec, null, 2),
        'application/json'
      );
      var frameCount = rec.schema === 'bp.record/2'
        ? (rec.sessions || []).reduce(function (sum, s) {
            return sum + ((s.frames || []).length);
          }, 0)
        : (rec.frames || []).length;
      var active = activeSession();
      var kValue = active && active.calibration && isFinite(active.calibration.k_mm_px)
        ? active.calibration.k_mm_px
        : (rec.k && rec.k.value);
      show('recordResult', true);
      BP.ui.result($('recordResult'), [
        { label: '记录已导出', value: rec.schema, cls: 'is-key' },
        { label: '帧数', value: String(frameCount) },
        { label: 'k', value: isFinite(kValue) ? F.sci(kValue) : '未标定', cls: isFinite(kValue) ? '' : 'is-warn' }
      ]);
    } catch (e) { fail(e); }
  }

  function importRecord(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    BP.store.importRecord(f).then(function (rec) {
      if (rec.schema === 'bp.record/2' && BP.sessions) {
        BP.sessions.importRecord(rec);
        renderAllSessionUI();
        show('recordResult', true);
        BP.ui.result($('recordResult'), [
          { label: '已导入记录', value: 'bp.record/2', cls: 'is-key' },
          { label: '会话数', value: String((rec.sessions || []).length) }
        ]);
        return;
      }
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

  function calcAeff() {
    try {
      if (!BP.nbk7) throw new Error('N-BK7 色散模块未加载');
      var r = BP.nbk7.effectivePrismAngle({
        deltaXmm: num('aeff_dx'),
        deltaWmm: num('aeff_dw'),
        lambdaNm: num('aeff_lambda', 589.3)
      });
      BP.ui.result($('aeffResult'), [
        { label: '最大偏折角 β', value: F.num(r.betaDeg, 5) + '°', cls: 'is-key' },
        { label: 'N-BK7 n(λ)', value: F.num(r.n, 8) },
        { label: '等效棱镜角 A_eff', value: F.num(r.aEffDeg, 5) + '°', cls: 'is-key' },
        { label: '来源', value: '由偏折角反演 · N-BK7 色散 · 非分光计直接测角' },
        { label: '公式', value: r.formula }
      ], { caption: 'tan β = -2Δx/Δw' });
      show('aeffResult', true);
    } catch (e) { fail(e); }
  }

  /* ---------------- 导出到全局 ---------------- */
  var API = {
    switchTab: switchTab, switchUI: switchUI,
    openCamera: openCamera, stopCamera: stopCamera, capturePhoto: capturePhoto, handleFile: handleFile,
    saveK: saveK, calcK: calcK, clearK: clearK,
    loadReticle: loadReticle, detectReticle: detectReticle, calcReticle: calcReticle, onReticleClick: onReticleClick,
    detectReticleLines: detectReticleLines, manualReticlePixels: manualReticlePixels,
    addRow: addRow, calcAll: calcAll, exportData: exportData, deleteAllData: deleteAllData,
    addUncInput: addUncInput, calcUncertainty: calcUncertainty,
    addCombineRow: addCombineRow, calcWeightedCombine: calcWeightedCombine, fillReportPaths: fillReportPaths,
    exportRecord: exportRecord, importRecord: importRecord, analyzeImage: analyzeImage,
    createSessionFromUI: createSessionFromUI, calcAeff: calcAeff
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
    if (BP.sessions && !BP.sessions.listSessions().length) {
      BP.sessions.createSession({ method: 'ratio', title: '现场采集' });
    }
    renderAllSessionUI();
    var sessionSelect = $('sessionSelect');
    if (sessionSelect) sessionSelect.addEventListener('change', onSessionChange);
    var roleSelect = $('roleSelect');
    if (roleSelect) roleSelect.addEventListener('change', onRoleChange);
    var methodSelect = $('methodSelect');
    if (methodSelect) methodSelect.addEventListener('change', renderRoleOptions);
  }
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
  }

  BP.pages = BP.pages || {};
  BP.pages.mobile = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
