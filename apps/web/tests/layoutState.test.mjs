import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LAYOUT_STATE,
  readStoredLayoutState,
  rebalancePairWeights,
  writeStoredLayoutState
} from '../src/lib/layoutState.js';

function makeStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

test('readStoredLayoutState returns sane defaults', () => {
  const state = readStoredLayoutState(makeStorage());
  assert.deepEqual(state, DEFAULT_LAYOUT_STATE);
});

test('writeStoredLayoutState normalizes and persists layout values', () => {
  const storage = makeStorage();
  writeStoredLayoutState(storage, {
    heroHeight: 1200,
    analyticsWeights: { basis: 10, oi: 10, funding: 20 },
    supportWeights: { replay: 4, coverage: 2, reading: 2 },
    panels: { basis: false, oi: true, funding: true, replay: true, coverage: false, reading: true },
    oiSeries: { agg: true, binance: false, bybit: true }
  });

  const state = readStoredLayoutState(storage);
  assert.equal(state.heroHeight, 960);
  assert.equal(state.panels.basis, false);
  assert.equal(state.panels.coverage, false);
  assert.equal(state.oiSeries.binance, false);
  assert.equal(state.oiSeries.bybit, true);
  assert.equal(Math.round(state.analyticsWeights.funding * 100), 50);
  assert.equal(Math.round(state.supportWeights.replay * 100), 50);
});

test('rebalancePairWeights redistributes only the requested pair', () => {
  const weights = rebalancePairWeights({ basis: 0.3, oi: 0.4, funding: 0.3 }, 'oi', 'funding', 0.75);
  assert.equal(Number(weights.basis.toFixed(2)), 0.3);
  assert.equal(Number(weights.oi.toFixed(2)), 0.52);
  assert.equal(Number(weights.funding.toFixed(2)), 0.17);
});
