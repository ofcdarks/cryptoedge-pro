'use strict';
// ─── CryptoEdge Pro — Novas Features v2.0 ─────────────────────────────────────
// Funding Rate Scanner | Correlation Matrix | Diário Aprimorado | Risk Manager

// ═══════════════════════════════════════════════════════════════════
// FUNDING RATE SCANNER
// ═══════════════════════════════════════════════════════════════════

async function loadFundingRates() {
  // Navegar para o painel se não estiver ativo
  const panel = document.getElementById('panel-funding');
  const tbody = document.getElementById('fr-table');
  const upd   = document.getElementById('fr-last-update');
  if (!panel || !tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--t3)">Carregando funding rates...</td></tr>';

  try {
    const r    = await fetch('/api/funding-rates', { headers: window.auth ? auth.headers() : {} });
    const data = await r.json();
    if (!data.ok || !data.data?.length) throw new Error(data.error || 'Sem dados');

    const rates = data.data;

    // Summary stats
    const highFR = rates[0];
    const lowFR  = rates[rates.length - 1];
    const avg    = rates.reduce((s,x) => s + x.fundingRate, 0) / rates.length;
    const avgAnn = rates.reduce((s,x) => s + parseFloat(x.annualized), 0) / rates.length;

    const setEl = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
    setEl('fr-s-high', (highFR.fundingRate * 100).toFixed(4) + '%');
    setEl('fr-s-low',  (lowFR.fundingRate  * 100).toFixed(4) + '%');
    setEl('fr-s-avg',  (avg * 100).toFixed(4) + '%');
    setEl('fr-s-ann',  avgAnn.toFixed(1) + '%/ano');
    if (upd) upd.textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');

    // Color elements
    document.getElementById('fr-s-high').style.color = highFR.fundingRate > 0.001 ? 'var(--red)' : 'var(--t1)';
    document.getElementById('fr-s-low').style.color  = lowFR.fundingRate  < -0.001 ? 'var(--green)' : 'var(--t1)';

    tbody.innerHTML = rates.map(item => {
      const fr   = item.fundingRate;
      const frPct= (fr * 100).toFixed(4);
      const abs  = Math.abs(fr);
      const color = fr > 0.001 ? 'var(--red)' : fr < -0.001 ? 'var(--green)' : 'var(--t2)';
      const signal = abs > 0.002 ? (fr > 0 ? '<span style="color:var(--red);font-weight:600">🔴 Short Bias</span>' : '<span style="color:var(--green);font-weight:600">🟢 Long Bias</span>')
                   : abs > 0.001 ? (fr > 0 ? '<span style="color:var(--orange)">⚠ Levemente Long</span>' : '<span style="color:var(--blue)">⚠ Levemente Short</span>')
                   : '<span style="color:var(--t3)">Neutro</span>';
      const nextTime = item.nextFundingTime ? new Date(item.nextFundingTime).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) : '—';
      const base  = item.symbol.replace('USDT','');
      const bgRow = abs > 0.002 ? (fr > 0 ? 'rgba(248,81,73,0.04)' : 'rgba(63,185,80,0.04)') : '';

      return `<tr style="background:${bgRow}" onclick="navigateToAnalysis('${item.symbol}')" style="cursor:pointer">
        <td><span style="font-family:var(--mono);font-weight:600">${base}/USDT</span></td>
        <td style="color:${color};font-family:var(--mono);font-weight:600">${fr > 0 ? '+' : ''}${frPct}%</td>
        <td style="font-family:var(--mono);color:${color}">${fr > 0 ? '+' : ''}${item.annualized}%</td>
        <td style="font-family:var(--mono)">${parseFloat(item.markPrice).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:4})}</td>
        <td style="font-family:var(--mono);color:var(--t3)">${nextTime}</td>
        <td>${signal}</td>
      </tr>`;
    }).join('');

  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--red)">Erro: ${e.message}</td></tr>`;
  }
}

function navigateToAnalysis(sym) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const nav = document.querySelector('[data-panel="analysisai"]');
  if (nav) nav.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const pan = document.getElementById('panel-analysisai');
  if (pan) pan.classList.add('active');
  const sel = document.getElementById('analysis-symbol');
  if (sel) { sel.value = sym; }
}

