/*!
 * store.js —— 状态与持久化
 * 全部数据保存在浏览器 localStorage，不上传任何服务器。
 */
(function (root) {
  'use strict';

  var KEY = 'elo-rollcall-v1';

  /* 初始虚拟名单：仅用于演示与调试，可一键替换为 Excel 导入的真实名单 */
  var DEMO_NAMES = [
    '沈青禾', '陆知远', '林听澜', '周砚辞', '苏与白', '顾行简', '江照野', '许南星',
    '温宜之', '裴清让', '叶惊寒', '安栖迟', '洛云归', '祁问樵', '宋闻笛', '柳未晞',
    '崔怀瑾', '邵向晚', '谢知非', '钟辞夏', '尹墨书', '简时鸣', '席观澜', '文晏如',
    '容与舟', '荀思齐', '傅山远', '蒋叩月', '施长歌', '路遥知'
  ];

  var LEVELS = [
    { name: '初入学堂', min: 0, icon: 'Ⅰ' },
    { name: '勤学之士', min: 120, icon: 'Ⅱ' },
    { name: '善思之士', min: 320, icon: 'Ⅲ' },
    { name: '博闻之士', min: 640, icon: 'Ⅳ' },
    { name: '课堂智者', min: 1080, icon: 'Ⅴ' },
    { name: '一班之光', min: 1680, icon: 'Ⅵ' }
  ];

  var DEFAULT_SETTINGS = {
    baseElo: 1200,      // 初始 ELO
    k: 32,              // ELO 调整系数 k
    RD: 400,            // 基准差值 RD
    sigma: 220,         // ELO 匹配宽容度：越小越"严格势均力敌"
    prdPower: 1,        // PRD 权重（0 = 关闭保底/散热）
    eloPower: 1,        // ELO 匹配权重（0 = 关闭难度匹配）
    hardCapFactor: 2,   // 保底倍数：连续未点名 ≥ 人数×该倍数 时强制点到
    diffSpread: 200,    // 简单/困难相对班级均分的偏移
    pointsCorrect: 10,  // 答对基础积分
    pointsWrong: 2,     // 答错参与分
    comboBonus: 5,      // 连对每级额外加分（上限 3 级）
    animMs: 1600,       // 抽取动画时长
    showShop: true,     // 是否显示「心愿商店」标签页
    theme: 'dark'
  };

  var DEFAULT_SHOP = [
    { id: 'w1', name: '免作业券', cost: 300, desc: '免一次当日书面作业' },
    { id: 'w2', name: '自选座位', cost: 220, desc: '下周任选座位一次' },
    { id: 'w3', name: '课间点歌', cost: 150, desc: '课间播放一首指定歌曲' },
    { id: 'w4', name: '免点名券', cost: 260, desc: '本节课可豁免一次点名' },
    { id: 'w5', name: '出题特权', cost: 400, desc: '为下节课出一道题' }
  ];

  function uid() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** 由累计积分推导成长等级 */
  function levelOf(points) {
    var lv = LEVELS[0], idx = 0;
    for (var i = 0; i < LEVELS.length; i++) {
      if (points >= LEVELS[i].min) { lv = LEVELS[i]; idx = i; }
    }
    var next = LEVELS[idx + 1] || null;
    return {
      index: idx, name: lv.name, icon: lv.icon,
      next: next,
      progress: next ? (points - lv.min) / (next.min - lv.min) : 1
    };
  }

  function makeStudent(name, elo, group) {
    return {
      id: uid(),
      name: String(name).trim(),
      group: group || '',
      elo: typeof elo === 'number' && isFinite(elo) ? elo : DEFAULT_SETTINGS.baseElo,
      initElo: typeof elo === 'number' && isFinite(elo) ? elo : DEFAULT_SETTINGS.baseElo,
      points: 0,
      picks: 0,
      correct: 0,
      wrong: 0,
      streak: 0,       // 当前连对
      bestStreak: 0,
      prdFail: 1,      // 连续未被点名次数（PRD 计数器）
      active: true,    // 出勤
      eloTrace: []     // ELO 变化轨迹
    };
  }

  function demoRoster() {
    // 给虚拟名单一点初始能力差异，便于观察 ELO 匹配效果
    return DEMO_NAMES.map(function (n, i) {
      var spread = Math.round(Math.sin(i * 1.7) * 130 + (i % 5) * 18 - 36);
      return makeStudent(n, DEFAULT_SETTINGS.baseElo + spread);
    });
  }

  /** 把仓库里的 data/roster.json 转成学生对象 */
  function fromSeed(seed) {
    var arr = (seed && seed.students) || [];
    return arr.filter(function (x) {
      return x && String(x.name || '').trim();
    }).map(function (x) {
      var elo = parseFloat(x.elo);
      return makeStudent(x.name, isFinite(elo) ? elo : DEFAULT_SETTINGS.baseElo, x.group || '');
    });
  }

  /** 把当前名单导出为仓库可用的 data/roster.json 结构 */
  function toSeed(label) {
    return {
      class: label || '我的班级',
      demo: false,
      note: '由点名系统「导出为仓库名单」生成，放到仓库的 data/roster.json 即可。',
      students: state.students.map(function (s) {
        return { name: s.name, group: s.group || '', elo: Math.round(s.elo) };
      })
    };
  }

  function defaultState() {
    return {
      version: 1,
      isDemo: true,                 // 当前是否为虚拟名单
      rosterLabel: '',              // 名单来源标签（仓库名单会带班级名）
      students: demoRoster(),
      settings: Object.assign({}, DEFAULT_SETTINGS),
      shop: DEFAULT_SHOP.map(function (i) { return Object.assign({}, i); }),
      log: [],                      // 点名记录（含快照，可撤销）
      redeems: [],                  // 兑换记录
      difficulty: DEFAULT_SETTINGS.baseElo,
      diffPreset: 'normal'
    };
  }

  var state = defaultState();

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('保存失败（可能是隐私模式或空间不足）', e);
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.students)) return false;
      data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
      data.students.forEach(function (s) {
        if (s.prdFail === undefined) s.prdFail = 1;
        if (!Array.isArray(s.eloTrace)) s.eloTrace = [];
        if (s.active === undefined) s.active = true;
      });
      if (!Array.isArray(data.shop) || !data.shop.length) data.shop = DEFAULT_SHOP.slice();
      if (!Array.isArray(data.redeems)) data.redeems = [];
      if (!Array.isArray(data.log)) data.log = [];
      state = data;
      return true;
    } catch (e) {
      console.warn('读取本地数据失败，已使用默认名单', e);
      return false;
    }
  }

  function reset(keepRoster) {
    var roster = keepRoster ? state.students : null;
    var isDemo = state.isDemo;
    state = defaultState();
    if (roster) {
      state.isDemo = isDemo;
      state.students = roster.map(function (s) {
        var n = makeStudent(s.name, s.initElo, s.group);
        n.id = s.id;
        return n;
      });
    }
    save();
  }

  root.Store = {
    fromSeed: fromSeed,
    toSeed: toSeed,
    KEY: KEY,
    LEVELS: LEVELS,
    DEMO_NAMES: DEMO_NAMES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    DEFAULT_SHOP: DEFAULT_SHOP,
    uid: uid,
    levelOf: levelOf,
    makeStudent: makeStudent,
    demoRoster: demoRoster,
    defaultState: defaultState,
    save: save,
    load: load,
    reset: reset,
    get: function () { return state; },
    set: function (s) { state = s; save(); }
  };
})(window);
