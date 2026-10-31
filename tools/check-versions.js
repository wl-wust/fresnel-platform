/* check-versions.js —— 三页的缓存击穿版本号必须存在且一致
 *
 * 为什么需要：GitHub Pages 无自定义响应头，改完 JS 若 ?v= 不变，手机端会继续用旧缓存。
 * 原平台就是三页各不相同（?v=3.0 / ?v=1 / ?v=4），改了手机端 JS 版本号却没变，
 * 用户浏览器一直拿旧文件（审查报告 P2-10）。
 *
 * 用法：node tools/check-versions.js
 */
const fs = require('fs');
const path = require('path');

function findRepo(start) {
  let d = path.resolve(start);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'plat_review', 'MANIFEST.sha256'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
const REPO = findRepo(__dirname);
if (!REPO) { console.log('FAIL  找不到仓库根（缺 plat_review/MANIFEST.sha256）'); process.exit(1); }

const PAGES = ['index.html', 'mobile.html', 'optical.html', '404.html'];
const versions = {};
let total = 0;

for (const page of PAGES) {
  const p = path.join(REPO, page);
  if (!fs.existsSync(p)) { console.log('SKIP  ' + page + '（不存在）'); continue; }
  const src = fs.readFileSync(p, 'utf8');
  const found = new Set([...src.matchAll(/\?v=([^"'&\s]+)/g)].map(m => m[1]));
  total += [...src.matchAll(/\?v=/g)].length;
  if (!found.size) { console.log('FAIL  ' + page + ' 没有任何 ?v= 缓存击穿参数'); versions[page] = null; continue; }
  if (found.size > 1) {
    console.log('FAIL  ' + page + ' 内部版本号不一致：' + [...found].join(' / '));
    versions[page] = 'MIXED';
    continue;
  }
  versions[page] = [...found][0];
  console.log('PASS  ' + page + '  ?v=' + versions[page]);
}

const set = new Set(Object.values(versions).filter(v => v && v !== 'MIXED'));
const problems = Object.values(versions).some(v => !v) || set.size !== 1;

console.log('\n三页版本号: ' + JSON.stringify(versions));
if (problems) {
  console.log('FAIL  版本号缺失、页内混用或跨页不一致（共 ' + total + ' 处 ?v=）');
  console.log('      修法：node tools/stamp-version.js --sha <7位提交号>');
  process.exit(1);
}
console.log('版本号统一为 ' + [...set][0] + '（共 ' + total + ' 处 ?v=）');
process.exit(0);
