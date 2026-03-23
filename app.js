// ============================================================
// STORAGE KEYS
// ============================================================
const K = {
  stocks:      'nwt_stocks',
  crypto:      'nwt_crypto',
  private:     'nwt_private',
  snapshots:   'nwt_snapshots',
  settings:    'nwt_settings',
  prices:      'nwt_prices',
  cryptoPrices:'nwt_crypto_prices',
};

// ============================================================
// STATE
// ============================================================
let S = {
  stocks:       [],
  crypto:       [],
  private:      [],
  snapshots:    [],
  settings:     { finnhubKey: '' },
  prices:       {},   // { TICKER: price }
  cryptoPrices: {},   // { coinId: price }
  filters:      { broker: 'all', type: 'all' },
};

let charts = {};

// ============================================================
// PERSISTENCE
// ============================================================
function load() {
  S.stocks       = parse(K.stocks,       []);
  S.crypto       = parse(K.crypto,       []);
  S.private      = parse(K.private,      []);
  S.snapshots    = parse(K.snapshots,    []);
  S.settings     = parse(K.settings,     { finnhubKey: '' });
  S.prices       = parse(K.prices,       {});
  S.cryptoPrices = parse(K.cryptoPrices, {});
}

function save() {
  ls(K.stocks,       S.stocks);
  ls(K.crypto,       S.crypto);
  ls(K.private,      S.private);
  ls(K.snapshots,    S.snapshots);
  ls(K.settings,     S.settings);
  ls(K.prices,       S.prices);
  ls(K.cryptoPrices, S.cryptoPrices);
}

function parse(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}

function ls(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ============================================================
// CALCULATIONS
// ============================================================
function stocksTotal() {
  return S.stocks.reduce((sum, s) => sum + ((S.prices[s.ticker] || 0) * s.shares), 0);
}

function cryptoTotal() {
  return S.crypto.reduce((sum, c) => sum + ((S.cryptoPrices[c.coinId] || 0) * c.amount), 0);
}

function privateTotal(cat) {
  const items = cat ? S.private.filter(p => p.category === cat) : S.private;
  return items.reduce((sum, p) => sum + (p.currentValue || 0), 0);
}

function totalNetWorth() {
  return stocksTotal() + cryptoTotal() + privateTotal();
}

// ============================================================
// FORMATTERS
// ============================================================
const fmt = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(v);
};

const fmtP = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(v);
};

const fmtPct = (v) => {
  if (isNaN(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
};

// ============================================================
// API
// ============================================================
async function fetchStockPrice(ticker) {
  if (!S.settings.finnhubKey) return null;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${S.settings.finnhubKey}`
    );
    const data = await res.json();
    return (data.c && data.c > 0) ? data.c : null;
  } catch { return null; }
}

async function fetchCryptoPrices(coinIds) {
  if (!coinIds.length) return {};
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds.join(',')}&vs_currencies=usd`
    );
    const data = await res.json();
    const out = {};
    for (const id of coinIds) {
      if (data[id]) out[id] = data[id].usd;
    }
    return out;
  } catch { return {}; }
}

