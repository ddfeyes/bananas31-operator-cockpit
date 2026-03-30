const DEFAULT_BASE_URL = window.__BANANAS31_API_BASE__ || '/api';

async function getJson(path) {
  const response = await fetch(`${DEFAULT_BASE_URL}${path}`);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${path} failed: ${response.status} ${message}`);
  }
  return response.json();
}

export function fetchSnapshot() {
  return getJson('/snapshot');
}

export function fetchOhlcv(exchangeId, minutes = 60 * 24 * 30, interval = '4h') {
  return getJson(`/history/ohlcv?exchange_id=${encodeURIComponent(exchangeId)}&minutes=${minutes}&interval=${interval}`);
}

export function fetchBasis(windowSecs = 60 * 60 * 24 * 30, interval = '4h') {
  return getJson(`/history/basis?window_secs=${windowSecs}&interval=${interval}`);
}

export function fetchOi(minutes = 60 * 24 * 30, interval = '4h') {
  return getJson(`/history/oi?minutes=${minutes}&interval=${interval}`);
}

export function fetchFunding(windowSecs = 60 * 60 * 24 * 30, intervalSecs = 60 * 60 * 4) {
  return getJson(`/history/funding?window_secs=${windowSecs}&interval_secs=${intervalSecs}`);
}

export function fetchReplayEvents(windowSecs = 60 * 60 * 24 * 30, interval = '4h', limit = 6) {
  return getJson(`/replay/events?window_secs=${windowSecs}&interval=${interval}&limit=${limit}`);
}
