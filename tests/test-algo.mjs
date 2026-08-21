/**
 * 算法自测：node tests/test-algo.mjs
 * 验证 ELO 公式、PRD 常数反解，以及"本系统 vs 纯随机"的公平性差异。
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const A = require('../js/algo.js');

let failed = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '  ' + extra : ''));
  if (!cond) failed++;
}

console.log('\n【1】ELO 期望得分与增量');
ok('势均力敌时 E = 0.5', Math.abs(A.expectedScore(1200, 1200, 400) - 0.5) < 1e-9);
ok('题目更难时 E < 0.5', A.expectedScore(1200, 1500, 400) < 0.5,
   'E=' + A.expectedScore(1200, 1500, 400).toFixed(3));
ok('答对加分、答错扣分',
   A.eloDelta(1200, 1200, true, 32, 400) > 0 && A.eloDelta(1200, 1200, false, 32, 400) < 0);
ok('答对难题的加分 > 答对易题',
   A.eloDelta(1200, 1500, true, 32, 400) > A.eloDelta(1200, 900, true, 32, 400));

console.log('\n【2】PRD 常数反解');
for (const n of [10, 30, 45, 60]) {
  const p = 1 / n;
  const C = A.prdConstant(p);
  const real = A.prdMeanChance(C);
  ok(`${n} 人班级：C=${C.toFixed(5)}，平均命中率回归到 ${(real * 100).toFixed(2)}%`,
     Math.abs(real - p) < 1e-4, '理论最大空窗 ' + A.prdMaxTries(C) + ' 次');
}

console.log('\n【3】公平性：本系统 vs 纯随机（30 人 × 300 次点名）');
const students = Array.from({ length: 30 }, (_, i) => ({
  id: 'x' + i, name: '学生' + i, elo: 1200 + Math.round(Math.sin(i * 1.7) * 130), prdFail: 1, active: true
}));
const opts = { sigma: 220, prdPower: 1, eloPower: 1, hardCap: 60, RD: 400, diffSpread: 200 };
const rnd = A.simulate(students, opts, 300, 'random');
const alg = A.simulate(students, opts, 300, 'algo');
console.log('   纯随机   :', JSON.stringify({ 未点到: rnd.zero, 基尼: +rnd.gini.toFixed(3), 标准差: +rnd.stdev.toFixed(2), 最长空窗: rnd.maxGap }));
console.log('   ELO+PRD :', JSON.stringify({ 未点到: alg.zero, 基尼: +alg.gini.toFixed(3), 标准差: +alg.stdev.toFixed(2), 最长空窗: alg.maxGap }));
ok('基尼系数显著低于纯随机', alg.gini < rnd.gini * 0.7);
ok('最长空窗显著短于纯随机', alg.maxGap < rnd.maxGap);
ok('无人被完全遗漏', alg.zero === 0);

console.log('\n【4】保底机制');
const pool = students.map((s, i) => ({ ...s, prdFail: i === 7 ? 60 : 1 }));
const w = A.computeWeights(pool, { ...opts, difficulty: 1200 });
ok('达到保底线者被强制选中', w.forced && w.list.length === 1 && w.list[0].id === 'x7');

console.log('\n【5】基尼系数边界');
ok('完全均等 = 0', A.gini([5, 5, 5, 5]) === 0);
ok('完全集中 → 接近 1', A.gini([0, 0, 0, 20]) > 0.7, A.gini([0, 0, 0, 20]).toFixed(3));

console.log(failed ? `\n${failed} 项未通过\n` : '\n全部通过 ✅\n');
process.exit(failed ? 1 : 0);
