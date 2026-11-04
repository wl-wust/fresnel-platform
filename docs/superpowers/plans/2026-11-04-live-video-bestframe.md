# 手机视频实时采集与最佳帧导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有纯前端平台中加入手机扫码推流、PC 实时预览、最佳帧自动筛选、达标提示、原始视频导出和本地视频导入分析。

**Architecture:** 手机与 PC 通过 PeerJS 信令建立 WebRTC 点对点视频连接；抽帧评分、候选去重和达标判断放入独立纯函数模块；PC 页面负责媒体、录制和会话写入；手机页面负责摄像头和推流。所有确认后的最佳帧继续使用现有 `BP.sessions.addFrame()` 进入 `bp.session/2`。

**Tech Stack:** 原生 JavaScript、WebRTC、PeerJS、MediaRecorder、Canvas、IndexedDB、Node.js 测试脚本。

---

## 文件结构

- Create: `js/core/video-sampler.js`
  - 负责单帧质量评分、有效帧门限、候选去重、主频统计和达标判断。
- Create: `js/pages/pc-video.js`
  - 负责 PC 端 PeerJS、实时预览、抽帧调度、候选列表、视频导入和会话写入。
- Create: `js/pages/mobile-stream.js`
  - 负责手机扫码后的摄像头预览、WebRTC 推流和连接状态。
- Create: `vendor/peerjs.min.js`
  - 固定版本的 PeerJS 浏览器构建。
- Create: `vendor/qrcode.min.js`
  - PC 端二维码生成库。
- Create: `tools/check-video-sampler.js`
  - 纯函数门禁。
- Create: `tools/check-video-html.js`
  - 页面元素、脚本顺序和关键接线门禁。
- Modify: `js/core/sessions.js`
  - 保存视频来源和候选评分元数据。
- Modify: `tools/check-sessions.js`
  - 检查新增元数据兼容性。
- Modify: `index.html`
  - 增加视频采集卡片、媒体元素和脚本。
- Modify: `mobile.html`
  - 增加手机推流视图和脚本。
- Modify: `css/style.css`
  - PC 视频面板、候选缩略图和状态样式。
- Modify: `css/mobile.css`
  - 手机推流全屏视图和连接状态样式。
- Modify: `docs/measurement-session-workflow.md`
  - 增加直播和视频导入流程。
- Modify: `tools/check-pages.js`
  - 增加视频采集页面接线检查。
- Modify: `tools/check-deploy.js`
  - 增加 vendor 和新增脚本部署检查。
- Modify: `tools/check-versions.js`
  - 覆盖新增脚本的缓存版本。

### Task 1: 抽帧评分纯函数

**Files:**
- Create: `js/core/video-sampler.js`
- Create: `tools/check-video-sampler.js`

- [ ] **Step 1: 写失败测试**

```js
const assert = require('assert');
const S = require('../js/core/video-sampler.js');

const good = {
  timeMs: 1000,
  deltaXPx: 163.3,
  visibility: 0.20,
  spectralSnr: 12,
  acfPeak: 0.6,
  crossDiff: 0.005,
  saturationRatio: 0.001
};
assert.strictEqual(S.isValid(good), true);
assert.strictEqual(S.isValid(Object.assign({}, good, { visibility: 0.01 })), false);
assert(S.score(good) > S.score(Object.assign({}, good, { visibility: 0.05 })));

const picked = S.selectCandidates([
  good,
  Object.assign({}, good, { timeMs: 1100, deltaXPx: 163.4 }),
  Object.assign({}, good, { timeMs: 1600, deltaXPx: 163.6, visibility: 0.12 })
], { minGapMs: 500, maxCandidates: 10 });
assert.strictEqual(picked.length, 2);
assert.strictEqual(S.summary(picked).cv <= 0.005, true);
assert.strictEqual(S.isEnough(Array.from({ length: 20 }, (_, i) => ({
  ...good,
  timeMs: i * 500,
  deltaXPx: 163.3 + (i % 2 ? 0.1 : -0.1)
})), 20), true);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node tools/check-video-sampler.js`
Expected: FAIL，提示找不到 `js/core/video-sampler.js`。

- [ ] **Step 3: 实现最小版本**

