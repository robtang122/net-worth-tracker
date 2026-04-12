// ============================================================
// STORAGE KEYS
// ============================================================
const K = {
  stocks:              'nwt_stocks',
  crypto:              'nwt_crypto',
  private:             'nwt_private',
  accounts:            'nwt_accounts',
  options:             'nwt_options',
  trades:              'nwt_trades',
  snapshots:           'nwt_snapshots',
  settings:            'nwt_settings',
  prices:              'nwt_prices',
  cryptoPrices:        'nwt_crypto_prices',
  optionPrices:        'nwt_option_prices',
  optionPriceFetched:  'nwt_option_price_fetched',
};

const OPTION_STALE_MS = 12 * 60 * 60 * 1000; // 12 hours

// ============================================================
// STATE
// ============================================================
let S = {
  stocks:       [],
  crypto:       [],
  private:      [],
  accounts:     [],
  options:      [],
  trades:       [],
  snapshots:    [],
  settings:     { finnhubKey: '', tradierKey: '', tradierSandbox: true, marketDataKey: '', darkMode: true, cryptoDeposited: null },
  prices:       {},
  cryptoPrices: {},
  optionPrices:       {}, // keyed by option id
  optionPriceFetched: {}, // keyed by option id → ISO timestamp of last fetch
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
  S.accounts     = parse(K.accounts,     []);
  S.options      = parse(K.options,      []);
  S.trades       = parse(K.trades,       []);
  S.snapshots    = parse(K.snapshots,    []);
  S.settings     = parse(K.settings,     { finnhubKey: '', tradierKey: '', tradierSandbox: true, marketDataKey: '', darkMode: true, cryptoDeposited: null });
  S.prices       = parse(K.prices,       {});
  S.cryptoPrices = parse(K.cryptoPrices, {});
  S.optionPrices        = parse(K.optionPrices,       {});
  S.optionPriceFetched  = parse(K.optionPriceFetched, {});
  if (S.settings.darkMode === undefined) S.settings.darkMode = true;
  // Migrate old marginDebt field → cash (positive debt → negative cash)
  S.accounts.forEach(a => {
    if (a.cash === undefined && a.marginDebt !== undefined) {
      a.cash = -(a.marginDebt || 0);
      delete a.marginDebt;
    }
  });
}

function save() {
  ls(K.stocks,       S.stocks);
  ls(K.crypto,       S.crypto);
  ls(K.private,      S.private);
  ls(K.accounts,     S.accounts);
  ls(K.options,      S.options);
  ls(K.trades,       S.trades);
  ls(K.snapshots,    S.snapshots);
  ls(K.settings,     S.settings);
  ls(K.prices,       S.prices);
  ls(K.cryptoPrices, S.cryptoPrices);
  ls(K.optionPrices,       S.optionPrices);
  ls(K.optionPriceFetched, S.optionPriceFetched);
}

function parse(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}

function ls(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

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

function privateTotal() {
  return S.private.reduce((sum, p) => sum + (p.currentValue || 0), 0);
}

function optionsTotal() {
  return S.options.reduce((sum, o) => {
    const price   = S.optionPrices[o.id];
    if (price == null) return sum;
    const val     = price * (o.contracts || 1) * 100;
    return sum + (o.position === 'short' ? -val : val);
  }, 0);
}

function realizedNetPL()  { return S.trades.reduce((s, t) => s + (t.pl || 0), 0); }
function realizedGains()  { return S.trades.filter(t => t.pl > 0).reduce((s, t) => s + t.pl, 0); }
function realizedLosses() { return S.trades.filter(t => t.pl < 0).reduce((s, t) => s + t.pl, 0); }

function totalCashBalance() {
  return S.accounts.reduce((sum, a) => sum + (a.cash || 0), 0);
}

// For backward compat and snapshot display: sum of negative cash values as positive debt figure
function totalMarginDebt() {
  return S.accounts.reduce((sum, a) => {
    const cash = a.cash || 0;
    return cash < 0 ? sum + Math.abs(cash) : sum;
  }, 0);
}

function totalNetWorth() {
  return stocksTotal() + cryptoTotal() + privateTotal() + totalCashBalance();
}

// Total cost basis across all assets (what was put in)
function totalInvested() {
  const stocksInvested = S.stocks.reduce((sum, s) => {
    return sum + (s.costBasis ? s.costBasis * s.shares : 0);
  }, 0);
  const cryptoInvested = S.crypto.reduce((sum, c) => {
    return sum + (c.costBasis ? c.costBasis * c.amount : 0);
  }, 0);
  const privateInvested = S.private.reduce((sum, p) => {
    return sum + (p.called || 0);
  }, 0);
  return stocksInvested + cryptoInvested + privateInvested;
}

function wealthGenerated() {
  const invested = totalInvested();
  if (!invested) return null;
  return totalNetWorth() - invested;
}

// Match a stock to an account — by accountId if set, else by broker name (backward compat)
function stockBelongsToAccount(s, a) {
  if (s.accountId) return s.accountId === a.id;
  return s.broker === a.broker;
}

function brokerHoldings(account) {
  return S.stocks.reduce((sum, s) => {
    if (stockBelongsToAccount(s, account)) {
      return sum + ((S.prices[s.ticker] || 0) * s.shares);
    }
    return sum;
  }, 0);
}

function brokerCostBasis(account) {
  return S.stocks.reduce((sum, s) => {
    if (stockBelongsToAccount(s, account) && s.costBasis) {
      return sum + (s.costBasis * s.shares);
    }
    return sum;
  }, 0);
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
  if (isNaN(v) || v === null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
};

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

function fmtRelative(iso) {
  if (!iso) return '';
  const now = Date.now();
  const d   = new Date(iso).getTime();
  const days = Math.floor((now - d) / 86400000);
  if (days === 0) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  if (days < 30)  return `Updated ${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Updated ${months}mo ago`;
  return `Updated ${Math.floor(months/12)}y ago`;
}

// ============================================================
// THEME
// ============================================================
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const toggle = document.getElementById('dark-mode-toggle');
  if (toggle) toggle.checked = dark;
}

function getChartTheme() {
  const dark = S.settings.darkMode !== false;
  return {
    grid:    dark ? '#334155' : '#e2e8f0',
    tick:    dark ? '#94a3b8' : '#64748b',
    tooltip: dark ? '#1e293b' : '#ffffff',
    tooltipText: dark ? '#f1f5f9' : '#1e293b',
  };
}

// ============================================================
// API
// ============================================================
async function fetchStockPrice(ticker) {
  if (!S.settings.finnhubKey) return null;
  try {
    const res  = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${S.settings.finnhubKey}`
    );
    const data = await res.json();
    return (data.c && data.c > 0) ? data.c : null;
  } catch { return null; }
}

async function fetchCryptoPrices(coinIds) {
  if (!coinIds.length) return {};
  try {
    const res  = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds.join(',')}&vs_currencies=usd`
    );
    const data = await res.json();
    const out  = {};
    for (const id of coinIds) {
      if (data[id]) out[id] = data[id].usd;
    }
    return out;
  } catch { return {}; }
}

// Fetch options prices via Tradier (sandbox or live)
async function fetchOptionPricesWithTradier() {
  if (!S.settings.tradierKey || !S.options.length) return;
  const base = S.settings.tradierSandbox !== false
    ? 'https://sandbox.tradier.com/v1'
    : 'https://api.tradier.com/v1';
  const headers = {
    'Authorization': `Bearer ${S.settings.tradierKey}`,
    'Accept': 'application/json',
  };

  // Group by underlying+expiration to minimize API calls
  const pairs = {};
  for (const o of S.options) {
    const key = `${o.underlying}|${o.expiration}`;
    if (!pairs[key]) pairs[key] = [];
    pairs[key].push(o);
  }

  for (const [key, opts] of Object.entries(pairs)) {
    const [underlying, expiration] = key.split('|');
    try {
      const res  = await fetch(
        `${base}/markets/options/chains?symbol=${underlying}&expiration=${expiration}&greeks=false`,
        { headers }
      );
      const data = await res.json();
      const chain = data.options?.option;
      if (!chain) continue;

      for (const o of opts) {
        const match = chain.find(c =>
          c.option_type === o.optionType &&
          Math.abs((c.strike || 0) - o.strike) < 0.01
        );
        if (!match) continue;
        // Use last price; fall back to mid of bid/ask if last is stale (0)
        const price = (match.last > 0) ? match.last : ((match.bid + match.ask) / 2);
        if (price > 0) S.optionPrices[o.id] = price;
      }
    } catch { /* silent — one bad expiry shouldn't kill the rest */ }
    await delay(220);
  }
}

