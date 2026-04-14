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
