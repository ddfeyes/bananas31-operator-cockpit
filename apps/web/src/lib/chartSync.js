export const INTERVAL_TO_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
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

export function shouldIgnoreRangeSyncError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('Value is null');
}

function shouldIgnoreCrosshairSyncError(error) {
  return shouldIgnoreRangeSyncError(error);
}

export function createActiveChartSync(entries) {
  const normalized = (entries || []).filter(Boolean);
  let activeChart = normalized[0]?.chart ?? null;
  let rangeSyncEnabled = false;
  let suspended = false;
  let syncingRange = false;
  let syncingCrosshair = false;

  const controller = {
    suspend() {
      suspended = true;
    },
    resume() {
      suspended = false;
    },
    activate(chart) {
      activeChart = chart;
      rangeSyncEnabled = true;
    },
    syncRange(range, sourceChart = activeChart) {
      if (!range || suspended) return;
      syncingRange = true;
      normalized.forEach((target) => {
        if (!target.chart || target.chart === sourceChart) return;
        try {
          target.chart.timeScale().setVisibleRange(range);
        } catch (error) {
          if (!shouldIgnoreRangeSyncError(error)) {
            console.warn(`range sync skipped for ${target.element?.id ?? 'chart'}`, error);
          }
        }
      });
      syncingRange = false;
    },
    clearCrosshair(sourceChart = null) {
      if (suspended) return;
      syncingCrosshair = true;
      normalized.forEach((target) => {
        if (!target.chart || target.chart === sourceChart) return;
        try {
          target.chart.clearCrosshairPosition();
        } catch (error) {
          if (!shouldIgnoreCrosshairSyncError(error)) {
            console.warn(`crosshair clear skipped for ${target.element?.id ?? 'chart'}`, error);
          }
        }
      });
      syncingCrosshair = false;
    },
    syncCrosshair(param, sourceChart) {
      if (suspended || syncingCrosshair) return;
      const time = param?.time;
      if (!time) {
        controller.clearCrosshair(sourceChart);
        return;
      }
      syncingCrosshair = true;
      normalized.forEach((target) => {
        if (!target.chart || target.chart === sourceChart) return;
        const point = target.lookupPoint?.(time);
        if (!point || !Number.isFinite(point.value)) {
          try {
            target.chart.clearCrosshairPosition();
          } catch (error) {
            if (!shouldIgnoreCrosshairSyncError(error)) {
              console.warn(`crosshair clear skipped for ${target.element?.id ?? 'chart'}`, error);
            }
          }
          return;
        }
        try {
          target.chart.setCrosshairPosition(point.value, point.time, target.crosshairSeries);
        } catch (error) {
          if (!shouldIgnoreCrosshairSyncError(error)) {
            console.warn(`crosshair sync skipped for ${target.element?.id ?? 'chart'}`, error);
          }
        }
      });
      syncingCrosshair = false;
    }
  };

  normalized.forEach(({ chart, element }) => {
    if (!chart) return;
    const activate = () => {
      controller.activate(chart);
    };
    if (element?.addEventListener) {
      ['pointerdown', 'wheel', 'mousedown', 'touchstart'].forEach((eventName) => {
        element.addEventListener(eventName, activate, { passive: true });
      });
    }
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range || suspended || !rangeSyncEnabled || syncingRange || (activeChart && activeChart !== chart)) return;
      controller.syncRange(range, chart);
    });
    chart.subscribeCrosshairMove?.((param) => {
      if (suspended) return;
      controller.syncCrosshair(param, chart);
    });
  });

  return controller;
}

export function createNearestPointLookup(points, valueAccessor = (point) => point?.value) {
  const normalized = Array.isArray(points)
    ? points
        .map((point) => ({ time: Number(point?.time), value: Number(valueAccessor(point)) }))
        .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    : [];

  return (time) => {
    const targetTime = Number(time);
    if (!normalized.length || !Number.isFinite(targetTime)) {
      return null;
    }

    let low = 0;
    let high = normalized.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = normalized[mid];
      if (candidate.time === targetTime) {
        return candidate;
      }
      if (candidate.time < targetTime) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const left = normalized[Math.max(0, high)];
    const right = normalized[Math.min(normalized.length - 1, low)];
    if (!left) return right ?? null;
    if (!right) return left ?? null;
    return Math.abs(targetTime - left.time) <= Math.abs(right.time - targetTime) ? left : right;
  };
}
