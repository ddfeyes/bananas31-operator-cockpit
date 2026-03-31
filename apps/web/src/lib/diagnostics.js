import { formatPercent } from './formatters.js';

function signedPercent(value, digits = 2) {
  const numeric = Number(value || 0);
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(digits)}%`;
}

function latest(series) {
  return Array.isArray(series) && series.length ? series[series.length - 1] : null;
}

function lookbackPoint(series, barsBack = 12) {
  if (!Array.isArray(series) || !series.length) return null;
  return series[Math.max(0, series.length - 1 - barsBack)];
}

function changePercent(series, valueGetter, barsBack = 12) {
  const end = latest(series);
  const start = lookbackPoint(series, barsBack);
  if (!start || !end) return null;
  const startValue = Number(valueGetter(start));
  const endValue = Number(valueGetter(end));
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || startValue === 0) return null;
  return ((endValue - startValue) / startValue) * 100;
}

function changeAbsolute(series, valueGetter, barsBack = 12) {
  const end = latest(series);
  const start = lookbackPoint(series, barsBack);
  if (!start || !end) return null;
  const startValue = Number(valueGetter(start));
  const endValue = Number(valueGetter(end));
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return null;
  return endValue - startValue;
}

function average(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function fundingAverageSeries(funding) {
  const perSource = funding?.per_source || {};
  const bucket = new Map();
  Object.values(perSource).forEach((series) => {
    (series || []).forEach((point) => {
      const entry = bucket.get(point.time) || [];
      entry.push((point.rate_8h || 0) * 100);
      bucket.set(point.time, entry);
    });
  });
  return [...bucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, values]) => ({ time, value: average(values) ?? 0 }));
}

export function getDiagnosticLookbackBars(interval = '4h') {
  switch (interval) {
    case '1m':
      return 90;
    case '5m':
      return 48;
    case '30m':
      return 24;
    case '1h':
      return 18;
    case '1d':
      return 7;
    default:
      return 12;
  }
}

export function deriveMarketDiagnostics(payload, interval = '4h') {
  const barsBack = getDiagnosticLookbackBars(interval);
  const spotSeries = payload?.spot?.bars || [];
  const perpSeries = payload?.perp?.bars || [];
  const dexSeries = payload?.dex?.bars || [];
  const basisSeries = payload?.basis?.aggregated || [];
  const oiSeries = payload?.oi?.aggregated || [];
  const fundingSeries = fundingAverageSeries(payload?.funding);

  const spotChangePct = changePercent(spotSeries, (point) => point.close, barsBack) ?? 0;
  const perpChangePct = changePercent(perpSeries, (point) => point.close, barsBack) ?? 0;
  const dexChangePct = changePercent(dexSeries, (point) => point.value, barsBack) ?? 0;
  const oiChangePct = changePercent(oiSeries, (point) => point.value, barsBack) ?? 0;
  const basisDeltaPct = changeAbsolute(basisSeries, (point) => point.value, barsBack) ?? 0;
  const fundingDeltaPct = changeAbsolute(fundingSeries, (point) => point.value, barsBack) ?? 0;

  const latestBasis = latest(basisSeries)?.value ?? payload?.snapshot?.summary?.basis_agg_pct ?? 0;
  const latestFunding = latest(fundingSeries)?.value ?? payload?.snapshot?.summary?.funding_avg_8h_pct ?? 0;
  const latestOi = latest(oiSeries)?.value ?? payload?.snapshot?.summary?.oi_total ?? 0;

  const priceUp = spotChangePct > 0.5;
  const priceDown = spotChangePct < -0.5;
  const oiUp = oiChangePct > 1.5;
  const oiDown = oiChangePct < -1.5;
  const basisFirm = latestBasis > 0.15 || basisDeltaPct > 0.12;
  const basisSoft = latestBasis < -0.05 || basisDeltaPct < -0.12;
  const fundingFirm = latestFunding > 0.01 || fundingDeltaPct > 0.005;
  const fundingSoft = latestFunding < 0 || fundingDeltaPct < -0.005;
  const dexLeading = dexChangePct - perpChangePct > 0.2;

  let regime = 'Balanced';
  let driver = 'Mixed tape';
  let read = 'No dominant dislocation across spot, perp and carry.';

  if (priceUp && oiDown) {
    if (basisFirm || fundingFirm) {
      regime = 'Short-cover rally';
      driver = 'Perp buyback';
      read = 'Price is rising while OI comes out and carry stays bid, which usually means shorts are paying up to close.';
    } else {
      regime = dexLeading ? 'Spot-led bid' : 'Perp unwind';
      driver = dexLeading ? 'Spot absorption' : 'Long exit into spot demand';
      read = 'Price is grinding higher while OI bleeds and carry stays soft, which fits spot demand absorbing futures unwind more than fresh leverage.';
    }
  } else if (priceUp && oiUp) {
    regime = basisFirm || fundingFirm ? 'Leveraged chase' : 'Fresh long build';
    driver = 'Perp participation';
    read = 'Price and OI are rising together, so upside is being joined by new futures exposure rather than covered shorts.';
  } else if (priceDown && oiUp) {
    regime = 'Fresh short build';
    driver = 'Perp pressure';
    read = 'Price is falling while OI expands, which fits new short positioning leaning on the tape.';
  } else if (priceDown && oiDown) {
    regime = fundingSoft || basisSoft ? 'Long flush' : 'Risk-off unwind';
    driver = 'Position reduction';
    read = 'Price and OI are both falling, so exposure is leaving the tape instead of building into the move.';
  } else if (oiDown) {
    regime = 'Deleveraging drift';
    driver = 'Open interest bleed';
    read = 'Open interest is shrinking without a strong price impulse yet, which usually means the book is being cleaned up.';
  }

  return {
    regime,
    driver,
    read,
    evidenceLine: `Px ${signedPercent(spotChangePct, 2)} · OI ${signedPercent(oiChangePct, 2)} · Basis ${basisDeltaPct >= 0 ? '+' : ''}${basisDeltaPct.toFixed(2)}pp · Funding ${signedPercent(latestFunding, 4)}`,
    items: [
      {
        label: 'Flow',
        state: regime,
        value: `Px ${signedPercent(spotChangePct, 2)} · OI ${signedPercent(oiChangePct, 2)}`,
        detail: read,
      },
      {
        label: 'Driver',
        state: driver,
        value: `Basis ${latestBasis >= 0 ? '+' : ''}${latestBasis.toFixed(2)}% · Δ ${basisDeltaPct >= 0 ? '+' : ''}${basisDeltaPct.toFixed(2)}pp`,
        detail: dexLeading
          ? 'Spot and DEX are outperforming perp, so the move looks cash-led.'
          : 'Carry and perp behaviour decide whether this is short-cover or spot absorption.',
      },
      {
        label: 'Carry',
        state: fundingFirm ? 'Bid' : fundingSoft ? 'Relief' : 'Flat',
        value: `${formatPercent(latestFunding, 4)} · OI ${latestOi ? latestOi.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}`,
        detail: fundingFirm
          ? 'Positive funding means perp longs still pay to hold exposure.'
          : 'Flat-to-soft funding means the move is not being strongly sponsored by perp carry.',
      },
    ],
  };
}