```js
(function (global) {
  'use strict';
  var DEFAULTS = {
    target: 20,
    minGapMs: 500,
    minVisibility: 0.03,
    minSnr: 6,
    minAcf: 0.2,
    maxCrossDiff: 0.02,
    maxSaturation: 0.02,
    maxCv: 0.005
  };

  function isValid(item, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    return !!item &&
      isFinite(item.deltaXPx) && item.deltaXPx > 0 &&
      item.visibility >= o.minVisibility &&
      item.spectralSnr >= o.minSnr &&
      item.acfPeak >= o.minAcf &&
      item.crossDiff <= o.maxCrossDiff &&
      item.saturationRatio <= o.maxSaturation;
  }

  function score(item) {
    if (!item) return 0;
    var v = Math.min(1, Math.max(0, item.visibility || 0) / 0.25);
    var snr = Math.min(1, Math.max(0, item.spectralSnr || 0) / 15);
    var acf = Math.min(1, Math.max(0, item.acfPeak || 0));
    var cross = 1 - Math.min(1, Math.max(0, item.crossDiff || 0) / 0.02);
    var sat = 1 - Math.min(1, Math.max(0, item.saturationRatio || 0) / 0.02);
    return 0.35 * v + 0.25 * snr + 0.20 * acf + 0.10 * cross + 0.10 * sat;
  }

  function selectCandidates(items, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    return (items || [])
      .filter(function (x) { return isValid(x, o); })
      .map(function (x) { return Object.assign({}, x, { score: score(x) }); })
      .sort(function (a, b) { return b.score - a.score; })
      .reduce(function (out, x) {
        if (out.length >= (o.maxCandidates || 60)) return out;
        if (out.some(function (y) { return Math.abs(y.timeMs - x.timeMs) < o.minGapMs; })) return out;
        out.push(x);
        return out;
      }, [])
      .sort(function (a, b) { return a.timeMs - b.timeMs; });
  }

  function summary(items) {
    var xs = (items || []).map(function (x) { return Number(x.deltaXPx); })
      .filter(function (x) { return isFinite(x) && x > 0; });
    var mean = xs.reduce(function (a, b) { return a + b; }, 0) / (xs.length || 1);
    var sd = xs.length > 1 ? Math.sqrt(xs.reduce(function (a, b) {
      return a + (b - mean) * (b - mean);
    }, 0) / (xs.length - 1)) : NaN;
    return { n: xs.length, meanPx: mean, sdPx: sd, cv: mean ? sd / mean : NaN };
  }

  function isEnough(items, target, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var picked = selectCandidates(items, {
      minGapMs: o.minGapMs,
      maxCandidates: target || o.target
    }).filter(function (x) { return !x.excluded; });
    var st = summary(picked);
    return st.n >= (target || o.target) && isFinite(st.cv) && st.cv <= o.maxCv;
  }

  var API = { DEFAULTS: DEFAULTS, isValid: isValid, score: score,
              selectCandidates: selectCandidates, summary: summary, isEnough: isEnough };
  global.BP = global.BP || {};
  global.BP.videoSampler = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: 运行测试**

Run: `node tools/check-video-sampler.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add js/core/video-sampler.js tools/check-video-sampler.js
git commit -m "feat: 增加视频最佳帧评分内核"
```

### Task 2: 会话视频元数据

**Files:**
- Modify: `js/core/sessions.js`
- Modify: `tools/check-sessions.js`

- [ ] **Step 1: 增加失败断言**

```js
const added = await S.addFrame(ratio.id, {
  role: 'sodium',
  deltaXPx: 163.6,
  source: 'video',
  sourceName: 'lab.mp4',
  capturedAt: 1200,
  qualityScore: 0.86,
  selection: { target: 20, cv: 0.002 }
});
assert.strictEqual(added.source, 'video');
assert.strictEqual(added.sourceName, 'lab.mp4');
assert.strictEqual(added.capturedAt, 1200);
assert.strictEqual(added.qualityScore, 0.86);
assert.strictEqual(added.selection.target, 20);
```

- [ ] **Step 2: 运行并确认失败**

Run: `node tools/check-sessions.js`
Expected: FAIL，新增字段为 `undefined`。

- [ ] **Step 3: 保存可选字段**

```js
source: frame.source || '',
sourceName: frame.sourceName || '',
capturedAt: isFinite(frame.capturedAt) ? Number(frame.capturedAt) : null,
qualityScore: isFinite(frame.qualityScore) ? Number(frame.qualityScore) : null,
selection: frame.selection || null,
```

- [ ] **Step 4: 运行会话测试**

Run: `node tools/check-sessions.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add js/core/sessions.js tools/check-sessions.js
git commit -m "feat: 记录视频来源与最佳帧评分"
```

### Task 3: 手机扫码推流页

**Files:**
- Create: `js/pages/mobile-stream.js`
- Create: `vendor/peerjs.min.js`
- Create: `vendor/qrcode.min.js`
- Modify: `mobile.html`
- Modify: `css/mobile.css`
- Create: `tools/check-video-html.js`

- [ ] **Step 1: 写页面门禁并确认失败**

```js
const fs = require('fs');
const mobile = fs.readFileSync('mobile.html', 'utf8');
const pc = fs.readFileSync('index.html', 'utf8');
assert(/id="streamPage"/.test(mobile));
assert(/id="streamVideo"/.test(mobile));
assert(/js\/pages\/mobile-stream\.js/.test(mobile));
assert(/id="videoPanel"/.test(pc));
assert(/js\/pages\/pc-video\.js/.test(pc));
assert(/vendor\/peerjs\.min\.js/.test(pc) && /vendor\/peerjs\.min\.js/.test(mobile));
assert(/vendor\/qrcode\.min\.js/.test(pc));
```

Run: `node tools/check-video-html.js`
Expected: FAIL，缺少 `streamPage`。

- [ ] **Step 2: 固定第三方库**

Download pinned browser builds into `vendor/` and keep their license headers:

```powershell
Invoke-WebRequest 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js' -OutFile 'vendor/peerjs.min.js'
Invoke-WebRequest 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js' -OutFile 'vendor/qrcode.min.js'
```

- [ ] **Step 3: 增加手机推流视图**

```html
<section id="streamPage" class="stream-page" hidden>
  <video id="streamVideo" autoplay playsinline muted></video>
  <div class="stream-status" id="streamStatus">正在连接电脑…</div>
  <div class="stream-meta" id="streamMeta"></div>
  <button id="streamStop" class="btn-primary" type="button">停止推流</button>
