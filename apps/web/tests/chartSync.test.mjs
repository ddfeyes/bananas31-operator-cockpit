import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeVisibleRange,
  createActiveChartSync,
  createNearestPointLookup,
  shouldIgnoreRangeSyncError
} from '../src/lib/chartSync.js';

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
  const crosshairSubscribers = [];
  const received = [];
  const crosshairPositions = [];
  let clearCount = 0;
  return {
    received,
    crosshairPositions,
    get clearCount() {
      return clearCount;
    },
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
    subscribeCrosshairMove(handler) {
      crosshairSubscribers.push(handler);
    },
    setCrosshairPosition(value, time) {
      crosshairPositions.push({ value, time });
    },
    clearCrosshairPosition() {
      clearCount += 1;
    },
    emit(range) {
      subscribers.forEach((handler) => handler(range));
    },
    emitCrosshair(param) {
      crosshairSubscribers.forEach((handler) => handler(param));
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

test('createActiveChartSync mirrors crosshair positions using nearest lookups', () => {
  const price = {
    chart: makeMockChart(),
    element: makeMockElement(),
    crosshairSeries: { id: 'price' },
    lookupPoint: createNearestPointLookup([{ time: 100, value: 10 }, { time: 200, value: 20 }])
  };
  const oi = {
    chart: makeMockChart(),
    element: makeMockElement(),
    crosshairSeries: { id: 'oi' },
    lookupPoint: createNearestPointLookup([{ time: 90, value: 3 }, { time: 210, value: 5 }])
  };

  createActiveChartSync([price, oi]);

  price.chart.emitCrosshair({ time: 205 });
  assert.deepEqual(oi.chart.crosshairPositions, [{ value: 5, time: 210 }]);

  price.chart.emitCrosshair({});
  assert.equal(oi.chart.clearCount, 1);
});

test('createNearestPointLookup prefers the nearest point in sparse series', () => {
  const lookup = createNearestPointLookup([
    { time: 100, value: 1 },
    { time: 200, value: 2 },
    { time: 400, value: 4 },
  ]);

  assert.deepEqual(lookup(210), { time: 200, value: 2 });
  assert.deepEqual(lookup(390), { time: 400, value: 4 });
});

test('shouldIgnoreRangeSyncError suppresses benign lightweight-charts null-range noise', () => {
  assert.equal(shouldIgnoreRangeSyncError(new Error('Value is null')), true);
  assert.equal(shouldIgnoreRangeSyncError(new Error('boom')), false);
});
