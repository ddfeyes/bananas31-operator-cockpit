import './styles.css';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import {
  fetchProjects,
  fetchBasis,
  fetchDex,
  fetchFunding,
  fetchOhlcv,
  fetchOi,
  fetchReplayEvents,
  fetchSnapshot,
  probeCockpitIntervalSupport
} from './lib/api.js';
import {
  computeVisibleRange,
  createActiveChartSync,
  createNearestPointLookup,
  shouldIgnoreRangeSyncError
} from './lib/chartSync.js';
import { matchHotkeyAction, readStoredCockpitPrefs, resolveReplayNeighbor, writeStoredCockpitPrefs } from './lib/cockpitState.js';
import { formatCompact, formatPercent, formatPrice, getPricePrecision } from './lib/formatters.js';
import { DEFAULT_LAYOUT_STATE, readStoredLayoutState, rebalancePairWeights, writeStoredLayoutState } from './lib/layoutState.js';
import { deriveMarketDiagnostics } from './lib/diagnostics.js';
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
            <p class="brand-kicker" id="brand-kicker">BANANAS31</p>
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
      <div class="toolbar-group project-group" id="project-group"></div>

      <div class="toolbar-group" id="interval-group">
        <button data-interval="1m" data-optional-interval hidden disabled aria-hidden="true">1M</button>
        <button data-interval="5m" data-optional-interval hidden disabled aria-hidden="true">5M</button>
        <button data-interval="30m" data-optional-interval hidden disabled aria-hidden="true">30M</button>
        <button data-interval="1h">1H</button>
        <button data-interval="4h" class="active">4H</button>
        <button data-interval="1d">1D</button>
      </div>

      <div class="toolbar-group panel-group" id="panel-group">
        <button data-panel-toggle="basis" class="active">Basis</button>
        <button data-panel-toggle="oi" class="active">Perp OI</button>
        <button data-panel-toggle="funding" class="active">Funding</button>
        <button data-panel-toggle="replay" class="active">Incidents</button>
        <button data-panel-toggle="coverage" class="active">Coverage</button>
        <button data-panel-toggle="reading" class="active">Pulse</button>
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

        <div class="row-resizer" id="hero-resizer" data-resize-group="hero" role="separator" aria-label="Resize chart stage"></div>

        <div class="analytics-row" id="analytics-row">
          <article class="panel" id="basis-panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">Basis</h2>
              </div>
              <span class="panel-meta" id="basis-meta">Aggregated venue spread</span>
            </div>
            <div class="chart-slot chart-slot-compact" id="basis-chart"></div>
          </article>

          <div class="panel-splitter" data-resize-group="analytics" data-left="basis" data-right="oi" role="separator" aria-label="Resize basis and OI panels"></div>

          <article class="panel" id="oi-panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">Perp OI</h2>
              </div>
              <div class="panel-header-actions">
                <div class="series-toggle-group" id="oi-toggle-group">
                  <button data-oi-series="agg" class="active">Agg</button>
                  <button data-oi-series="binance" class="active">BN</button>
                  <button data-oi-series="bybit">BY</button>
                </div>
                <span class="panel-meta" id="oi-meta">Aggregated and venue split</span>
              </div>
            </div>
            <div class="chart-slot chart-slot-compact" id="oi-chart"></div>
          </article>

          <div class="panel-splitter" data-resize-group="analytics" data-left="oi" data-right="funding" role="separator" aria-label="Resize OI and funding panels"></div>

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

    <section class="support-grid" id="support-grid">
      <article class="support-card support-cluster support-replay">
        <div class="support-head">
          <p class="support-kicker">Incidents</p>
          <span class="support-meta" id="replay-meta">6 windows</span>
        </div>
        <div class="replay-list" id="replay-list"></div>
      </article>

      <div class="panel-splitter panel-splitter-support" data-resize-group="support" data-left="replay" data-right="coverage" role="separator" aria-label="Resize incidents and coverage panels"></div>

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

      <div class="panel-splitter panel-splitter-support" data-resize-group="support" data-left="coverage" data-right="reading" role="separator" aria-label="Resize coverage and pulse panels"></div>

      <article class="support-card support-cluster">
        <div class="support-head">
          <p class="support-kicker">Pulse</p>
          <div class="support-columns thesis-columns">
            <span>Metric</span>
            <span>Read</span>
            <span>Now</span>
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
const brandKicker = document.querySelector('#brand-kicker');
const projectGroup = document.querySelector('#project-group');
const intervalButtons = [...document.querySelectorAll('[data-interval]')];
const focusButtons = [...document.querySelectorAll('[data-focus]')];
const panelToggleButtons = [...document.querySelectorAll('[data-panel-toggle]')];
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
const analyticsRow = document.querySelector('#analytics-row');
const supportGrid = document.querySelector('#support-grid');
const chartStage = document.querySelector('.chart-stage');
const heroResizer = document.querySelector('#hero-resizer');
const analyticsSplitters = [...document.querySelectorAll('[data-resize-group="analytics"]')];
const supportSplitters = [...document.querySelectorAll('[data-resize-group="support"]')];
const oiSeriesButtons = [...document.querySelectorAll('[data-oi-series]')];
const DEFAULT_INTERVAL = '4h';
const BASE_INTERVALS = new Set(['1h', '4h', '1d']);
const MIN_PANEL_WEIGHT = 0.18;
const CHART_STYLE = {
  background: '#120a07',
  text: '#d5c4b0',
  grid: 'rgba(190, 155, 115, 0.14)',
  border: 'rgba(190, 155, 115, 0.14)',
  crosshair: 'rgba(230, 177, 125, 0.14)',
  volBull: 'rgba(88, 192, 129, 0.32)',
  volBear: 'rgba(255, 111, 131, 0.32)',
  upCandle: '#3dd8a5',
  downCandle: '#ff6d77',
  candleWickUp: '#3dd8a5',
  candleWickDown: '#ff6d77',
  lineBinance: '#f0b97a',
  lineBybit: '#c68e72',
  lineDex: '#b6a18f',
  lineAgg: '#8fb8ab',
};

