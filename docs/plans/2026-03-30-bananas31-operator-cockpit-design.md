# BANANAS31 Operator Cockpit Design

## Goal

Build a clean replacement for the current BANANAS31 dashboard that is operator-first, history-rich, and stable under replay and live market updates.

## Recommended Approach

Use a cleanly separated architecture:

- React/TypeScript frontend for the operator cockpit
- Python service layer for ingestion and analytics, because market backfill and derived metrics are already easier to express and validate in Python
- explicit contracts between services so the UI never couples itself to collector-specific quirks

This is the highest-leverage path because the current problems are architectural, not cosmetic. Missing history, broken synchronization, and fragile replay behavior all come from mixed responsibilities.

## Core Product Surfaces

### 1. Cockpit Shell

The shell owns presets, focus modes, timeframe, source visibility, and live versus replay mode. It does not compute market analytics itself.

### 2. Historical Data Plane

The data plane serves normalized OHLCV, funding, OI, trades, liquidations, and replay slices from one contract layer. Historical completeness is a first-class requirement.

### 3. Analytics Plane

Derived metrics such as basis, regime shifts, squeeze patterns, replay context, and operator summaries are computed server-side and returned as typed responses.

### 4. Release Model

The new product ships independently from the old dashboard. Preview surfaces stay isolated so no unrelated production domain is touched.

## Initial Tech Direction

- `apps/web`: React + TypeScript cockpit app
- `services/api`: FastAPI service exposing normalized analytics and replay endpoints
- `services/collectors`: Python workers and one-off backfill entry points
- `packages/contracts`: JSON-schema or OpenAPI-adjacent request and response definitions
- `packages/ui`: chart panels, shell primitives, rail/detail UI, and operator layout components

## Success Criteria

- 30-day historical OHLCV, funding, and OI render coherently across synchronized charts
- live updates respect the active timeframe instead of silently degrading it
- replay mode can lock charts to an event window without corrupting live state
- the repository structure supports independent iteration on UI, API, and collectors

