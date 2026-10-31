/* check-p1-html.js —— 静态验收 P1 的 6 处 index.html 改动（不需要浏览器）
 *
 * 为什么需要：P1 的 OOM 是"PC 页在浏览器里真的跑到纯前端实现"，而这一点过去三轮
 * 都靠"check-ids 输出"口头确认。这个脚本把 6 处改动逐条变成可机器判定的断言：
 * 少一处、错一个默认值、漏一个 script 顺序，都会 FAIL 并指出具体是哪一条。
 *
 * 用法：node tools/check-p1-html.js            （或 node plat_review/tools/check-p1-html.js）
 *       全 PASS → 退出码 0
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');            // 仓库根（tools/ → ..）
const ALT = path.resolve(__dirname);                   // 设计侧兜底
const CANDIDATES = [
  path.join(ROOT, 'index.html'),
  path.join(ALT, '..', 'index.html'),
  path.join(ALT, '..', 'site', 'index.html')           // 未修改的审查快照（应当大面积 FAIL）
];
// 可选参数：node tools/check-p1-html.js <index.html 路径>（本机自验时用）
const argvFile = process.argv[2] ? path.resolve(process.argv[2]) : null;
const file = argvFile || CANDIDATES.find(p => fs.existsSync(p));
if (!file) { console.log('FAIL  找不到 index.html'); process.exit(1); }
const html = fs.readFileSync(file, 'utf8');

let ok = 0, bad = 0;
function check(name, cond, detail) {
  if (cond) { ok++; console.log('PASS  ' + name); }
  else { bad++; console.log('FAIL  ' + name + (detail ? '  ← ' + detail : '')); }
}

// 取某个 id 的 <input> 的 value 属性
function valueOf(id) {
  const m = new RegExp('id="' + id + '"[^>]*').exec(html);
  if (!m) return null;
  const v = /value="([^"]*)"/.exec(m[0]);
  return v ? v[1] : null;
}
const hasId = id => new RegExp('\\sid="' + id + '"').test(html);

/* 1. 干掉 Chart.js 与旧业务脚本 */
check('① 已移除 lib/chart.umd.min.js', !/chart\.umd\.min\.js/.test(html));
check('② 已移除 js/main_pure.js', !/main_pure\.js/.test(html));

/* 2. 8 个 script 按 §1.4 顺序加载 */
const wanted = ['js/physics.js', 'js/core/fmt.js', 'js/core/ui.js', 'js/core/store.js',
                'js/core/fit.js', 'js/core/plot.js', 'js/core/api.js', 'js/pages/pc.js'];
const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map(m => m[1].split('?')[0].replace(/^\.\//, ''));
const seq = srcs.filter(s => wanted.includes(s));
check('③ 8 个模块全部加载且顺序正确', JSON.stringify(seq) === JSON.stringify(wanted),
      '实际: ' + (seq.join(' → ') || '无') + '｜缺: ' + wanted.filter(w => !seq.includes(w)).join(',') || '无');

/* 3. 四个此前不存在的 id（check-ids 报的那四个） */
const newIds = ['n_na', 'n_ref', 'fitResiduals', 'compareTable'];
check('④ 新增的 4 个容器/输入存在', newIds.every(hasId),
      '缺: ' + newIds.filter(id => !hasId(id)).join(', '));

/* 4. 波长卡默认值换成表 5.1（现状首屏给 80 nm） */
const defaults = { d_value: '0.90213', D_value: '1000', pixel_size: '0.004', fringe_period_px: '163.3' };
const wrong = Object.keys(defaults).filter(id => valueOf(id) !== defaults[id]);
check('⑤ 波长卡 4 个默认值 = 表 5.1', wrong.length === 0,
      wrong.map(id => id + '=' + valueOf(id) + '（应 ' + defaults[id] + '）').join('; '));

/* 5. 折射率默认值 */
const nWrong = [['n_na', '1.5168'], ['n_ref', '1.5145']].filter(p => valueOf(p[0]) !== p[1]);
check('⑥ 折射率默认 1.5168 / 1.5145', nWrong.length === 0,
      nWrong.map(p => p[0] + '=' + valueOf(p[0])).join('; '));

/* 6. 两个"一键填入"按钮 */
check('⑦ 存在 fillReportParams() 按钮', /onclick="fillReportParams\(\)"/.test(html));
check('⑧ 存在 fillReportPaths() 按钮', /onclick="fillReportPaths\(\)"/.test(html));

/* 7. 页签不再依赖 inline onclick（pc.js 用 addEventListener 绑定 .tab） */
check('⑨ 页签按钮保留 data-tab（pc.js 据此绑定）', /data-tab="analysis"/.test(html));

console.log('\n检查文件: ' + file);
console.log((bad === 0 ? 'P1 HTML 验收通过' : 'P1 HTML 未完成') +
            '（' + ok + ' pass / ' + bad + ' fail）');
process.exit(bad === 0 ? 0 : 1);
