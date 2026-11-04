/* =========================================================================
 * pages/pc-video.js —— 手机实时推流、自动抽帧与最佳帧确认
 * 依赖：core/sessions.js, core/fringe.js, core/video-sampler.js,
 *       vendor/peerjs.min.js, vendor/qrcode.min.js
 * ========================================================================= */
(function (global) {
  'use strict';

  var BP = global.BP;
  if (!BP || !BP.ui || !BP.sessions || !BP.videoSampler) return;

  var $ = BP.ui.$;
  var doc = global.document;
  var peer = null;
  var call = null;
  var remoteStream = null;
  var candidates = [];
  var analysisTimer = null;
  var analysisBusy = false;
  var analysisGeneration = 0;
  var enoughAnnounced = false;
  var currentSecret = '';
  var audioContext = null;
  var recorderHandle = null;
  var recordingStarting = false;
  var recordingGeneration = 0;
  var closingConnection = false;
  var importingVideo = false;
  var workCanvas = doc.createElement('canvas');
  var frameCanvas = doc.createElement('canvas');
  var API;

  function setStatus(text, state) {
    var host = $('videoLiveStatus');
    if (!host) return;
    host.textContent = text || '';
    host.classList.toggle('is-error', state === 'error');
    host.classList.toggle('is-ready', state === 'ready');
  }

  function setBadge(text, state) {
    var badge = $('videoConnectionBadge');
    if (!badge) return;
    badge.textContent = text;
    badge.classList.toggle('is-live', state === 'live');
    badge.classList.toggle('is-error', state === 'error');
  }

  function currentConfig() {
    return {
      method: $('videoMethodSelect').value,
      role: $('videoRoleSelect').value,
      target: Number($('videoTargetSelect').value) || 20
    };
  }

  function currentK() {
    var saved = BP.store && BP.store.loadK ? BP.store.loadK() : null;
    if (saved && isFinite(saved.value) && Number(saved.value) > 0) return Number(saved.value);
    var input = $('pixel_size');
    var value = input ? parseFloat(input.value) : NaN;
    return input && input.dataset.sessionManual === '1' && isFinite(value) && value > 0
      ? value : NaN;
  }

  function populateRoles() {
    var select = $('videoRoleSelect');
    if (!select) return;
    var previous = select.value;
    var roles = BP.sessions.requiredRoles($('videoMethodSelect').value);
    select.textContent = '';
    roles.forEach(function (role) {
      var option = doc.createElement('option');
      option.value = role;
      option.textContent = BP.sessions.ROLE_LABEL[role] || role;
      select.appendChild(option);
    });
    if (roles.indexOf(previous) >= 0) select.value = previous;
  }

  function randomToken(bytes) {
    var data = new Uint8Array(bytes);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(data);
    } else {
      for (var i = 0; i < data.length; i++) data[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(data).map(function (value) {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  function ensureAudio() {
    try {
      var AudioCtor = global.AudioContext || global.webkitAudioContext;
      if (!AudioCtor) return null;
      if (!audioContext) audioContext = new AudioCtor();
      if (audioContext.state === 'suspended') audioContext.resume();
      return audioContext;
    } catch (e) {
      return null;
    }
  }

  function playReadyTone() {
    var context = ensureAudio();
    if (!context) return;
    try {
      var osc = context.createOscillator();
      var gain = context.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.28);
      osc.connect(gain).connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + 0.28);
    } catch (e) { /* 声音提示失败时保留页面状态提示 */ }
  }

  function showQr(url) {
    var host = $('videoQrBox');
    host.textContent = '';
    if (!global.QRCode) {
      host.textContent = '二维码组件未加载，请刷新页面';
      return;
    }
    var level = global.QRCode.CorrectLevel ? global.QRCode.CorrectLevel.H : 2;
    new global.QRCode(host, {
      text: url,
      width: 236,
      height: 236,
      correctLevel: level
    });
    var hint = doc.createElement('span');
    hint.textContent = '手机扫描后点一次“开启摄像头并连接”';
    host.appendChild(hint);
  }

  function clearQr(message) {
    var host = $('videoQrBox');
    if (!host) return;
    host.textContent = '';
    var title = doc.createElement('strong');
    title.textContent = '手机扫码推流';
    var hint = doc.createElement('span');
    hint.textContent = message || '先选择测量方法和图像角色';
    host.append(title, hint);
  }

  function ensureSession(method) {
    var active = BP.sessions.getActiveSession();
    if (active && active.method === method) return active;
    return BP.sessions.createSession({
      method: method,
      title: '视频采集 ' + new Date().toLocaleString()
    });
  }

  function countSaturation(data) {
    var count = 0;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i] >= 252 && data[i + 1] >= 252) count++;
    }
    return count;
  }

  function rejectReason(item) {
    if (!isFinite(item.deltaXPx) || item.deltaXPx <= 0) return '条纹周期不合格';
    if (item.saturationRatio > BP.videoSampler.DEFAULTS.maxSaturation) return '黄色条纹过曝，请降低手机曝光';
    if (item.visibility < BP.videoSampler.DEFAULTS.minVisibility) return '条纹可见度不足，请调整对焦或视场';
    if (item.spectralSnr < BP.videoSampler.DEFAULTS.minSnr) return '频谱峰太弱，请避开反光并居中条纹';
    if (item.acfPeak < BP.videoSampler.DEFAULTS.minAcf) return '条纹周期性不足';
    if (item.crossDiff > BP.videoSampler.DEFAULTS.maxCrossDiff) return '两种周期算法差异过大';
    return '当前帧未达到采集门限';
  }

  function compactAnalysis(result) {
    return {
      axis: result.axis,
      directionDeg: result.directionDeg,
      stripeAngleDeg: result.stripeAngleDeg,
      roi: result.roi,
      signal: result.signal,
      visibility: result.visibility,
      periodPxCross: result.periodPxCross,
      spectralSnr: result.spectralSnr,
      acfPeak: result.acfPeak
    };
  }

  function revokePreview(item) {
    if (item && item.previewUrl) {
      global.URL.revokeObjectURL(item.previewUrl);
      item.previewUrl = '';
    }
  }

  function clearCandidates() {
    candidates.forEach(revokePreview);
    candidates = [];
    enoughAnnounced = false;
    analysisGeneration += 1;
    renderCandidates();
  }

  function selectedSet() {
    var target = currentConfig().target;
    return BP.videoSampler.selectCandidates(candidates, {
      minGapMs: BP.videoSampler.DEFAULTS.minGapMs,
      maxCandidates: target
    }).slice(0, target);
  }

  function renderCandidates() {
    var host = $('videoCandidateGallery');
    var statsHost = $('videoCandidateStats');
    if (!host || !statsHost) return;
    host.textContent = '';
    var config = currentConfig();
    var stablePicked = selectedSet();
    var selectedIds = new Set(stablePicked.map(function (item) { return item.id; }));

    if (!candidates.length) {
      var empty = doc.createElement('div');
      empty.className = 'video-candidate-empty';
      empty.textContent = '连接手机或导入视频后，达到门限的帧会显示在这里';
      host.appendChild(empty);
    }

    candidates.forEach(function (item) {
      var card = doc.createElement('article');
      card.className = 'video-candidate' + (selectedIds.has(item.id) ? ' is-selected' : '');

      var img = doc.createElement('img');
      if (!item.previewUrl && item.blob) item.previewUrl = global.URL.createObjectURL(item.blob);
      img.src = item.previewUrl || '';
      img.alt = '候选条纹帧';
      img.loading = 'lazy';

      var meta = doc.createElement('div');
      meta.className = 'video-candidate-meta';
      meta.textContent = item.deltaXPx.toFixed(1) + ' px · ' +
        Math.round(item.score * 100) + ' 分 · 可见度 ' +
        (item.visibility * 100).toFixed(1) + '%';

      var actions = doc.createElement('div');
      actions.className = 'video-candidate-actions';
      var remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'is-danger';
      remove.textContent = '移除';
      remove.addEventListener('click', function () {
        candidates = candidates.filter(function (candidate) { return candidate.id !== item.id; });
        revokePreview(item);
        renderCandidates();
      });
      actions.appendChild(remove);
      card.append(img, meta, actions);
      host.appendChild(card);
    });

    var stats = BP.videoSampler.summary(stablePicked);
    var cvText = isFinite(stats.cv) ? (stats.cv * 100).toFixed(2) + '%' : '—';
    var stability = '';
    if (stats.n >= config.target && (!isFinite(stats.cv) || stats.cv > BP.videoSampler.DEFAULTS.maxCv)) {
      stability = ' · 波动偏大';
    }
    statsHost.textContent = '候选 ' + candidates.length + ' / 目标 ' + config.target +
      ' · 入选 ' + stats.n + ' · 主频波动 ' + cvText + stability;
    $('videoConfirmButton').disabled = stats.n < config.target;
    $('videoConfirmButton').textContent = '确认加入当前角色（' + config.target + ' 帧）';

    var enough = BP.videoSampler.isEnough(candidates, config.target);
    if (enough && !enoughAnnounced) {
      enoughAnnounced = true;
      setStatus('数据已足够且主频稳定，请检查候选帧后确认加入', 'ready');
      setBadge('数据已足够', 'live');
      playReadyTone();
    } else if (!enough) {
      enoughAnnounced = false;
    }
  }

  function addCandidate(candidate, generation) {
    if (generation !== analysisGeneration) return;
    var config = currentConfig();
    candidate.score = BP.videoSampler.score(candidate);
    candidates.push(candidate);
    candidates = BP.videoSampler.selectCandidates(candidates, {
      minGapMs: BP.videoSampler.DEFAULTS.minGapMs,
      maxCandidates: config.target * 3
    });
    renderCandidates();
    if (!enoughAnnounced) setStatus('当前帧有效，继续自动抽帧', 'normal');
  }

  function analyzeSource(source, timeMs, sourceType, sourceName) {
    return new Promise(function (resolve) {
      try {
        var maxSide = 1280;
        var scale = Math.min(1, maxSide / Math.max(source.videoWidth, source.videoHeight));
        var width = Math.max(32, Math.round(source.videoWidth * scale));
        var height = Math.max(32, Math.round(source.videoHeight * scale));
        workCanvas.width = width;
        workCanvas.height = height;
        var context = workCanvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(source, 0, 0, width, height);
        var image = context.getImageData(0, 0, width, height);
        var result;
        try {
          result = BP.fringe.analyzeImageData(image.data, width, height, {});
        } catch (error) {
          resolve({ candidate: null, error: error.message || '未识别到稳定条纹' });
          return;
        }
        var crossDiff = isFinite(result.periodPxCross) && result.periodPx > 0
          ? Math.abs(result.periodPx - result.periodPxCross) / result.periodPx
          : 1;
        var candidate = {
          id: 'candidate-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          timeMs: Math.round(timeMs),
          deltaXPx: result.periodPx / scale,
          visibility: result.visibility || 0,
          spectralSnr: result.spectralSnr || 0,
          acfPeak: result.acfPeak || 0,
          crossDiff: crossDiff,
          saturationRatio: countSaturation(image.data) / (width * height),
          source: sourceType,
          sourceName: sourceName,
          analysis: compactAnalysis(result)
        };
        if (!BP.videoSampler.isValid(candidate)) {
          resolve({ candidate: candidate, error: rejectReason(candidate) });
          return;
        }
        frameCanvas.width = source.videoWidth;
        frameCanvas.height = source.videoHeight;
        frameCanvas.getContext('2d').drawImage(source, 0, 0);
        frameCanvas.toBlob(function (blob) {
          if (!blob) {
            resolve({ candidate: null, error: '候选帧编码失败' });
            return;
          }
          candidate.blob = blob;
          resolve({ candidate: candidate, error: '' });
        }, 'image/jpeg', 0.92);
      } catch (error) {
        resolve({ candidate: null, error: error.message || '抽帧分析失败' });
      }
    });
  }

  async function analyzeFrame() {
    var video = $('pcRemoteVideo');
    if (analysisBusy || !video || video.readyState < 2 || !video.videoWidth) return;
    analysisBusy = true;
    var generation = analysisGeneration;
    try {
      var result = await analyzeSource(
        video,
        Math.round(global.performance.now()),
        'live',
        '手机直播'
      );
      if (generation !== analysisGeneration) return;
      if (result.error) {
        setStatus('当前帧不合格：' + result.error, 'error');
        return;
      }
      addCandidate(result.candidate, generation);
    } catch (error) {
      if (generation === analysisGeneration) setStatus(error.message || '抽帧分析失败', 'error');
    } finally {
      analysisBusy = false;
    }
  }

  function downloadBlob(blob, filename) {
    var url = global.URL.createObjectURL(blob);
    var link = doc.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
  }

  async function startRecording(stream, filename, shouldContinue) {
    if (!global.MediaRecorder) throw new Error('当前浏览器不支持视频录制');
    var mime = BP.videoSampler.pickMimeType([
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ]);
    if (!mime) throw new Error('当前浏览器不支持 WebM 录制');

    var writer = null;
    if (global.showSaveFilePicker) {
      var handle = await global.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'WebM 视频', accept: { 'video/webm': ['.webm'] } }]
      });
      writer = await handle.createWritable();
    }
    if (shouldContinue && !shouldContinue()) {
      if (writer) await writer.abort();
      return null;
    }

    var recorder = new global.MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 4000000
    });
    var chunks = [];
    var writeQueue = Promise.resolve();
    recorder.ondataavailable = function (event) {
      if (!event.data || !event.data.size) return;
      if (writer) {
        writeQueue = writeQueue.then(function () { return writer.write(event.data); });
      } else {
        chunks.push(event.data);
      }
    };
    recorder.start(1000);

    return {
      stop: function () {
        return new Promise(function (resolve, reject) {
          recorder.onstop = function () {
            writeQueue.then(async function () {
              if (writer) await writer.close();
              else downloadBlob(new Blob(chunks, { type: mime }), filename);
              resolve();
            }).catch(reject);
          };
          recorder.onerror = function (event) {
            reject((event.error || new Error('视频录制失败')));
          };
          if (recorder.state === 'inactive') resolve();
          else recorder.stop();
        });
      }
    };
  }

  async function stopRecording(message) {
    if (!recorderHandle) return true;
    var handle = recorderHandle;
    recorderHandle = null;
    var toggle = $('videoRecordToggle');
    toggle.disabled = true;
    var saved = false;
    try {
      await handle.stop();
      saved = true;
      if (message) setStatus(message, 'normal');
    } catch (error) {
      setStatus('原始视频保存失败：' + (error.message || error), 'error');
    } finally {
      toggle.checked = false;
      toggle.disabled = false;
    }
    return saved;
  }

  function stopAnalysis() {
    if (analysisTimer) global.clearInterval(analysisTimer);
    analysisTimer = null;
    analysisBusy = false;
  }

  function waitForMediaEvent(target, eventName, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = null;
      function cleanup() {
        target.removeEventListener(eventName, onEvent);
        target.removeEventListener('error', onError);
        if (timer) global.clearTimeout(timer);
      }
      function onEvent() {
        cleanup();
        resolve();
      }
      function onError() {
        cleanup();
        reject(new Error('视频无法解码'));
      }
      target.addEventListener(eventName, onEvent, { once: true });
      target.addEventListener('error', onError, { once: true });
      timer = global.setTimeout(function () {
        cleanup();
        reject(new Error('视频读取超时'));
      }, timeoutMs || 15000);
    });
  }

  function seekVideo(video, timeSec) {
    var target = Math.max(0, Math.min(timeSec, Math.max(0, video.duration - 0.01)));
    if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.01) {
      return Promise.resolve();
    }
    var ready = waitForMediaEvent(video, 'seeked', 12000);
    video.currentTime = target;
    return ready;
  }

  function setImportBusy(busy) {
    importingVideo = busy;
    $('videoMethodSelect').disabled = busy;
    $('videoRoleSelect').disabled = busy;
    $('videoTargetSelect').disabled = busy;
    $('videoPairButton').disabled = busy;
    $('videoStopButton').disabled = true;
    $('videoConfirmButton').disabled = busy || $('videoConfirmButton').disabled;
    $('videoImportButton').disabled = busy;
    $('videoImportButton').textContent = busy ? '正在分析视频…' : '导入视频分析';
    $('videoImportProgress').hidden = !busy;
  }

  async function importVideo(file) {
    if (importingVideo || !file) return;
    await closeConnection('', false);
    var config = currentConfig();
    setImportBusy(true);
    clearCandidates();
    setBadge('分析视频', '');
    setStatus('正在读取视频信息…');
    $('videoImportProgress').value = 0;

    var video = doc.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    var objectUrl = global.URL.createObjectURL(file);
    try {
      video.src = objectUrl;
      await waitForMediaEvent(video, 'loadedmetadata', 15000);
      if (!isFinite(video.duration) || video.duration <= 0) {
        throw new Error('无法读取视频时长');
      }
      if (video.readyState < 2) await waitForMediaEvent(video, 'loadeddata', 15000);

      // 长视频自动放宽采样间隔，避免十分钟素材产生上千次解码。
      var gap = Math.max(0.5, Math.ceil(video.duration / 600 * 2) / 2);
      var times = BP.videoSampler.sampleTimes(video.duration, gap);
      var imported = [];
      var lastError = '';
      for (var i = 0; i < times.length; i++) {
        await seekVideo(video, times[i]);
        var result = await analyzeSource(video, times[i] * 1000, 'video', file.name);
        if (result.candidate) imported.push(result.candidate);
        if (result.error) lastError = result.error;
        $('videoImportProgress').value = (i + 1) / times.length;
        $('videoCandidateStats').textContent = '正在分析 ' + (i + 1) + ' / ' + times.length +
          ' · 有效帧 ' + imported.length;
        await new Promise(function (resolve) { global.setTimeout(resolve, 0); });
      }

      candidates = BP.videoSampler.selectCandidates(imported, {
        minGapMs: BP.videoSampler.DEFAULTS.minGapMs,
        maxCandidates: config.target * 3
      });
      renderCandidates();
      var enough = BP.videoSampler.isEnough(candidates, config.target);
      if (!enough) {
        var stats = BP.videoSampler.summary(selectedSet());
        setBadge('分析完成', '');
        setStatus(
          '视频分析完成：有效入选 ' + stats.n + ' / ' + config.target +
          (lastError ? '；最近拒绝原因：' + lastError : ''),
          imported.length ? 'normal' : 'error'
        );
      }
    } catch (error) {
      clearCandidates();
      setBadge('分析失败', 'error');
      setStatus(error.message || '视频导入失败', 'error');
    } finally {
      global.URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
      $('videoImportProgress').hidden = true;
      setImportBusy(false);
      renderCandidates();
    }
  }

  async function closeConnection(message, preserveCandidates) {
    if (closingConnection) return;
    closingConnection = true;
    recordingGeneration += 1;
    stopAnalysis();
    var hadRecording = !!recorderHandle;
    var recordingSaved = hadRecording ? await stopRecording('') : false;
    try {
      if (call) {
        try { call.close(); } catch (e) { /* 已关闭时忽略 */ }
      }
      if (peer) {
        try { peer.destroy(); } catch (e2) { /* 已销毁时忽略 */ }
      }
      if (remoteStream) {
        remoteStream.getTracks().forEach(function (track) { track.stop(); });
      }
      call = null;
      peer = null;
      remoteStream = null;
      currentSecret = '';
      var video = $('pcRemoteVideo');
      if (video) video.srcObject = null;
      $('videoStopButton').disabled = true;
      $('videoRecordToggle').disabled = false;
      $('videoRecordToggle').checked = false;
      $('videoPairButton').textContent = '生成扫码连接';
      setBadge('未连接', '');
      var finalMessage = message || '连接已停止';
      if (hadRecording && recordingSaved) finalMessage += '，原始视频已保存';
      if (preserveCandidates) {
        setStatus(finalMessage + '，已采集候选帧仍可确认', 'normal');
      } else {
        clearQr('已停止；重新生成二维码可继续');
        setStatus(finalMessage, 'normal');
        clearCandidates();
      }
    } finally {
      closingConnection = false;
    }
  }

  async function startPairing() {
    if (closingConnection) return;
    ensureAudio();
    $('videoPairButton').disabled = true;
    await closeConnection('', false);
    if (!global.Peer) {
      $('videoPairButton').disabled = false;
      setBadge('组件缺失', 'error');
      setStatus('PeerJS 组件未加载，请刷新页面', 'error');
      return;
    }
    var config = currentConfig();
    ensureSession(config.method);
    clearCandidates();
    var id = 'fp-' + randomToken(12);
    var secret = randomToken(24);
    currentSecret = secret;
    $('videoStopButton').disabled = false;
    setBadge('连接中', '');
    setStatus('正在连接信令服务器…');

    try {
      peer = new global.Peer(id, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:stun.l.google.com:19302' }
          ]
        }
      });
    } catch (error) {
      $('videoPairButton').disabled = false;
      setBadge('连接失败', 'error');
      setStatus(error.message || '无法创建视频连接', 'error');
      return;
    }
    peer.on('open', function () {
      if (!peer || peer.destroyed) return;
      var url = new URL('mobile.html', global.location.href);
      url.searchParams.set('stream', '1');
      url.searchParams.set('room', id);
      url.searchParams.set('token', secret);
      showQr(url.href);
      setBadge('等待扫码', '');
      setStatus('二维码已生成，等待手机扫码连接');
      $('videoPairButton').disabled = false;
      $('videoPairButton').textContent = '重新生成二维码';
    });
    peer.on('call', function (incoming) {
      var incomingToken = incoming && incoming.metadata && incoming.metadata.token;
      if (incomingToken !== secret) {
        try { incoming.close(); } catch (e) { /* 未授权连接直接关闭 */ }
        setStatus('已拒绝未授权的手机连接', 'error');
        return;
      }
      if (call) {
        try { incoming.close(); } catch (e2) { /* 重复连接直接关闭 */ }
        setStatus('已有手机连接，已拒绝重复连接', 'error');
        return;
      }
      call = incoming;
      call.answer();
      call.on('stream', function (stream) {
        if (call !== incoming) return;
        remoteStream = stream;
        $('pcRemoteVideo').srcObject = stream;
        var playResult = $('pcRemoteVideo').play();
        if (playResult && playResult.catch) playResult.catch(function () {});
        setBadge('已连接', 'live');
        setStatus('手机画面已连接，每 0.5 秒自动抽帧');
        stopAnalysis();
        analysisTimer = global.setInterval(analyzeFrame, 500);
      });
      call.on('close', function () {
        if (call === incoming) closeConnection('手机端已断开', true);
      });
      call.on('error', function (error) {
        setStatus(error.message || '视频连接出错', 'error');
      });
    });
    peer.on('error', function (error) {
      $('videoPairButton').disabled = false;
      setBadge('连接失败', 'error');
      setStatus(error.message || '信令连接失败', 'error');
    });
    peer.on('disconnected', function () {
      if (!peer || peer.destroyed) return;
      setBadge('正在恢复', '');
      setStatus('信令连接中断，正在尝试恢复…', 'error');
      global.setTimeout(function () {
        if (peer && peer.disconnected && !peer.destroyed) {
          try { peer.reconnect(); } catch (e) { /* 保留当前错误提示 */ }
        }
      }, 1200);
    });
  }

  function confirmCandidates() {
    var config = currentConfig();
    var chosen = selectedSet();
    if (chosen.length < config.target) {
      setStatus('有效候选帧不足，不能确认', 'error');
      return;
    }
    var session = ensureSession(config.method);
    var k = currentK();
    if (isFinite(k) && k > 0) {
      BP.sessions.updateSession(session.id, {
        calibration: {
          k_mm_px: k,
          source: 'manual',
          at: new Date().toISOString()
        }
      });
      session = BP.sessions.getSession(session.id);
    }
    var stats = BP.videoSampler.summary(chosen);
    var selection = {
      target: config.target,
      cv: stats.cv,
      meanPx: stats.meanPx,
      sdPx: stats.sdPx,
      method: config.method,
      role: config.role
    };
    var button = $('videoConfirmButton');
    button.disabled = true;
    button.textContent = '正在写入…';
    var stored = 0;
    chosen.reduce(function (promise, item, index) {
      return promise.then(function () {
        return BP.sessions.addFrame(session.id, {
          role: config.role,
          blob: item.blob,
          name: 'video-best-' + String(index + 1).padStart(2, '0') + '.jpg',
          size: item.blob.size,
          deltaXPx: item.deltaXPx,
          deltaXmm: isFinite(k) && k > 0 ? item.deltaXPx * k : null,
          quality: item.visibility,
          source: item.source || 'live',
          sourceName: item.sourceName || '手机直播',
          capturedAt: item.timeMs,
          qualityScore: item.score,
          selection: selection,
          analysis: item.analysis
        }).then(function () { stored += 1; });
      });
    }, Promise.resolve()).then(function () {
      clearCandidates();
      if (BP.pages && BP.pages.pc && BP.pages.pc.renderPcSession) {
        BP.pages.pc.renderPcSession();
      }
      if (BP.pages && BP.pages.pc && BP.pages.pc.applySessionData) {
        BP.pages.pc.applySessionData({ silent: true, calculate: true });
      }
      setBadge(remoteStream ? '已连接' : '未连接', remoteStream ? 'live' : '');
      setStatus('已将 ' + stored + ' 个最佳帧写入“' +
        (BP.sessions.ROLE_LABEL[config.role] || config.role) + '”', 'ready');
    }).catch(function (error) {
      setStatus('写入失败：' + (error.message || error), 'error');
      renderCandidates();
    });
  }

  function wire() {
    populateRoles();
    $('videoMethodSelect').addEventListener('change', function () {
      closeConnection('', false);
      populateRoles();
      clearCandidates();
    });
    $('videoRoleSelect').addEventListener('change', clearCandidates);
    $('videoTargetSelect').addEventListener('change', clearCandidates);
    $('videoPairButton').addEventListener('click', startPairing);
    $('videoStopButton').addEventListener('click', function () {
      closeConnection('连接已停止', true);
    });
    $('videoRecordToggle').addEventListener('change', async function (event) {
      if (!event.target.checked) {
        await stopRecording(remoteStream ? '原始视频已保存，继续自动抽帧' : '原始视频已保存');
        return;
      }
      if (recordingStarting) return;
      if (!remoteStream) {
        event.target.checked = false;
        setStatus('请先连接手机，再开启原始视频录制', 'error');
        return;
      }
      recordingStarting = true;
      event.target.disabled = true;
      var generation = ++recordingGeneration;
      var config = currentConfig();
      var session = ensureSession(config.method);
      setStatus('请选择原始视频保存位置…');
      try {
        var handle = await startRecording(
          remoteStream,
          BP.videoSampler.recordingFilename(session.id, config.method, config.role),
          function () { return generation === recordingGeneration && !!remoteStream; }
        );
        if (!handle || generation !== recordingGeneration || !remoteStream) {
          if (handle) await handle.stop();
          event.target.checked = false;
          return;
        }
        recorderHandle = handle;
        setStatus('正在同步录制原始视频，最佳帧采集继续');
      } catch (error) {
        event.target.checked = false;
        setStatus(
          error && error.name === 'AbortError'
            ? '已取消原始视频录制'
            : '无法开始录制：' + (error.message || error),
          error && error.name === 'AbortError' ? 'normal' : 'error'
        );
      } finally {
        recordingStarting = false;
        event.target.disabled = false;
      }
    });
    $('videoConfirmButton').addEventListener('click', confirmCandidates);
    $('videoImportButton').addEventListener('click', function () {
      if (!importingVideo) $('videoImportInput').click();
    });
    $('videoImportInput').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (file) importVideo(file);
    });
    $('pcRemoteVideo').addEventListener('loadedmetadata', function () {
      var video = $('pcRemoteVideo');
      if (video.videoWidth) {
        setStatus('画面 ' + video.videoWidth + ' × ' + video.videoHeight + '，正在自动抽帧');
      }
    });
    renderCandidates();
  }

  API = {
    startPairing: startPairing,
    stop: function () { return closeConnection('', true); },
    analyzeFrame: analyzeFrame,
    currentConfig: currentConfig,
    currentK: currentK,
    setStatus: setStatus,
    clearCandidates: clearCandidates,
    renderCandidates: renderCandidates,
    importVideo: importVideo
  };
  BP.pages = BP.pages || {};
  BP.pages.pcVideo = API;

  wire();
})(window);
