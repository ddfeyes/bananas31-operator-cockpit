const PRICE_PRECISION = 8;

function trimDecimals(value, minimumFractionDigits = 0) {
  if (!value.includes('.')) return value;
  const [integer, fraction] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const padded = trimmed.length >= minimumFractionDigits
    ? trimmed
    : `${trimmed}${'0'.repeat(minimumFractionDigits - trimmed.length)}`;
  return padded ? `${integer}.${padded}` : integer;
}

export const PRICE_SERIES_FORMAT = {
  type: 'price',
  precision: PRICE_PRECISION,
  minMove: 1 / 10 ** PRICE_PRECISION
};

function decimalPlaces(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const text = numeric.toString().toLowerCase();
  if (text.includes('e-')) {
    const [, exponent] = text.split('e-');
    return Number(exponent);
  }
  const fraction = text.split('.')[1];
  return fraction ? fraction.length : 0;
}

export function getPricePrecision(points, fallback = PRICE_SERIES_FORMAT) {
  const places = (points || []).reduce((max, point) => {
    if (point == null) return max;
    return Math.max(
      max,
      decimalPlaces(point.open),
      decimalPlaces(point.high),
      decimalPlaces(point.low),
      decimalPlaces(point.close),
      decimalPlaces(point.value)
    );
  }, 0);

  const precision = Math.min(Math.max(places, 6), PRICE_PRECISION);
  return {
    precision,
    minMove: 1 / 10 ** precision || fallback.minMove
  };
}

export function formatPrice(value, { minimumFractionDigits, maximumFractionDigits = PRICE_PRECISION } = {}) {
  if (value == null) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';

  const absolute = Math.abs(numeric);
  const minimum = minimumFractionDigits ?? (absolute >= 1 ? 4 : 6);
  const fixed = numeric.toFixed(maximumFractionDigits);
  return trimDecimals(fixed, minimum);
}

export function formatPercent(value, digits = 4) {
  if (value == null) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

export function formatCompact(value) {
  if (value == null) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return `${value.toFixed(2)}`;
}
