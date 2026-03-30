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

export function formatReplayTimestamp(timestamp) {
  if (!timestamp) return '—';
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(timestamp * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.month} ${values.day} · ${values.hour}:${values.minute}`;
}

export function compactReplayFocus(mode = '') {
  switch (mode) {
    case 'basis':
      return 'Carry';
    case 'leverage':
      return 'Lev';
    case 'funding':
      return 'Reset';
    default:
      return mode || 'Live';
  }
}

export function summarizeReplayMetrics(event) {
  const metrics = event?.metrics || {};
  return {
    basis: metrics.basis_pct == null ? '—' : `${Number(metrics.basis_pct).toFixed(2)}%`,
    oiChange: metrics.oi_change_pct == null ? '—' : `${Number(metrics.oi_change_pct).toFixed(2)}%`,
    funding: metrics.funding_8h_pct == null ? '—' : `${Number(metrics.funding_8h_pct).toFixed(4)}%`
  };
}

export function summarizeReplayLine(event) {
  const metrics = summarizeReplayMetrics(event);
  return `B ${metrics.basis} · OI ${metrics.oiChange} · F ${metrics.funding}`;
}