// Returns { fetched, skipped } counts
async function fetchOptionPricesWithMarketData(forceAll = false) {
  if (!S.settings.marketDataKey || !S.options.length) return { fetched: 0, skipped: 0 };
  const token = S.settings.marketDataKey;
  const now   = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  let fetched = 0, skipped = 0;

  for (const o of S.options) {
    // Skip expired options — no meaningful price to fetch
    const expDate = new Date(o.expiration + 'T00:00:00');
    if (expDate < today) { skipped++; continue; }

    // Skip if price is still fresh (within staleness window)
    if (!forceAll) {
      const lastFetch = S.optionPriceFetched[o.id];
      if (lastFetch && (now - new Date(lastFetch).getTime()) < OPTION_STALE_MS) {
        skipped++; continue;
      }
    }

    try {
      const url = `https://api.marketdata.app/v1/options/chain/${o.underlying}/` +
        `?expiration=${o.expiration}&strike=${o.strike}&side=${o.optionType}&token=${token}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.s !== 'ok' || !data.mid?.length) { skipped++; continue; }
      const price = data.mid[0];
      if (price > 0) {
        S.optionPrices[o.id]       = price;
        S.optionPriceFetched[o.id] = new Date().toISOString();
        fetched++;
      } else { skipped++; }
    } catch { skipped++; }
    await delay(300);
  }

  return { fetched, skipped };
}

async function refreshPrices() {
  const btn      = document.getElementById('refresh-btn');
  btn.textContent = '↻ Refreshing…';
  btn.disabled    = true;

  if (S.stocks.length) {
    if (!S.settings.finnhubKey) {
      toast('Add a Finnhub API key in Settings for live stock prices.', 'error');
    } else {
      const tickers = [...new Set(S.stocks.map(s => s.ticker))];
      for (const t of tickers) {
        const p = await fetchStockPrice(t);
        if (p !== null) S.prices[t] = p;
        await delay(220);
      }
    }
  }

  // Options have their own refresh button — skip here

  if (S.crypto.length) {
    const ids    = [...new Set(S.crypto.map(c => c.coinId))];
    const prices = await fetchCryptoPrices(ids);
    Object.assign(S.cryptoPrices, prices);
  }

  save();
  renderAll();

  const now = new Date();
  document.getElementById('last-updated').textContent =
    `Prices updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  btn.textContent = '↻ Refresh Prices';
  btn.disabled    = false;
  toast('Prices refreshed!', 'success');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function refreshOptions() {
  if (!S.options.length) { toast('No options to refresh.'); return; }
  if (!S.settings.marketDataKey && !S.settings.tradierKey) {
    toast('Add a MarketData.app token in Settings for options prices.', 'error'); return;
  }

  const btn = el('refresh-options-btn');
  btn.textContent = '↻ Fetching…';
  btn.disabled    = true;

  let fetched = 0, skipped = 0;

  if (S.settings.marketDataKey) {
    ({ fetched, skipped } = await fetchOptionPricesWithMarketData());
  } else {
    await fetchOptionPricesWithTradier();
    fetched = S.options.length;
  }

  save();
  renderOptions();

  const msg = fetched > 0
    ? `Options updated: ${fetched} fetched${skipped ? `, ${skipped} skipped (fresh or expired)` : ''}`
    : `All prices are fresh — next update in ~12h (${skipped} skipped)`;
  toast(msg, fetched > 0 ? 'success' : 'info');

  btn.textContent = '↻ Refresh Options';
  btn.disabled    = false;
}

// ============================================================
// RENDER — ALL
// ============================================================
function renderAll() {
  renderHeader();
  renderDashboard();
  renderAccounts();
  renderStocks();
  renderOptions();
  renderCrypto();
  renderPrivate();
  renderRealized();
  renderHistory();
}

// ============================================================
// RENDER — HEADER
// ============================================================
function renderHeader() {
  const total = totalNetWorth();
  document.getElementById('header-total').textContent = fmt(total);

  // Change vs last snapshot
  const changeEl = document.getElementById('header-change');
  const snaps    = S.snapshots;
  if (snaps.length) {
    const prev = snaps[snaps.length - 1].totalNetWorth;
    const diff = total - prev;
    const pct  = prev ? (diff / prev) * 100 : 0;
    changeEl.textContent = `${fmt(diff)} (${fmtPct(pct)}) since last snapshot`;
    changeEl.className   = 'total-change ' + (diff >= 0 ? 'pos' : 'neg');
  } else {
    changeEl.textContent = '';
  }

  // Wealth generated
  const wealth    = wealthGenerated();
  const wealthEl  = document.getElementById('header-wealth');
  const wealthPct = document.getElementById('header-wealth-pct');
  if (wealth !== null) {
    wealthEl.textContent  = fmt(wealth);
    wealthEl.className    = 'total-value ' + (wealth >= 0 ? 'pos' : 'neg');
    const invested        = totalInvested();
    const pct             = invested ? (wealth / invested) * 100 : 0;
    wealthPct.textContent = fmtPct(pct);
    wealthPct.className   = 'total-change ' + (wealth >= 0 ? 'pos' : 'neg');
  } else {
    wealthEl.textContent  = '—';
    wealthEl.className    = 'total-value';
    wealthPct.textContent = '';
  }
}

// ============================================================
// RENDER — DASHBOARD
// ============================================================
function renderDashboard() {
  const total    = totalNetWorth();
  const sTotal   = stocksTotal();
  const cTotal   = cryptoTotal();
  const pvTotal  = privateTotal();
  const wealth   = wealthGenerated();
  const invested = totalInvested();

  const pct = v => total > 0 ? ((v / total) * 100).toFixed(1) + '%' : '0%';

  set('cat-stocks-val',  fmt(sTotal));   set('cat-stocks-pct',  pct(sTotal));
  set('cat-crypto-val',  fmt(cTotal));   set('cat-crypto-pct',  pct(cTotal));
  set('cat-private-val', fmt(pvTotal));  set('cat-private-pct', pct(pvTotal));
  const cashBal = totalCashBalance();
  const cashEl  = document.getElementById('cat-margin-val');
  cashEl.textContent = cashBal !== 0 ? fmt(Math.abs(cashBal)) : '$0';
  cashEl.className   = 'cat-value ' + (cashBal < 0 ? 'neg' : cashBal > 0 ? 'pos' : '');

  if (wealth !== null) {
    const wpct = invested ? (wealth / invested) * 100 : 0;
    set('cat-wealth-val', `<span class="${wealth >= 0 ? 'pos' : 'neg'}">${fmt(wealth)}</span>`);
    set('cat-wealth-pct', `<span class="${wealth >= 0 ? 'pos' : 'neg'}">${fmtPct(wpct)}</span>`);
  } else {
    set('cat-wealth-val', '<span style="color:var(--muted);font-size:13px">Add cost basis to track</span>');
    set('cat-wealth-pct', '');
  }

  // Donut chart
  const theme = getChartTheme();
  const ctx   = document.getElementById('allocation-chart').getContext('2d');
  if (charts.donut) charts.donut.destroy();
  const vals    = [sTotal, cTotal, pvTotal];
  const hasData = vals.some(v => v > 0);
  charts.donut  = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Stocks', 'Crypto', 'Private Funds'],
      datasets: [{
        data: hasData ? vals : [1],
        backgroundColor: hasData
          ? ['#3b82f6', '#f59e0b', '#8b5cf6']
          : [theme.grid],
        borderWidth: 2,
        borderColor: 'transparent',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11 }, boxWidth: 12, padding: 10, color: theme.tick }
        },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)}` } }
      }
    }
  });

  drawHistoryChart('dash-history-chart', 220);
}

// ============================================================
// RENDER — ACCOUNTS
// ============================================================
function renderAccounts() {
  const container = document.getElementById('accounts-container');

  if (!S.accounts.length) {
    container.innerHTML = `<div class="card">
      <p style="text-align:center;color:var(--muted);padding:36px">
        No accounts yet — add one above to track holdings, deposits, and margin debt per broker.
      </p>
    </div>`;
    return;
  }

  const cards = S.accounts.map(a => {
    const holdings   = brokerHoldings(a);
    const costBasis  = brokerCostBasis(a);
    const cash       = a.cash || 0;
    const equity     = holdings + cash;
    const deposited  = a.deposited || null;
    const wealthGain = (deposited && holdings > 0) ? holdings - deposited : null;
    const wealthPct  = (wealthGain !== null && deposited) ? (wealthGain / deposited) * 100 : null;
    const costGain   = (costBasis > 0 && holdings > 0) ? holdings - costBasis : null;
    const costPct    = (costGain !== null && costBasis) ? (costGain / costBasis) * 100 : null;

    const brokerBadge = {
      'Chase':     'badge-chase',
      'E-Trade':   'badge-etrade',
      'Robinhood': 'badge-robinhood',
      'Other':     'badge-other',
    }[a.broker] || 'badge-other';

    const label    = a.label ? `<div class="account-card-label">${a.label}</div>` : '';
    const updated  = a.updatedAt ? `<span class="account-card-updated">${fmtRelative(a.updatedAt)}</span>` : '';

    const wealthRow = wealthGain !== null
      ? `<div class="account-wealth-row">
           <span>Deposited: ${fmt(deposited)}</span>
           <span class="${wealthGain >= 0 ? 'pos' : 'neg'}">${fmt(wealthGain)} (${fmtPct(wealthPct)})</span>
         </div>`
      : costGain !== null
        ? `<div class="account-wealth-row">
             <span>Cost basis: ${fmt(costBasis)}</span>
             <span class="${costGain >= 0 ? 'pos' : 'neg'}">${fmt(costGain)} (${fmtPct(costPct)})</span>
           </div>`
        : '';

    return `<div class="account-card">
      <div class="account-card-head">
        <div class="account-card-title">
          <span class="badge ${brokerBadge}">${a.broker}</span>
          <div>
            <strong>${a.label || a.broker}</strong>
            ${label ? '' : ''}
          </div>
        </div>
        ${updated}
      </div>

      <div class="account-metrics">
        <div class="account-metric">
          <div class="account-metric-label">Holdings</div>
          <div class="account-metric-value">${holdings > 0 ? fmt(holdings) : '<span style="color:var(--muted)">—</span>'}</div>
        </div>
        <div class="account-metric">
          <div class="account-metric-label">Net Deposited</div>
          <div class="account-metric-value">${deposited ? fmt(deposited) : '<span style="color:var(--muted)">—</span>'}</div>
        </div>
        <div class="account-metric">
          <div class="account-metric-label">${cash < 0 ? 'Margin Debt' : 'Cash'}</div>
          <div class="account-metric-value ${cash < 0 ? 'neg' : cash > 0 ? 'pos' : ''}">${cash !== 0 ? fmt(Math.abs(cash)) : '$0'}</div>
        </div>
      </div>

      <div class="account-equity-row">
        <span class="account-equity-label">Real Equity</span>
        <span class="account-equity-value">${fmt(equity)}</span>
      </div>

      ${wealthRow}

      <div class="account-card-actions">
        <button class="icon-btn" onclick="editAccount('${a.id}')" title="Edit">✏</button>
        <button class="icon-btn" onclick="delAccount('${a.id}')" title="Delete">✕</button>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `<div class="accounts-grid">${cards}</div>`;
}

