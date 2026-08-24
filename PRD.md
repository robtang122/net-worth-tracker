# PRD: Net Worth Tracker

**Date:** 2026-03-24
**Status:** Draft

## Problem
Tracking total net worth is difficult when assets are spread across multiple brokerages, crypto, and private fund investments with no single source of truth. Without a unified view, it's hard to understand real equity per account (especially with margin), monitor allocation, or see how wealth has grown over time.

## Goal
A personal monthly check-in dashboard that shows total net worth across all asset types, real equity per brokerage account (accounting for margin debt), and wealth generated per holding — so allocation decisions can be made confidently in under 5 minutes.

## Users
Solely for personal use. Used roughly monthly to review net worth, check allocations, and log any changes from trades, new contributions, or private investment updates.

## Scope

### In scope
- **Stocks**: per-holding tracking with cost basis, current price (via Finnhub), P&L, and dividend display
- **Crypto**: per-holding tracking with cost basis and current price (via CoinGecko)
- **Per-broker account view**: cash deposited (optional), current portfolio value, margin debt — showing real equity per account
- **Private fund investments**: commitment, called capital, uncalled capital, distributions, and current value per fund
- **Dashboard**: total net worth, allocation breakdown, invested-vs-current-value visualization (wealth generated), last-updated timestamps
- **Dark mode**
- **History / snapshots**: save monthly snapshots to track net worth over time
- **Starting snapshot per account**: enter today's value as a baseline; growth tracked from that point forward
- **Account-level deposit tracking**: optional field (useful where clean data exists, e.g. Chase)

### Out of scope
- Spending / budget tracking (separate project)
- Direct real estate / property ownership tracking (future category — data model should not preclude it)
- Brokerage API integration (future state — manual entry for now; architecture should not block future SnapTrade/Plaid connection)
- Multi-user access

## Constraints
- Browser-based, localStorage for persistence (no backend for now)
- Finnhub free tier for stock prices (60 calls/min)
- CoinGecko free tier for crypto prices
- Manual data entry until API integration is added later
- Must handle margin accounts: net equity = portfolio value − margin debt (negative values unlikely but should not break the UI)

## Success Criteria
- Can open the dashboard monthly and see total net worth, per-account equity, and allocation in under 2 minutes
- Each holding shows cost basis vs. current value so wealth generated is immediately visible
- Private fund investments show commitment, called/uncalled, distributions, and current value per fund
- Every data point shows when it was last updated so stale data is immediately obvious
- Dark mode is available and default or toggleable

## Edge Cases & Risks
- **Stale data**: mitigated by prominent last-updated timestamps on all manually-entered values
- **E*TRADE → Robinhood stock transfer**: cost basis travels with shares — Robinhood holdings are source of truth; no need to reconcile E*TRADE deposit history
- **Dividends**: Finnhub can surface dividend data per holding, but cash balance impact in each account requires manual update until brokerage API is connected
- **Direct real estate (future)**: fund investment model (commitment/called/distributions) does not apply — will need separate category with purchase price, current value, and mortgage/debt fields
- **Margin going negative**: architecturally handle but treat as edge case; no special UI treatment needed

## Decisions Made
- **Dark mode**: on by default
- **Wealth generated**: shown at all three levels — per holding (in tables), per account (on account cards), and aggregate total (on dashboard header)
- **Dividends**: Finnhub dividend data displayed per holding; prompts user to update account cash balance when a dividend is detected

---

# PRD: Cash Ledger & Automatic Transaction Flows (Phase 1)

**Date:** 2026-04-13
**Status:** Draft

## Problem
Every time a transaction occurs — selling a stock, collecting option premium, closing a position — the account cash balance must be updated manually. This creates friction and introduces errors, making the dashboard unreliable as a source of truth for cash and net worth.

## Goal
Replace manually-edited cash balances with a per-account transaction ledger so that cash is always accurate without manual adjustment. Every event that moves cash writes a line to the ledger automatically.

## Users
Personal use. Relevant whenever a trade is recorded — selling stocks, opening/closing short options (wheel strategy).

## Scope