// ═══════════════════════════════════════════════════════════════════
// CORRELATION MATRIX
// ═══════════════════════════════════════════════════════════════════

const CORR_PRESETS = {
  top10:  ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','DOTUSDT'],
  defi:   ['UNIUSDT','AAVEUSDT','MKRUSDT','CRVUSDT','SUSHIUSDT','COMPUSDT','SNXUSDT','GRTUSDT','DYDXUSDT','LDOUSDT'],
  l2:     ['MATICUSDT','ARBUSDT','OPUSDT','STRKUSDT','IMXUSDT','APTUSDT','SUIUSDT','NEARUSDT','INJUSDT','SEIUSDT'],
  meme:   ['DOGEUSDT','SHIBUSDT','PEPEUSDT','WIFUSDT','FLOKIUSDT','BONKUSDT','MEMEUSDT'],
  ai:     ['FETUSDT','RENDERUSDT','WLDUSDT','AGIXUSDT','OCEANUSDT','TAOUSDT'],
};

async function loadCorrelation() {
  const preset  = document.getElementById('corr-preset')?.value || 'top10';
  const pairs   = CORR_PRESETS[preset] || CORR_PRESETS.top10;
  const loading = document.getElementById('corr-loading');
  const matrix  = document.getElementById('corr-matrix');
  const empty   = document.getElementById('corr-empty');

  if (loading) loading.style.display = 'block';
  if (matrix)  matrix.innerHTML = '';
  if (empty)   empty.style.display = 'none';

  try {
    const r    = await fetch('/api/correlation?pairs=' + pairs.join(','));
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);

    const { symbols, matrix: mat } = data;

    // Build heatmap table
    const cellSize = Math.max(44, Math.min(70, Math.floor(600 / symbols.length)));
    const labelW   = 70;

    let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:11px;font-family:var(--mono)">`;

    // Header row
    html += '<thead><tr><th style="width:' + labelW + 'px"></th>';
    symbols.forEach(sym => {
      const base = sym.replace('USDT','');
      html += `<th style="width:${cellSize}px;padding:4px 2px;text-align:center;font-size:10px;font-weight:600;color:var(--t2);writing-mode:vertical-lr;transform:rotate(180deg);height:60px">${base}</th>`;
    });
    html += '</tr></thead><tbody>';

    // Data rows
    symbols.forEach((rowSym, ri) => {
      const base = rowSym.replace('USDT','');
      html += `<tr><td style="text-align:right;padding:2px 8px 2px 2px;font-weight:600;color:var(--t1);white-space:nowrap;font-size:11px">${base}</td>`;
      symbols.forEach((colSym, ci) => {
        const val = mat[ri][ci];
        const bg  = val === null ? 'var(--bg3)' : corrColor(val);
        const txt = val === null ? '—' : val.toFixed(2);
        const textColor = val !== null && Math.abs(val) > 0.5 ? '#fff' : 'var(--t1)';
        html += `<td style="width:${cellSize}px;height:${cellSize}px;background:${bg};text-align:center;border:1px solid var(--bg1);color:${textColor};font-weight:${ri===ci?'700':'400'};font-size:10px">${txt}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table>';

    // Legend
    html += `<div style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:11px;color:var(--t3)">
      <span>Legenda:</span>
      <div style="display:flex;align-items:center;gap:3px">
        ${[-1,-0.7,-0.4,-0.1,0,0.1,0.4,0.7,1].map(v => `<div style="width:22px;height:14px;background:${corrColor(v)};border-radius:2px" title="${v}"></div>`).join('')}
      </div>
      <span>-1.0 (inverso)</span><span style="margin-left:auto">+1.0 (idêntico)</span>
    </div></div>`;

    if (matrix) matrix.innerHTML = html;
    if (loading) loading.style.display = 'none';

  } catch(e) {
    if (loading) loading.style.display = 'none';
    if (empty) { empty.style.display = 'block'; empty.textContent = 'Erro: ' + e.message; }
  }
}

function corrColor(val) {
  if (val === null) return 'var(--bg3)';
  // Red (negative) → gray (0) → green (positive)
  if (val >= 0) {
    const v = Math.min(val, 1);
    const r = Math.round(30  + (10 - 30)  * v);
    const g = Math.round(120 + (185 - 120) * v);
    const b = Math.round(60  + (80 - 60)  * v);
    return `rgb(${r},${g},${b})`;
  } else {
    const v = Math.min(Math.abs(val), 1);
    const r = Math.round(120 + (248 - 120) * v);
    const g = Math.round(60  + (81 - 60)   * v);
    const b = Math.round(60  + (73 - 60)   * v);
    return `rgb(${r},${g},${b})`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// DIÁRIO APRIMORADO
// ═══════════════════════════════════════════════════════════════════

function switchJournalTab(tab) {
  ['register','history','stats'].forEach(t => {
    const btn = document.getElementById('jrn-tab-' + t);
    const pnl = document.getElementById('jrn-panel-' + t);
    if (btn) {
      btn.style.background = t === tab ? 'var(--gold)' : 'transparent';
      btn.style.color      = t === tab ? '#000' : 'var(--t2)';
      btn.style.fontWeight = t === tab ? '700' : '400';
    }
    if (pnl) pnl.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'history') loadJournalHistory();
  if (tab === 'stats')   loadJournalStats();
}

async function loadJournalHistory() {
  const tbody = document.getElementById('jrn-history-table');
  if (!tbody) return;
  try {
    const r    = await fetch('/api/trades?limit=500', { headers: auth.headers() });
    const rows = await r.json();
    window._journalAllTrades = rows;
    renderJournalHistoryTable(rows);
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:var(--red);padding:20px">${e.message}</td></tr>`;
  }
}

function filterJournalHistory() {
  const search = (document.getElementById('jrn-search')?.value || '').toLowerCase();
  const result = document.getElementById('jrn-filter-result')?.value || '';
  const all    = window._journalAllTrades || [];
  const filtered = all.filter(t => {
    const matchResult = !result || t.result === result;
    const text = [t.pair, t.reason, t.notes, t.direction, ...(t.tags||[])].join(' ').toLowerCase();
    const matchSearch = !search || text.includes(search);
    return matchResult && matchSearch;
  });
  renderJournalHistoryTable(filtered);
}

function renderJournalHistoryTable(rows) {
  const tbody = document.getElementById('jrn-history-table');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:20px;color:var(--t3)">Nenhum trade encontrado</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(t => {
    const pnl    = t.pnl || 0;
    const pnlPct = t.pnl_pct || 0;
    const pnlColor = pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--t3)';
    const resIcon  = t.result === 'win' ? '✅' : t.result === 'loss' ? '❌' : t.result === 'pending' ? '⏳' : '🟡';
    const dirColor = t.direction === 'Long' ? 'var(--green)' : 'var(--red)';
    const tags     = Array.isArray(t.tags) ? t.tags : JSON.parse(t.tags||'[]');
    const tagsHtml = tags.map(tag => `<span style="font-size:9px;padding:1px 5px;background:var(--bg3);border-radius:3px;color:var(--t3)">${tag}</span>`).join(' ');
    const notesHtml = t.notes ? `<span title="${t.notes.replace(/"/g,'&quot;')}" style="cursor:help;color:var(--blue)">📝</span>` : '';
    const screenshotHtml = t.screenshot ? `<span onclick="viewScreenshot('${t.id}')" style="cursor:pointer;color:var(--gold)">🖼</span>` : '';

    return `<tr>
      <td style="font-size:11px;color:var(--t3)">${(t.created_at||'').slice(0,15)}</td>
      <td><span style="font-family:var(--mono);font-weight:600">${t.pair||'—'}</span></td>
      <td><span style="color:${dirColor};font-weight:600">${t.direction||'—'}</span></td>
      <td style="font-family:var(--mono)">${t.entry ? parseFloat(t.entry).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4}) : '—'}</td>
      <td style="font-family:var(--mono)">${t.exit  ? parseFloat(t.exit).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4})  : '—'}</td>
      <td style="font-family:var(--mono)">${t.size  ? '$'+parseFloat(t.size).toFixed(0) : '—'}</td>
      <td style="font-family:var(--mono)">${t.leverage||'1x'}</td>
      <td style="font-family:var(--mono);color:${pnlColor};font-weight:600">${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}</td>
      <td style="font-family:var(--mono);color:${pnlColor}">${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}%</td>
      <td>${tagsHtml}</td>
      <td>${resIcon} ${notesHtml} ${screenshotHtml}</td>
      <td><button onclick="deleteTrade('${t.id}')" style="background:none;border:none;cursor:pointer;color:var(--t3);font-size:14px" title="Excluir">🗑</button></td>
    </tr>`;
  }).join('');
}

