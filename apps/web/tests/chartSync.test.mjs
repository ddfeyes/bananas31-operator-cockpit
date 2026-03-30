import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVisibleRange, createActiveChartSync, shouldIgnoreRangeSyncError } from '../src/lib/chartSync.js';

test('computeVisibleRange limits the viewport to the most recent bars', () => {
  const bars = Array.from({ length: 240 }, (_, index) => ({ time: 1_700_000_000 + index * 14400 }));
  const range = computeVisibleRange(bars, '4h', 180);

  assert.equal(range.from, bars[239].time - 14400 * 180);
  assert.equal(range.to, bars[239].time + 14400 * 5);
});

function makeMockElement() {
  const listeners = new Map();
  return {
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
    },
    emit(name) {
      for (const handler of listeners.get(name) || []) handler();
    }
  };
}

function makeMockChart() {
  const subscribers = [];
  const received = [];
  return {
    received,
    timeScale() {
      return {
        subscribeVisibleTimeRangeChange(handler) {
          subscribers.push(handler);
        },
        setVisibleRange(range) {
          received.push(range);
        }
      };
    },
    emit(range) {
      subscribers.forEach((handler) => handler(range));
    }
  };
}

test('createActiveChartSync syncs only from the active chart', () => {
  const price = { chart: makeMockChart(), element: makeMockElement() };
  const basis = { chart: makeMockChart(), element: makeMockElement() };
  const funding = { chart: makeMockChart(), element: makeMockElement() };

  createActiveChartSync([price, basis, funding]);

  basis.chart.emit({ from: 10, to: 20 });
  assert.deepEqual(price.chart.received, []);

  basis.element.emit('pointerdown');
  basis.chart.emit({ from: 11, to: 22 });
  assert.deepEqual(price.chart.received, [{ from: 11, to: 22 }]);
  assert.deepEqual(funding.chart.received, [{ from: 11, to: 22 }]);
});

test('shouldIgnoreRangeSyncError suppresses benign lightweight-charts null-range noise', () => {
  assert.equal(shouldIgnoreRangeSyncError(new Error('Value is null')), true);
  assert.equal(shouldIgnoreRangeSyncError(new Error('boom')), false);
});
