import './styles.css';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import { fetchBasis, fetchFunding, fetchOhlcv, fetchOi, fetchSnapshot } from './lib/api.js';
import { computeVisibleRange, createActiveChartSync, INTERVAL_TO_SECONDS } from './lib/chartSync.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="app-shell">
    <header class="masthead">
      <section class="brand-deck">
        <p class="brand-kicker">BANANAS31 // OPERATOR COCKPIT</p>
        <div class="brand-heading-row">
          <h1 class="brand-title">Carry, Basis, Pressure.</h1>
          <div class="signal-badge" id="sync-state">History Synced</div>
        </div>
        <p class="brand-subtitle">A clean-room command surface for historical context, synchronized market structure, and operator-grade visibility across spot, perp, funding, and open interest.</p>
      </section>

      <aside class="mission-card">
        <div class="mission-row">
          <span>Regime</span>
          <strong id="live-regime">Loading…</strong>
        </div>
        <div class="mission-row">
          <span>Window</span>
          <strong id="session-window">Waiting for feed</strong>
        </div>
        <div class="mission-row">
          <span>Data Health</span>
          <strong id="data-health">Connecting</strong>
        </div>
        <p class="mission-note" id="live-regime-detail">Waiting for snapshot</p>
      </aside>
    </header>

    <section class="summary-tape" id="summary-grid"></section>

    <section class="command-deck">
      <div class="toolbar-group" id="interval-group">
        <button data-interval="1h">1H</button>
        <button data-interval="4h" class="active">4H</button>
        <button data-interval="1d">1D</button>
      </div>

      <div class="toolbar-group mode-group">
        <button class="active">Live + History</button>
        <button>Replay-Ready</button>
      </div>

      <div class="feed-strip">
        <span class="feed-chip spot">BN Spot</span>
        <span class="feed-chip perp">BN Perp</span>
        <span class="feed-chip bybit">Bybit Perp</span>
        <span class="feed-chip dex">DEX</span>
      </div>
    </section>

    <section class="workspace-grid">
      <div class="chart-stage">
        <article class="panel panel-hero">
          <div class="panel-header">
            <div>
              <p class="panel-kicker">Core Tape</p>
              <h2 class="panel-title">Price + Volume</h2>
            </div>
            <span class="panel-meta" id="price-meta">Historical candlesticks + perp overlays</span>
          </div>
          <div class="chart-slot chart-slot-hero" id="price-chart"></div>
        </article>

        <div class="analytics-row">
          <article class="panel">
            <div class="panel-header">
              <div>
                <p class="panel-kicker">Carry</p>
                <h2 class="panel-title">Basis Regime</h2>
              </div>
              <span class="panel-meta" id="basis-meta">Aggregated venue spread</span>
            </div>
            <div class="chart-slot chart-slot-compact" id="basis-chart"></div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <p class="panel-kicker">Leverage</p>
                <h2 class="panel-title">Open Interest</h2>
              </div>
              <span class="panel-meta" id="oi-meta">Aggregated and venue split</span>
            </div>
            <div class="chart-slot chart-slot-compact" id="oi-chart"></div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <p class="panel-kicker">Reset</p>
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
              <p class="panel-kicker">Brief</p>
              <h2 class="panel-title">Operator Readout</h2>
            </div>
            <span class="panel-meta">Live snapshot</span>
          </div>
          <div class="rail-body rail-grid" id="operator-summary">Loading snapshot…</div>
        </article>

        <article class="panel rail-card">
          <div class="panel-header">
            <div>
              <p class="panel-kicker">Coverage</p>
              <h2 class="panel-title">Data Footprint</h2>
            </div>
            <span class="panel-meta">Bars and freshness</span>
          </div>
          <div class="coverage-list" id="coverage-list"></div>
        </article>

        <article class="panel rail-card">
          <div class="panel-header">
            <div>
              <p class="panel-kicker">Reading</p>
              <h2 class="panel-title">Session Thesis</h2>
            </div>
            <span class="panel-meta">What matters now</span>
          </div>
          <ul class="thesis-list" id="thesis-list"></ul>
        </article>
      </aside>
    </section>
  </div>
