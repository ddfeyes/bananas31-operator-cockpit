import test from 'node:test';
import assert from 'node:assert/strict';
import { getViewConfig } from '../src/lib/viewConfig.js';

test('getViewConfig returns wider historical windows for desktop intervals', () => {
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
