import test from 'node:test';
import assert from 'node:assert/strict';

import { probeCockpitIntervalSupport } from '../src/lib/api.js';

test('probeCockpitIntervalSupport accepts a supported minute interval', async () => {
  const calls = [];
  const fetchers = {
    fetchOhlcv: async (exchangeId, minutes, interval) => {
      calls.push(['ohlcv', exchangeId, minutes, interval]);
      return { bars: [] };
    },
    fetchDex: async (minutes, interval) => {
      calls.push(['dex', minutes, interval]);
      return { bars: [] };
    },
    fetchBasis: async (windowSecs, interval) => {
      calls.push(['basis', windowSecs, interval]);
      return { aggregated: [] };
    },
    fetchOi: async (minutes, interval) => {
      calls.push(['oi', minutes, interval]);
      return { aggregated: [] };
    },
    fetchFunding: async (windowSecs, intervalSecs) => {
      calls.push(['funding', windowSecs, intervalSecs]);
      return { per_source: {} };
    },
    fetchReplayEvents: async (windowSecs, interval, limit) => {
      calls.push(['replay', windowSecs, interval, limit]);
      return { events: [] };
    }
  };

  const supported = await probeCockpitIntervalSupport('1m', {
    lookbackMinutes: 60 * 24 * 14,
    fundingIntervalSeconds: 60,
    replayLimit: 10
  }, fetchers);

  assert.equal(supported, true);
  assert.deepEqual(calls, [
    ['ohlcv', 'binance-spot', 360, '1m'],
    ['ohlcv', 'binance-perp', 360, '1m'],
    ['ohlcv', 'bybit-perp', 360, '1m'],
    ['dex', 360, '1m'],
    ['basis', 21600, '1m'],
    ['oi', 360, '1m'],
    ['funding', 21600, 60],
    ['replay', 21600, '1m', 3]
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

  const supported = await probeCockpitIntervalSupport('1m', {
    lookbackMinutes: 60 * 24 * 14,
    fundingIntervalSeconds: 60,
    replayLimit: 10
  }, fetchers);

  assert.equal(supported, false);
});