async function loadJournalStats() {
  try {
    const r    = await fetch('/api/trades?limit=1000', { headers: auth.headers() });
    const rows = await r.json();

    const total  = rows.length;
    const wins   = rows.filter(t => t.result === 'win');
    const losses = rows.filter(t => t.result === 'loss');
    const closed = rows.filter(t => t.result === 'win' || t.result === 'loss');
    const wr     = closed.length ? (wins.length / closed.length * 100).toFixed(1) : '—';
    const pnlAll = rows.reduce((s,t) => s + (t.pnl||0), 0);
    const best   = rows.reduce((m,t) => Math.max(m, t.pnl||0), 0);
    const worst  = rows.reduce((m,t) => Math.min(m, t.pnl||0), 0);
    const avgWin = wins.length   ? wins.reduce((s,t)=>s+(t.pnl||0),0)/wins.length : 0;
    const avgLoss= losses.length ? losses.reduce((s,t)=>s+(t.pnl||0),0)/losses.length : 0;
    const grossP = wins.reduce((s,t)=>s+(t.pnl||0),0);
    const grossL = Math.abs(losses.reduce((s,t)=>s+(t.pnl||0),0));
    const pf     = grossL > 0 ? (grossP / grossL).toFixed(2) : grossP > 0 ? '∞' : '—';

    const setEl = (id, v, color) => {
      const e = document.getElementById(id);
      if (e) { e.textContent = v; if (color) e.style.color = color; }
    };
    setEl('js-winrate',   wr !== '—' ? wr + '%' : '—',  parseFloat(wr) >= 50 ? 'var(--green)' : 'var(--red)');
    setEl('js-pnl-total', (pnlAll >= 0 ? '+' : '') + '$' + pnlAll.toFixed(2), pnlAll >= 0 ? 'var(--green)' : 'var(--red)');
    setEl('js-best',      '+$' + best.toFixed(2));
    setEl('js-worst',     '$' + worst.toFixed(2));
    setEl('js-avg-win',   '+$' + avgWin.toFixed(2));
    setEl('js-avg-loss',  '$' + avgLoss.toFixed(2));
    setEl('js-pf',        pf,  parseFloat(pf) >= 1.5 ? 'var(--green)' : parseFloat(pf) >= 1 ? 'var(--t1)' : 'var(--red)');
    setEl('js-total',     total);

    // By pair
    const pairMap = {};
    rows.forEach(t => {
      if (!t.pair) return;
      if (!pairMap[t.pair]) pairMap[t.pair] = { pair:t.pair, total:0, wins:0, losses:0, pnl:0 };
      pairMap[t.pair].total++;
      if (t.result==='win')  { pairMap[t.pair].wins++;  pairMap[t.pair].pnl+=(t.pnl||0); }
      if (t.result==='loss') { pairMap[t.pair].losses++; pairMap[t.pair].pnl+=(t.pnl||0); }
    });
    const pairEl = document.getElementById('js-by-pair');
    if (pairEl) {
      const sortedPairs = Object.values(pairMap).sort((a,b)=>b.total-a.total);
      pairEl.innerHTML = sortedPairs.length ? sortedPairs.map(p => {
        const wr2 = p.wins + p.losses > 0 ? Math.round(p.wins/(p.wins+p.losses)*100) : 0;
        const pnlC = p.pnl >= 0 ? 'var(--green)' : 'var(--red)';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="font-family:var(--mono);font-weight:600">${p.pair}</span>
          <span style="color:var(--t3)">${p.total} trades</span>
          <span>${wr2}% acerto</span>
          <span style="color:${pnlC};font-family:var(--mono)">${p.pnl>=0?'+':''}$${p.pnl.toFixed(2)}</span>
        </div>`;
      }).join('') : '<div style="color:var(--t3);padding:20px;text-align:center">Sem dados</div>';
    }

    // By tag
    const tagMap = {};
    rows.forEach(t => {
      const tags = Array.isArray(t.tags) ? t.tags : JSON.parse(t.tags||'[]');
      tags.forEach(tag => {
        if (!tagMap[tag]) tagMap[tag] = { tag, total:0, wins:0, losses:0, pnl:0 };
        tagMap[tag].total++;
        if (t.result==='win')  { tagMap[tag].wins++;  tagMap[tag].pnl+=(t.pnl||0); }
        if (t.result==='loss') { tagMap[tag].losses++; tagMap[tag].pnl+=(t.pnl||0); }
      });
    });
    const tagEl = document.getElementById('js-by-tag');
    if (tagEl) {
      const sortedTags = Object.values(tagMap).sort((a,b)=>b.total-a.total);
      tagEl.innerHTML = sortedTags.length ? sortedTags.map(p => {
        const wr2 = p.wins + p.losses > 0 ? Math.round(p.wins/(p.wins+p.losses)*100) : 0;
        const pnlC = p.pnl >= 0 ? 'var(--green)' : 'var(--red)';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="font-family:var(--mono);font-weight:600">${p.tag}</span>
          <span style="color:var(--t3)">${p.total}x</span>
          <span>${wr2}%</span>
          <span style="color:${pnlC};font-family:var(--mono)">${p.pnl>=0?'+':''}$${p.pnl.toFixed(2)}</span>
        </div>`;
      }).join('') : '<div style="color:var(--t3);padding:20px;text-align:center">Nenhuma tag registrada</div>';
    }

  } catch(e) {
    console.error('[JournalStats]', e);
  }
}

