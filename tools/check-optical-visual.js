/* check-optical-visual.js —— 光学工程线稿的纯 Node 门禁 */
const path = require('path');
const visual = require(path.resolve(__dirname, '../js/pages/optical-visual.js'));

let ok = 0;
let bad = 0;
function check(name, condition, detail) {
  if (condition) {
    ok += 1;
    console.log('PASS  ' + name + (detail ? '  ' + detail : ''));
  } else {
    bad += 1;
    console.log('FAIL  ' + name + (detail ? '  <- ' + detail : ''));
  }
}

check('顶角下限限制为 0.2°', visual.clampAngle(0.1) === 0.2);
check('顶角上限限制为 2.0°', visual.clampAngle(2.5) === 2);
check('空值回退到上一次有效值', visual.clampAngle(NaN, 1.2) === 1.2);
check('画布顶角随真实顶角增大', visual.angleToVisualDegrees(2) > visual.angleToVisualDegrees(0.5));
check('激光默认 650 nm', visual.sourcePreset('laser').lambda === 650);
check('钠灯默认 589.3 nm', visual.sourcePreset('sodium').lambda === 589.3);
check('未知光源回退到钠灯', visual.sourcePreset('unknown').mode === 'sodium');
check('激光光束窄于钠灯光束', visual.beamWidth('laser', 400) < visual.beamWidth('sodium', 400));

console.log('\n' + (bad === 0 ? '光学视觉门禁通过' : bad + ' 项不通过') +
  '（' + ok + ' pass / ' + bad + ' fail）');
process.exit(bad === 0 ? 0 : 1);
