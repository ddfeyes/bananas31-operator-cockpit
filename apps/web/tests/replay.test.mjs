import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFocusMap,
  buildReplayRange,
  compactReplayFocus,
  formatReplayTimestamp,
  pickReplayModeLabel,
  summarizeReplayLine,
  summarizeReplayMetrics
} from '../src/lib/replay.js';

test('buildReplayRange prefers explicit replay windows', () => {
  const range = buildReplayRange({
    time: 1_700_000_000,
    window_from: 1_699_990_000,
    window_to: 1_700_010_000
  }, '4h');

  assert.deepEqual(range, { from: 1_699_990_000, to: 1_700_010_000 });
});

test('buildReplayRange falls back to interval-based windows', () => {
  const range = buildReplayRange({ time: 1_700_000_000 }, '4h');
  assert.equal(range.from, 1_700_000_000 - 14400 * 6);
  assert.equal(range.to, 1_700_000_000 + 14400 * 2);
});

test('buildFocusMap highlights the correct panel cluster', () => {
  assert.deepEqual(buildFocusMap('all'), {
    price: true,
    basis: true,
    oi: true,
    funding: true
  });

  assert.deepEqual(buildFocusMap('basis'), {
    price: true,
    basis: true,
    oi: false,
    funding: false
  });

  assert.deepEqual(buildFocusMap('leverage'), {
    price: true,
    basis: false,
    oi: true,
    funding: false
  });
});

test('pickReplayModeLabel reflects live versus locked replay state', () => {
  assert.equal(pickReplayModeLabel(null, 'all'), 'History Synced');
  assert.equal(pickReplayModeLabel({ id: 'evt-1' }, 'basis'), 'Replay Locked');
  assert.equal(pickReplayModeLabel(null, 'funding'), 'Reset Focus');
});

test('formatReplayTimestamp keeps replay rows compact', () => {
  assert.equal(formatReplayTimestamp(1_710_000_000), 'Mar 9 · 16:00');
});

test('compactReplayFocus shortens verbose mode labels', () => {
  assert.equal(compactReplayFocus('basis'), 'Carry');
  assert.equal(compactReplayFocus('leverage'), 'Lev');
  assert.equal(compactReplayFocus('funding'), 'Reset');
});

test('summarizeReplayMetrics formats the ledger columns deterministically', () => {
  assert.deepEqual(
    summarizeReplayMetrics({
      metrics: {
        basis_pct: -11.5794,
        oi_change_pct: 12.7137,
        funding_8h_pct: 0.032
      }
    }),
    {
      basis: '-11.58%',
      oiChange: '12.71%',
      funding: '0.0320%'
    }
  );
});

test('summarizeReplayLine keeps replay rows dense but truthful', () => {
  assert.equal(
    summarizeReplayLine({
      metrics: {
        basis_pct: -11.5794,
        oi_change_pct: 12.7137,
        funding_8h_pct: 0.032
      }
    }),
    'B -11.58% · OI 12.71% · F 0.0320%'
  );
});