</section>
```

- [ ] **Step 4: 实现手机推流**

```js
(function (global) {
  'use strict';
  var q = new URLSearchParams(global.location.search);
  if (q.get('stream') !== '1') return;

  var room = q.get('room') || '';
  var token = q.get('token') || '';
  var video = document.getElementById('streamVideo');
  var status = document.getElementById('streamStatus');
  var meta = document.getElementById('streamMeta');
  var stopButton = document.getElementById('streamStop');
  var stream = null;
  var peer = null;
  var call = null;

  function setStatus(text, error) {
    status.textContent = text;
    status.classList.toggle('is-error', !!error);
  }

  function stop() {
    if (call) call.close();
    if (peer) peer.destroy();
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    stream = null;
    video.srcObject = null;
    setStatus('已停止推流');
  }

  function start() {
    document.getElementById('streamPage').hidden = false;
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    }).then(function (s) {
      stream = s;
      video.srcObject = s;
      meta.textContent = video.videoWidth ? video.videoWidth + ' × ' + video.videoHeight : '摄像头已就绪';
      peer = new Peer();
      peer.on('open', function () {
        setStatus('正在呼叫电脑…');
        call = peer.call(room, stream, { metadata: { token: token } });
        if (!call) {
          setStatus('无法建立连接，请重新扫码', true);
          return;
        }
        call.on('stream', function () {
          setStatus('已连接，正在向电脑传输画面');
        });
        call.on('close', function () { setStatus('电脑已断开连接'); });
        call.on('error', function (e) { setStatus(e.message || '连接失败', true); });
      });
      peer.on('error', function (e) { setStatus(e.message || '信令连接失败', true); });
    }).catch(function (e) {
      setStatus(e && e.name === 'NotAllowedError' ? '请允许摄像头权限后重新扫码' : (e.message || '无法打开摄像头'), true);
    });
  }

  stopButton.addEventListener('click', stop);
  global.addEventListener('pagehide', stop);
  start();
})(window);
```

- [ ] **Step 5: 运行静态门禁**

Run: `node tools/check-video-html.js`
Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add mobile.html css/mobile.css js/pages/mobile-stream.js vendor/peerjs.min.js vendor/qrcode.min.js tools/check-video-html.js
git commit -m "feat: 增加手机扫码推流页"
```

### Task 4: PC 实时预览与最佳帧

**Files:**
- Create: `js/pages/pc-video.js`
- Modify: `index.html`
- Modify: `css/style.css`

- [ ] **Step 1: 增加 PC 视频面板**

```html
<section id="videoPanel" class="video-panel">
  <div class="video-config">
    <label>测量方法<select id="videoMethodSelect">
      <option value="basic">基本公式</option>
      <option value="ratio">比值法</option>
      <option value="magnification">横向放大率法</option>
      <option value="trace">光线追迹法</option>
    </select></label>
    <label>图像角色<select id="videoRoleSelect"></select></label>
    <label>目标帧数<select id="videoTargetSelect">
      <option>10</option><option selected>20</option><option>30</option>
    </select></label>
    <button id="videoPairButton" type="button">生成扫码连接</button>
    <label class="video-record-toggle">
      <input id="videoRecordToggle" type="checkbox"> 同时录制原始视频
    </label>
  </div>
  <div class="video-live-grid">
    <div class="video-qr-box" id="videoQrBox">
      <p>先选择模式和角色，再生成二维码</p>
    </div>
    <div class="video-preview-box">
      <video id="pcRemoteVideo" autoplay playsinline muted></video>
      <div id="videoLiveStatus">尚未连接</div>
    </div>
  </div>
  <div id="videoCandidateStats"></div>
  <div id="videoCandidateGallery" class="video-candidate-gallery"></div>
  <div class="video-actions">
    <button id="videoConfirmButton" type="button" disabled>加入当前角色</button>
    <button id="videoStopButton" type="button" disabled>停止连接</button>
    <input id="videoImportInput" type="file" accept="video/*" hidden>
    <button id="videoImportButton" type="button">导入视频</button>
  </div>
  <progress id="videoImportProgress" max="1" value="0" hidden></progress>
</section>
```