const charts = {};
let chartSyncController = null;
const persistedPrefs = readStoredCockpitPrefs();
const persistedLayout = readStoredLayoutState();
const panelElements = {
  price: document.querySelector('#price-panel'),
  basis: document.querySelector('#basis-panel'),
  oi: document.querySelector('#oi-panel'),
  funding: document.querySelector('#funding-panel'),
  replay: document.querySelector('.support-replay'),
  coverage: document.querySelector('#coverage-list')?.closest('.support-card'),
  reading: document.querySelector('#thesis-list')?.closest('.support-card')
};

const state = {
  projectId: persistedPrefs.projectId,
  projects: [],
  interval: persistedPrefs.interval,
  focusMode: persistedPrefs.focusMode,
  supportedIntervals: new Set(BASE_INTERVALS),
  replayEvent: null,
  replayEvents: [],
  payload: null,
  diagnostics: null,
  healthLabel: 'Connecting',
  windowLabel: 'Waiting',
  loadRequestId: 0,
  layout: persistedLayout,
  hoveredTime: null,
  chartLookups: {
    price: () => null,
    basis: () => null,
    oi: () => null,
    funding: () => null,
  },
};

function persistCockpitPrefs() {
  writeStoredCockpitPrefs(undefined, {
    projectId: state.projectId,
    interval: state.interval,
    focusMode: state.focusMode
  });
}

function persistLayoutState() {
  writeStoredLayoutState(undefined, state.layout);
}

function getActiveProject() {
  return state.projects.find((project) => project.id === state.projectId) || null;
}

function renderProjectButtons() {
  projectGroup.innerHTML = state.projects.map((project) => `
    <button data-project-id="${project.id}" class="${project.id === state.projectId ? 'active' : ''}">
      ${project.label}
    </button>
  `).join('');

  projectGroup.querySelectorAll('[data-project-id]').forEach((button) => {
    button.addEventListener('click', () => {
      selectProject(button.dataset.projectId);
    });
  });
}

function syncControlButtons() {
  projectGroup.querySelectorAll('[data-project-id]').forEach((button) => {
    button.classList.toggle('active', button.dataset.projectId === state.projectId);
  });
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
  panelToggleButtons.forEach((button) => {
    const key = button.dataset.panelToggle;
    const visible = state.layout.panels[key] !== false;
    button.classList.toggle('active', visible);
  });
  oiSeriesButtons.forEach((button) => {
    const key = button.dataset.oiSeries;
    button.classList.toggle('active', state.layout.oiSeries[key] !== false);
  });
}