// ============================================================
// RENDER — STOCKS
// ============================================================
function populateAccountSelect() {
  const sel = el('s-account');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = S.accounts.length
    ? S.accounts.map(a => `<option value="${a.id}">${a.label || a.broker}</option>`).join('')
    : '<option value="">— add accounts first —</option>';
  if (current && sel.querySelector(`option[value="${current}"]`)) sel.value = current;
}

function renderAccountFilterPills() {
  const container = document.getElementById('account-filter-pills');
  if (!container) return;
  const pills = S.accounts.map(a =>
    `<button class="pill${S.filters.broker === a.id ? ' active' : ''}" data-broker="${a.id}">${a.label || a.broker}</button>`
  ).join('');
  container.innerHTML = `<span class="filter-label">Account:</span>
    <button class="pill${S.filters.broker === 'all' ? ' active' : ''}" data-broker="all">All</button>
    ${pills}`;
  container.querySelectorAll('[data-broker]').forEach(b =>
    b.addEventListener('click', () => {
      container.querySelectorAll('[data-broker]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      S.filters.broker = b.dataset.broker;
      renderStocks();
    })
  );
}

function renderStocks() {
  renderAccountFilterPills();
  const tbody = document.getElementById('stocks-tbody');
  let rows    = S.stocks;
  if (S.filters.broker !== 'all') {
    rows = rows.filter(s => {
      if (s.accountId) return s.accountId === S.filters.broker;
      // Backward compat: match by broker name if account id equals broker name
      const acct = S.accounts.find(a => a.id === S.filters.broker);
      return acct ? s.broker === acct.broker : false;
    });
  }
  if (S.filters.type   !== 'all') {
    const oldMap = { 'long-hold': ['hold','long-term'], 'short-trade': ['trade','short-term'] };
    const aliases = oldMap[S.filters.type] || [];
    rows = rows.filter(s => s.type === S.filters.type || aliases.includes(s.type));
  }

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

    // Resolve account label — by accountId if set, else fall back to broker name
    const acct        = s.accountId ? S.accounts.find(a => a.id === s.accountId) : null;
    const acctLabel   = acct ? (acct.label || acct.broker) : (s.broker || '—');
    const brokerName  = acct ? acct.broker : (s.broker || 'Other');
    const brokerBadge = { Chase: 'badge-chase', 'E-Trade': 'badge-etrade', Robinhood: 'badge-robinhood', Other: 'badge-other' }[brokerName] || 'badge-other';

    // Normalize old type values to new ones
    const typeMap = {
      'long-hold': ['long-hold', 'hold', 'long-term'],
      'short-trade': ['short-trade', 'trade', 'short-term'],
      'medium-trade': ['medium-trade'],
    };
    const normType = Object.entries(typeMap).find(([, vals]) => vals.includes(s.type))?.[0] || 'long-hold';
    const typeBadge = `badge-${normType}`;
    const typeLabel = normType === 'long-hold' ? 'Long Hold' : normType === 'short-trade' ? 'Short Trade' : 'Medium Trade';

    return `<tr>
      <td><strong>${s.ticker}</strong></td>
      <td>${s.shares.toLocaleString()}</td>
      <td>${price != null ? fmtP(price) : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${val != null ? fmt(val) : '—'}</td>
      <td><span class="badge ${brokerBadge}">${acctLabel}</span></td>
      <td><span class="badge ${typeBadge}">${typeLabel}</span></td>
      <td>${s.costBasis ? fmtP(s.costBasis) : '—'}</td>
      <td>${pl != null
        ? `<span class="${pl >= 0 ? 'pos' : 'neg'}">${fmt(pl)} <small>(${fmtPct(plPct)})</small></span>`
        : '—'
      }</td>
      <td>
        <button class="icon-btn" onclick="openSellStock('${s.id}')" title="Sell">$</button>
        <button class="icon-btn" onclick="editStock('${s.id}')" title="Edit">✏</button>
        <button class="icon-btn" onclick="delStock('${s.id}')"  title="Delete">✕</button>
      </td>
    </tr>`;
  }).join('');

  set('stocks-foot', `<strong>${fmt(total)}</strong>`);
}