- [ ] **Step 2: 实现连接和抽帧**

```js
(function (global) {
  'use strict';
  var BP = global.BP;
  var $ = BP.ui.$;
  var peer = null;
  var call = null;
  var stream = null;
  var candidates = [];
  var enoughAnnounced = false;
  var timer = null;
  var workCanvas = document.createElement('canvas');
  var frameCanvas = document.createElement('canvas');
  var recorder = null;

  function setLiveStatus(text) {
    $('videoLiveStatus').textContent = text || '';
  }

  function countSaturation(data) {
    var n = 0;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250) n++;
    }
    return n;
  }

  function rejectReason(item) {
    if (item.visibility < 0.03) return '条纹可见度不足';
    if (item.spectralSnr < 6) return '频谱峰太弱';
    if (item.acfPeak < 0.2) return '周期性不足';
    if (item.crossDiff > 0.02) return '两种周期算法差异过大';
    if (item.saturationRatio > 0.02) return '过曝像素较多';
    return '请调整曝光或视场';
  }

  function playReadyTone() {
    try {
      var AudioCtor = global.AudioContext || global.webkitAudioContext;
      var ac = new AudioCtor();
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25);
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.25);
    } catch (e) { /* 浏览器禁止自动播放声音时只保留页面提示 */ }
  }

  function showQr(url) {
    var host = $('videoQrBox');
    host.textContent = '';
    if (!global.QRCode) {
      host.textContent = '二维码组件未加载';
      return;
    }
    new global.QRCode(host, { text: url, width: 240, height: 240, correctLevel: 2 });
  }

  function resetCandidates() {
    candidates = [];
    enoughAnnounced = false;
    renderCandidates();
  }

  function stopPeer() {
    if (timer) global.clearInterval(timer);
    timer = null;
    if (call) call.close();
    if (peer) peer.destroy();
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    call = null;
    peer = null;
    stream = null;
    $('pcRemoteVideo').srcObject = null;
    $('videoStopButton').disabled = true;
    setLiveStatus('连接已停止');
  }

  function currentK() {
    var saved = BP.store.loadK();
    if (saved && isFinite(saved.value) && saved.value > 0) return saved.value;
    var el = $('pixel_size');
    var v = el ? parseFloat(el.value) : NaN;
    return isFinite(v) && v > 0 ? v : 0.004;
  }

  function populateRoles() {
    var method = $('videoMethodSelect').value;
    var roles = BP.sessions.requiredRoles(method);
    var sel = $('videoRoleSelect');
    sel.textContent = '';
    roles.forEach(function (role) {
      var option = document.createElement('option');
      option.value = role;
      option.textContent = BP.sessions.ROLE_LABEL[role] || role;
      sel.appendChild(option);
    });
  }

  function token() {
    var bytes = new Uint8Array(24);
    global.crypto.getRandomValues(bytes);
    return Array.from(bytes).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  }

  function currentConfig() {
    return {
      method: $('videoMethodSelect').value,
      role: $('videoRoleSelect').value,
      target: Number($('videoTargetSelect').value)
    };
  }

  function ensureSession(method) {
    var active = BP.sessions.getActiveSession();
    if (active && active.method === method) return active;
    return BP.sessions.createSession({ method: method, title: '视频采集 ' + new Date().toLocaleString() });
  }

  function analyzeFrame() {
    var video = $('pcRemoteVideo');
    if (!video.videoWidth || !BP.videoSampler) return;
    var maxSide = 1280;
    var scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    var w = Math.round(video.videoWidth * scale);
    var h = Math.round(video.videoHeight * scale);
    workCanvas.width = w;
    workCanvas.height = h;
    var ctx = workCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h);
    var sat = countSaturation(data.data) / (w * h);
    var r;
    try {
      r = BP.fringe.analyzeImageData(data.data, w, h, {});
    } catch (e) {
      setLiveStatus(e.message);
      return;
    }
    var candidate = {
      id: 'candidate-' + Date.now(),
      timeMs: Math.round(performance.now()),
      deltaXPx: r.periodPx / scale,
      visibility: r.visibility || 0,
      spectralSnr: r.spectralSnr || 0,
      acfPeak: r.acfPeak || 0,
      crossDiff: Math.abs(r.periodPx - r.periodPxCross) / r.periodPx,
      saturationRatio: sat,
      source: 'live',
      sourceName: '手机直播',
      analysis: r
    };
    if (!BP.videoSampler.isValid(candidate)) {
      setLiveStatus('当前帧不合格：' + rejectReason(candidate));
      return;
    }
    frameCanvas.width = video.videoWidth;
    frameCanvas.height = video.videoHeight;
    frameCanvas.getContext('2d').drawImage(video, 0, 0);
    frameCanvas.toBlob(function (blob) {
      candidate.blob = blob;
      candidate.score = BP.videoSampler.score(candidate);
      candidates.push(candidate);
      candidates = BP.videoSampler.selectCandidates(candidates, {
        minGapMs: 500,
        maxCandidates: currentConfig().target * 3
      });
      renderCandidates();
      if (!enoughAnnounced && BP.videoSampler.isEnough(candidates, currentConfig().target)) {
        enoughAnnounced = true;
        setLiveStatus('数据已足够，可以确认加入当前角色');
        playReadyTone();
      }
    }, 'image/jpeg', 0.92);
  }

  function startPairing() {
    stopPeer();
    var config = currentConfig();
    ensureSession(config.method);
    resetCandidates();
    $('videoStopButton').disabled = false;
    var id = 'fp-' + token().slice(0, 24);
    var secret = token();
    peer = new Peer(id);
    peer.on('open', function () {
      var url = new URL('mobile.html', global.location.href);
      url.searchParams.set('stream', '1');
      url.searchParams.set('room', id);
      url.searchParams.set('token', secret);
      showQr(url.href);
      setLiveStatus('等待手机扫码');
    });
    peer.on('call', function (incoming) {
      if (!incoming.metadata || incoming.metadata.token !== secret) {
        incoming.close();
        setLiveStatus('已拒绝未授权的手机连接');
        return;
      }
      if (call) {
        incoming.close();
        setLiveStatus('已有手机连接，拒绝重复连接');
        return;
      }
      call = incoming;
      call.answer();
      call.on('stream', function (remote) {
        stream = remote;
        $('pcRemoteVideo').srcObject = remote;
        setLiveStatus('已连接，正在自动抽帧');
        timer = global.setInterval(analyzeFrame, 500);
      });
      call.on('close', stopPeer);
    });
    peer.on('error', function (e) { setLiveStatus(e.message || '连接失败'); });
  }

  function wire() {
    populateRoles();
    $('videoMethodSelect').addEventListener('change', function () {
      if (stream) stopPeer();
      resetCandidates();
      populateRoles();
    });
    $('videoRoleSelect').addEventListener('change', resetCandidates);
    $('videoTargetSelect').addEventListener('change', resetCandidates);
    $('videoPairButton').addEventListener('click', startPairing);
    $('videoStopButton').addEventListener('click', stopPeer);
    $('videoConfirmButton').addEventListener('click', confirmCandidates);
  }

  wire();
})(window);
```