`;

const summaryGrid = document.querySelector('#summary-grid');
const operatorSummary = document.querySelector('#operator-summary');
const coverageList = document.querySelector('#coverage-list');
const thesisList = document.querySelector('#thesis-list');
const intervalButtons = [...document.querySelectorAll('[data-interval]')];
const liveRegime = document.querySelector('#live-regime');
const liveRegimeDetail = document.querySelector('#live-regime-detail');
const sessionWindow = document.querySelector('#session-window');
const dataHealth = document.querySelector('#data-health');
const syncState = document.querySelector('#sync-state');
const priceMeta = document.querySelector('#price-meta');
const basisMeta = document.querySelector('#basis-meta');
const oiMeta = document.querySelector('#oi-meta');
const fundingMeta = document.querySelector('#funding-meta');

const charts = {};
let currentInterval = '4h';

function formatNumber(value, digits = 4) {
  if (value == null) return '—';
  return Number(value).toFixed(digits);
}

function formatPercent(value, digits = 4) {
  if (value == null) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

function formatCompact(value) {
  if (value == null) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return `${value.toFixed(2)}`;
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

function barsLabel(count) {
  return `${count} ${currentInterval.toUpperCase()} bars`;
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
    items.push('Perp complex still trades below spot, so pressure remains defensive rather than euphoric.');
  } else {
    items.push('Positive basis says carry is back on and longs are paying to stay in the stack.');
  }

  if (funding > 0.05) {
    items.push('Funding is elevated enough to punish crowded continuation if price stalls.');
  } else if (funding < 0) {
    items.push('Negative funding keeps short pressure fragile and raises squeeze odds on any upside impulse.');
  } else {
    items.push('Funding is present but not extreme, so basis matters more than the reset tape right now.');
  }

  if (oi >= 7_500_000_000) {
    items.push('Open interest is heavy, which means the next directional move can cascade through leverage rather than drift.');
  } else {
    items.push('Open interest is not yet fully extended, so the market still has room before leverage becomes the whole story.');
  }

  return items;
}

function renderSummary(snapshot) {
  const cards = [
    ['Spot', formatNumber(snapshot.prices['binance-spot'], 6), 'Binance spot close'],
    ['Perp', formatNumber(snapshot.prices['binance-perp'], 6), 'Binance perp close'],
    ['Bybit', formatNumber(snapshot.prices['bybit-perp'], 6), 'Bybit perp close'],
    ['Basis', formatPercent(snapshot.summary.basis_agg_pct, 4), 'Aggregated carry spread'],
    ['Funding', formatPercent(snapshot.summary.funding_avg_8h_pct, 4), 'Average 8h reset'],
    ['OI', formatCompact(snapshot.summary.oi_total), 'Total open interest']
  ];

  summaryGrid.innerHTML = cards.map(([label, value, meta]) => `
    <article class="summary-card">
      <div class="summary-card-label">${label}</div>
      <div class="summary-card-value">${value}</div>
      <div class="summary-card-meta">${meta}</div>
    </article>
  `).join('');

  const regime = snapshot.summary.basis_agg_pct >= 0 ? 'Carry On / Contango' : 'Defensive / Backwardation';
  liveRegime.textContent = regime;
  liveRegimeDetail.textContent = `Basis ${formatPercent(snapshot.summary.basis_agg_pct, 4)} · Funding ${formatPercent(snapshot.summary.funding_avg_8h_pct, 4)} · OI ${formatCompact(snapshot.summary.oi_total)}`;
  syncState.textContent = currentInterval === '1h' ? 'Fast Tape' : currentInterval === '1d' ? 'Wide Context' : 'History Synced';

  operatorSummary.innerHTML = `
    <div class="rail-metric">
      <span>Spot</span>
      <strong>${formatNumber(snapshot.prices['binance-spot'], 6)}</strong>
    </div>
    <div class="rail-metric">
      <span>Perp</span>
      <strong>${formatNumber(snapshot.prices['binance-perp'], 6)}</strong>
    </div>
    <div class="rail-metric">
      <span>Bybit</span>
      <strong>${formatNumber(snapshot.prices['bybit-perp'], 6)}</strong>
    </div>
    <div class="rail-metric">
      <span>DEX</span>
      <strong>${formatNumber(snapshot.prices.dex, 6)}</strong>
    </div>
    <div class="rail-metric wide">
      <span>24H Range</span>
      <strong>${formatNumber(snapshot.summary.low_24h, 6)} → ${formatNumber(snapshot.summary.high_24h, 6)}</strong>
    </div>
  `;

  thesisList.innerHTML = deriveSessionThesis(snapshot)
    .map((item) => `<li>${item}</li>`)
    .join('');
}

function renderCoverage(data) {
  const rows = [
    ['BN Spot', data.spot.bars, lastPointTime(data.spot.bars)],
    ['BN Perp', data.perp.bars, lastPointTime(data.perp.bars)],
    ['Bybit', data.bybit.bars, lastPointTime(data.bybit.bars)],
    ['Basis', data.basis.aggregated, lastPointTime(data.basis.aggregated)],
    ['OI', data.oi.aggregated, lastPointTime(data.oi.aggregated)],
    ['Funding', data.funding.per_source?.['binance-perp'] || [], lastPointTime(data.funding.per_source?.['binance-perp'] || [])]
  ];

  coverageList.innerHTML = rows.map(([label, series, timestamp]) => {
    const count = Array.isArray(series) ? series.length : 0;
    const status = coverageStatus(count);
    return `
      <div class="coverage-item">
        <div class="coverage-item-head">
          <span>${label}</span>
          <span class="coverage-pill ${status.tone}">${status.label}</span>
        </div>
        <div class="coverage-item-meta">${count} points · last ${formatTimestamp(timestamp)}</div>
      </div>
    `;
  }).join('');

  const totalSignals = rows.reduce((sum, [, series]) => sum + (Array.isArray(series) ? series.length : 0), 0);
  dataHealth.textContent = totalSignals >= 700 ? 'Healthy' : 'Partial';
  sessionWindow.textContent = `${barsLabel(data.spot.bars.length)} · ${formatTimestamp(lastPointTime(data.spot.bars))}`;
}

function makeChart(containerId, opts = {}) {
  const container = document.querySelector(containerId);
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { color: '#09111a' },
      textColor: '#8d98b7',
      fontFamily: '"IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif'
    },
    grid: {
      vertLines: { color: 'rgba(132, 151, 196, 0.05)' },
      horzLines: { color: 'rgba(132, 151, 196, 0.06)' }
    },
    rightPriceScale: {
      borderColor: 'rgba(132, 151, 196, 0.12)'
    },
    timeScale: {
      borderColor: 'rgba(132, 151, 196, 0.12)',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 6
    },
    crosshair: {
      vertLine: { color: 'rgba(90, 209, 255, 0.25)' },
      horzLine: { color: 'rgba(90, 209, 255, 0.25)' }
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
  charts.oi.agg = charts.oi.chart.addSeries(LineSeries, { color: '#5ad1ff', lineWidth: 2 });

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

function applyRanges(priceBars) {
  const visibleRange = computeVisibleRange(priceBars, currentInterval);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      Object.values(charts).forEach(({ chart }) => {
        try {
          chart.timeScale().setVisibleRange(visibleRange);
        } catch (error) {
          console.warn('initial visible range skipped', error);
        }
      });
    });
  });
}

function updatePanelMeta(data) {
  priceMeta.textContent = `${barsLabel(data.spot.bars.length)} · spot with perp overlays`;
  basisMeta.textContent = `${data.basis.aggregated.length} aggregated points · two venues`;
  oiMeta.textContent = `${data.oi.aggregated.length} aggregated points · leverage stack`;
  fundingMeta.textContent = `${(data.funding.per_source?.['binance-perp'] || []).length} resets · venue split`;
}

async function loadCockpit() {
  const minutes = currentInterval === '1d'
    ? 60 * 24 * 120
    : currentInterval === '1h'
      ? 60 * 24 * 14
      : 60 * 24 * 30;

  const [snapshot, spot, perp, bybit, basis, oi, funding] = await Promise.all([
    fetchSnapshot(),
    fetchOhlcv('binance-spot', minutes, currentInterval),
    fetchOhlcv('binance-perp', minutes, currentInterval),
    fetchOhlcv('bybit-perp', minutes, currentInterval),
    fetchBasis(minutes * 60, currentInterval),
    fetchOi(minutes, currentInterval),
    fetchFunding(minutes * 60, INTERVAL_TO_SECONDS[currentInterval] || 14400)
  ]);

  const payload = { snapshot, spot, perp, bybit, basis, oi, funding };
  renderSummary(snapshot);
  renderCoverage(payload);
  updatePanelMeta(payload);

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
}

intervalButtons.forEach((button) => {
  button.addEventListener('click', () => {
    intervalButtons.forEach((target) => target.classList.remove('active'));
    button.classList.add('active');
    currentInterval = button.dataset.interval;
    loadCockpit().catch((error) => {
      console.error(error);
      operatorSummary.innerHTML = `<span class="loading">${error.message}</span>`;
      dataHealth.textContent = 'Fault';
    });
  });
});

createCharts();
loadCockpit().catch((error) => {
  console.error(error);
  operatorSummary.innerHTML = `<span class="loading">${error.message}</span>`;
  dataHealth.textContent = 'Fault';
});
