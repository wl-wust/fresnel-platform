/* check-p2-html.js —— 静态验收 P2 的 index.html 改动（不需要浏览器）
 *
 * 用法：node tools/check-p2-html.js [index.html 路径]
 *       不传参数时找 仓库根/index.html
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ALT = path.resolve(__dirname);
const CANDIDATES = [
  path.join(ROOT, 'index.html'),
  path.join(ALT, '..', 'index.html'),
  path.join(ALT, '..', 'build', 'index.html'),
  path.join(ALT, '..', 'site', 'index.html')
];
const file = (process.argv[2] && path.resolve(process.argv[2])) || CANDIDATES.find(p => fs.existsSync(p));
if (!file) { console.log('FAIL  找不到 index.html'); process.exit(1); }
const html = fs.readFileSync(file, 'utf8');

let ok = 0, bad = 0;
const hasId = id => new RegExp('\\sid="' + id + '"').test(html);
function check(name, cond, detail) {
  if (cond) { ok++; console.log('PASS  ' + name); }
  else { bad++; console.log('FAIL  ' + name + (detail ? '  ← ' + detail : '')); }
}

/* 1. pc-unc.js 必须加载，且在 pc.js 之后 */
const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map(m => m[1].split('?')[0].replace(/^\.\//, ''));
const i1 = srcs.indexOf('js/pages/pc.js'), i2 = srcs.indexOf('js/pages/pc-unc.js');
check('① 加载 js/pages/pc-unc.js 且在 pc.js 之后', i2 > i1 && i1 >= 0,
      'pc.js@' + i1 + ' pc-unc.js@' + i2);

/* 2. 表 8.1 八分量页的结构（八行由 pc-unc.js 用 budgetPreset() 生成） */
check('② 存在八分量表体 #u81Body', hasId('u81Body'));
check('③ 存在折叠结果区 #u81Result', hasId('u81Result'));
check('④ 存在 u(d)/d 显示区 #u81Fold', hasId('u81Fold'));
check('⑤ 存在三个 P2 按钮',
      /onclick="fill81Defaults\(\)"/.test(html) && /onclick="calc81\(\)"/.test(html) &&
      /onclick="calcL3\(\)"/.test(html));

/* 3. Δx–L₃ 斜率法卡 */
const l3 = ['l3Table', 'l3Body', 'l3_d', 'l3Result', 'l3ChartContainer', 'l3Chart'];
check('⑥ Δx–L₃ 卡的 6 个元素齐全', l3.every(hasId), '缺: ' + l3.filter(id => !hasId(id)).join(', '));

/* 4. A 类没被 P2 改坏 */
check('⑦ A 类仍可用（#uncTable + #uncertaintyResult）', hasId('uncTable') && hasId('uncertaintyResult'));
check('⑧ A 类按钮仍指向 pc.js 的 calcUncertaintyTable', /onclick="calcUncertaintyTable\(\)"/.test(html));

/* 5. P1 的成果不能被回退 */
check('⑨ 仍无 chart.umd.min.js / main_pure.js',
      !/chart\.umd\.min\.js/.test(html) && !/main_pure\.js/.test(html));

console.log('\n检查文件: ' + file);
console.log((bad === 0 ? 'P2 HTML 验收通过' : 'P2 HTML 未完成') +
            '（' + ok + ' pass / ' + bad + ' fail）');
process.exit(bad === 0 ? 0 : 1);