function syncIntervalLoadingState(loading) {
  intervalButtons.forEach((button) => {
    button.disabled = loading || !state.supportedIntervals.has(button.dataset.interval);
  });
}

function visiblePanelKeys(group) {
  const keys = group === 'analytics'
    ? ['basis', 'oi', 'funding']
    : ['replay', 'coverage', 'reading'];
  const visible = keys.filter((key) => state.layout.panels[key] !== false);
  return visible.length ? visible : [keys[0]];
}

function applyFlexWeights(container, keys, weights) {
  container.style.setProperty('--visible-count', String(keys.length));
  keys.forEach((key) => {
    const element = panelElements[key];
    if (!element) return;
    element.hidden = false;
    element.style.flex = `${weights[key] || 1} 1 0px`;
  });
}

function updateSplitterVisibility(splitters, visibleKeys) {
  splitters.forEach((splitter) => {
    const left = splitter.dataset.left;
    const right = splitter.dataset.right;
    splitter.hidden = !(visibleKeys.includes(left) && visibleKeys.includes(right));
  });
}

function applyLayoutState() {
  chartStage?.style.setProperty('--hero-height', `${state.layout.heroHeight}px`);

  const visibleAnalytics = visiblePanelKeys('analytics');
  const visibleSupport = visiblePanelKeys('support');

  ['basis', 'oi', 'funding'].forEach((key) => {
    const element = panelElements[key];
    if (!element) return;
    element.hidden = !visibleAnalytics.includes(key);
  });
  ['replay', 'coverage', 'reading'].forEach((key) => {
    const element = panelElements[key];
    if (!element) return;
    element.hidden = !visibleSupport.includes(key);
  });

  applyFlexWeights(analyticsRow, visibleAnalytics, state.layout.analyticsWeights);
  applyFlexWeights(supportGrid, visibleSupport, state.layout.supportWeights);
  updateSplitterVisibility(analyticsSplitters, visibleAnalytics);
  updateSplitterVisibility(supportSplitters, visibleSupport);
  syncControlButtons();
}

function togglePanel(key) {
  if (!(key in state.layout.panels)) return;
  const groupKeys = key === 'basis' || key === 'oi' || key === 'funding'
    ? ['basis', 'oi', 'funding']
    : ['replay', 'coverage', 'reading'];
  const currentlyVisible = groupKeys.filter((panelKey) => state.layout.panels[panelKey] !== false);
  if (currentlyVisible.length === 1 && currentlyVisible[0] === key) {
    return;
  }
  state.layout.panels[key] = !(state.layout.panels[key] !== false);
  persistLayoutState();
  applyLayoutState();
}

function toggleOiSeries(key) {
  if (!(key in state.layout.oiSeries)) return;
  const active = Object.entries(state.layout.oiSeries)
    .filter(([, value]) => value !== false)
    .map(([seriesKey]) => seriesKey);
  if (active.length === 1 && active[0] === key) {
    return;
  }
  state.layout.oiSeries[key] = !(state.layout.oiSeries[key] !== false);
  applyOiSeriesVisibility();
  if (state.payload) {
    const oi = state.payload.oi;
    const activeOiSeries = state.layout.oiSeries.agg !== false
      ? (oi.aggregated || [])
      : state.layout.oiSeries.binance !== false
        ? (oi.per_source?.['binance-perp'] || [])
        : (oi.per_source?.['bybit-perp'] || []);
    state.chartLookups.oi = createNearestPointLookup(activeOiSeries, (point) => point.value);
    updatePanelMeta(state.payload);
  }
  persistLayoutState();
  syncControlButtons();
}

async function hydrateOptionalIntervals() {
  state.supportedIntervals = new Set(BASE_INTERVALS);
  const optionalIntervals = ['1m', '5m', '30m'];
  const results = await Promise.all(
    optionalIntervals.map(async (interval) => [
      interval,
      await probeCockpitIntervalSupport(state.projectId, interval, getViewConfig(interval))
    ])
  );
  results.forEach(([interval, supported]) => {
    if (supported) {
      state.supportedIntervals.add(interval);
    } else {
      state.supportedIntervals.delete(interval);
      if (state.interval === interval) {
        state.interval = DEFAULT_INTERVAL;
        persistCockpitPrefs();
      }
    }
  });
  syncControlButtons();
}