async function refreshPrices() {
  const btn = document.getElementById('refresh-btn');
  btn.textContent = '↻ Refreshing…';
  btn.disabled = true;

  // Stocks
  if (S.stocks.length) {
    if (!S.settings.finnhubKey) {
      toast('Add a Finnhub API key in Settings for live stock prices.', 'error');
    } else {
      const tickers = [...new Set(S.stocks.map(s => s.ticker))];
      for (const t of tickers) {
        const p = await fetchStockPrice(t);
        if (p !== null) S.prices[t] = p;
        await delay(220); // respect rate limit
      }
    }
  }

  // Crypto (no API key needed)
  if (S.crypto.length) {
    const ids = [...new Set(S.crypto.map(c => c.coinId))];
    const prices = await fetchCryptoPrices(ids);
    Object.assign(S.cryptoPrices, prices);
  }

  save();
  renderAll();

  const now = new Date();
  document.getElementById('last-updated').textContent =
    `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  btn.textContent = '↻ Refresh Prices';
  btn.disabled = false;
  toast('Prices refreshed!', 'success');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// RENDER — ALL
// ============================================================
function renderAll() {
  renderHeader();
  renderDashboard();
  renderStocks();
  renderCrypto();
  renderPrivate();
  renderHistory();
}

// ============================================================
// RENDER — HEADER
// ============================================================
function renderHeader() {
  const total = totalNetWorth();
  document.getElementById('header-total').textContent = fmt(total);

  const el = document.getElementById('header-change');
  const snaps = S.snapshots;
  if (snaps.length) {
    const prev = snaps[snaps.length - 1].totalNetWorth;
    const diff = total - prev;
    const pct  = prev ? (diff / prev) * 100 : 0;
    el.textContent  = `${fmt(diff)} (${fmtPct(pct)}) since last snapshot`;
    el.className    = 'total-change ' + (diff >= 0 ? 'pos' : 'neg');
  } else {
    el.textContent = '';
  }
}

// ============================================================
// RENDER — DASHBOARD
// ============================================================
function renderDashboard() {
  const total = totalNetWorth();
  const sTotal  = stocksTotal();
  const cTotal  = cryptoTotal();
  const reTotal = privateTotal('real-estate');
  const peTotal = privateTotal('private-equity');
  const suTotal = privateTotal('startup-equity');

  const pct = v => total > 0 ? ((v / total) * 100).toFixed(1) + '%' : '0%';

  set('cat-stocks-val',    fmt(sTotal));  set('cat-stocks-pct',    pct(sTotal));
  set('cat-crypto-val',    fmt(cTotal));  set('cat-crypto-pct',    pct(cTotal));
  set('cat-realestate-val',fmt(reTotal)); set('cat-realestate-pct',pct(reTotal));
  set('cat-pe-val',        fmt(peTotal)); set('cat-pe-pct',        pct(peTotal));
  set('cat-startup-val',   fmt(suTotal)); set('cat-startup-pct',   pct(suTotal));

  // Donut
  const ctx = document.getElementById('allocation-chart').getContext('2d');
  if (charts.donut) charts.donut.destroy();
  const vals = [sTotal, cTotal, reTotal, peTotal, suTotal];
  const hasData = vals.some(v => v > 0);
  charts.donut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Stocks','Crypto','Real Estate','Private Equity','Startup Equity'],
      datasets: [{
        data: hasData ? vals : [1],
        backgroundColor: hasData
          ? ['#3b82f6','#f59e0b','#059669','#7c3aed','#db2777']
          : ['#e2e8f0'],
        borderWidth: 2,
        borderColor: '#fff',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)}` } }
      }
    }
  });

  drawHistoryChart('dash-history-chart', 220);
}

