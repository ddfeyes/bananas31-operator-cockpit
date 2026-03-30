import { INTERVAL_TO_SECONDS } from './chartSync.js';

export function buildReplayRange(event, interval = '4h') {
  if (event?.window_from != null && event?.window_to != null) {
    return { from: Number(event.window_from), to: Number(event.window_to) };
  }

  const seconds = INTERVAL_TO_SECONDS[interval] || 14400;
  const time = Number(event?.time || Math.floor(Date.now() / 1000));
  return {
    from: time - seconds * 6,
    to: time + seconds * 2
  };
}

export function buildFocusMap(mode = 'all') {
  switch (mode) {
    case 'basis':
      return { price: true, basis: true, oi: false, funding: false };
    case 'leverage':
      return { price: true, basis: false, oi: true, funding: false };
    case 'funding':
      return { price: true, basis: false, oi: false, funding: true };
    default:
      return { price: true, basis: true, oi: true, funding: true };
  }
}

export function pickReplayModeLabel(event, focusMode = 'all') {
  if (event) return 'Replay Locked';
  switch (focusMode) {
    case 'basis':
      return 'Carry Focus';
    case 'leverage':
      return 'Leverage Focus';
    case 'funding':
      return 'Reset Focus';
    default:
      return 'History Synced';
  }
}