// ============================================================
// RENDER — OPTIONS
// ============================================================
function renderOptions() {
  const tbody = document.getElementById('options-tbody');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!S.options.length) {
    tbody.innerHTML = `<tr class="empty"><td colspan="13">No options yet — add one above.</td></tr>`;
    set('options-foot', '<strong>—</strong>');
    return;
  }

  let total = 0;
  tbody.innerHTML = S.options.map(o => {
    const price     = S.optionPrices[o.id];
    const contracts = o.contracts || 1;
    const premium   = o.premium || 0;
    const isShort   = o.position === 'short';

    // Value: for short, current liability (what it would cost to buy back)
    const val = price != null ? price * contracts * 100 : null;

    // Net worth impact: long adds value, short subtracts (it's a liability)
    if (val != null) total += isShort ? -val : val;

    // P/L:
    // Long:  current value − premium paid        (profit when price rises)
    // Short: premium received − current value    (profit when price falls/expires)
    const premiumTotal = premium * contracts * 100;
    const pl = val != null
      ? (isShort ? premiumTotal - val : val - premiumTotal)
      : null;
    const plPct = (pl != null && premiumTotal > 0) ? (pl / premiumTotal) * 100 : null;

    const expDate  = new Date(o.expiration + 'T00:00:00');
    const dte      = Math.ceil((expDate - today) / 86400000);
    const expired  = dte < 0;
    const dteLabel = expired
      ? '<span class="neg">Expired</span>'
      : dte === 0 ? '<span style="color:var(--danger)">Today</span>'
      : `${dte}d`;

    const oAcct     = o.accountId ? S.accounts.find(a => a.id === o.accountId) : null;
    const oLabel    = oAcct ? (oAcct.label || oAcct.broker) : (o.broker || '—');
    const oBroker   = oAcct ? oAcct.broker : (o.broker || 'Other');
    const brokerBadge = { Chase: 'badge-chase', 'E-Trade': 'badge-etrade', Robinhood: 'badge-robinhood', Other: 'badge-other' }[oBroker] || 'badge-other';

    const expLabel  = new Date(o.expiration + 'T00:00:00')
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

    const posBadge  = isShort ? 'badge-trade' : 'badge-hold';
    const posLabel  = isShort ? 'Short' : 'Long';

    // Expired P/L: long loses premium paid, short keeps full premium
    const expiredPL = isShort ? premiumTotal : -premiumTotal;

    return `<tr>
      <td><strong>${o.underlying}</strong></td>
      <td><span class="badge ${posBadge}">${posLabel}</span></td>
      <td><span class="badge badge-${o.optionType}">${o.optionType.toUpperCase()}</span></td>
      <td>$${o.strike}</td>
      <td>${expLabel}</td>
      <td>${dteLabel}</td>
      <td>${contracts}</td>
      <td>${fmtP(premium)}</td>
      <td>
        ${price != null ? fmtP(price) : '<span style="color:var(--muted)">—</span>'}
        ${S.optionPriceFetched[o.id] ? `<br><span style="color:var(--muted);font-size:10px">${fmtRelative(S.optionPriceFetched[o.id])}</span>` : ''}
      </td>
      <td>${val != null ? fmt(val) : '—'}</td>
      <td>${expired
        ? `<span class="${expiredPL >= 0 ? 'pos' : 'neg'}">${fmt(expiredPL)}</span>`
        : pl != null
          ? `<span class="${pl >= 0 ? 'pos' : 'neg'}">${fmt(pl)} <small>(${fmtPct(plPct)})</small></span>`
          : '—'
      }</td>
      <td><span class="badge ${brokerBadge}">${oLabel}</span></td>
      <td>
        <button class="icon-btn" onclick="openCloseOption('${o.id}')" title="Close">$</button>
        <button class="icon-btn" onclick="editOption('${o.id}')" title="Edit">✏</button>
        <button class="icon-btn" onclick="delOption('${o.id}')"  title="Delete">✕</button>
      </td>
    </tr>`;
  }).join('');

  set('options-foot', `<strong>${fmt(total)}</strong>`);
}

// ============================================================
// RENDER — CRYPTO
// ============================================================
function renderCrypto() {
  const tbody = document.getElementById('crypto-tbody');

  // --- Capital card ---
  const totalVal  = cryptoTotal();
  const deposited = S.settings.cryptoDeposited;
  const gain      = deposited != null ? totalVal - deposited : null;
  const gainPct   = (gain !== null && deposited) ? (gain / deposited) * 100 : null;

  const card = document.getElementById('crypto-capital-card');
  if (card) {
    set('crypto-deposited-display', deposited != null ? fmt(deposited) : '<span style="color:var(--muted)">—</span>');
    set('crypto-value-display',     fmt(totalVal));
    if (gain !== null) {
      set('crypto-gain-display',
        `<span class="${gain >= 0 ? 'pos' : 'neg'}">${fmt(gain)} (${fmtPct(gainPct)})</span>`);
    } else {
      set('crypto-gain-display', '<span style="color:var(--muted)">—</span>');
    }
  }

  if (!S.crypto.length) {
    tbody.innerHTML = `<tr class="empty"><td colspan="8">No crypto yet — add one above.</td></tr>`;
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
        <button class="icon-btn" onclick="openSellCrypto('${c.id}')" title="Sell">$</button>
        <button class="icon-btn" onclick="editCrypto('${c.id}')" title="Edit">✏</button>
        <button class="icon-btn" onclick="delCrypto('${c.id}')"  title="Delete">✕</button>
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
    container.innerHTML = `<div class="card">
      <p style="text-align:center;color:var(--muted);padding:36px">
        No investments yet — add one above.
      </p>
    </div>`;
    return;
  }

  const fundTypes = [
    { key: 'real-estate-fund', label: 'Real Estate Funds',      badge: 'badge-re-fund' },
    { key: 'pe-fund',          label: 'Private Equity Funds',   badge: 'badge-pe-fund' },
    { key: 'venture-fund',     label: 'Venture / Startup Funds',badge: 'badge-vc-fund' },
    { key: 'other',            label: 'Other',                  badge: 'badge-other2'  },
    // Backward compat: old categories
    { key: 'real-estate',    label: 'Real Estate',    badge: 'badge-re-fund' },
    { key: 'private-equity', label: 'Private Equity', badge: 'badge-pe-fund' },
    { key: 'startup-equity', label: 'Startup Equity', badge: 'badge-vc-fund' },
  ];

  // Group items — deduplicate display if old + new categories overlap
  const seen = new Set();
  container.innerHTML = fundTypes.map(ft => {
    const items = S.private.filter(p => {
      const key = p.fundType || p.category || 'other';
      return key === ft.key;
    });
    if (!items.length) return '';

    const totalVal    = items.reduce((s, p) => s + (p.currentValue || 0), 0);
    const totalCalled = items.reduce((s, p) => s + (p.called || 0), 0);

    const rows = items.map(p => {
      const called        = p.called || 0;
      const commitment    = p.commitment || 0;
      const distributions = p.distributions || 0;
      const currentValue  = p.currentValue || 0;
      const uncalled      = Math.max(commitment - called, 0);
      const moic          = called > 0 ? ((currentValue + distributions) / called).toFixed(2) + 'x' : '—';
      const updated       = p.updatedAt ? fmtRelative(p.updatedAt) : '';

      // Check if this is an old-format item (no commitment fields)
      const isOldFormat = !p.commitment && !p.called && !p.fundType;

      if (isOldFormat) {
        const pl    = p.costBasis ? currentValue - p.costBasis : null;
        const plPct = p.costBasis ? (pl / p.costBasis) * 100 : null;
        return `<tr>
          <td>
            <strong>${p.name}</strong>
            ${p.notes ? `<br><span style="color:var(--muted);font-size:11px">${p.notes}</span>` : ''}
          </td>
          <td colspan="3" style="color:var(--muted);font-size:12px">Legacy entry — re-add to use fund model</td>
          <td>${fmt(currentValue)}</td>
          <td>${pl != null
            ? `<span class="${pl >= 0 ? 'pos' : 'neg'}">${fmt(pl)} <small>(${fmtPct(plPct)})</small></span>`
            : '—'
          }</td>
          <td style="color:var(--muted);font-size:11px">${updated}</td>
          <td>
            <button class="icon-btn" onclick="editPrivate('${p.id}')" title="Edit">✏</button>
            <button class="icon-btn" onclick="delPrivate('${p.id}')"  title="Delete">✕</button>
          </td>
        </tr>`;
      }

      return `<tr>
        <td>
          <strong>${p.name}</strong>
          ${p.manager ? `<br><span style="color:var(--muted);font-size:11px">${p.manager}</span>` : ''}
        </td>
        <td>${commitment > 0 ? fmt(commitment) : '—'}</td>
        <td>${called > 0 ? fmt(called) : '—'}</td>
        <td>${commitment > 0 ? fmt(uncalled) : '—'}</td>
        <td>${distributions > 0 ? fmt(distributions) : '$0'}</td>
        <td><strong>${fmt(currentValue)}</strong></td>
        <td>${moic}</td>
        <td style="color:var(--muted);font-size:11px">${updated}</td>
        <td>
          <button class="icon-btn" onclick="editPrivate('${p.id}')" title="Edit">✏</button>
          <button class="icon-btn" onclick="delPrivate('${p.id}')"  title="Delete">✕</button>
        </td>
      </tr>`;
    }).join('');

    return `<div class="card priv-group">
      <div class="priv-group-head">
        <h3><span class="badge ${ft.badge}">${ft.label}</span></h3>
        <span class="priv-group-total">${fmt(totalVal)}</span>
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Fund</th>
              <th>Commitment</th>
              <th>Called</th>
              <th>Uncalled</th>
              <th>Distributions</th>
              <th>Current Value</th>
              <th>MOIC</th>
              <th>Updated</th>
              <th></th>
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
    const first  = snaps[0];
    const last   = snaps[snaps.length - 1];
    const growth = last.totalNetWorth - first.totalNetWorth;
    const pct    = (growth / first.totalNetWorth) * 100;

    const gEl = document.getElementById('stat-growth');
    gEl.textContent = fmt(growth);
    gEl.className   = 'stat-value ' + (growth >= 0 ? 'pos' : 'neg');

    const pEl = document.getElementById('stat-pct');
    pEl.textContent = fmtPct(pct);
    pEl.className   = 'stat-value ' + (pct >= 0 ? 'pos' : 'neg');

    set('stat-first',  fmt(first.totalNetWorth));
    set('stat-latest', fmt(last.totalNetWorth));
  }

  drawHistoryChart('history-chart', 240);

  const tbody = document.getElementById('snapshots-tbody');
  if (!snaps.length) {
    tbody.innerHTML = `<tr class="empty"><td colspan="8">No snapshots yet — click "Save Snapshot" to record your current net worth.</td></tr>`;
    return;
  }

  const reversed = [...snaps].reverse();
  tbody.innerHTML = reversed.map((snap, i) => {
    const prev   = reversed[i + 1];
    const change = prev ? snap.totalNetWorth - prev.totalNetWorth : null;
    const label  = fmtDate(snap.date);

    return `<tr>
      <td>${label}</td>
      <td><strong>${fmt(snap.totalNetWorth)}</strong></td>
      <td>${fmt(snap.breakdown?.stocks)}</td>
      <td>${fmt(snap.breakdown?.crypto)}</td>
      <td>${fmt(snap.breakdown?.privateFunds)}</td>
      <td>${snap.breakdown?.marginDebt ? `<span class="neg">${fmt(snap.breakdown.marginDebt)}</span>` : '$0'}</td>
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
  const theme = getChartTheme();
  const ctx   = canvas.getContext('2d');

  if (snaps.length < 2) {
    charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [{ data: [] }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
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
        backgroundColor: 'rgba(59,130,246,0.12)',
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
          backgroundColor: theme.tooltip,
          titleColor: theme.tooltipText,
          bodyColor: theme.tooltipText,
          borderColor: theme.grid,
          borderWidth: 1,
          callbacks: { label: ctx => ` ${fmt(ctx.raw)}` }
        }
      },
      scales: {
        y: {
          ticks: { callback: v => fmt(v), font: { size: 11 }, color: theme.tick },
          grid:  { color: theme.grid },
        },
        x: {
          ticks: { font: { size: 11 }, color: theme.tick },
          grid:  { display: false },
        }
      }
    }
  });
}

