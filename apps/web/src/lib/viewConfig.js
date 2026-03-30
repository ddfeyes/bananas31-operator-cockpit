const VIEW_CONFIG = {
  '1m': {
    lookbackMinutes: 60 * 24 * 14,
    visibleBars: 360,
    fundingIntervalSeconds: 60,
    replayLimit: 10,
  },
  '5m': {
    lookbackMinutes: 60 * 24 * 30,
    visibleBars: 336,
    fundingIntervalSeconds: 300,
    replayLimit: 10,
  },
  '30m': {
    lookbackMinutes: 60 * 24 * 60,
    visibleBars: 280,
    fundingIntervalSeconds: 1800,
    replayLimit: 9,
  },
  '1h': {
    lookbackMinutes: 60 * 24 * 90,
    visibleBars: 192,
    fundingIntervalSeconds: 28800,
    replayLimit: 8,
  },
  '4h': {
    lookbackMinutes: 60 * 24 * 365,
    visibleBars: 540,
    fundingIntervalSeconds: 28800,
    replayLimit: 8,
  },
  '1d': {
    lookbackMinutes: 60 * 24 * 365,
    visibleBars: 220,
    fundingIntervalSeconds: 28800,
    replayLimit: 10,
  },
};

export function getViewConfig(interval = '4h') {
  return VIEW_CONFIG[interval] || VIEW_CONFIG['4h'];
}