// Screenshot handling
function handleScreenshotFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => showScreenshotPreview(e.target.result);
  reader.readAsDataURL(file);
}

function handleScreenshotDrop(event) {
  event.preventDefault();
  const area = document.getElementById('j-screenshot-area');
  if (area) area.style.borderColor = 'var(--border)';
  const file = event.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => showScreenshotPreview(e.target.result);
  reader.readAsDataURL(file);
}

function showScreenshotPreview(dataUrl) {
  window._screenshotData = dataUrl;
  const preview = document.getElementById('j-screenshot-preview');
  if (preview) {
    preview.innerHTML = `<img src="${dataUrl}" style="max-width:100%;max-height:160px;border-radius:4px;object-fit:contain">
      <div style="font-size:10px;color:var(--t3);margin-top:4px">Screenshot adicionado <span onclick="clearScreenshot()" style="cursor:pointer;color:var(--red)">✕ Remover</span></div>`;
  }
}

function clearScreenshot() {
  window._screenshotData = null;
  const preview = document.getElementById('j-screenshot-preview');
  if (preview) preview.innerHTML = `<div style="font-size:24px">📷</div><div style="font-size:11px;color:var(--t3);margin-top:4px">Clique ou arraste uma imagem aqui</div>`;
  const input = document.getElementById('j-screenshot-input');
  if (input) input.value = '';
}

