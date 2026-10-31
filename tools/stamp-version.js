/* stamp-version.js —— 把三页里所有 ?v=xxx 统一成同一个版本号（缓存击穿）
 *
 * 为什么需要：GitHub Pages 没有自定义响应头，改完 JS 后手机上会继续用旧缓存。
 * 唯一可靠的办法是每次发版改查询串。三页版本号必须**一致**，
 * 否则会出现"index 是新代码、mobile 是旧代码"的混合状态（原审查报告 P2-10 就是这样）。
 *
 * 用法：
 *   node tools/stamp-version.js                 # 版本号用打包时间（base36，7 位）
 *   node tools/stamp-version.js --sha 0c5969d   # 用 git 短哈希（推荐，能与提交对上）
 *   node tools/stamp-version.js --dir .         # 指定页面所在目录
 *
 * 只改 HTML 里的 ?v=，不动任何其他内容；改完请跑 check-versions.js。
 */
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const dir = path.resolve(arg('dir', path.join(__dirname, '..')));
let ver = arg('sha', '').trim();
if (!ver) ver = Date.now().toString(36).slice(-7);
if (!/^[0-9a-z]{4,16}$/i.test(ver)) { console.log('FAIL  版本号不合法：' + ver); process.exit(1); }

const PAGES = ['index.html', 'mobile.html', 'optical.html', '404.html'];
let changed = 0, seen = 0;

for (const page of PAGES) {
  const p = path.join(dir, page);
  if (!fs.existsSync(p)) { console.log('SKIP  ' + page + '（不存在）'); continue; }
  const src = fs.readFileSync(p, 'utf8');
  const out = src.replace(/(\?v=)[^"'&\s]+/g, (m, p1) => { seen++; return p1 + ver; });
  if (out !== src) {
    fs.writeFileSync(p, out, 'utf8');
    changed++;
    console.log('OK    ' + page + ' 已更新');
  } else {
    console.log('SKIP  ' + page + '（没有 ?v= 参数）');
  }
}

console.log('\n版本号 ' + ver + '，共处理 ' + seen + ' 处，改写 ' + changed + ' 个文件');
if (!seen) { console.log('FAIL  一处 ?v= 都没找到，三页都该有缓存击穿参数'); process.exit(1); }
