import test from 'node:test';
import assert from 'node:assert/strict';

import {
  matchHotkeyAction,
  readStoredCockpitPrefs,
  resolveReplayNeighbor,
  writeStoredCockpitPrefs
} from '../src/lib/cockpitState.js';

test('readStoredCockpitPrefs returns sane defaults', () => {
  const storage = {
    getItem() {
      return null;
    }
  };

  assert.deepEqual(readStoredCockpitPrefs(storage), {
    interval: '4h',
    focusMode: 'all'
  });
});

test('writeStoredCockpitPrefs persists only valid values', () => {
  const saved = new Map();
  const storage = {
    getItem(key) {
      return saved.get(key) ?? null;
    },
    setItem(key, value) {
      saved.set(key, value);
    }
  };

  writeStoredCockpitPrefs(storage, { interval: '1d', focusMode: 'basis' });
  assert.deepEqual(readStoredCockpitPrefs(storage), {
    interval: '1d',
    focusMode: 'basis'
  });

  writeStoredCockpitPrefs(storage, { interval: '15m', focusMode: 'weird' });
  assert.deepEqual(readStoredCockpitPrefs(storage), {
    interval: '4h',
    focusMode: 'all'
  });
});

test('resolveReplayNeighbor walks replay events predictably', () => {
  const events = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  assert.equal(resolveReplayNeighbor(events, null, 1)?.id, 'a');
  assert.equal(resolveReplayNeighbor(events, null, -1)?.id, 'c');
  assert.equal(resolveReplayNeighbor(events, 'b', 1)?.id, 'c');
  assert.equal(resolveReplayNeighbor(events, 'b', -1)?.id, 'a');
  assert.equal(resolveReplayNeighbor(events, 'c', 1)?.id, 'c');
});

test('matchHotkeyAction maps the compact operator controls', () => {
  assert.deepEqual(matchHotkeyAction({ key: '2' }), {
    type: 'interval',
    value: '4h'
  });
  assert.deepEqual(matchHotkeyAction({ key: 'c' }), {
    type: 'focus',
    value: 'basis'
  });
  assert.deepEqual(matchHotkeyAction({ key: 'j' }), {
    type: 'replay',
    value: 'next'
  });
  assert.deepEqual(matchHotkeyAction({ key: 'Escape' }), {
    type: 'live-reset'
  });
  assert.equal(matchHotkeyAction({ key: 'j', ctrlKey: true }), null);
});
