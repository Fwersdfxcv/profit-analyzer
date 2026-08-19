/* ============================================================
 * profit.js — 利润表(税务版) 与 清洗表 的 Excel 生成（纯 JS / SheetJS）
 *
 * 利润表：按内置模板(项目数据分析(总))的结构「在 JS 中完整重建」，
 *   因为 SheetJS 无法读取 openpyxl 模板里「只有公式、无缓存值」的单元格。
 *   重建后：D/F/I/L 为填入值，E/G/H/J/K 与第10行合计为公式，
 *   税率(B/C)与标签与官方模板逐格一致。「全员阅读平台」触发时
 *   纸书行(第5行) 项目税率 C 置 0。
 *
 * 清洗表：按类型拆分 sheet，追加 码洋价小计/成本小计/利润(分) 三列，
 *   均写公式(=Z*Y / =AA*Y / =AI-AA*Y)，含合计行与动销折扣行。
 * 注：纯 JS 的 SheetJS 社区版无法写入单元格底色/字体，故清洗表的
 *     「亏损行标红」在导出的 xlsx 中不体现（网页看板与预览中仍标红）。
 * ============================================================ */
(function (global) {
  'use strict';

  // 原始 36 列顺序下，关键列字母（追加 3 列于末尾 AK/AL/AM）
  // 购买数量=Y(25) 码洋价=Z(26) 成本价=AA(27) 消费积分合计=AI(35)
  const COL = { qty: 'Y', mark: 'Z', cost: 'AA', points: 'AI', markSub: 'AK', costSub: 'AL', profit: 'AM' };
  const NUMERIC_IDX = (function () { const s = new Set(); for (let i = 24; i <= 34; i++) s.add(i); return s; })();

  // ---------- 利润表（完整重建，公式与官方模板逐格一致） ----------
  // stats: { 类型: {兑换单数, 兑换金额含税, 成本含税, 平均动销成本折扣} }
  function buildProfitSheet(stats, opts) {
    opts = opts || {};
    const zeroPaper = !!opts.zeroPaperTax;
    const num = (n, fmt) => ({ t: 'n', v: n, z: fmt || 'General' });
    const fml = s => ({ t: 'n', f: s });          // 公式字符串不带前导 '='
    const emp = () => ({ t: 'n' });               // 空数字占位

    // 行结构（含静态标签/税率/零值，公式与输入列留空后续填充）
    const aoa = [
      ['现口径：'],                                                                                 // 2
      ['兑换单类型', '成本税率', '项目税率', '兑换单数', '兑换量占比', '兑换金额（含税）', '兑换金额（不含税）', '金额占比', '成本（含税）', '成本（不含税）', '利润率', '平均动销成本折扣(含税)'], // 3
      ['权益订单', 0.06, 0.06, emp(), emp(), emp(), emp(), emp(), emp(), emp(), emp(), emp()],      // 4
      ['纸书订单', 0, zeroPaper ? 0 : 0.06, emp(), emp(), emp(), emp(), emp(), emp(), emp(), emp(), emp()], // 5
      ['文创', 0.13, 0.06, emp(), emp(), emp(), emp(), emp(), emp(), emp(), emp(), emp()],          // 6
      ['电子书/有声书成本', '', '', emp(), emp(), 0, 0, emp(), 0, 0, emp(), emp()],                 // 7
      ['活动成本', '', '', emp(), emp(), 0, 0, emp(), 0, 0, emp(), emp()],                         // 8
      ['其他：', '', '', emp(), emp(), 0, 0, emp(), 0, 1800, emp(), emp()],                        // 9
      ['总', '', 0.06, emp(), emp(), emp(), emp(), emp(), emp(), emp(), emp(), emp()]             // 10
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!ref'] = 'A2:L10';

    const TYPE_ROW = { '权益': 4, '纸书': 5, '文创': 6 };
    // 填入 D/F/I/L（输入列），并设置 E/G/H/J/K 公式（与模板逐格一致）
    Object.keys(stats).forEach(t => {
      const row = TYPE_ROW[t]; if (!row) return;
      const s = stats[t];
      ws['D' + row] = num(s.兑换单数, '0');
      ws['F' + row] = num(s.兑换金额含税, '0.00');
      ws['I' + row] = num(s.成本含税, '0.00');
      ws['L' + row] = num(s.平均动销成本折扣, '0.0000');
      if (row === 4) {
        ws['E4'] = fml('D4/D10'); ws['G4'] = fml('F4/(1+C4)'); ws['H4'] = fml('F4/F10'); ws['J4'] = fml('I4/(1+B4)'); ws['K4'] = fml('(G4-J4)/G4');
      } else if (row === 5) {
        ws['E5'] = fml('D5/D10'); ws['G5'] = fml('F5/(1+C5)'); ws['H5'] = fml('F5/F10'); ws['J5'] = fml('I5/(1+B5)'); ws['K5'] = fml('(G5-J5)/G5');
      } else if (row === 6) {
        ws['G6'] = fml('F6/(1+C6)'); ws['J6'] = fml('I6/(1+B6)'); // 模板中 文创 无 E/H
      }
    });
    // 第10行合计公式（与模板一致：D10=D4+D5 仅权益+纸书；金额/成本 SUM(F4:F9)）
    ws['D10'] = fml('D4+D5');
    ws['F10'] = fml('SUM(F4:F9)'); ws['G10'] = fml('SUM(G4:G9)');
    ws['I10'] = fml('SUM(I4:I9)'); ws['J10'] = fml('SUM(J4:J9)');
    ws['K10'] = fml('(G10-J10)/G10');
    return ws;
  }

  function buildProfitWB(stats, opts) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildProfitSheet(stats, opts), '项目数据分析（总）');
    return wb;
  }
  function buildProfitBlob(wb) {
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------- 清洗表 ----------
  function buildCleanWB(groups, order, headers) {
    const wb = XLSX.utils.book_new();
    const toNum = global.Calc ? global.Calc.toNum : function (v) { const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
    order.forEach(t => {
      const g = groups[t];
      const head = headers.concat(['码洋价小计', '成本小计', '利润(分)']);
      const data = [head];
      const rowsSorted = g.slice().sort((a, b) => a._profit - b._profit);
      rowsSorted.forEach(c => {
        const line = headers.map((_, i) => NUMERIC_IDX.has(i) ? toNum(c.raw[headers[i]]) : (c.raw[headers[i]] == null ? '' : c.raw[headers[i]]));
        data.push(line.concat([null, null, null]));
      });
      const ws = XLSX.utils.aoa_to_sheet(data);
      const lastData = rowsSorted.length;
      for (let r = 2; r <= lastData + 1; r++) {
        ws[COL.markSub + r] = { t: 'n', f: COL.mark + r + '*' + COL.qty + r };
        ws[COL.costSub + r] = { t: 'n', f: COL.cost + r + '*' + COL.qty + r };
        ws[COL.profit + r] = { t: 'n', f: COL.points + r + '-' + COL.cost + r + '*' + COL.qty + r };
      }
      const tr = lastData + 2, dr = lastData + 3;
      ws['A' + tr] = { t: 's', v: '合计' };
      ws[COL.markSub + tr] = { t: 'n', f: 'SUM(' + COL.markSub + '2:' + COL.markSub + (lastData + 1) + ')' };
      ws[COL.costSub + tr] = { t: 'n', f: 'SUM(' + COL.costSub + '2:' + COL.costSub + (lastData + 1) + ')' };
      ws[COL.profit + tr] = { t: 'n', f: 'SUM(' + COL.profit + '2:' + COL.profit + (lastData + 1) + ')' };
      ws['A' + dr] = { t: 's', v: '动销成本折扣' };
      ws[COL.markSub + dr] = { t: 'n', f: COL.costSub + tr + '/' + COL.markSub + tr, z: '0.0000' };
      ws['!ref'] = 'A1:' + COL.profit + dr;
      XLSX.utils.book_append_sheet(wb, ws, String(t).slice(0, 28));
    });
    return wb;
  }
  function buildCleanBlob(wb) {
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const API = { buildProfitSheet, buildProfitWB, buildProfitBlob, buildCleanWB, buildCleanBlob, COL };
  global.Profit = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
