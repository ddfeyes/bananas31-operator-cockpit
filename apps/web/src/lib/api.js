const DEFAULT_BASE_URL = globalThis?.window?.__BANANAS31_API_BASE__ || '/api';

async function getJson(path) {
  const response = await fetch(`${DEFAULT_BASE_URL}${path}`);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${path} failed: ${response.status} ${message}`);
  }
  return response.json();
}

function withProjectId(path, projectId) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}project_id=${encodeURIComponent(projectId)}`;
}

export function fetchProjects() {
  return getJson('/projects');
}

export function fetchSnapshot(projectId = 'bananas31') {
  return getJson(withProjectId('/snapshot', projectId));
}

export function fetchOhlcv(projectId, exchangeId, minutes = 60 * 24 * 30, interval = '4h') {
  return getJson(
    `/history/ohlcv?project_id=${encodeURIComponent(projectId)}&exchange_id=${encodeURIComponent(exchangeId)}&minutes=${minutes}&interval=${interval}`
  );
}

export function fetchDex(projectId, minutes = 60 * 24 * 30, interval = '4h') {
  return getJson(`/history/dex?project_id=${encodeURIComponent(projectId)}&minutes=${minutes}&interval=${interval}`);
}

export function fetchBasis(projectId, windowSecs = 60 * 60 * 24 * 30, interval = '4h') {
  return getJson(`/history/basis?project_id=${encodeURIComponent(projectId)}&window_secs=${windowSecs}&interval=${interval}`);
}

export function fetchOi(projectId, minutes = 60 * 24 * 30, interval = '4h') {
  return getJson(`/history/oi?project_id=${encodeURIComponent(projectId)}&minutes=${minutes}&interval=${interval}`);
}

export function fetchFunding(projectId, windowSecs = 60 * 60 * 24 * 30, intervalSecs = 60 * 60 * 4) {
  return getJson(
    `/history/funding?project_id=${encodeURIComponent(projectId)}&window_secs=${windowSecs}&interval_secs=${intervalSecs}`
  );
}

export function fetchReplayEvents(projectId, windowSecs = 60 * 60 * 24 * 30, interval = '4h', limit = 6) {
  return getJson(
    `/replay/events?project_id=${encodeURIComponent(projectId)}&window_secs=${windowSecs}&interval=${interval}&limit=${limit}`
  );
}

export async function probeCockpitIntervalSupport(
  projectId,
  interval,
  viewConfig,
  fetchers = {
    fetchProjects,
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
      fetchers.fetchOhlcv(projectId, 'binance-spot', probeMinutes, interval),
      fetchers.fetchOhlcv(projectId, 'binance-perp', probeMinutes, interval),
      fetchers.fetchOhlcv(projectId, 'bybit-perp', probeMinutes, interval),
      fetchers.fetchDex(projectId, probeMinutes, interval),
      fetchers.fetchBasis(projectId, probeWindowSecs, interval),
      fetchers.fetchOi(projectId, probeMinutes, interval),
      fetchers.fetchFunding(projectId, probeWindowSecs, viewConfig?.fundingIntervalSeconds ?? 28800),
      fetchers.fetchReplayEvents(projectId, probeWindowSecs, interval, replayLimit)
    ]);
    return true;
  } catch {
    return false;
  }
}