function viewScreenshot(tradeId) {
  // For trades that have screenshots stored
  const trade = (window._journalAllTrades||[]).find(t => t.id === tradeId || t._id === tradeId);
  if (!trade?.screenshot) return;
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer';
  modal.onclick = () => modal.remove();
  modal.innerHTML = `<div style="max-width:90vw;max-height:90vh;position:relative">
    <img src="${trade.screenshot}" style="max-width:100%;max-height:90vh;border-radius:8px;object-fit:contain">
    <div style="position:absolute;top:-30px;right:0;color:#fff;font-size:13px">Clique para fechar</div>
  </div>`;
  document.body.appendChild(modal);
}

// Enhanced addTrade — patched to include notes, tags, screenshot
const _originalAddTrade = window.addTrade;
window.addTrade = async function() {
  const pair    = document.getElementById('j-pair')?.value;
  const dir     = document.getElementById('j-dir')?.value;
  const entry   = parseFloat(document.getElementById('j-entry')?.value || '0');
  const exit    = parseFloat(document.getElementById('j-exit')?.value  || '0');
  const size    = parseFloat(document.getElementById('j-size')?.value  || '0');
  const lev     = document.getElementById('j-lev')?.value;
  const reason  = document.getElementById('j-reason')?.value || '';
  const result  = document.getElementById('j-result')?.value || 'pending';
  const notes   = document.getElementById('j-notes')?.value || '';

  // Collect tags
  const tagCheckboxes = document.querySelectorAll('#j-tags-row input[type=checkbox]:checked');
  const tags = Array.from(tagCheckboxes).map(cb => cb.value);

  // Calculate PnL
  let pnl = 0, pnlPct = 0;
  if (entry && exit && size) {
    const leverNum = parseInt((lev||'1x').replace('x','')) || 1;
    const diff = dir === 'Long' ? (exit - entry) / entry : (entry - exit) / entry;
    pnlPct = diff * leverNum * 100;
    pnl    = diff * size;
  }

  const screenshot = window._screenshotData || '';

  try {
    const r = await fetch('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.headers() },
      body: JSON.stringify({ pair, direction: dir, entry, exit: exit||null, size, leverage: lev, reason, result, pnl, pnl_pct: pnlPct, notes, tags, screenshot })
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);

    showToast('✅ Trade registrado!');
    clearScreenshot();
    // Reset form
    ['j-entry','j-exit','j-size','j-reason','j-notes'].forEach(id => { const e = document.getElementById(id); if(e) e.value = ''; });
    document.querySelectorAll('#j-tags-row input[type=checkbox]').forEach(cb => cb.checked = false);

    loadTrades();
    loadStats();
  } catch(e) {
    showToast('Erro: ' + e.message, true);
  }
};

