/* check-versions.js —— 缓存击穿版本号：三页必须存在、页内一致、跨页一致，且**数量对得上**
 *
 * 为什么需要（真实踩过两次）：
 *   ① GitHub Pages 无自定义响应头，改完 JS 若 ?v= 不变，手机端会继续用旧缓存；
 *      原平台三页分别是 ?v=3.0 / ?v=1 / ?v=4，改了手机端 JS 版本号没变（审查报告 P2-10）。
 *   ② 只比"跨页一致"还不够：某页少了一处 ?v=（例如手工加脚本忘了带参数），
 *      一致性检查照样通过，但那个文件从此不吃缓存击穿。所以要连**数量**一起断言。
 *
 * ⚠ 改动页面脚本/样式数量时，必须同步改下面的 EXPECT 表。
 *
 * 用法：node tools/check-versions.js
 */
const fs = require('fs');
const path = require('path');

// 每页应出现的 ?v= 处数（= 该页所有 <script src> + <link href> 的数量）
// index  : 2 css + 11 script
// mobile : 2 css +  5 script
// optical: 2 css +  9 script
// 404    : 1 css
const EXPECT = { 'index.html': 13, 'mobile.html': 7, 'optical.html': 11, '404.html': 1 };

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

let bad = 0;
const versions = {};
let total = 0;

for (const page of Object.keys(EXPECT)) {
  const p = path.join(REPO, page);
  if (!fs.existsSync(p)) { console.log('FAIL  ' + page + ' 不存在'); bad++; continue; }
  const src = fs.readFileSync(p, 'utf8');
  const all = [...src.matchAll(/\?v=([^"'&\s]+)/g)].map(m => m[1]);
  const uniq = new Set(all);
  total += all.length;

  const countOk = all.length === EXPECT[page];
  const uniform = uniq.size === 1;
  versions[page] = uniq.size === 1 ? [...uniq][0] : (uniq.size ? 'MIXED' : null);

  if (!countOk) {
    bad++;
    console.log('FAIL  ' + page + '  ?v= 数量 ' + all.length + '，应为 ' + EXPECT[page] +
                '（少的那一处会导致对应文件不吃缓存击穿）');
  } else if (!uniform) {
    bad++;
    console.log('FAIL  ' + page + '  页内版本号不一致：' + [...uniq].join(' / '));
  } else {
    console.log('PASS  ' + page + '  ?v=' + versions[page] + '（' + all.length + ' 处）');
  }
}

const set = new Set(Object.values(versions).filter(v => v && v !== 'MIXED'));
console.log('\n各页版本号: ' + JSON.stringify(versions));
if (set.size !== 1) {
  bad++;
  console.log('FAIL  跨页版本号不一致（应全部相同）');
}

if (bad) {
  console.log('\nFAIL  共 ' + bad + ' 项问题（总计 ' + total + ' 处 ?v=，应为 ' +
              Object.values(EXPECT).reduce((a, b) => a + b, 0) + ' 处）');
  console.log('      修法：node tools/stamp-version.js --sha <7位提交号>');
  process.exit(1);
}
console.log('版本号统一为 ' + [...set][0] + '（共 ' + total + ' 处 ?v=，与预期一致）');
process.exit(0);
