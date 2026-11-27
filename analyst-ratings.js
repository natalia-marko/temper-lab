// Analyst ratings: published analyst opinion for every company on this week's
// Research lists (Hot tape, Growth, Cheap; the Shortlist marked). Reads
// share/analyst-ratings.json (tools/build_analyst_ratings.py) and shows it only
// when it belongs to the current release. Opinion, not a signal: nothing is
// ranked by it, and the default order is each list's own rank.
const ANALYST_LISTS = [["all", "All lists"], ["shortlist", "Shortlist"], ["strength", "Hot tape"], ["growth", "Growth"], ["undervalued", "Cheap"]];
const ANALYST_LIST_KEYS = ["shortlist", "strength", "growth", "undervalued"];
const ANALYST_RANK_HINTS = { all: "Shortlist first, by its rank", shortlist: "Shortlist rank", strength: "Hot tape rank", growth: "Growth rank", undervalued: "Cheap rank" };
const ANALYST_SORT_KEYS = ["company", "rank", "total", "buy_share", "buy_share_delta", "eps_revisions", "implied_upside"];
const ANALYST_SORT_NAMES = { company: "ticker", rank: "list rank", total: "number of ratings", buy_share: "Buy share", buy_share_delta: "mix change vs last month", eps_revisions: "net EPS revisions", implied_upside: "implied upside" };
const ANALYST_SORT_DEFAULT_DIR = { company: "asc", rank: "asc" };
const ANALYST_DEFAULT_FILTERS = { list: "all", query: "", sector: "", minTotal: 3, flags: [], lens: null, pinned: null, sortKey: "rank", sortDir: "asc" };
const ANALYST_SVG_NS = "http://www.w3.org/2000/svg";
const ANALYST_LENS_KEYS = ["up_below", "up_in", "dn_below", "dn_in"];
const ANALYST_SHARE_MIN = 3;   // ratings needed for Buy share in the summary and for the month-on-month change
const ANALYST_MOVER_MIN = 5;   // ratings needed in both months to appear among the month's movers
const ANALYST_SOON_DAYS = 30;  // results dates shown and filtered within this many days of the freeze
const ANALYST_COLUMNS = 8;
const ANALYST_EPSILON = 1e-9;
const ANALYST_MIX_SEGMENTS = [
  ["strong_buy", "sb", "Strong Buy"],
  ["buy", "buy", "Buy"],
  ["hold", "hold", "Hold"],
  ["sell", "sell", "Sell"],
  ["strong_sell", "ss", "Strong Sell"],
];
const ANALYST_FLAGS = [
  ["more_bullish", "More bullish than last month", (row) => row.delta != null && row.delta > ANALYST_EPSILON],
  ["less_bullish", "Less bullish than last month", (row) => row.delta != null && row.delta < -ANALYST_EPSILON],
  ["eps_cut", "EPS estimates cut more than raised", (row) => row.eps != null && row.eps.down > row.eps.up],
  ["below_low", "Close below lowest target", (row) => row.belowLow],
  ["results_soon", "Results in the next 30 days", (row) => row.resultsSoon],
];
const analystState = { data: null, rows: [], filters: { ...ANALYST_DEFAULT_FILTERS } };
const analystEl = (id) => document.getElementById(id);

function analystDate(iso, withYear = true) {
  if (!iso) return "date unavailable";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC",
  });
}