// ═══════════════════════════════════════════════════════════════════
// RISK MANAGER — Calculadora de Posição Automática
// ═══════════════════════════════════════════════════════════════════

function calcPositionSize() {
  const balance     = parseFloat(document.getElementById('rm-balance')?.value || '1000');
  const riskPct     = parseFloat(document.getElementById('rm-risk-pct')?.value || '1');
  const entryPrice  = parseFloat(document.getElementById('rm-entry')?.value || '0');
  const stopPrice   = parseFloat(document.getElementById('rm-stop')?.value || '0');
  const leverage    = parseFloat(document.getElementById('rm-leverage')?.value || '1');

  if (!entryPrice || !stopPrice || entryPrice === stopPrice) {
    ['rm-r-size','rm-r-qty','rm-r-loss','rm-r-tp1','rm-r-tp2','rm-r-rr'].forEach(id => {
      const e = document.getElementById(id); if(e) e.textContent = '—';
    });
    return;
  }

  const riskAmount  = balance * riskPct / 100;
  const stopDist    = Math.abs(entryPrice - stopPrice);
  const stopDistPct = stopDist / entryPrice;
  const positionSize= riskAmount / stopDistPct;
  const qty         = positionSize / entryPrice;
  const marginNeeded= positionSize / leverage;

  const tp1 = entryPrice > stopPrice
    ? entryPrice + stopDist * 1.5
    : entryPrice - stopDist * 1.5;
  const tp2 = entryPrice > stopPrice
    ? entryPrice + stopDist * 3.0
    : entryPrice - stopDist * 3.0;

  const setEl = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  setEl('rm-r-size',   '$' + positionSize.toFixed(2));
  setEl('rm-r-margin', '$' + marginNeeded.toFixed(2));
  setEl('rm-r-qty',    qty.toFixed(6));
  setEl('rm-r-loss',   '-$' + riskAmount.toFixed(2) + ' (' + riskPct + '%)');
  setEl('rm-r-tp1',    tp1.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:4}));
  setEl('rm-r-tp2',    tp2.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:4}));
  setEl('rm-r-rr',     '1 : 1.5 / 1 : 3.0');

  // Color max loss
  const lossEl = document.getElementById('rm-r-loss');
  if (lossEl) lossEl.style.color = 'var(--red)';
}

// ═══════════════════════════════════════════════════════════════════
// BACKTESTING — Equity Curve Visual
// ═══════════════════════════════════════════════════════════════════