// ============================================================
// RENDER — REALIZED GAINS
// ============================================================
function renderRealized() {
  const netPL   = realizedNetPL();
  const gains   = realizedGains();
  const losses  = realizedLosses();

  const netEl = document.getElementById('real-net-pl');
  if (netEl) {
    netEl.textContent = fmt(netPL);
    netEl.className   = 'stat-value ' + (netPL >= 0 ? 'pos' : 'neg');
  }
  set('real-gains',  `<span class="pos">${fmt(gains)}</span>`);
  set('real-losses', `<span class="neg">${fmt(losses)}</span>`);
  set('real-count',  S.trades.length);

  const tbody = document.getElementById('trades-tbody');
  if (!S.trades.length) {
    tbody.innerHTML = `<tr class="empty"><td colspan="10">No realized trades yet — use the $ button on any holding to record a sale.</td></tr>`;
    return;
  }

  const sorted = [...S.trades].sort((a, b) => new Date(b.date) - new Date(a.date));
  tbody.innerHTML = sorted.map(t => {
    const typeBadge = t.type === 'stock' ? 'badge-hold' : t.type === 'option' ? 'badge-call' : 'badge-other';
    const typeLabel = t.type === 'stock' ? 'Stock' : t.type === 'option' ? 'Option' : 'Crypto';
    const qty = t.type === 'stock'  ? `${t.shares} sh`
              : t.type === 'option' ? `${t.contracts} ct`
              : `${t.amount}`;
    return `<tr>
      <td>${fmtDate(t.date)}</td>
      <td><strong>${t.name}</strong></td>
      <td><span class="badge ${typeBadge}">${typeLabel}</span></td>
      <td>${qty}</td>
      <td>${t.costBasis  != null ? fmtP(t.costBasis)  : '—'}</td>
      <td>${t.salePrice != null ? fmtP(t.salePrice) : '—'}</td>
      <td><span class="${t.pl >= 0 ? 'pos' : 'neg'}">${fmt(t.pl)}</span></td>
      <td>—</td>
      <td>${t.notes ? `<span style="color:var(--muted);font-size:12px">${t.notes}</span>` : ''}</td>
      <td><button class="icon-btn" onclick="delTrade('${t.id}')" title="Delete">✕</button></td>
    </tr>`;
  }).join('');
}

// ============================================================
// SNAPSHOT
// ============================================================
function takeSnapshot() {
  const snap = {
    id:            uid(),
    date:          new Date().toISOString(),
    totalNetWorth: totalNetWorth(),
    breakdown: {
      stocks:       stocksTotal(),
      crypto:       cryptoTotal(),
      privateFunds: privateTotal(),
      marginDebt:   totalMarginDebt(),
    }
  };
  S.snapshots.push(snap);
  save();
  renderAll();
  autoBackup();
  toast('Snapshot saved!', 'success');
}

