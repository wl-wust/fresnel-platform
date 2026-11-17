/*
 * check-lan-signaling.js —— 局域网视频信令回归测试
 * 用法：node tools/check-lan-signaling.js
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let LAN;

try {
  LAN = require('./lan-video-server.js');
} catch (error) {
  console.error('无法加载 tools/lan-video-server.js：' + error.message);
  process.exit(1);
}

function once(target, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 ' + event + ' 超时')), 3000);
    target.addEventListener(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    }, { once: true });
  });
}

function send(socket, message) {
  socket.send(JSON.stringify(message));
}

async function receiveJson(socket) {
  const event = await once(socket, 'message');
  return JSON.parse(String(event.data));
}

async function main() {
  assert.strictEqual(LAN.resolveStaticPath('/index.html'), path.join(ROOT, 'index.html'));
  assert.strictEqual(LAN.resolveStaticPath('/../.git/config'), null);
  assert.strictEqual(LAN.resolveStaticPath('/tools/lan-video-server.js'), null);

  const server = LAN.createLanServer({ root: ROOT });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const wsBase = 'ws://127.0.0.1:' + port + '/lan-signal';
  const token = '0123456789abcdef0123456789abcdef';
  const host = new WebSocket(wsBase + '?room=fp-testroom&role=host&token=' + token);
  await once(host, 'open');
  assert.strictEqual((await receiveJson(host)).type, 'joined');

  const bad = new WebSocket(wsBase + '?room=fp-testroom&role=sender&token=wrong-token-0123456789abcdef');
  await once(bad, 'open');
  const badReply = await receiveJson(bad);
  assert.strictEqual(badReply.type, 'error');
  assert.strictEqual(badReply.code, 'bad-token');

  const sender = new WebSocket(wsBase + '?room=fp-testroom&role=sender&token=' + token);
  await once(sender, 'open');
  assert.strictEqual((await receiveJson(sender)).type, 'joined');
  assert.strictEqual((await receiveJson(host)).type, 'peer-joined');
  send(sender, { type: 'offer', sdp: { type: 'offer', sdp: 'mobile-offer' } });
  const offer = await receiveJson(host);
  assert.strictEqual(offer.type, 'offer');
  assert.strictEqual(offer.sdp.sdp, 'mobile-offer');

  send(host, { type: 'answer', sdp: { type: 'answer', sdp: 'pc-answer' } });
  const answer = await receiveJson(sender);
  assert.strictEqual(answer.type, 'answer');
  assert.strictEqual(answer.sdp.sdp, 'pc-answer');

  host.close();
  sender.close();
  await new Promise((resolve) => server.close(resolve));
  console.log('全部通过（局域网信令 11 项）');
}

main().catch((error) => {
  console.error('FAIL ' + (error.stack || error.message));
  process.exit(1);
});
