/* ============================================================
 * app.js — 交互主逻辑
 * 流程：设置项目名 → 选择保存路径 → 上传 → 归属(银行/省/市自动匹配)
 *      → 确认列映射 → 清洗 → 生成利润表(税务版)+看板 → 写回保存路径
 * ============================================================ */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const show = id => { const e = $(id); if (e) e.classList.remove('hid'); };
  const hide = id => { const e = $(id); if (e) e.classList.add('hid'); };
  const esc = s => { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; };
  const rid = () => 'f' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const ECHARTS_URL = new URL('./libs/echarts.min.js', location.href).href;

  const S = { projectName: '', fid: null, headers: [], rows: [], map: {}, cleaned: [], groups: {}, order: [], stats: {}, products: [], daily: [], kpis: [], fileName: '', bank: '', province: '', city: '' };
  let saveDirHandle = null;
  let _mapCache = [];

  // ---------------- 初始化 ----------------
  async function init() {
    await Store.initDB();
    await Store.seedMapping();
    await refreshMapCache();
    loadFirstLibs();
    await initDirHandle();
    const s = await Store.getSetting('project');
    if (s && s.value) { S.projectName = s.value; showMain(); }
    else { hide('v-fl'); hide('v-up'); hide('v-map'); show('v-su'); }
  }

  function loadFirstLibs() {
    const b = $('banner');
    if (typeof XLSX === 'undefined') { b.className = 'bn show er'; b.textContent = '⚠ Excel 解析组件加载失败'; return; }
    if (b) { b.className = 'bn show ok'; b.textContent = '✅ 解析引擎已就绪'; setTimeout(() => b.classList.remove('show'), 1800); }
  }

  // ---------------- 导航 ----------------
  document.querySelectorAll('.sbi[data-v]').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.sbi').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      ['files', 'upload', 'map'].forEach(v => hide('v-' + v));
      show('v-' + b.dataset.v);
      $('pgT').textContent = { files: '文件管理', upload: '上传文件', map: '映射管理' }[b.dataset.v] || '';
      if (b.dataset.v === 'map') loadMappingTable();
      if (b.dataset.v === 'files') renderFiles();
      if (b.dataset.v === 'upload') renderSavePath();
    };
  });
  $('gbUp').onclick = () => {
    document.querySelector('.sbi[data-v="upload"]').click();
    if (!saveDirHandle && isFSA()) { needPath(); return; }
    $('fInput').click();
  };

  // ---------------- 设置 ----------------
  $('suGo').onclick = async () => {
    const n = $('suName').value.trim();
    if (!n) { alert('请输入项目名称'); return; }
    S.projectName = n; await Store.putSetting('project', n); hide('v-su'); showMain();
  };
  function showMain() { show('v-fl'); renderFiles(); buildFilters(); }

  // ---------------- 保存路径（File System Access） ----------------
  function isFSA() { return typeof window.showDirectoryPicker === 'function'; }
  async function initDirHandle() {
    if (!isFSA()) { renderSavePath(); return; }
    try {
      const s = await Store.getSetting('saveDir');
      if (s && s.value) {
        try { const st = await s.value.requestPermission({ mode: 'readwrite' }); if (st === 'granted') { saveDirHandle = s.value; } }
        catch (e) { /* 权限被拒，下次上传时再提示 */ }
      }
    } catch (e) { /* 忽略：内存兜底模式下 settings 仍可读 */ }
    renderSavePath();
  }
  $('pickDirMain').onclick = pickDir;
  if ($('pickDirUp')) $('pickDirUp').onclick = pickDir;
  if ($('pickDirSu')) $('pickDirSu').onclick = pickDir;
  let _pickTried = false;
  async function pickDir() {
    if (!isFSA()) {
      alert('当前浏览器/环境不支持「直接写入本机文件夹」（需 Chrome / Edge，且页面以顶层页打开，而非嵌套预览框）。\n未设置时，生成的文件将改为「下载」方式，由你手动选择保存位置。');
      renderSavePath();
      return;
    }
    try {
      const h = await window.showDirectoryPicker({ mode: 'readwrite' });
      saveDirHandle = h; _pickTried = true;
      const c = $('saveCardUp'); if (c) c.classList.remove('hl');
      hide('uErr'); hide('uOk');
      try { await Store.putSetting('saveDir', h); } catch (e) { /* 内存兜底 */ }
      logOp('✅ 已关联本机文件夹：' + h.name + '（上传原文件与生成的报表将自动保存到这里）');
    } catch (e) {
      if (e.name === 'AbortError') { /* 用户取消，忽略 */ }
      else { logOp('选择文件夹失败：' + (e.message || e.name)); }
    }
    renderSavePath();
  }
  function renderSavePath() {
    const set = saveDirHandle ? ('已关联：' + saveDirHandle.name) : (isFSA() ? '未设置（点击设置后文件自动写入本机）' : '当前环境不支持 · 将使用「下载」方式');
    const setLong = saveDirHandle ? ('已关联本机文件夹：' + saveDirHandle.name + ' · 上传原文件与生成报表将自动保存') : (isFSA() ? '未设置 · 上传的文件与生成的报表将以「下载」方式保存' : '当前浏览器/环境不支持直接写入本机文件夹 · 将使用「下载」方式保存');
    if ($('dirInfoMain')) $('dirInfoMain').textContent = set;
    if ($('dirInfoUp')) $('dirInfoUp').textContent = set;
    if ($('suDirInfo')) $('suDirInfo').textContent = setLong;
    const badge = saveDirHandle ? '✅' : '⚠️';
    if ($('dirBadgeUp')) $('dirBadgeUp').textContent = badge;
    const badgeSu = saveDirHandle ? '✅ 已设置' : '⚠️ 未设置';
    if ($('suDirBadge')) $('suDirBadge').textContent = badgeSu;
    if ($('upNeedPath')) $('upNeedPath').style.display = (!saveDirHandle && isFSA()) ? 'block' : 'none';
  }
  function syncDirInfo() { renderSavePath(); }
  function logOp(m) { const e = $('opLog'); if (e) e.textContent = m; }
  async function saveToDir(filename, blob) {
    if (saveDirHandle) {
      try { const fh = await saveDirHandle.getFileHandle(filename, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); return '已保存到本机文件夹 [' + saveDirHandle.name + '] / ' + filename; }
      catch (e) { return '自动保存失败（' + e.message + '），请改用下载按钮。'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return '已触发下载：' + filename + '（请在弹窗中选择本机保存路径）';
  }

  // ---------------- 上传 ----------------
  function needPath() {
    const c = $('saveCardUp'); if (c) c.classList.add('hl');
    const e = $('uErr'); if (e) { e.textContent = '⚠️ 上传前必须先设置「保存路径」。请点击上方「📂 设置保存文件夹」选择本机目录，设置后即可上传并把文件自动存入该路径。'; show('uErr'); }
  }
  const uz = $('uzone');
  if (uz) {
    uz.onclick = () => {
      if (!saveDirHandle && isFSA()) { needPath(); return; }
      $('fInput').click();
    };
    ['dragenter', 'dragover'].forEach(ev => uz.addEventListener(ev, e => { e.preventDefault(); uz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => uz.addEventListener(ev, e => { e.preventDefault(); uz.classList.remove('drag'); }));
    uz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) doUpload(f); });
  }
  if ($('fInput')) $('fInput').onchange = e => { if (e.target.files[0]) doUpload(e.target.files[0]); };

  async function doUpload(file) {
    hide('uErr'); hide('uOk'); hide('rcard'); hide('mcard'); hide('ccard'); $('anMsg').textContent = '';
    if (!saveDirHandle) {
      if (isFSA()) { needPath(); return; }
      const e = $('uErr'); if (e) { e.textContent = 'ℹ️ 当前浏览器不支持「设置保存路径」（请改用 Chrome / Edge）。文件将以「下载」方式保存，请在弹窗中选择本机位置。'; show('uErr'); }
    }
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sn = wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
      if (!rows.length) throw new Error('空文件或无可识别的表头');
      S.headers = Object.keys(rows[0]); S.rows = rows; S.fid = rid(); S.fileName = file.name;
      await saveToDir(file.name, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const bank = suggestBank(file.name); $('rBank').value = bank;
      await applyMapping(bank);
      S.bank = bank; S.province = $('rProv').value.trim(); S.city = $('rCity').value.trim();
      show('rcard');
      S.map = Calc.guessMap(S.headers); buildMapGrid('mGrid', S.map); show('mcard');
      await Store.putFile({ id: S.fid, name: file.name, project: S.projectName, province: S.province, city: S.city, bank: bank, uploadTime: Date.now(), rowCount: rows.length, status: 'raw', rawData: buf, headers: S.headers, map: S.map });
      const ok = $('uOk'); if (ok) { ok.textContent = '✅ 上传成功：' + file.name + '（' + rows.length + ' 行）' + (saveDirHandle ? (' · 已保存到文件夹「' + saveDirHandle.name + '」') : ' · 已触发下载'); show('uOk'); }
      const rc = $('rcard'); if (rc && rc.scrollIntoView) rc.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelector('.sbi[data-v="upload"]').click(); show('v-up');
    } catch (err) { $('uErr').textContent = '解析失败：' + err.message; show('uErr'); }
  }

  // 银行输入 → 自动匹配省/市
  if ($('rBank')) $('rBank').oninput = async () => { await applyMapping($('rBank').value.trim()); };
  async function applyMapping(bank) {
    const m = bank ? await Store.getMapping(bank) : null;
    if (m) { $('rProv').value = m.province || ''; $('rCity').value = m.city || ''; }
  }
  function suggestBank(filename) {
    const name = (filename || '').replace(/\.[^.]+$/, '');
    for (const k of _mapCache) { if (name.includes(k)) return k; }
    const seg = name.split(/[_\-]/)[0];
    return seg || '';
  }
  async function refreshMapCache() { const all = await Store.getAllMapping(); _mapCache = all.map(m => m.bank); }

  // ---------------- 列映射 UI ----------------
  function buildMapGrid(containerId, map) {
    const c = $(containerId); c.innerHTML = '';
    const pfx = containerId === 'mGrid' ? 'map_' : 'moMap_';
    Calc.BF.forEach(f => {
      const d = document.createElement('div'); d.className = 'cf';
      const l = document.createElement('label'); l.textContent = f.l + (f.req ? ' *' : '');
      const s = document.createElement('select'); s.id = pfx + f.k;
      const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '— 不使用 —'; s.appendChild(o0);
      S.headers.forEach((h, i) => { const o = document.createElement('option'); o.value = i; o.textContent = h; if (map && map[f.k] === i) o.selected = true; s.appendChild(o); });
      d.appendChild(l); d.appendChild(s); c.appendChild(d);
    });
  }
  function readMap(pfx) { const m = {}; Calc.BF.forEach(f => { const v = $(pfx + f.k).value; m[f.k] = v === '' ? null : +v; }); return m; }

  // ---------------- 清洗 ----------------
  $('doClean').onclick = () => runClean('mErr', 'map_');
  $('moCleanBtn').onclick = () => runClean('moErr', 'moMap_');

  async function runClean(errId, pfx) {
    const map = readMap(pfx);
    if (map.type == null || map.points == null || map.cost == null || map.qty == null) { $(errId).textContent = '类型、消费积分合计、成本价、购买数量为必填列'; show(errId); return; }
    hide(errId);
    const cleaned = Calc.cleanRows(S.rows, S.headers, map);
    if (!cleaned.length) { $(errId).textContent = '清洗后无有效数据（请检查列映射）'; show(errId); return; }
    const grp = Calc.groupByType(cleaned, S.headers, map);
    S.cleaned = cleaned; S.groups = grp.groups; S.order = grp.order; S.stats = Calc.summarize(grp.groups); S.map = map;
    // 归属 + 新映射记忆
    S.bank = $('rBank').value.trim(); S.province = $('rProv').value.trim(); S.city = $('rCity').value.trim();
    if (S.bank && S.province && S.city) { await Store.putMapping({ bank: S.bank, province: S.province, city: S.city }); await refreshMapCache(); }
    // 预览
    const sel = $('cTypeSel'); sel.innerHTML = '';
    S.order.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t + '（' + S.groups[t].length + ' 单）'; sel.appendChild(o); });
    sel.onchange = () => renderClean(sel.value);
    $('cBadge').textContent = '共 ' + cleaned.length + ' 单 · ' + S.order.length + ' 个类型';
    renderClean(S.order[0]);
    if (pfx === 'map_') { hide('mcard'); show('ccard'); }
    if (S.fid) { const fi = await Store.getFile(S.fid); if (fi) { fi.status = 'cleaned'; fi.map = map; fi.headers = S.headers; fi.province = S.province; fi.city = S.city; fi.bank = S.bank; await Store.putFile(fi); } }
    $('anMsg').textContent = '';
    renderFiles();
  }

  function renderClean(type) {
    const g = S.groups[type] || []; const h = S.headers;
    const head = [...h, '码洋价小计', '成本小计', '利润(分)'];
    let html = '<thead><tr>' + head.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>';
    let ps = 0, cs = 0, ls = 0;
    g.forEach(r => { ps += r._points; cs += r._costSub; ls += r._listSub; html += '<tr' + (r._profit < 0 ? ' class="wr"' : '') + '>' + head.map(x => '<td>' + esc(r.raw[x]) + '</td>').join('') + '<td>' + r._listSub + '</td><td>' + r._costSub + '</td><td class="' + (r._profit < 0 ? 'neg' : '') + '" style="font-weight:600;">' + r._profit + '</td></tr>'; });
    html += '<tr style="font-weight:700;background:var(--g50);"><td>合计</td>' + '<td></td>'.repeat(h.length - 1) + '<td>' + ls + '</td><td>' + cs + '</td><td>' + (ps - cs) + '</td></tr>';
    html += '<tr style="color:var(--g500);"><td>动销成本折扣</td>' + '<td></td>'.repeat(h.length - 1) + '<td></td><td></td><td>' + (ls ? (cs / ls).toFixed(4) : 0) + '</td></tr>';
    html += '</tbody>';
    $('cPreview').innerHTML = html;
  }

  // ---------------- 生成利润表 + 看板 ----------------
  $('doAnalyze').onclick = runAnalyze;
  async function runAnalyze() {
    const rpt = parseFloat($('cfgRpt').value) || 30, moT = parseFloat($('cfgMO').value) || 3;
    const products = Calc.analyzeProducts(S.cleaned, S.headers, S.map, { rpt, moT });
    const daily = Calc.dailyAgg(S.cleaned, S.headers, S.map);
    const kpis = Calc.calcKPIs(products, daily);
    S.products = products; S.daily = daily; S.kpis = kpis;
    const types = S.order.filter(t => S.groups[t]);
    const payload = {
      projectName: S.projectName, fileName: S.fileName || '', kpis, types,
      typeRev: types.map(t => S.stats[t].兑换金额含税),
      typeCost: types.map(t => S.stats[t].成本含税),
      typeProfit: types.map(t => S.stats[t].兑换金额含税 - S.stats[t].成本含税),
      products, daily
    };
    const zeroPaper = (S.fileName || '').includes('全员阅读平台');
    const pwb = Profit.buildProfitWB(S.stats, { zeroPaperTax: zeroPaper });
    const pblob = Profit.buildProfitBlob(pwb);
    const cwb = Profit.buildCleanWB(S.groups, S.order, S.headers);
    const cblob = Profit.buildCleanBlob(cwb);
    const tag = Calc.deriveTag((S.fileName || '').replace(/\.[^.]+$/, ''));
    const prefix = S.bank || S.projectName || '利润分析';
    await saveToDir(prefix + '项目数据统计口径参考_' + tag + '.xlsx', pblob);
    await saveToDir(prefix + '_' + tag + '_兑换明细_已清洗.xlsx', cblob);
    if (S.fid) { const fi = await Store.getFile(S.fid); if (fi) { fi.status = 'analyzed'; fi.products = products; fi.daily = daily; fi.kpis = kpis; fi.stats = S.stats; await Store.putFile(fi); } }
    Dashboard.openDashboard(payload, ECHARTS_URL);
    $('anMsg').textContent = '✅ 已生成利润表与看板' + (zeroPaper ? '（纸书项目税率已按「全员阅读平台」置 0）' : '') + '，并已写入保存路径。';
    renderFiles();
  }
  $('dlCln').onclick = () => {
    if (!S.cleaned || !S.cleaned.length) { alert('请先清洗数据'); return; }
    const cwb = Profit.buildCleanWB(S.groups, S.order, S.headers);
    saveToDir((S.bank || '利润分析') + '_兑换明细_已清洗.xlsx', Profit.buildCleanBlob(cwb));
  };

  // ---------------- 文件列表 ----------------
  async function renderFiles() {
    let files = await Store.getAllFiles();
    const fp = $('fProv').value, fc = $('fCity').value, fb = $('fBank').value, fs = $('fSts').value;
    if (files) files = files.filter(f => {
      if (fp && f.province !== fp) return false;
      if (fc && f.city !== fc) return false;
      if (fb && f.bank !== fb) return false;
      if (fs && f.status !== fs) return false;
      return true;
    });
    const tb = $('fBody'), emp = $('empF');
    if (!files || !files.length) { tb.innerHTML = ''; show(emp); $('fcLab').textContent = ''; updStats(await Store.getAllFiles()); return; }
    hide(emp);
    tb.innerHTML = files.map(f => {
      const dt = new Date(f.uploadTime).toLocaleString('zh-CN');
      return '<tr data-id="' + f.id + '"><td><span class="fn" title="' + esc(f.name) + '">' + esc(f.name) + '</span><br><span class="fm">' + esc(f.project || '') + '</span></td>' +
        '<td>' + (f.province ? '<span class="rt rt-p">' + esc(f.province) + '</span>' : '—') + '</td>' +
        '<td>' + (f.city ? esc(f.city) : '—') + '</td>' +
        '<td>' + (f.bank ? '<span class="rt rt-b">' + esc(f.bank) + '</span>' : '—') + '</td>' +
        '<td style="font-size:11px;color:var(--g500);">' + dt + '</td><td>' + (f.rowCount || '—') + '</td><td>' + sbBadge(f.status) + '</td>' +
        '<td><div style="display:flex;gap:4px;flex-wrap:wrap;">' + bActs(f) + '</div></td></tr>';
    }).join('');
    $('fcLab').textContent = '共 ' + files.length + ' 个文件';
    updStats(await Store.getAllFiles());
  }
  function sbBadge(s) { if (s === 'analyzed') return '<span class="badge b-done">已分析</span>'; if (s === 'cleaned') return '<span class="badge b-ok">已清洗</span>'; if (s === 'error') return '<span class="badge b-bad">异常</span>'; return '<span class="badge b-raw">待处理</span>'; }
  function bActs(f) {
    let h = '';
    if (f.status !== 'cleaned' && f.status !== 'analyzed') h += '<button class="btn bp bsm" onclick="openMo(\'' + f.id + '\')">清洗</button>';
    if (f.status === 'cleaned' || f.status === 'analyzed') h += '<button class="btn bs bsm" onclick="anaFile(\'' + f.id + '\')">生成看板</button>';
    if (f.status === 'analyzed') h += '<button class="btn bg bsm" onclick="viewDash(\'' + f.id + '\')">查看看板</button>';
    h += '<button class="btn bg bsm" style="color:var(--er);border-color:#fecaca;" onclick="delFile(\'' + f.id + '\')">删除</button>';
    return h;
  }
  function updStats(a) { if (!a) a = []; $('sTot').textContent = a.length; $('sAn').textContent = a.filter(f => f.status === 'analyzed').length; $('sCl').textContent = a.filter(f => f.status === 'cleaned' || f.status === 'analyzed').length; }
  async function buildFilters() {
    const files = await Store.getAllFiles();
    const ps = new Set(), cs = new Set(), bs = new Set();
    (files || []).forEach(f => { if (f.province) ps.add(f.province); if (f.city) cs.add(f.city); if (f.bank) bs.add(f.bank); });
    const fl = (el, set) => { const v = el.value; el.innerHTML = '<option value="">全部</option>'; [...set].sort().forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; el.appendChild(o); }); el.value = v; };
    fl($('fProv'), ps); fl($('fCity'), cs); fl($('fBank'), bs);
  }
  ['fProv', 'fCity', 'fBank', 'fSts'].forEach(id => $(id).onchange = renderFiles);

  // 对已有文件：重新清洗（弹窗）→ 生成看板
  window.openMo = async function (fid) {
    S.fid = fid; const fi = await Store.getFile(fid); if (!fi) return;
    S.fileName = fi.name; S.bank = fi.bank; S.province = fi.province; S.city = fi.city;
    const rows = XLSX.utils.sheet_to_json(XLSX.read(fi.rawData, { type: 'array' }).Sheets[XLSX.read(fi.rawData, { type: 'array' }).SheetNames[0]], { defval: null });
    S.headers = fi.headers || Object.keys(rows[0]); S.rows = rows;
    $('moFN').textContent = fi.name;
    S.map = fi.map || Calc.guessMap(S.headers); buildMapGrid('moGrid', S.map);
    hide('moErr'); $('moMap').classList.add('show');
  };
  window.closeMo = () => $('moMap').classList.remove('show');

  window.anaFile = async function (fid) {
    const fi = await Store.getFile(fid); if (!fi) return;
    S.fid = fid; S.fileName = fi.name; S.bank = fi.bank; S.province = fi.province; S.city = fi.city;
    const wb = XLSX.read(fi.rawData, { type: 'array', cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
    S.headers = fi.headers || Object.keys(rows[0]); S.rows = rows; S.map = fi.map || Calc.guessMap(S.headers);
    const cleaned = Calc.cleanRows(S.rows, S.headers, S.map);
    const grp = Calc.groupByType(cleaned, S.headers, S.map);
    S.cleaned = cleaned; S.groups = grp.groups; S.order = grp.order; S.stats = Calc.summarize(grp.groups);
    await runAnalyze();
  };
  window.viewDash = async function (fid) {
    const fi = await Store.getFile(fid); if (!fi) return;
    const types = (fi.stats ? Object.keys(fi.stats) : []);
    const payload = {
      projectName: fi.project, fileName: fi.name, kpis: fi.kpis || [], types,
      typeRev: types.map(t => fi.stats[t].兑换金额含税),
      typeCost: types.map(t => fi.stats[t].成本含税),
      typeProfit: types.map(t => fi.stats[t].兑换金额含税 - fi.stats[t].成本含税),
      products: fi.products || [], daily: fi.daily || []
    };
    Dashboard.openDashboard(payload, ECHARTS_URL);
  };
  window.delFile = async function (fid) {
    if (!confirm('确定删除该文件？关联的清洗/分析结果将一并清除（本机保存路径中的文件需手动删除）。')) return;
    await Store.deleteFile(fid); renderFiles(); buildFilters();
  };

  // ---------------- 映射管理 ----------------
  async function loadMappingTable() {
    const all = await Store.getAllMapping();
    const tb = $('mapBody');
    if (!all.length) { tb.innerHTML = '<tr><td colspan="4" style="color:var(--g400);padding:14px;text-align:center;">暂无映射，上传时自动记录或手动添加</td></tr>'; return; }
    tb.innerHTML = all.map(m => '<tr data-bank="' + esc(m.bank) + '"><td>' + esc(m.bank) + '</td><td>' + esc(m.province) + '</td><td>' + esc(m.city) + '</td><td><button class="btn bg bsm" style="color:var(--er);border-color:#fecaca;" onclick="delMapping(\'' + esc(m.bank) + '\')">删除</button></td></tr>').join('');
  }
  if ($('mkAdd')) $('mkAdd').onclick = async () => {
    const bank = $('mkBank').value.trim(), prov = $('mkProv').value.trim(), city = $('mkCity').value.trim();
    if (!bank || !prov || !city) { alert('银行/省份/城市均需填写'); return; }
    await Store.putMapping({ bank, province: prov, city }); await refreshMapCache();
    $('mkBank').value = ''; $('mkProv').value = ''; $('mkCity').value = '';
    loadMappingTable();
  };
  window.delMapping = async function (bank) {
    if (!confirm('删除映射：' + bank + ' ？')) return;
    await Store.del('mapping', bank); await refreshMapCache(); loadMappingTable();
  };

  init();
})();
