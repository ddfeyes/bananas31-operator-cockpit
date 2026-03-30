const STORAGE_KEY = 'bananas31-layout-v1';

export const DEFAULT_LAYOUT_STATE = {
  heroHeight: 540,
  panels: {
    basis: true,
    oi: true,
    funding: true,
    replay: true,
    coverage: true,
    reading: true,
  },
  analyticsWeights: {
    basis: 1.1,
    oi: 1.4,
    funding: 1.0,
  },
  supportWeights: {
    replay: 1.3,
    coverage: 0.9,
    reading: 1.0,
  },
  oiSeries: {
    agg: true,
    binance: true,
    bybit: false,
  },
};

function safeClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeWeights(weights, fallback) {
  const entries = Object.entries(fallback).map(([key, defaultValue]) => {
    const value = Number(weights?.[key]);
    return [key, Number.isFinite(value) && value > 0 ? value : defaultValue];
  });
  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
}

export function readStoredLayoutState(storage = globalThis?.localStorage) {
  if (!storage) return safeClone(DEFAULT_LAYOUT_STATE);
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return safeClone(DEFAULT_LAYOUT_STATE);
    const parsed = JSON.parse(raw);
    return {
      heroHeight: clamp(Number(parsed?.heroHeight) || DEFAULT_LAYOUT_STATE.heroHeight, 320, 960),
      panels: {
        basis: parsed?.panels?.basis !== false,
        oi: parsed?.panels?.oi !== false,
        funding: parsed?.panels?.funding !== false,
        replay: parsed?.panels?.replay !== false,
        coverage: parsed?.panels?.coverage !== false,
        reading: parsed?.panels?.reading !== false,
      },
      analyticsWeights: normalizeWeights(parsed?.analyticsWeights, DEFAULT_LAYOUT_STATE.analyticsWeights),
      supportWeights: normalizeWeights(parsed?.supportWeights, DEFAULT_LAYOUT_STATE.supportWeights),
      oiSeries: {
        agg: parsed?.oiSeries?.agg !== false,
        binance: parsed?.oiSeries?.binance !== false,
        bybit: parsed?.oiSeries?.bybit === true,
      },
    };
  } catch {
    return safeClone(DEFAULT_LAYOUT_STATE);
  }
}

export function writeStoredLayoutState(storage = globalThis?.localStorage, layout = DEFAULT_LAYOUT_STATE) {
  if (!storage) return;
  const normalized = {
    heroHeight: clamp(Number(layout?.heroHeight) || DEFAULT_LAYOUT_STATE.heroHeight, 320, 960),
    panels: {
      basis: layout?.panels?.basis !== false,
      oi: layout?.panels?.oi !== false,
      funding: layout?.panels?.funding !== false,
      replay: layout?.panels?.replay !== false,
      coverage: layout?.panels?.coverage !== false,
      reading: layout?.panels?.reading !== false,
    },
    analyticsWeights: normalizeWeights(layout?.analyticsWeights, DEFAULT_LAYOUT_STATE.analyticsWeights),
    supportWeights: normalizeWeights(layout?.supportWeights, DEFAULT_LAYOUT_STATE.supportWeights),
    oiSeries: {
      agg: layout?.oiSeries?.agg !== false,
      binance: layout?.oiSeries?.binance !== false,
      bybit: layout?.oiSeries?.bybit === true,
    },
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function rebalancePairWeights(weights, leftKey, rightKey, ratio) {
  const normalized = normalizeWeights(weights, weights);
  const pairTotal = (normalized[leftKey] || 0) + (normalized[rightKey] || 0);
  const safeRatio = clamp(Number(ratio) || 0.5, 0.15, 0.85);
  return {
    ...normalized,
    [leftKey]: pairTotal * safeRatio,
    [rightKey]: pairTotal * (1 - safeRatio),
  };
}

