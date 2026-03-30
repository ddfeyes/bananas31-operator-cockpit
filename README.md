# BANANAS31 Operator Cockpit

Clean-room rebuild of the BANANAS31 operator dashboard.

This repository is the replacement path for the current dashboard stack. The goal is to stop layering fixes on top of a tightly coupled prototype and instead build a product with clear boundaries between ingestion, historical storage, analytics, and the operator UI.

## Product Direction

- Full historical market context instead of short-tail charts
- Replay-first operator workflow with event context and linked views
- Stable data contracts for OHLCV, funding, OI, trades, liquidations, and derived analytics
- Clean separation between UI, API, and collectors
- Safe preview and release flow without touching unrelated production surfaces

## Planned Repository Layout

- `apps/web` — operator cockpit frontend
- `services/api` — analytics and replay API
- `services/collectors` — market data ingestion and backfill workers
- `packages/contracts` — shared schemas and API contracts
- `packages/ui` — shared presentational primitives for the cockpit
- `docs/plans` — design and implementation plans

## First Build Scope

The first milestone is not a full migration of the old system. It is a clean baseline that proves:

1. historical OHLCV, funding, and OI can be served through consistent contracts
2. the cockpit can render synchronized charts from that history
3. replay and live mode can coexist without breaking timeframe integrity

## Planning Docs

- `docs/plans/2026-03-30-bananas31-operator-cockpit-design.md`
- `docs/plans/2026-03-30-bananas31-operator-cockpit-implementation.md`

