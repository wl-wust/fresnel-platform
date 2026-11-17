'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'mobile.html'), 'utf8');
const stream = fs.readFileSync(path.join(root, 'js/pages/mobile-stream.js'), 'utf8');
const mobileJs = fs.readFileSync(path.join(root, 'js/pages/mobile.js'), 'utf8');
const pcVideo = fs.readFileSync(path.join(root, 'js/pages/pc-video.js'), 'utf8');
const pcFringe = fs.readFileSync(path.join(root, 'js/pages/pc-fringe.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    const detail = fn();
    pass += 1;
    console.log('PASS  ' + name + (detail ? '  ' + detail : ''));
  } catch (e) {
    fail += 1;
    console.log('FAIL  ' + name + '  ' + e.message);
  }
}

check('手机推流视图与按钮', () => {
  assert(/id="streamPage"/.test(mobile));
  assert(/id="streamVideo"/.test(mobile));
  assert(/id="streamStart"/.test(mobile));
  assert(/id="streamStop"/.test(mobile));
  return 'streamPage';
});

check('手机推流脚本接入', () => {
  assert(/vendor\/peerjs\.min\.js/.test(mobile));
  assert(/js\/pages\/mobile-stream\.js/.test(mobile));
  assert(mobile.indexOf('vendor/peerjs.min.js') < mobile.indexOf('js/pages/mobile-stream.js'));
  return 'peerjs -> mobile-stream';
});

check('推流由用户手势启动', () => {
  assert(/startButton[^\n]*addEventListener\('click'/.test(stream));
  assert(/getUserMedia/.test(stream));
  assert(/facingMode/.test(stream));
  return 'click -> getUserMedia';
});

check('推流状态与断线处理', () => {
  assert(/peer\.on\('disconnected'/.test(stream));
  assert(/function handleConnectionState\(state\)/.test(stream));
  assert(/state === 'connected'/.test(stream));
  assert(/state === 'failed'/.test(stream));
  assert(/BP\.lanSignal\.createSenderConnection/.test(stream));
  assert(/streamStop/.test(stream));
  return 'LAN + PeerJS connectionstate';
});

check('PC 视频面板与脚本顺序', () => {
  assert(/id="videoPanel"/.test(pc));
  assert(/id="videoMethodSelect"/.test(pc));
  assert(/id="videoCandidateGallery"/.test(pc));
  assert(/vendor\/qrcode\.min\.js/.test(pc));
  assert(/vendor\/peerjs\.min\.js/.test(pc));
  assert(/js\/live\/lan-signaling\.js/.test(pc));
  assert(/js\/core\/video-sampler\.js/.test(pc));
  assert(pc.indexOf('lan-config.js') < pc.indexOf('js/pages/pc-video.js'));
  assert(pc.indexOf('js/live/lan-signaling.js') < pc.indexOf('js/pages/pc-video.js'));
  assert(pc.indexOf('vendor/qrcode.min.js') < pc.indexOf('js/pages/pc-video.js'));
  assert(pc.indexOf('vendor/peerjs.min.js') < pc.indexOf('js/pages/pc-video.js'));
  assert(pc.indexOf('js/core/video-sampler.js') < pc.indexOf('js/pages/pc-video.js'));
  return 'videoPanel -> pc-video';
});

check('直播录制与视频导入已接线', () => {
  assert(/id="videoRecordToggle"/.test(pc));
  assert(/id="videoImportInput"/.test(pc));
  assert(/<option value="5">5 帧（短片参考）<\/option>/.test(pc));
  assert(/MediaRecorder/.test(pcVideo));
  assert(/recordingFilename/.test(pcVideo));
  assert(/importVideo/.test(pcVideo));
  assert(/sampleTimes/.test(pcVideo));
  assert(/adaptiveGap/.test(pcVideo));
  assert(/planImportTargets/.test(pcVideo));
  assert(/qualityGate: 'standard'/.test(pcVideo));
  return 'record + adaptive import';
});

check('角色帧数、条纹数与预设来源标注', () => {
  assert(/stripeCount: item\.stripeCount/.test(pcVideo));
  assert(/meanStripeCount/.test(pcVideo));
  assert(/报告表 5\.1 预设，不是实测/.test(mobile));
  assert(/填入报告预设（非实测）/.test(pc));
  assert(/填入报告三路径（表 5\.2，非实测）/.test(mobile));
  assert(/完整分方法计算卡与大视频批量导入放在 PC 端/.test(mobile));
  return 'stripe metadata + source labels';
});

check('照片导入保留角色、来源和条纹数', () => {
  assert(/stripeCount: r\.stripeCount/.test(mobileJs));
  assert(/source: 'photo'/.test(mobileJs));
  assert(/sourceName: file\.name/.test(mobileJs));
  assert(/stripeCount: r\.stripeCount/.test(pcFringe));
  assert(/source: 'photo'/.test(pcFringe));
  assert(/sourceName: input\.files\[0\]\.name/.test(pcFringe));
  return 'mobile + PC photo metadata';
});

console.log(pass + ' pass / ' + fail + ' fail');
if (fail) process.exit(1);
