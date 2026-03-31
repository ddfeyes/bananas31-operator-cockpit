import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMarketDiagnostics, getDiagnosticLookbackBars } from '../src/lib/diagnostics.js';

function lineSeries(values) {
  return values.map((value, index) => ({ time: 1_700_000_000 + index * 3600, value }));
}

function ohlcvSeries(values) {
  return values.map((value, index) => ({
    time: 1_700_000_000 + index * 3600,
    open: value,
    high: value,
    low: value,
    close: value,
    volume: 1,
  }));
}

test('getDiagnosticLookbackBars widens minute windows and keeps daily compact', () => {
  assert.equal(getDiagnosticLookbackBars('1m'), 90);
  assert.equal(getDiagnosticLookbackBars('4h'), 12);
  assert.equal(getDiagnosticLookbackBars('1d'), 7);
});

test('deriveMarketDiagnostics recognizes spot-led price up with OI down', () => {
  const payload = {
    snapshot: {
      summary: { basis_agg_pct: -0.08, funding_avg_8h_pct: 0.005, oi_total: 1_900_000 }
    },
    spot: { bars: ohlcvSeries([10, 10.1, 10.2, 10.4, 10.5, 10.7, 10.8, 10.9, 11, 11.1, 11.2, 11.3, 11.4]) },
    perp: { bars: ohlcvSeries([10, 10.08, 10.15, 10.2, 10.3, 10.45, 10.55, 10.58, 10.62, 10.68, 10.72, 10.75, 10.8]) },
    dex: { bars: lineSeries([10, 10.1, 10.25, 10.42, 10.56, 10.72, 10.86, 10.98, 11.08, 11.18, 11.29, 11.38, 11.5]) },
    basis: { aggregated: lineSeries([0.15, 0.14, 0.11, 0.08, 0.05, 0.03, 0.01, -0.01, -0.03, -0.05, -0.06, -0.07, -0.08]) },
    oi: { aggregated: lineSeries([2_200_000, 2_180_000, 2_150_000, 2_120_000, 2_090_000, 2_040_000, 2_010_000, 1_980_000, 1_960_000, 1_940_000, 1_930_000, 1_915_000, 1_900_000]) },
    funding: {
      per_source: {
        'binance-perp': lineSeries([0.00005, 0.00005, 0.00005, 0.00005, 0.00005, 0.00005, 0.00005, 0.00005, 0.00005, 0.00005, 0.00005, 0.00005, 0.00005]).map((point) => ({ time: point.time, rate_8h: point.value, rate_1h: point.value / 8 })),
        'bybit-perp': lineSeries([0.00004, 0.00004, 0.00005, 0.00004, 0.00005, 0.00004, 0.00005, 0.00004, 0.00005, 0.00004, 0.00005, 0.00005, 0.00005]).map((point) => ({ time: point.time, rate_8h: point.value, rate_1h: point.value / 8 })),
      }
    }
  };

  const diagnostics = deriveMarketDiagnostics(payload, '4h');
  assert.equal(diagnostics.regime, 'Spot-led bid');
  assert.equal(diagnostics.driver, 'Spot absorption');
  assert.match(diagnostics.items[0].value, /Px \+/);
  assert.match(diagnostics.items[0].value, /OI -/);
});

test('deriveMarketDiagnostics recognizes short-cover rally when carry firms', () => {
  const payload = {
    snapshot: {
      summary: { basis_agg_pct: 0.45, funding_avg_8h_pct: 0.024, oi_total: 3_600_000_000 }
    },
    spot: { bars: ohlcvSeries([1, 1.01, 1.03, 1.04, 1.05, 1.07, 1.08, 1.09, 1.11, 1.13, 1.14, 1.16, 1.18]) },
    perp: { bars: ohlcvSeries([1, 1.02, 1.04, 1.05, 1.07, 1.09, 1.11, 1.12, 1.14, 1.16, 1.18, 1.21, 1.24]) },
    dex: { bars: lineSeries([1, 1.0, 1.02, 1.03, 1.04, 1.05, 1.07, 1.08, 1.09, 1.11, 1.12, 1.14, 1.15]) },
    basis: { aggregated: lineSeries([0.05, 0.07, 0.09, 0.11, 0.14, 0.18, 0.22, 0.26, 0.3, 0.34, 0.38, 0.42, 0.45]) },
    oi: { aggregated: lineSeries([4_000_000_000, 3_980_000_000, 3_960_000_000, 3_930_000_000, 3_910_000_000, 3_880_000_000, 3_860_000_000, 3_840_000_000, 3_810_000_000, 3_780_000_000, 3_740_000_000, 3_700_000_000, 3_600_000_000]) },
    funding: {
      per_source: {
        'binance-perp': lineSeries([0.00008, 0.00009, 0.00011, 0.00012, 0.00013, 0.00015, 0.00017, 0.00019, 0.0002, 0.00022, 0.00023, 0.00024, 0.00024]).map((point) => ({ time: point.time, rate_8h: point.value, rate_1h: point.value / 8 })),
      }
    }
  };

  const diagnostics = deriveMarketDiagnostics(payload, '4h');
  assert.equal(diagnostics.regime, 'Short-cover rally');
  assert.equal(diagnostics.driver, 'Perp buyback');
});