// ============================================================
// CRUD — STOCKS
// ============================================================
function editStock(id) {
  const s = S.stocks.find(s => s.id === id);
  if (!s) return;
  populateAccountSelect();
  el('s-ticker').value     = s.ticker;
  el('s-shares').value     = s.shares;
  el('s-type').value       = s.type;
  el('s-cost').value       = s.costBasis || '';
  el('s-notes').value      = s.notes || '';
  el('s-editing-id').value = id;
  // Resolve accountId — if old stock has only broker, try to find matching account
  if (s.accountId) {
    el('s-account').value = s.accountId;
  } else {
    const match = S.accounts.find(a => a.broker === s.broker);
    el('s-account').value = match ? match.id : '';
  }
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
  el('c-coinid').value      = c.coinId;
  el('c-name').value        = c.name;
  el('c-amount').value      = c.amount;
  el('c-cost').value        = c.costBasis || '';
  el('c-notes').value       = c.notes || '';
  el('c-editing-id').value  = id;
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
  el('p-name').value          = p.name;
  el('p-manager').value       = p.manager || '';
  el('p-fund-type').value     = p.fundType || p.category || 'real-estate-fund';
  el('p-commitment').value    = p.commitment || '';
  el('p-called').value        = p.called || '';
  el('p-distributions').value = p.distributions || '';
  el('p-value').value         = p.currentValue || '';
  el('p-notes').value         = p.notes || '';
  el('p-editing-id').value    = id;
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
// CRUD — OPTIONS
// ============================================================
function editOption(id) {
  const o = S.options.find(o => o.id === id);
  if (!o) return;
  populateOptionAccountSelect();
  el('o-ticker').value     = o.underlying;
  el('o-position').value   = o.position || 'long';
  el('o-type').value       = o.optionType;
  el('o-strike').value     = o.strike;
  el('o-expiration').value = o.expiration;
  el('o-contracts').value  = o.contracts;
  el('o-premium').value    = o.premium;
  el('o-notes').value      = o.notes || '';
  el('o-editing-id').value = id;
  if (o.accountId) {
    el('o-account').value = o.accountId;
  } else {
    const match = S.accounts.find(a => a.broker === o.broker);
    el('o-account').value = match ? match.id : '';
  }
  document.getElementById('option-form-title').textContent = 'Edit Option';
  showForm('option-form');
}

function delOption(id) {
  if (!confirm('Delete this option?')) return;
  S.options = S.options.filter(o => o.id !== id);
  delete S.optionPrices[id];
  save(); renderAll();
  toast('Option removed.');
}

// ============================================================
// CRUD — ACCOUNTS
// ============================================================
function editAccount(id) {
  const a = S.accounts.find(a => a.id === id);
  if (!a) return;
  el('a-broker').value     = a.broker;
  el('a-label').value      = a.label || '';
  el('a-deposited').value  = a.deposited || '';
  el('a-margin').value     = a.cash !== undefined ? a.cash : (a.marginDebt ? -a.marginDebt : '');
  el('a-notes').value      = a.notes || '';
  el('a-editing-id').value = id;
  document.getElementById('account-form-title').textContent = 'Edit Account';
  showForm('account-form');
}

function delAccount(id) {
  if (!confirm('Delete this account?')) return;
  S.accounts = S.accounts.filter(a => a.id !== id);
  save(); renderAll();
  toast('Account removed.');
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
// SELL — STOCKS
// ============================================================
function openSellStock(id) {
  const s = S.stocks.find(s => s.id === id);
  if (!s) return;
  el('ss-stock-id').value = id;
  el('ss-shares').value   = '';
  el('ss-price').value    = S.prices[s.ticker] ? S.prices[s.ticker].toFixed(2) : '';
  el('ss-date').value     = new Date().toISOString().slice(0, 10);
  el('ss-notes').value    = '';
  set('sell-stock-label', `Sell <strong>${s.ticker}</strong>`);
  set('sell-max-shares',  `Max: ${s.shares} shares`);
  el('ss-pl-preview').textContent = '—';
  el('ss-pl-preview').className   = '';
  showForm('sell-stock-form');
}

function updateSellStockPreview() {
  const id     = el('ss-stock-id').value;
  const s      = S.stocks.find(s => s.id === id);
  const shares = parseFloat(el('ss-shares').value);
  const price  = parseFloat(el('ss-price').value);
  if (!s || isNaN(shares) || isNaN(price) || !s.costBasis) { el('ss-pl-preview').textContent = '—'; return; }
  const pl = (price - s.costBasis) * shares;
  const span = el('ss-pl-preview');
  span.textContent = fmt(pl);
  span.className   = pl >= 0 ? 'pos' : 'neg';
}

function recordSale() {
  const id       = el('ss-stock-id').value;
  const s        = S.stocks.find(s => s.id === id);
  if (!s) return;
  const shares   = parseFloat(el('ss-shares').value);
  const price    = parseFloat(el('ss-price').value);
  const date     = el('ss-date').value;
  const notes    = el('ss-notes').value.trim();

  if (isNaN(shares) || shares <= 0 || shares > s.shares) {
    toast('Enter a valid share count (max ' + s.shares + ').', 'error'); return;
  }
  if (isNaN(price) || price <= 0) { toast('Enter a valid sale price.', 'error'); return; }
  if (!date) { toast('Enter a sale date.', 'error'); return; }

  const pl = s.costBasis ? (price - s.costBasis) * shares : 0;

  S.trades.push({
    id: uid(), type: 'stock', name: s.ticker,
    shares, salePrice: price, costBasis: s.costBasis || null,
    pl, date, notes, closedAt: new Date().toISOString()
  });

  if (shares >= s.shares) {
    S.stocks = S.stocks.filter(x => x.id !== id);
  } else {
    const i = S.stocks.findIndex(x => x.id === id);
    S.stocks[i] = { ...S.stocks[i], shares: Math.round((s.shares - shares) * 1e8) / 1e8 };
  }

  save(); renderAll();
  hideForm('sell-stock-form');
  toast(`Sale recorded — ${fmt(pl)} P/L`, pl >= 0 ? 'success' : 'info');
}

// ============================================================
// CLOSE — OPTIONS
// ============================================================
function openCloseOption(id) {
  const o = S.options.find(o => o.id === id);
  if (!o) return;
  el('co-option-id').value  = id;
  el('co-contracts').value  = o.contracts || 1;
  el('co-price').value      = '';
  el('co-outcome').value    = 'sold';
  el('co-date').value       = new Date().toISOString().slice(0, 10);
  el('co-notes').value      = '';
  const expLabel = new Date(o.expiration + 'T00:00:00')
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  set('close-option-label', `Close <strong>${o.underlying} ${o.strike}${o.optionType[0].toUpperCase()} ${expLabel}</strong>`);
  set('close-max-contracts', `${o.contracts || 1} contracts`);
  el('co-pl-preview').textContent = '—';
  el('co-pl-preview').className   = '';
  showForm('close-option-form');
}

function updateCloseOptionPreview() {
  const id         = el('co-option-id').value;
  const o          = S.options.find(o => o.id === id);
  const contracts  = parseInt(el('co-contracts').value) || 0;
  const closePrice = parseFloat(el('co-price').value);
  const outcome    = el('co-outcome').value;
  const span       = el('co-pl-preview');
  if (!o || contracts <= 0) { span.textContent = '—'; span.className = ''; return; }
  const premium = o.premium || 0;
  const pl = outcome === 'expired'
    ? -(premium * contracts * 100)
    : (!isNaN(closePrice) ? (closePrice - premium) * contracts * 100 : null);
  if (pl === null) { span.textContent = '—'; span.className = ''; return; }
  span.textContent = fmt(pl);
  span.className   = pl >= 0 ? 'pos' : 'neg';
}

function recordOptionClose() {
  const id        = el('co-option-id').value;
  const o         = S.options.find(o => o.id === id);
  if (!o) return;
  const contracts  = parseInt(el('co-contracts').value);
  const closePrice = parseFloat(el('co-price').value);
  const outcome    = el('co-outcome').value;
  const date       = el('co-date').value;
  const notes      = el('co-notes').value.trim();

  if (isNaN(contracts) || contracts <= 0 || contracts > (o.contracts || 1)) {
    toast('Invalid contract count.', 'error'); return;
  }
  if (outcome !== 'expired' && (isNaN(closePrice) || closePrice < 0)) {
    toast('Enter a close price.', 'error'); return;
  }
  if (!date) { toast('Enter a date.', 'error'); return; }

  const premium = o.premium || 0;
  const isShort = o.position === 'short';
  const premiumTotal = premium * contracts * 100;
  const pl = outcome === 'expired'
    ? (isShort ? premiumTotal : -premiumTotal)           // short keeps premium, long loses it
    : (isShort ? premiumTotal - closePrice * contracts * 100   // short: received - buyback cost
               : (closePrice - premium) * contracts * 100);    // long: proceeds - cost

  const expLabel = new Date(o.expiration + 'T00:00:00')
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

  S.trades.push({
    id: uid(), type: 'option',
    name: `${o.underlying} $${o.strike}${o.optionType[0].toUpperCase()} ${expLabel}`,
    contracts, salePrice: outcome === 'expired' ? 0 : closePrice,
    costBasis: premium, pl, date, notes,
    closedAt: new Date().toISOString()
  });

  S.options = S.options.filter(x => x.id !== id);
  delete S.optionPrices[id];

  save(); renderAll();
  hideForm('close-option-form');
  toast(`Option closed — ${fmt(pl)} P/L`, pl >= 0 ? 'success' : 'info');
}

// ============================================================
// SELL — CRYPTO
// ============================================================
function openSellCrypto(id) {
  const c = S.crypto.find(c => c.id === id);
  if (!c) return;
  el('sc-crypto-id').value = id;
  el('sc-amount').value    = '';
  el('sc-price').value     = S.cryptoPrices[c.coinId] ? S.cryptoPrices[c.coinId].toFixed(2) : '';
  el('sc-date').value      = new Date().toISOString().slice(0, 10);
  el('sc-notes').value     = '';
  set('sell-crypto-label', `Sell <strong>${c.name}</strong>`);
  set('sell-crypto-max',   `Max: ${c.amount}`);
  el('sc-pl-preview').textContent = '—';
  el('sc-pl-preview').className   = '';
  showForm('sell-crypto-form');
}

function updateSellCryptoPreview() {
  const id     = el('sc-crypto-id').value;
  const c      = S.crypto.find(c => c.id === id);
  const amount = parseFloat(el('sc-amount').value);
  const price  = parseFloat(el('sc-price').value);
  const span   = el('sc-pl-preview');
  if (!c || isNaN(amount) || isNaN(price) || !c.costBasis) { span.textContent = '—'; span.className = ''; return; }
  const pl = (price - c.costBasis) * amount;
  span.textContent = fmt(pl);
  span.className   = pl >= 0 ? 'pos' : 'neg';
}

function recordCryptoSale() {
  const id     = el('sc-crypto-id').value;
  const c      = S.crypto.find(c => c.id === id);
  if (!c) return;
  const amount = parseFloat(el('sc-amount').value);
  const price  = parseFloat(el('sc-price').value);
  const date   = el('sc-date').value;
  const notes  = el('sc-notes').value.trim();

  if (isNaN(amount) || amount <= 0 || amount > c.amount) {
    toast('Enter a valid amount (max ' + c.amount + ').', 'error'); return;
  }
  if (isNaN(price) || price <= 0) { toast('Enter a valid sale price.', 'error'); return; }
  if (!date) { toast('Enter a sale date.', 'error'); return; }

  const pl = c.costBasis ? (price - c.costBasis) * amount : 0;

  S.trades.push({
    id: uid(), type: 'crypto', name: c.name,
    amount, salePrice: price, costBasis: c.costBasis || null,
    pl, date, notes, closedAt: new Date().toISOString()
  });

  if (amount >= c.amount) {
    S.crypto = S.crypto.filter(x => x.id !== id);
  } else {
    const i = S.crypto.findIndex(x => x.id === id);
    S.crypto[i] = { ...S.crypto[i], amount: Math.round((c.amount - amount) * 1e8) / 1e8 };
  }

  save(); renderAll();
  hideForm('sell-crypto-form');
  toast(`Sale recorded — ${fmt(pl)} P/L`, pl >= 0 ? 'success' : 'info');
}

// ============================================================
// DELETE TRADE
// ============================================================
function delTrade(id) {
  if (!confirm('Delete this trade record?')) return;
  S.trades = S.trades.filter(t => t.id !== id);
  save(); renderAll();
  toast('Trade record deleted.');
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
  el('s-type').value = 'long-hold';
  populateAccountSelect();
  document.getElementById('stock-form-title').textContent = 'Add Stock';
}

function clearCryptoForm() {
  ['c-coinid','c-name','c-amount','c-cost','c-notes','c-editing-id'].forEach(id => el(id).value = '');
  document.getElementById('crypto-form-title').textContent = 'Add Crypto';
}

function clearPrivateForm() {
  ['p-name','p-manager','p-commitment','p-called','p-distributions','p-value','p-notes','p-editing-id']
    .forEach(id => el(id).value = '');
  el('p-fund-type').value = 'real-estate-fund';
  document.getElementById('private-form-title').textContent = 'Add Fund Investment';
}

function clearAccountForm() {
  ['a-label','a-deposited','a-margin','a-notes','a-editing-id'].forEach(id => el(id).value = '');
  el('a-broker').value = 'Robinhood';
  document.getElementById('account-form-title').textContent = 'Add Account';
}

function populateOptionAccountSelect() {
  const sel = el('o-account');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = S.accounts.length
    ? S.accounts.map(a => `<option value="${a.id}">${a.label || a.broker}</option>`).join('')
    : '<option value="">— add accounts first —</option>';
  if (current && sel.querySelector(`option[value="${current}"]`)) sel.value = current;
}

function clearOptionForm() {
  ['o-ticker','o-strike','o-expiration','o-contracts','o-premium','o-notes','o-editing-id']
    .forEach(id => el(id).value = '');
  el('o-position').value = 'long';
  el('o-type').value     = 'call';
  populateOptionAccountSelect();
  document.getElementById('option-form-title').textContent = 'Add Option';
}

function clearSellStockForm() {
  ['ss-stock-id','ss-shares','ss-price','ss-date','ss-notes'].forEach(id => el(id).value = '');
  el('ss-pl-preview').textContent = '—';
  el('ss-pl-preview').className   = '';
}

function clearCloseOptionForm() {
  ['co-option-id','co-contracts','co-price','co-date','co-notes'].forEach(id => el(id).value = '');
  el('co-outcome').value          = 'sold';
  el('co-pl-preview').textContent = '—';
  el('co-pl-preview').className   = '';
}

function clearSellCryptoForm() {
  ['sc-crypto-id','sc-amount','sc-price','sc-date','sc-notes'].forEach(id => el(id).value = '');
  el('sc-pl-preview').textContent = '—';
  el('sc-pl-preview').className   = '';
}

// ============================================================
// UTILITIES
// ============================================================
function el(id)       { return document.getElementById(id); }
function set(id, html) { document.getElementById(id).innerHTML = html; }

function toast(msg, type = 'info') {
  const t   = document.getElementById('toast');
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
// AUTO BACKUP
// ============================================================
function autoBackup() {
  try {
    const data = {
      stocks: S.stocks, crypto: S.crypto, private: S.private,
      accounts: S.accounts, options: S.options, trades: S.trades,
      snapshots: S.snapshots, settings: S.settings,
      prices: S.prices, cryptoPrices: S.cryptoPrices,
      backedUpAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `nwt-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { /* silent */ }
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
  el('refresh-options-btn').addEventListener('click', refreshOptions);
  el('snapshot-btn').addEventListener('click', takeSnapshot);
  el('history-snapshot-btn').addEventListener('click', takeSnapshot);

  // Dark mode toggle
  el('dark-mode-toggle').checked = S.settings.darkMode !== false;
  el('dark-mode-toggle').addEventListener('change', e => {
    S.settings.darkMode = e.target.checked;
    applyTheme(S.settings.darkMode);
    save();
    // Redraw charts with new theme colors
    renderDashboard();
    renderHistory();
  });

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
    const ticker    = el('s-ticker').value.trim().toUpperCase();
    const shares    = parseFloat(el('s-shares').value);
    const accountId = el('s-account').value;
    const type      = el('s-type').value;
    const costBasis = parseFloat(el('s-cost').value) || null;
    const notes     = el('s-notes').value.trim();
    const editId    = el('s-editing-id').value;

    if (!ticker || isNaN(shares) || shares <= 0) {
      toast('Enter a valid ticker and share count.', 'error'); return;
    }
    if (!accountId) {
      toast('Select an account.', 'error'); return;
    }

    const acct   = S.accounts.find(a => a.id === accountId);
    const broker = acct ? acct.broker : 'Other';

    if (editId) {
      const i = S.stocks.findIndex(s => s.id === editId);
      if (i !== -1) S.stocks[i] = { ...S.stocks[i], ticker, shares, accountId, broker, type, costBasis, notes };
    } else {
      S.stocks.push({ id: uid(), ticker, shares, accountId, broker, type, costBasis, notes });
    }

    save(); renderAll();
    hideForm('stock-form'); clearStockForm();
    toast(editId ? 'Stock updated!' : 'Stock added!', 'success');

    if (!editId && S.settings.finnhubKey) {
      fetchStockPrice(ticker).then(p => {
        if (p !== null) { S.prices[ticker] = p; save(); renderAll(); }
      });
    }
  });

  // Stock type filters
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
    const coinId    = el('c-coinid').value.trim().toLowerCase();
    const name      = el('c-name').value.trim();
    const amount    = parseFloat(el('c-amount').value);
    const costBasis = parseFloat(el('c-cost').value) || null;
    const notes     = el('c-notes').value.trim();
    const editId    = el('c-editing-id').value;

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
    const name          = el('p-name').value.trim();
    const manager       = el('p-manager').value.trim();
    const fundType      = el('p-fund-type').value;
    const commitment    = parseFloat(el('p-commitment').value) || 0;
    const called        = parseFloat(el('p-called').value) || 0;
    const distributions = parseFloat(el('p-distributions').value) || 0;
    const currentValue  = parseFloat(el('p-value').value);
    const notes         = el('p-notes').value.trim();
    const editId        = el('p-editing-id').value;

    if (!name || isNaN(currentValue) || currentValue < 0) {
      toast('Enter a fund name and current value.', 'error'); return;
    }

    const record = {
      name, manager, fundType, commitment, called, distributions,
      currentValue, notes, updatedAt: new Date().toISOString()
    };

    if (editId) {
      const i = S.private.findIndex(p => p.id === editId);
      if (i !== -1) S.private[i] = { ...S.private[i], ...record };
    } else {
      S.private.push({ id: uid(), ...record });
    }

    save(); renderAll();
    hideForm('private-form'); clearPrivateForm();
    toast(editId ? 'Investment updated!' : 'Investment added!', 'success');
  });

  // ---- OPTIONS ----
  el('add-option-toggle').addEventListener('click', () => {
    const f = el('option-form');
    if (f.style.display === 'none' || !f.style.display) {
      clearOptionForm(); populateOptionAccountSelect(); showForm('option-form');
    } else {
      hideForm('option-form');
    }
  });

  el('cancel-option-btn').addEventListener('click', () => {
    hideForm('option-form'); clearOptionForm();
  });

  el('save-option-btn').addEventListener('click', () => {
    const underlying  = el('o-ticker').value.trim().toUpperCase();
    const position    = el('o-position').value;
    const optionType  = el('o-type').value;
    const strike      = parseFloat(el('o-strike').value);
    const expiration  = el('o-expiration').value;
    const contracts   = parseInt(el('o-contracts').value) || 1;
    const premium     = parseFloat(el('o-premium').value);
    const accountId   = el('o-account').value;
    const notes       = el('o-notes').value.trim();
    const editId      = el('o-editing-id').value;

    if (!underlying || isNaN(strike) || !expiration || isNaN(premium)) {
      toast('Fill in all required fields.', 'error'); return;
    }
    if (!accountId) {
      toast('Select an account.', 'error'); return;
    }

    const oAcct  = S.accounts.find(a => a.id === accountId);
    const broker = oAcct ? oAcct.broker : 'Other';

    const record = { underlying, position, optionType, strike, expiration, contracts, premium, accountId, broker, notes };

    if (editId) {
      const i = S.options.findIndex(o => o.id === editId);
      if (i !== -1) S.options[i] = { ...S.options[i], ...record };
    } else {
      S.options.push({ id: uid(), ...record });
    }

    save(); renderAll();
    hideForm('option-form'); clearOptionForm();
    toast(editId ? 'Option updated!' : 'Option added!', 'success');
  });

  // ---- ACCOUNTS ----
  el('add-account-toggle').addEventListener('click', () => {
    const f = el('account-form');
    if (f.style.display === 'none' || !f.style.display) {
      clearAccountForm(); showForm('account-form');
    } else {
      hideForm('account-form');
    }
  });

  el('cancel-account-btn').addEventListener('click', () => {
    hideForm('account-form'); clearAccountForm();
  });

  el('save-account-btn').addEventListener('click', () => {
    const broker    = el('a-broker').value;
    const label     = el('a-label').value.trim();
    const deposited = parseFloat(el('a-deposited').value) || null;
    const cash      = parseFloat(el('a-margin').value) || 0;
    const notes     = el('a-notes').value.trim();
    const editId    = el('a-editing-id').value;

    const record = {
      broker, label, deposited, cash, notes,
      updatedAt: new Date().toISOString()
    };

    if (editId) {
      const i = S.accounts.findIndex(a => a.id === editId);
      if (i !== -1) S.accounts[i] = { ...S.accounts[i], ...record };
    } else {
      S.accounts.push({ id: uid(), ...record });
    }

    save(); renderAll();
    hideForm('account-form'); clearAccountForm();
    toast(editId ? 'Account updated!' : 'Account added!', 'success');
  });

  // ---- SELL STOCK FORM ----
  el('cancel-sell-btn').addEventListener('click', () => {
    hideForm('sell-stock-form'); clearSellStockForm();
  });
  el('confirm-sell-btn').addEventListener('click', recordSale);
  el('ss-shares').addEventListener('input', updateSellStockPreview);
  el('ss-price').addEventListener('input', updateSellStockPreview);

  // ---- CLOSE OPTION FORM ----
  el('cancel-close-btn').addEventListener('click', () => {
    hideForm('close-option-form'); clearCloseOptionForm();
  });
  el('confirm-close-btn').addEventListener('click', recordOptionClose);
  el('co-contracts').addEventListener('input', updateCloseOptionPreview);
  el('co-price').addEventListener('input', updateCloseOptionPreview);
  el('co-outcome').addEventListener('change', updateCloseOptionPreview);

  // ---- SELL CRYPTO FORM ----
  el('cancel-sell-crypto-btn').addEventListener('click', () => {
    hideForm('sell-crypto-form'); clearSellCryptoForm();
  });
  el('confirm-sell-crypto-btn').addEventListener('click', recordCryptoSale);
  el('sc-amount').addEventListener('input', updateSellCryptoPreview);
  el('sc-price').addEventListener('input', updateSellCryptoPreview);

  // ---- CRYPTO DEPOSIT EDIT ----
  el('edit-crypto-deposit-btn').addEventListener('click', () => {
    const depositEdit = el('crypto-deposit-edit');
    el('crypto-deposit-input').value = S.settings.cryptoDeposited || '';
    depositEdit.style.display = 'flex';
  });
  el('cancel-crypto-deposit-btn').addEventListener('click', () => {
    el('crypto-deposit-edit').style.display = 'none';
  });
  el('save-crypto-deposit-btn').addEventListener('click', () => {
    const val = parseFloat(el('crypto-deposit-input').value);
    S.settings.cryptoDeposited = isNaN(val) ? null : val;
    save(); renderCrypto();
    el('crypto-deposit-edit').style.display = 'none';
    toast('Crypto deposit saved!', 'success');
  });

  // ---- SETTINGS ----
  el('finnhub-key').value        = S.settings.finnhubKey    || '';
  el('tradier-key').value        = S.settings.tradierKey    || '';
  el('tradier-sandbox').checked  = S.settings.tradierSandbox !== false;
  el('marketdata-key').value     = S.settings.marketDataKey || '';

  el('save-settings-btn').addEventListener('click', () => {
    S.settings.finnhubKey     = el('finnhub-key').value.trim();
    S.settings.tradierKey     = el('tradier-key').value.trim();
    S.settings.tradierSandbox = el('tradier-sandbox').checked;
    S.settings.marketDataKey  = el('marketdata-key').value.trim();
    save();
    toast('Settings saved!', 'success');
  });

  el('export-btn').addEventListener('click', () => {

    const data = {
      stocks: S.stocks, crypto: S.crypto, private: S.private,
      accounts: S.accounts, snapshots: S.snapshots,
      prices: S.prices, cryptoPrices: S.cryptoPrices,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
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
        if (d.accounts)     S.accounts     = d.accounts;
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
  applyTheme(S.settings.darkMode !== false);
  init();
  renderAll();

  if (S.crypto.length) {
    const ids = [...new Set(S.crypto.map(c => c.coinId))];
    fetchCryptoPrices(ids).then(prices => {
      Object.assign(S.cryptoPrices, prices);
      save(); renderAll();
    });
  }
});
