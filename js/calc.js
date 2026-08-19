/* ============================================================
 * calc.js — 利润分析核心计算（纯函数，浏览器/Node 通用）
 * 口径严格对齐 exchange-profit-report 技能：
 *   - 原始金额字段单位为「分」，输出统一 /100 转为「元」
 *   - 清洗：剔除【类型】为空、剔除【消费积分合计】=0 的行
 *   - 四项指标按类型计算（成本/码洋必须先 ×购买数量 再求和）
 * ============================================================ */
(function (global) {
  'use strict';

  // 标准 36 列（与导出表一致）
  const STD_COLS = [
    '企业名称', '企业编码', '姓名', '手机号', '所属部门', 'isbn', '商品ID', '商品名称',
    '兑换时间', '兑换单编号', '兑换单类型', '订单来源', '子订单号', 'CP名/品牌名称',
    '类型', '出版社', '出版日期', '作者', '关联标签', '一级分类', '二级分类',
    '新一级分类', '新二级分类', '书城分类', '购买数量', '码洋价', '成本价', '销售价',
    '实付单价', '实付金额', '订单金额', '税费', '退款数量', '退款积分小计',
    '消费积分合计', '第三方订单编号'
  ];

  // 兑换类型 → 利润表行号（与模板一致）
  const TYPE_ROW = { '权益': 4, '纸书': 5, '文创': 6 };
  const TYPE_ORDER = ['权益', '纸书', '文创'];
  const CENTS = 100; // 分 → 元

  // ---------- 工具 ----------
  function toNum(v) {
    if (v == null) return 0;
    if (typeof v === 'boolean') return 0;
    if (typeof v === 'number') return v;
    let s = String(v).trim().replace(/,/g, '').replace(/'/g, '').replace(/¥/g, '');
    if (!s || s === '-' || s === '--' || s === 'None' || s === 'nan') return 0;
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  function norm(s) {
    return s == null ? '' : String(s).trim().replace('（', '(').replace('）', ')');
  }
  function fc(v) {
    if (v == null || v === undefined) return '';
    if (typeof v === 'number') return v.toLocaleString('zh-CN');
    return String(v);
  }

  // ---------- 列映射（自动识别） ----------
  // 每个字段的可选中文列名关键词
  const BF = [
    { k: 'type', l: '类型列', req: true, keys: ['类型'] },
    { k: 'points', l: '消费积分合计（收入·分）', req: true, keys: ['消费积分合计', '消费积分', '积分合计', '积分'] },
    { k: 'cost', l: '成本价列', req: true, keys: ['成本价', '成本'] },
    { k: 'qty', l: '购买数量列', req: true, keys: ['购买数量', '数量'] },
    { k: 'listPrice', l: '码洋价列', req: false, keys: ['码洋价', '码洋', '定价', '标价'] },
    { k: 'productId', l: '商品ID列', req: false, keys: ['商品id', '商品ID', '商品编号', 'sku', '货号'] },
    { k: 'productName', l: '商品名称列', req: false, keys: ['商品名称', '商品名', '名称', '商品'] },
    { k: 'user', l: '用户标识列', req: false, keys: ['手机号', '电话', '手机', '姓名', '客户'] },
    { k: 'time', l: '兑换时间列', req: false, keys: ['兑换时间', '时间', '日期', '下单时间'] },
    { k: 'orderNo', l: '订单编号列', req: false, keys: ['第三方订单编号', '订单编号', '订单号'] }
  ];
  function scoreHeader(h, k) {
    h = norm(h).toLowerCase(); k = k.toLowerCase();
    if (h === k) return 100;
    if (h.endsWith(k)) return 60;
    if (h.startsWith(k)) return 50;
    if (h.includes(k)) return 40;
    return -1;
  }
  function guessMap(headers) {
    const m = {};
    BF.forEach(f => {
      let best = -1, bi = -1;
      headers.forEach((x, i) => {
        f.keys.forEach(k => { const s = scoreHeader(x, k); if (s > best) { best = s; bi = i; } });
      });
      if (bi >= 0 && best >= 40) m[f.k] = bi;
    });
    if (m.productName === undefined) {
      const c = headers.findIndex((x, i) => i !== m.type && i !== m.points && i !== m.cost && i !== m.qty && i !== m.listPrice);
      if (c >= 0) m.productName = c;
    }
    return m;
  }
  function getCell(r, headers, map, k) {
    const i = map[k];
    if (i == null) return null;
    return r[headers[i]];
  }

  // ---------- 清洗 ----------
  // 返回带计算字段的数组；每个元素 { raw, _qty,_listP,_cost,_points,_profit,_listSub,_costSub }
  function cleanRows(rows, headers, map) {
    const out = [];
    rows.forEach(r => {
      const t = getCell(r, headers, map, 'type');
      if (t == null || norm(t) === '') return;            // 剔除类型为空
      const p = toNum(getCell(r, headers, map, 'points'));
      if (p === 0) return;                                 // 剔除消费积分合计=0
      const qty = toNum(getCell(r, headers, map, 'qty')) || 0;
      const listP = toNum(getCell(r, headers, map, 'listPrice')) || 0;
      const cost = toNum(getCell(r, headers, map, 'cost')) || 0;
      out.push({
        raw: r,
        _qty: qty, _listP: listP, _cost: cost, _points: p,
        _profit: p - cost * qty,
        _listSub: listP * qty,
        _costSub: cost * qty
      });
    });
    return out;
  }

  // ---------- 分组 ----------
  function groupByType(cleaned, headers, map) {
    const groups = {};
    cleaned.forEach(c => {
      const t = norm(getCell(c.raw, headers, map, 'type'));
      (groups[t] = groups[t] || []).push(c);
    });
    const order = [
      ...TYPE_ORDER.filter(t => groups[t]),
      ...Object.keys(groups).filter(t => !TYPE_ORDER.includes(t))
    ];
    return { groups, order };
  }

  // ---------- 类型汇总（与利润表口径一致） ----------
  // 返回 { 类型: { 兑换单数, 兑换金额含税, 成本含税, 平均动销成本折扣, _ps,_cs,_ls } }
  function summarize(groups) {
    const stats = {};
    Object.keys(groups).forEach(t => {
      const g = groups[t];
      let ps = 0, cs = 0, ls = 0;
      g.forEach(r => { ps += r._points; cs += r._costSub; ls += r._listSub; });
      stats[t] = {
        兑换单数: g.length,
        兑换金额含税: +(ps / CENTS).toFixed(2),
        成本含税: +(cs / CENTS).toFixed(2),
        平均动销成本折扣: ls ? +(cs / ls).toFixed(4) : 0,
        _ps: ps, _cs: cs, _ls: ls
      };
    });
    return stats;
  }

  // ---------- 商品级分析（看板用） ----------
  function analyzeProducts(cleaned, headers, map, opts) {
    opts = opts || {};
    const rpt = (opts.rpt != null ? opts.rpt : 30) / 100;
    const moT = opts.moT != null ? opts.moT : 3;
    const pMap = new Map();
    cleaned.forEach(c => {
      const r = c.raw;
      const type = norm(getCell(r, headers, map, 'type'));
      const pid = fc(getCell(r, headers, map, 'productId')) || '';
      const pname = fc(getCell(r, headers, map, 'productName')) || '(未命名)';
      const key = type + '|' + pid + '|' + pname;
      const user = map.user != null ? fc(getCell(r, headers, map, 'user')) : null;
      if (!pMap.has(key)) pMap.set(key, { type, pid, pname, count: 0, rev: 0, cost: 0, list: 0, qtySum: 0, users: {} });
      const p = pMap.get(key);
      p.count++; p.rev += c._points; p.cost += c._costSub; p.list += c._listSub; p.qtySum += c._qty;
      if (user) p.users[user] = (p.users[user] || 0) + 1;
    });
    const products = [...pMap.values()].map(p => {
      const profit = p.rev - p.cost;
      const costRate = p.rev ? p.cost / p.rev : 0;
      const discount = p.list ? p.cost / p.list : 0;
      const exRate = p.list ? p.rev / p.list : 0;
      const avgQty = p.count ? p.qtySum / p.count : 0;
      const ucs = Object.values(p.users);
      const du = ucs.length;
      const muo = ucs.length ? Math.max(...ucs) : 0;
      const rr = p.count ? (p.count - du) / p.count : 0;
      const reasons = [];
      if (discount > 0.5) reasons.push('成本高(动销折扣偏高)');
      if (exRate < 0.3) reasons.push('积分兑换价偏低');
      if (discount > 0.5 && exRate < 0.3) reasons.push('成本与定价双高');
      if (avgQty >= 3) reasons.push('量大');
      if (!reasons.length) reasons.push('常规');
      const isNeg = profit < 0;
      const isRisk = isNeg && p.count >= 3 && (muo >= moT || rr >= rpt);
      return {
        type: p.type, pid: p.pid, pname: p.pname, count: p.count,
        revY: +(p.rev / CENTS).toFixed(2), costY: +(p.cost / CENTS).toFixed(2),
        profitY: +(profit / CENTS).toFixed(2),
        costRate, discount, exRate, avgQty, du, muo, rr, reasons, isNeg, isRisk
      };
    });
    return products;
  }

  // ---------- 日均 ----------
  function dailyAgg(cleaned, headers, map) {
    const dm = new Map();
    cleaned.forEach(c => {
      const r = c.raw;
      let dk = '无日期';
      if (map.time != null) {
        const dv = getCell(r, headers, map, 'time');
        if (dv != null && dv !== '') {
          const dt = new Date(dv);
          if (!isNaN(dt)) dk = dt.toISOString().slice(0, 10);
        }
      }
      if (!dm.has(dk)) dm.set(dk, { date: dk, profit: 0, count: 0 });
      const d = dm.get(dk);
      d.profit += c._profit; d.count++;
    });
    const daily = [...dm.values()].sort((a, b) => a.date < b.date ? -1 : 1);
    let cum = 0;
    daily.forEach(d => { cum += d.profit / CENTS; d.cum = +cum.toFixed(2); d.profitY = +(d.profit / CENTS).toFixed(2); });
    return daily;
  }

  // ---------- KPI ----------
  function fmtM(n) {
    if (n == null || isNaN(n)) return '-';
    return (n < 0 ? '-' : '') + '¥' + Math.abs(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }
  function fmtP(n) {
    if (n == null || isNaN(n)) return '-';
    return (n * 100).toFixed(1) + '%';
  }
  function calcKPIs(products, daily) {
    const tCnt = products.reduce((s, p) => s + p.count, 0);
    const tRev = products.reduce((s, p) => s + p.revY, 0);
    const tCost = products.reduce((s, p) => s + p.costY, 0);
    const tProfit = tRev - tCost;
    const negP = products.filter(p => p.isNeg);
    const negAmt = negP.reduce((s, p) => s + p.profitY, 0);
    const riskP = products.filter(p => p.isRisk);
    const avgD = daily.length ? daily.reduce((s, d) => s + d.profitY, 0) / daily.length : 0;
    return [
      { l: '总单数', v: tCnt.toLocaleString(), s: '清洗后有效单' },
      { l: '总收入(元)', v: fmtM(tRev), s: '消费积分合计÷100' },
      { l: '总成本(元)', v: fmtM(tCost), s: '成本价×数量÷100' },
      { l: '总利润(元)', v: fmtM(tProfit), s: '收入−成本', c: tProfit < 0 ? 'neg' : '' },
      { l: '整体利润率', v: fmtP(tRev ? tProfit / tRev : 0), s: '总利润/总收入', c: tProfit < 0 ? 'neg' : '' },
      { l: '负利润商品', v: negP.length + ' 个', s: '亏损额 ' + fmtM(negAmt), c: negP.length ? 'neg' : '' },
      { l: '刷单风险商品', v: riskP.length + ' 个', s: '负利润×重复购买', c: riskP.length ? 'neg' : '' },
      { l: '日均利润(元)', v: fmtM(avgD), s: daily.length + ' 天', c: avgD < 0 ? 'neg' : '' }
    ];
  }

  // 从文件名提取「期号」(如 8.3 / 2026.08)，用于输出文件命名
  function deriveTag(stem) {
    const m = String(stem || '').match(/(\d{1,2}[.\-_]\d{1,2})/);
    if (m) return m[1].replace(/-/g, '.').replace(/_/g, '.');
    const d = new Date();
    return (d.getMonth() + 1) + '.' + d.getDate();
  }

  const API = {
    STD_COLS, TYPE_ROW, TYPE_ORDER, CENTS,
    toNum, norm, fc, guessMap, getCell,
    cleanRows, groupByType, summarize, analyzeProducts, dailyAgg,
    calcKPIs, fmtM, fmtP, deriveTag
  };
  global.Calc = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
