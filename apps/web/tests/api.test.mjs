import test from 'node:test';
import assert from 'node:assert/strict';

import { probeCockpitIntervalSupport } from '../src/lib/api.js';

test('probeCockpitIntervalSupport accepts a supported minute interval', async () => {
  const calls = [];
  const fetchers = {
    fetchOhlcv: async (projectId, exchangeId, minutes, interval) => {
      calls.push(['ohlcv', projectId, exchangeId, minutes, interval]);
      return { bars: [] };
    },
    fetchDex: async (projectId, minutes, interval) => {
      calls.push(['dex', projectId, minutes, interval]);
      return { bars: [] };
    },
    fetchBasis: async (projectId, windowSecs, interval) => {
      calls.push(['basis', projectId, windowSecs, interval]);
      return { aggregated: [] };
    },
    fetchOi: async (projectId, minutes, interval) => {
      calls.push(['oi', projectId, minutes, interval]);
      return { aggregated: [] };
    },
    fetchFunding: async (projectId, windowSecs, intervalSecs) => {
      calls.push(['funding', projectId, windowSecs, intervalSecs]);
      return { per_source: {} };
    },
    fetchReplayEvents: async (projectId, windowSecs, interval, limit) => {
      calls.push(['replay', projectId, windowSecs, interval, limit]);
      return { events: [] };
    }
  };

  const supported = await probeCockpitIntervalSupport('dexe', '1m', {
    lookbackMinutes: 60 * 24 * 14,
    fundingIntervalSeconds: 60,
    replayLimit: 10
  }, fetchers);

  assert.equal(supported, true);
  assert.deepEqual(calls, [
    ['ohlcv', 'dexe', 'binance-spot', 360, '1m'],
    ['ohlcv', 'dexe', 'binance-perp', 360, '1m'],
    ['ohlcv', 'dexe', 'bybit-perp', 360, '1m'],
    ['dex', 'dexe', 360, '1m'],
    ['basis', 'dexe', 21600, '1m'],
    ['oi', 'dexe', 360, '1m'],
    ['funding', 'dexe', 21600, 60],
    ['replay', 'dexe', 21600, '1m', 3]
  ]);
});

test('probeCockpitIntervalSupport hides the interval when any required feed rejects', async () => {
  const fetchers = {
    fetchOhlcv: async () => ({ bars: [] }),
    fetchDex: async () => ({ bars: [] }),
    fetchBasis: async () => ({ aggregated: [] }),
    fetchOi: async () => {
      throw new Error('unsupported interval');
    },
    fetchFunding: async () => ({ per_source: {} }),
    fetchReplayEvents: async () => ({ events: [] })
  };

  const supported = await probeCockpitIntervalSupport('bananas31', '1m', {
    lookbackMinutes: 60 * 24 * 14,
    fundingIntervalSeconds: 60,
    replayLimit: 10
  }, fetchers);

  assert.equal(supported, false);
});
