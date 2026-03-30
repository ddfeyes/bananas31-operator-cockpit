import test from 'node:test';
import assert from 'node:assert/strict';

import { PRICE_SERIES_FORMAT, formatCompact, formatPercent, formatPrice, getPricePrecision } from '../src/lib/formatters.js';

test('formatPrice preserves sub-cent precision without collapsing to two decimals', () => {
  assert.equal(formatPrice(0.013074), '0.013074');
  assert.equal(formatPrice(0.0130741234), '0.01307412');
  assert.equal(formatPrice(12.34), '12.3400');
});

test('formatPercent and formatCompact keep existing operator conventions', () => {
  assert.equal(formatPercent(0.005, 4), '0.0050%');
  assert.equal(formatCompact(3_382_259_081), '3.38B');
});

test('PRICE_SERIES_FORMAT keeps chart labels out of two-decimal mode', () => {
  assert.deepEqual(PRICE_SERIES_FORMAT, {
    type: 'price',
    precision: 8,
    minMove: 0.00000001
  });
});

test('getPricePrecision derives chart precision from real price points', () => {
  assert.deepEqual(
    getPricePrecision([
      { open: 0.013074, high: 0.013086, low: 0.013071, close: 0.013082 },
      { value: 0.01310923 }
    ]),
    {
      precision: 8,
      minMove: 0.00000001
    }
  );
});