- [ ] **Step 3: 显示候选和会话写入**

把以下函数加入与 `startPairing()` 相同的 IIFE，并放在 `wire()` 之前：

```js
function renderCandidates() {
  var host = $('videoCandidateGallery');
  host.textContent = '';
  candidates.forEach(function (item, index) {
    var card = document.createElement('article');
    card.className = 'video-candidate';
    var img = document.createElement('img');
    img.src = URL.createObjectURL(item.blob);
    var label = document.createElement('p');
    label.textContent = (index + 1) + ' · ' + item.deltaXPx.toFixed(1) + ' px · ' + Math.round(item.score * 100) + '分';
    var remove = document.createElement('button');
    remove.textContent = '移除';
    remove.onclick = function () {
      candidates = candidates.filter(function (x) { return x.id !== item.id; });
      renderCandidates();
    };
    card.append(img, label, remove);
    host.appendChild(card);
  });
  var st = BP.videoSampler.summary(candidates);
  $('videoCandidateStats').textContent =
    '候选 ' + st.n + '/' + currentConfig().target +
    '，主频波动 ' + (isFinite(st.cv) ? (st.cv * 100).toFixed(2) : '—') + '%';
  $('videoConfirmButton').disabled = st.n < currentConfig().target;
}

function confirmCandidates() {
  var config = currentConfig();
  var session = ensureSession(config.method);
  var chosen = candidates.slice(0, config.target);
  chosen.reduce(function (p, item, index) {
    return p.then(function () {
      return BP.sessions.addFrame(session.id, {
        role: config.role,
        blob: item.blob,
        name: 'video-best-' + String(index + 1).padStart(2, '0') + '.jpg',
        size: item.blob.size,
        deltaXPx: item.deltaXPx,
        deltaXmm: item.deltaXPx * currentK(),
        quality: item.visibility,
        source: item.source || 'live',
        sourceName: item.sourceName || '手机直播',
        capturedAt: item.timeMs,
        qualityScore: item.score,
        selection: { target: config.target, cv: BP.videoSampler.summary(chosen).cv },
        analysis: item.analysis
      });
    });
  }, Promise.resolve()).then(function () {
    candidates = [];
    enoughAnnounced = false;
    renderCandidates();
    if (BP.pages.pc && BP.pages.pc.renderPcSession) BP.pages.pc.renderPcSession();
    setLiveStatus('最佳帧已写入当前角色');
  });
}
```

