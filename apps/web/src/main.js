import './styles.css';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import {
  fetchBasis,
  fetchDex,
  fetchFunding,
  fetchOhlcv,
  fetchOi,
  fetchReplayEvents,
  fetchSnapshot,
  probeCockpitIntervalSupport
} from './lib/api.js';
import { computeVisibleRange, createActiveChartSync, shouldIgnoreRangeSyncError } from './lib/chartSync.js';
import { matchHotkeyAction, readStoredCockpitPrefs, resolveReplayNeighbor, writeStoredCockpitPrefs } from './lib/cockpitState.js';
import { formatCompact, formatPercent, formatPrice, getPricePrecision } from './lib/formatters.js';
import {
  buildFocusMap,
  buildReplayRange,
  compactReplayFocus,
  formatReplayTimestamp,
  pickReplayModeLabel,
  summarizeReplayMetrics
} from './lib/replay.js';
import { getViewConfig } from './lib/viewConfig.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="app-shell">
    <header class="masthead">
      <section class="brand-deck">
        <div class="brand-heading-row">
          <div class="brand-mark">
            <p class="brand-kicker">BANANAS31</p>
            <h1 class="brand-title">Operator Cockpit</h1>
          </div>
          <div class="signal-badge" id="sync-state">History Synced</div>
        </div>
      </section>

      <section class="mission-card">
        <div class="mission-row">
          <span>Regime</span>
          <strong id="live-regime">Loading…</strong>
        </div>
        <div class="mission-row">
          <span>Range</span>
          <strong id="session-range">Waiting for feed</strong>
        </div>
      </section>
    </header>

    <section class="summary-tape" id="summary-grid"></section>

    <section class="command-deck">
      <div class="toolbar-group" id="interval-group">
        <button data-interval="1m" data-optional-interval hidden disabled aria-hidden="true">1M</button>
        <button data-interval="1h">1H</button>
        <button data-interval="4h" class="active">4H</button>
        <button data-interval="1d">1D</button>
      </div>

      <div class="toolbar-group focus-group" id="focus-group">
        <button data-focus="all" class="active">All</button>
        <button data-focus="basis">Carry</button>
        <button data-focus="leverage">Leverage</button>
        <button data-focus="funding">Funding</button>
      </div>

      <div class="toolbar-group mode-group" id="mode-group">
        <button data-live-reset class="active">Live</button>
        <button data-replay-indicator disabled>Replay Idle</button>
      </div>
    </section>

    <section class="workspace-grid">
      <div class="chart-stage">
        <article class="panel panel-hero" id="price-panel">
          <div class="panel-header">
            <div>
              <h2 class="panel-title">Price + Volume</h2>
            </div>
            <span class="panel-meta" id="price-meta">Historical candlesticks + perp overlays</span>
          </div>
          <div class="chart-slot chart-slot-hero" id="price-chart"></div>
        </article>

        <div class="analytics-row">
          <article class="panel" id="basis-panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">Basis</h2>
              </div>
              <span class="panel-meta" id="basis-meta">Aggregated venue spread</span>
            </div>
            <div class="chart-slot chart-slot-compact" id="basis-chart"></div>
          </article>

          <article class="panel" id="oi-panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">Perp OI</h2>
              </div>
              <span class="panel-meta" id="oi-meta">Aggregated and venue split</span>
            </div>
            <div class="chart-slot chart-slot-compact" id="oi-chart"></div>
          </article>

          <article class="panel" id="funding-panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">Funding</h2>
              </div>
              <span class="panel-meta" id="funding-meta">8h venue funding tape</span>
            </div>
            <div class="chart-slot chart-slot-compact" id="funding-chart"></div>
          </article>
        </div>
      </div>
    </section>

    <section class="support-grid">
      <article class="support-card support-cluster support-replay">
        <div class="support-head">
          <p class="support-kicker">Replay</p>
          <span class="support-meta" id="replay-meta">6 windows</span>
        </div>
        <div class="replay-list" id="replay-list"></div>
      </article>

      <article class="support-card support-cluster">
        <div class="support-head">
          <p class="support-kicker">Coverage</p>
          <div class="support-columns coverage-columns">
            <span>Source</span>
            <span>Bars</span>
            <span>Fresh</span>
          </div>
        </div>
        <div class="coverage-list" id="coverage-list"></div>
      </article>

      <article class="support-card support-cluster">
        <div class="support-head">
          <p class="support-kicker">Reading</p>
          <div class="support-columns thesis-columns">
            <span>Signal</span>
            <span>State</span>
            <span>Value</span>
          </div>
        </div>
        <ul class="thesis-list" id="thesis-list"></ul>
      </article>
    </section>
  </div>
