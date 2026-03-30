export const INTERVAL_TO_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800
};

export function computeVisibleRange(points, interval = '4h', barsToShow = 180) {
  const barSecs = INTERVAL_TO_SECONDS[interval] || 14400;
  if (!Array.isArray(points) || points.length === 0) {
    const now = Math.floor(Date.now() / 1000);
    return { from: now - barSecs * barsToShow, to: now + barSecs * 5 };
  }

  const first = Number(points[0].time);
  const last = Number(points[points.length - 1].time);
  return {
    from: Math.max(first, last - barSecs * barsToShow),
    to: last + barSecs * 5
  };
}

export function createActiveChartSync(entries) {
  const normalized = (entries || []).filter(Boolean);
  let activeChart = normalized[0]?.chart ?? null;
  let syncEnabled = false;
  let syncing = false;

  normalized.forEach(({ chart, element }) => {
    if (!chart) return;
    const activate = () => {
      activeChart = chart;
      syncEnabled = true;
    };
    if (element?.addEventListener) {
      ['pointerdown', 'wheel', 'mousedown', 'touchstart'].forEach((eventName) => {
        element.addEventListener(eventName, activate, { passive: true });
      });
    }
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range || !syncEnabled || syncing || (activeChart && activeChart !== chart)) return;
      syncing = true;
      normalized.forEach((target) => {
        if (target.chart === chart) return;
        try {
          target.chart.timeScale().setVisibleRange(range);
        } catch (error) {
          console.warn(`range sync skipped for ${target.element?.id ?? 'chart'}`, error);
        }
      });
      syncing = false;
    });
  });
}
