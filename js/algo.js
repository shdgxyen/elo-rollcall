/*!
 * algo.js —— 反"玄学"点名系统 核心算法层
 *
 * 三块内容，全部为纯函数，浏览器与 Node 均可运行（tests/test-algo.mjs 会直接调用）：
 *   1. ELO 动态评分   —— 让"题目难度"与"学生能力"势均力敌
 *   2. PRD 伪随机分布 —— 未被点名越久，下次被点概率越高，N 次内必到
 *   3. 公平性指标     —— 基尼系数 / 标准差 / 最长空窗，用于与纯随机对照
 */
(function (root, factory) {
  var api = factory();
  root.Algo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var EPS = 1e-9;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ============================ 1. ELO ============================ */

  /**
   * 期望得分 E：该学生答对这道题的理论概率。
   * 采用开题 PPT 中的 logistic 形式：E = 1 / (1 + e^((D - R) / RD))
   * R 为学生当前 ELO，D 为题目难度分，RD 为基准差值（默认 400）。
   */
  function expectedScore(rating, difficulty, RD) {
    RD = RD || 400;
    return 1 / (1 + Math.exp((difficulty - rating) / RD));
  }

  /**
   * ELO 增量：ΔR = k · (S - E)，S 答对为 1、答错为 0。
   * 答对时即 PPT 中的 R' = R + k · 1/(1 + e^((R - D)/RD))。
   */
  function eloDelta(rating, difficulty, correct, k, RD) {
    var S = correct ? 1 : 0;
    return k * (S - expectedScore(rating, difficulty, RD));
  }

  /* ============================ 2. PRD ============================ */
  // 经典伪随机分布：第 n 次连续未中时，命中概率为 P(n) = min(1, C·n)。
  // 给定"名义概率" p（例如 1/班级人数），需反解出常数 C，使长期平均命中率恰为 p。

  /** 给定常数 C，返回其长期平均命中概率 = 1 / E[间隔]。 */
  function prdMeanChance(C) {
    if (C >= 1) return 1;
    var maxN = Math.ceil(1 / C);
    var pNoHitYet = 1;      // 前 n-1 次都没中的概率
    var expectedGap = 0;    // E[第几次命中]
    for (var n = 1; n <= maxN; n++) {
      var pn = Math.min(1, C * n);
      expectedGap += n * pn * pNoHitYet;
      pNoHitYet *= (1 - pn);
    }
    return 1 / expectedGap;
  }

  var _prdCache = Object.create(null);

  /** 二分求解 PRD 常数 C，使平均命中率等于名义概率 p。 */
  function prdConstant(p) {
    p = clamp(p, EPS, 1);
    if (p >= 1) return 1;
    var key = p.toFixed(6);
    if (_prdCache[key] !== undefined) return _prdCache[key];
    var lo = 0, hi = p, mid = p / 2;
    for (var i = 0; i < 60; i++) {
      mid = (lo + hi) / 2;
      if (mid <= 0) break;
      if (prdMeanChance(mid) > p) hi = mid; else lo = mid;
    }
    _prdCache[key] = mid;
    return mid;
  }

  /** 该常数下的理论最大空窗：第 maxTries 次时命中概率必为 1。 */
  function prdMaxTries(C) { return Math.max(1, Math.ceil(1 / C)); }

  /* ========================= 3. 抽取策略 ========================= */

  /** ELO 匹配权重：学生能力与题目难度越接近，权重越高（高斯核）。 */
  function matchWeight(elo, difficulty, sigma) {
    var d = elo - difficulty;
    return Math.exp(-(d * d) / (2 * sigma * sigma));
  }

  /**
   * 计算候选人权重。
   * opts: { difficulty, sigma, prdPower, eloPower, hardCap }
   *   prdPower / eloPower ∈ [0,1]，为 0 表示关闭该算法（退化为纯随机）。
   *   hardCap：连续未被点名达到该次数时强制保底。
   * 返回：{ list: [{ id, weight, prdChance, matchScore, expect, forced }], forced: Bool, C }
   */
  function computeWeights(students, opts) {
    var pool = students.filter(function (s) { return s.active !== false; });
    var C = prdConstant(pool.length ? 1 / pool.length : 1);
    var hardCap = opts.hardCap || Infinity;
    var forcedOnes = pool.filter(function (s) { return (s.prdFail || 0) >= hardCap; });
    var base = forcedOnes.length ? forcedOnes : pool;

    var list = base.map(function (s) {
      var fail = Math.max(s.prdFail || 0, 0);
      var prdChance = clamp(C * fail, EPS, 1);                 // PRD 当前命中概率
      var match = matchWeight(s.elo, opts.difficulty, opts.sigma); // ELO 契合度
      var w = Math.pow(prdChance, opts.prdPower) * Math.pow(match, opts.eloPower) + EPS;
      return {
        id: s.id,
        name: s.name,
        weight: w,
        prdChance: prdChance,
        matchScore: match,
        expect: expectedScore(s.elo, opts.difficulty, opts.RD || 400),
        forced: forcedOnes.length > 0
      };
    });
    var total = list.reduce(function (a, b) { return a + b.weight; }, 0);
    list.forEach(function (it) { it.p = it.weight / total; });
    list.sort(function (a, b) { return b.p - a.p; });
    return { list: list, forced: forcedOnes.length > 0, C: C, maxTries: prdMaxTries(C) };
  }

  /** 轮盘赌：按权重挑一个下标。 */
  function roulette(weights, rng) {
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var r = (rng || Math.random)() * total;
    for (var i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  /** 抽取一人，返回 { id, detail, weights } */
  function draw(students, opts, rng) {
    var res = computeWeights(students, opts);
    if (!res.list.length) return null;
    var idx = roulette(res.list.map(function (i) { return i.weight; }), rng);
    return { id: res.list[idx].id, detail: res.list[idx], weights: res, forced: res.forced };
  }

  /** 记账：被点中者计数归零，其余人 +1。 */
  function updateFailCounters(students, pickedId) {
    students.forEach(function (s) {
      if (s.active === false) return;
      if (s.id === pickedId) s.prdFail = 0; else s.prdFail = (s.prdFail || 0) + 1;
    });
  }

  /* ======================== 4. 公平性指标 ======================== */

  /** 基尼系数：0 = 绝对平均，1 = 完全集中。用于量化点名分布偏差。 */
  function gini(values) {
    var arr = values.slice().sort(function (a, b) { return a - b; });
    var n = arr.length;
    if (!n) return 0;
    var sum = arr.reduce(function (a, b) { return a + b; }, 0);
    if (sum === 0) return 0;
    var cum = 0;
    for (var i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * arr[i];
    return cum / (n * sum);
  }

  function mean(values) {
    if (!values.length) return 0;
    return values.reduce(function (a, b) { return a + b; }, 0) / values.length;
  }

  function stdev(values) {
    if (values.length < 2) return 0;
    var m = mean(values);
    return Math.sqrt(values.reduce(function (a, v) { return a + (v - m) * (v - m); }, 0) / values.length);
  }

  /**
   * 蒙特卡洛模拟：在同一份名单上跑 draws 次点名，比较不同策略的分布。
   * mode: 'random'（纯随机基准） | 'algo'（当前 ELO+PRD 配置）
   * 返回 { counts, zero, gini, stdev, maxGap }，maxGap 为全班最长连续未被点名次数。
   */
  function simulate(students, opts, draws, mode, rng) {
    rng = rng || Math.random;
    var sim = students.filter(function (s) { return s.active !== false; })
      .map(function (s) { return { id: s.id, elo: s.elo, prdFail: 1, count: 0, gap: 0, maxGap: 0, active: true }; });
    if (!sim.length) return { counts: [], zero: 0, gini: 0, stdev: 0, maxGap: 0 };

    var avg = mean(sim.map(function (s) { return s.elo; }));
    var offsets = [-opts.diffSpread || -200, 0, opts.diffSpread || 200];

    for (var t = 0; t < draws; t++) {
      var pickedId;
      if (mode === 'random') {
        pickedId = sim[Math.floor(rng() * sim.length)].id;
      } else {
        var d = avg + offsets[Math.floor(rng() * offsets.length)];
        var picked = draw(sim, {
          difficulty: d, sigma: opts.sigma, prdPower: opts.prdPower,
          eloPower: opts.eloPower, hardCap: opts.hardCap, RD: opts.RD
        }, rng);
        pickedId = picked.id;
      }
      sim.forEach(function (s) {
        if (s.id === pickedId) {
          s.count++; s.prdFail = 0; s.gap = 0;
        } else {
          s.prdFail++; s.gap++;
          if (s.gap > s.maxGap) s.maxGap = s.gap;
        }
      });
    }
    var counts = sim.map(function (s) { return s.count; });
    return {
      counts: counts,
      zero: counts.filter(function (c) { return c === 0; }).length,
      gini: gini(counts),
      stdev: stdev(counts),
      maxGap: Math.max.apply(null, sim.map(function (s) { return s.maxGap; }))
    };
  }

  return {
    clamp: clamp,
    expectedScore: expectedScore,
    eloDelta: eloDelta,
    prdMeanChance: prdMeanChance,
    prdConstant: prdConstant,
    prdMaxTries: prdMaxTries,
    matchWeight: matchWeight,
    computeWeights: computeWeights,
    roulette: roulette,
    draw: draw,
    updateFailCounters: updateFailCounters,
    gini: gini,
    mean: mean,
    stdev: stdev,
    simulate: simulate
  };
});