// ============================================================
// RENDER — STOCKS
// ============================================================
function renderStocks() {
  const tbody = document.getElementById('stocks-tbody');
  let rows = S.stocks;
  if (S.filters.broker !== 'all') rows = rows.filter(s => s.broker === S.filters.broker);
  if (S.filters.type  !== 'all') rows = rows.filter(s => s.type   === S.filters.type);

  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty"><td colspan="9">${
      S.stocks.length ? 'No stocks match the current filter.' : 'No stocks yet — add one above.'
    }</td></tr>`;
    set('stocks-foot', '<strong>—</strong>');
    return;
  }

  let total = 0;
  tbody.innerHTML = rows.map(s => {
    const price = S.prices[s.ticker];
    const val   = price != null ? price * s.shares : null;
    if (val) total += val;

    const pl    = (price != null && s.costBasis) ? (price - s.costBasis) * s.shares : null;
    const plPct = (price != null && s.costBasis) ? ((price - s.costBasis) / s.costBasis) * 100 : null;

    const brokerBadge = {
      'Chase':    'badge-chase',
      'E-Trade':  'badge-etrade',
      'Robinhood':'badge-robinhood',
      'Other':    'badge-other',
    }[s.broker] || 'badge-other';

    const typeBadge = s.type === 'long-term' ? 'badge-long' : 'badge-short';
    const typeLabel = s.type === 'long-term' ? 'Long-term' : 'Short-term';

    return `<tr>
      <td><strong>${s.ticker}</strong></td>
      <td>${s.shares.toLocaleString()}</td>
      <td>${price != null ? fmtP(price) : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${val != null ? fmt(val) : '—'}</td>
      <td><span class="badge ${brokerBadge}">${s.broker}</span></td>
      <td><span class="badge ${typeBadge}">${typeLabel}</span></td>
      <td>${s.costBasis ? fmtP(s.costBasis) : '—'}</td>
      <td>${pl != null
        ? `<span class="${pl >= 0 ? 'pos' : 'neg'}">${fmt(pl)} <small>(${fmtPct(plPct)})</small></span>`
        : '—'
      }</td>
      <td>
        <button class="icon-btn" onclick="editStock('${s.id}')" title="Edit">✏</button>
        <button class="icon-btn" onclick="delStock('${s.id}')" title="Delete">✕</button>
      </td>
    </tr>`;
  }).join('');

  set('stocks-foot', `<strong>${fmt(total)}</strong>`);
}

// ============================================================
// RENDER — CRYPTO
// ============================================================
function renderCrypto() {
  const tbody = document.getElementById('crypto-tbody');

  if (!S.crypto.length) {
    tbody.innerHTML = `<tr class="empty"><td colspan="7">No crypto yet — add one above.</td></tr>`;
    set('crypto-foot', '<strong>—</strong>');
    return;
  }

  let total = 0;
  tbody.innerHTML = S.crypto.map(c => {
    const price = S.cryptoPrices[c.coinId];
    const val   = price != null ? price * c.amount : null;
    if (val) total += val;

    const pl    = (price != null && c.costBasis) ? (price - c.costBasis) * c.amount : null;
    const plPct = (price != null && c.costBasis) ? ((price - c.costBasis) / c.costBasis) * 100 : null;

    return `<tr>
      <td>
        <strong>${c.name}</strong><br>
        <span style="color:var(--muted);font-size:11px">${c.coinId}</span>
      </td>
      <td>${c.amount}</td>
      <td>${price != null ? fmtP(price) : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${val != null ? fmt(val) : '—'}</td>
      <td>${c.costBasis ? fmtP(c.costBasis) : '—'}</td>
      <td>${pl != null
        ? `<span class="${pl >= 0 ? 'pos' : 'neg'}">${fmt(pl)} <small>(${fmtPct(plPct)})</small></span>`
        : '—'
      }</td>
      <td>
        <button class="icon-btn" onclick="editCrypto('${c.id}')" title="Edit">✏</button>
        <button class="icon-btn" onclick="delCrypto('${c.id}')" title="Delete">✕</button>
      </td>
    </tr>`;
  }).join('');

  set('crypto-foot', `<strong>${fmt(total)}</strong>`);
}

// ============================================================
// RENDER — PRIVATE
// ============================================================
function renderPrivate() {
  const container = document.getElementById('private-groups');

  if (!S.private.length) {
    container.innerHTML = `<div class="card"><p style="text-align:center;color:var(--muted);padding:36px">No investments yet — add one above.</p></div>`;
    return;
  }

  const cats = [
    { key: 'real-estate',    label: 'Real Estate',    badge: 'badge-re' },
    { key: 'private-equity', label: 'Private Equity', badge: 'badge-pe' },
    { key: 'startup-equity', label: 'Startup Equity', badge: 'badge-startup' },
    { key: 'other',          label: 'Other',          badge: 'badge-other2' },
  ];

  container.innerHTML = cats.map(cat => {
    const items = S.private.filter(p => p.category === cat.key);
    if (!items.length) return '';

    const total = items.reduce((s, p) => s + p.currentValue, 0);

    const rows = items.map(p => {
      const pl    = p.costBasis ? p.currentValue - p.costBasis : null;
      const plPct = p.costBasis ? (pl / p.costBasis) * 100 : null;
      return `<tr>
        <td><strong>${p.name}</strong></td>
        <td>${fmt(p.currentValue)}</td>
        <td>${p.costBasis ? fmt(p.costBasis) : '—'}</td>
        <td>${pl != null
          ? `<span class="${pl >= 0 ? 'pos' : 'neg'}">${fmt(pl)} <small>(${fmtPct(plPct)})</small></span>`
          : '—'
        }</td>
        <td style="color:var(--muted)">${p.notes || '—'}</td>
        <td>
          <button class="icon-btn" onclick="editPrivate('${p.id}')" title="Edit">✏</button>
          <button class="icon-btn" onclick="delPrivate('${p.id}')" title="Delete">✕</button>
        </td>
      </tr>`;
    }).join('');

    return `<div class="card priv-group">
      <div class="priv-group-head">
        <h3><span class="badge ${cat.badge}">${cat.label}</span></h3>
        <span class="priv-group-total">${fmt(total)}</span>
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Name</th><th>Current Value</th><th>Cost Basis</th>
              <th>P/L</th><th>Notes</th><th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// RENDER — HISTORY
// ============================================================
function renderHistory() {
  const snaps = [...S.snapshots].sort((a, b) => new Date(a.date) - new Date(b.date));

  set('stat-count', snaps.length);

  if (snaps.length >= 2) {
    const first = snaps[0];
    const last  = snaps[snaps.length - 1];
    const growth = last.totalNetWorth - first.totalNetWorth;
    const pct    = (growth / first.totalNetWorth) * 100;

    const gEl = document.getElementById('stat-growth');
    gEl.textContent = fmt(growth);
    gEl.className = 'stat-value ' + (growth >= 0 ? 'pos' : 'neg');

    const pEl = document.getElementById('stat-pct');
    pEl.textContent = fmtPct(pct);
    pEl.className = 'stat-value ' + (pct >= 0 ? 'pos' : 'neg');

    set('stat-first',  fmt(first.totalNetWorth));
    set('stat-latest', fmt(last.totalNetWorth));
  }

  drawHistoryChart('history-chart', 240);

  // Snapshot table (newest first)
  const tbody = document.getElementById('snapshots-tbody');
  if (!snaps.length) {
    tbody.innerHTML = `<tr class="empty"><td colspan="9">No snapshots yet — click "Save Snapshot" to record your current net worth.</td></tr>`;
    return;
  }

  const reversed = [...snaps].reverse();
  tbody.innerHTML = reversed.map((snap, i) => {
    const prev   = reversed[i + 1];
    const change = prev ? snap.totalNetWorth - prev.totalNetWorth : null;
    const d      = new Date(snap.date);
    const label  = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    return `<tr>
      <td>${label}</td>
      <td><strong>${fmt(snap.totalNetWorth)}</strong></td>
      <td>${fmt(snap.breakdown?.stocks)}</td>
      <td>${fmt(snap.breakdown?.crypto)}</td>
      <td>${fmt(snap.breakdown?.realEstate)}</td>
      <td>${fmt(snap.breakdown?.privateEquity)}</td>
      <td>${fmt(snap.breakdown?.startupEquity)}</td>
      <td>${change != null
        ? `<span class="${change >= 0 ? 'pos' : 'neg'}">${fmt(change)}</span>`
        : '—'
      }</td>
      <td>
        <button class="icon-btn" onclick="delSnapshot('${snap.id}')" title="Delete">✕</button>
      </td>
    </tr>`;
  }).join('');
}

// ============================================================
// HISTORY CHART
// ============================================================
function drawHistoryChart(canvasId, height) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (charts[canvasId]) { charts[canvasId].destroy(); delete charts[canvasId]; }

  const snaps = [...S.snapshots].sort((a, b) => new Date(a.date) - new Date(b.date));

  const ctx = canvas.getContext('2d');

  if (snaps.length < 2) {
    charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [{ data: [] }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
        scales: { x: { display: false }, y: { display: false } },
      }
    });
    return;
  }

  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: snaps.map(s =>
        new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
      ),
      datasets: [{
        label: 'Net Worth',
        data: snaps.map(s => s.totalNetWorth),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.08)',
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${fmt(ctx.raw)}` }
        }
      },
      scales: {
        y: {
          ticks: { callback: v => fmt(v), font: { size: 11 } },
          grid: { color: '#f1f5f9' },
        },
        x: {
          ticks: { font: { size: 11 } },
          grid: { display: false },
        }
      }
    }
  });
}

// ============================================================
// SNAPSHOT
// ============================================================
function takeSnapshot() {
  const snap = {
    id: uid(),
    date: new Date().toISOString(),
    totalNetWorth: totalNetWorth(),
    breakdown: {
      stocks:        stocksTotal(),
      crypto:        cryptoTotal(),
      realEstate:    privateTotal('real-estate'),
      privateEquity: privateTotal('private-equity'),
      startupEquity: privateTotal('startup-equity'),
    }
  };
  S.snapshots.push(snap);
  save();
  renderAll();
  toast('Snapshot saved!', 'success');
}

// ============================================================
// CRUD — STOCKS
// ============================================================
function editStock(id) {
  const s = S.stocks.find(s => s.id === id);
  if (!s) return;
  document.getElementById('s-ticker').value    = s.ticker;
  document.getElementById('s-shares').value    = s.shares;
  document.getElementById('s-broker').value    = s.broker;
  document.getElementById('s-type').value      = s.type;
  document.getElementById('s-cost').value      = s.costBasis || '';
  document.getElementById('s-notes').value     = s.notes || '';
  document.getElementById('s-editing-id').value = id;
  document.getElementById('stock-form-title').textContent = 'Edit Stock';
  showForm('stock-form');
}

function delStock(id) {
  if (!confirm('Delete this stock?')) return;
  S.stocks = S.stocks.filter(s => s.id !== id);
  save(); renderAll();
  toast('Stock removed.');
}

// ============================================================
// CRUD — CRYPTO
// ============================================================
function editCrypto(id) {
  const c = S.crypto.find(c => c.id === id);
  if (!c) return;
  document.getElementById('c-coinid').value      = c.coinId;
  document.getElementById('c-name').value        = c.name;
  document.getElementById('c-amount').value      = c.amount;
  document.getElementById('c-cost').value        = c.costBasis || '';
  document.getElementById('c-notes').value       = c.notes || '';
  document.getElementById('c-editing-id').value  = id;
  document.getElementById('crypto-form-title').textContent = 'Edit Crypto';
  showForm('crypto-form');
}

function delCrypto(id) {
  if (!confirm('Delete this crypto holding?')) return;
  S.crypto = S.crypto.filter(c => c.id !== id);
  save(); renderAll();
  toast('Crypto holding removed.');
}

// ============================================================
// CRUD — PRIVATE
// ============================================================
function editPrivate(id) {
  const p = S.private.find(p => p.id === id);
  if (!p) return;
  document.getElementById('p-name').value        = p.name;
  document.getElementById('p-category').value    = p.category;
  document.getElementById('p-value').value       = p.currentValue;
  document.getElementById('p-cost').value        = p.costBasis || '';
  document.getElementById('p-notes').value       = p.notes || '';
  document.getElementById('p-editing-id').value  = id;
  document.getElementById('private-form-title').textContent = 'Edit Investment';
  showForm('private-form');
}

function delPrivate(id) {
  if (!confirm('Delete this investment?')) return;
  S.private = S.private.filter(p => p.id !== id);
  save(); renderAll();
  toast('Investment removed.');
}

// ============================================================
// CRUD — SNAPSHOTS
// ============================================================
function delSnapshot(id) {
  if (!confirm('Delete this snapshot?')) return;
  S.snapshots = S.snapshots.filter(s => s.id !== id);
  save(); renderAll();
  toast('Snapshot deleted.');
}

// ============================================================
// FORM HELPERS
// ============================================================
function showForm(id) {
  document.getElementById(id).style.display = 'block';
  document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideForm(id) {
  document.getElementById(id).style.display = 'none';
}

function clearStockForm() {
  ['s-ticker','s-shares','s-cost','s-notes','s-editing-id'].forEach(id => el(id).value = '');
  el('s-broker').value = 'Chase';
  el('s-type').value   = 'long-term';
  document.getElementById('stock-form-title').textContent = 'Add Stock';
}

function clearCryptoForm() {
  ['c-coinid','c-name','c-amount','c-cost','c-notes','c-editing-id'].forEach(id => el(id).value = '');
  document.getElementById('crypto-form-title').textContent = 'Add Crypto';
}

function clearPrivateForm() {
  ['p-name','p-value','p-cost','p-notes','p-editing-id'].forEach(id => el(id).value = '');
  el('p-category').value = 'real-estate';
  document.getElementById('private-form-title').textContent = 'Add Investment';
}

// ============================================================
// UTILITIES
// ============================================================
function el(id) { return document.getElementById(id); }
function set(id, html) { document.getElementById(id).innerHTML = html; }

function toast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
}

// ============================================================
// EVENT LISTENERS
// ============================================================
function init() {
  // Tabs
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab))
  );

  // Header actions
  el('refresh-btn').addEventListener('click', refreshPrices);
  el('snapshot-btn').addEventListener('click', takeSnapshot);
  el('history-snapshot-btn').addEventListener('click', takeSnapshot);

  // ---- STOCKS ----
  el('add-stock-toggle').addEventListener('click', () => {
    const f = el('stock-form');
    if (f.style.display === 'none' || !f.style.display) {
      clearStockForm(); showForm('stock-form');
    } else {
      hideForm('stock-form');
    }
  });

  el('cancel-stock-btn').addEventListener('click', () => {
    hideForm('stock-form'); clearStockForm();
  });

  el('save-stock-btn').addEventListener('click', () => {
    const ticker   = el('s-ticker').value.trim().toUpperCase();
    const shares   = parseFloat(el('s-shares').value);
    const broker   = el('s-broker').value;
    const type     = el('s-type').value;
    const costBasis= parseFloat(el('s-cost').value) || null;
    const notes    = el('s-notes').value.trim();
    const editId   = el('s-editing-id').value;

    if (!ticker || isNaN(shares) || shares <= 0) {
      toast('Enter a valid ticker and share count.', 'error'); return;
    }

    if (editId) {
      const i = S.stocks.findIndex(s => s.id === editId);
      if (i !== -1) S.stocks[i] = { ...S.stocks[i], ticker, shares, broker, type, costBasis, notes };
    } else {
      S.stocks.push({ id: uid(), ticker, shares, broker, type, costBasis, notes });
    }

    save(); renderAll();
    hideForm('stock-form'); clearStockForm();
    toast(editId ? 'Stock updated!' : 'Stock added!', 'success');

    // Auto-fetch price for new stock
    if (!editId && S.settings.finnhubKey) {
      fetchStockPrice(ticker).then(p => {
        if (p !== null) { S.prices[ticker] = p; save(); renderAll(); }
      });
    }
  });

  // Filters
  document.querySelectorAll('[data-broker]').forEach(b =>
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-broker]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      S.filters.broker = b.dataset.broker;
      renderStocks();
    })
  );

  document.querySelectorAll('[data-stype]').forEach(b =>
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-stype]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      S.filters.type = b.dataset.stype;
      renderStocks();
    })
  );

  // ---- CRYPTO ----
  el('add-crypto-toggle').addEventListener('click', () => {
    const f = el('crypto-form');
    if (f.style.display === 'none' || !f.style.display) {
      clearCryptoForm(); showForm('crypto-form');
    } else {
      hideForm('crypto-form');
    }
  });

  el('cancel-crypto-btn').addEventListener('click', () => {
    hideForm('crypto-form'); clearCryptoForm();
  });

  el('save-crypto-btn').addEventListener('click', () => {
    const coinId   = el('c-coinid').value.trim().toLowerCase();
    const name     = el('c-name').value.trim();
    const amount   = parseFloat(el('c-amount').value);
    const costBasis= parseFloat(el('c-cost').value) || null;
    const notes    = el('c-notes').value.trim();
    const editId   = el('c-editing-id').value;

    if (!coinId || !name || isNaN(amount) || amount <= 0) {
      toast('Fill in all required fields.', 'error'); return;
    }

    if (editId) {
      const i = S.crypto.findIndex(c => c.id === editId);
      if (i !== -1) S.crypto[i] = { ...S.crypto[i], coinId, name, amount, costBasis, notes };
    } else {
      S.crypto.push({ id: uid(), coinId, name, amount, costBasis, notes });
    }

    save(); renderAll();
    hideForm('crypto-form'); clearCryptoForm();
    toast(editId ? 'Crypto updated!' : 'Crypto added!', 'success');

    // Auto-fetch price
    if (!editId) {
      fetchCryptoPrices([coinId]).then(prices => {
        Object.assign(S.cryptoPrices, prices);
        save(); renderAll();
      });
    }
  });

  // ---- PRIVATE ----
  el('add-private-toggle').addEventListener('click', () => {
    const f = el('private-form');
    if (f.style.display === 'none' || !f.style.display) {
      clearPrivateForm(); showForm('private-form');
    } else {
      hideForm('private-form');
    }
  });

  el('cancel-private-btn').addEventListener('click', () => {
    hideForm('private-form'); clearPrivateForm();
  });

  el('save-private-btn').addEventListener('click', () => {
    const name         = el('p-name').value.trim();
    const category     = el('p-category').value;
    const currentValue = parseFloat(el('p-value').value);
    const costBasis    = parseFloat(el('p-cost').value) || null;
    const notes        = el('p-notes').value.trim();
    const editId       = el('p-editing-id').value;

    if (!name || isNaN(currentValue) || currentValue < 0) {
      toast('Enter a name and a valid value.', 'error'); return;
    }

    if (editId) {
      const i = S.private.findIndex(p => p.id === editId);
      if (i !== -1) S.private[i] = { ...S.private[i], name, category, currentValue, costBasis, notes };
    } else {
      S.private.push({ id: uid(), name, category, currentValue, costBasis, notes });
    }

    save(); renderAll();
    hideForm('private-form'); clearPrivateForm();
    toast(editId ? 'Investment updated!' : 'Investment added!', 'success');
  });

  // ---- SETTINGS ----
  el('finnhub-key').value = S.settings.finnhubKey || '';

  el('save-settings-btn').addEventListener('click', () => {
    S.settings.finnhubKey = el('finnhub-key').value.trim();
    save();
    toast('Settings saved!', 'success');
  });

  el('export-btn').addEventListener('click', () => {
    const data = {
      stocks: S.stocks, crypto: S.crypto, private: S.private,
      snapshots: S.snapshots, prices: S.prices, cryptoPrices: S.cryptoPrices,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `net-worth-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Data exported!', 'success');
  });

  el('import-btn').addEventListener('click', () => el('import-file').click());

  el('import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.stocks)       S.stocks       = d.stocks;
        if (d.crypto)       S.crypto       = d.crypto;
        if (d.private)      S.private      = d.private;
        if (d.snapshots)    S.snapshots    = d.snapshots;
        if (d.prices)       S.prices       = d.prices;
        if (d.cryptoPrices) S.cryptoPrices = d.cryptoPrices;
        save(); renderAll();
        toast('Data imported!', 'success');
      } catch { toast('Invalid file.', 'error'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  el('clear-all-btn').addEventListener('click', () => {
    if (!confirm('Delete ALL data? This cannot be undone.')) return;
    if (!confirm('Last chance — are you sure?')) return;
    Object.values(K).forEach(k => localStorage.removeItem(k));
    load(); renderAll();
    toast('All data cleared.', 'error');
  });
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  load();
  init();
  renderAll();

  // Auto-fetch crypto prices on load (no key needed)
  if (S.crypto.length) {
    const ids = [...new Set(S.crypto.map(c => c.coinId))];
    fetchCryptoPrices(ids).then(prices => {
      Object.assign(S.cryptoPrices, prices);
      save(); renderAll();
    });
  }
});
