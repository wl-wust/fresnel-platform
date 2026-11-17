/*
 * check-lan-client.js —— 局域网视频前端接线检查
 * 用法：node tools/check-lan-client.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let LAN;
try {
  LAN = require('../js/live/lan-signaling.js');
} catch (error) {
  console.error('无法加载 js/live/lan-signaling.js：' + error.message);
  process.exit(1);
}

const url = LAN.buildSignalUrl(
  'https://10.87.219.54:52224/index.html',
  '/lan-signal',
  'fp-0123456789ab',
  'host',
  '0123456789abcdef0123456789abcdef'
);
assert.strictEqual(
  url,
  'wss://10.87.219.54:52224/lan-signal?room=fp-0123456789ab&role=host&token=0123456789abcdef0123456789abcdef'
);
assert.strictEqual(LAN.isLanEnabled({ BP_LAN_SIGNAL: { enabled: true } }), true);
assert.strictEqual(LAN.isLanEnabled({ BP_LAN_SIGNAL: { enabled: false } }), false);
assert.strictEqual(LAN.isLanEnabled({}), false);

const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mobile = fs.readFileSync(path.join(ROOT, 'mobile.html'), 'utf8');
const pcVideo = fs.readFileSync(path.join(ROOT, 'js/pages/pc-video.js'), 'utf8');
const mobileStream = fs.readFileSync(path.join(ROOT, 'js/pages/mobile-stream.js'), 'utf8');
const launcher = fs.readFileSync(path.join(ROOT, 'start-lan-video.ps1'), 'utf8');
const launcherCmd = fs.readFileSync(path.join(ROOT, 'start-lan-video.cmd'), 'utf8');
const installer = fs.readFileSync(path.join(ROOT, 'install-lan-autostart.ps1'), 'utf8');
[
  [index, 'js/pages/pc-video.js'],
  [mobile, 'js/pages/mobile-stream.js']
].forEach(([html, pageScript]) => {
  assert(html.indexOf('lan-config.js') < html.indexOf('js/live/lan-signaling.js'));
  assert(html.indexOf('js/live/lan-signaling.js') < html.indexOf(pageScript));
});
assert(/LAN 局域网/.test(index));
assert(/同一 Wi-Fi/.test(index));
assert(/BP\.lanSignal\.createHostConnection/.test(pcVideo));
assert(/BP\.lanSignal\.createSenderConnection/.test(mobileStream));
assert(/baseUrl/.test(pcVideo));
assert(/New-SelfSignedCertificate/.test(launcher));
assert(/Export-PfxCertificate/.test(launcher));
assert(/lan-video-server\.js/.test(launcher));
assert(/-NoBrowser/.test(launcher));
assert(/-KeepAlive/.test(launcher));
assert(/start-lan-video\.ps1/.test(launcherCmd));
assert(/Register-ScheduledTask/.test(installer));
assert(/AtLogOn/.test(installer));

console.log('全部通过（局域网前端接线 26 项）');
