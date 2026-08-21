/*!
 * app.js —— 界面逻辑与交互
 */
(function () {
  'use strict';

  var A = window.Algo, S = window.Store, IO = window.XlsxIO;
  var $ = function (id) { return document.getElementById(id); };
  var st = function () { return S.get(); };

  var pending = null;      // 当前已抽出、等待判定的学生
  var rolling = false;     // 抽取动画进行中
  var rosterFilter = '';

  /* ------------------------------------------------------------------ 工具 */
  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.hidden = true; }, ms || 2000);
  }
  function fmt(n, d) { return Number(n).toFixed(d === undefined ? 0 : d); }
  function sign(n, d) { return (n >= 0 ? '+' : '') + fmt(n, d); }
  function timeStr(t) {
    var d = new Date(t), p = function (n) { return n < 10 ? '0' + n : n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function activeStudents() { return st().students.filter(function (s) { return s.active !== false; }); }
  function classMean() {
    var a = activeStudents();
    return a.length ? A.mean(a.map(function (s) { return s.elo; })) : st().settings.baseElo;
  }
  function hardCap() {
    var n = activeStudents().length || 1;
    return Math.max(3, Math.round(n * st().settings.hardCapFactor));
  }
  function drawOpts() {
    var g = st().settings;
    return {
      difficulty: st().difficulty, sigma: g.sigma, prdPower: g.prdPower,
      eloPower: g.eloPower, hardCap: hardCap(), RD: g.RD, diffSpread: g.diffSpread
    };
  }
  function byId(id) {
    return st().students.filter(function (s) { return s.id === id; })[0];
  }

  /* ------------------------------------------------------------ 弹窗封装 */
  function openModal(title, bodyHTML, buttons) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHTML;
    var foot = $('modalFoot');
    foot.innerHTML = '';
    (buttons || []).forEach(function (b) {
      var el = document.createElement('button');
      el.className = 'btn ' + (b.kind || '');
      el.textContent = b.label;
      el.onclick = function () { b.onClick && b.onClick(); };
      foot.appendChild(el);
    });
    $('backdrop').hidden = false;
  }
  function closeModal() { $('backdrop').hidden = true; }

  /* =================================================================
   *  点名面板
   * ================================================================= */
  function setDifficulty(v, preset) {
    st().difficulty = Math.round(v);
    if (preset) st().diffPreset = preset;
    $('diffRange').value = st().difficulty;
    $('diffValue').textContent = st().difficulty;
    Array.prototype.forEach.call($('diffPresets').children, function (b) {
      b.classList.toggle('is-on', b.dataset.preset === st().diffPreset);
    });
    renderWeights();
    S.save();
  }
  function applyPreset(p) {
    var m = classMean(), sp = st().settings.diffSpread;
    setDifficulty(p === 'easy' ? m - sp : p === 'hard' ? m + sp : m, p);
  }

  function renderWeights() {
    var ul = $('weightList');
    var pool = activeStudents();
    if (!pool.length) { ul.innerHTML = '<li class="empty">名单为空</li>'; $('algoHint').textContent = ''; return; }
    var res = A.computeWeights(st().students, drawOpts());
    ul.innerHTML = res.list.slice(0, 8).map(function (it) {
      var top = res.list[0].p || 1;
      return '<li><span class="wname">' + esc(it.name) + '</span>'
        + '<span class="weight-bar"><i style="width:' + (it.p / top * 100).toFixed(1) + '%"></i></span>'
        + '<span class="wpct">' + (it.p * 100).toFixed(1) + '%</span></li>';
    }).join('');
    var g = st().settings;
    var mode = g.prdPower === 0 && g.eloPower === 0 ? '纯随机（对照组）'
      : g.prdPower === 0 ? '仅 ELO 匹配'
      : g.eloPower === 0 ? '仅 PRD 保底' : 'ELO 匹配 × PRD 保底';
    $('algoHint').innerHTML = '当前策略：<b>' + mode + '</b>　·　保底上限 <b>' + hardCap()
      + '</b> 次未被点名即强制点到　·　权重 = (未点名次数)^PRD强度 × (难度契合度)^ELO强度'
      + (res.forced ? '　·　<span style="color:var(--warn)">已触发保底，仅在超时未点名者中抽取</span>' : '');
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function startDraw() {
    if (rolling) return;
    if (pending) { toast('请先判定上一位同学的作答结果'); return; }
    var pool = activeStudents();
    if (!pool.length) { toast('名单为空，请先导入或添加学生'); return; }

    var picked = A.draw(st().students, drawOpts());
    var target = byId(picked.id);
    var nameEl = $('stageName');
    var dur = st().settings.animMs;

    rolling = true;
    $('drawBtn').disabled = true;
    $('stageChips').innerHTML = '';
    $('stageSub').textContent = '正在抽取…';

    var finish = function () {
      rolling = false;
      nameEl.classList.remove('rolling');
      nameEl.textContent = target.name;
      nameEl.classList.remove('pop'); void nameEl.offsetWidth; nameEl.classList.add('pop');

      A.updateFailCounters(st().students, target.id);
      pending = {
        id: target.id,
        difficulty: st().difficulty,
        forced: picked.forced,
        detail: picked.detail,
        fails: st().students.map(function (s) { return [s.id, s.prdFail]; })
      };
      showPendingChips(target, picked.detail, picked.forced);
      $('rightBtn').disabled = $('wrongBtn').disabled = $('skipBtn').disabled = false;
      $('drawBtn').disabled = true;
      $('stageSub').innerHTML = '请判定作答结果：<kbd>1</kbd> 答对 · <kbd>2</kbd> 答错';
      renderWeights();
      S.save();
    };

    if (dur < 200) { finish(); return; }
    nameEl.classList.add('rolling');
    var names = pool.map(function (s) { return s.name; });
    var t0 = Date.now();
    var tick = function () {
      var elapsed = Date.now() - t0;
      nameEl.textContent = names[Math.floor(Math.random() * names.length)];
      if (elapsed >= dur) { finish(); return; }
      // 越接近结束，滚动越慢（缓动）
      var delay = 45 + 240 * Math.pow(elapsed / dur, 3.2);
      setTimeout(tick, delay);
    };
    tick();
  }

  function showPendingChips(s, detail, forced) {
    var lv = S.levelOf(s.points);
    var chips = [
      '<span class="chip">ELO <b>' + fmt(s.elo) + '</b></span>',
      '<span class="chip">积分 <b>' + s.points + '</b></span>',
      '<span class="chip">' + lv.icon + ' ' + lv.name + '</span>',
      '<span class="chip">被点 <b>' + s.picks + '</b> 次</span>',
      '<span class="chip good">理论答对率 <b>' + (detail.expect * 100).toFixed(0) + '%</b></span>'
    ];
    if (forced) chips.push('<span class="chip hot">🛡 保底触发</span>');
    else chips.push('<span class="chip">本轮抽中概率 <b>' + (detail.p * 100).toFixed(1) + '%</b></span>');
    $('stageChips').innerHTML = chips.join('');
  }

  /** 记录判定结果：result = 'correct' | 'wrong' | 'skip' */
  function record(result) {
    if (!pending) return;
    var s = byId(pending.id);
    if (!s) { pending = null; return; }
    var g = st().settings;

    var snap = {
      elo: s.elo, points: s.points, picks: s.picks, correct: s.correct,
      wrong: s.wrong, streak: s.streak, bestStreak: s.bestStreak,
      traceLen: s.eloTrace.length
    };

    var eloDelta = null, pointDelta = 0;
    s.picks += 1;

    if (result !== 'skip') {
      var ok = result === 'correct';
      eloDelta = A.eloDelta(s.elo, pending.difficulty, ok, g.k, g.RD);
      s.elo = Math.max(400, s.elo + eloDelta);
      s.eloTrace.push(Math.round(s.elo));
      if (ok) {
        s.correct += 1;
        s.streak += 1;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
        // 难度越高，积分越高
        var mult = A.clamp(1 + (pending.difficulty - classMean()) / 400, 0.5, 2);
        pointDelta = Math.round(g.pointsCorrect * mult) + g.comboBonus * Math.min(s.streak - 1, 3);
      } else {
        s.wrong += 1;
        s.streak = 0;
        pointDelta = g.pointsWrong;
      }
      s.points += pointDelta;
    }

    st().log.push({
      t: Date.now(), sid: s.id, name: s.name, difficulty: pending.difficulty,
      result: result, eloDelta: eloDelta, eloAfter: result === 'skip' ? null : s.elo,
      pointDelta: pointDelta, forced: pending.forced,
      snapshot: snap, fails: pending.fails
    });
    if (st().log.length > 2000) st().log.splice(0, st().log.length - 2000);

    var lv = S.levelOf(s.points);
    if (result !== 'skip') {
      $('stageSub').innerHTML = (result === 'correct' ? '✅ 答对' : '❌ 答错')
        + '　ELO <b class="delta ' + (eloDelta >= 0 ? 'up' : 'down') + '">' + sign(eloDelta, 1) + '</b>'
        + '　积分 <b class="delta up">' + sign(pointDelta) + '</b>'
        + '　' + lv.icon + ' ' + lv.name;
    } else {
      $('stageSub').textContent = '已跳过，本次不计入评分';
    }
    showPendingChips(s, pending.detail, pending.forced);

    pending = null;
    $('rightBtn').disabled = $('wrongBtn').disabled = $('skipBtn').disabled = true;
    $('drawBtn').disabled = false;
    S.save();
    renderAll();
  }

  function undoLast() {
    var log = st().log;
    if (!log.length) { toast('没有可撤销的记录'); return; }
    if (pending) { pending = null; $('rightBtn').disabled = $('wrongBtn').disabled = $('skipBtn').disabled = true; $('drawBtn').disabled = false; }
    var last = log.pop();
    var s = byId(last.sid);
    if (s) {
      Object.assign(s, {
        elo: last.snapshot.elo, points: last.snapshot.points, picks: last.snapshot.picks,
        correct: last.snapshot.correct, wrong: last.snapshot.wrong,
        streak: last.snapshot.streak, bestStreak: last.snapshot.bestStreak
      });
      s.eloTrace.length = last.snapshot.traceLen;
    }
    // 还原全班 PRD 计数器（回到抽中该同学之前的状态）
    if (last.fails) {
      var prevLog = log[log.length - 1];
      var map = {};
      if (prevLog && prevLog.fails) {
        prevLog.fails.forEach(function (f) { map[f[0]] = f[1]; });
      } else {
        last.fails.forEach(function (f) { map[f[0]] = Math.max(1, f[1] - 1); });
        map[last.sid] = hardCap();  // 被撤销者恢复为"久未点名"状态
      }
      st().students.forEach(function (x) { if (map[x.id] !== undefined) x.prdFail = map[x.id]; });
    }
    $('stageSub').textContent = '已撤销：' + last.name;
    $('stageChips').innerHTML = '';
    S.save();
    renderAll();
    toast('已撤销 ' + last.name + ' 的记录');
  }

  function renderLog() {
    var log = st().log.slice(-40).reverse();
    $('logCount').textContent = st().log.length ? '共 ' + st().log.length + ' 条' : '';
    $('logList').innerHTML = log.length ? log.map(function (l) {
      var cls = l.result === 'correct' ? 'ok' : l.result === 'wrong' ? 'bad' : 'skip';
      var d = l.eloDelta === null ? '' :
        '<span class="delta ' + (l.eloDelta >= 0 ? 'up' : 'down') + '">' + sign(l.eloDelta, 1) + '</span>';
      return '<li><span class="dot ' + cls + '"></span><span>' + esc(l.name) + '</span>'
        + (l.forced ? '<span class="chip" style="padding:1px 7px">保底</span>' : '')
        + d + '<span class="t">' + timeStr(l.t) + '</span></li>';
    }).join('') : '<li class="empty">还没有点名记录</li>';
  }

  /* =================================================================
   *  名单面板
   * ================================================================= */
  function renderRoster() {
    var list = st().students;
    if (rosterFilter) {
      list = list.filter(function (s) { return s.name.indexOf(rosterFilter) >= 0; });
    }
    $('rosterBody').innerHTML = list.length ? list.map(function (s, i) {
      var lv = S.levelOf(s.points);
      var rate = s.picks ? Math.round((s.correct / (s.correct + s.wrong || 1)) * 100) : 0;
      var d = s.elo - s.initElo;
      return '<tr class="' + (s.active === false ? 'row-off' : '') + '" data-id="' + s.id + '">'
        + '<td class="num">' + (i + 1) + '</td>'
        + '<td class="name-cell">' + esc(s.name) + '</td>'
        + '<td>' + esc(s.group || '—') + '</td>'
        + '<td class="num">' + fmt(s.elo) + '</td>'
        + '<td class="num"><span class="delta ' + (d >= 0 ? 'up' : 'down') + '">' + sign(d) + '</span></td>'
        + '<td class="num">' + s.picks + '</td>'
        + '<td class="num">' + s.correct + ' / ' + s.wrong + '</td>'
        + '<td class="num">' + (s.correct + s.wrong ? rate + '%' : '—') + '</td>'
        + '<td class="num">' + s.points + '</td>'
        + '<td class="lvl">' + lv.icon + ' ' + lv.name + '</td>'
        + '<td class="num">' + s.prdFail + '</td>'
        + '<td><button class="switch ' + (s.active === false ? '' : 'on') + '" data-act="toggle">'
        + (s.active === false ? '缺席' : '在座') + '</button></td>'
        + '<td><button class="mini-btn" data-act="edit">✎</button>'
        + '<button class="mini-btn" data-act="del">✕</button></td>'
        + '</tr>';
    }).join('') : '<tr><td colspan="13" class="empty">名单为空，点击「导入 Excel 名单」或「手动添加」</td></tr>';

    var total = st().students.length, act = activeStudents().length;
    var label = st().rosterLabel || (st().isDemo ? '虚拟名单' : '真实名单');
    $('rosterBadge').textContent = label + ' ' + total + ' 人'
      + (act !== total ? '（在座 ' + act + '）' : '');
  }

  function editStudent(s) {
    var isNew = !s;
    openModal(isNew ? '添加学生' : '编辑 ' + s.name,
      '<label><span>姓名</span><input type="text" id="mName" value="' + (s ? esc(s.name) : '') + '"></label>'
      + '<label><span>组别（可留空）</span><input type="text" id="mGroup" value="' + (s ? esc(s.group || '') : '') + '"></label>'
      + '<label><span>当前 ELO</span><input type="number" id="mElo" value="' + (s ? Math.round(s.elo) : st().settings.baseElo) + '"></label>'
      + (isNew ? '' : '<label><span>积分</span><input type="number" id="mPoints" value="' + s.points + '"></label>'),
      [
        { label: '取消', onClick: closeModal },
        {
          label: '保存', kind: 'primary', onClick: function () {
            var name = $('mName').value.trim();
            if (!name) { toast('请填写姓名'); return; }
            var elo = parseFloat($('mElo').value) || st().settings.baseElo;
            if (isNew) {
              var n = S.makeStudent(name, elo, $('mGroup').value.trim());
              st().students.push(n);
            } else {
              s.name = name; s.group = $('mGroup').value.trim();
              s.elo = elo; s.points = parseInt($('mPoints').value, 10) || 0;
            }
            S.save(); closeModal(); renderAll();
          }
        }
      ]);
    setTimeout(function () { $('mName').focus(); }, 30);
  }

  /* ------------------------------------------- 仓库名单 data/roster.json */
  /**
   * 名单跟着仓库走：仓库里的 data/roster.json 作为"种子名单"，
   * 首次打开（本机还没有存档）时自动载入；成绩仍然只存在本机浏览器。
   */
  function loadSeedRoster(silent) {
    return fetch('data/roster.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (seed) {
        var students = S.fromSeed(seed);
        if (!students.length) throw new Error('roster.json 里没有有效姓名');
        var s = st();
        s.students = students;
        s.isDemo = !!seed.demo;
        s.rosterLabel = seed.class || (seed.demo ? '虚拟名单' : '仓库名单');
        s.log = []; s.redeems = [];
        pending = null;
        S.save();
        applyPreset(s.diffPreset || 'normal');
        renderAll();
        if (!silent) toast('已载入仓库名单：' + s.rosterLabel + '（' + students.length + ' 人）');
        return true;
      })
      .catch(function (err) {
        if (!silent) {
          toast('读不到 data/roster.json：' + err.message);
          console.warn('载入仓库名单失败', err);
        }
        return false;
      });
  }

  function exportSeedRoster() {
    if (!st().students.length) { toast('名单为空'); return; }
    var label = prompt('给这份名单起个名字（会显示在右上角）：', st().rosterLabel || '我的班级');
    if (label === null) return;
    var blob = new Blob([JSON.stringify(S.toSeed(label.trim() || '我的班级'), null, 2) + '\n'],
      { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'roster.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已导出 roster.json，上传到仓库的 data/ 目录替换原文件即可');
  }

  /* ---------------------------------------------------- Excel 导入流程 */
  function handleFile(file) {
    IO.readWorkbook(file).then(function (sheets) {
      showImportModal(sheets);
    }).catch(function (err) {
      toast('导入失败：' + err.message);
    });
  }

  function showImportModal(sheets) {
    var render = function (si) {
      var rows = sheets[si].rows;
      var head = rows[0].map(function (h, i) {
        var t = String(h).trim();
        return '<option value="' + i + '">第' + (i + 1) + '列' + (t ? '：' + esc(t) : '') + '</option>';
      }).join('');
      var nameCol = IO.guessNameColumn(rows), scoreCol = IO.guessScoreColumn(rows);
      var preview = '<div class="preview-table"><table><thead><tr>'
        + rows[0].map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('')
        + '</tr></thead><tbody>'
        + rows.slice(1, 8).map(function (r) {
          return '<tr>' + rows[0].map(function (_, i) { return '<td>' + esc(r[i] === undefined ? '' : r[i]) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';

      $('modalBody').innerHTML =
        (sheets.length > 1 ? '<label><span>工作表</span><select id="iSheet">' + sheets.map(function (s, i) {
          return '<option value="' + i + '"' + (i === si ? ' selected' : '') + '>' + esc(s.name) + '</option>';
        }).join('') + '</select></label>' : '')
        + '<label><span>姓名列</span><select id="iName">' + head + '</select></label>'
        + '<label><span>组别列（可选）</span><select id="iGroup"><option value="-1">不使用</option>' + head + '</select></label>'
        + '<label><span>参考成绩列（可选，用于设定初始 ELO）</span><select id="iScore"><option value="-1">不使用，全部从 '
        + st().settings.baseElo + ' 分起步</option>' + head + '</select></label>'
        + '<label><span>首行是否为表头</span><select id="iHeader"><option value="1">是，跳过首行</option><option value="0">否，首行也是数据</option></select></label>'
        + '<p class="muted small">共 ' + (rows.length - 1) + ' 行数据（预览前 7 行）：</p>' + preview;

      $('iName').value = nameCol;
      $('iScore').value = scoreCol;
      if ($('iSheet')) $('iSheet').onchange = function () { render(parseInt(this.value, 10)); };
      $('modalBody')._sheetIndex = si;
    };

    openModal('导入 Excel 名单', '', [
      { label: '取消', onClick: closeModal },
      {
        label: '确认导入', kind: 'primary', onClick: function () {
          var si = $('modalBody')._sheetIndex;
          var rows = sheets[si].rows;
          var hasHeader = $('iHeader').value === '1';
          var body = hasHeader ? rows.slice(1) : rows;
          var ni = parseInt($('iName').value, 10);
          var gi = parseInt($('iGroup').value, 10);
          var ci = parseInt($('iScore').value, 10);

          var names = [], groups = [], scores = [];
          body.forEach(function (r) {
            var nm = String(r[ni] === undefined ? '' : r[ni]).trim();
            if (!nm) return;
            names.push(nm);
            groups.push(gi >= 0 ? String(r[gi] === undefined ? '' : r[gi]).trim() : '');
            scores.push(ci >= 0 ? r[ci] : NaN);
          });
          if (!names.length) { toast('没有读到有效姓名，请检查姓名列'); return; }

          var elos = ci >= 0 ? IO.scoresToElo(scores, st().settings.baseElo)
            : names.map(function () { return st().settings.baseElo; });

          var s = st();
          s.students = names.map(function (n, i) { return S.makeStudent(n, elos[i], groups[i]); });
          s.isDemo = false;
          s.rosterLabel = '真实名单';
          s.log = [];
          s.redeems = [];
          pending = null;
          S.save();
          closeModal();
          applyPreset(s.diffPreset || 'normal');
          renderAll();
          toast('已导入 ' + names.length + ' 名学生' + (ci >= 0 ? '，并按成绩设定初始 ELO' : ''));
        }
      }
    ]);
    render(0);
  }

  /* =================================================================
   *  数据面板
   * ================================================================= */
  function renderStats() {
    var list = st().students;
    var counts = list.map(function (s) { return s.picks; });
    var totalDraws = counts.reduce(function (a, b) { return a + b; }, 0);
    var zero = counts.filter(function (c) { return c === 0; }).length;
    var g = A.gini(counts);
    var sd = A.stdev(counts);
    var totalCorrect = list.reduce(function (a, s) { return a + s.correct; }, 0);
    var totalAnswered = list.reduce(function (a, s) { return a + s.correct + s.wrong; }, 0);

    $('metrics').innerHTML = [
      ['总点名次数', totalDraws, '累计抽取'],
      ['未被点到', zero + ' 人', zero ? '仍有"隐形人"' : '已实现全员覆盖'],
      ['基尼系数', g.toFixed(3), '0 = 绝对均等'],
      ['次数标准差', sd.toFixed(2), '越小越平均'],
      ['全班正确率', totalAnswered ? Math.round(totalCorrect / totalAnswered * 100) + '%' : '—', '答对 / 已作答'],
      ['班级平均 ELO', fmt(classMean()), '能力基准线']
    ].map(function (m) {
      return '<div class="metric"><span>' + m[0] + '</span><b>' + m[1] + '</b><i>' + m[2] + '</i></div>';
    }).join('');

    var max = Math.max.apply(null, counts.concat([1]));
    $('pickBars').innerHTML = list.map(function (s) {
      return '<div class="bar' + (s.picks === 0 ? ' zero' : '') + '" title="' + esc(s.name) + '：' + s.picks + ' 次">'
        + '<span class="cnt">' + s.picks + '</span>'
        + '<i style="height:' + (s.picks / max * 100) + '%"></i>'
        + '<em>' + esc(s.name) + '</em></div>';
    }).join('') || '<div class="empty">暂无数据</div>';

    var rank = function (arr, key, fmtFn) {
      return arr.slice().sort(function (a, b) { return b[key] - a[key]; }).slice(0, 10).map(function (s) {
        return '<li><span>' + esc(s.name) + '</span><span class="v">' + fmtFn(s) + '</span></li>';
      }).join('') || '<li class="empty">暂无数据</li>';
    };
    $('eloRank').innerHTML = rank(list, 'elo', function (s) {
      var d = s.elo - s.initElo;
      return fmt(s.elo) + ' <span class="delta ' + (d >= 0 ? 'up' : 'down') + '">' + sign(d) + '</span>';
    });
    $('pointRank').innerHTML = rank(list, 'points', function (s) {
      return s.points + ' 分 ' + S.levelOf(s.points).icon;
    });
  }

  function runSimulation() {
    var draws = A.clamp(parseInt($('simDraws').value, 10) || 300, 10, 20000);
    if (!activeStudents().length) { toast('名单为空'); return; }
    $('simResult').innerHTML = '<p class="muted">模拟中…</p>';
    setTimeout(function () {
      var opts = drawOpts();
      var r0 = A.simulate(st().students, opts, draws, 'random');
      var r1 = A.simulate(st().students, opts, draws, 'algo');
      var col = function (title, r, win) {
        return '<div class="sim-col' + (win ? ' win' : '') + '"><h4>' + title
          + (win ? '<span class="tag-win">更公平</span>' : '') + '</h4><dl>'
          + '<dt>从未被点到</dt><dd>' + r.zero + ' 人</dd>'
          + '<dt>基尼系数</dt><dd>' + r.gini.toFixed(3) + '</dd>'
          + '<dt>次数标准差</dt><dd>' + r.stdev.toFixed(2) + '</dd>'
          + '<dt>最长连续未点名</dt><dd>' + r.maxGap + ' 次</dd>'
          + '<dt>最少 / 最多被点</dt><dd>' + Math.min.apply(null, r.counts) + ' / ' + Math.max.apply(null, r.counts) + '</dd>'
          + '</dl></div>';
      };
      $('simResult').innerHTML =
        col('纯随机（现有系统）', r0, r0.gini < r1.gini) +
        col('本系统 ELO + PRD', r1, r1.gini <= r0.gini) +
        '<div class="sim-col"><h4>结论</h4><p class="small muted">在 ' + draws + ' 次点名下，'
        + '本系统的分布基尼系数为纯随机的 <b>' + (r0.gini ? (r1.gini / r0.gini * 100).toFixed(0) : '—')
        + '%</b>，最长空窗由 <b>' + r0.maxGap + '</b> 次降至 <b>' + r1.maxGap + '</b> 次。'
        + '数值越小说明"极端运气"越少，即结果公平性越高。</p></div>';
    }, 30);
  }

  /* =================================================================
   *  心愿商店
   * ================================================================= */
  function renderShop() {
    $('shopGrid').innerHTML = st().shop.map(function (it) {
      return '<div class="shop-item" data-id="' + it.id + '"><div class="ic">' + esc(it.icon || '🎁') + '</div>'
        + '<h4>' + esc(it.name) + '</h4><p>' + esc(it.desc || '') + '</p>'
        + '<div class="cost">' + it.cost + ' 积分</div>'
        + '<div class="toolbar" style="margin:10px 0 0;justify-content:center">'
        + '<button class="btn primary" data-act="redeem">兑换</button>'
        + '<button class="mini-btn" data-act="delitem">✕</button></div></div>';
    }).join('') || '<div class="empty">还没有心愿物品</div>';

    $('redeemList').innerHTML = st().redeems.slice(-30).reverse().map(function (r) {
      return '<li><span class="dot ok"></span><span>' + esc(r.name) + '</span>'
        + '<span class="muted">兑换 ' + esc(r.item) + '</span>'
        + '<span class="delta down">-' + r.cost + '</span>'
        + '<span class="t">' + timeStr(r.t) + '</span></li>';
    }).join('') || '<li class="empty">暂无兑换记录</li>';
  }

  function redeem(item) {
    var opts = st().students.slice().sort(function (a, b) { return b.points - a.points; })
      .map(function (s) {
        return '<option value="' + s.id + '"' + (s.points < item.cost ? ' disabled' : '') + '>'
          + esc(s.name) + '（' + s.points + ' 分）' + (s.points < item.cost ? ' — 积分不足' : '') + '</option>';
      }).join('');
    openModal('兑换：' + item.name,
      '<p class="muted small">消耗 ' + item.cost + ' 积分。</p><label><span>选择学生</span><select id="rStu">' + opts + '</select></label>',
      [
        { label: '取消', onClick: closeModal },
        {
          label: '确认兑换', kind: 'primary', onClick: function () {
            var s = byId($('rStu').value);
            if (!s) { toast('请选择学生'); return; }
            if (s.points < item.cost) { toast('积分不足'); return; }
            s.points -= item.cost;
            st().redeems.push({ t: Date.now(), sid: s.id, name: s.name, item: item.name, cost: item.cost });
            S.save(); closeModal(); renderAll();
            toast(s.name + ' 成功兑换「' + item.name + '」');
          }
        }
      ]);
  }

  function addShopItem() {
    openModal('新增心愿物品',
      '<label><span>名称</span><input type="text" id="sName" placeholder="例如：与老师共进午餐"></label>'
      + '<label><span>图标（emoji）</span><input type="text" id="sIcon" value="🎁"></label>'
      + '<label><span>说明</span><input type="text" id="sDesc" placeholder="一句话描述"></label>'
      + '<label><span>所需积分</span><input type="number" id="sCost" value="200"></label>',
      [
        { label: '取消', onClick: closeModal },
        {
          label: '添加', kind: 'primary', onClick: function () {
            var n = $('sName').value.trim();
            if (!n) { toast('请填写名称'); return; }
            st().shop.push({
              id: S.uid(), name: n, icon: $('sIcon').value.trim() || '🎁',
              desc: $('sDesc').value.trim(), cost: parseInt($('sCost').value, 10) || 100
            });
            S.save(); closeModal(); renderShop();
          }
        }
      ]);
  }

  /* =================================================================
   *  设置
   * ================================================================= */
  var SLIDERS = [
    ['setK', 'kVal', 'k', 0], ['setRD', 'rdVal', 'RD', 0], ['setSigma', 'sigmaVal', 'sigma', 0],
    ['setEloPower', 'eloPowerVal', 'eloPower', 2], ['setPrdPower', 'prdPowerVal', 'prdPower', 2],
    ['setCap', 'capVal', 'hardCapFactor', 1], ['setPC', 'pcVal', 'pointsCorrect', 0],
    ['setPW', 'pwVal', 'pointsWrong', 0], ['setCB', 'cbVal', 'comboBonus', 0],
    ['setAnim', 'animVal', 'animMs', 0]
  ];

  function renderSettings() {
    var g = st().settings;
    SLIDERS.forEach(function (row) {
      $(row[0]).value = g[row[2]];
      $(row[1]).textContent = row[2] === 'animMs' ? (g.animMs / 1000).toFixed(1) + ' 秒' : fmt(g[row[2]], row[3]);
    });
    $('setShowShop').checked = g.showShop !== false;
    var n = activeStudents().length || 1;
    var C = A.prdConstant(1 / n);
    $('prdInfo').innerHTML = '当前 <b>' + n + '</b> 人，名义抽中概率 <b>' + (100 / n).toFixed(1) + '%</b>，'
      + '由此反解出 PRD 常数 <b>C = ' + C.toFixed(4) + '</b>（使 P(n)=C×n 的长期平均命中率恰好回到名义概率）。<br>'
      + '抽取时每人权重正比于 <b>C × 连续未被点名次数</b>：越久没被点到，权重越大，刚点过的人权重归零（散热）。'
      + '再叠加硬保底 <b>' + hardCap() + '</b> 次，确保没有人被长期遗忘。';
    $('aboutText').innerHTML = '数据键名 <code>' + S.KEY + '</code>　·　记录 ' + st().log.length + ' 条';
  }

  function bindSettings() {
    SLIDERS.forEach(function (row) {
      $(row[0]).addEventListener('input', function () {
        st().settings[row[2]] = parseFloat(this.value);
        S.save();
        renderSettings();
        if (st().diffPreset && st().diffPreset !== 'custom') applyPreset(st().diffPreset);
        renderWeights();
      });
    });
  }

  /* =================================================================
   *  存档
   * ================================================================= */
  function exportJson() {
    var blob = new Blob([JSON.stringify(st(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '点名系统存档-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importJson(file) {
    var r = new FileReader();
    r.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        if (!data || !Array.isArray(data.students)) throw new Error('格式不正确');
        S.set(data);
        pending = null;
        renderAll(); renderSettings();
        toast('存档已导入');
      } catch (err) { toast('导入失败：' + err.message); }
    };
    r.readAsText(file);
  }

  /* =================================================================
   *  渲染 & 事件绑定
   * ================================================================= */
  function renderAll() {
    renderRoster(); renderLog(); renderWeights(); renderStats(); renderShop(); renderSettings();
    applyShopVisibility();
  }

  /** 「心愿商店」为 PPT 中的积分-成长-兑换闭环，可在设置里整体隐藏 */
  function applyShopVisibility() {
    var show = st().settings.showShop !== false;
    var tab = document.querySelector('.tab[data-tab="shop"]');
    tab.hidden = !show;
    if (!show && $('panel-shop').classList.contains('is-on')) switchTab('roll');
  }

  function switchTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('is-on', t.dataset.tab === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) {
      p.classList.toggle('is-on', p.id === 'panel-' + name);
    });
    if (name === 'stats') renderStats();
  }

  function bind() {
    $('tabs').addEventListener('click', function (e) {
      if (e.target.dataset.tab) switchTab(e.target.dataset.tab);
    });

    // 点名
    $('drawBtn').onclick = startDraw;
    $('rightBtn').onclick = function () { record('correct'); };
    $('wrongBtn').onclick = function () { record('wrong'); };
    $('skipBtn').onclick = function () { record('skip'); };
    $('undoBtn').onclick = undoLast;
    $('diffPresets').addEventListener('click', function (e) {
      if (e.target.dataset.preset) applyPreset(e.target.dataset.preset);
    });
    $('diffRange').addEventListener('input', function () { setDifficulty(this.value, 'custom'); });

    document.addEventListener('keydown', function (e) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (!$('backdrop').hidden) { if (e.key === 'Escape') closeModal(); return; }
      if (e.code === 'Space') { e.preventDefault(); if (!pending && !rolling) startDraw(); }
      else if (e.key === '1' && pending) record('correct');
      else if (e.key === '2' && pending) record('wrong');
      else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undoLast(); }
    });

    // 名单
    $('importBtn').onclick = function () { $('fileInput').click(); };
    $('fileInput').onchange = function () { if (this.files[0]) { handleFile(this.files[0]); this.value = ''; } };
    $('templateBtn').onclick = function () { IO.downloadTemplate(); };
    $('exportBtn').onclick = function () { IO.exportAll(st(), S.levelOf); toast('已导出 Excel'); };
    $('addBtn').onclick = function () { editStudent(null); };
    $('seedBtn').onclick = function () {
      if (st().log.length && !confirm('载入仓库名单会替换当前名单并清空成绩记录，确定吗？')) return;
      loadSeedRoster(false);
    };
    $('seedExportBtn').onclick = exportSeedRoster;
    $('demoBtn').onclick = function () {
      if (!confirm('将用 30 人虚拟名单替换当前名单，且清空所有成绩，确定吗？')) return;
      var s = st();
      s.students = S.demoRoster(); s.isDemo = true; s.rosterLabel = '虚拟名单'; s.log = []; s.redeems = [];
      pending = null; S.save(); applyPreset('normal'); renderAll();
      toast('已恢复虚拟名单');
    };
    $('clearBtn').onclick = function () {
      if (!confirm('清空全部学生及其记录，确定吗？')) return;
      var s = st(); s.students = []; s.log = []; s.redeems = []; pending = null;
      S.save(); renderAll();
    };
    $('rosterSearch').addEventListener('input', function () { rosterFilter = this.value.trim(); renderRoster(); });
    $('rosterBody').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]'); if (!btn) return;
      var s = byId(e.target.closest('tr').dataset.id); if (!s) return;
      var act = btn.dataset.act;
      if (act === 'del') {
        if (!confirm('删除「' + s.name + '」？')) return;
        var arr = st().students;
        arr.splice(arr.indexOf(s), 1);
      } else if (act === 'edit') { editStudent(s); return; }
      else if (act === 'toggle') { s.active = s.active === false; }
      S.save(); renderAll();
    });

    // 数据
    $('simBtn').onclick = runSimulation;

    // 商店
    $('addItemBtn').onclick = addShopItem;
    $('shopGrid').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]'); if (!btn) return;
      var id = e.target.closest('.shop-item').dataset.id;
      var item = st().shop.filter(function (i) { return i.id === id; })[0];
      if (!item) return;
      if (btn.dataset.act === 'redeem') redeem(item);
      else if (btn.dataset.act === 'delitem') {
        if (!confirm('删除心愿「' + item.name + '」？')) return;
        st().shop.splice(st().shop.indexOf(item), 1); S.save(); renderShop();
      }
    });

    // 设置
    bindSettings();
    $('setShowShop').addEventListener('change', function () {
      st().settings.showShop = this.checked;
      S.save(); applyShopVisibility();
    });
    $('saveJsonBtn').onclick = exportJson;
    $('loadJsonBtn').onclick = function () { $('jsonInput').click(); };
    $('jsonInput').onchange = function () { if (this.files[0]) { importJson(this.files[0]); this.value = ''; } };
    $('resetStatsBtn').onclick = function () {
      if (!confirm('清空所有点名记录、ELO 与积分，仅保留名单，确定吗？')) return;
      S.reset(true); pending = null; applyPreset('normal'); renderAll(); renderSettings();
      toast('已清空成绩');
    };
    $('resetAllBtn').onclick = function () {
      if (!confirm('恢复出厂设置（含虚拟名单），确定吗？')) return;
      S.reset(false); pending = null; applyTheme(); applyPreset('normal'); renderAll();
      toast('已恢复出厂设置');
    };

    // 弹窗 / 主题 / 全屏
    $('modalClose').onclick = closeModal;
    $('backdrop').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
    $('themeBtn').onclick = function () {
      st().settings.theme = st().settings.theme === 'dark' ? 'light' : 'dark';
      S.save(); applyTheme();
    };
    $('fsBtn').onclick = function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    };

    // 拖拽 Excel 到页面任意位置即可导入
    ['dragover', 'drop'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === 'drop' && e.dataTransfer.files[0]) {
          var f = e.dataTransfer.files[0];
          if (/\.(xlsx|xls|csv)$/i.test(f.name)) { switchTab('roster'); handleFile(f); }
          else if (/\.json$/i.test(f.name)) importJson(f);
        }
      });
    });
  }

  function applyTheme() {
    document.documentElement.dataset.theme = st().settings.theme || 'dark';
  }

  /* ------------------------------------------------------------ 启动 */
  function init() {
    var hasLocalSave = S.load();
    applyTheme();
    bind();
    if (!st().difficulty) st().difficulty = Math.round(classMean());
    setDifficulty(st().difficulty, st().diffPreset || 'normal');
    renderAll();
    // 本机还没有存档时，优先用仓库里的 data/roster.json；
    // 读不到（例如以 file:// 方式打开）就沿用内置虚拟名单。
    if (!hasLocalSave && typeof fetch === 'function') loadSeedRoster(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