### In scope
- **Opening balance migration**: existing cash values per account become a dated "Opening Balance" ledger entry; user can edit the date for accuracy
- **Sell stock → cash in**: when a stock sale is recorded, proceeds (shares × sale price) automatically post a credit to the associated account's ledger
- **Open short option → cash in**: when a short option is added, the premium received (premium × contracts × 100) immediately posts a credit to the associated account's ledger
- **Close option (buy back) → cash out**: when a short option is closed/bought back, the cost posts a debit to the ledger
- **Option expires worthless**: no cash change (premium already received); closing the position just removes the liability — no new ledger entry
- **Cash balance = sum of ledger**: account cash is computed from the ledger, no longer a manually editable number
- **Ledger view per account**: visible list of all transactions that have moved cash — date, type, description, amount, running balance

### Out of scope
- **Phase 2 — deposits and withdrawals**: manually logging transfers into/out of accounts (planned follow-on)
- **Assignment auto-creating stock positions**: if a short put gets assigned, user manually adds the stock; no automation
- **Options profit tab**: separate PRD — a dedicated tab for tracking wheel strategy P&L over time
- **Retroactive transactions**: existing recorded stock sales and closed options will NOT retroactively generate ledger entries — only new events going forward (confirmed)
- **Editable ledger**: user can manually add, edit, or delete entries for corrections; auto-generated entries are visually distinguished from manual ones
- **Long option purchases**: open long → cash debit (premium paid); close long (sell to close) → cash credit (proceeds received)

## Constraints
- localStorage only — no backend
- Ledger entries must be per-account (keyed to account ID)
- Must gracefully handle accounts with no prior cash value (opening balance = $0)
- Existing stock/option data must not be broken by the migration

## Success Criteria
- After selling a stock, account cash updates automatically — no manual edit required
- After adding a short option, account cash increases by the premium without any additional step
- After closing/buying back an option, account cash decreases by the cost without any additional step
- Each account has a viewable ledger showing every cash-moving event with date, description, and amount
- Existing cash balances are preserved as opening balance entries after migration

## Edge Cases & Risks
- **Accounts with no cash value**: opening balance entry = $0; harmless
- **User edits a stock sale after the fact**: if proceeds change, the ledger entry should update or be flagged
- **Duplicate entries**: if user accidentally records the same sale twice, ledger will double-count — no dedup logic in Phase 1, user must manually delete the duplicate ledger entry
- **Short option added before account exists**: should warn user to assign to an account, not silently drop the cash flow
- **Old stock/option records**: won't generate ledger entries retroactively — user should be informed of this clearly on first migration

## Open Questions
- When a short option is edited (e.g. contracts changed), should the ledger entry update automatically or require manual correction?

---

# PRD: Import System, Performance Analytics & Wheel Strategy Tab

**Date:** 2026-08-24
**Status:** Draft

## Problem
The dashboard has no way to ingest historical brokerage data, so reconstructing a complete financial picture from 2024 onward requires tedious manual entry. Without that history, performance analytics (short vs. long-term gains, options income, total return) and wheel strategy tracking (premium income, collateral utilization, win rate) are impossible to compute accurately.

## Goal
A complete picture of financial performance from 2024 onward — imported from Robinhood, Chase, and E*Trade via Claude/Cowork parsing — with a dedicated Performance tab breaking down returns by category and a Wheel Strategy tab tracking options income and collateral efficiency.

## Users
Personal use only. Used when reviewing monthly performance, evaluating the wheel strategy, and making allocation decisions. Crypto and private investments remain manually managed and are out of scope for import.

## Scope

### In scope

**1. Import System**
- Standardized NWT Import JSON schema (see below) that Claude/Cowork outputs after parsing brokerage documents
- Import button in the dashboard — shows a preview of what will be applied before confirming
- Deduplication by transaction ID so re-importing the same file doesn't double-count
- Supported transaction types: deposit, withdrawal, stock_buy, stock_sell, option_buy, option_sell, option_expire, option_assign, dividend, interest, fee, transfer_in, transfer_out
- Short vs. long-term classification on sells (hold period < 1 year = short-term)
- Strategy tagging on options transactions: `wheel` or `other`
- Balance checkpoints per account (for reconciliation — dashboard shows diff vs. imported balance)
- Cowork parsing targets: Robinhood CSV transaction history, Chase CSV/PDF statements, E*Trade 1099-B and transaction history
- Historical scope: 2024 and 2025 full reconstruction; 2026 ongoing

