const $ = (id) => document.getElementById(id);

function day(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function shortDay(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "UTC",
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

function dollars(value) {
  return Number.isFinite(value) ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

function wholeDollars(value) {
  return Number.isFinite(value) ? `$${Math.round(value).toLocaleString("en-US")}` : "—";
}

function levelPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

// VIX and VXN are annualised; one standard deviation over about a month is the index / sqrt(12).
function monthRange(close) {
  return Number.isFinite(close) && close > 0 ? Math.round(close / Math.sqrt(12)) : null;
}

function volPoints(value) {
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
  const medianVal = Number.isFinite(breadth.median_252) ? ` · median ${percent(breadth.median_252)}` : "";
  return `252 sessions: ${(breadth.up_252 * 100).toFixed(0)}% up${medianVal}`;
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

function indexAverageStatus(details, symbol) {
  const dates = details?.dates || [];
  const closes = details?.index_closes?.[symbol];
  const averages = details?.index_sma_200?.[symbol];
  if (!Array.isArray(closes) || !Array.isArray(averages) || closes.length !== dates.length || averages.length !== dates.length || !dates.length) {
    return null;
  }
  const last = dates.length - 1;
  const close = closes[last], average = averages[last];
  if (!Number.isFinite(close) || !Number.isFinite(average) || close <= 0 || average <= 0) return null;
  const gap = close / average - 1;
  if (close === average) {
    return { close, average, gap: 0, side: "at", since: null, crossed: false, complete: false, sessions: 1 };
  }
  const above = close > average;
  const side = above ? "above" : "below";
  let streakStart = last, crossed = false, complete = true;
  for (let i = last - 1; i >= 0; i -= 1) {
    const c = closes[i], a = averages[i];
    if (!Number.isFinite(c) || !Number.isFinite(a) || c <= 0 || a <= 0) {
      complete = false;
      break;
    }
    if ((c > a) === above && c !== a) {
      streakStart = i;
    } else {
      crossed = true;
      break;
    }
  }
  return {
    close, average, gap, side,
    since: crossed ? dates[streakStart] : null,
    crossed, complete: !crossed && complete,
    sessions: last - streakStart + 1,
  };
}

function formatIndexAverage(status) {
  if (!status) return "";
  if (status.side === "at") return "at its 200-day avg";
  const base = `${(Math.abs(status.gap) * 100).toFixed(1)}% ${status.side} 200-day avg`;
  if (status.crossed && status.since) return `${base} · ${status.side} since ${day(status.since)}`;
  if (status.complete) return `${base} · ${status.side} all ${status.sessions} sessions`;
  return base;
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

function stockHistogram(details, period) {
  const rows = (details?.stock_returns || []).filter(row =>
    Number.isFinite(row.return_63) && Number.isFinite(row.return_252));
  const min = period === 63 ? -0.45 : -0.60;
  const max = period === 63 ? 0.45 : 1.00;
  const step = period === 63 ? 0.05 : 0.10;
  const ticks = period === 63 ? [-0.40, -0.20, 0, 0.20, 0.40] : [-0.50, -0.20, 0, 0.30, 0.60, 0.90];
  const countBins = Math.round((max - min) / step);
  const bins = Array.from({ length: countBins }, (_, i) => ({
    lo: Number((min + i * step).toFixed(6)),
    hi: Number((min + (i + 1) * step).toFixed(6)),
    count: 0,
  }));
  for (const row of rows) {
    const v = row[`return_${period}`];
    const idx = Math.max(0, Math.min(bins.length - 1, Math.floor((v - min) / step)));
    bins[idx].count += 1;
  }
  return { bins, count: rows.length, min, max, step, ticks };
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
      const ok = Number.isFinite(close) && close > 0;
      return { date, value: ok ? close / base - 1 : null, close: ok ? close : null };
    });
    return { symbol, base, points };
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
  const left = 50, right = width - (series.length > 1 ? 56 : 16), top = 18, bottom = height - 34;
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

// Dollar gridlines at the finest round step (1, 2, 2.5 or 5 × 10^k) that gives at most `most`
// lines between `lo` and `hi`, with as few decimals as the step needs ($5 -> 0, $2.5 -> 1).
function priceTicks(lo, hi, most = 6) {
  const span = Math.max(hi - lo, 1e-9);
  for (let unit = 10 ** Math.floor(Math.log10(span / 10)); ; unit *= 10) {
    for (const multiple of [1, 2, 2.5, 5]) {
      const step = multiple * unit;
      const first = Math.ceil(lo / step - 1e-9), last = Math.floor(hi / step + 1e-9);
      if (last - first + 1 > most) continue;
      const ticks = [];
      for (let index = first; index <= last; index += 1) ticks.push(Number((index * step).toPrecision(12)));
      const digits = [0, 1, 2].find(d => Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-6) ?? 2;
      return { ticks, digits };
    }
  }
}

function axisDollars(value, digits) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function indexAverages(details, period, series) {
  const dates = details?.dates || [], averages = details?.index_sma_200 || {};
  const start = dates.length - period - 1;
  if (start < 0) return [];
  return series.map(row => {
    const values = averages[row.symbol];
    if (!Array.isArray(values) || values.length !== dates.length) return null;
    return { symbol: `${row.symbol}-avg`, points: dates.slice(start).map((date, index) => {
      const value = values[start + index];
      return { date, value: Number.isFinite(value) ? value / row.base - 1 : null };
    }) };
  }).filter(Boolean);
}

// Each Cboe volatility index paired with its index fund.
const VOL_INDICES = [
  { key: 'vix', name: 'VIX', fund: 'SPY', series: 'spy', title: 'S&P 500' },
  { key: 'vxn', name: 'VXN', fund: 'QQQ', series: 'qqq', title: 'Nasdaq-100' },
];
const FAN_LOOKBACK = 63;

function volWindow(block, period) {
  const history = block?.series;
  if (!history || !Array.isArray(history.closes) || !Array.isArray(history.dates)) return null;
  if (history.closes.length !== history.dates.length || history.closes.length < period + 1) return null;
  const start = history.closes.length - period - 1;
  const closes = history.closes.slice(start);
  return closes.some(Number.isFinite) ? { dates: history.dates.slice(start), closes } : null;
}

function volScale(values) {
  if (!values.length) return null;
  const step = Math.max(...values) - Math.min(...values) > 25 ? 10 : 5;
  return { step, lo: Math.floor(Math.min(...values) / step) * step, hi: Math.ceil(Math.max(...values) / step) * step };
}

function fanBand(last, close, steps = 21) {
  // One standard deviation from option prices: close / 100 × √(t / 252). At 21 sessions
  // that is close / √12, the range the written-down check tests; the shape before it is assumed.
  if (!(last > 0) || !(close > 0)) return null;
  const s = close / 100;
  return Array.from({ length: steps + 1 }, (_, t) => ({
    t, lo: last * (1 - s * Math.sqrt(t / 252)), hi: last * (1 + s * Math.sqrt(t / 252)),
  }));
}

function fanView(mood, spec, period = FAN_LOOKBACK) {
  const block = mood?.[spec.key], details = mood?.market_details;
  if (block?.range_check?.passed !== true) return null;
  const closes = details?.index_closes?.[spec.fund], dates = details?.dates;
  if (!Array.isArray(closes) || !Array.isArray(dates) || closes.length !== dates.length || closes.length < period + 1) return null;
  const start = closes.length - period - 1, past = closes.slice(start), last = past.at(-1);
  const band = Number.isFinite(last) ? fanBand(last, block.close) : null;
  if (!band) return null;
  const ahead = Array.isArray(mood.sessions_ahead) && mood.sessions_ahead.length === band.length - 1 ? mood.sessions_ahead : null;
  return { dates: dates.slice(start), closes: past, last, band, ahead };
}

function rangeLine(mood, spec) {
  const view = fanView(mood, spec, 1), block = mood?.[spec.key];
  if (!view) return '';
  const end = view.band.at(-1), when = view.ahead ? `by ${shortDay(view.ahead.at(-1))}` : 'over ~1 month';
  return `30d ${spec.name} cone: ±${monthRange(block.close)}% (${wholeDollars(end.lo)}–${wholeDollars(end.hi)} ${when})`;
}

function rangeMethod(mood) {
  return VOL_INDICES.map(({ key, name, fund }) => {
    const check = mood?.[key]?.range_check;
    if (!mood?.[key]) return '';
    if (!check) return `${fund} with ${name}: not checked yet (its fund history before 2020 is not loaded), so no line.`;
    const share = value => `${Math.round(value * 100)}%`;
    return `${fund} with ${name}: inside ${share(check.share_inside)} of ${check.months} month-ends`
      + ` (${check.first.slice(0, 7)} to ${check.last.slice(0, 7)}; fell further ${share(check.fell_beyond)}, rose further ${share(check.rose_beyond)})`
      + (check.passed ? '.' : ', below the rule, so no line.');
  }).filter(Boolean).join(' ');
}

function volGaugeSummary(block) {
  if (!block || !Number.isFinite(block.close)) return null;
  const valid = (block.series?.closes || []).filter(Number.isFinite);
  const ref = block.reference || null;
  const min1y = valid.length ? Math.min(...valid) : block.close;
  const max1y = valid.length ? Math.max(...valid) : block.close;
  const med = Number.isFinite(ref?.median) ? ref.median : null;
  const p90 = Number.isFinite(ref?.p90) ? ref.p90 : null;
  const lo = Math.min(min1y, med != null ? med * 0.85 : min1y, block.close);
  const hi = Math.max(max1y, p90 != null ? p90 * 1.1 : max1y, block.close);
  const span = Math.max(hi - lo, 1e-6);
  const pos = value => Math.max(2, Math.min(98, ((value - lo) / span) * 100));
  const aboveTop10 = p90 != null && block.close >= p90;
  const aboveMedian = med != null && block.close >= med;
  const yearHigh = valid.length > 1 && block.close >= max1y - 1e-6;
  let badge = '', tone = 'low';
  if (aboveTop10) {
    badge = yearHigh ? 'Above 3-yr top 10% · 1-yr high' : 'Above 3-yr top 10%';
    tone = 'high';
  } else if (aboveMedian) {
    badge = 'Above 3-yr median';
    tone = 'mid';
  } else if (med != null) {
    badge = 'Below 3-yr median';
    tone = 'low';
  }
  return {
    close: block.close, changeWeek: block.change_points_week, asOf: block.as_of,
    min1y, max1y, median: med, p90, aboveTop10, aboveMedian, yearHigh, badge, tone, pos,
  };
}

function renderVolGauge(spec, block) {
  const target = $(`${spec.key}-gauge`);
  if (!target) return;
  target.replaceChildren();
  const info = volGaugeSummary(block);
  if (!info) {
    appendText(target, 'p', `${spec.name} history is unavailable in this snapshot.`, 'chart-empty');
    return;
  }
  const top = appendText(target, 'div', '', 'vg-top');
  const left = appendText(top, 'span', '');
  appendText(left, 'span', `${spec.name} ${info.close.toFixed(2)}`, 'vg-val');
  if (Number.isFinite(info.changeWeek)) {
    appendText(left, 'span', ` (${volPoints(info.changeWeek)} in 5d)`);
  }
  if (info.badge) appendText(top, 'span', info.badge, `vg-badge ${info.tone}`);

  const track = appendText(target, 'div', '', 'vg-track');
  track.setAttribute('role', 'img');
  track.setAttribute('aria-label', `${spec.name} at ${info.close.toFixed(2)}${info.median != null ? `, 3-year median ${info.median.toFixed(1)}, top 10% from ${info.p90.toFixed(1)}` : ''}.`);
  if (info.median != null) {
    const tick = appendText(track, 'span', '', 'vg-tick');
    tick.style.left = `${info.pos(info.median).toFixed(1)}%`;
    tick.setAttribute('title', `3-yr median ${info.median.toFixed(1)}`);
  }
  if (info.p90 != null) {
    const tick = appendText(track, 'span', '', 'vg-tick');
    tick.style.left = `${info.pos(info.p90).toFixed(1)}%`;
    tick.setAttribute('title', `3-yr top 10% from ${info.p90.toFixed(1)}`);
  }
  const dot = appendText(track, 'span', '', `vg-dot series-${spec.series}${info.aboveTop10 ? ' high' : ''}`);
  dot.style.left = `${info.pos(info.close).toFixed(1)}%`;

  const refs = appendText(target, 'div', '', 'vg-refs');
  appendText(refs, 'span', `1y low ${info.min1y.toFixed(1)}`);
  if (info.median != null) appendText(refs, 'span', `3-yr med ${info.median.toFixed(1)}`);
  if (info.p90 != null) appendText(refs, 'span', `top 10% (${info.p90.toFixed(1)})`);
  const hiLabel = appendText(refs, 'span', '');
  appendText(hiLabel, 'strong', `1y high ${info.max1y.toFixed(1)}`);
}

function renderRegimeCard(spec) {
  const mood = moodState.mood, period = moodState.period;
  const details = mood?.market_details;
  const target = $(`${spec.series}-chart`), readout = $(`${spec.series}-readout`);
  if (!target) return;
  target.replaceChildren();
  if (readout) readout.textContent = '';

  const ret = mood?.indices?.[spec.fund]?.[`return_${period}`];
  const fig = $(`fig-${spec.series}`);
  if (fig) {
    fig.textContent = percent(ret);
    fig.className = Number.isFinite(ret) && ret < 0 ? 'negative' : '';
  }
  const smaText = formatIndexAverage(indexAverageStatus(details, spec.fund));
  const smaEl = $(`${spec.series}-sma`);
  if (smaEl) smaEl.textContent = smaText;
  const rangeEl = $(`${spec.key}-range`);
  if (rangeEl) rangeEl.textContent = rangeLine(mood, spec);

  const block = mood?.[spec.key];
  renderVolGauge(spec, block);

  const dates = details?.dates || [], closes = details?.index_closes?.[spec.fund];
  const closeEl = $(`${spec.series}-close`);
  const latestClose = Array.isArray(closes) && closes.length ? closes.at(-1) : null;
  if (closeEl) closeEl.textContent = dollars(latestClose);

  if (!Array.isArray(closes) || closes.length !== dates.length || dates.length < period + 1) {
    appendText(target, 'p', `${spec.fund} daily history is unavailable for this window.`, 'chart-empty');
    return;
  }

  const start = dates.length - period - 1;
  const winDates = dates.slice(start), winCloses = closes.slice(start);
  const allSmas = details?.index_sma_200?.[spec.fund];
  const winSmas = Array.isArray(allSmas) && allSmas.length === dates.length ? allSmas.slice(start) : null;
  const cone = fanView(mood, spec, 1);
  const hasCone = Boolean(cone);

  const volMap = new Map();
  if (block?.series?.dates && block?.series?.closes) {
    block.series.dates.forEach((d, i) => volMap.set(d, block.series.closes[i]));
  }
  const p90 = Number.isFinite(block?.reference?.p90) ? block.reference.p90 : null;
  const medVol = Number.isFinite(block?.reference?.median) ? block.reference.median : null;

  const width = Math.max(220, target.getBoundingClientRect().width || 540), height = 205;
  const left = 46, right = width - (hasCone ? 52 : 14), top = 14, bottom = height - 26;
  const histRight = hasCone ? left + (right - left) * 0.76 : right;
  const pastCount = winCloses.length - 1;
  const coneSteps = hasCone ? cone.band.length - 1 : 0;

  const allValues = winCloses.filter(Number.isFinite)
    .concat(winSmas ? winSmas.filter(Number.isFinite) : [])
    .concat(hasCone ? [cone.band.at(-1).lo, cone.band.at(-1).hi] : []);
  if (!allValues.length) {
    appendText(target, 'p', `${spec.fund} daily history is unavailable for this window.`, 'chart-empty');
    return;
  }
  const rawLo = Math.min(...allValues), rawHi = Math.max(...allValues);
  const pad = Math.max((rawHi - rawLo) * 0.07, 0.5);
  const grid = priceTicks(rawLo - pad, rawHi + pad, 4);
  const yMin = Math.min(rawLo - pad, grid.ticks[0]), yMax = Math.max(rawHi + pad, grid.ticks.at(-1));
  const xHist = i => left + (histRight - left) * (i / Math.max(1, pastCount));
  const xCone = t => histRight + (right - histRight) * (t / Math.max(1, coneSteps));
  const y = value => bottom - ((value - yMin) / Math.max(yMax - yMin, 1e-6)) * (bottom - top);

  const lastClose = winCloses.at(-1);
  const endCone = hasCone ? cone.band.at(-1) : null;
  const svg = svgElement(target, 'svg', {
    viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': `${spec.fund} adjusted closes over ${period} sessions ending at ${dollars(lastClose)}`
      + (hasCone ? `, with a 21-session ${spec.name} cone widening to ${wholeDollars(endCone.lo)}–${wholeDollars(endCone.hi)}` : '')
      + (p90 != null ? `; days with ${spec.name} at or above ${p90.toFixed(1)} are shaded.` : '.'),
  });

  // Stress background bands directly behind price (top-10% vol stress + above-median warm wash).
  if (p90 != null || medVol != null) {
    const dayW = (histRight - left) / Math.max(1, pastCount);
    winDates.forEach((d, i) => {
      const vv = volMap.get(d);
      if (!Number.isFinite(vv)) return;
      const cls = p90 != null && vv >= p90 ? 'stress-band' : (medVol != null && vv >= medVol ? 'warm-band' : '');
      if (!cls) return;
      const bx = Math.max(left, xHist(i) - dayW * 0.5);
      const bw = Math.max(1.2, Math.min(histRight, xHist(i) + dayW * 0.5) - bx);
      svgElement(svg, 'rect', { x: bx.toFixed(2), y: top, width: bw.toFixed(2), height: bottom - top, class: cls });
    });
  }

  for (const tick of grid.ticks) {
    svgElement(svg, 'line', { x1: left, x2: right, y1: y(tick), y2: y(tick), class: 'chart-grid' });
    svgElement(svg, 'text', { x: left - 6, y: y(tick) + 4, 'text-anchor': 'end' }, axisDollars(tick, grid.digits));
  }

  if (hasCone) {
    svgElement(svg, 'line', { x1: histRight, x2: histRight, y1: top, y2: bottom, class: 'chart-today' });
    const upper = cone.band.map(pt => `${xCone(pt.t).toFixed(2)},${y(pt.hi).toFixed(2)}`);
    const lower = cone.band.map(pt => `${xCone(pt.t).toFixed(2)},${y(pt.lo).toFixed(2)}`).reverse();
    svgElement(svg, 'path', { d: `M${upper.join(' L')} L${lower.join(' L')} Z`, class: `fan-band series-${spec.series}` });
    svgElement(svg, 'line', { x1: histRight, x2: right, y1: y(lastClose), y2: y(lastClose), class: `fan-mid series-${spec.series}` });
    svgElement(svg, 'text', { x: right + 5, y: y(endCone.hi) + 4, class: 'fan-label' }, wholeDollars(endCone.hi));
    svgElement(svg, 'text', { x: right + 5, y: y(endCone.lo) + 4, class: 'fan-label' }, wholeDollars(endCone.lo));
  }

  const linePath = values => {
    let penDown = false;
    return values.map((val, i) => {
      if (!Number.isFinite(val)) { penDown = false; return ''; }
      const cmd = penDown ? 'L' : 'M'; penDown = true;
      return `${cmd}${xHist(i).toFixed(2)},${y(val).toFixed(2)}`;
    }).join(' ');
  };
  if (winSmas) {
    const dSma = linePath(winSmas);
    if (dSma) svgElement(svg, 'path', { d: dSma, class: `index-avg series-${spec.series}` });
  }
  svgElement(svg, 'path', { d: linePath(winCloses), class: `index-path series-${spec.series}` });
  if (Number.isFinite(lastClose)) {
    svgElement(svg, 'circle', { cx: histRight, cy: y(lastClose), r: 3.5, class: `vol-end series-${spec.series}` });
  }

  const mid = Math.floor(winDates.length / 2);
  const dateTicks = width < 360
    ? [[left, shortDay(winDates[0]), 'start'], [histRight, shortDay(winDates.at(-1)), hasCone ? 'middle' : 'end']]
    : [[left, shortDay(winDates[0]), 'start'], [xHist(mid), shortDay(winDates[mid]), 'middle'], [histRight, shortDay(winDates.at(-1)), hasCone ? 'middle' : 'end']];
  if (hasCone && cone.ahead) dateTicks.push([right, shortDay(cone.ahead.at(-1)), 'end']);
  for (const [tx, text, anchor] of dateTicks) {
    svgElement(svg, 'text', { x: tx, y: height - 6, 'text-anchor': anchor }, text);
  }

  const guide = svgElement(svg, 'line', { y1: top, y2: bottom, class: 'chart-guide' });
  guide.style.display = 'none';
  const marker = svgElement(svg, 'circle', { r: 3.5, class: `chart-marker series-${spec.series}` });
  marker.style.display = 'none';

  const label = appendText(target, 'label', '', 'chart-scrubber-label');
  appendText(label, 'span', `Inspect ${spec.fund} by date`, 'sr-only');
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = String(pastCount); slider.step = '1';
  slider.value = String(pastCount);
  slider.setAttribute('aria-label', `Inspect ${spec.fund} closes by trading date`);
  label.appendChild(slider);

  const base = winCloses[0];
  const inspectHist = (index, showReadout = true) => {
    const cx = xHist(index), closeVal = winCloses[index], smaVal = winSmas ? winSmas[index] : null;
    guide.style.display = ''; guide.setAttribute('x1', cx); guide.setAttribute('x2', cx);
    marker.style.display = Number.isFinite(closeVal) ? '' : 'none';
    if (Number.isFinite(closeVal)) { marker.setAttribute('cx', cx); marker.setAttribute('cy', y(closeVal)); }
    slider.value = String(index);
    const chg = Number.isFinite(base) && base > 0 && Number.isFinite(closeVal) ? closeVal / base - 1 : null;
    const vs200 = Number.isFinite(closeVal) && Number.isFinite(smaVal) && smaVal > 0 ? ` · ${percent(closeVal / smaVal - 1)} vs 200d` : '';
    const volVal = volMap.get(winDates[index]);
    const volStr = Number.isFinite(volVal) ? ` · ${spec.name} ${volVal.toFixed(2)}` : '';
    const summary = `${day(winDates[index])} · ${spec.fund} ${dollars(closeVal)} (${percent(chg)}${vs200})${volStr}`;
    slider.setAttribute('aria-valuetext', summary);
    if (showReadout && readout) readout.textContent = summary;
  };
  slider.addEventListener('input', () => inspectHist(Number(slider.value), true));

  const hit = svgElement(svg, 'rect', { x: left, y: top, width: right - left, height: bottom - top, class: 'chart-hit', fill: 'transparent' });
  const pointAt = event => {
    const bounds = svg.getBoundingClientRect();
    const coord = (event.clientX - bounds.left) / bounds.width * width;
    if (!hasCone || coord <= histRight) {
      const idx = Math.max(0, Math.min(pastCount, Math.round((coord - left) / Math.max(1, histRight - left) * pastCount)));
      inspectHist(idx, true);
    } else {
      const step = Math.max(1, Math.min(coneSteps, Math.round((coord - histRight) / Math.max(1, right - histRight) * coneSteps)));
      const cx = xCone(step), pt = cone.band[step];
      guide.style.display = ''; guide.setAttribute('x1', cx); guide.setAttribute('x2', cx);
      marker.style.display = 'none';
      const when = cone.ahead ? day(cone.ahead[step - 1]) : `${step} sessions ahead`;
      if (readout) readout.textContent = `${when} · ${spec.fund} 1-σ implied range ${wholeDollars(pt.lo)}–${wholeDollars(pt.hi)}`;
    }
  };
  hit.addEventListener('pointermove', pointAt);
  hit.addEventListener('pointerdown', pointAt);
  hit.addEventListener('pointerleave', () => {
    guide.style.display = 'none'; marker.style.display = 'none';
    if (readout) readout.textContent = '';
  });
  inspectHist(pastCount, false);
  guide.style.display = 'none';
  marker.style.display = 'none';
}

function renderRegimeCharts() {
  for (const spec of VOL_INDICES) renderRegimeCard(spec);
}

function renderStockHistogram(mood, period) {
  const target = $('stock-histogram'), legend = $('hist-legend');
  if (!target) return;
  target.replaceChildren();
  if (legend) legend.replaceChildren();
  const hist = stockHistogram(mood?.market_details, period);
  if (!hist.count) {
    appendText(target, 'p', 'Stock return observations are unavailable in this snapshot.', 'chart-empty');
    return;
  }
  const spy = mood?.indices?.SPY?.[`return_${period}`];
  const qqq = mood?.indices?.QQQ?.[`return_${period}`];
  const med = mood?.breadth?.[`median_${period}`];
  const width = Math.max(220, target.getBoundingClientRect().width || 500), height = 185;
  const left = 12, right = width - 12, top = 24, bottom = height - 26;
  const plotW = right - left;
  const maxCount = Math.max(...hist.bins.map(b => b.count), 1);
  const xOf = val => left + Math.max(0, Math.min(1, (val - hist.min) / (hist.max - hist.min))) * plotW;
  const barW = plotW / hist.bins.length;

  const svg = svgElement(target, 'svg', {
    viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': `Return distribution of ${hist.count.toLocaleString()} eligible stocks over ${period} sessions; median ${percent(med)}, SPY ${percent(spy)}, QQQ ${percent(qqq)}.`,
  });
  hist.bins.forEach((bin, i) => {
    const bh = (bin.count / maxCount) * (bottom - top);
    const bx = left + i * barW + 1;
    svgElement(svg, 'rect', {
      x: bx.toFixed(2), y: (bottom - bh).toFixed(2),
      width: Math.max(2, barW - 2).toFixed(2), height: bh.toFixed(2), rx: 2,
      class: bin.lo >= -1e-9 ? 'hist-bar-pos' : 'hist-bar-neg',
    });
  });
  svgElement(svg, 'line', { x1: xOf(0), x2: xOf(0), y1: top - 6, y2: bottom + 4, class: 'chart-zero' });

  const pins = [
    ['Median stock', med, '#27332e', 'med', 14],
    ['SPY', spy, '#236949', 'spy', 8],
    ['QQQ', qqq, '#a26925', 'qqq', 20],
  ];
  for (const [label, val, color, cls, yOff] of pins) {
    if (!Number.isFinite(val)) continue;
    const px = xOf(val);
    svgElement(svg, 'line', { x1: px, x2: px, y1: yOff, y2: bottom, stroke: color, 'stroke-width': 1.6, 'stroke-dasharray': '3 2' });
    svgElement(svg, 'circle', { cx: px, cy: yOff, r: 3.2, fill: color });
    if (legend) {
      const item = appendText(legend, 'span', '');
      appendText(item, 'i', '', `pin-dot ${cls}`);
      appendText(item, 'span', `${label} `);
      appendText(item, 'strong', percent(val));
    }
  }
  for (const tick of hist.ticks) {
    const text = tick === 0 ? '0%' : `${tick > 0 ? '+' : ''}${Math.round(tick * 100)}%`;
    svgElement(svg, 'text', { x: xOf(tick), y: height - 6, 'text-anchor': 'middle' }, text);
  }
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
  for (const row of ranked) {
    const upPct = Math.round(row.up * 100);
    const description = `${row.label}, Eligible: ${percent(row.median)}, ${upPct}% rose, ${row.count} stocks`;
    const group = appendText(target, 'div', '', 'sector-group');
    group.setAttribute('role', 'listitem');
    group.setAttribute('aria-label', description);
    group.setAttribute('title', description);
    appendText(group, 'span', row.label, 'sector-name');
    const track = appendText(group, 'div', '', 'sector-bar-track');
    appendText(track, 'span', '', 'sector-zero').style.left = `${scale.zero}%`;
    const bar = appendText(track, 'span', '', `sector-bar${row.median < 0 ? ' negative' : ''}`);
    const endpoint = scale.position(row.median);
    bar.style.width = `${Math.abs(endpoint - scale.zero)}%`;
    bar.style.left = `${Math.min(endpoint, scale.zero)}%`;
    appendText(group, 'strong', percent(row.median), 'sector-med');
    const upCls = upPct >= 60 ? ' strong-up' : (upPct <= 25 ? ' weak-up' : '');
    appendText(group, 'span', `${upPct}% up`, `sector-up${upCls}`);
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
    const medianVal = stats?.[`median_${period}`];
    appendText(row, 'td', percent(medianVal), Number.isFinite(medianVal) && medianVal < 0 ? 'negative' : '');
  }
  $('lc-compare-note').textContent = Number.isFinite(lists?.[`n_${period}`])
    ? `Window: ${period} sessions. ${lists[`n_${period}`].toLocaleString()} list names have both return windows.`
    : `Window: ${period} sessions.`;
}

// List check: where the Shortlist's largest sector ranks in the market, for the selected window.
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

function renderMarketDesk() {
  const mood = moodState.mood, period = moodState.period;
  const share = mood.breadth?.[`up_${period}`], middle = mood.breadth?.[`median_${period}`];
  const count = mood.breadth?.[`n_${period}`];
  const spy = mood.indices?.SPY?.[`return_${period}`], qqq = mood.indices?.QQQ?.[`return_${period}`];
  $('tape-headline').textContent = tapeHeadline(mood, period);
  $('tape-summary').textContent = `Over ${period} sessions, SPY returned ${percent(spy)} and QQQ ${percent(qqq)}. `
    + `Of ${Number.isFinite(count) ? count.toLocaleString() : '—'} eligible stocks, ${levelPercent(share)} rose and the median stock returned ${percent(middle)}.`;
  $('breadth-n').textContent = Number.isFinite(count) ? count.toLocaleString() : '—';
  $('breadth-window').textContent = `${period} sessions`;
  $('sector-window').textContent = `${period} sessions · sorted by median`;
  const upEl = $('breadth-up');
  upEl.textContent = levelPercent(share);
  upEl.className = Number.isFinite(share) ? (share >= 0.5 ? 'positive' : 'negative') : '';
  const copyEl = $('breadth-copy');
  copyEl.textContent = percent(middle);
  copyEl.className = Number.isFinite(middle) ? (middle >= 0 ? 'positive' : 'negative') : '';
  const vsEl = $('breadth-vs-spy');
  if (Number.isFinite(spy) && Number.isFinite(middle)) {
    const gap = (spy - middle) * 100;
    vsEl.textContent = `${gap > 0 ? '+' : ''}${gap.toFixed(1)} pp`;
    vsEl.className = gap >= 0 ? 'positive' : 'negative';
  } else {
    vsEl.textContent = '—';
    vsEl.className = '';
  }
  const other = period === 63 ? 252 : 63;
  $('breadth-year').textContent = `Other window · ${other} sessions: ${levelPercent(mood.breadth?.[`up_${other}`])} rose, median ${percent(mood.breadth?.[`median_${other}`])}`;

  const breakdown = marketBreakdown(mood.market_details, period);
  const listBreakdown = marketBreakdown(mood.market_details, period, true);
  renderRegimeCharts();
  renderStockHistogram(mood, period);
  renderSectors(breakdown);
  renderDistribution(breakdown, listBreakdown);
  renderComparison(mood, period);
  renderSectorRank();
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
    moodState.observer = new ResizeObserver(() => {
      if (moodState.mood && !$('tape-panel').hidden) {
        renderRegimeCharts();
        renderStockHistogram(moodState.mood, moodState.period);
      }
    });
    moodState.observer.observe($('spy-chart'));
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
  if (!lists && moodState.mood) {
    renderRegimeCharts();
    renderStockHistogram(moodState.mood, moodState.period);
  }
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
  $("range-method").textContent = rangeMethod(mood);
  bindMoodPanels();
  $("mood-status").hidden = true;
  $("mood-content").hidden = false;
  renderMarketDesk();
  bindMarketDesk();
}

async function loadMood() {
  try {
    const [moodResponse, releaseResponse] = await Promise.all([
      fetch("./market-mood.json", { cache: "no-cache" }),
      fetch("./release.json", { cache: "no-cache" }),
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
    $("mood-status").textContent = error instanceof Error ? error.message : "Unable to load the market snapshot.";
  }
}

void loadMood();
