const DEFAULT_BASE_URL = globalThis?.window?.__BANANAS31_API_BASE__ || '/api';

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

export function fetchDex(minutes = 60 * 24 * 30, interval = '4h') {
  return getJson(`/history/dex?minutes=${minutes}&interval=${interval}`);
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

export async function probeCockpitIntervalSupport(
  interval,
  viewConfig,
  fetchers = {
    fetchOhlcv,
    fetchDex,
    fetchBasis,
    fetchOi,
    fetchFunding,
    fetchReplayEvents
  }
) {
  const probeMinutes = Math.min(viewConfig?.lookbackMinutes ?? 360, 360);
  const probeWindowSecs = probeMinutes * 60;
  const replayLimit = Math.max(1, Math.min(viewConfig?.replayLimit ?? 6, 3));

  try {
    await Promise.all([
      fetchers.fetchOhlcv('binance-spot', probeMinutes, interval),
      fetchers.fetchOhlcv('binance-perp', probeMinutes, interval),
      fetchers.fetchOhlcv('bybit-perp', probeMinutes, interval),
      fetchers.fetchDex(probeMinutes, interval),
      fetchers.fetchBasis(probeWindowSecs, interval),
      fetchers.fetchOi(probeMinutes, interval),
      fetchers.fetchFunding(probeWindowSecs, viewConfig?.fundingIntervalSeconds ?? 28800),
      fetchers.fetchReplayEvents(probeWindowSecs, interval, replayLimit)
    ]);
    return true;
  } catch {
    return false;
  }
}
