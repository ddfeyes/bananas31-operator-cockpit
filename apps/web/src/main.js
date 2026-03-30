import './styles.css';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import { fetchBasis, fetchFunding, fetchOhlcv, fetchOi, fetchReplayEvents, fetchSnapshot } from './lib/api.js';
import { computeVisibleRange, createActiveChartSync, INTERVAL_TO_SECONDS, shouldIgnoreRangeSyncError } from './lib/chartSync.js';
import { matchHotkeyAction, readStoredCockpitPrefs, resolveReplayNeighbor, writeStoredCockpitPrefs } from './lib/cockpitState.js';
import { formatCompact, formatPercent, formatPrice, getPricePrecision } from './lib/formatters.js';
import {
  buildFocusMap,
  buildReplayRange,
  compactReplayFocus,
  formatReplayTimestamp,
  pickReplayModeLabel,
  summarizeReplayLine
} from './lib/replay.js';

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

      <aside class="command-rail">
        <article class="panel rail-card">
          <div class="panel-header">
            <div>
              <h2 class="panel-title">Replay Tape</h2>
            </div>
            <span class="panel-meta" id="replay-meta">J/K step · Esc live</span>
          </div>
          <div class="replay-list" id="replay-list"></div>
        </article>
      </aside>
    </section>

    <section class="support-grid">
      <article class="support-card support-cluster">
        <div class="support-head">
          <p class="support-kicker">Coverage</p>
          <span class="support-meta">Bars · freshness</span>
        </div>
        <div class="coverage-list" id="coverage-list"></div>
      </article>

      <article class="support-card support-cluster">
        <div class="support-head">
          <p class="support-kicker">Reading</p>
          <span class="support-meta">Current posture</span>
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
  replayEvent: null,
  replayEvents: [],
  payload: null,
  healthLabel: 'Connecting',
  windowLabel: 'Waiting'
};

function persistCockpitPrefs() {
  writeStoredCockpitPrefs(undefined, {
    interval: state.interval,
    focusMode: state.focusMode
  });
}

function syncControlButtons() {
  intervalButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.interval === state.interval);
  });
  focusButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.focus === state.focusMode);
  });
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

function barsLabel(count) {
  return `${count} ${state.interval.toUpperCase()} bars`;
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
    items.push(['Carry', `Defensive · ${formatPercent(basis, 2)}`]);
  } else {
    items.push(['Carry', `Engaged · ${formatPercent(basis, 2)}`]);
  }

  if (funding > 0.05) {
    items.push(['Funding', `Hot · ${formatPercent(funding, 4)}`]);
  } else if (funding < 0) {
    items.push(['Funding', 'Negative · squeeze risk']);
  } else {
    items.push(['Funding', `Calm · ${formatPercent(funding, 4)}`]);
  }

  if (oi >= 7_500_000_000) {
    items.push(['Leverage', `Heavy · ${formatCompact(oi)}`]);
  } else {
    items.push(['Leverage', `Moderate · ${formatCompact(oi)}`]);
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
    .map(([label, value]) => `
      <li>
        <span class="thesis-key">${label}</span>
        <span class="thesis-value">${value}</span>
      </li>
    `)
    .join('');
}

function renderCoverage(data) {
  const rows = [
    ['BN Spot', data.spot.bars, lastPointTime(data.spot.bars)],
    ['BN Perp', data.perp.bars, lastPointTime(data.perp.bars)],
    ['Bybit', data.bybit.bars, lastPointTime(data.bybit.bars)],
    ['Basis', data.basis.aggregated, lastPointTime(data.basis.aggregated)],
    ['Perp OI', data.oi.aggregated, lastPointTime(data.oi.aggregated)],
    ['Funding', data.funding.per_source?.['binance-perp'] || [], lastPointTime(data.funding.per_source?.['binance-perp'] || [])]
  ];

  coverageList.innerHTML = rows.map(([label, series, timestamp]) => {
    const count = Array.isArray(series) ? series.length : 0;
    const status = coverageStatus(count);
    return `
        <div class="coverage-item">
          <span class="coverage-item-source">${label}</span>
          <span class="coverage-item-count ${status.tone}">${count}</span>
          <span class="coverage-item-time">${formatLedgerTimestamp(timestamp)}</span>
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
    ? `${events?.length || 0} locked`
    : `${events?.length || 0} latest`;

  replayList.innerHTML = (events || []).map((event) => {
    const metricLine = summarizeReplayLine(event);
    return `
      <button class="replay-item ${state.replayEvent?.id === event.id ? 'active' : ''}" data-replay-id="${event.id}">
        <div class="replay-item-ledger">
          <span class="replay-item-time">${formatReplayTimestamp(event.time)}</span>
          <span class="replay-item-title">${event.title}</span>
          <span class="replay-focus-pill">${compactReplayFocus(event.focus_mode)}</span>
        </div>
        <div class="replay-item-metrics">${metricLine}</div>
        ${state.replayEvent?.id === event.id ? `<div class="replay-item-copy">${event.summary}</div>` : ''}
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
    lineWidth: 1
  });
  charts.price.bybitPerp = charts.price.chart.addSeries(LineSeries, {
    color: '#9a7cff',
    lineWidth: 1
  });

  charts.basis = makeChart('#basis-chart');
  charts.basis.binance = charts.basis.chart.addSeries(LineSeries, { color: '#ffbc42', lineWidth: 1 });
  charts.basis.bybit = charts.basis.chart.addSeries(LineSeries, { color: '#9a7cff', lineWidth: 1 });
  charts.basis.agg = charts.basis.chart.addSeries(LineSeries, { color: '#5ad1ff', lineWidth: 2 });

  charts.oi = makeChart('#oi-chart');
  charts.oi.binance = charts.oi.chart.addSeries(LineSeries, { color: '#ffbc42', lineWidth: 1 });
  charts.oi.bybit = charts.oi.chart.addSeries(LineSeries, { color: '#9a7cff', lineWidth: 1 });
  charts.oi.agg = charts.oi.chart.addSeries(LineSeries, { color: '#d7dde9', lineWidth: 2 });

  charts.funding = makeChart('#funding-chart');
  charts.funding.binance = charts.funding.chart.addSeries(LineSeries, { color: '#ffbc42', lineWidth: 1 });
  charts.funding.bybit = charts.funding.chart.addSeries(LineSeries, { color: '#9a7cff', lineWidth: 1 });

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
      Object.values(charts).forEach(({ chart }) => {
        try {
          chart.timeScale().setVisibleRange(range);
        } catch (error) {
          if (!shouldIgnoreRangeSyncError(error)) {
            console.warn('visible range skipped', error);
          }
        }
      });
    });
  });
}