- [ ] **Step 4: 接入脚本并运行静态检查**

```html
<script src="vendor/qrcode.min.js?v=3237fe4"></script>
<script src="vendor/peerjs.min.js?v=3237fe4"></script>
<script src="js/core/video-sampler.js?v=3237fe4"></script>
<script src="js/pages/pc-video.js?v=3237fe4"></script>
```

Run: `node tools/check-video-html.js`
Expected: PASS。

Run: `node tools/check-ids.js`
Expected: PASS，所有新增 ID 均存在。

- [ ] **Step 5: 提交**

```powershell
git add index.html css/style.css js/pages/pc-video.js
git commit -m "feat: 增加电脑端直播最佳帧采集"
```

### Task 5: 原始视频录制与导出

**Files:**
- Modify: `js/core/video-sampler.js`
- Modify: `js/pages/pc-video.js`
- Modify: `index.html`
- Modify: `css/style.css`
- Modify: `tools/check-video-sampler.js`

- [ ] **Step 1: 增加失败测试**

在 `tools/check-video-sampler.js` 中加入：

```js
assert.strictEqual(S.recordingFilename('session-a', 'ratio', 'sodium').startsWith('session-a-ratio-sodium-'), true);
assert(/\.webm$/.test(S.recordingFilename('session-a', 'ratio', 'sodium')));
assert.strictEqual(S.pickMimeType([
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8'
], { isTypeSupported: function (type) { return type.indexOf('vp9') >= 0; } }), 'video/webm;codecs=vp9');
```

Run: `node tools/check-video-sampler.js`
Expected: FAIL，函数不存在。

- [ ] **Step 2: 实现命名与编码选择**

把以下函数加入 `js/core/video-sampler.js`，并导出到 `BP.videoSampler`：

```js
function pickMimeType(list, recorderCtor) {
  var probe = recorderCtor || global.MediaRecorder;
  if (!probe || !probe.isTypeSupported) return '';
  for (var i = 0; i < (list || []).length; i++) {
    if (probe.isTypeSupported(list[i])) return list[i];
  }
  return '';
}

function recordingFilename(sessionId, method, role) {
  var stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return sessionId + '-' + method + '-' + role + '-' + stamp + '.webm';
}

function downloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
```

- [ ] **Step 3: 实现录制**

把以下函数加入 `js/pages/pc-video.js` 的 IIFE：

```js
async function startRecording(remoteStream, filename) {
  var mime = BP.videoSampler.pickMimeType([
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ]);
  if (!mime) throw new Error('当前浏览器不支持 WebM 录制');
  var recorder = new MediaRecorder(remoteStream, { mimeType: mime, videoBitsPerSecond: 4000000 });
  var chunks = [];
  var writer = null;
  var handle = null;
  if (global.showSaveFilePicker) {
    handle = await global.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: 'WebM 视频', accept: { 'video/webm': ['.webm'] } }]
    });
    writer = await handle.createWritable();
  }
  recorder.ondataavailable = async function (event) {
    if (!event.data || !event.data.size) return;
    if (writer) await writer.write(event.data);
    else chunks.push(event.data);
  };
  recorder.start(1000);
  return {
    stop: function () {
      return new Promise(function (resolve) {
        recorder.onstop = async function () {
          if (writer) await writer.close();
          else downloadBlob(new Blob(chunks, { type: mime }), filename);
          resolve();
        };
        recorder.stop();
      });
    }
  };
}
```

- [ ] **Step 4: 加入开关、状态和断线保留**

```js
$('videoRecordToggle').addEventListener('change', async function (event) {
  if (!event.target.checked) {
    if (recorder) {
      await recorder.stop();
      recorder = null;
      setLiveStatus('原始视频已结束录制');
    }
    return;
  }
  if (!stream) {
    event.target.checked = false;
    setLiveStatus('请先连接手机再开启录制');
    return;
  }
  var config = currentConfig();
  recorder = await startRecording(
    stream,
    BP.videoSampler.recordingFilename(
      BP.sessions.getActiveSession().id,
      config.method,
      config.role
    )
  );
});
```

停止连接时先执行 `await recorder.stop()`，再关闭 PeerJS 和媒体流。

- [ ] **Step 5: 运行门禁**

Run: `node tools/check-video-sampler.js`
Expected: PASS。