function renderEquityCurve(equityData) {
  const canvas = document.getElementById('bt-equity-canvas');
  if (!canvas || !equityData?.length) return;

  const ctx    = canvas.getContext('2d');
  const W      = canvas.width  = canvas.parentElement?.offsetWidth  || 600;
  const H      = canvas.height = 200;
  const PAD    = { t: 20, r: 20, b: 30, l: 60 };
  const iW     = W - PAD.l - PAD.r;
  const iH     = H - PAD.t - PAD.b;

  ctx.clearRect(0, 0, W, H);

  const vals   = equityData.map(d => d.capital);
  const minV   = Math.min(...vals) * 0.995;
  const maxV   = Math.max(...vals) * 1.005;
  const range  = maxV - minV || 1;

  const x = i => PAD.l + (i / (vals.length - 1)) * iW;
  const y = v => PAD.t + (1 - (v - minV) / range) * iH;

  // Grid lines
  ctx.strokeStyle = 'rgba(100,100,120,0.2)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const yy = PAD.t + (i / 4) * iH;
    ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(W - PAD.r, yy); ctx.stroke();
    const label = (maxV - (i / 4) * range).toFixed(0);
    ctx.fillStyle = 'rgba(150,160,180,0.8)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('$' + label, PAD.l - 5, yy + 4);
  }

  // Fill gradient
  const grad = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b);
  const lastVal = vals[vals.length - 1];
  const isProfit = lastVal >= vals[0];
  grad.addColorStop(0,   isProfit ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');

  ctx.beginPath();
  ctx.moveTo(x(0), y(vals[0]));
  vals.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(x(vals.length - 1), H - PAD.b);
  ctx.lineTo(x(0), H - PAD.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = isProfit ? '#3FB950' : '#F85149';
  ctx.lineWidth   = 2;
  vals.forEach((v, i) => { i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v)); });
  ctx.stroke();

  // Labels dates (first + last)
  if (equityData.length > 1) {
    ctx.fillStyle = 'rgba(150,160,180,0.7)';
    ctx.font      = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(equityData[0].date, PAD.l, H - 5);
    ctx.textAlign = 'right';
    ctx.fillText(equityData[equityData.length - 1].date, W - PAD.r, H - 5);
  }
}

// Hook into existing runBacktest to render equity curve after results
const _originalRunBacktest = window.runBacktest;
if (typeof _originalRunBacktest === 'function') {
  window.runBacktest = async function() {
    await _originalRunBacktest.call(this, ...arguments);
    // Render equity curve if data available
    const data = window._lastBacktestResult;
    if (data?.equity_daily) renderEquityCurve(data.equity_daily);
  };
}

// Listen for backtest results
document.addEventListener('backtestResult', (e) => {
  if (e.detail?.equity_daily) {
    window._lastBacktestResult = e.detail;
    renderEquityCurve(e.detail.equity_daily);
  }
});

// ═══════════════════════════════════════════════════════════════════
// PERFIL — Webhook Token dedicado
// ═══════════════════════════════════════════════════════════════════

async function regenerateWebhookToken() {
  if (!confirm('Gerar novo Webhook Token? O token atual será invalidado.')) return;
  try {
    const r    = await fetch('/api/auth/regenerate-webhook-token', { method:'POST', headers: auth.headers() });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);
    showToast('✅ Novo Webhook Token gerado!');
    loadProfile(); // Reload profile to show new token
  } catch(e) {
    showToast('Erro: ' + e.message, true);
  }
}

// ═══════════════════════════════════════════════════════════════════
// INIT — Register panel navigation
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Journal tab default
  const jrnRegBtn = document.getElementById('jrn-tab-register');
  if (jrnRegBtn) jrnRegBtn.style.fontWeight = '700';
});

// Ensure journal tab switching works on panel open
const _origNavClick = null;
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const panel = item.dataset.panel;
    if (panel === 'funding')     loadFundingRates();
    if (panel === 'journal')     switchJournalTab('register');
  });
});

console.log('[Features v2.0] Funding Rate, Correlation, Enhanced Journal, Risk Manager, Equity Curve loaded.');