function addDays(iso, days) {
  const day = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mixShare(mix) {
  if (!mix?.total) return null;
  return (mix.strong_buy + mix.buy) / mix.total;
}

// One display row per company: the shipped facts plus the few derived numbers.
function analystRow(raw, asOf) {
  const ratings = raw.ratings?.total > 0 ? raw.ratings : null;
  const prior = raw.ratings_prior?.total > 0 ? raw.ratings_prior : null;
  const total = ratings?.total ?? 0;
  const priorTotal = prior?.total ?? 0;
  const share = mixShare(ratings);
  const delta = total >= ANALYST_SHARE_MIN && priorTotal >= ANALYST_SHARE_MIN ? share - mixShare(prior) : null;
  const close = finite(raw.close);
  const targets = raw.targets && finite(raw.targets.low) != null && finite(raw.targets.median) != null && finite(raw.targets.high) != null ? raw.targets : null;
  const soonLimit = asOf ? addDays(asOf, ANALYST_SOON_DAYS) : null;
  return {
    symbol: raw.symbol,
    name: raw.name || raw.symbol,
    sector: raw.sector || (typeof sectorFor === "function" ? sectorFor((raw.industry || "").trim() || "__unclassified") : "unclassified"),
    lists: raw.lists || {},
    loss: raw.loss === true,
    ratings, prior, total, priorTotal, share, delta,
    eps: raw.eps_30d && finite(raw.eps_30d.up) != null && finite(raw.eps_30d.down) != null ? raw.eps_30d : null,
    estimateChange: finite(raw.estimate_change_90d),
    close, targets,
    upside: targets && close ? targets.median / close - 1 : null,
    range: targets ? (targets.high - targets.low) / targets.median : null,
    belowLow: Boolean(targets && close != null && close < targets.low),
    aboveHigh: Boolean(targets && close != null && close > targets.high),
    nextResults: raw.next_results || null,
    resultsSoon: Boolean(raw.next_results && soonLimit && raw.next_results <= soonLimit),
  };
}

function onList(row, list) {
  return list === "all" || row.lists?.[list] != null;
}

function listCounts(rows) {
  const counts = { all: rows.length };
  for (const key of ANALYST_LIST_KEYS) counts[key] = rows.filter((row) => onList(row, key)).length;
  return counts;
}

function rankFor(row, list) {
  return list === "all" ? row.lists?.shortlist ?? null : row.lists?.[list] ?? null;
}

function analystSortValue(row, key, list) {
  if (key === "company") return row.symbol;
  if (key === "rank") return rankFor(row, list);
  if (key === "total") return row.total > 0 ? row.total : null;
  if (key === "buy_share") return row.share;
  if (key === "buy_share_delta") return row.delta;
  if (key === "eps_revisions") return row.eps ? row.eps.up - row.eps.down : null;
  if (key === "implied_upside") return row.upside;
  return null;
}

// n/a sinks last in both directions; ties break by ticker.
function analystRowCompare(a, b, sortKey, sortDir, list) {
  const va = analystSortValue(a, sortKey, list);
  const vb = analystSortValue(b, sortKey, list);
  const aMissing = va == null || (typeof va === "number" && Number.isNaN(va));
  const bMissing = vb == null || (typeof vb === "number" && Number.isNaN(vb));
  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  if (!aMissing) {
    const diff = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    if (diff !== 0) return sortDir === "asc" ? diff : -diff;
  }
  return a.symbol.localeCompare(b.symbol);
}

// Rows passing the list, search, sector and coverage filters, before the "Show only" chips.
function baseAnalystRows(rows, filters) {
  const query = (filters.query || "").trim().toLowerCase();
  return rows.filter((row) => onList(row, filters.list || "all")
    && (!filters.sector || row.sector === filters.sector)
    && row.total >= (filters.minTotal || 0)
    && (!query || `${row.symbol} ${row.name}`.toLowerCase().includes(query)));
}

function analystLensMatch(row, lens) {
  if (!lens) return true;
  if (!row.eps || !row.targets || row.close == null) return false;
  const up = row.eps.up > row.eps.down;
  const dn = row.eps.down > row.eps.up;
  if (lens === "up_below") return up && row.belowLow;
  if (lens === "up_in") return up && !row.belowLow;
  if (lens === "dn_below") return dn && row.belowLow;
  if (lens === "dn_in") return dn && !row.belowLow;
  return true;
}

function analystLensCounts(rows) {
  const counts = { up_below: 0, up_in: 0, dn_below: 0, dn_in: 0 };
  for (const row of rows) {
    for (const key of ANALYST_LENS_KEYS) if (analystLensMatch(row, key)) counts[key] += 1;
  }
  return counts;
}

function filteredAnalysts(rows, filters) {
  const active = ANALYST_FLAGS.filter(([key]) => (filters.flags || []).includes(key));
  const sortKey = ANALYST_SORT_KEYS.includes(filters.sortKey) ? filters.sortKey : "rank";
  const sortDir = filters.sortDir === "desc" ? "desc" : "asc";
  return baseAnalystRows(rows, filters)
    .filter((row) => analystLensMatch(row, filters.lens || null))
    .filter((row) => active.every(([, , test]) => test(row)))
    .sort((a, b) => analystRowCompare(a, b, sortKey, sortDir, filters.list || "all"));
}

function median(values) {
  const sorted = values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function analystSummary(rows) {
  const mixed = rows.filter((row) => row.delta != null);
  const revised = rows.filter((row) => row.eps != null);
  const targeted = rows.filter((row) => row.targets && row.close != null);
  return {
    shown: rows.length,
    buyShare: median(rows.filter((row) => row.total >= ANALYST_SHARE_MIN).map((row) => row.share)),
    moreBullish: mixed.filter((row) => row.delta > ANALYST_EPSILON).length,
    lessBullish: mixed.filter((row) => row.delta < -ANALYST_EPSILON).length,
    unchanged: mixed.filter((row) => Math.abs(row.delta) <= ANALYST_EPSILON).length,
    raised: revised.filter((row) => row.eps.up > row.eps.down).length,
    cut: revised.filter((row) => row.eps.down > row.eps.up).length,
    even: revised.filter((row) => row.eps.up === row.eps.down).length,
    upside: median(targeted.map((row) => row.upside)),
    belowLow: targeted.filter((row) => row.belowLow).length,
    aboveHigh: targeted.filter((row) => row.aboveHigh).length,
    targeted: targeted.length,
  };
}

function analystByList(rows) {
  return ANALYST_LIST_KEYS.map((key) => {
    const members = rows.filter((row) => onList(row, key));
    const revised = members.filter((row) => row.eps != null);
    const targeted = members.filter((row) => row.targets && row.close != null);
    const share = (part, whole) => (whole.length ? part.length / whole.length : null);
    return {
      key,
      label: ANALYST_LISTS.find(([k]) => k === key)[1],
      names: members.length,
      buyShare: median(members.filter((row) => row.total >= ANALYST_SHARE_MIN).map((row) => row.share)),
      upside: median(targeted.map((row) => row.upside)),
      raised: share(revised.filter((row) => row.eps.up > row.eps.down), revised),
      cut: share(revised.filter((row) => row.eps.down > row.eps.up), revised),
      belowLow: share(targeted.filter((row) => row.belowLow), targeted),
    };
  });
}

function analystMovers(rows, limit = 5) {
  const movers = rows.filter((row) => row.delta != null && Math.abs(row.delta) > ANALYST_EPSILON
    && row.total >= ANALYST_MOVER_MIN && row.priorTotal >= ANALYST_MOVER_MIN);
  const order = (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.symbol.localeCompare(b.symbol);
  return {
    up: movers.filter((row) => row.delta > 0).sort(order).slice(0, limit),
    down: movers.filter((row) => row.delta < 0).sort(order).slice(0, limit),
  };
}

function analystText(parent, tag, content, className) {
  const child = document.createElement(tag);
  child.textContent = content;
  if (className) child.className = className;
  parent.appendChild(child);
  return child;
}

function formatShare(value) {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatSignedShare(value) {
  if (value == null) return "n/a";
  const pct = value * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function formatDelta(value) {
  const points = value * 100;
  return `${points > 0.05 ? "+" : ""}${points.toFixed(1)} pp`;
}

function formatWhole(value) {
  return value == null ? "n/a" : `${Math.round(value * 100)}%`;
}

function formatPrice(value) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function tone(value) {
  if (value == null) return "tone-flat";
  return value > ANALYST_EPSILON ? "tone-up" : value < -ANALYST_EPSILON ? "tone-down" : "tone-flat";
}

function tickerLink(parent, symbol, className) {
  const link = analystText(parent, "a", symbol, className);
  link.setAttribute("href", `./ticker.html?t=${encodeURIComponent(symbol)}`);
  return link;
}

function renderCompanyCell(tr, row) {
  const td = analystText(tr, "td", "", "l analyst-company-cell");
  if (globalThis.TLWatch) td.appendChild(Object.assign(globalThis.TLWatch.button(row.symbol, row.name), { className: "tl-star lead" }));
  tickerLink(td, row.symbol, "analyst-symbol-link");
  if (row.loss) {
    const tag = analystText(td, "span", "Loss", "loss-tag");
    tag.setAttribute("title", "Trailing twelve-month net income is negative");
  }
  analystText(td, "small", row.name);
  if (row.resultsSoon) analystText(td, "span", `Results ${analystDate(row.nextResults, false)}`, "results-tag");
}

function renderListsCell(tr, row) {
  const td = analystText(tr, "td", "", "l analyst-lists-cell");
  for (const key of ANALYST_LIST_KEYS) {
    const rank = row.lists?.[key];
    if (rank == null) continue;
    const label = ANALYST_LISTS.find(([k]) => k === key)[1];
    analystText(td, "span", `${label} #${rank}`, `list-chip ${key}`);
  }
}

function renderMixCell(tr, row) {
  if (!row.ratings) {
    analystText(tr, "td", "No ratings", "analyst-na");
    return;
  }
  const r = row.ratings;
  const td = analystText(tr, "td", "", "analyst-mix-cell");
  const bar = analystText(td, "div", "", "analyst-mix-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", `${r.strong_buy} Strong Buy, ${r.buy} Buy, ${r.hold} Hold, ${r.sell} Sell, ${r.strong_sell} Strong Sell of ${r.total} ratings`);
  for (const [key, cls, label] of ANALYST_MIX_SEGMENTS) {
    const count = r[key] || 0;
    if (count <= 0) continue;
    const seg = analystText(bar, "i", "", `mix-seg ${cls}`);
    seg.setAttribute("style", `flex:${count}`);
    seg.setAttribute("title", `${label}: ${count}`);
  }
  const counts = analystText(td, "div", "", "analyst-mix-counts");
  analystText(counts, "span", `${r.strong_buy} · ${r.buy} · ${r.hold} · ${r.sell} · ${r.strong_sell}`);
  analystText(counts, "strong", `(${r.total})`);
}

function renderShareCell(tr, row) {
  if (row.share == null) {
    analystText(tr, "td", "n/a", "analyst-na");
    return;
  }
  const td = analystText(tr, "td", "", "analyst-count-cell analyst-stack-cell");
  analystText(td, "strong", formatShare(row.share));
  analystText(td, "small", `${row.ratings.strong_buy + row.ratings.buy} of ${row.total}`);
}

function renderDeltaCell(tr, row) {
  if (row.delta == null) {
    const td = analystText(tr, "td", "", "analyst-count-cell analyst-stack-cell");
    analystText(td, "strong", "n/a", "tone-flat");
    analystText(td, "small", row.priorTotal ? `n ${row.priorTotal} → ${row.total}` : "no prior month");
    return;
  }
  const td = analystText(tr, "td", "", "analyst-count-cell analyst-stack-cell");
  analystText(td, "strong", formatDelta(row.delta), tone(row.delta));
  if (row.priorTotal !== row.total) {
    const note = analystText(td, "small", `n ${row.priorTotal} → ${row.total}`, "coverage-shift");
    note.setAttribute("title", "Total analyst coverage changed from last month");
  } else {
    analystText(td, "small", `n = ${row.total}`);
  }
}

function renderEpsCell(tr, row) {
  if (!row.eps) {
    analystText(tr, "td", "n/a", "analyst-na");
    return;
  }
  const { up, down } = row.eps;
  const td = analystText(tr, "td", "", "analyst-count-cell analyst-stack-cell analyst-eps-cell");
  analystText(td, "strong", `${up} up · ${down} down`);
  const bar = analystText(td, "div", "", "analyst-rev-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", `${up} upward and ${down} downward EPS revisions in 30 days`);
  if (up + down > 0) {
    if (up > 0) analystText(bar, "i", "", "up").setAttribute("style", `flex:${up}`);
    if (down > 0) analystText(bar, "i", "", "down").setAttribute("style", `flex:${down}`);
  } else {
    analystText(bar, "i", "", "flat").setAttribute("style", "flex:1");
  }
  analystText(td, "small", row.estimateChange == null ? "estimate change n/a" : `est. ${formatSignedShare(row.estimateChange)} vs 3m ago`);
}

function renderTargetCell(tr, row) {
  const close = row.close;
  if (!row.targets) {
    analystText(tr, "td", close != null ? `Close ${formatPrice(close)} · no targets` : "n/a", "l analyst-na");
    return;
  }
  const { low, median: med, high } = row.targets;
  const td = analystText(tr, "td", "", "l analyst-count-cell analyst-target-cell");
  const top = analystText(td, "div", "", "analyst-target-top");
  const closeWrap = analystText(top, "span", "Close ");
  analystText(closeWrap, "strong", close != null ? formatPrice(close) : "n/a");
  analystText(top, "span", " · ");
  const medWrap = analystText(top, "span", "Med ");
  analystText(medWrap, "strong", formatPrice(med), "target-med-val");
  if (row.belowLow) {
    analystText(top, "span", "Below low", "target-flag below").setAttribute("title", `Frozen Friday close (${formatPrice(close)}) is below the lowest analyst target (${formatPrice(low)})`);
  } else if (row.aboveHigh) {
    analystText(top, "span", "Above high", "target-flag above").setAttribute("title", `Frozen Friday close (${formatPrice(close)}) is above the highest analyst target (${formatPrice(high)})`);
  }
  const points = [low, high, med, ...(close != null ? [close] : [])];
  const lo = Math.min(...points);
  const span = Math.max(...points) - lo || 1;
  const pct = (v) => `${Math.max(0, Math.min(100, ((v - lo) / span) * 100)).toFixed(1)}%`;
  const gauge = analystText(td, "div", "", "analyst-target-gauge");
  analystText(gauge, "small", formatPrice(low), "gauge-end");
  const track = analystText(gauge, "div", "", "gauge-track");
  track.setAttribute("role", "img");
  track.setAttribute("aria-label", `Targets: low ${formatPrice(low)}, median ${formatPrice(med)}, high ${formatPrice(high)}${close != null ? `; close ${formatPrice(close)}` : ""}`);
  const left = ((low - lo) / span) * 100;
  analystText(track, "i", "", "gauge-band").setAttribute("style", `left:${left.toFixed(1)}%;width:${Math.max(2, Math.min(100 - left, ((high - low) / span) * 100)).toFixed(1)}%`);
  const medMark = analystText(track, "i", "", "gauge-mark med");
  medMark.setAttribute("style", `left:${pct(med)}`);
  medMark.setAttribute("title", `Median target: ${formatPrice(med)}`);
  if (close != null) {
    const closeMark = analystText(track, "i", "", "gauge-mark close");
    closeMark.setAttribute("style", `left:${pct(close)}`);
    closeMark.setAttribute("title", `Friday close: ${formatPrice(close)}`);
  }
  analystText(gauge, "small", formatPrice(high), "gauge-end");
}

function renderUpsideCell(tr, row) {
  if (row.upside == null) {
    analystText(tr, "td", "n/a", "analyst-na");
    return;
  }
  const td = analystText(tr, "td", "", "analyst-count-cell analyst-stack-cell");
  analystText(td, "strong", formatSignedShare(row.upside), tone(row.upside));
  analystText(td, "small", `range ${formatShare(row.range)}`);
}

function renderSummary(rows) {
  const s = analystSummary(rows);
  const total = analystState.rows.length;
  analystEl("tile-shown").textContent = String(s.shown);
  analystEl("tile-shown-sub").textContent = `of ${total} companies on this week’s Research lists`;
  analystEl("tile-buy").textContent = formatShare(s.buyShare);
  analystEl("tile-mix-up").textContent = String(s.moreBullish);
  analystEl("tile-mix-down").textContent = String(s.lessBullish);
  analystEl("tile-mix-sub").textContent = `more bullish · less bullish · ${s.unchanged} unchanged`;
  analystEl("tile-eps-up").textContent = String(s.raised);
  analystEl("tile-eps-down").textContent = String(s.cut);
  analystEl("tile-eps-sub").textContent = `more raised · more cut (current year) · ${s.even} even`;
  analystEl("tile-upside").textContent = formatSignedShare(s.upside);
  analystEl("tile-upside-sub").textContent = `${s.belowLow} below the lowest target · ${s.aboveHigh} above the highest`;
}

function renderByList() {
  const body = analystEl("analyst-bylist");
  body.replaceChildren();
  for (const item of analystByList(analystState.rows)) {
    const tr = analystText(body, "tr", "");
    const first = analystText(tr, "td", "");
    analystText(first, "span", item.label, `list-chip ${item.key}`);
    analystText(tr, "td", String(item.names));
    analystText(tr, "td", formatShare(item.buyShare));
    analystText(tr, "td", formatSignedShare(item.upside));
    analystText(tr, "td", formatWhole(item.raised), "tone-up");
    analystText(tr, "td", formatWhole(item.cut), "tone-down");
    analystText(tr, "td", formatWhole(item.belowLow));
  }
}

function analystSvg(tag, attrs, text) {
  const node = document.createElementNS(ANALYST_SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function renderScatter(baseRows) {
  const wrap = analystEl("ar-plot");
  const tip = analystEl("ar-tip");
  if (!wrap || typeof document.createElementNS !== "function") return;
  const old = typeof wrap.querySelector === "function" ? wrap.querySelector("svg") : null;
  if (old && typeof old.remove === "function") old.remove();
  else if (!old && Array.isArray(wrap.children)) wrap.children = wrap.children.filter((c) => c.tag !== "svg");

  const W = 580, H = 264, L = 46, R = 16, T = 26, B = 40;
  const pw = W - L - R, ph = H - T - B;
  const XMIN = -25, XMAX = 120, YMIN = -16, YMAX = 16;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sx = (u) => L + ((clamp(u * 100, XMIN, XMAX) - XMIN) / (XMAX - XMIN)) * pw;
  const sy = (net) => T + ((YMAX - clamp(net, YMIN, YMAX)) / (YMAX - YMIN)) * ph;

  const svg = analystSvg("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "Net 30-day EPS revisions versus implied upside to median target",
  });
  const x0 = sx(0), y0 = sy(0);

  svg.appendChild(analystSvg("text", { x: L, y: 14, fill: "#465b4e", "font-size": 10.5, "font-weight": 650 }, "Net EPS revisions (30d, raised − cut)"));
  svg.appendChild(analystSvg("text", { x: L + pw, y: H - 4, "text-anchor": "end", fill: "#465b4e", "font-size": 10.5, "font-weight": 650 }, "Implied upside to median target"));

  svg.appendChild(analystSvg("rect", { x: x0, y: T, width: L + pw - x0, height: y0 - T, fill: "#eef6f0", opacity: 0.65 }));
  svg.appendChild(analystSvg("rect", { x: x0, y: y0, width: L + pw - x0, height: T + ph - y0, fill: "#fbf1ef", opacity: 0.65 }));

  for (const xv of [-20, 0, 20, 40, 60, 80, 100, 120]) {
    const px = sx(xv / 100);
    svg.appendChild(analystSvg("line", {
      x1: px, x2: px, y1: T, y2: T + ph,
      stroke: xv === 0 ? "#8da195" : "#e6ece7",
      "stroke-width": xv === 0 ? 1.2 : 1,
      ...(xv === 0 ? { "stroke-dasharray": "3 3" } : {}),
    }));
    const label = xv === 120 ? "+120%+" : (xv > 0 ? `+${xv}%` : `${xv}%`);
    svg.appendChild(analystSvg("text", { x: px, y: T + ph + 15, "text-anchor": "middle", fill: "#64766b", "font-size": 10 }, label));
  }
  for (const yv of [-15, -10, -5, 0, 5, 10, 15]) {
    const py = sy(yv);
    svg.appendChild(analystSvg("line", {
      x1: L, x2: L + pw, y1: py, y2: py,
      stroke: yv === 0 ? "#687f72" : "#e6ece7",
      "stroke-width": yv === 0 ? 1.4 : 1,
    }));
    const label = yv === 15 ? "+15+" : yv === -15 ? "−15" : (yv > 0 ? `+${yv}` : yv < 0 ? `−${Math.abs(yv)}` : "0");
    svg.appendChild(analystSvg("text", { x: L - 7, y: py + 3.5, "text-anchor": "end", fill: "#64766b", "font-size": 10 }, label));
  }

  svg.appendChild(analystSvg("text", { x: L + pw - 6, y: T + 13, "text-anchor": "end", fill: "#1e6547", "font-size": 10, "font-weight": 600 }, "EPS raised ↑ · Upside to target →"));
  svg.appendChild(analystSvg("text", { x: L + pw - 6, y: T + ph - 6, "text-anchor": "end", fill: "#9c473b", "font-size": 10, "font-weight": 600 }, "EPS cut ↓ · Target-lag risk"));

  const xh = analystSvg("line", { x1: L, x2: L + pw, y1: 0, y2: 0, stroke: "#3b5946", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 });
  const xv = analystSvg("line", { x1: 0, x2: 0, y1: T, y2: T + ph, stroke: "#3b5946", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 });
  const ring = analystSvg("circle", { cx: 0, cy: 0, r: 8.5, fill: "none", stroke: "#1f3d2f", "stroke-width": 1.8, opacity: 0 });
  svg.appendChild(xh);
  svg.appendChild(xv);

  const lens = analystState.filters.lens || null;
  const pinned = analystState.filters.pinned || null;
  const pts = baseRows.filter((row) => row.eps && row.upside != null)
    .sort((a, b) => Number(a.lists?.shortlist != null) - Number(b.lists?.shortlist != null)
      || Number(a.symbol === pinned) - Number(b.symbol === pinned));

  for (const row of pts) {
    const net = row.eps.up - row.eps.down;
    const isSl = row.lists?.shortlist != null;
    const isPin = row.symbol === pinned;
    const matched = analystLensMatch(row, lens) && (!pinned || isPin);
    const cx = sx(row.upside);
    const cy = sy(net);
    const fill = net > 0 ? (isSl ? "#1e6547" : "#5e9977") : net < 0 ? (isSl ? "#9c473b" : "#cc7e70") : "#8a9990";
    const dot = analystSvg("circle", {
      cx: cx.toFixed(1), cy: cy.toFixed(1),
      r: isPin ? 6.5 : (isSl ? 5.2 : 3.3),
      fill,
      stroke: isPin ? "#1f3d2f" : (isSl ? "#fff" : "none"),
      "stroke-width": isPin ? 2 : (isSl ? 1.5 : 0),
      opacity: matched ? (isSl || isPin ? 0.96 : 0.65) : 0.14,
      style: "cursor:pointer",
    });
    dot.addEventListener("mouseenter", () => {
      xh.setAttribute("y1", cy); xh.setAttribute("y2", cy); xh.setAttribute("opacity", "0.45");
      xv.setAttribute("x1", cx); xv.setAttribute("x2", cx); xv.setAttribute("opacity", "0.45");
      ring.setAttribute("cx", cx); ring.setAttribute("cy", cy); ring.setAttribute("opacity", "0.9");
      if (!tip) return;
      tip.hidden = false;
      tip.replaceChildren();
      analystText(tip, "b", `${row.symbol}${isSl ? ` · Shortlist #${row.lists.shortlist}` : ""}`);
      analystText(tip, "div", row.name, "sub");
      analystText(tip, "div", `Upside ${formatSignedShare(row.upside)}${row.belowLow ? " · below floor" : ""} · Buy ${formatShare(row.share)}`);
      analystText(tip, "div", `EPS 30d: ${row.eps.up}↑ / ${row.eps.down}↓ (net ${net > 0 ? "+" : ""}${net})`);
      if (tip.style) {
        const leftPct = (cx / W) * 100;
        const topPct = (cy / H) * 100;
        tip.style.left = leftPct > 60 ? "auto" : `${Math.min(72, leftPct + 2)}%`;
        tip.style.right = leftPct > 60 ? `${Math.max(2, 100 - leftPct + 2)}%` : "auto";
        tip.style.top = `${Math.max(2, topPct - 20)}%`;
      }
    });
    dot.addEventListener("mouseleave", () => {
      if (tip) tip.hidden = true;
      xh.setAttribute("opacity", "0");
      xv.setAttribute("opacity", "0");
      ring.setAttribute("opacity", "0");
    });
    dot.addEventListener("click", () => {
      analystState.filters.pinned = analystState.filters.pinned === row.symbol ? null : row.symbol;
      analystState.filters.query = analystState.filters.pinned || "";
      const input = analystEl("analyst-query");
      if (input) input.value = analystState.filters.query;
      renderAnalystResults();
    });
    svg.appendChild(dot);
  }
  svg.appendChild(ring);
  if (tip && typeof wrap.insertBefore === "function") wrap.insertBefore(svg, tip);
  else wrap.appendChild(svg);
}

function renderDivergenceStage() {
  const filters = analystState.filters;
  const scopeRows = baseAnalystRows(analystState.rows, { ...filters, query: filters.pinned ? "" : filters.query });
  const counts = analystLensCounts(scopeRows);
  for (const key of ANALYST_LENS_KEYS) {
    const el = analystEl(`lens-${key}`);
    if (el) el.textContent = String(counts[key]);
  }
  if (typeof document.querySelectorAll === "function") {
    for (const btn of document.querySelectorAll("[data-lens]")) {
      const on = btn.dataset.lens === filters.lens;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }
  const hint = analystEl("ar-lens-hint");
  const clear = analystEl("ar-lens-clear");
  if (hint) hint.hidden = Boolean(filters.lens);
  if (clear) clear.hidden = !filters.lens;

  const pinBox = analystEl("ar-pin");
  if (pinBox) {
    pinBox.hidden = !filters.pinned;
    if (filters.pinned) {
      const sym = analystEl("ar-pin-sym");
      const link = analystEl("ar-pin-link");
      if (sym) sym.textContent = `Pinned: ${filters.pinned}`;
      if (link) link.setAttribute("href", `./ticker.html?t=${encodeURIComponent(filters.pinned)}`);
    }
  }
  renderScatter(scopeRows);
}

function renderMovers(rows) {
  const movers = analystMovers(rows, 3);
  for (const [id, list, cls] of [["analyst-movers-up", movers.up, "up"], ["analyst-movers-down", movers.down, "dn"]]) {
    const ul = analystEl(id);
    if (!ul) continue;
    ul.replaceChildren();
    if (!list.length) {
      analystText(ul, "li", "None among the names shown.", "none");
      continue;
    }
    for (const row of list) {
      const li = analystText(ul, "li", "", cls);
      tickerLink(li, row.symbol);
      analystText(li, "span", formatDelta(row.delta), tone(row.delta));
    }
  }
}

function renderFlags(base) {
  const container = analystEl("analyst-flags");
  container.replaceChildren();
  analystText(container, "span", "Show only", "analyst-flags-label");
  const active = analystState.filters.flags || [];
  for (const [key, label, test] of ANALYST_FLAGS) {
    const on = active.includes(key);
    const button = analystText(container, "button", label, `flag-chip${on ? " on" : ""}`);
    button.type = "button";
    button.dataset.flag = key;
    button.setAttribute("aria-pressed", on ? "true" : "false");
    analystText(button, "span", String(base.filter(test).length), "c");
  }
}

function syncListButtons() {
  const counts = listCounts(analystState.rows);
  for (const button of document.querySelectorAll("[data-analyst-list]")) {
    const on = button.dataset.analystList === analystState.filters.list;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
  for (const span of document.querySelectorAll("[data-list-count]")) {
    span.textContent = analystState.rows.length ? String(counts[span.dataset.listCount] ?? "") : "";
  }
  const hint = analystEl("rank-hint");
  if (hint) hint.textContent = ANALYST_RANK_HINTS[analystState.filters.list] || "";
}

function syncAnalystSortHeaders() {
  const { sortKey, sortDir } = analystState.filters;
  for (const button of document.querySelectorAll("[data-analyst-sort]")) {
    const active = button.dataset.analystSort === sortKey;
    const heading = button.closest("th");
    button.classList.toggle("sorted-btn", active);
    button.textContent = button.dataset.label;
    if (active) {
      const mark = document.createElement("span");
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = sortDir === "asc" ? " ↑" : " ↓";
      button.appendChild(mark);
    }
    if (!heading) continue;
    if (active) heading.setAttribute("aria-sort", sortDir === "asc" ? "ascending" : "descending");
    else heading.removeAttribute("aria-sort");
  }
}

function toggleAnalystSort(key) {
  const filters = analystState.filters;
  if (filters.sortKey === key) {
    filters.sortDir = filters.sortDir === "asc" ? "desc" : "asc";
  } else {
    filters.sortKey = key;
    filters.sortDir = ANALYST_SORT_DEFAULT_DIR[key] || "desc";
  }
  renderAnalystResults();
}

function renderAnalystResults() {
  syncListButtons();
  syncAnalystSortHeaders();
  const target = analystEl("analyst-results");
  target.replaceChildren();
  if (!analystState.rows.length) {
    analystEl("analyst-count").textContent = "No analyst summaries in this snapshot.";
    analystText(analystText(target, "tr", ""), "td", "No dated ratings are available.", "empty").colSpan = ANALYST_COLUMNS;
    return;
  }
  const filters = analystState.filters;
  const base = baseAnalystRows(analystState.rows, filters);
  const rows = filteredAnalysts(analystState.rows, filters);
  renderFlags(base);
  renderDivergenceStage();
  renderSummary(rows);
  renderMovers(rows);
  const hidden = analystState.rows.filter((row) => onList(row, filters.list) && row.total < (filters.minTotal || 0)).length;
  const order = filters.sortKey === "rank" && filters.list === "all" ? "Shortlist rank, then A–Z" : ANALYST_SORT_NAMES[filters.sortKey];
  analystEl("analyst-count").textContent = `Showing ${rows.length} of ${analystState.rows.length} companies · sorted by ${order}`
    + `${filters.sortDir === "asc" ? " (low to high)" : " (high to low)"}`
    + `${hidden ? ` · ${hidden} with fewer than ${filters.minTotal} ratings hidden` : ""}.`;
  if (!rows.length) {
    analystText(analystText(target, "tr", ""), "td", "No companies match. Change or reset the filters.", "empty").colSpan = ANALYST_COLUMNS;
    return;
  }
  for (const row of rows) {
    const tr = analystText(target, "tr", "");
    renderCompanyCell(tr, row);
    renderListsCell(tr, row);
    renderMixCell(tr, row);
    renderShareCell(tr, row);
    renderDeltaCell(tr, row);
    renderEpsCell(tr, row);
    renderTargetCell(tr, row);
    renderUpsideCell(tr, row);
  }
}

function analystSectorOptions(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.sector, (counts.get(row.sector) || 0) + 1);
  const options = [{ value: "", label: "All sectors", count: null, disabled: false }];
  for (const [key, label] of SECTORS) {
    const count = counts.get(key) || 0;
    if (key === "unclassified" && count === 0) continue;
    options.push({ value: key, label, count, disabled: count === 0 });
  }
  return options;
}

function populateAnalystSectorSelect() {
  const select = analystEl("analyst-sector");
  if (!select) return;
  const options = analystSectorOptions(analystState.rows);
  select.replaceChildren();
  for (const { value, label, count, disabled } of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = count == null ? label : `${label} (${count})`;
    if (disabled) option.disabled = true;
    select.appendChild(option);
  }
  select.value = analystState.filters.sector || "";
}

// The page's own file must belong to the published release; otherwise it waits.
function checkAnalystSnapshot(data, release) {
  if (data?.schema !== "analyst-ratings-1" || !Array.isArray(data.rows)) return "The analyst snapshot has an unknown format.";
  if (release && (release.run_id !== data.desk_run_id || release.as_of !== data.as_of)) return "The analyst screen is awaiting the current release.";
  return null;
}

async function loadAnalystSnapshot() {
  try {
    const [dataResponse, releaseResponse] = await Promise.all([
      fetch("./analyst-ratings.json", { cache: "no-cache" }),
      fetch("./release.json", { cache: "no-cache" }),
    ]);
    if (!dataResponse.ok) throw new Error("The weekly analyst snapshot is unavailable.");
    const data = await dataResponse.json();
    const release = releaseResponse.ok ? await releaseResponse.json() : null;
    const problem = checkAnalystSnapshot(data, release);
    if (problem) throw new Error(problem);
    analystState.data = data;
    analystState.rows = data.rows.map((row) => analystRow(row, data.as_of));
    analystEl("week-chip").textContent = `Data as of ${analystDate(data.as_of)}`;
    analystEl("aside-week").textContent = analystDate(data.as_of);
    analystEl("analyst-dates").textContent = `Prices: ${analystDate(data.as_of)} close · Ratings and targets retrieved ${analystDate(data.retrieved?.last)}`;
    const rated = analystState.rows.filter((row) => row.total >= ANALYST_SHARE_MIN).length;
    analystEl("analyst-coverage").textContent = `${rated} of ${analystState.rows.length} companies have 3+ ratings`;
    populateAnalystSectorSelect();
    renderByList();
    renderAnalystResults();
  } catch (error) {
    analystEl("week-chip").textContent = "Snapshot unavailable";
    analystEl("analyst-coverage").textContent = "";
    analystEl("analyst-count").textContent = error instanceof Error ? error.message : "Unable to load analyst ratings.";
    analystEl("analyst-results").replaceChildren();
  }
}

function startAnalystView() {
  const requested = new URLSearchParams(location.search).get("list");
  if (ANALYST_LISTS.some(([key]) => key === requested)) analystState.filters.list = requested;
  analystEl("analyst-lists").addEventListener("click", (event) => {
    const button = event.target.closest("[data-analyst-list]");
    if (!button) return;
    analystState.filters.list = button.dataset.analystList;
    analystState.filters.sortKey = "rank";
    analystState.filters.sortDir = "asc";
    renderAnalystResults();
  });
  analystEl("analyst-query").addEventListener("input", (event) => {
    analystState.filters.query = event.target.value;
    if (analystState.filters.pinned && event.target.value.trim().toUpperCase() !== analystState.filters.pinned) {
      analystState.filters.pinned = null;
    }
    renderAnalystResults();
  });
  analystEl("analyst-sector").addEventListener("change", (event) => {
    analystState.filters.sector = event.target.value;
    renderAnalystResults();
  });
  analystEl("analyst-min-total").addEventListener("change", (event) => {
    analystState.filters.minTotal = Number(event.target.value);
    renderAnalystResults();
  });
  analystEl("analyst-flags").addEventListener("click", (event) => {
    const button = event.target.closest("[data-flag]");
    if (!button) return;
    const flags = new Set(analystState.filters.flags || []);
    if (flags.has(button.dataset.flag)) flags.delete(button.dataset.flag);
    else flags.add(button.dataset.flag);
    analystState.filters.flags = [...flags];
    renderAnalystResults();
  });
  const lensesEl = analystEl("ar-lenses");
  if (lensesEl) {
    lensesEl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-lens]");
      if (!button) return;
      analystState.filters.lens = analystState.filters.lens === button.dataset.lens ? null : button.dataset.lens;
      renderAnalystResults();
    });
  }
  const lensClear = analystEl("ar-lens-clear");
  if (lensClear) {
    lensClear.addEventListener("click", () => {
      analystState.filters.lens = null;
      renderAnalystResults();
    });
  }
  const pinClear = analystEl("ar-pin-clear");
  if (pinClear) {
    pinClear.addEventListener("click", () => {
      analystState.filters.pinned = null;
      analystState.filters.query = "";
      analystEl("analyst-query").value = "";
      renderAnalystResults();
    });
  }
  analystEl("analyst-reset").addEventListener("click", () => {
    analystState.filters = { ...ANALYST_DEFAULT_FILTERS, flags: [] };
    analystEl("analyst-query").value = "";
    analystEl("analyst-sector").value = "";
    analystEl("analyst-min-total").value = "3";
    renderAnalystResults();
  });
  document.querySelector(".analyst-table-wrap thead").addEventListener("click", (event) => {
    const button = event.target.closest("[data-analyst-sort]");
    if (!button) return;
    toggleAnalystSort(button.dataset.analystSort);
    button.focus();
  });
  syncListButtons();
  syncAnalystSortHeaders();
  void loadAnalystSnapshot();
}

startAnalystView();
