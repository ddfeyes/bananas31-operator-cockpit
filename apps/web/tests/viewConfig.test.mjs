import test from 'node:test';
import assert from 'node:assert/strict';
import { getViewConfig } from '../src/lib/viewConfig.js';

test('getViewConfig returns wider historical windows for desktop intervals', () => {
  assert.deepEqual(getViewConfig('1m'), {
    lookbackMinutes: 60 * 24 * 14,
    visibleBars: 360,
    fundingIntervalSeconds: 60,
    replayLimit: 10,
  });

  assert.deepEqual(getViewConfig('5m'), {
    lookbackMinutes: 60 * 24 * 30,
    visibleBars: 336,
    fundingIntervalSeconds: 300,
    replayLimit: 10,
  });

  assert.deepEqual(getViewConfig('30m'), {
    lookbackMinutes: 60 * 24 * 60,
    visibleBars: 280,
    fundingIntervalSeconds: 1800,
    replayLimit: 9,
  });

  assert.deepEqual(getViewConfig('1h'), {
    lookbackMinutes: 60 * 24 * 90,
    visibleBars: 192,
    fundingIntervalSeconds: 28800,
    replayLimit: 8,
  });

  assert.deepEqual(getViewConfig('4h'), {
    lookbackMinutes: 60 * 24 * 365,
    visibleBars: 540,
    fundingIntervalSeconds: 28800,
    replayLimit: 8,
  });
});

test('getViewConfig falls back to 4h settings for unknown intervals', () => {
  assert.equal(getViewConfig('unknown').lookbackMinutes, 60 * 24 * 365);
});
