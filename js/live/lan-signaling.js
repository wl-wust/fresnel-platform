/* =========================================================================
 * live/lan-signaling.js —— 局域网 WebSocket 信令与 WebRTC 连接
 * 同一 Wi-Fi 下不依赖 PeerJS，公网页面仍保留原连接方式。
 * ========================================================================= */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.BP = root.BP || {};
    root.BP.lanSignal = api;
  }
})(typeof window !== 'undefined' ? window : null, function (globalScope) {
  'use strict';

  function isLanEnabled(scope) {
    scope = scope || globalScope || {};
    return !!(scope.BP_LAN_SIGNAL && scope.BP_LAN_SIGNAL.enabled === true);
  }

  function buildSignalUrl(pageHref, signalPath, room, role, token) {
    var target = new URL(signalPath || '/lan-signal', pageHref);
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    target.search = '';
    target.searchParams.set('room', room);
    target.searchParams.set('role', role);
    target.searchParams.set('token', token);
    return target.href;
  }

  function createPeerConnection() {
    var Ctor = globalScope && globalScope.RTCPeerConnection;
    if (!Ctor) throw new Error('当前浏览器不支持 WebRTC');
    return new Ctor({ iceServers: [] });
  }

  function cleanCandidate(candidate) {
    if (!candidate) return null;
    return typeof candidate.toJSON === 'function' ? candidate.toJSON() : candidate;
  }

  function createSocket(options, handlers) {
    var signalPath = options.path || '/lan-signal';
    var href = options.href || (globalScope && globalScope.location && globalScope.location.href);
    var url = buildSignalUrl(href, signalPath, options.room, options.role, options.token);
    var socket = new globalScope.WebSocket(url);
    var closed = false;

    function finish(reason) {
      if (closed) return;
      closed = true;
      if (handlers.close) handlers.close(reason || '');
    }

    socket.addEventListener('open', function () {
      if (handlers.open) handlers.open();
    });
    socket.addEventListener('message', function (event) {
      var message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        if (handlers.error) handlers.error(new Error('信令消息格式错误'));
        return;
      }
      if (message && message.type === 'error') {
        var signalError = new Error(message.message || '局域网信令失败');
        signalError.code = message.code || '';
        if (handlers.error) handlers.error(signalError);
        return;
      }
      if (handlers.message) handlers.message(message);
    });
    socket.addEventListener('error', function () {
      if (!closed && handlers.error) handlers.error(new Error('无法连接电脑端局域网信令'));
    });
    socket.addEventListener('close', function () {
      finish('信令连接已断开');
    });

    return {
      send: function (message) {
        if (socket.readyState !== 1) return false;
        socket.send(JSON.stringify(message));
        return true;
      },
      close: function () {
        if (closed) return;
        closed = true;
        try { socket.close(1000, 'client-close'); } catch (error) { /* 已关闭时忽略 */ }
      },
      isOpen: function () {
        return socket.readyState === 1;
      },
      isClosed: function () {
        return closed;
      }
    };
  }

  function addRemoteCandidate(pc, state, candidate) {
    if (!candidate) return;
    if (!pc || !pc.remoteDescription) {
      state.pendingCandidates.push(candidate);
      return;
    }
    pc.addIceCandidate(candidate).catch(function () {
      state.pendingCandidates.push(candidate);
    });
  }

  function flushRemoteCandidates(pc, state) {
    var pending = state.pendingCandidates.splice(0);
    pending.forEach(function (candidate) {
      pc.addIceCandidate(candidate).catch(function () { /* 失效候选无需中断连接 */ });
    });
  }

  function createHostConnection(options) {
    options = options || {};
    if (!options.room || !options.token) throw new Error('局域网房间参数不完整');
    var state = {
      pendingCandidates: [],
      explicitClose: false
    };
    var pc = null;
    var channel = null;
    var factory = options.peerConnectionFactory || createPeerConnection;

    function fail(error) {
      if (options.onError) options.onError(error);
    }

    function attachPc(nextPc) {
      nextPc.addEventListener('icecandidate', function (event) {
        if (!event.candidate || !channel) return;
        channel.send({ type: 'ice', candidate: cleanCandidate(event.candidate) });
      });
      nextPc.addEventListener('track', function (event) {
        var stream = event.streams && event.streams[0];
        if (stream && options.onStream) options.onStream(stream);
      });
      nextPc.addEventListener('addstream', function (event) {
        if (event.stream && options.onStream) options.onStream(event.stream);
      });
      nextPc.addEventListener('connectionstatechange', function () {
        if (options.onState) options.onState(nextPc.connectionState);
        if (nextPc.connectionState === 'failed') fail(new Error('局域网视频连接失败，请检查 Wi-Fi'));
      });
    }

    function receiveOffer(message) {
      if (!message || !message.sdp) return;
      try {
        if (pc) {
          try { pc.close(); } catch (error) { /* 重新接收画面时重建连接 */ }
        }
        state.pendingCandidates = [];
        pc = factory();
        attachPc(pc);
        if (options.onState) options.onState('connecting');
        pc.setRemoteDescription(message.sdp).then(function () {
          flushRemoteCandidates(pc, state);
          return pc.createAnswer();
        }).then(function (answer) {
          return pc.setLocalDescription(answer).then(function () {
            channel.send({ type: 'answer', sdp: { type: answer.type, sdp: answer.sdp } });
          });
        }).catch(fail);
      } catch (error) {
        fail(error);
      }
    }

    function receive(message) {
      if (!message || !message.type) return;
      if (message.type === 'joined') {
        if (options.onOpen) options.onOpen();
      } else if (message.type === 'peer-joined') {
        if (options.onPeerJoined) options.onPeerJoined();
      } else if (message.type === 'offer') {
        receiveOffer(message);
      } else if (message.type === 'ice') {
        addRemoteCandidate(pc, state, message.candidate);
      } else if (message.type === 'peer-left') {
        if (options.onClosed) options.onClosed('手机端已断开');
      }
    }

    channel = createSocket({
      href: options.href,
      path: options.path,
      room: options.room,
      role: 'host',
      token: options.token
    }, {
      open: options.onSocketOpen,
      message: receive,
      error: fail,
      close: function (reason) {
        if (!state.explicitClose && options.onClosed) options.onClosed(reason);
      }
    });

    return {
      close: function () {
        if (state.explicitClose) return;
        state.explicitClose = true;
        if (channel) channel.send({ type: 'bye' });
        if (channel) channel.close();
        if (pc) {
          try { pc.close(); } catch (error) { /* 已关闭时忽略 */ }
        }
      },
      getPeerConnection: function () {
        return pc;
      },
      getChannel: function () {
        return channel;
      }
    };
  }

  function createSenderConnection(options) {
    options = options || {};
    if (!options.room || !options.token || !options.stream) {
      throw new Error('局域网推流参数不完整');
    }
    var state = {
      pendingCandidates: [],
      explicitClose: false,
      opened: false
    };
    var pc = null;
    var channel = null;
    var factory = options.peerConnectionFactory || createPeerConnection;
    var timeout = null;

    function fail(error) {
      if (options.onError) options.onError(error);
    }

    function startOffer() {
      if (state.opened || state.explicitClose) return;
      state.opened = true;
      if (timeout) globalScope.clearTimeout(timeout);
      try {
        pc = factory();
        pc.addEventListener('icecandidate', function (event) {
          if (!event.candidate || !channel) return;
          channel.send({ type: 'ice', candidate: cleanCandidate(event.candidate) });
        });
        pc.addEventListener('connectionstatechange', function () {
          if (options.onState) options.onState(pc.connectionState);
          if (pc.connectionState === 'failed') fail(new Error('视频连接失败，请检查 Wi-Fi'));
        });
        options.stream.getTracks().forEach(function (track) {
          pc.addTrack(track, options.stream);
        });
        if (options.onState) options.onState('connecting');
        pc.createOffer().then(function (offer) {
          return pc.setLocalDescription(offer).then(function () {
            channel.send({ type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } });
          });
        }).catch(fail);
      } catch (error) {
        fail(error);
      }
    }

    function receive(message) {
      if (!message || !message.type) return;
      if (message.type === 'joined') {
        if (options.onOpen) options.onOpen();
        startOffer();
      } else if (message.type === 'answer') {
        if (!pc || !message.sdp) return;
        pc.setRemoteDescription(message.sdp).then(function () {
          flushRemoteCandidates(pc, state);
        }).catch(fail);
      } else if (message.type === 'ice') {
        addRemoteCandidate(pc, state, message.candidate);
      } else if (message.type === 'peer-left') {
        if (options.onClosed) options.onClosed('电脑端已断开');
      }
    }

    channel = createSocket({
      href: options.href,
      path: options.path,
      room: options.room,
      role: 'sender',
      token: options.token
    }, {
      open: options.onSocketOpen,
      message: receive,
      error: fail,
      close: function (reason) {
        if (!state.explicitClose && options.onClosed) options.onClosed(reason);
      }
    });
    timeout = globalScope.setTimeout(function () {
      if (!state.opened && !state.explicitClose) {
        fail(new Error('连接电脑端超时，请重新扫码'));
      }
    }, 15000);

    return {
      close: function () {
        if (state.explicitClose) return;
        state.explicitClose = true;
        if (timeout) globalScope.clearTimeout(timeout);
        if (channel) channel.send({ type: 'bye' });
        if (channel) channel.close();
        if (pc) {
          try { pc.close(); } catch (error) { /* 已关闭时忽略 */ }
        }
      },
      replaceVideoTrack: function (track) {
        if (!pc || !track) return Promise.resolve(false);
        var sender = pc.getSenders().filter(function (item) {
          return item.track && item.track.kind === 'video';
        })[0];
        if (!sender) return Promise.resolve(false);
        return sender.replaceTrack(track).then(function () {
          return true;
        });
      },
      getPeerConnection: function () {
        return pc;
      },
      getChannel: function () {
        return channel;
      }
    };
  }

  return {
    buildSignalUrl: buildSignalUrl,
    createHostConnection: createHostConnection,
    createSenderConnection: createSenderConnection,
    isLanEnabled: isLanEnabled
  };
});
