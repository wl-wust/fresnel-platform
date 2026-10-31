/* check-p4-html.js —— 静态验收 P4 的 mobile.html（不需要真机、不需要浏览器）
 *
 * 用法：node tools/check-p4-html.js [mobile.html 路径]
 */
const fs = require('fs');
const path = require('path');

const ALT = path.resolve(__dirname);
const CANDIDATES = [
  path.resolve(__dirname, '..', 'mobile.html'),
  path.resolve(ALT, '..', 'build', 'mobile.html')
];
const file = (process.argv[2] && path.resolve(process.argv[2])) || CANDIDATES.find(p => fs.existsSync(p));
if (!file) { console.log('FAIL  找不到 mobile.html'); process.exit(1); }
const html = fs.readFileSync(file, 'utf8');

let ok = 0, bad = 0;
const hasId = id => new RegExp('\\sid="' + id + '"').test(html);
function check(name, cond, detail) {
  if (cond) { ok++; console.log('PASS  ' + name); }
  else { bad++; console.log('FAIL  ' + name + (detail ? '  ← ' + detail : '')); }
}

/* 1. 脚本只加载新实现 */
const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1].split('?')[0]);
check('① 加载 js/pages/mobile.js', srcs.indexOf('js/pages/mobile.js') >= 0, srcs.join(' '));
check('② 不再加载 js/mobile_merged.js', !/mobile_merged\.js/.test(html));
check('③ 依赖顺序：physics → fmt → ui → store → pages/mobile.js',
  (function () {
    const want = ['js/physics.js', 'js/core/fmt.js', 'js/core/ui.js', 'js/core/store.js', 'js/pages/mobile.js'];
    const seq = srcs.filter(s => want.includes(s));
    return JSON.stringify(seq) === JSON.stringify(want);
  })(), srcs.join(' → '));

/* 2. 四个页签用 data-tab（页面用 addEventListener 绑定，不靠全局 event） */
const tabs = ['capture', 'calibrate', 'analysis', 'guide'];
check('④ 四个页签 data-tab 齐全且无 inline onclick',
  tabs.every(t => new RegExp('data-tab="' + t + '"').test(html)) &&
  !/onclick="switchTab\(/.test(html));

/* 3. 相机三件 */
const camIds = ['video', 'cameraControls', 'fileInput', 'previewBox'];
check('⑤ 相机元素齐全', camIds.every(hasId), '缺: ' + camIds.filter(i => !hasId(i)).join(', '));

/* 4. 标定（含两点标定画布） */
const calIds = ['cal_k', 'cal_L', 'cal_N', 'reticleFile', 'reticleCanvas', 'retPix', 'retL', 'currentK'];
check('⑥ 标定元素齐全（含两点标定画布）', calIds.every(hasId), '缺: ' + calIds.filter(i => !hasId(i)).join(', '));

/* 5. 分析页四块 */
const anaIds = ['dataTableBody', 'uncInputs', 'combineBody', 'recordFile'];
check('⑦ 分析页四块容器齐全', anaIds.every(hasId), '缺: ' + anaIds.filter(i => !hasId(i)).join(', '));

/* 6. 三张校验卡 + record 导出导入的按钮 */
const btns = ['calcAll()', 'calcUncertainty()', 'calcWeightedCombine()', 'exportRecord()'];
check('⑧ 校验/导出按钮齐全',
  btns.every(b => new RegExp('onclick="' + b.replace(/[()]/g, '\\$&') + '"').test(html)),
  '缺: ' + btns.filter(b => html.indexOf(b) < 0).join(', '));

/* 7. 不再指向已删除的旧光学页 */
check('⑨ 指向 optical.html 而不是 optical_v2.html',
  /href="optical\.html"/.test(html) && !/optical_v2/.test(html));

console.log('\n检查文件: ' + file);
console.log((bad === 0 ? 'P4 HTML 验收通过' : 'P4 HTML 未完成') + '（' + ok + ' pass / ' + bad + ' fail）');
process.exit(bad === 0 ? 0 : 1);
