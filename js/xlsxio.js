/*!
 * xlsxio.js —— Excel 名单导入 / 成绩单导出
 * 依赖 vendor/xlsx.full.min.js（SheetJS），全部在浏览器本地完成，姓名数据不出本机。
 */
(function (root) {
  'use strict';

  /** 读取文件 → { headers: [], rows: [[]] }，自动跳过全空行 */
  function readWorkbook(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.onload = function (e) {
        try {
          var wb = XLSX.read(e.target.result, { type: 'array' });
          var sheets = wb.SheetNames.map(function (name) {
            var rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' });
            rows = rows.filter(function (r) {
              return r.some(function (c) { return String(c).trim() !== ''; });
            });
            return { name: name, rows: rows };
          }).filter(function (s) { return s.rows.length; });
          if (!sheets.length) return reject(new Error('表格里没有读到任何内容'));
          resolve(sheets);
        } catch (err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /** 猜测姓名列：优先表头含"姓名/名字/学生"，否则取汉字比例最高的一列 */
  function guessNameColumn(rows) {
    if (!rows.length) return 0;
    var head = rows[0].map(function (h) { return String(h).trim(); });
    for (var i = 0; i < head.length; i++) {
      if (/姓\s*名|名字|学生|人名|name/i.test(head[i])) return i;
    }
    var best = 0, bestScore = -1;
    var body = rows.slice(1, 30);
    for (var c = 0; c < head.length; c++) {
      var score = 0;
      body.forEach(function (r) {
        var v = String(r[c] === undefined ? '' : r[c]).trim();
        if (/^[一-龥·]{2,5}$/.test(v)) score += 2;
        else if (/^[A-Za-z][A-Za-z .'-]{1,20}$/.test(v)) score += 1;
      });
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  /** 猜测成绩列：表头含"成绩/分数/得分" */
  function guessScoreColumn(rows) {
    if (!rows.length) return -1;
    var head = rows[0].map(function (h) { return String(h).trim(); });
    for (var i = 0; i < head.length; i++) {
      if (/成绩|分数|得分|score|elo|评分/i.test(head[i])) return i;
    }
    return -1;
  }

  /**
   * 把成绩换算为初始 ELO：以班级平均分为基准 ELO，按标准差线性映射。
   * 若数值本身已在 600~2600 区间（说明用户直接给的就是 ELO），则原样使用。
   */
  function scoresToElo(scores, baseElo) {
    var nums = scores.map(function (v) { return parseFloat(v); });
    var valid = nums.filter(function (v) { return isFinite(v); });
    if (!valid.length) return nums.map(function () { return baseElo; });
    var looksLikeElo = valid.every(function (v) { return v >= 600 && v <= 2600; })
      && valid.some(function (v) { return v > 150; });
    if (looksLikeElo) {
      return nums.map(function (v) { return isFinite(v) ? Math.round(v) : baseElo; });
    }
    var m = valid.reduce(function (a, b) { return a + b; }, 0) / valid.length;
    var sd = Math.sqrt(valid.reduce(function (a, v) { return a + (v - m) * (v - m); }, 0) / valid.length) || 1;
    return nums.map(function (v) {
      if (!isFinite(v)) return baseElo;
      var z = (v - m) / sd;
      return Math.round(baseElo + Math.max(-2.5, Math.min(2.5, z)) * 150);
    });
  }

  /** 生成导入用的模板文件 */
  function downloadTemplate() {
    var data = [
      ['姓名', '组别', '参考成绩'],
      ['张三', '第一组', 88],
      ['李四', '第一组', 76],
      ['王五', '第二组', 93]
    ];
    var ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '名单');
    XLSX.writeFile(wb, '点名系统-名单模板.xlsx');
  }

  /** 导出当前名单 + 统计 + 点名流水 */
  function exportAll(state, levelOf) {
    var wb = XLSX.utils.book_new();

    var head = ['姓名', '组别', '当前ELO', '初始ELO', 'ELO变化', '被点次数', '答对', '答错', '正确率', '积分', '等级', '连续未点名', '出勤'];
    var rows = state.students.map(function (s) {
      var rate = s.picks ? (s.correct / s.picks) : 0;
      return [
        s.name, s.group || '', Math.round(s.elo), Math.round(s.initElo), Math.round(s.elo - s.initElo),
        s.picks, s.correct, s.wrong, +rate.toFixed(3),
        s.points, levelOf(s.points).name, s.prdFail, s.active ? '在' : '缺'
      ];
    });
    var ws1 = XLSX.utils.aoa_to_sheet([head].concat(rows));
    ws1['!cols'] = head.map(function (h) { return { wch: Math.max(8, h.length * 2 + 2) }; });
    XLSX.utils.book_append_sheet(wb, ws1, '名单与统计');

    var logHead = ['时间', '姓名', '题目难度', '结果', 'ELO变化', '变化后ELO', '积分变化', '是否保底'];
    var logRows = state.log.slice().reverse().map(function (l) {
      return [
        new Date(l.t).toLocaleString('zh-CN'), l.name, l.difficulty,
        l.result === 'correct' ? '答对' : (l.result === 'wrong' ? '答错' : '跳过'),
        l.eloDelta === null || l.eloDelta === undefined ? '' : Math.round(l.eloDelta * 10) / 10,
        l.eloAfter === null || l.eloAfter === undefined ? '' : Math.round(l.eloAfter),
        l.pointDelta || 0, l.forced ? '是' : ''
      ];
    });
    var ws2 = XLSX.utils.aoa_to_sheet([logHead].concat(logRows));
    ws2['!cols'] = logHead.map(function () { return { wch: 14 }; });
    XLSX.utils.book_append_sheet(wb, ws2, '点名流水');

    var rHead = ['时间', '姓名', '兑换物品', '消耗积分'];
    var rRows = state.redeems.slice().reverse().map(function (r) {
      return [new Date(r.t).toLocaleString('zh-CN'), r.name, r.item, r.cost];
    });
    var ws3 = XLSX.utils.aoa_to_sheet([rHead].concat(rRows));
    ws3['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws3, '心愿兑换记录');

    var stamp = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    XLSX.writeFile(wb, '点名数据-' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate())
      + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + '.xlsx');
  }

  root.XlsxIO = {
    readWorkbook: readWorkbook,
    guessNameColumn: guessNameColumn,
    guessScoreColumn: guessScoreColumn,
    scoresToElo: scoresToElo,
    downloadTemplate: downloadTemplate,
    exportAll: exportAll
  };
})(window);