**2. Performance / Analytics Tab**
- Realized gains broken down by: short-term, long-term, options income (premium), dividends
- Breakdown by year: 2024, 2025, 2026
- Net deposited and net withdrawn per account and total across all accounts
- Total return: realized gains + current unrealized appreciation across stocks
- All figures driven by imported transaction history; crypto and private investments excluded

**3. Wheel Strategy Tab**
- Premium collected: total, by month, by underlying ticker
- Win rate: expired worthless vs. bought back vs. assigned (count + % breakdown)
- Collateral utilization: stock value deployed as covered call collateral, cash securing puts — as a % of available assets
- Return on collateral: annualized premium income / average collateral deployed
- Open wheel positions (active covered calls and cash-secured puts) with current P/L
- Historical closed positions with outcome and P/L

### Out of scope
- Crypto import (manual only)
- Private investment import (manual only)
- Real-time brokerage API connections (no Plaid/SnapTrade in this phase)
- Tax optimization suggestions
- Automatic Cowork → dashboard sync (user manually triggers import)
- Options strategies beyond the wheel (straddles, spreads, etc.)

## Import JSON Schema

```json
{
  "schemaVersion": "1.0",
  "source": "robinhood | chase | etrade | manual",
  "accountLabel": "Robinhood Main",
  "exportedAt": "2026-08-24",
  "dateRange": { "from": "2024-01-01", "to": "2025-12-31" },
  "transactions": [
    {
      "id": "unique-id-from-source",
      "date": "2024-03-15",
      "type": "stock_sell",
      "ticker": "AAPL",
      "description": "Sold 10 AAPL @ $185.50",
      "quantity": 10,
      "price": 185.50,
      "amount": 1855.00,
      "fees": 0,
      "strategy": "wheel | null",
      "holdingPeriodDays": 280,
      "termType": "short | long | null",
      "notes": ""
    }
  ],
  "positions": [
    {
      "ticker": "AAPL",
      "shares": 150,
      "avgCostBasis": 142.30,
      "asOfDate": "2025-12-31"
    }
  ],
  "balanceCheckpoints": [
    {
      "date": "2025-12-31",
      "cashBalance": 5234.50,
      "portfolioValue": 87432.00
    }
  ]
}
```

## Constraints
- Browser-only, localStorage persistence — no backend
- Import file size must be manageable in browser memory (single brokerage export at a time)
- Cowork is the parser — dashboard only consumes the standardized schema, never raw brokerage files
- Deduplication keyed on transaction `id` field — Cowork must generate stable, unique IDs per transaction
- Crypto and private investment data untouched by import

## Success Criteria
- Can import a Cowork-generated JSON and see it previewed before applying — no blind data changes
- Re-importing the same file produces no duplicates
- Performance tab shows 2024 and 2025 gains broken down by short-term, long-term, options income, and dividends
- Net deposited / withdrawn is accurate and reconciles against known brokerage statements
- Wheel Strategy tab shows monthly premium income, win rate, and collateral utilization for all historical and open positions
- Balance checkpoints in the import are compared against computed balances — discrepancies flagged visibly

## Edge Cases & Risks
- **Ambiguous transaction types**: Cowork must make a judgment call — dashboard accepts whatever type is in the schema, so bad tagging from Cowork flows through
- **Hold period unknown**: if cost basis date isn't in the export, short/long-term can't be computed — show as "unclassified" rather than guess
- **Partial imports**: if 2024 is imported but 2025 isn't yet, analytics should reflect only what's present without crashing
- **Assigned options**: assignment transactions must link to the resulting stock position to avoid double-counting the cost basis
- **Multiple imports from same brokerage**: dedup by ID prevents doubles, but if Cowork generates different IDs for the same transaction across runs, duplicates can sneak in — Cowork prompt must specify stable ID generation
- **Collateral utilization**: covered call collateral requires knowing which stock lots are "reserved" — approximated from open short call positions matching held tickers

## Open Questions
- Should imported positions overwrite existing manually-entered stocks, or merge alongside them?
- When a balance checkpoint shows a discrepancy, does the user resolve it manually or can the dashboard auto-adjust with a correction ledger entry?
- Should the Wheel Strategy tab be visible even before any wheel-tagged transactions are imported (empty state), or gated behind having data?
