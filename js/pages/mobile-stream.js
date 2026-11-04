/* =========================================================================
 * pages/mobile-stream.js —— 手机扫码后的摄像头推流页
 * 依赖：vendor/peerjs.min.js
 * ========================================================================= */
(function (global) {
  'use strict';

  var params = new URLSearchParams(global.location.search);
  if (params.get('stream') !== '1') return;

  var room = params.get('room') || '';
  var token = params.get('token') || '';
  var video = document.getElementById('streamVideo');
  var statusText = document.getElementById('streamStatus');
  var meta = document.getElementById('streamMeta');
  var connection = document.getElementById('streamConnection');
  var startButton = document.getElementById('streamStart');
  var switchButton = document.getElementById('streamSwitch');
  var stopButton = document.getElementById('streamStop');
  var stream = null;
  var peer = null;
  var call = null;
  var facing = 'environment';
  var starting = false;
  var switching = false;
  var stopping = false;
  var signalingTimer = null;

  var ERROR_TEXT = {
    'browser-incompatible': '当前浏览器不支持 WebRTC',
    'network': '无法连接信令服务器，请检查网络',
    'server-error': '信令服务器暂时不可用',
    'unavailable-id': '连接编号冲突，请重新扫码',
    'peer-unavailable': '电脑端连接已失效，请重新扫码',
    'ssl-unavailable': '当前页面不是 HTTPS，无法推流'
  };

  document.body.classList.add('stream-mode');
  document.getElementById('streamPage').hidden = false;

  function setStatus(text, error) {
    statusText.textContent = text;
    statusText.classList.toggle('is-error', !!error);
  }

  function setConnection(text, live) {
    connection.textContent = text;
    connection.classList.toggle('is-live', !!live);
  }

  function setStarted(started) {
    startButton.hidden = started;
    switchButton.hidden = !started;
    stopButton.hidden = !started;
    startButton.disabled = false;
  }

  function updateMeta() {
    var track = stream && stream.getVideoTracks()[0];
    var settings = track && track.getSettings ? track.getSettings() : {};
    var width = settings.width || video.videoWidth;
    var height = settings.height || video.videoHeight;
    var fps = settings.frameRate ? Math.round(settings.frameRate) : null;
    var parts = [];
    if (width && height) parts.push(width + ' × ' + height);
    if (fps) parts.push(fps + ' fps');
    parts.push(facing === 'environment' ? '后置镜头' : '前置镜头');
    meta.textContent = parts.join(' · ');
  }

  function cameraError(error) {
    if (!global.isSecureContext) return '相机需要 HTTPS，请从扫码链接打开';
    if (!error) return '无法打开摄像头';
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return '未获得相机权限，请在浏览器设置中允许后重试';
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return '未找到可用摄像头';
    }
    if (error.name === 'NotReadableError') return '摄像头被其他应用占用';
    return error.message || '无法打开摄像头';
  }

  function acquireCamera(nextFacing) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('当前浏览器不支持实时摄像头'));
    }
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: nextFacing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 }
      }
    });
  }

  function stopTracks(target) {
    if (!target) return;
    target.getTracks().forEach(function (track) { track.stop(); });
  }

  function clearSignalingTimer() {
    if (signalingTimer) global.clearTimeout(signalingTimer);
    signalingTimer = null;
  }

  function stop(reason) {
    if (stopping) return;
    stopping = true;
    clearSignalingTimer();
    if (call) {
      try { call.close(); } catch (e) { /* 已断开时忽略 */ }
    }
    if (peer) {
      try { peer.destroy(); } catch (e2) { /* 已销毁时忽略 */ }
    }
    stopTracks(stream);
    stream = null;
    peer = null;
    call = null;
    starting = false;
    video.srcObject = null;
    setStarted(false);
    setConnection('未连接', false);
    setStatus(reason || '推流已停止，可重新开启', false);
    meta.textContent = '摄像头尚未启动';
    stopping = false;
  }

  function watchConnection() {
    if (!call || !call.peerConnection) {
      setStatus('已开始向电脑传输画面');
      return;
    }
    var pc = call.peerConnection;
    pc.addEventListener('connectionstatechange', function () {
      if (stopping) return;
      if (pc.connectionState === 'connected') {
        setConnection('已连接', true);
        setStatus('画面正在向电脑传输');
        if (navigator.vibrate) navigator.vibrate(60);
      } else if (pc.connectionState === 'connecting') {
        setConnection('连接中', false);
        setStatus('正在建立点对点视频连接…');
      } else if (pc.connectionState === 'disconnected') {
        setConnection('连接中断', false);
        setStatus('网络暂时中断，正在尝试恢复…', true);
      } else if (pc.connectionState === 'failed') {
        setConnection('连接失败', false);
        setStatus('连接失败，请确认手机和电脑网络可用后重新扫码', true);
      }
    });
  }

  function signalPeer() {
    if (!global.Peer) throw new Error('PeerJS 组件未加载，请刷新页面');
    peer = new global.Peer({
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      }
    });
    peer.on('open', function () {
      if (stopping) return;
      clearSignalingTimer();
      if (call) return;
      setStatus('已连上信令服务器，正在呼叫电脑…');
      call = peer.call(room, stream, { metadata: { token: token } });
      if (!call) {
        setConnection('呼叫失败', false);
        setStatus('无法建立视频连接，请在电脑端重新生成二维码', true);
        return;
      }
      call.on('close', function () {
        if (!stopping) stop('电脑端已断开连接');
      });
      call.on('error', function (error) {
        if (!stopping) stop(error.message || '视频连接失败');
      });
      watchConnection();
    });
    peer.on('error', function (error) {
      if (stopping) return;
      setConnection('连接失败', false);
      setStatus(ERROR_TEXT[error.type] || error.message || '信令连接失败', true);
    });
    peer.on('disconnected', function () {
      if (stopping || !peer) return;
      setConnection('正在恢复', false);
      setStatus('信令连接中断，正在尝试恢复…', true);
      global.setTimeout(function () {
        if (!stopping && peer && !peer.destroyed) {
          try { peer.reconnect(); } catch (e) { /* 恢复失败时保留当前提示 */ }
        }
      }, 1500);
    });
    signalingTimer = global.setTimeout(function () {
      if (!stopping && peer && !peer.open) stop('连接信令服务器超时，请重试');
    }, 15000);
  }

  async function start() {
    if (starting || stopping) return;
    if (!room || !token) {
      setStatus('扫码链接不完整，请回到电脑端重新生成二维码', true);
      return;
    }
    starting = true;
    startButton.disabled = true;
    setConnection('启动中', false);
    setStatus('正在请求摄像头权限…');
    try {
      stream = await acquireCamera(facing);
      video.srcObject = stream;
      await video.play();
      updateMeta();
      setStarted(true);
      setStatus('摄像头已开启，正在连接电脑…');
      signalPeer();
    } catch (error) {
      stop(cameraError(error));
    } finally {
      starting = false;
    }
  }

  async function switchCamera() {
    if (!stream || switching || !call || !call.peerConnection) return;
    switching = true;
    switchButton.disabled = true;
    var oldStream = stream;
    var nextFacing = facing === 'environment' ? 'user' : 'environment';
    try {
      var nextStream = await acquireCamera(nextFacing);
      var nextTrack = nextStream.getVideoTracks()[0];
      var sender = call.peerConnection.getSenders().filter(function (item) {
        return item.track && item.track.kind === 'video';
      })[0];
      if (!sender || !sender.replaceTrack) {
        stopTracks(nextStream);
        throw new Error('当前浏览器不支持直播中切换镜头');
      }
      await sender.replaceTrack(nextTrack);
      stream = nextStream;
      facing = nextFacing;
      video.srcObject = nextStream;
      await video.play();
      stopTracks(oldStream);
      updateMeta();
      setStatus('镜头已切换，画面继续传输');
    } catch (error) {
      setStatus(cameraError(error), true);
    } finally {
      switching = false;
      switchButton.disabled = false;
    }
  }

  startButton.addEventListener('click', start);
  switchButton.addEventListener('click', switchCamera);
  stopButton.addEventListener('click', function () { stop(); });
  video.addEventListener('loadedmetadata', updateMeta);
  global.addEventListener('pagehide', function () { stop(''); });
})(window);
