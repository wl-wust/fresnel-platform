'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'mobile.html'), 'utf8');
const stream = fs.readFileSync(path.join(root, 'js/pages/mobile-stream.js'), 'utf8');

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
  assert(/pc\.connectionState === 'connected'/.test(stream));
  assert(/streamStop/.test(stream));
  return 'connectionstate';
});

console.log(pass + ' pass / ' + fail + ' fail');
if (fail) process.exit(1);