`;

const summaryGrid = document.querySelector('#summary-grid');
const replayList = document.querySelector('#replay-list');
const coverageList = document.querySelector('#coverage-list');
const thesisList = document.querySelector('#thesis-list');
const intervalButtons = [...document.querySelectorAll('[data-interval]')];
const focusButtons = [...document.querySelectorAll('[data-focus]')];
const liveResetButton = document.querySelector('[data-live-reset]');
const replayIndicatorButton = document.querySelector('[data-replay-indicator]');
const liveRegime = document.querySelector('#live-regime');
const sessionRange = document.querySelector('#session-range');
const syncState = document.querySelector('#sync-state');
const replayMeta = document.querySelector('#replay-meta');
const priceMeta = document.querySelector('#price-meta');
const basisMeta = document.querySelector('#basis-meta');
const oiMeta = document.querySelector('#oi-meta');
const fundingMeta = document.querySelector('#funding-meta');
const DEFAULT_INTERVAL = '4h';
const BASE_INTERVALS = new Set(['1h', '4h', '1d']);

const charts = {};
const persistedPrefs = readStoredCockpitPrefs();
const panelElements = {
  price: document.querySelector('#price-panel'),
  basis: document.querySelector('#basis-panel'),
  oi: document.querySelector('#oi-panel'),
  funding: document.querySelector('#funding-panel')
};

const state = {
  interval: persistedPrefs.interval,
  focusMode: persistedPrefs.focusMode,
  supportedIntervals: new Set(BASE_INTERVALS),
  replayEvent: null,
  replayEvents: [],
  payload: null,
  healthLabel: 'Connecting',
  windowLabel: 'Waiting',
  loadRequestId: 0
};

function persistCockpitPrefs() {
  writeStoredCockpitPrefs(undefined, {
    interval: state.interval,
    focusMode: state.focusMode
  });
}

function syncControlButtons() {
  intervalButtons.forEach((button) => {
    const supported = state.supportedIntervals.has(button.dataset.interval);
    const optional = button.hasAttribute('data-optional-interval');
    button.hidden = optional && !supported;
    button.disabled = !supported;
    button.classList.toggle('active', supported && button.dataset.interval === state.interval);
  });
  focusButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.focus === state.focusMode);
  });
}

function syncIntervalLoadingState(loading) {
  intervalButtons.forEach((button) => {
    button.disabled = loading || !state.supportedIntervals.has(button.dataset.interval);
  });
}

async function hydrateOptionalIntervals() {
  const minuteSupported = await probeCockpitIntervalSupport('1m', getViewConfig('1m'));
  if (minuteSupported) {
    state.supportedIntervals.add('1m');
  } else {
    state.supportedIntervals.delete('1m');
    if (state.interval === '1m') {
      state.interval = DEFAULT_INTERVAL;
      persistCockpitPrefs();
    }
  }
  syncControlButtons();
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatLedgerTimestamp(timestamp) {
  if (!timestamp) return '—';
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(timestamp * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.month} ${values.day} ${values.hour}:${values.minute}`;
}