Run: `node tools/check-ids.js`
Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add js/pages/pc-video.js index.html css/style.css
git commit -m "feat: 支持直播原始视频可选导出"
```

### Task 6: 本地视频导入分析

**Files:**
- Modify: `js/pages/pc-video.js`
- Modify: `index.html`
- Modify: `tools/check-video-sampler.js`

- [ ] **Step 1: 增加失败测试**

```js
const plan = S.sampleTimes(10, 0.5);
assert.strictEqual(plan.length, 20);
assert.strictEqual(plan[0], 0);
assert.strictEqual(plan[plan.length - 1], 9.5);
assert.strictEqual(S.sampleTimes(2, 0.5).length, 4);
```

Run: `node tools/check-video-sampler.js`
Expected: FAIL，`sampleTimes` 不存在。

- [ ] **Step 2: 实现采样时间表**

把以下函数加入 `js/core/video-sampler.js`，并导出到 `BP.videoSampler`：

```js
function sampleTimes(durationSec, gapSec) {
  var step = gapSec || 0.5;
  var n = Math.max(1, Math.floor((Number(durationSec) || 0) / step));
  var out = [];
  for (var i = 0; i < n; i++) out.push(Number((i * step).toFixed(3)));
  return out;
}
```

- [ ] **Step 3: 实现视频逐点抽帧**

先加入以下媒体辅助函数：

```js
function once(target, eventName) {
  return new Promise(function (resolve, reject) {
    target.addEventListener(eventName, resolve, { once: true });
    target.addEventListener('error', function () {
      reject(new Error('视频无法解码'));
    }, { once: true });
  });
}

function seek(video, timeSec) {
  return new Promise(function (resolve, reject) {
    video.addEventListener('seeked', resolve, { once: true });
    video.addEventListener('error', function () {
      reject(new Error('视频定位失败'));
    }, { once: true });
    video.currentTime = Math.max(0, Math.min(timeSec, video.duration - 0.01));
  });
}

function analyzeCanvasSource(source, timeMs, sourceName) {
  return new Promise(function (resolve) {
    var maxSide = 1280;
    var scale = Math.min(1, maxSide / Math.max(source.videoWidth, source.videoHeight));
    var w = Math.round(source.videoWidth * scale);
    var h = Math.round(source.videoHeight * scale);
    workCanvas.width = w;
    workCanvas.height = h;
    var ctx = workCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    var image = ctx.getImageData(0, 0, w, h);
    var saturationRatio = countSaturation(image.data) / (w * h);
    var r;
    try {
      r = BP.fringe.analyzeImageData(image.data, w, h, {});
    } catch (e) {
      resolve(null);
      return;
    }
    var candidate = {
      id: 'candidate-' + timeMs + '-' + Math.random().toString(16).slice(2),
      timeMs: timeMs,
      deltaXPx: r.periodPx / scale,
      visibility: r.visibility || 0,
      spectralSnr: r.spectralSnr || 0,
      acfPeak: r.acfPeak || 0,
      crossDiff: Math.abs(r.periodPx - r.periodPxCross) / r.periodPx,
      saturationRatio: saturationRatio,
      source: 'video',
      sourceName: sourceName,
      analysis: r
    };
    if (!BP.videoSampler.isValid(candidate)) {
      resolve(null);
      return;
    }
    frameCanvas.width = source.videoWidth;
    frameCanvas.height = source.videoHeight;
    frameCanvas.getContext('2d').drawImage(source, 0, 0);
    frameCanvas.toBlob(function (blob) {
      candidate.blob = blob;
      candidate.score = BP.videoSampler.score(candidate);
      resolve(candidate);
    }, 'image/jpeg', 0.92);
  });
}
```

然后加入导入主流程：

```js
async function importVideo(file) {
  var config = currentConfig();
  var session = ensureSession(config.method);
  var video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(file);
  await once(video, 'loadedmetadata');
  var times = BP.videoSampler.sampleTimes(video.duration, 0.5);
  var imported = [];
  for (var i = 0; i < times.length; i++) {
    await seek(video, times[i]);
    var item = await analyzeCanvasSource(video, times[i] * 1000, file.name);
    if (item) imported.push(item);
    $('videoImportProgress').value = (i + 1) / times.length;
    await new Promise(function (resolve) { setTimeout(resolve, 0); });
  }
  candidates = BP.videoSampler.selectCandidates(imported, {
    minGapMs: 500,
    maxCandidates: config.target * 3
  });
  renderCandidates();
  setLiveStatus(BP.videoSampler.isEnough(candidates, config.target)
    ? '视频分析完成，数据已足够'
    : '视频分析完成，有效帧仍不足');
  URL.revokeObjectURL(video.src);
  void session;
}
```

- [ ] **Step 4: 绑定导入按钮与取消状态**

```js
$('videoImportButton').onclick = function () { $('videoImportInput').click(); };
$('videoImportInput').onchange = function (event) {
  var file = event.target.files && event.target.files[0];
  if (file) importVideo(file).catch(function (e) {
    setLiveStatus(e.message || '视频导入失败');
  });
};
```

- [ ] **Step 5: 运行测试**

Run: `node tools/check-video-sampler.js`
Expected: PASS。

Run: `node tools/check-video-html.js`
Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add js/core/video-sampler.js js/pages/pc-video.js index.html tools/check-video-sampler.js
git commit -m "feat: 支持导入视频抽取最佳帧"
```

