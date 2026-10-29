const $ = (id) => document.getElementById(id);

function day(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function weekdayDay(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).replace(",", "");
}

function percent(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function levelPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function vixPoints(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} pts`;
}

function appendText(parent, tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}

function breadthYear(breadth) {
  if (!breadth || !Number.isFinite(breadth.up_252)) return "";
  const median = Number.isFinite(breadth.median_252) ? ` · median ${percent(breadth.median_252)}` : "";
  return `252 sessions: ${(breadth.up_252 * 100).toFixed(0)}% up${median}`;
}

function indexSpread(indices) {
  const spy = indices?.SPY?.return_63;
  const qqq = indices?.QQQ?.return_63;
  if (!Number.isFinite(spy) || !Number.isFinite(qqq)) return "";
  const gap = (spy - qqq) * 100;
  if (Math.abs(gap) < 0.05) return "SPY and QQQ moved together over 63 sessions.";
  const behind = gap > 0 ? "QQQ is behind SPY" : "SPY is behind QQQ";
  return `${behind} by ${Math.abs(gap).toFixed(1)} pp over 63 sessions.`;
}

function renderIndices(indices, period = 63) {
  const target = $("index-rows");
  target.replaceChildren();
  for (const [symbol, label] of [["SPY", "S&P 500"], ["QQQ", "Nasdaq-100"]]) {
    const snapshot = indices?.[symbol];
    const row = appendText(target, "div", "", `path-legend-item series-${symbol.toLowerCase()}`);
    const name = appendText(row, "div", "", "index-name");
    appendText(name, "strong", symbol);
    appendText(name, "span", label);
    const metrics = appendText(row, "div", "", "index-metrics");
    appendText(metrics, "strong", percent(snapshot?.[`return_${period}`]));
  }
}

const moodState = { mood: null, period: 63, observer: null };
const RETURN_BANDS = [
  { label: 'Below −40%', max: -0.4 }, { label: '−40% to −20%', max: -0.2 },
  { label: '−20% to −10%', max: -0.1 }, { label: '−10% to 0%', max: 0 },
  { label: '0% to +10%', max: 0.1 }, { label: '+10% to +20%', max: 0.2 },
  { label: '+20% to +40%', max: 0.4 }, { label: '+40% or more', max: Infinity },
];

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (!sorted.length) return null;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function marketBreakdown(details, period, onLists = false) {
  const rows = (details?.stock_returns || []).filter(row =>
    (!onLists || row.on_lists === true)
    && Number.isFinite(row.return_63) && Number.isFinite(row.return_252));
  const values = rows.map(row => row[`return_${period}`]);
  const bins = RETURN_BANDS.map(band => ({ label: band.label, count: 0 }));
  const bySector = new Map();
  for (const row of rows) {
    const value = row[`return_${period}`];
    const index = RETURN_BANDS.findIndex(band => value < band.max);
    bins[index].count += 1;
    const key = row.sector || sectorFor(row.industry);  // exported company sector (List check's rule); older files map the industry
    if (!bySector.has(key)) bySector.set(key, []);
    bySector.get(key).push(value);
  }
  const sectors = Array.from(bySector, ([key, returns]) => ({
    key, label: sectorLabel(key), median: median(returns), count: returns.length,
    up: returns.filter(value => value > 0).length / returns.length,
  })).sort((a, b) => b.median - a.median || a.label.localeCompare(b.label));
  return { bins, sectors, count: rows.length, median: median(values),
    up: rows.length ? values.filter(value => value > 0).length / rows.length : null };
}

function indexPaths(details, period) {
  const dates = details?.dates || [];
  if (dates.length < period + 1) return [];
  const start = dates.length - period - 1;
  return ['SPY', 'QQQ'].map(symbol => {
    const closes = details.index_closes?.[symbol] || [];
    const base = closes[start];
    if (!Number.isFinite(base) || base <= 0 || closes.length !== dates.length) return null;
    const points = dates.slice(start).map((date, index) => {
      const close = closes[start + index];
      return { date, value: Number.isFinite(close) && close > 0 ? close / base - 1 : null };
    });
    return { symbol, points };
  }).filter(Boolean);
}

function listBreadthOf(mood) {
  if (mood?.list_breadth) return mood.list_breadth;
  const rows = (mood?.market_details?.stock_returns || []).filter((row) => row.on_lists
    && Number.isFinite(row.return_63) && Number.isFinite(row.return_252));
  if (!rows.length) return null;
  const values63 = rows.map((row) => row.return_63);
  const values252 = rows.map((row) => row.return_252);
  return {
    n_63: rows.length,
    up_63: values63.filter((value) => value > 0).length / rows.length,
    median_63: median(values63),
    n_252: rows.length,
    up_252: values252.filter((value) => value > 0).length / rows.length,
    median_252: median(values252),
  };
}

function tapeHeadline(mood, period) {
  const spy = mood.indices?.SPY?.[`return_${period}`];
  const qqq = mood.indices?.QQQ?.[`return_${period}`];
  const up = mood.breadth?.[`up_${period}`];
  const middle = mood.breadth?.[`median_${period}`];
  // The market only: how list names compare is on List check, with its selection caveat.
  if (![spy, qqq, up, middle].every(Number.isFinite)) return 'The Friday market snapshot';
  if (up === 0.5) return 'Half of eligible stocks rose.';
  if (spy > 0 && qqq > 0 && up < 0.5) return 'Indices rose. Most eligible stocks did not.';
  if (spy < 0 && qqq < 0 && up > 0.5) return 'Indices fell. Most eligible stocks rose.';
  if (spy > 0 && qqq > 0 && middle < Math.min(spy, qqq)) return 'Indices rose faster than the median stock.';
  if (spy > 0 && qqq > 0) return 'Indices and most eligible stocks rose.';
  if (spy < 0 && qqq < 0) return 'Indices fell. Fewer than half of eligible stocks rose.';
  return 'The two indices moved in different directions.';
}

function svgElement(parent, tag, attributes, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes || {})) element.setAttribute(key, value);
  if (text != null) element.textContent = text;
  parent.appendChild(element);
  return element;
}

function pathCoordinates(series, width, height = 230) {
  const values = series.flatMap(row => row.points.map(point => point.value)).filter(Number.isFinite);
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const pad = Math.max((hi - lo) * 0.12, 0.002);
  const minimum = lo - pad, maximum = hi + pad;
  const left = 50, right = width - 16, top = 18, bottom = height - 34;
  const x = index => left + (right - left) * index / (series[0].points.length - 1);
  const y = value => bottom - (value - minimum) / (maximum - minimum) * (bottom - top);
  const paths = series.map(row => {
    let penDown = false;
    const d = row.points.map((point, index) => {
      if (!Number.isFinite(point.value)) { penDown = false; return ''; }
      const command = penDown ? 'L' : 'M';
      penDown = true;
      return `${command}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`;
    }).join(' ');
    return { symbol: row.symbol, d };
  });
  return { minimum, maximum, left, right, top, bottom, x, y, paths };
}

// Gridlines at the finest round step (1, 2, 2.5 or 5 × 10^k) that gives at most six lines
// inside the drawn range; zero is always one of them (the range always contains zero).
function returnTicks(minimum, maximum) {
  const span = Math.max(maximum - minimum, 1e-9);
  for (let unit = 10 ** Math.floor(Math.log10(span / 10)); ; unit *= 10) {
    for (const multiple of [1, 2, 2.5, 5]) {
      const step = multiple * unit;
      const first = Math.ceil(minimum / step - 1e-9), last = Math.floor(maximum / step + 1e-9);
      if (last - first + 1 > 6) continue;
      const ticks = [];
      for (let index = first; index <= last; index += 1) ticks.push(index === 0 ? 0 : index * step);
      // As few decimals as the step needs: 5% -> 0, 2.5% -> 1, 0.05% -> 2.
      const stepPercent = step * 100;
      const digits = [0, 1, 2, 3].find(d => Math.abs(stepPercent * 10 ** d - Math.round(stepPercent * 10 ** d)) < 1e-6) ?? 3;
      return { ticks, digits };
    }
  }
}

function renderIndexChart() {
  const target = $('index-chart');
  target.replaceChildren();
  const mood = moodState.mood, period = moodState.period;
  const series = indexPaths(mood?.market_details, period);
  $('path-readout').textContent = '';
  if (!series.length) {
    appendText(target, 'p', 'Daily index history is unavailable for this window.', 'chart-empty');
    return;
  }
  const width = Math.max(190, target.getBoundingClientRect().width || 600), height = 230;
  const geometry = pathCoordinates(series, width, height);
  const { left, right, top, bottom, minimum, maximum, x, y } = geometry;
  const svg = svgElement(target, 'svg', { viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': `SPY and QQQ adjusted returns over ${period} trading sessions. Use the date slider for values.` });
  svgElement(svg, 'title', {}, `Index returns over ${period} sessions`);
  svgElement(svg, 'text', { x: left, y: 11 }, 'Return (%)');
  const grid = returnTicks(minimum, maximum);
  for (const value of grid.ticks) {
    svgElement(svg, 'line', { x1: left, x2: right, y1: y(value), y2: y(value), class: 'chart-grid' });
    const label = value === 0 ? '0' : `${value > 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(grid.digits)}`;
    svgElement(svg, 'text', { x: left - 8, y: y(value) + 4, 'text-anchor': 'end' }, label);
  }
  svgElement(svg, 'line', { x1: left, x2: right, y1: y(0), y2: y(0), class: 'chart-zero' });
  for (const row of geometry.paths) svgElement(svg, 'path', { d: row.d, class: `index-path series-${row.symbol.toLowerCase()}`, fill: 'none' });
  const points = series[0].points;
  const ticks = width < 400 ? [0, points.length - 1] : [0, Math.floor(points.length / 2), points.length - 1];
  for (const index of ticks) {
    const label = new Date(`${points[index].date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    svgElement(svg, 'text', { x: x(index), y: height - 14, 'text-anchor': index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle' }, label);
  }
  const guide = svgElement(svg, 'line', { y1: top, y2: bottom, class: 'chart-guide' });
  const markers = series.map(row => svgElement(svg, 'circle', { r: 3.5, class: `chart-marker series-${row.symbol.toLowerCase()}` }));
  const label = appendText(target, 'label', '', 'chart-scrubber-label');
  appendText(label, 'span', 'Inspect a date', 'sr-only');
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = String(points.length - 1); slider.step = '1';
  slider.value = slider.max; slider.setAttribute('aria-label', 'Inspect index returns by trading date');
  label.appendChild(slider);
  const inspect = index => {
    guide.setAttribute('x1', x(index)); guide.setAttribute('x2', x(index));
    series.forEach((row, number) => {
      const value = row.points[index].value;
      markers[number].style.display = Number.isFinite(value) ? '' : 'none';
      if (Number.isFinite(value)) { markers[number].setAttribute('cx', x(index)); markers[number].setAttribute('cy', y(value)); }
    });
    slider.value = String(index);
    slider.setAttribute('aria-valuetext', `${day(points[index].date)}: ${series.map(row => `${row.symbol} ${percent(row.points[index].value)}`).join(', ')}`);
    $('path-readout').textContent = `Selected date ${day(points[index].date)} · ${series.map(row => `${row.symbol} ${percent(row.points[index].value)}`).join(' · ')}`;
  };
  slider.addEventListener('input', () => inspect(Number(slider.value)));
  const hit = svgElement(svg, 'rect', { x: left, y: top, width: right - left, height: bottom - top, class: 'chart-hit', fill: 'transparent' });
  const pointAt = event => {
    const bounds = svg.getBoundingClientRect();
    const coordinate = (event.clientX - bounds.left) / bounds.width * width;
    inspect(Math.max(0, Math.min(points.length - 1, Math.round((coordinate - left) / (right - left) * (points.length - 1)))));
  };
  hit.addEventListener('pointermove', pointAt);
  hit.addEventListener('pointerdown', pointAt);
  inspect(points.length - 1);
}

function renderDistribution(breakdown, lists) {
  const target = $('return-distribution');
  target.replaceChildren();
  const legend = $('distribution-cohorts'); legend.replaceChildren();
  for (const [label, cohort, className] of [['Eligible', breakdown, 'eligible'], ['On lists', lists, 'listed']]) {
    appendText(legend, 'span', `${label} · ${cohort.count.toLocaleString()} stocks`, className);
  }
  if (!breakdown.count) {
    appendText(target, 'p', 'Stock return observations are unavailable in this snapshot.', 'chart-empty');
    $('distribution-caption').textContent = '';
    $('distribution-scale').textContent = '';
    return;
  }
  const share = (cohort, index) => cohort.count ? cohort.bins[index].count / cohort.count : null;
  const maximum = Math.max(0.1, Math.ceil(Math.max(...breakdown.bins.map((_, index) =>
    Math.max(share(breakdown, index), share(lists, index) || 0))) * 10) / 10);
  const scale = $('distribution-scale'); scale.replaceChildren();
  appendText(scale, 'span', '0%'); appendText(scale, 'span', `${(maximum * 100).toFixed(0)}%`);
  breakdown.bins.forEach((band, index) => {
    const row = appendText(target, 'div', '', 'distribution-row');
    appendText(row, 'span', band.label, 'distribution-band');
    const pair = appendText(row, 'div', '', 'distribution-pair');
    for (const [label, cohort, className] of [['Eligible', breakdown, 'eligible'], ['On lists', lists, 'listed']]) {
      const value = share(cohort, index);
      const series = appendText(pair, 'div', '', `distribution-series ${className}`);
      const description = Number.isFinite(value)
        ? `${label}: ${levelPercent(value)} · ${cohort.bins[index].count} of ${cohort.count} stocks`
        : `${label}: unavailable`;
      series.setAttribute('aria-label', description);
      series.setAttribute('title', description);
      const track = appendText(series, 'div', '', 'distribution-track');
      const fill = appendText(track, 'span', '');
      fill.style.width = Number.isFinite(value) ? `${value / maximum * 100}%` : '0%';
      appendText(series, 'strong', levelPercent(value));
    }
  });
  $('distribution-caption').textContent = `${lists.count ? 'Share of each group · same percentage scale for both.' : 'List return observations are unavailable.'} Lower bound included, upper excluded; zero belongs to 0% to +10%.`;
}

function sectorScale(sectors) {
  const values = sectors.map(row => row.median).filter(Number.isFinite);
  const low = Math.min(0, ...values) * 100, high = Math.max(0, ...values) * 100;
  const rough = Math.max(high - low, 1) / 4;
  const unit = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].find(value => value * unit >= rough) * unit;
  const minimum = Math.floor(low / step) * step;
  const maximum = Math.max(minimum + step, Math.ceil(high / step) * step);
  const position = value => (value * 100 - minimum) / (maximum - minimum) * 100;
  const ticks = Array.from({length: Math.round((maximum - minimum) / step) + 1},
    (_, index) => minimum + index * step);
  return {minimum, maximum, ticks, position, zero: position(0)};
}

function renderSectors(breakdown) {
  const target = $('sector-body'); target.replaceChildren();
  const axis = $('sector-scale'); axis.replaceChildren();
  const ranked = breakdown.sectors.filter(row => row.key !== 'unclassified');
  const unclassified = breakdown.sectors.find(row => row.key === 'unclassified');
  $('sector-note').textContent = unclassified
    ? `Unclassified (${unclassified.count.toLocaleString()} stock${unclassified.count === 1 ? '' : 's'} with no industry match) is a data-coverage gap and is left out of the ranking.`
    : '';
  if (!ranked.length) {
    appendText(target, 'p', 'Sector observations are unavailable.', 'chart-empty');
    return;
  }
  const scale = sectorScale(ranked);
  for (const tick of scale.ticks) {
    const position = scale.position(tick / 100);
    const crowded = tick !== 0 && Math.abs(position - scale.zero) < 35;
    const label = appendText(axis, 'span', `${tick > 0 ? '+' : ''}${Number(tick.toFixed(4))}%`,
      `${tick === 0 || tick === scale.minimum || tick === scale.maximum ? 'axis-key' : ''}${crowded ? ' axis-crowded' : ''}`);
    label.style.left = `${position}%`;
  }
  for (const row of ranked) {
    const group = appendText(target, 'div', '', 'sector-group');
    group.setAttribute('role', 'listitem');
    appendText(group, 'span', row.label, 'sector-name');
    const pair = appendText(group, 'div', '', 'sector-pair');
    for (const [label, cohort, className] of [['Eligible', row, 'eligible']]) {
      const series = appendText(pair, 'div', '', `sector-series ${className}`);
      const description = `${row.label}, ${label}: ${percent(cohort?.median)}, ${cohort?.count || 0} stocks`;
      series.setAttribute('aria-label', description);
      series.setAttribute('title', description);
      const track = appendText(series, 'div', '', 'sector-bar-track');
      appendText(track, 'span', '', 'sector-zero').style.left = `${scale.zero}%`;
      if (cohort) {
        const bar = appendText(track, 'span', '', 'sector-bar');
        const endpoint = scale.position(cohort.median);
        bar.style.width = `${Math.abs(endpoint - scale.zero)}%`;
        bar.style.left = `${Math.min(endpoint, scale.zero)}%`;
      }
      const value = appendText(series, 'div', '', 'sector-value');
      appendText(value, 'strong', percent(cohort?.median));
      appendText(value, 'small', `n=${cohort?.count || 0}`);
    }
  }
}

// List check: eligible stocks against list names over the selected window (from this file's stats).
function renderComparison(mood, period) {
  const body = $('lc-compare-body'); body.replaceChildren();
  const lists = listBreadthOf(mood);
  for (const [label, stats] of [['Eligible', mood.breadth], ['On lists', lists]]) {
    const row = appendText(body, 'tr', '');
    appendText(row, 'td', label, 'lc-strong');
    appendText(row, 'td', Number.isFinite(stats?.[`n_${period}`]) ? stats[`n_${period}`].toLocaleString() : '—');
    appendText(row, 'td', levelPercent(stats?.[`up_${period}`]));
    const median = stats?.[`median_${period}`];
    appendText(row, 'td', percent(median), Number.isFinite(median) && median < 0 ? 'negative' : '');
  }
  // The population line above counts every list name; returns need both windows.
  $('lc-compare-note').textContent = Number.isFinite(lists?.[`n_${period}`])
    ? `Window: ${period} sessions. ${lists[`n_${period}`].toLocaleString()} list names have both return windows.`
    : `Window: ${period} sessions.`;
}

// List check: where the Shortlist's largest sector ranks in the market, for the selected window.
// Needs both files; whichever loads last calls it.
function renderSectorRank() {
  const target = $('lc-sector-rank');
  const check = globalThis.TLListCheck?.current;
  const largest = check?.sectors?.concentration?.shortlist?.largest;
  if (!target || !moodState.mood || !largest) { if (target) target.hidden = true; return; }
  const period = moodState.period;
  const ranked = marketBreakdown(moodState.mood.market_details, period).sectors.filter(row => row.key !== 'unclassified');
  const index = ranked.findIndex(row => row.key === largest.sector);
  if (index < 0) { target.hidden = true; return; }
  const row = ranked[index];
  const share = check.groups?.shortlist?.count ? largest.count / check.groups.shortlist.count : null;
  target.textContent = `${row.label}, the Shortlist’s largest sector${Number.isFinite(share) ? ` (${(share * 100).toFixed(0)}%)` : ''}: median stock return ${percent(row.median)} over ${period} sessions, #${index + 1} of ${ranked.length} sectors in the eligible universe.`;
  target.hidden = false;
}

function fillParticipation(ids, share, middle, count, label) {
  const up = $(ids.up), fill = $(ids.fill), track = $(ids.track), down = $(ids.down), copy = $(ids.copy);
  if (up) up.textContent = levelPercent(share);
  if (fill) fill.style.width = Number.isFinite(share) ? `${Math.max(0, Math.min(100, share * 100))}%` : '0%';
  if (track) {
    track.setAttribute('aria-label', Number.isFinite(share)
      ? `Positive returns: ${levelPercent(share)} of ${label}`
      : `${label} participation unavailable`);
  }
  if (down) {
    down.textContent = Number.isFinite(share)
      ? `${levelPercent(1 - share)} flat or down${Number.isFinite(count) ? ` · ${count.toLocaleString()} names` : ''}`
      : 'Participation is unavailable.';
  }
  if (copy) copy.textContent = percent(middle);
}

function renderMarketDesk() {
  const mood = moodState.mood, period = moodState.period;
  const share = mood.breadth?.[`up_${period}`], middle = mood.breadth?.[`median_${period}`];
  const count = mood.breadth?.[`n_${period}`];
  const spy = mood.indices?.SPY?.[`return_${period}`], qqq = mood.indices?.QQQ?.[`return_${period}`];
  $('tape-headline').textContent = tapeHeadline(mood, period);
  $('tape-summary').textContent = `Over ${period} sessions, SPY returned ${percent(spy)} and QQQ ${percent(qqq)}. `
    + `Of ${Number.isFinite(count) ? count.toLocaleString() : '—'} eligible stocks, ${levelPercent(share)} rose and the median stock returned ${percent(middle)}.`;
  $('fig-spy').textContent = percent(spy);
  $('fig-qqq').textContent = percent(qqq);
  $('fig-spy-window').textContent = `${period}-session return`;
  $('fig-qqq-window').textContent = `${period}-session return`;
  $('fig-up').textContent = levelPercent(share);
  $('fig-median').textContent = percent(middle);
  fillParticipation(
    { up: 'breadth-up', fill: 'breadth-fill', track: 'breadth-track', down: 'breadth-down', copy: 'breadth-copy' },
    share, middle, count, 'eligible stocks');
  $('breadth-up-label').textContent = `of eligible stocks rose over ${period} sessions`;
  const other = period === 63 ? 252 : 63;
  $('breadth-year').textContent = `Other window · ${other} sessions: ${levelPercent(mood.breadth?.[`up_${other}`])} rose, median ${percent(mood.breadth?.[`median_${other}`])}`;
  $('path-window').textContent = `${period} sessions · adjusted returns`;
  renderIndices(mood.indices, period);
  $('index-spread').textContent = Number.isFinite(spy) && Number.isFinite(qqq)
    ? `At the Friday close, QQQ minus SPY: ${((qqq - spy) * 100) > 0 ? '+' : ''}${((qqq - spy) * 100).toFixed(1)} percentage points.` : '';
  const breakdown = marketBreakdown(mood.market_details, period);
  const listBreakdown = marketBreakdown(mood.market_details, period, true);
  renderSectors(breakdown); renderIndexChart();
  renderDistribution(breakdown, listBreakdown); renderComparison(mood, period); renderSectorRank();
  document.querySelectorAll('[data-period]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.period) === period)));
}

function bindMarketDesk() {
  document.querySelectorAll('[data-period]').forEach(button => {
    if (button.dataset.bound === 'true') return;
    button.addEventListener('click', () => { moodState.period = Number(button.dataset.period); renderMarketDesk(); });
    button.dataset.bound = 'true';
  });
  const lists = $('desk-open-lists');
  if (lists.dataset.bound !== 'true') {
    lists.addEventListener('click', () => { showMoodPanel('lists'); globalThis.scrollTo?.(0, 0); $('show-lists').focus(); });
    lists.dataset.bound = 'true';
  }
  if (!moodState.observer && typeof ResizeObserver !== 'undefined') {
    moodState.observer = new ResizeObserver(() => { if (moodState.mood && !$('tape-panel').hidden) renderIndexChart(); });
    moodState.observer.observe($('index-chart'));
  }
}

function markTab(id, on) {
  const button = $(id);
  if (!button) return;
  button.classList.toggle("on", on);
  if (typeof button.setAttribute === "function") button.setAttribute("aria-selected", on ? "true" : "false");
}

function showMoodPanel(panel) {
  const lists = panel === "lists";
  $("tape-panel").hidden = lists;
  $("lists-panel").hidden = !lists;
  markTab("show-tape", !lists);
  markTab("show-lists", lists);
  if (!lists && moodState.mood) renderIndexChart();
}

function bindMoodPanels() {
  const tape = $("show-tape");
  const lists = $("show-lists");
  if (!tape || tape.dataset.bound === "true") return;
  tape.addEventListener("click", () => showMoodPanel("tape"));
  lists.addEventListener("click", () => showMoodPanel("lists"));
  tape.dataset.bound = "true";
}

function render(mood) {
  moodState.mood = mood;
  $("clock-market").textContent = weekdayDay(mood.as_of);
  $("coverage-line").textContent = Number.isFinite(mood.price_history_count) && Number.isFinite(mood.universe_count)
    ? `Returns cover ${mood.price_history_count.toLocaleString()} of ${mood.universe_count.toLocaleString()} eligible stocks: those with both return windows.`
    : "";
  $("aside-week").textContent = day(mood.as_of);
  $("vix-close").textContent = Number.isFinite(mood.vix?.close) ? mood.vix.close.toFixed(2) : "—";
  $("vix-week").textContent = mood.vix
    ? `${vixPoints(mood.vix.change_points_week)} over the last 5 trading sessions.`
    : "the matching Cboe close is unavailable in this snapshot.";
  bindMoodPanels();
  $("mood-status").hidden = true;
  $("mood-content").hidden = false;
  renderMarketDesk();
  bindMarketDesk();
}

async function loadMood() {
  try {
    const [moodResponse, releaseResponse] = await Promise.all([
      fetch("./market-mood.json", { cache: "no-store" }),
      fetch("./release.json", { cache: "no-store" }),
    ]);
    if (!moodResponse.ok) throw new Error("The market-mood snapshot is unavailable.");
    const mood = await moodResponse.json();
    if (mood.schema !== "market-mood-1" || !mood.as_of || !mood.run_id) {
      throw new Error("The market-mood snapshot is incomplete.");
    }
    if (releaseResponse.ok) {
      const release = await releaseResponse.json();
      if (release.run_id !== mood.run_id || release.as_of !== mood.as_of) {
        throw new Error("Market mood is awaiting the latest Friday refresh.");
      }
    }
    render(mood);
  } catch (error) {
    $("mood-status").textContent = error instanceof Error ? error.message : "Unable to load market mood.";
  }
}

void loadMood();