function formatTimeCompact(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function formatCoverageFreshness(timestamp, referenceTimestamp) {
  if (!timestamp) return '—';
  if (!referenceTimestamp) return formatLedgerTimestamp(timestamp);
  const current = new Date(timestamp * 1000);
  const reference = new Date(referenceTimestamp * 1000);
  const sameDay = current.toDateString() === reference.toDateString();
  return sameDay ? formatTimeCompact(timestamp) : formatReplayTimestamp(timestamp);
}

function barsLabel(count) {
  return `${count} ${state.interval.toUpperCase()} bars`;
}

function formatPercentAxis(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${numeric.toFixed(digits)}%`;
}

function latestPoint(series) {
  if (!Array.isArray(series) || series.length === 0) return null;
  return series[series.length - 1];
}

function lastPointTime(series) {
  if (!Array.isArray(series) || series.length === 0) return null;
  return Number(series[series.length - 1].time);
}

function coverageStatus(count) {
  if (count >= 150) return { label: 'Deep', tone: 'good' };
  if (count >= 48) return { label: 'Usable', tone: 'warn' };
  return { label: 'Thin', tone: 'weak' };
}

function deriveSessionThesis(snapshot) {
  const basis = snapshot.summary.basis_agg_pct ?? 0;
  const funding = snapshot.summary.funding_avg_8h_pct ?? 0;
  const oi = snapshot.summary.oi_total ?? 0;
  const items = [];

  if (basis < 0) {
    items.push({ label: 'Carry', state: 'Defensive', value: formatPercent(basis, 2) });
  } else {
    items.push({ label: 'Carry', state: 'Engaged', value: formatPercent(basis, 2) });
  }

  if (funding > 0.05) {
    items.push({ label: 'Funding', state: 'Hot', value: formatPercent(funding, 4) });
  } else if (funding < 0) {
    items.push({ label: 'Funding', state: 'Negative', value: 'Squeeze' });
  } else {
    items.push({ label: 'Funding', state: 'Calm', value: formatPercent(funding, 4) });
  }

  if (oi >= 7_500_000_000) {
    items.push({ label: 'Leverage', state: 'Heavy', value: formatCompact(oi) });
  } else {
    items.push({ label: 'Leverage', state: 'Moderate', value: formatCompact(oi) });
  }

  return items;
}

function updateStatusHeadline() {
  syncState.textContent = `${pickReplayModeLabel(state.replayEvent, state.focusMode)} · ${state.windowLabel} · ${state.healthLabel}`;
  replayIndicatorButton.textContent = state.replayEvent
    ? compactReplayFocus(state.replayEvent.focus_mode)
    : 'Idle';
  replayIndicatorButton.classList.toggle('active', Boolean(state.replayEvent));
  liveResetButton.classList.toggle('active', !state.replayEvent);
}

function renderSummary(snapshot) {
  const cards = [
    ['Spot', formatPrice(snapshot.prices['binance-spot'])],
    ['Perp', formatPrice(snapshot.prices['binance-perp'])],
    ['DEX', formatPrice(snapshot.prices.dex)],
    ['Basis', formatPercent(snapshot.summary.basis_agg_pct, 4)],
    ['Bybit', formatPrice(snapshot.prices['bybit-perp'])],
    ['Perp OI', formatCompact(snapshot.summary.oi_total)]
  ];

  summaryGrid.innerHTML = cards.map(([label, value]) => `
    <article class="summary-card">
      <div class="summary-card-label">${label}</div>
      <div class="summary-card-value">${value}</div>
    </article>
  `).join('');

  const regime = snapshot.summary.basis_agg_pct >= 0 ? 'Carry On' : 'Defensive';
  liveRegime.textContent = regime;
  sessionRange.textContent = `${formatPrice(snapshot.summary.low_24h)} → ${formatPrice(snapshot.summary.high_24h)}`;

  thesisList.innerHTML = deriveSessionThesis(snapshot)
    .map(({ label, state: thesisState, value }) => `
      <li>
        <span class="thesis-key">${label}</span>
        <span class="thesis-state">${thesisState}</span>
        <span class="thesis-value">${value}</span>
      </li>
    `)
    .join('');
}

function renderCoverage(data) {
  const referenceTimestamp = lastPointTime(data.spot.bars);
  const rows = [
    ['BN Spot', data.spot.bars, lastPointTime(data.spot.bars)],
    ['BN Perp', data.perp.bars, lastPointTime(data.perp.bars)],
    ['Bybit', data.bybit.bars, lastPointTime(data.bybit.bars)],
    ['DEX', data.dex.bars, lastPointTime(data.dex.bars)],
    ['Basis', data.basis.aggregated, lastPointTime(data.basis.aggregated)],
    ['Perp OI', data.oi.aggregated, lastPointTime(data.oi.aggregated)],
    ['Funding', data.funding.per_source?.['binance-perp'] || [], lastPointTime(data.funding.per_source?.['binance-perp'] || [])]
  ];

  coverageList.innerHTML = rows.map(([label, series, timestamp]) => {
    const count = Array.isArray(series) ? series.length : 0;
    const status = coverageStatus(count);
    const countLabel = status.tone === 'good' ? `${count}` : `${count} ${status.label.toLowerCase()}`;
    return `
        <div class="coverage-item">
          <span class="coverage-item-source">${label}</span>
          <span class="coverage-item-count ${status.tone}">${countLabel}</span>
          <span class="coverage-item-time">${formatCoverageFreshness(timestamp, referenceTimestamp)}</span>
        </div>
    `;
  }).join('');

  const totalSignals = rows.reduce((sum, [, series]) => sum + (Array.isArray(series) ? series.length : 0), 0);
  state.healthLabel = totalSignals >= 700 ? 'Healthy' : 'Partial';
  state.windowLabel = state.replayEvent
    ? `${state.interval.toUpperCase()} · ${formatTimeCompact(state.replayEvent.time)}`
    : `${state.interval.toUpperCase()} · ${formatTimeCompact(lastPointTime(data.spot.bars))}`;
  updateStatusHeadline();
}

function renderReplayEvents(events) {
  replayMeta.textContent = state.replayEvent
    ? `${events?.length || 0} windows · lock`
    : `${events?.length || 0} windows`;

  replayList.innerHTML = (events || []).map((event) => {
    const metrics = summarizeReplayMetrics(event);
    return `
      <button class="replay-item ${state.replayEvent?.id === event.id ? 'active' : ''}" data-replay-id="${event.id}">
        <div class="replay-item-ledger">
          <span class="replay-item-time">${formatReplayTimestamp(event.time)}</span>
          <span class="replay-item-title">${event.title}</span>
          <span class="replay-focus-pill">${compactReplayFocus(event.focus_mode)}</span>
        </div>
        <div class="replay-item-metrics">
          <span>B ${metrics.basis}</span>
          <span>OI ${metrics.oiChange}</span>
          <span>F ${metrics.funding}</span>
        </div>
      </button>
    `;
  }).join('');

  if (!events?.length) {
    replayList.innerHTML = '<div class="loading">No replay windows detected yet.</div>';
  }

  replayList.querySelectorAll('[data-replay-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const event = state.replayEvents.find((entry) => entry.id === button.dataset.replayId);
      if (!event) return;
      applyReplayEvent(event);
    });
  });
}

function makeChart(containerId, opts = {}) {
  const container = document.querySelector(containerId);
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { color: '#06090f' },
      textColor: '#8b96b3',
      fontFamily: '"IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif'
    },
    grid: {
      vertLines: { color: 'rgba(132, 151, 196, 0.035)' },
      horzLines: { color: 'rgba(132, 151, 196, 0.04)' }
    },
    rightPriceScale: {
      borderColor: 'rgba(132, 151, 196, 0.08)'
    },
    timeScale: {
      borderColor: 'rgba(132, 151, 196, 0.08)',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 4
    },
    crosshair: {
      vertLine: { color: 'rgba(90, 209, 255, 0.16)' },
      horzLine: { color: 'rgba(90, 209, 255, 0.16)' }
    },
    ...opts
  });

  return { chart, element: container };
}

function createCharts() {
  charts.price = makeChart('#price-chart');
  charts.price.candles = charts.price.chart.addSeries(CandlestickSeries, {
    upColor: '#19d79d',
    downColor: '#ff6174',
    borderVisible: false,
    wickUpColor: '#19d79d',
    wickDownColor: '#ff6174'
  });
  charts.price.volume = charts.price.chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    color: 'rgba(90, 209, 255, 0.28)'
  });
  charts.price.chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.76, bottom: 0 },
    visible: false
  });
  charts.price.binancePerp = charts.price.chart.addSeries(LineSeries, {
    color: '#ffbc42',
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.price.bybitPerp = charts.price.chart.addSeries(LineSeries, {
    color: '#9a7cff',
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.price.dex = charts.price.chart.addSeries(LineSeries, {
    color: '#5ad1ff',
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
  });

  charts.basis = makeChart('#basis-chart');
  const percentFormat = {
    type: 'custom',
    minMove: 0.0001,
    formatter: (value) => `${Number(value).toFixed(2)}%`
  };
  charts.basis.binance = charts.basis.chart.addSeries(LineSeries, {
    color: '#ffbc42',
    lineWidth: 1,
    priceFormat: percentFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.basis.bybit = charts.basis.chart.addSeries(LineSeries, {
    color: '#9a7cff',
    lineWidth: 1,
    priceFormat: percentFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.basis.agg = charts.basis.chart.addSeries(LineSeries, {
    color: '#5ad1ff',
    lineWidth: 2,
    priceFormat: percentFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });

  charts.oi = makeChart('#oi-chart');
  const oiFormat = {
    type: 'custom',
    minMove: 1,
    formatter: (value) => formatCompact(Number(value))
  };
  charts.oi.binance = charts.oi.chart.addSeries(LineSeries, {
    color: '#ffbc42',
    lineWidth: 1,
    priceFormat: oiFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.oi.bybit = charts.oi.chart.addSeries(LineSeries, {
    color: '#9a7cff',
    lineWidth: 1,
    priceFormat: oiFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.oi.agg = charts.oi.chart.addSeries(LineSeries, {
    color: '#d7dde9',
    lineWidth: 2,
    priceFormat: oiFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });

  charts.funding = makeChart('#funding-chart');
  const fundingFormat = {
    type: 'custom',
    minMove: 0.0001,
    formatter: (value) => formatPercentAxis(value, 4),
  };
  charts.funding.binance = charts.funding.chart.addSeries(LineSeries, {
    color: '#ffbc42',
    lineWidth: 1,
    priceFormat: fundingFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.funding.bybit = charts.funding.chart.addSeries(LineSeries, {
    color: '#9a7cff',
    lineWidth: 1,
    priceFormat: fundingFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.funding.chart.applyOptions({
    rightPriceScale: {
      scaleMargins: { top: 0.14, bottom: 0.2 }
    }
  });

  createActiveChartSync([
    charts.price,
    charts.basis,
    charts.oi,
    charts.funding
  ]);
}

function setVisibleRange(range) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      let fallbackToFitContent = false;
      Object.values(charts).forEach(({ chart }) => {
        try {
          chart.timeScale().setVisibleRange(range);
        } catch (error) {
          fallbackToFitContent = true;
          if (!shouldIgnoreRangeSyncError(error)) {
            console.warn('visible range skipped', error);
          }
        }
      });
      if (fallbackToFitContent) {
        Object.values(charts).forEach(({ chart }) => {
          try {
            chart.timeScale().fitContent();
          } catch (error) {
            if (!shouldIgnoreRangeSyncError(error)) {
              console.warn('fit content skipped', error);
            }
          }
        });
      }
    });
  });
}

function applyRanges(priceBars) {
  const view = getViewConfig(state.interval);
  const range = state.replayEvent
    ? buildReplayRange(state.replayEvent, state.interval)
    : computeVisibleRange(priceBars, state.interval, view.visibleBars);
  setVisibleRange(range);
}

function setFocusMode(mode, { preserveReplay = true } = {}) {
  state.focusMode = mode;
  syncControlButtons();

  const focusMap = buildFocusMap(mode);
  Object.entries(panelElements).forEach(([key, element]) => {
    element.classList.toggle('panel-muted', !focusMap[key]);
  });

  if (!preserveReplay) {
    state.replayEvent = null;
    renderReplayEvents(state.replayEvents);
  }

  updateStatusHeadline();
  persistCockpitPrefs();
  if (state.payload) {
    renderCoverage(state.payload);
  }
}

function applyReplayEvent(event) {
  state.replayEvent = event;
  setFocusMode(event.focus_mode, { preserveReplay: true });
  renderReplayEvents(state.replayEvents);
  renderCoverage(state.payload);
  updateStatusHeadline();
  setVisibleRange(buildReplayRange(event, state.interval));
}

function clearReplayEvent() {
  state.replayEvent = null;
  renderReplayEvents(state.replayEvents);
  updateStatusHeadline();
  if (state.payload) {
    renderCoverage(state.payload);
    applyRanges(state.payload.spot.bars || []);
  }
}

function stepReplayEvent(direction) {
  const nextEvent = resolveReplayNeighbor(
    state.replayEvents,
    state.replayEvent?.id,
    direction === 'next' ? 1 : -1
  );
  if (!nextEvent) {
    return;
  }
  applyReplayEvent(nextEvent);
}

function updatePanelMeta(data) {
  const latestBasis = latestPoint(data.basis.aggregated);
  const latestOiAgg = latestPoint(data.oi.aggregated);
  const latestOiBinance = latestPoint(data.oi.per_source?.['binance-perp'] || []);
  const latestOiBybit = latestPoint(data.oi.per_source?.['bybit-perp'] || []);
  const fundingLatest = ['binance-perp', 'bybit-perp']
    .map((source) => data.funding.per_source?.[source]?.at(-1)?.rate_8h)
    .filter((value) => value != null)
    .map((value) => formatPercent(value * 100, 4));
  priceMeta.textContent = state.replayEvent
    ? `${data.spot.bars.length} ${state.interval.toUpperCase()} · replay lock`
    : `${data.spot.bars.length} ${state.interval.toUpperCase()} · spot + perp + dex`;
  basisMeta.textContent = `${data.basis.aggregated.length} agg · ${formatPercent(latestBasis?.value, 2)}`;
  oiMeta.textContent = `${formatCompact(latestOiAgg?.value)} agg · BN ${formatCompact(latestOiBinance?.value)} · BY ${formatCompact(latestOiBybit?.value)}`;
  const fundingCount = Math.max(
    data.funding.per_source?.['binance-perp']?.length || 0,
    data.funding.per_source?.['bybit-perp']?.length || 0
  );
  fundingMeta.textContent = fundingLatest.length
    ? `${fundingLatest.join(' · ')} latest`
    : `${fundingCount} resets`;
}

async function loadCockpit() {
  const requestId = ++state.loadRequestId;
  const interval = state.interval;
  const view = getViewConfig(interval);
  const minutes = view.lookbackMinutes;
  syncState.textContent = `Loading · ${interval.toUpperCase()}`;
  replayMeta.textContent = 'Loading';
  syncIntervalLoadingState(true);

  try {
    const [snapshot, spot, perp, bybit, dex, basis, oi, funding, replay] = await Promise.all([
      fetchSnapshot(),
      fetchOhlcv('binance-spot', minutes, interval),
      fetchOhlcv('binance-perp', minutes, interval),
      fetchOhlcv('bybit-perp', minutes, interval),
      fetchDex(minutes, interval),
      fetchBasis(minutes * 60, interval),
      fetchOi(minutes, interval),
      fetchFunding(minutes * 60, view.fundingIntervalSeconds),
      fetchReplayEvents(minutes * 60, interval, view.replayLimit)
    ]);

    if (requestId !== state.loadRequestId || interval !== state.interval) {
      return;
    }

    const payload = { snapshot, spot, perp, bybit, dex, basis, oi, funding, replay };
    state.payload = payload;
    state.replayEvents = replay.events || [];

    if (state.replayEvent) {
      state.replayEvent = state.replayEvents.find((event) => event.id === state.replayEvent.id) || null;
    }

    renderSummary(snapshot);
    renderCoverage(payload);
    renderReplayEvents(state.replayEvents);
    updatePanelMeta(payload);
    updateStatusHeadline();

    const pricePrecision = getPricePrecision([
      ...(spot.bars || []),
      ...(perp.bars || []).map((bar) => ({ value: bar.close })),
      ...(bybit.bars || []).map((bar) => ({ value: bar.close })),
      ...(dex.bars || []).map((bar) => ({ value: bar.value }))
    ]);
    const precisePriceFormat = {
      type: 'price',
      precision: pricePrecision.precision,
      minMove: pricePrecision.minMove
    };
    charts.price.candles.applyOptions({ priceFormat: precisePriceFormat });
    charts.price.binancePerp.applyOptions({ priceFormat: precisePriceFormat });
    charts.price.bybitPerp.applyOptions({ priceFormat: precisePriceFormat });
    charts.price.dex.applyOptions({ priceFormat: precisePriceFormat });

    const spotBars = spot.bars || [];
    charts.price.candles.setData(spotBars.map((bar) => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close
    })));
    charts.price.volume.setData(spotBars.map((bar) => ({
      time: bar.time,
      value: bar.volume,
      color: bar.close >= bar.open ? 'rgba(25, 215, 157, 0.35)' : 'rgba(255, 97, 116, 0.35)'
    })));
    charts.price.binancePerp.setData((perp.bars || []).map((bar) => ({ time: bar.time, value: bar.close })));
    charts.price.bybitPerp.setData((bybit.bars || []).map((bar) => ({ time: bar.time, value: bar.close })));
    charts.price.dex.setData((dex.bars || []).map((bar) => ({ time: bar.time, value: bar.value })));

    charts.basis.binance.setData((basis.per_exchange?.binance || []).map((point) => ({ time: point.time, value: point.value })));
    charts.basis.bybit.setData((basis.per_exchange?.bybit || []).map((point) => ({ time: point.time, value: point.value })));
    charts.basis.agg.setData((basis.aggregated || []).map((point) => ({ time: point.time, value: point.value })));

    charts.oi.binance.setData((oi.per_source?.['binance-perp'] || []).map((point) => ({ time: point.time, value: point.value })));
    charts.oi.bybit.setData((oi.per_source?.['bybit-perp'] || []).map((point) => ({ time: point.time, value: point.value })));
    charts.oi.agg.setData((oi.aggregated || []).map((point) => ({ time: point.time, value: point.value })));

    charts.funding.binance.setData((funding.per_source?.['binance-perp'] || []).map((point) => ({ time: point.time, value: point.rate_8h * 100 })));
    charts.funding.bybit.setData((funding.per_source?.['bybit-perp'] || []).map((point) => ({ time: point.time, value: point.rate_8h * 100 })));

    applyRanges(spotBars);
    setFocusMode(state.focusMode, { preserveReplay: true });
  } finally {
    if (requestId === state.loadRequestId) {
      syncIntervalLoadingState(false);
    }
  }
}

function selectInterval(interval) {
  if (!interval || interval === state.interval || !state.supportedIntervals.has(interval)) {
    return;
  }

  state.interval = interval;
  state.replayEvent = null;
  state.replayEvents = [];
  syncControlButtons();
  persistCockpitPrefs();
  replayList.innerHTML = '<span class="loading">Loading interval…</span>';
  loadCockpit().catch((error) => {
    if (state.loadRequestId > 0) {
      console.error(error);
      replayList.innerHTML = `<span class="loading">${error.message}</span>`;
      syncState.textContent = 'Fault';
    }
  });
}

intervalButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectInterval(button.dataset.interval);
  });
});

focusButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setFocusMode(button.dataset.focus, { preserveReplay: true });
  });
});

liveResetButton.addEventListener('click', () => {
  clearReplayEvent();
  setFocusMode('all', { preserveReplay: true });
});

window.addEventListener('keydown', (event) => {
  const action = matchHotkeyAction(event);
  if (!action) {
    return;
  }

  event.preventDefault();

  if (action.type === 'interval') {
    selectInterval(action.value);
    return;
  }

  if (action.type === 'focus') {
    setFocusMode(action.value, { preserveReplay: true });
    return;
  }

  if (action.type === 'replay') {
    stepReplayEvent(action.value);
    return;
  }

  clearReplayEvent();
  setFocusMode('all', { preserveReplay: true });
});

createCharts();
syncControlButtons();
hydrateOptionalIntervals()
  .then(() => loadCockpit())
  .catch((error) => {
  console.error(error);
  replayList.innerHTML = `<span class="loading">${error.message}</span>`;
  syncState.textContent = 'Fault';
  });