function installResizer(handle, group, leftKey, rightKey) {
  if (!handle) return;
  handle.addEventListener('pointerdown', (event) => {
    const visibleKeys = visiblePanelKeys(group);
    if (!(visibleKeys.includes(leftKey) && visibleKeys.includes(rightKey))) {
      return;
    }

    const container = group === 'analytics' ? analyticsRow : supportGrid;
    const leftElement = panelElements[leftKey];
    const rightElement = panelElements[rightKey];
    if (!container || !leftElement || !rightElement) return;

    const containerRect = container.getBoundingClientRect();
    const leftRect = leftElement.getBoundingClientRect();
    const rightRect = rightElement.getBoundingClientRect();
    const totalWidth = leftRect.width + rightRect.width;
    const startX = event.clientX;
    const startLeft = leftRect.width;
    const weightKey = group === 'analytics' ? 'analyticsWeights' : 'supportWeights';
    const currentWeights = state.layout[weightKey];
    const pairWeight = (currentWeights[leftKey] || 0.5) + (currentWeights[rightKey] || 0.5);

    const move = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const minWidth = Math.max(containerRect.width * MIN_PANEL_WEIGHT, 180);
      const nextLeft = Math.min(totalWidth - minWidth, Math.max(minWidth, startLeft + delta));
      const ratio = nextLeft / totalWidth;
      state.layout[weightKey] = rebalancePairWeights({
        ...state.layout[weightKey],
        [leftKey]: pairWeight / 2,
        [rightKey]: pairWeight / 2,
      }, leftKey, rightKey, ratio);
      applyLayoutState();
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      persistLayoutState();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  });
}

