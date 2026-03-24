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
