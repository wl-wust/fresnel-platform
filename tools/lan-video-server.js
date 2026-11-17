/*
 * lan-video-server.js —— 局域网 HTTPS 静态服务与 WebRTC 信令
 * 用法：node tools/lan-video-server.js --pfx .runtime/fresnel-local.pfx --password ***
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SIGNAL_PATH = '/lan-signal';
const MAX_MESSAGE_BYTES = 512 * 1024;
const ALLOWED_ENTRIES = new Set([
  'index.html',
  'mobile.html',
  'optical.html',
  'report.html',
  '404.html',
  'lan-config.js',
  'favicon.ico',
  'css',
  'js',
  'vendor',
  'assets',
  'data'
]);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm'
};

function resolveStaticPath(urlPath, root) {
  const base = path.resolve(root || DEFAULT_ROOT);
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath || '/').split('?')[0]);
  } catch (error) {
    return null;
  }
  if (!decoded || decoded.indexOf('\0') >= 0) return null;
  decoded = decoded.replace(/\\/g, '/');
  if (decoded === '/') decoded = '/index.html';
  if (decoded.charAt(0) === '/') decoded = decoded.slice(1);
  const parts = decoded.split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.charAt(0) === '.')) {
    return null;
  }
  if (!ALLOWED_ENTRIES.has(parts[0])) return null;
  const target = path.resolve(base, parts.join(path.sep));
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

class SignalHub {
  constructor() {
    this.rooms = new Map();
  }

  join(room, role, token, connection) {
    room = String(room || '');
    role = String(role || '');
    token = String(token || '');
    if (!/^fp-[a-z0-9]{6,40}$/i.test(room)) {
      return this.reject(connection, 'bad-room', '连接编号无效');
    }
    if (role !== 'host' && role !== 'sender') {
      return this.reject(connection, 'bad-role', '连接角色无效');
    }
    if (token.length < 16 || token.length > 128) {
      return this.reject(connection, 'bad-token', '连接令牌无效');
    }

    let state = this.rooms.get(room);
    if (!state) {
      state = { host: null, sender: null, token: '' };
      this.rooms.set(room, state);
    }
    if (role === 'host') {
      if (state.host && state.host !== connection) state.host.close(4001, 'host-replaced');
      state.host = connection;
      state.token = token;
    } else {
      if (!state.host) return this.reject(connection, 'no-host', '电脑端尚未连接');
      if (token !== state.token) return this.reject(connection, 'bad-token', '连接令牌不匹配');
      if (state.sender && state.sender !== connection) state.sender.close(4001, 'sender-replaced');
      state.sender = connection;
    }
    connection.room = room;
    connection.role = role;
    connection.send({ type: 'joined', role });
    const other = role === 'host' ? state.sender : state.host;
    if (other) other.send({ type: 'peer-joined', role });
    return true;
  }

  relay(connection, message) {
    if (!connection || !connection.room || !message || typeof message !== 'object') return false;
    const state = this.rooms.get(connection.room);
    if (!state) return false;
    const target = connection.role === 'sender' ? state.host : state.sender;
    if (!target) return false;
    if (message.type === 'offer') {
      if (connection.role !== 'sender' || !message.sdp) return false;
      target.send({ type: 'offer', sdp: message.sdp });
      return true;
    }
    if (message.type === 'answer') {
      if (connection.role !== 'host' || !message.sdp) return false;
      target.send({ type: 'answer', sdp: message.sdp });
      return true;
    }
    if (message.type === 'ice') {
      if (!message.candidate) return false;
      target.send({ type: 'ice', candidate: message.candidate });
      return true;
    }
    if (message.type === 'bye') {
      target.send({ type: 'peer-left' });
      return true;
    }
    return false;
  }

  leave(connection) {
    if (!connection || !connection.room) return;
    const state = this.rooms.get(connection.room);
    if (!state) return;
    if (state.host === connection) {
      state.host = null;
      if (state.sender) state.sender.send({ type: 'peer-left' });
    }
    if (state.sender === connection) {
      state.sender = null;
      if (state.host) state.host.send({ type: 'peer-left' });
    }
    if (!state.host && !state.sender) this.rooms.delete(connection.room);
    connection.room = '';
    connection.role = '';
  }

  reject(connection, code, message) {
    connection.send({ type: 'error', code, message });
    setTimeout(() => connection.close(4003, code), 20);
    return false;
  }
}

function websocketFrame(payload, opcode) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ''), 'utf8');
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | (opcode || 1), body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode || 1);
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode || 1);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, body]);
}

function createSocketConnection(socket, hub) {
  let closed = false;
  let buffer = Buffer.alloc(0);
  let fragmentOpcode = 0;
  let fragments = [];

  const connection = {
    room: '',
    role: '',
    send(message) {
      if (closed || socket.destroyed) return false;
      try {
        const payload = Buffer.isBuffer(message) ? message : Buffer.from(JSON.stringify(message), 'utf8');
        socket.write(websocketFrame(payload, 1));
        return true;
      } catch (error) {
        return false;
      }
    },
    close(code, reason) {
      if (closed) return;
      closed = true;
      const safeReason = Buffer.from(String(reason || '').slice(0, 100), 'utf8');
      const body = Buffer.alloc(2 + safeReason.length);
      body.writeUInt16BE(code || 1000, 0);
      safeReason.copy(body, 2);
      try {
        socket.write(websocketFrame(body, 8));
        socket.end();
      } catch (error) {
        socket.destroy();
      }
      hub.leave(connection);
    }
  };

  function consumeFrames(final) {
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const isFinal = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (!masked) return connection.close(1002, 'client-mask-required');
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const large = buffer.readBigUInt64BE(2);
        if (large > BigInt(MAX_MESSAGE_BYTES)) return connection.close(1009, 'too-large');
        length = Number(large);
        offset = 10;
      }
      if (length > MAX_MESSAGE_BYTES) return connection.close(1009, 'too-large');
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
      buffer = buffer.subarray(offset + length);

      if (opcode === 8 || opcode === 9 || opcode === 10) {
        handleControl(opcode, payload);
        continue;
      }
      if (opcode === 1 || opcode === 2) {
        if (fragmentOpcode) return connection.close(1002, 'fragment-order');
        fragmentOpcode = opcode;
        fragments = [payload];
      } else if (opcode === 0) {
        if (!fragmentOpcode) return connection.close(1002, 'unexpected-continuation');
        fragments.push(payload);
      } else {
        return connection.close(1002, 'bad-opcode');
      }
      if (isFinal) {
        const payloadAll = Buffer.concat(fragments);
        const messageOpcode = fragmentOpcode;
        fragmentOpcode = 0;
        fragments = [];
        if (payloadAll.length > MAX_MESSAGE_BYTES) return connection.close(1009, 'too-large');
        if (messageOpcode === 1) dispatch(payloadAll.toString('utf8'));
      }
    }
    if (final && buffer.length) connection.close(1002, 'truncated-frame');
  }

  function handleControl(opcode, payload) {
    if (opcode === 8) {
      connection.close(1000, '');
    } else if (opcode === 9) {
      if (!closed) socket.write(websocketFrame(payload, 10));
    }
  }

  function dispatch(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      connection.send({ type: 'error', code: 'bad-json', message: '信令消息格式错误' });
      return;
    }
    if (!message || typeof message !== 'object') return;
    hub.relay(connection, message);
  }

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    consumeFrames(false);
  });
  socket.on('end', () => {
    if (!closed) {
      closed = true;
      hub.leave(connection);
    }
  });
  socket.on('error', () => {
    if (!closed) {
      closed = true;
      hub.leave(connection);
    }
  });

  return connection;
}

function attachWebSocketServer(server, hub, logger) {
  server.on('upgrade', (request, socket) => {
    let parsed;
    try {
      parsed = new URL(request.url, 'http://localhost');
    } catch (error) {
      socket.destroy();
      return;
    }
    if (parsed.pathname !== SIGNAL_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = request.headers['sec-websocket-key'];
    if (!key || String(request.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + accept,
      '\r\n'
    ].join('\r\n'));
    socket.setNoDelay(true);

    const connection = createSocketConnection(socket, hub);
    const joined = hub.join(
      parsed.searchParams.get('room'),
      parsed.searchParams.get('role'),
      parsed.searchParams.get('token'),
      connection
    );
    if (logger) {
      logger('signal join ' + (joined ? 'ok' : 'rejected') + ' room=' + parsed.searchParams.get('room'));
    }
  });
}

function lanAddressScore(item) {
  const address = item && item.address ? item.address : '';
  if (/^192\.168\./.test(address)) return 0;
  if (/^10\./.test(address)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}

function selectLanAddress(preferred) {
  const addresses = lanAddresses();
  if (preferred) {
    const current = addresses.find((item) => item.address === preferred);
    if (current) return current.address;
  }
  const selected = addresses
    .slice()
    .sort((left, right) => {
      const scoreDiff = lanAddressScore(left) - lanAddressScore(right);
      if (scoreDiff) return scoreDiff;
      return left.name.localeCompare(right.name);
    })[0];
  return selected ? selected.address : '';
}

function buildLanConfig(lanHost, port) {
  const config = {
    enabled: Boolean(lanHost),
    websocketPath: SIGNAL_PATH,
    lanHost: lanHost || '',
    lanPort: Number(port) || 52224
  };
  return 'window.BP_LAN_SIGNAL=' + JSON.stringify(config).replace(/</g, '\\u003c') + ';\n';
}

function sendStatic(request, response, root, options) {
  const staticOptions = options || {};
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  const pathname = String(request.url || '/').split('?')[0];
  if (pathname === '/lan-config.js') {
    const lanHost = selectLanAddress(staticOptions.preferredLanHost);
    const body = buildLanConfig(lanHost, staticOptions.port);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES['.js'],
      'Cache-Control': 'no-store'
    });
    response.end(request.method === 'HEAD' ? undefined : body);
    return;
  }
  const target = resolveStaticPath(request.url, root);
  if (!target) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }
  fs.stat(target, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }
    const type = MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': type.indexOf('text/html') >= 0 ? 'no-cache' : 'public, max-age=60'
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fs.createReadStream(target).on('error', () => response.destroy()).pipe(response);
  });
}

function createLanServer(options) {
  const opts = options || {};
  const root = path.resolve(opts.root || DEFAULT_ROOT);
  const hub = opts.hub || new SignalHub();
  const handler = (request, response) => sendStatic(request, response, root, {
    preferredLanHost: opts.lanHost,
    port: opts.port
  });
  const server = opts.tlsOptions
    ? https.createServer(opts.tlsOptions, handler)
    : http.createServer(handler);
  attachWebSocketServer(server, hub, opts.logger);
  server.signalHub = hub;
  return server;
}

function lanAddresses() {
  const result = [];
  const interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach((name) => {
    (interfaces[name] || []).forEach((item) => {
      if (item.family === 'IPv4' && !item.internal) result.push({ name, address: item.address });
    });
  });
  return result;
}

function parseArgs(argv) {
  const result = { port: 52224, root: DEFAULT_ROOT };
  for (let index = 2; index < argv.length; index++) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--pfx') { result.pfx = value; index++; }
    else if (key === '--password') { result.password = value; index++; }
    else if (key === '--port') { result.port = Number(value) || 52224; index++; }
    else if (key === '--root') { result.root = path.resolve(value); index++; }
    else if (key === '--lan-ip') { result.lanHost = value; index++; }
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.pfx || !fs.existsSync(args.pfx)) {
    console.error('缺少本地证书。请运行 start-lan-video.cmd 启动。');
    process.exit(1);
  }
  const tlsOptions = {
    pfx: fs.readFileSync(args.pfx),
    passphrase: args.password || ''
  };
  const server = createLanServer({
    root: args.root,
    port: args.port,
    lanHost: args.lanHost,
    tlsOptions,
    logger: (text) => console.log('[' + new Date().toLocaleTimeString() + '] ' + text)
  });
  server.on('error', (error) => {
    console.error('局域网视频服务启动失败：' + error.message);
    process.exitCode = 1;
  });
  server.listen(args.port, '0.0.0.0', () => {
    console.log('局域网视频服务已启动：');
    lanAddresses().forEach((item) => {
      console.log('  ' + item.name + '  https://' + item.address + ':' + args.port + '/');
    });
    console.log('  PC 固定入口  https://localhost:' + args.port + '/');
    console.log('手机与电脑需连接同一个 Wi-Fi。首次打开需接受本地证书提示。');
  });
}

if (require.main === module) main();

module.exports = {
  SignalHub,
  buildLanConfig,
  createLanServer,
  lanAddresses,
  resolveStaticPath,
  selectLanAddress
};