function installHeroResizer() {
  if (!heroResizer || !chartStage) return;
  heroResizer.addEventListener('pointerdown', (event) => {
    const startY = event.clientY;
    const startHeight = state.layout.heroHeight;
    const move = (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      state.layout.heroHeight = Math.round(Math.min(960, Math.max(320, startHeight + delta)));
      applyLayoutState();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      persistLayoutState();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
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

function updateStatusHeadline() {
  syncState.textContent = `${pickReplayModeLabel(state.replayEvent, state.focusMode)} · ${state.windowLabel} · ${state.healthLabel}`;
  replayIndicatorButton.textContent = state.replayEvent
    ? compactReplayFocus(state.replayEvent.focus_mode)
    : 'Idle';
  replayIndicatorButton.classList.toggle('active', Boolean(state.replayEvent));
  liveResetButton.classList.toggle('active', !state.replayEvent);
}

function renderSummary(snapshot, diagnostics) {
  const activeProject = snapshot.project || getActiveProject();
  const hasDex = activeProject?.has_dex !== false;
  brandKicker.textContent = activeProject?.label || 'PROJECT';
  document.title = `${activeProject?.label || 'Project'} Operator Cockpit`;
  const cards = [
    ['Spot', formatPrice(snapshot.prices['binance-spot'])],
    ['Perp', formatPrice(snapshot.prices['binance-perp'])],
    ['Basis', formatPercent(snapshot.summary.basis_agg_pct, 4)],
    ['Bybit', formatPrice(snapshot.prices['bybit-perp'])],
    ['Perp OI', formatCompact(snapshot.summary.oi_total)]
  ];
  if (hasDex) {
    cards.splice(2, 0, ['DEX', formatPrice(snapshot.prices.dex)]);
  }

  summaryGrid.innerHTML = cards.map(([label, value]) => `
    <article class="summary-card">
      <div class="summary-card-label">${label}</div>
      <div class="summary-card-value">${value}</div>
    </article>
  `).join('');

  liveRegime.textContent = diagnostics?.regime || (snapshot.summary.basis_agg_pct >= 0 ? 'Carry On' : 'Defensive');
  sessionRange.textContent = `${formatPrice(snapshot.summary.low_24h)} → ${formatPrice(snapshot.summary.high_24h)}`;
}

function renderDiagnostics(diagnostics) {
  thesisList.innerHTML = (diagnostics?.items || []).map(({ label, state: thesisState, value, detail }) => `
    <li>
      <div class="thesis-row">
        <span class="thesis-key">${label}</span>
        <span class="thesis-state">${thesisState}</span>
        <span class="thesis-value">${value}</span>
      </div>
      <div class="thesis-detail">${detail || ''}</div>
    </li>
  `).join('');
}

function renderCoverage(data) {
  const referenceTimestamp = lastPointTime(data.spot.bars);
  const rows = [
    ['BN Spot', data.spot.bars, lastPointTime(data.spot.bars)],
    ['BN Perp', data.perp.bars, lastPointTime(data.perp.bars)],
    ['Bybit', data.bybit.bars, lastPointTime(data.bybit.bars)],
    ['Basis', data.basis.aggregated, lastPointTime(data.basis.aggregated)],
    ['Perp OI', data.oi.aggregated, lastPointTime(data.oi.aggregated)],
    ['Funding', data.funding.per_source?.['binance-perp'] || [], lastPointTime(data.funding.per_source?.['binance-perp'] || [])]
  ];
  if (data.snapshot.project?.has_dex) {
    rows.splice(3, 0, ['DEX', data.dex.bars, lastPointTime(data.dex.bars)]);
  }

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
    ? `${events?.length || 0} incidents · lock`
    : `${events?.length || 0} incidents`;

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
          <span>Basis ${metrics.basis}</span>
          <span>OI ${metrics.oiChange}</span>
          <span>Funding ${metrics.funding}</span>
        </div>
      </button>
    `;
  }).join('');

  if (!events?.length) {
    replayList.innerHTML = '<div class="loading">No incidents detected yet.</div>';
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
      background: { color: CHART_STYLE.background },
      textColor: CHART_STYLE.text,
      fontFamily: '"IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif'
    },
    grid: {
      vertLines: { color: CHART_STYLE.grid },
      horzLines: { color: CHART_STYLE.grid }
    },
    rightPriceScale: {
      borderColor: CHART_STYLE.border
    },
    timeScale: {
      borderColor: CHART_STYLE.border,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 4
    },
    crosshair: {
      vertLine: { color: CHART_STYLE.crosshair },
      horzLine: { color: CHART_STYLE.crosshair }
    },
    ...opts
  });

  return { chart, element: container };
}

function createCharts() {
  charts.price = makeChart('#price-chart');
  charts.price.candles = charts.price.chart.addSeries(CandlestickSeries, {
    upColor: CHART_STYLE.upCandle,
    downColor: CHART_STYLE.downCandle,
    borderVisible: false,
    wickUpColor: CHART_STYLE.candleWickUp,
    wickDownColor: CHART_STYLE.candleWickDown
  });
  charts.price.volume = charts.price.chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    color: CHART_STYLE.volBull
  });
  charts.price.chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.76, bottom: 0 },
    visible: false
  });
  charts.price.binancePerp = charts.price.chart.addSeries(LineSeries, {
    color: CHART_STYLE.lineBinance,
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.price.bybitPerp = charts.price.chart.addSeries(LineSeries, {
    color: CHART_STYLE.lineBybit,
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.price.dex = charts.price.chart.addSeries(LineSeries, {
    color: CHART_STYLE.lineDex,
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
    color: CHART_STYLE.lineBinance,
    lineWidth: 1,
    priceFormat: percentFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.basis.bybit = charts.basis.chart.addSeries(LineSeries, {
    color: CHART_STYLE.lineBybit,
    lineWidth: 1,
    priceFormat: percentFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.basis.agg = charts.basis.chart.addSeries(LineSeries, {
    color: CHART_STYLE.lineAgg,
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
    color: CHART_STYLE.lineBinance,
    lineWidth: 1,
    priceFormat: oiFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.oi.bybit = charts.oi.chart.addSeries(LineSeries, {
    color: CHART_STYLE.lineBybit,
    lineWidth: 1,
    priceScaleId: 'left',
    priceFormat: oiFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.oi.agg = charts.oi.chart.addSeries(LineSeries, {
    color: CHART_STYLE.lineAgg,
    lineWidth: 2,
    priceFormat: oiFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.oi.chart.priceScale('left').applyOptions({
    visible: false,
    scaleMargins: { top: 0.1, bottom: 0.1 },
  });

  charts.funding = makeChart('#funding-chart');
  const fundingFormat = {
    type: 'custom',
    minMove: 0.0001,
    formatter: (value) => formatPercentAxis(value, 4),
  };
  charts.funding.binance = charts.funding.chart.addSeries(LineSeries, {
    color: CHART_STYLE.lineBinance,
    lineWidth: 1,
    priceFormat: fundingFormat,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  charts.funding.bybit = charts.funding.chart.addSeries(LineSeries, {
    color: CHART_STYLE.lineBybit,
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

  chartSyncController = createActiveChartSync([
    {
      ...charts.price,
      crosshairSeries: charts.price.candles,
      lookupPoint: (time) => state.chartLookups.price(time),
    },
    {
      ...charts.basis,
      crosshairSeries: charts.basis.agg,
      lookupPoint: (time) => state.chartLookups.basis(time),
    },
    {
      ...charts.oi,
      crosshairSeries: charts.oi.agg,
      lookupPoint: (time) => state.chartLookups.oi(time),
    },
    {
      ...charts.funding,
      crosshairSeries: charts.funding.binance,
      lookupPoint: (time) => state.chartLookups.funding(time),
    }
  ]);
}

function applyOiSeriesVisibility() {
  if (!charts.oi?.agg) return;
  charts.oi.agg.applyOptions({ visible: state.layout.oiSeries.agg !== false });
  charts.oi.binance.applyOptions({ visible: state.layout.oiSeries.binance !== false });
  charts.oi.bybit.applyOptions({ visible: state.layout.oiSeries.bybit === true });
}

function setVisibleRange(range) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      let fallbackToFitContent = false;
      chartSyncController?.suspend();
      Object.values(charts).forEach(({ chart }) => {
        try {
          chart.timeScale().fitContent();
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
      chartSyncController?.activate(charts.price?.chart);
      chartSyncController?.resume();
      chartSyncController?.syncRange(range, charts.price?.chart);
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
  const hasDex = data.snapshot.project?.has_dex;
  const latestBasis = latestPoint(data.basis.aggregated);
  const latestOiAgg = latestPoint(data.oi.aggregated);
  const latestOiBinance = latestPoint(data.oi.per_source?.['binance-perp'] || []);
  const latestOiBybit = latestPoint(data.oi.per_source?.['bybit-perp'] || []);
  const oiSources = [
    state.layout.oiSeries.agg !== false ? 'Agg' : null,
    state.layout.oiSeries.binance !== false ? 'BN' : null,
    state.layout.oiSeries.bybit === true ? 'BY' : null,
  ].filter(Boolean).join(' · ');
  const fundingLatest = ['binance-perp', 'bybit-perp']
    .map((source) => data.funding.per_source?.[source]?.at(-1)?.rate_8h)
    .filter((value) => value != null)
    .map((value) => formatPercent(value * 100, 4));
  priceMeta.textContent = state.replayEvent
    ? `${data.spot.bars.length} ${state.interval.toUpperCase()} · replay lock`
    : `${data.spot.bars.length} ${state.interval.toUpperCase()} · spot + perp${hasDex ? ' + dex' : ''}`;
  basisMeta.textContent = `${data.basis.aggregated.length} agg · ${formatPercent(latestBasis?.value, 2)}`;
  oiMeta.textContent = `${oiSources || 'No sources'} · ${formatCompact(latestOiAgg?.value)} agg · BN ${formatCompact(latestOiBinance?.value)} · BY ${formatCompact(latestOiBybit?.value)}`;
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
      fetchSnapshot(state.projectId),
      fetchOhlcv(state.projectId, 'binance-spot', minutes, interval),
      fetchOhlcv(state.projectId, 'binance-perp', minutes, interval),
      fetchOhlcv(state.projectId, 'bybit-perp', minutes, interval),
      fetchDex(state.projectId, minutes, interval),
      fetchBasis(state.projectId, minutes * 60, interval),
      fetchOi(state.projectId, minutes, interval),
      fetchFunding(state.projectId, minutes * 60, view.fundingIntervalSeconds),
      fetchReplayEvents(state.projectId, minutes * 60, interval, view.replayLimit)
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

    const diagnostics = deriveMarketDiagnostics(payload, interval);
    state.diagnostics = diagnostics;
    renderSummary(snapshot, diagnostics);
    renderDiagnostics(diagnostics);
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
      color: bar.close >= bar.open ? CHART_STYLE.volBull : CHART_STYLE.volBear
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
    applyOiSeriesVisibility();

    charts.funding.binance.setData((funding.per_source?.['binance-perp'] || []).map((point) => ({ time: point.time, value: point.rate_8h * 100 })));
    charts.funding.bybit.setData((funding.per_source?.['bybit-perp'] || []).map((point) => ({ time: point.time, value: point.rate_8h * 100 })));

    state.chartLookups.price = createNearestPointLookup(spotBars, (point) => point.close);
    state.chartLookups.basis = createNearestPointLookup(basis.aggregated || [], (point) => point.value);
    const activeOiSeries = state.layout.oiSeries.agg !== false
      ? (oi.aggregated || [])
      : state.layout.oiSeries.binance !== false
        ? (oi.per_source?.['binance-perp'] || [])
        : (oi.per_source?.['bybit-perp'] || []);
    state.chartLookups.oi = createNearestPointLookup(activeOiSeries, (point) => point.value);
    state.chartLookups.funding = createNearestPointLookup(
      funding.per_source?.['binance-perp']?.length
        ? funding.per_source['binance-perp'].map((point) => ({ time: point.time, value: point.rate_8h * 100 }))
        : (funding.per_source?.['bybit-perp'] || []).map((point) => ({ time: point.time, value: point.rate_8h * 100 })),
      (point) => point.value
    );

    applyRanges(spotBars);
    setFocusMode(state.focusMode, { preserveReplay: true });
  } finally {
    if (requestId === state.loadRequestId) {
      syncIntervalLoadingState(false);
      chartSyncController?.resume();
    }
  }
}

function selectInterval(interval) {
  if (!interval || interval === state.interval || !state.supportedIntervals.has(interval)) {
    return;
  }

  chartSyncController?.suspend();
  Object.values(charts).forEach(({ chart }) => {
    try {
      chart.clearCrosshairPosition?.();
    } catch (error) {
      if (!shouldIgnoreRangeSyncError(error)) {
        console.warn('crosshair clear skipped', error);
      }
    }
  });
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

function selectProject(projectId) {
  if (!projectId || projectId === state.projectId || !state.projects.some((project) => project.id === projectId)) {
    return;
  }

  chartSyncController?.suspend();
  Object.values(charts).forEach(({ chart }) => {
    try {
      chart.clearCrosshairPosition?.();
    } catch (error) {
      if (!shouldIgnoreRangeSyncError(error)) {
        console.warn('crosshair clear skipped', error);
      }
    }
  });
  state.projectId = projectId;
  state.replayEvent = null;
  state.replayEvents = [];
  persistCockpitPrefs();
  renderProjectButtons();
  syncControlButtons();
  replayList.innerHTML = '<span class="loading">Switching project…</span>';
  hydrateOptionalIntervals()
    .then(() => loadCockpit())
    .catch((error) => {
      console.error(error);
      replayList.innerHTML = `<span class="loading">${error.message}</span>`;
      syncState.textContent = 'Fault';
    });
}

intervalButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectInterval(button.dataset.interval);
  });
});

panelToggleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    togglePanel(button.dataset.panelToggle);
  });
});

focusButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setFocusMode(button.dataset.focus, { preserveReplay: true });
  });
});

oiSeriesButtons.forEach((button) => {
  button.addEventListener('click', () => {
    toggleOiSeries(button.dataset.oiSeries);
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
installHeroResizer();
analyticsSplitters.forEach((splitter) => {
  installResizer(splitter, 'analytics', splitter.dataset.left, splitter.dataset.right);
});
supportSplitters.forEach((splitter) => {
  installResizer(splitter, 'support', splitter.dataset.left, splitter.dataset.right);
});
applyLayoutState();
syncControlButtons();
fetchProjects()
  .then((catalog) => {
    state.projects = catalog.projects || [];
    if (!state.projects.some((project) => project.id === state.projectId)) {
      state.projectId = catalog.default_project_id || 'bananas31';
      persistCockpitPrefs();
    }
    renderProjectButtons();
    return hydrateOptionalIntervals();
  })
  .then(() => loadCockpit())
  .catch((error) => {
  console.error(error);
  replayList.innerHTML = `<span class="loading">${error.message}</span>`;
  syncState.textContent = 'Fault';
  });
