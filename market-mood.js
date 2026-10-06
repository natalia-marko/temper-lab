const $ = (id) => document.getElementById(id);

function day(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
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

function marketBreakdown(details, period) {
  const rows = (details?.stock_returns || []).filter(row =>
    Number.isFinite(row.return_63) && Number.isFinite(row.return_252));
  const values = rows.map(row => row[`return_${period}`]);
  const bins = RETURN_BANDS.map(band => ({ label: band.label, count: 0 }));
  const bySector = new Map();
  for (const row of rows) {
    const value = row[`return_${period}`];
    const index = RETURN_BANDS.findIndex(band => value < band.max);
    bins[index].count += 1;
    const key = sectorFor(row.industry);
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

function tapeHeadline(mood, period) {
  const spy = mood.indices?.SPY?.[`return_${period}`];
  const qqq = mood.indices?.QQQ?.[`return_${period}`];
  const up = mood.breadth?.[`up_${period}`];
  const middle = mood.breadth?.[`median_${period}`];
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
  for (let index = 0; index <= 4; index += 1) {
    const value = minimum + (maximum - minimum) * index / 4;
    svgElement(svg, 'line', { x1: left, x2: right, y1: y(value), y2: y(value), class: 'chart-grid' });
    svgElement(svg, 'text', { x: left - 8, y: y(value) + 4, 'text-anchor': 'end' }, (value * 100).toFixed(1));
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
    $('path-readout').textContent = `${day(points[index].date)} · ${series.map(row => `${row.symbol} ${percent(row.points[index].value)}`).join(' · ')}`;
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

function renderDistribution(breakdown) {
  const target = $('return-distribution');
  target.replaceChildren();
  if (!breakdown.count) {
    appendText(target, 'p', 'Stock return observations are unavailable in this snapshot.', 'chart-empty');
    $('distribution-caption').textContent = '';
    return;
  }
  const maximum = Math.max(...breakdown.bins.map(band => band.count), 1);
  breakdown.bins.forEach((band, index) => {
    const row = appendText(target, 'div', '', `distribution-row ${index < 4 ? 'loss' : 'gain'}`);
    appendText(row, 'span', band.label);
    const track = appendText(row, 'div', '', 'distribution-track');
    const fill = appendText(track, 'span', '');
    fill.style.width = `${band.count / maximum * 100}%`;
    appendText(row, 'strong', band.count.toLocaleString());
    appendText(row, 'small', `${(band.count / breakdown.count * 100).toFixed(1)}%`);
  });
  $('distribution-caption').textContent = `${breakdown.count.toLocaleString()} stocks · lower bound included, upper excluded · zero belongs to 0% to +10%`;
}

function renderSectors(breakdown) {
  const target = $('sector-body'); target.replaceChildren();
  if (!breakdown.sectors.length) {
    appendText(appendText(target, 'tr', ''), 'td', 'Sector observations are unavailable.', 'empty').colSpan = 4;
    return;
  }
  const maximum = Math.max(...breakdown.sectors.map(row => Math.abs(row.median)), 0.001);
  for (const row of breakdown.sectors) {
    const tr = appendText(target, 'tr', '');
    appendText(tr, 'th', row.label).scope = 'row';
    const value = appendText(tr, 'td', '', 'sector-return');
    const track = appendText(value, 'div', '', 'sector-track');
    const bar = appendText(track, 'span', '', row.median < 0 ? 'loss' : 'gain');
    const length = Math.abs(row.median) / maximum * 50;
    bar.style.width = `${length}%`; bar.style.left = `${row.median < 0 ? 50 - length : 50}%`;
    appendText(value, 'strong', percent(row.median));
    appendText(tr, 'td', levelPercent(row.up));
    appendText(tr, 'td', row.count.toLocaleString());
  }
}

function renderMarketDesk() {
  const mood = moodState.mood, period = moodState.period;
  const share = mood.breadth?.[`up_${period}`], middle = mood.breadth?.[`median_${period}`];
  $('tape-headline').textContent = tapeHeadline(mood, period);
  $('tape-summary').textContent = `${period} trading sessions · SPY ${percent(mood.indices?.SPY?.[`return_${period}`])} · QQQ ${percent(mood.indices?.QQQ?.[`return_${period}`])} · median eligible stock ${percent(middle)}`;
  $('breadth-up').textContent = levelPercent(share);
  $('breadth-fill').style.width = Number.isFinite(share) ? `${Math.max(0, Math.min(100, share * 100))}%` : '0%';
  $('breadth-track').setAttribute('aria-label', `Positive returns: ${levelPercent(share)} of eligible stocks`);
  $('breadth-down').textContent = Number.isFinite(share) ? `${levelPercent(1 - share)} flat or down` : 'Participation is unavailable.';
  $('breadth-copy').textContent = percent(middle);
  const other = period === 63 ? 252 : 63;
  $('breadth-year').textContent = `${other} sessions: ${levelPercent(mood.breadth?.[`up_${other}`])} up · median ${percent(mood.breadth?.[`median_${other}`])}`;
  $('path-window').textContent = `${period} sessions · adjusted returns`;
  renderIndices(mood.indices, period);
  const spy = mood.indices?.SPY?.[`return_${period}`], qqq = mood.indices?.QQQ?.[`return_${period}`];
  $('index-spread').textContent = Number.isFinite(spy) && Number.isFinite(qqq)
    ? `QQQ minus SPY: ${((qqq - spy) * 100) > 0 ? '+' : ''}${((qqq - spy) * 100).toFixed(1)} percentage points.` : '';
  const breakdown = marketBreakdown(mood.market_details, period);
  renderDistribution(breakdown); renderSectors(breakdown); renderIndexChart();
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
    lists.addEventListener('click', () => { showMoodPanel('lists'); $('show-lists').focus(); });
    lists.dataset.bound = 'true';
  }
  if (!moodState.observer && typeof ResizeObserver !== 'undefined') {
    moodState.observer = new ResizeObserver(() => { if (moodState.mood && !$('tape-panel').hidden) renderIndexChart(); });
    moodState.observer.observe($('index-chart'));
  }
}

function scoreText(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}

function renderScreenLeaders(id, rows, format = "share") {
  const target = $(id);
  target.replaceChildren();
  if (!rows?.length) {
    const tr = appendText(target, "tr", "");
    appendText(tr, "td", "No screen leaders recorded for this Friday.", "empty").colSpan = 3;
    return;
  }
  for (const item of rows) {
    const tr = appendText(target, "tr", "");
    const company = appendText(tr, "td", "");
    const identity = appendText(company, "div", "", "extreme-identity");
    appendText(identity, "strong", item.symbol);
    appendText(identity, "small", item.name || item.symbol);
    const metric = format === "score" ? scoreText(item.metric) : levelPercent(item.metric);
    appendText(tr, "td", metric, "extreme-return");
    appendText(tr, "td", Number.isInteger(item.rank) ? `#${item.rank}` : "—", "extreme-rank");
  }
}

const SCREEN_NAMES = { strength: "Hot Tape", growth: "Growth", undervalued: "Cheap" };
const OVERLAP_PAIR_KEYS = ["strength_growth", "growth_undervalued", "strength_undervalued"];
const OVERLAP_PAIR_LABELS = {
  strength_growth: "Hot Tape · Growth",
  growth_undervalued: "Growth · Cheap",
  strength_undervalued: "Hot Tape · Cheap",
};

const overlapState = { doublesFilter: "all", triples: [], doubles: [] };

function splitOverlap(rows) {
  const triples = [];
  const doubles = [];
  for (const row of rows || []) {
    const size = (row.screens || []).length;
    if (size === 3) triples.push(row);
    else if (size === 2) doubles.push(row);
  }
  return { triples, doubles };
}

function overlapPairKey(row) {
  const screens = new Set(row.screens || []);
  if (screens.has("strength") && screens.has("growth") && !screens.has("undervalued")) return "strength_growth";
  if (screens.has("growth") && screens.has("undervalued") && !screens.has("strength")) return "growth_undervalued";
  if (screens.has("strength") && screens.has("undervalued") && !screens.has("growth")) return "strength_undervalued";
  return null;
}

function filterDoubles(rows, key) {
  if (key === "all") return rows;
  if (key === "new") return rows.filter((row) => row.new_overlap === true);
  return rows.filter((row) => overlapPairKey(row) === key);
}

function doublesCounts(rows) {
  const totals = { all: rows.length, strength_growth: 0, growth_undervalued: 0, strength_undervalued: 0, new: 0 };
  for (const row of rows) {
    const key = overlapPairKey(row);
    if (key && key in totals) totals[key] += 1;
    if (row.new_overlap === true) totals.new += 1;
  }
  return totals;
}

function renderOverlapRow(target, row) {
  const item = appendText(target, "div", "", "overlap-item");
  const identity = appendText(item, "div", "", "overlap-identity");
  appendText(identity, "strong", row.symbol);
  appendText(identity, "small", row.name || row.symbol);
  const badges = appendText(item, "div", "", "overlap-badges");
  for (const key of row.screens || []) appendText(badges, "span", SCREEN_NAMES[key] || key, "overlap-badge");
  if (row.new_overlap === true) appendText(badges, "span", "New overlap", "overlap-badge overlap-new");
}

function renderTriples(rows) {
  const target = $("triples-list");
  target.replaceChildren();
  $("triples-count").textContent = `${rows.length} name${rows.length === 1 ? "" : "s"} · alphabetical`;
  if (!rows.length) {
    appendText(target, "div", "No name is on all three screens this Friday.", "overlap-empty");
    return;
  }
  for (const row of rows) renderOverlapRow(target, row);
}

function renderDoublesChips(counts) {
  const target = $("overlap-chips");
  target.replaceChildren();
  const options = [["all", "All"], ...OVERLAP_PAIR_KEYS.map((key) => [key, OVERLAP_PAIR_LABELS[key]]), ["new", "New this week"]];
  for (const [key, label] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "overlap-chip";
    button.dataset.doublesFilter = key;
    if (overlapState.doublesFilter === key) {
      button.classList.add("on");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }
    button.textContent = `${label} (${counts[key] ?? 0})`;
    button.disabled = (counts[key] ?? 0) === 0 && key !== "all";
    target.appendChild(button);
  }
}

function renderDoubles() {
  const target = $("doubles-list");
  target.replaceChildren();
  const filtered = filterDoubles(overlapState.doubles, overlapState.doublesFilter);
  const doubleCount = overlapState.doubles.length;
  $("doubles-count").textContent = `${filtered.length} of ${doubleCount} · alphabetical within the filter`;
  if (!filtered.length) {
    appendText(target, "div", "No name matches this pair for the current Friday.", "overlap-empty");
    return;
  }
  for (const row of filtered) renderOverlapRow(target, row);
}

function renderOverlapCard(report) {
  const rows = report?.overlap || [];
  const { triples, doubles } = splitOverlap(rows);
  overlapState.triples = triples;
  overlapState.doubles = doubles;
  $("overlap-count").textContent = `${rows.length} names · triples first, then two-screen names`;
  renderTriples(triples);
  renderDoublesChips(doublesCounts(doubles));
  renderDoubles();
}

function renderScreenReport(report) {
  const unique = Number.isInteger(report?.unique_count) ? report.unique_count : null;
  const multi = Number.isInteger(report?.multi_count) ? report.multi_count : null;
  $("report-unique").textContent = unique != null ? unique.toLocaleString() : "—";
  $("report-multi").textContent = multi != null ? multi.toLocaleString() : "—";
  $("report-triple").textContent = Number.isInteger(report?.triple_count) ? report.triple_count.toLocaleString() : "—";
  $("report-multi-share").textContent = unique && multi != null
    ? `${((multi / unique) * 100).toFixed(1)}% of ${unique.toLocaleString()} screened`
    : "";
  $("report-change").textContent = report?.previous_as_of
    ? `Since ${day(report.previous_as_of)}: ${report.new_overlap_count} entered, ${report.lost_overlap_count} left. Net ${report.multi_count - report.previous_multi_count >= 0 ? "+" : ""}${report.multi_count - report.previous_multi_count}.`
    : "No prior Friday to compare.";
  renderOverlapCard(report);
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

function bindOverlapControls() {
  const chips = $("overlap-chips");
  if (!chips || chips.dataset.bound === "true") return;
  chips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-doubles-filter]");
    if (!button || button.disabled) return;
    overlapState.doublesFilter = button.dataset.doublesFilter;
    renderDoublesChips(doublesCounts(overlapState.doubles));
    renderDoubles();
    chips.querySelector(`[data-doubles-filter="${overlapState.doublesFilter}"]`)?.focus();
  });
  chips.dataset.bound = "true";
}

function render(mood) {
  moodState.mood = mood;
  $("week-chip").textContent = `Data as of ${day(mood.as_of)}`;
  $("aside-week").textContent = day(mood.as_of);
  $("coverage-date").textContent = `${mood.price_history_count.toLocaleString()} complete price histories · ${mood.universe_count.toLocaleString()} liquid names`;
  $("vix-close").textContent = Number.isFinite(mood.vix?.close) ? mood.vix.close.toFixed(2) : "—";
  $("vix-week").textContent = mood.vix
    ? `${vixPoints(mood.vix.change_points_week)} over 5 trading sessions`
    : "The matching Cboe close is unavailable in this snapshot.";
  const report = mood.screen_report;
  $('desk-overlap-value').textContent = Number.isInteger(report?.multi_count) ? String(report.multi_count) : '—';
  $('desk-overlap-change').textContent = report?.previous_as_of
    ? `${report.new_overlap_count} entered · ${report.lost_overlap_count} left · ${report.triple_count} on all three` : 'No prior Friday to compare.';
  renderScreenLeaders("conviction-body", mood.conviction_leaders, "score");
  renderScreenReport(mood.screen_report);
  bindOverlapControls();
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