### Task 7: 集成、文档与发布

**Files:**
- Modify: `css/style.css`
- Modify: `css/mobile.css`
- Modify: `docs/measurement-session-workflow.md`
- Modify: `tools/check-pages.js`
- Modify: `tools/check-deploy.js`
- Modify: `tools/check-versions.js`
- Modify: all versioned HTML pages

- [ ] **Step 1: 完成响应式样式**

```css
.video-panel { display: grid; gap: 14px; margin-top: 18px; padding: 16px; border: 1px solid #d9e2ec; border-radius: 8px; }
.video-live-grid { display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); gap: 14px; }
.video-preview-box { position: relative; min-height: 260px; background: #0b1220; overflow: hidden; border-radius: 8px; }
#pcRemoteVideo { width: 100%; height: 100%; object-fit: contain; }
.video-candidate-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.video-candidate img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
@media (max-width: 760px) { .video-live-grid { grid-template-columns: 1fr; } }
```

```css
.stream-page { position: fixed; inset: 0; z-index: 200; display: grid; grid-template-rows: 1fr auto auto auto; gap: 12px; padding: 16px; background: #05080d; color: #fff; }
.stream-page[hidden] { display: none; }
#streamVideo { width: 100%; height: 100%; min-height: 0; object-fit: contain; background: #000; }
.stream-status.is-error { color: #ffb4b4; }
```

- [ ] **Step 2: 更新使用文档**

在 `docs/measurement-session-workflow.md` 增加：

```markdown
## 手机直播最佳帧

1. PC 端先选择测量方法、图像角色和目标帧数。
2. 点击“生成扫码连接”，手机扫码并允许摄像头。
3. 平台自动抽帧并评分；达到目标且主频稳定后提示。
4. 查看候选缩略图，确认后写入当前会话。
5. 可开启原始视频录制，录制文件只保存在 PC 本机。
6. 没有直播条件时，选择“导入视频”使用同一套抽帧逻辑。
```

- [ ] **Step 3: 扩充静态门禁**

在 `tools/check-pages.js` 中添加：

```js
check('PC 视频采集面板存在', /id="videoPanel"/.test(pc) && /pc-video\.js/.test(pc));
check('手机推流视图存在', /id="streamPage"/.test(mobile) && /mobile-stream\.js/.test(mobile));
check('视频脚本顺序正确',
  pc.indexOf('peerjs.min.js') < pc.indexOf('pc-video.js') &&
  mobile.indexOf('peerjs.min.js') < mobile.indexOf('mobile-stream.js'));
```

在 `tools/check-deploy.js` 的文件列表中增加：

```js
'js/core/video-sampler.js',
'js/pages/pc-video.js',
'js/pages/mobile-stream.js',
'vendor/peerjs.min.js',
'vendor/qrcode.min.js'
```

- [ ] **Step 4: 运行完整回归**

```powershell
node tools/check-video-sampler.js
node tools/check-video-html.js
node tools/check-sessions.js
node tools/check-fringe.js
node tools/check-reticle.js
node tools/check-pages.js
node tools/check-deploy.js
node tools/check-versions.js
node tools/check-ids.js
node tools/check-globals.js
node tools/selftest.js
```

Expected: 全部 PASS。

- [ ] **Step 5: 浏览器实测**

1. 启动本地静态服务。
2. PC 打开 `index.html`，选择比值法和钠光角色，生成二维码。
3. 模拟手机打开二维码 URL，授予摄像头权限。
4. 验证 PC 实时画面、候选数和达标提示。
5. 确认最佳帧，检查当前角色帧数增加。
6. 开启录制，停止后验证 WebM 可播放。
7. 用同一视频走“导入视频”，验证候选评分和会话写入一致。
8. 检查浏览器控制台无错误。

- [ ] **Step 6: 刷新缓存版本并提交**

先提交功能文件，取得新提交号后，将全部 `?v=` 更新为该提交号，再提交：

```powershell
git add index.html mobile.html optical.html 404.html css js vendor tools docs
git commit -m "feat: 增加手机实时视频最佳帧采集"
node tools/check-versions.js
git add index.html mobile.html optical.html 404.html
git commit -m "chore: 刷新视频采集功能缓存版本"
```

- [ ] **Step 7: 发布 gh-pages**

```powershell
git push origin fix/pure-frontend:gh-pages
```

Expected: GitHub Pages 发布成功，线上 PC 和手机入口加载新版本。
