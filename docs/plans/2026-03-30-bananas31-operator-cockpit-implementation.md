# BANANAS31 Operator Cockpit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first working vertical slice of a clean BANANAS31 cockpit with proper history, synchronized charts, and replay-safe live updates.

**Architecture:** The repository is split into frontend, API, collectors, and shared contracts. The first iteration builds one thin vertical slice through all layers instead of attempting a full platform migration at once.

**Tech Stack:** React, TypeScript, Python, FastAPI, SQLite or Postgres-backed market storage, lightweight-charts, pnpm workspace.

---

### Task 1: Bootstrap the monorepo

**Files:**
- Create: `README.md`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `apps/web/README.md`
- Create: `services/api/README.md`
- Create: `services/collectors/README.md`
- Create: `packages/contracts/README.md`
- Create: `packages/ui/README.md`

**Step 1: Write the failing bootstrap check**

Create a script that fails when the required repo files are missing.

**Step 2: Run check to verify it fails**

Run: `node scripts/check-bootstrap.mjs`
Expected: fail until the required files are added

**Step 3: Add the minimal repository structure**

Create the files and directories listed above.

**Step 4: Run check to verify it passes**

Run: `node scripts/check-bootstrap.mjs`
Expected: `Bootstrap check passed.`

**Step 5: Commit**

```bash
git add .
git commit -m "chore: bootstrap bananas31 operator cockpit repo"
```

### Task 2: Define contracts for the first data slice

**Files:**
- Create: `packages/contracts/src/market.ts`
- Create: `packages/contracts/src/replay.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/*.test.ts`

**Step 1: Write failing contract tests**

Define the expected shape for OHLCV, funding, OI, and replay context payloads.

**Step 2: Run tests to verify they fail**

Run the targeted contract tests.

**Step 3: Implement minimal shared contracts**

Add the smallest contract layer that satisfies the tests.

**Step 4: Run tests to verify they pass**

Run the targeted contract tests again.

**Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat: add market and replay contracts"
```

### Task 3: Stand up a thin API slice

**Files:**
- Create: `services/api/app/main.py`
- Create: `services/api/app/routes/history.py`
- Create: `services/api/app/routes/replay.py`
- Test: `services/api/tests/test_history.py`
- Test: `services/api/tests/test_replay.py`

**Step 1: Write failing API tests**

Cover one history endpoint and one replay endpoint.

**Step 2: Run tests to verify they fail**

Run the specific API tests.

**Step 3: Implement minimal endpoints**

Serve deterministic fixture-backed responses matching the contracts.

**Step 4: Run tests to verify they pass**

Run the API tests again.

**Step 5: Commit**

```bash
git add services/api
git commit -m "feat: add initial history and replay api slice"
```

### Task 4: Build the first cockpit shell

**Files:**
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/features/cockpit/CockpitShell.tsx`
- Create: `apps/web/src/features/charts/PricePanel.tsx`
- Create: `apps/web/src/features/charts/BasisPanel.tsx`
- Test: `apps/web/src/**/*.test.tsx`

**Step 1: Write failing UI tests**

Cover the shell controls, synchronized timeframe state, and live/replay mode state.

**Step 2: Run tests to verify they fail**

Run the targeted frontend tests.

**Step 3: Implement the minimal shell**

Render the operator shell and wire it to fixture-backed API data.

**Step 4: Run tests to verify they pass**

Run the frontend tests again.

**Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add initial cockpit shell"
```

### Task 5: Add synchronization and replay protections

**Files:**
- Modify: `apps/web/src/features/charts/*`
- Modify: `apps/web/src/features/cockpit/*`
- Test: `apps/web/src/**/*.test.tsx`

**Step 1: Write failing tests**

Cover active-chart sync ownership and timeframe-safe live updates.

**Step 2: Run tests to verify they fail**

Run the targeted tests and confirm the sync bug is reproduced.

**Step 3: Implement the fix**

Make only the active chart drive synchronization and align live updates to the selected interval bucket.

**Step 4: Run tests to verify they pass**

Re-run the targeted tests and a small integration suite.

**Step 5: Commit**

```bash
git add apps/web
git commit -m "fix: enforce interval-safe chart synchronization"
```

