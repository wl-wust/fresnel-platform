/* 网页与 COMSOL 解耦门禁：浏览器页面只能保留教学画布。 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const optical = fs.readFileSync(path.join(root, 'optical.html'), 'utf8');
const forbidden = [
  'js/pages/optical-comsol.js',
  'comsolView',
  'comsolModeTab',
  'canvas-mode-bar',
  'FresnelBiprism_2D_View.png',
  'FresnelBiprism_OpticalPath_Interference.png',
  'assets/optical-apparatus-setup.png'
];

let bad = 0;
for (const token of forbidden) {
  const present = optical.includes(token);
  console.log((present ? 'FAIL  ' : 'PASS  ') + '网页不包含 ' + token);
  if (present) bad += 1;
}

const cssFiles = ['css/optical_v2.css', 'css/optical-responsive.css'];
for (const rel of cssFiles) {
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  const hasComsol = /\.comsol-|canvas-mode-|data-mode="comsol"/i.test(source);
  console.log((hasComsol ? 'FAIL  ' : 'PASS  ') + rel + ' 不含 COMSOL 专用样式');
  if (hasComsol) bad += 1;
}

const deletedScript = path.join(root, 'js/pages/optical-comsol.js');
console.log((fs.existsSync(deletedScript) ? 'FAIL  ' : 'PASS  ') + '网页 COMSOL 脚本已删除');
if (fs.existsSync(deletedScript)) bad += 1;

console.log('\n' + (bad === 0 ? '网页与 COMSOL 已完全解耦' : bad + ' 项仍耦合'));
process.exit(bad === 0 ? 0 : 1);