function applyRanges(priceBars) {
  const range = state.replayEvent
    ? buildReplayRange(state.replayEvent, state.interval)
    : computeVisibleRange(priceBars, state.interval);
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
  priceMeta.textContent = state.replayEvent
    ? `${data.spot.bars.length} ${state.interval.toUpperCase()} · replay lock`
    : `${data.spot.bars.length} ${state.interval.toUpperCase()} · spot + perp`;
  basisMeta.textContent = `${data.basis.aggregated.length} agg · 2 venues`;
  oiMeta.textContent = `${data.oi.aggregated.length} agg · perp only`;
  fundingMeta.textContent = `${(data.funding.per_source?.['binance-perp'] || []).length} resets`;
}

async function loadCockpit() {
  const minutes = state.interval === '1d'
    ? 60 * 24 * 120
    : state.interval === '1h'
      ? 60 * 24 * 14
      : 60 * 24 * 30;

  const [snapshot, spot, perp, bybit, basis, oi, funding, replay] = await Promise.all([
    fetchSnapshot(),
    fetchOhlcv('binance-spot', minutes, state.interval),
    fetchOhlcv('binance-perp', minutes, state.interval),
    fetchOhlcv('bybit-perp', minutes, state.interval),
    fetchBasis(minutes * 60, state.interval),
    fetchOi(minutes, state.interval),
    fetchFunding(minutes * 60, INTERVAL_TO_SECONDS[state.interval] || 14400),
    fetchReplayEvents(minutes * 60, state.interval, 6)
  ]);

  const payload = { snapshot, spot, perp, bybit, basis, oi, funding, replay };
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
    ...(bybit.bars || []).map((bar) => ({ value: bar.close }))
  ]);
  const precisePriceFormat = {
    type: 'price',
    precision: pricePrecision.precision,
    minMove: pricePrecision.minMove
  };
  charts.price.candles.applyOptions({ priceFormat: precisePriceFormat });
  charts.price.binancePerp.applyOptions({ priceFormat: precisePriceFormat });
  charts.price.bybitPerp.applyOptions({ priceFormat: precisePriceFormat });

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

  charts.basis.binance.setData((basis.per_exchange?.binance || []).map((point) => ({ time: point.time, value: point.value })));
  charts.basis.bybit.setData((basis.per_exchange?.bybit || []).map((point) => ({ time: point.time, value: point.value })));
  charts.basis.agg.setData((basis.aggregated || []).map((point) => ({ time: point.time, value: point.value })));

  charts.oi.binance.setData((oi.per_source?.['binance-perp'] || []).map((point) => ({ time: point.time, value: point.value })));
  charts.oi.bybit.setData((oi.per_source?.['bybit-perp'] || []).map((point) => ({ time: point.time, value: point.value })));
  charts.oi.agg.setData((oi.aggregated || []).map((point) => ({ time: point.time, value: point.value })));

  charts.funding.binance.setData((funding.per_source?.['binance-perp'] || []).map((point) => ({ time: point.time, value: point.rate_8h })));
  charts.funding.bybit.setData((funding.per_source?.['bybit-perp'] || []).map((point) => ({ time: point.time, value: point.rate_8h })));

  applyRanges(spotBars);
  setFocusMode(state.focusMode, { preserveReplay: true });
}

function selectInterval(interval) {
  if (!interval || interval === state.interval) {
    return;
  }

  state.interval = interval;
  syncControlButtons();
  persistCockpitPrefs();
  loadCockpit().catch((error) => {
    console.error(error);
    replayList.innerHTML = `<span class="loading">${error.message}</span>`;
    dataHealth.textContent = 'Fault';
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
loadCockpit().catch((error) => {
  console.error(error);
  replayList.innerHTML = `<span class="loading">${error.message}</span>`;
  dataHealth.textContent = 'Fault';
});
