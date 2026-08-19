/* ============================================================
 * dashboard.js — 利润分析看板（独立新窗口打开）
 * 面板：KPI 卡片 / 类型收支利润 / 负利润产品 / 刷单风险 / 日均利润 / 利润TOP20
 * ============================================================ */
(function (global) {
  'use strict';

  const CSS = `
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:#f9fafb;color:#1f2937;line-height:1.6;padding:24px;}
  h1{font-size:20px;font-weight:700;margin-bottom:4px;} sub{font-size:12px;color:#6b7280;}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:18px 0;}
  .kpi{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px;}
  .kpi-label{font-size:12px;color:#6b7280;} .kpi-val{font-size:22px;font-weight:700;margin-top:4px;} .kpi-sub{font-size:11px;color:#9ca3af;margin-top:2px;}
  .neg{color:#dc2626 !important;} .pos{color:#059669 !important;}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:16px;overflow:hidden;}
  .card-hd{padding:14px 18px;border-bottom:1px solid #f3f4f6;font-size:15px;font-weight:600;}
  .card-bd{padding:16px;}
  .chart{height:340px;}
  table{width:100%;border-collapse:collapse;font-size:12px;} th,td{padding:8px 10px;text-align:right;border-bottom:1px solid #f3f4f6;} th:first-child,td:first-child{text-align:left;} th{color:#6b7280;font-weight:600;background:#f9fafb;white-space:nowrap;position:sticky;top:0;}
  .tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:5px;background:#eef2ff;color:#4338ca;margin-left:4px;} .tag.risk{background:#fef2f2;color:#b91c1c;} .tag.high{background:#fef3c7;color:#92400e;}
  .wr{background:#fef2f2;} .wr td:first-child{font-weight:600;color:#dc2626;}
  .tabs{display:flex;gap:6px;margin-bottom:0;border-bottom:1px solid #e5e7eb;}
  .tab{padding:9px 14px;border:none;background:none;font-size:13px;color:#6b7280;border-bottom:2px solid transparent;cursor:pointer;font-weight:500;}
  .tab.on{color:#4f46e5;border-bottom-color:#4f46e5;}
  .tc{display:none;} .tc.on{display:block;}
  .pvw{max-height:420px;overflow:auto;border:1px solid #e5e7eb;border-radius:8px;}
  `;

  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

  function buildHTML(p, echartsUrl) {
    const kpiHTML = (p.kpis || []).map(k =>
      `<div class="kpi"><div class="kpi-label">${esc(k.l)}</div><div class="kpi-val ${k.c || ''}">${esc(k.v)}</div><div class="kpi-sub">${esc(k.s || '')}</div></div>`
    ).join('');
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>利润分析看板</title>
<style>${CSS}</style>
<script src="${echartsUrl}"><\/script>
</head><body>
<h1>📊 利润分析看板</h1><sub>${esc(p.fileName || '')}${p.projectName ? ' · ' + esc(p.projectName) : ''}</sub>
<div class="kpis">${kpiHTML}</div>
<div class="card"><div class="card-hd">各类型 收入 / 成本 / 利润</div><div class="card-bd"><div class="chart" id="typeChart"></div></div></div>
<div class="card"><div class="card-hd">
  <div class="tabs">
    <button class="tab on" data-tc="negTab">负利润产品</button>
    <button class="tab" data-tc="riskTab">刷单风险</button>
    <button class="tab" data-tc="dailyTab">日均利润</button>
    <button class="tab" data-tc="topTab">利润 TOP20</button>
  </div>
</div>
<div class="tc on" id="negTab"><div class="card-bd"><div class="chart" id="negBar" style="height:360px;"></div>
  <div class="pvw"><table id="negTbl"><thead><tr><th>类型</th><th>商品</th><th>订单数</th><th>收入(元)</th><th>成本(元)</th><th>利润(元)</th><th>成本率</th><th>重复率</th><th>原因</th></tr></thead><tbody></tbody></table></div></div></div>
<div class="tc" id="riskTab"><div class="card-bd"><div class="chart" id="riskBar" style="height:360px;"></div>
  <div class="pvw"><table id="riskTbl"><thead><tr><th>类型</th><th>商品</th><th>订单数</th><th>利润(元)</th><th>单用户最多</th><th>重复率</th></tr></thead><tbody></tbody></table></div></div></div>
<div class="tc" id="dailyTab"><div class="card-bd"><div class="chart" id="dailyChart" style="height:360px;"></div></div></div>
<div class="tc" id="topTab"><div class="card-bd"><div class="pvw"><table id="topTbl"><thead><tr><th>排名</th><th>类型</th><th>商品</th><th>订单数</th><th>收入(元)</th><th>成本(元)</th><th>利润(元)</th><th>利润率</th></tr></thead><tbody></tbody></table></div></div></div>
</div>
<script>
const D = ${JSON.stringify(p)};
function swTab(el){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));document.querySelectorAll('.tc').forEach(t=>t.classList.remove('on'));el.classList.add('on');document.getElementById(el.dataset.tc).classList.add('on');}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>swTab(t));
function money(v){return '¥'+Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});}
(function(){
  if(typeof echarts==='undefined'){document.querySelectorAll('.chart').forEach(c=>c.innerHTML='<div style="padding:20px;color:#dc2626;">ECharts 加载失败，但下方表格数据完整。</div>');return;}
  const tc=echarts.init(document.getElementById('typeChart'));
  tc.setOption({tooltip:{trigger:'axis',valueFormatter:v=>money(v)},legend:{top:0},xAxis:{type:'category',data:D.types},yAxis:{type:'value',axisLabel:{formatter:v=>'¥'+Math.round(v).toLocaleString()}},series:[{name:'收入',type:'bar',data:D.typeRev,itemStyle:{color:'#4f46e5'}},{name:'成本',type:'bar',data:D.typeCost,itemStyle:{color:'#d97706'}},{name:'利润',type:'bar',data:D.typeProfit,itemStyle:{color:'#059669'}}]});
  const neg=D.products.filter(p=>p.profitY<0).sort((a,b)=>a.profitY-b.profitY);
  const nb=echarts.init(document.getElementById('negBar'));
  nb.setOption({grid:{left:150,right:30,top:10,bottom:20},tooltip:{trigger:'axis',axisPointer:{type:'shadow'},valueFormatter:v=>money(v)},xAxis:{type:'value',axisLabel:{formatter:v=>'¥'+Math.round(v).toLocaleString()}},yAxis:{type:'category',data:neg.slice(0,15).map(p=>p.pname).reverse(),axisLabel:{width:140,overflow:'truncate'}},series:[{type:'bar',data:neg.slice(0,15).map(p=>p.profitY).reverse(),itemStyle:{color:'#dc2626'}}]});
  const nt=document.querySelector('#negTbl tbody');
  neg.slice(0,30).forEach(p=>{nt.innerHTML+='<tr class="'+(p.isRisk?'wr':'')+'"><td>'+p.type+'</td><td>'+p.pname+'</td><td>'+p.count+'</td><td>'+money(p.revY)+'</td><td>'+money(p.costY)+'</td><td class="neg">'+money(p.profitY)+'</td><td>'+(p.costRate*100).toFixed(1)+'%</td><td>'+(p.rr*100).toFixed(1)+'%</td><td>'+p.reasons.map(r=>'<span class="tag '+(r.includes('风险')?'risk':(r.includes('高')?'high':''))+'">'+r+'</span>').join('')+'</td></tr>';});
  const risk=D.products.filter(p=>p.isRisk).sort((a,b)=>a.profitY-b.profitY);
  const rb=echarts.init(document.getElementById('riskBar'));
  rb.setOption({grid:{left:150,right:30,top:10,bottom:20},tooltip:{trigger:'axis',axisPointer:{type:'shadow'},valueFormatter:v=>money(v)},xAxis:{type:'value',axisLabel:{formatter:v=>'¥'+Math.round(v).toLocaleString()}},yAxis:{type:'category',data:risk.slice(0,15).map(p=>p.pname).reverse(),axisLabel:{width:140,overflow:'truncate'}},series:[{type:'bar',data:risk.slice(0,15).map(p=>p.profitY).reverse(),itemStyle:{color:'#dc2626'}}]});
  const rt=document.querySelector('#riskTbl tbody');
  risk.forEach(p=>{rt.innerHTML+='<tr class="wr"><td>'+p.type+'</td><td>'+p.pname+'</td><td>'+p.count+'</td><td class="neg">'+money(p.profitY)+'</td><td>'+p.muo+'</td><td>'+(p.rr*100).toFixed(1)+'%</td></tr>';});
  const dc=echarts.init(document.getElementById('dailyChart'));
  dc.setOption({tooltip:{trigger:'axis'},legend:{top:0},xAxis:{type:'category',data:D.daily.map(d=>d.date)},yAxis:[{type:'value',name:'利润(元)',axisLabel:{formatter:v=>'¥'+Math.round(v).toLocaleString()}},{type:'value',name:'订单数',position:'right'}],series:[{name:'每日利润',type:'bar',data:D.daily.map(d=>d.profitY),itemStyle:{color:D.daily.map(d=>d.profitY<0?'#dc2626':'#059669')}},{name:'累计利润',type:'line',data:D.daily.map(d=>d.cum),smooth:true,itemStyle:{color:'#4f46e5'}},{name:'订单数',type:'line',yAxisIndex:1,data:D.daily.map(d=>d.count),smooth:true,itemStyle:{color:'#d97706'}}]});
  const top=D.products.slice().sort((a,b)=>b.profitY-a.profitY).slice(0,20);
  const tt=document.querySelector('#topTbl tbody');
  top.forEach((p,i)=>{const m=p.revY?p.profitY/p.revY:0;tt.innerHTML+='<tr class="'+(p.profitY<0?'wr':'')+'"><td>'+(i+1)+'</td><td>'+p.type+'</td><td>'+p.pname+'</td><td>'+p.count+'</td><td>'+money(p.revY)+'</td><td>'+money(p.costY)+'</td><td class="'+(p.profitY<0?'neg':'pos')+'">'+money(p.profitY)+'</td><td class="'+(m<0?'neg':'')+'">'+(m*100).toFixed(1)+'%</td></tr>';});
  window.onresize=()=>{tc.resize();nb.resize();rb.resize();dc.resize();};
})();
</script>
</body></html>`;
  }

  function openDashboard(payload, echartsUrl, onReady) {
    const html = buildHTML(payload, echartsUrl);
    if (typeof onReady === 'function') { try { onReady(html); } catch (e) {} }
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  global.Dashboard = { buildHTML, openDashboard };
})(window);
