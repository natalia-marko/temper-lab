// Research page. Four lists, one table each, the same three fact columns on
// every list (Trend, Shorted, Next results). The Shortlist (Composite) opens
// the page. Conviction lives on Analyst ratings and early-stage research files
// on the Ticker page; both keep their data in desk.json.
const SCREENS = [
  ["composite", "Shortlist"],
  ["growth", "Growth"],
  ["undervalued", "Cheap"],
  ["strength", "Hot tape"],
];
// The numbers that explain each list's order. LEAD marks the one a list ranks
// on; the Shortlist, Growth and Hot tape rank on a blend, shown as Score.
const COLUMNS = {
  composite: [
    ["part_strength", "Price strength", "pctile"],
    ["part_growth", "Profitability", "pctile"],
    ["part_undervalued", "Cheapness · OI / EV", "pctile"],
  ],
  growth: [
    ["roe", "Return on equity", "percent"],
    ["revenue_yoy", "Revenue vs year ago", "percent"],
    ["relative_strength_6m", "6 months vs QQQ", "percent"],
  ],
  undervalued: [
    ["operating_earnings_yield_ev", "OI / EV", "percent"],
    ["operating_earnings_yield", "OI / equity cap", "percent"],
    ["operating_margin", "TTM operating margin", "percent"],
  ],
  strength: [
    ["momentum_63", "63-session return", "percent"],
    ["momentum_252", "252-session return", "percent"],
  ],
};
const LEAD = { undervalued: "operating_earnings_yield_ev" };
const SCORED = new Set(["composite", "growth", "strength"]);
// Growth's score (growth-v2) averages these five percentiles inside the list;
// the same average, ranked across the market, is the Shortlist's Profitability.
const PROFITABILITY_PARTS = [
  ["return_on_equity", "return on equity"],
  ["return_on_assets", "return on assets"],
  ["operating_income_to_assets", "operating income / assets"],
  ["cash_flow_to_assets", "cash flow / assets"],
  ["gross_profit_to_assets", "gross profit / assets"],
];
// The Shortlist shows its first ten (at most 3 per sector) until asked for all.
const SHORTLIST_TOP = 10;
// Two named steers, deliberately not a scoring engine. Both are minority
// signals on the week they were set: liabilities above 75% of assets flags 26
// of 242 Growth names, cash conversion under 0.7 flags 29. They point at a
// number worth asking a question about. Neither is a verdict, neither feeds a
// rank, and neither is an industry-adjusted judgement - the site audit is
// explicit that a single leverage cutoff does not travel across industries,
// which is why the note says so rather than pretending otherwise.
const LEVERAGE_STEER = 0.75;
const CASH_CONVERSION_STEER = 0.7;
// The three trend rules tested in Leg D (claude/leg-d-trend-rules-2026-10-18.md);
// share/trend-rules.json holds each stock's answer at the last month-end close
// (signal_date), built in Python by tools/build_ticker_volume.py; the Watchlist reads
// the same file. A change between month-ends did not predict returns, so the
// month-end state is shown (claude/platform-architecture-review-2026-10-20.md).
const TREND_RULES = [
  ["A", "price above its 200-day average"],
  ["B", "12-month return, skipping the last month, above zero"],
  ["C", "50-day average above the 200-day"],
];
const state = {
  desk: null,
  screen: "composite",
  query: "",
  sector: "",
  showBroken: false,
  hideLoss: false,
  showAll: false,
  sortKey: "rank",
  sortDir: "desc",
  page: 0,
  pageSize: 25,
  // One-year price lines from ticker-volume.json, loaded when a panel opens.
  volume: null,
  volumeState: null,
};

const $ = (id) => document.getElementById(id);

function pct(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}
function money(value) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
function price(value) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
function day(iso) {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
function shortDay(iso) {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}
function fmt(value, kind) {
  if (kind === "money") return money(value);
  if (kind === "percent") return pct(value);
  if (kind === "pctile") return value == null ? "—" : value.toFixed(1);
  if (kind === "multiple") return value == null ? "—" : `${value.toFixed(2)}×`;
  return value == null ? "—" : String(value);
}

function scoreCell(idea) {
  if (!idea) return `<td class="score">—</td>`;
  return (
    `<td class="score" title="${idea.score.toFixed(1)} out of 100 on this list${idea.neutral?.length ? `; ${idea.neutral.length} of 3 inputs could not be measured and count as a neutral 50` : ""}">` +
    `<span class="score-value">${idea.score.toFixed(1)}</span><small>/100</small>${idea.neutral?.length ? `<small>· ${3 - idea.neutral.length}/3 measured</small>` : ""}</td>`
  );
}

function metricTd(symbol, key, kind) {
  const lead = LEAD[state.screen] === key;
  return `<td class="metric${lead ? " lead" : ""}">${metricCell(symbol, key, kind)}</td>`;
}

function rankedMap(key) {
  return new Map((state.desk.setups[key]?.results || []).map((row) => [row.symbol, row]));
}
// A Shortlist pillar ("part_growth") is the company's market-wide percentile
// stored on its Composite row; everything else is a company factor.
function factor(symbol, key) {
  if (key.startsWith("part_")) return rankedMap("composite").get(symbol)?.parts?.[key.slice(5)];
  return state.desk.companies[symbol]?.factors?.[key];
}
function neutralPart(symbol, key) {
  return key.startsWith("part_") && (rankedMap("composite").get(symbol)?.neutral || []).includes(key.slice(5));
}

// Week-over-week movement. The snapshot carries a comparison against the
// previous WEEK's freeze, not the previous run - a week that is re-run must not
// be compared with itself. It is null when no earlier week is published, and
// `comparable` is false when the method changed between the two weeks: names
// entering and leaving still mean something then, rank deltas do not.
function trajectoryFor(screen) {
  return state.desk.trajectory?.screens?.[screen] || null;
}
function movementLabel(screen, symbol) {
  const track = trajectoryFor(screen);
  if (!track) return "";
  const gone = track.exited.find((item) => item.symbol === symbol);
  if (gone) return `dropped this week, was rank ${gone.previous_rank}`;
  const row = track.rows[symbol];
  if (!row) return "";
  if (row.change === "entered") return "new on this list this week";
  if (!track.comparable || row.rank_change == null) return "";
  if (row.rank_change === 0) return "rank unchanged";
  return `${row.rank_change > 0 ? "up" : "down"} ${Math.abs(row.rank_change)} from rank ${row.previous_rank}`;
}
function movementChip(symbol) {
  const track = trajectoryFor(state.screen);
  const row = track?.rows?.[symbol];
  if (!row) return "";
  const since = day(state.desk.trajectory.previous_as_of);
  if (row.change === "entered") {
    return `<span class="move new" title="Not on this list on ${since}">New</span>`;
  }
  // Unchanged and not-comparable both draw nothing; the note below the table
  // says which of the two an absent marker means.
  if (!track.comparable || !row.rank_change) return "";
  const up = row.rank_change > 0;
  return `<span class="move ${up ? "up" : "down"}" title="Was rank ${row.previous_rank} on ${since}">${up ? "▲" : "▼"}${Math.abs(row.rank_change)}</span>`;
}
// Counts in the line; the dropped names fold away, since Hot tape can drop 45.
function renderTrajectory() {
  const element = $("trajectory-note");
  const track = trajectoryFor(state.screen);
  if (!track) {
    element.textContent = state.desk.trajectory
      ? "This list has no comparison in the previous published week."
      : "No earlier week is published yet, so nothing is compared.";
    return;
  }
  const since = day(state.desk.trajectory.previous_as_of);
  const rows = Object.values(track.rows);
  const entered = rows.filter((row) => row.change === "entered").length;
  const moved = rows.filter((row) => row.rank_change).length;
  const lead =
    `Since ${since}: ${entered} new, ${track.exited.length} dropped, ` +
    (track.comparable
      ? `${moved} changed rank. No marker means the rank did not move.`
      : "and the ranking method changed between the two weeks, so ranks are not compared.");
  const dropped = track.exited.map((row) => `${row.symbol} (was ${row.previous_rank})`).join(", ");
  element.innerHTML = escapeHtml(lead) + (dropped
    ? ` <details class="dropped"><summary>Dropped names</summary>${escapeHtml(dropped)}.</details>`
    : "");
}

function industryKey(company) {
  return company?.industry?.trim() || "__unclassified";
}

// Display abbreviations of the Nasdaq industry string. The filter value stays
// the official label; these names are not a new classification.
const INDUSTRY_FAMILY = {
  Biotechnology: "Bio",
  "Computer Software": "Software",
  RETAIL: "Retail",
  Retail: "Retail",
  Finance: "Finance",
  Services: "Services",
  "Electric Utilities": "Utilities",
};
const INDUSTRY_SHORT = {
  "Biological Products (No Diagnostic Substances)": "biologics",
  "Commercial Physical & Biological Resarch": "research",
  "Electromedical & Electrotherapeutic Apparatus": "electromedical",
  "In Vitro & In Vivo Diagnostic Substances": "diagnostics",
  "Laboratory Analytical Instruments": "lab instruments",
  "Pharmaceutical Preparations": "pharma",
  "Prepackaged Software": "prepackaged",
  "Programming Data Processing": "data processing",
  "Computer Software & Peripheral Equipment": "software & peripherals",
  "Building Materials": "building materials",
  "Consumer Services": "consumer",
  "O.E.M.": "OEM",
  "Central": "central",
  "Radio And Television Broadcasting And Communications Equipment": "Broadcast & comms equipment",
  "Mining & Quarrying of Nonmetallic Minerals (No Fuels)": "Nonmetallic minerals",
  "Water Sewer Pipeline Comm & Power Line Construction": "Pipeline & power-line construction",
  "General Bldg Contractors - Nonresidential Bldgs": "Nonresidential contractors",
  "Cable & Other Pay Television Services": "Cable TV",
  "Real Estate Investment Trusts": "REITs",
  "Investment Bankers/Brokers/Service": "Brokers",
  "Accident &Health Insurance": "Accident & health insurance",
  "Services-Misc. Amusement & Recreation": "Amusement & recreation",
  "Retail-Auto Dealers and Gas Stations": "Auto dealers & gas",
  "Retail-Drug Stores and Proprietary Stores": "Drug stores",
  "Professional and commerical equipment": "Professional equipment",
  "Misc Health and Biotechnology Services": "Health & biotech services",
  "Miscellaneous manufacturing industries": "Misc manufacturing",
  "Medicinal Chemicals and Botanical Products": "Medicinal chemicals",
  "Industrial Machinery/Components": "Industrial machinery",
  "Department/Specialty Retail Stores": "Specialty retail",
  "Property-Casualty Insurers": "P&C insurers",
  "Medical/Dental Instruments": "Medical instruments",
  "Medical/Nursing Services": "Nursing services",
  "Hospital/Nursing Management": "Hospitals",
  "Beverages (Production/Distribution)": "Beverages",
  "Air Freight/Delivery Services": "Air freight",
  "Trucking Freight/Courier Services": "Trucking",
  "Integrated Freight & Logistics": "Freight & logistics",
  "Catalog/Specialty Distribution": "Catalog distribution",
  "Clothing/Shoe/Accessory Stores": "Clothing stores",
  "Consumer Electronics/Appliances": "Consumer electronics",
  "Consumer Electronics/Video Chains": "Electronics stores",
  "Office Equipment/Supplies/Services": "Office equipment",
  "Recreational Games/Products/Toys": "Toys & games",
  "Military/Government/Technical": "Defense & government",
  "Oil and Gas Field Machinery": "Oilfield machinery",
  "Oilfield Services/Equipment": "Oilfield services",
  "Oil/Gas Transmission": "Oil & gas transmission",
  "Integrated oil Companies": "Integrated oil",
  "Natural Gas Distribution": "Gas distribution",
  "Computer Communications Equipment": "Network equipment",
  "Computer peripheral equipment": "Computer peripherals",
  "Telecommunications Equipment": "Telecom equipment",
  "Construction/Ag Equipment/Trucks": "Construction equipment",
  "Auto & Home Supply Stores": "Auto & home supply",
  "Package Goods/Cosmetics": "Cosmetics",
  "Meat/Poultry/Fish": "Meat & poultry",
  "Farming/Seeds/Milling": "Farming",
  "Diversified Commercial Services": "Commercial services",
  "Other Specialty Stores": "Specialty stores",
  "Other Pharmaceuticals": "Other pharma",
  "Misc Corporate Leasing Services": "Corporate leasing",
  "Rental/Leasing Companies": "Rental & leasing",
  "Finance/Investors Services": "Investor services",
  "Savings Institutions": "Savings banks",
  "Auto Parts:O.E.M.": "Auto parts: OEM",
  "Trusts Except Educational Religious and Charitable": "Investment trusts",
  "Managed Health Care": "Managed care",
  "Pharmaceuticals and Biotechnology": "Pharma & biotech",
  "Other Transportation": "Other transportation",
};

function tidyIndustry(name) {
  return String(name)
    .replaceAll("&Health", "& Health")
    .replaceAll(":O.E.M.", ": OEM")
    .replaceAll("RETAIL:", "Retail:")
    .replace(/\s+/g, " ")
    .trim();
}

function compactIndustry(name) {
  const raw = (name || "").trim();
  if (!raw || raw === "__unclassified") return "Industry unavailable";
  if (INDUSTRY_SHORT[raw]) return INDUSTRY_SHORT[raw];
  const tidied = tidyIndustry(raw);
  if (INDUSTRY_SHORT[tidied]) return INDUSTRY_SHORT[tidied];
  const colon = tidied.indexOf(":");
  if (colon > 0) {
    const family = tidied.slice(0, colon).trim();
    let rest = tidied.slice(colon + 1).trim();
    rest = INDUSTRY_SHORT[rest] || rest;
    const shortFamily = INDUSTRY_FAMILY[family] || family;
    if (rest.toLowerCase().startsWith(`${shortFamily.toLowerCase()} `)) {
      rest = rest.slice(shortFamily.length + 1);
    }
    return `${shortFamily}: ${rest}`;
  }
  return tidied;
}

// The SECTORS list, INDUSTRY_SECTOR map, and sectorFor / sectorLabel helpers
// live in share/sectors.js so Research and Analyst ratings share one
// taxonomy. That file is loaded before this one on every page that needs it.

// On the Shortlist a company's sector is the one its Composite row was capped
// by (reviewed corrections, e.g. a tanker company counted as energy); elsewhere
// it is the site taxonomy of its Nasdaq industry.
function rowSector(symbol) {
  const capped = state.screen === "composite" ? rankedMap("composite").get(symbol)?.sector : null;
  return capped || sectorFor(industryKey(state.desk.companies[symbol]));
}

function liquidCount() {
  return state.desk.universe_count || Object.keys(state.desk.companies || {}).length;
}

function matchedSymbol(query) {
  const token = (query ?? state.query).trim();
  if (!token || /\s/.test(token)) return null;
  const upper = token.toUpperCase();
  return Object.prototype.hasOwnProperty.call(state.desk.companies || {}, upper) ? upper : null;
}

function looksLikeTicker(query) {
  return /^[A-Za-z][A-Za-z0-9.]{0,5}$/.test((query ?? state.query).trim());
}

function searchNotice(visible) {
  const q = state.query.trim();
  if (!q) return "";
  const n = Number(liquidCount()).toLocaleString();
  const symbol = matchedSymbol(q);
  if (symbol) {
    if (rankedMap(state.screen).has(symbol)) return "";
    const elsewhere = SCREENS.filter(([key]) => key !== state.screen && rankedMap(key).has(symbol)).map(([, label]) => label);
    return `${symbol} is in the liquid universe, not on this list.${elsewhere.length ? ` It is on ${elsewhere.join(", ")}.` : ""} The Ticker page has everything on it.`;
  }
  if (visible.length) return "";
  if (looksLikeTicker(q)) {
    return `${q.toUpperCase()} is not among this week's ${n} liquid names.`;
  }
  return "No companies match. Reset filters to clear search, sector and the two boxes.";
}

function setSearchStatus(message) {
  const node = $("search-status");
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

// The list's own members; an exact ticker typed in search is shown even when
// it is not on the list, so the panel can say why.
function scopeRows() {
  const ranked = rankedMap(state.screen);
  const exact = matchedSymbol(state.query);
  if (exact) return [exact];
  const needle = state.query.trim().toLowerCase();
  return [...ranked.keys()].filter((symbol) => {
    if (!needle) return true;
    const company = state.desk.companies[symbol];
    const hay = `${symbol} ${company?.name ?? ""} ${company?.industry ?? ""} ${compactIndustry(company?.industry)} ${sectorLabel(rowSector(symbol))}`.toLowerCase();
    return hay.includes(needle);
  });
}

function rows() {
  const ranked = rankedMap(state.screen);
  return scopeRows()
    .filter((symbol) => !state.sector || rowSector(symbol) === state.sector)
    .filter(passesEvidence)
    .filter((symbol) => !state.hideLoss || state.desk.companies[symbol]?.profitable !== false)
    .sort((a, b) => {
      const dir = state.sortDir === "asc" ? 1 : -1;
      const value = (symbol) => sortValue(symbol, ranked);
      const va = value(a);
      const vb = value(b);
      if (va == null && vb == null) return a.localeCompare(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") return va.localeCompare(vb) * (state.sortKey === "company" ? dir : 1);
      if (va === vb) return a.localeCompare(b);
      return va > vb ? dir : -dir;
    });
}

function sortValue(symbol, ranked) {
  const key = state.sortKey;
  // Rank, not score, is the list order: the Shortlist's sector limit puts some
  // higher scores below rank ten.
  if (key === "rank") return ranked.has(symbol) ? -ranked.get(symbol).rank : null;
  if (key === "score") return ranked.get(symbol)?.score;
  if (key === "company") return symbol;
  if (key === "trend") return trendOf(symbol)?.up ?? null;
  if (key === "short") return shortOf(symbol)?.daysToCover ?? null;
  if (key === "results") {
    const next = upcomingResults(symbol);
    return next ? -Date.parse(`${next.date}T12:00:00Z`) : null;
  }
  return factor(symbol, key);
}

// The Shortlist's first ten carry the sector limit; the rest follow. Searching
// or filtering shows every match instead of cutting at ten.
function limitedToTop() {
  return state.screen === "composite" && !state.showAll && !state.query.trim() && !state.sector
    && state.sortKey === "rank" && state.sortDir === "desc";
}

function currentMetrics() {
  return COLUMNS[state.screen] || [];
}

function trustStatus(symbol) {
  const status = state.desk.companies[symbol]?.trust?.status;
  return ["complete", "review", "broken"].includes(status) ? status : "unknown";
}

function trustLabel(status) {
  return { complete: "No flagged issue", review: "Needs review", broken: "Broken statement", unknown: "Unknown" }[status];
}

// Hot tape is a price list: everyone stays, broken statements included.
function priceOnlyView() {
  return state.screen === "strength";
}

function passesEvidence(symbol) {
  return state.showBroken || priceOnlyView() || trustStatus(symbol) !== "broken";
}

// Why a metric is absent, when the snapshot records it. A property-casualty
// insurer files no gross-profit line, so it has no gross margin to be missing.
// A snapshot published before coverage existed carries none, and is read
// exactly as it was before.
function coverageFor(symbol, key) {
  return state.desk.companies[symbol]?.coverage?.[key] || null;
}
function notReported(symbol, key) {
  return coverageFor(symbol, key) === "not_reported";
}
function missingMetricTitle(symbol, key) {
  const reason = coverageFor(symbol, key);
  if (reason === "not_reported") {
    return "This company does not report the line this ratio is built from";
  }
  if (reason === "unavailable") {
    return "The trailing year for this ratio could not be built";
  }
  if (reason === "not_comparable") {
    return "This ratio was not published as comparable";
  }
  return "No number for this ratio in this snapshot";
}

function metricCell(symbol, key, kind) {
  if (neutralPart(symbol, key)) {
    if (key === "part_undervalued") {
      return `<span class="na" title="OI / EV cannot be computed for this company (no enterprise value in this snapshot, or a financial company). The Shortlist score counts it as a neutral 50; that is not a valuation.">valuation unavailable</span>`;
    }
    return `<span class="na" title="This number cannot be computed for this company; the Shortlist counts it as a neutral 50">none · 50</span>`;
  }
  if (Number.isFinite(factor(symbol, key))) return fmt(factor(symbol, key), kind);
  return `<span class="na" title="${missingMetricTitle(symbol, key)}">n/a</span>`;
}

function renderFilters() {
  $("show-broken").checked = state.showBroken;
  $("show-broken-label").hidden = priceOnlyView();
  $("hide-loss").checked = state.hideLoss;
}

// ---------- the three fact columns ----------
// Optional files. Each is shown only when it belongs to this release; a stale
// or missing file leaves a dash with the reason on hover, never an old value.
// The trend file belongs to this release and holds at least one stock; an
// empty file (no Timing series that week) is unavailable, not "too short".
function trendReady() {
  const file = state.trend;
  return Boolean(file && file.desk_run_id === state.desk.run_id && file.signal_date && Object.keys(file.rules || {}).length);
}

function trendOf(symbol) {
  const file = state.trend;
  if (!trendReady()) return null;
  const answers = file.rules?.[symbol];
  if (!Array.isArray(answers) || answers.length !== 3) return null;
  const known = answers.filter((value) => value === 0 || value === 1);
  return { answers, known: known.length, up: known.length === 3 ? known.filter((value) => value === 1).length : null };
}

function trendText(trend) {
  if (!trend || trend.known < 3) return "Too little history";
  if (trend.up === 3) return "Up · 3/3";
  if (trend.up === 0) return "Down · 0/3";
  return `Mixed · ${trend.up}/3`;
}

function trendDetail(trend) {
  return TREND_RULES.map(([, name], index) => {
    const value = trend?.answers?.[index];
    return `${value === 1 ? "✓" : value === 0 ? "✗" : "–"} ${name}`;
  }).join("; ");
}

function trendCell(symbol) {
  if (!trendReady()) {
    return `<td><span class="na" title="The trend file for this week is not available">—</span></td>`;
  }
  const trend = trendOf(symbol);
  const tone = !trend || trend.known < 3 ? "none" : trend.up === 3 ? "up" : trend.up === 0 ? "down" : "mixed";
  const title = trend ? `${trendDetail(trend)}. At the ${shortDay(state.trend.signal_date)} month-end close.` : "No price history for this stock in the trend file";
  return `<td><span class="trend ${tone}" title="${escapeHtml(title)}">${trendText(trend)}</span></td>`;
}

function shortOf(symbol) {
  const row = state.shorts?.rows?.[symbol];
  if (!row || !Number.isFinite(row[0])) return null;
  return { daysToCover: row[0], change: row[1], rank: row[2] };
}

function shortCell(symbol) {
  const short = shortOf(symbol);
  if (!short) return `<td class="metric quiet"><span class="na" title="No FINRA short-interest figure for this stock">—</span></td>`;
  const tag = short.rank === "heavily" ? `<span class="tag heavy" title="Top 10% of eligible stocks of similar size">Heavy</span>`
    : short.rank === "lightly" ? `<span class="tag light" title="Bottom 10% of eligible stocks of similar size">Light</span>` : "";
  return `<td class="metric quiet">${short.daysToCover.toFixed(1)}${tag}</td>`;
}

function upcomingResults(symbol) {
  const next = state.earnings?.companies?.[symbol];
  return next?.date && next.date >= todayIso() ? next : null;
}

function resultsCell(symbol) {
  const calendar = state.earnings;
  if (!calendar) return `<td><span class="na" title="The results calendar is not available">—</span></td>`;
  const next = calendar.companies?.[symbol];
  if (next?.date && next.date >= todayIso()) {
    return `<td class="results" title="Yahoo date; company confirmation is not recorded in this calendar"><span class="when">${next.unsure ? "~" : ""}${escapeHtml(weekday(next.date))}</span><small>${escapeHtml(next.timing || "")}${next.unsure ? " · tentative: sources disagree" : ""}</small><small>Company confirmation unverified</small></td>`;
  }
  if (next?.date) {
    return `<td class="results past">Scheduled ${escapeHtml(weekday(next.date))}<small>Date passed; release not checked</small></td>`;
  }
  const to = calendar.window?.to;
  return `<td class="results past" title="The calendar looks about four weeks ahead; a date beyond it is not shown yet">${to ? `None to ${escapeHtml(shortDay(to))}` : "—"}</td>`;
}

// ---------- company panel ----------
// The Research quick view: why the company is on this list, what to check
// before acting, and six fixed numbers beside the sector median. The rows the
// table already shows are not repeated; the data dates sit at the bottom,
// folded, and the full record lives on the Ticker page. Facts, not calls.
const PANEL_METRICS = [
  ["revenue_yoy", "Revenue, year on year", "change"],
  ["net_margin", "Net margin", "level"],
  ["roe", "Return on equity", "level"],
  ["cash_conversion", "Cash / profit", "multiple"],
  ["pe", "Price / earnings", "times"],
  ["momentum_252", "Return, 12 months", "change"],
];

function oneDecimal(value, kind) {
  if (!Number.isFinite(value)) return "—";
  if (kind === "multiple") return `${value.toFixed(2)}×`;
  if (kind === "times") return `${value.toFixed(1)}×`;
  const sign = kind === "change" && value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

// Market cap / trailing net income, only when income is positive: the Ticker
// page's formula, and the one the weekly build uses for the sector median.
function peOf(symbol) {
  const company = state.desk.companies[symbol];
  const income = company?.factors?.ttm_net_income;
  const cap = company?.market_cap;
  return Number.isFinite(income) && Number.isFinite(cap) && income > 0 && cap > 0 ? cap / income : null;
}

function panelValue(symbol, key) {
  return key === "pe" ? peOf(symbol) : factor(symbol, key);
}

function panelMissing(symbol, key) {
  if (key === "pe") {
    const income = state.desk.companies[symbol]?.factors?.ttm_net_income;
    return Number.isFinite(income) && income <= 0 ? "Net loss" : "Unavailable";
  }
  return notReported(symbol, key) ? "Not reported by this filer" : "Unavailable";
}

function sectorOf(symbol) {
  return sectorFor(industryKey(state.desk.companies[symbol]));
}

// Stored per sector by the weekly build (desk.json sector_medians); null when
// the snapshot predates it, the sector is unclassified, or too few companies
// have the number.
function sectorMedian(symbol, key) {
  return state.desk.sector_medians?.sectors?.[sectorOf(symbol)]?.[key]?.median ?? null;
}

function withMedian(symbol, key, format) {
  const median = sectorMedian(symbol, key);
  return Number.isFinite(median) ? `; the ${sectorLabel(sectorOf(symbol))} median is ${format(median)}` : "";
}

function screenName(key) {
  return SCREENS.find(([id]) => id === key)?.[1] ?? key;
}

// One sentence with the company's own inputs to the score, from the method
// each list states in desk.json. Missing inputs are left out, not invented.
function scoreInputs(screen, symbol) {
  const f = state.desk.companies[symbol]?.factors || {};
  const has = (key) => Number.isFinite(f[key]);
  if (screen === "composite") {
    const row = rankedMap("composite").get(symbol);
    if (!row?.parts) return "Score is the average of three market-wide percentiles.";
    const part = (key, label) => `${label} ${(row.neutral || []).includes(key) ? "none, counted as 50" : row.parts[key].toFixed(1)}`;
    const held = row.held_back ? " Held back from the first ten by the 3-per-sector limit." : "";
    return `Score is the average of three market-wide percentiles: ${part("strength", "price strength")}, ${part("growth", "profitability (five measures)")}, ${part("undervalued", "OI / EV")}.${held}`;
  }
  if (screen === "growth") {
    const parts = [has("revenue_yoy") ? `revenue ${oneDecimal(f.revenue_yoy, "change")} year on year` : "",
      has("relative_strength_6m") ? `6 months vs QQQ ${oneDecimal(f.relative_strength_6m, "change")}` : ""].filter(Boolean);
    const now = parts.length ? ` Now ${parts.join(", ")}.` : "";
    const row = rankedMap("growth").get(symbol);
    if (!row?.parts) {
      return `Ranked by return on equity${has("roe") ? ` (${oneDecimal(f.roe, "level")})` : ""}; revenue growth is an entry gate, not the score.${now}`;
    }
    const pieces = PROFITABILITY_PARTS.map(([key, label]) => `${label} ${Number.isFinite(row.parts[key]) ? row.parts[key].toFixed(1) : "none"}`);
    return `Score ranks profitability inside Growth: the average of five percentiles, ${pieces.join(", ")}. Revenue growth is an entry gate, not the score.${now}`;
  }
  if (screen === "strength") {
    const now = [has("momentum_63") ? `63 sessions ${oneDecimal(f.momentum_63, "change")}` : "",
      has("momentum_252") ? `252 sessions ${oneDecimal(f.momentum_252, "change")}` : ""].filter(Boolean);
    return `Score is 60% the 63-session and 40% the 252-session return.${now.length ? ` Now ${now.join(", ")}.` : ""} Recent price, not a forecast.`;
  }
  if (screen === "undervalued") {
    return `Ranked by operating income / EV${has("operating_earnings_yield_ev") ? ` (${oneDecimal(f.operating_earnings_yield_ev, "level")})` : ""}${has("operating_earnings_yield") ? `; on equity market cap it is ${oneDecimal(f.operating_earnings_yield, "level")}` : ""}. Cheap is not a quality grade.`;
  }
  return "";
}

function whyHere(symbol) {
  const key = state.screen;
  const row = rankedMap(key).get(symbol);
  const moved = movementLabel(key, symbol);
  const excluded = state.desk.setups[key]?.exclusions?.find((entry) => entry.symbol === symbol);
  const count = state.desk.setups[key]?.results?.length || 0;
  let lead;
  if (row) {
    lead = `Rank ${row.rank} of ${count}, score ${row.score.toFixed(1)}${moved ? ` · ${escapeHtml(moved)}` : ""}.`;
  } else {
    const reasons = [moved ? `${moved[0].toUpperCase()}${moved.slice(1)}.` : "",
      excluded ? `${excluded.reasons.join("; ")}.` : ""].filter(Boolean);
    lead = `<span class="qv-out">${reasons.length ? escapeHtml(reasons.join(" ")) : "A missing input, failed gate, or shortlist cutoff may apply."}</span>`;
  }
  const others = SCREENS.filter(([other]) => other !== key && state.desk.setups[other]).map(([other, label]) => {
    const ranked = rankedMap(other).get(symbol);
    const change = movementLabel(other, symbol);
    if (ranked) return `${label} (rank ${ranked.rank}${change ? `, ${change}` : ""})`;
    return change ? `${label} (${change})` : "";
  }).filter(Boolean);
  return `<h3>${row ? "Why it's on" : "Not on"} ${key === "composite" ? "the " : ""}${escapeHtml(screenName(key))}</h3>
    <p class="qv-lead">${lead} ${escapeHtml(scoreInputs(key, symbol))}</p>
    <p>${others.length ? `Other lists: ${escapeHtml(others.join(" · "))}.` : "Not on any other list."}</p>`;
}

// "Thu 5 Nov", as on the Market mood earnings panel.
function weekday(iso) {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const part = (options) => date.toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
  return `${part({ weekday: "short" })} ${part({ day: "numeric", month: "short" })}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Next results date from share/earnings-calendar.json (refreshed Tue/Fri). A
// planning fact, not a signal: Leg D found no price drift after results.
function earningsLine(symbol) {
  const calendar = state.earnings;
  if (!calendar) return "";
  const next = calendar.companies?.[symbol];
  const timing = next?.timing ? `, ${next.timing}` : "";
  if (!next?.date) {
    return calendar.window?.to ? `No results date in the calendar to ${day(calendar.window.to)}.` : "";
  }
  const today = todayIso();
  const unsure = next.unsure ? " (the date may still move)" : "";
  if (next.date >= today) {
    const days = Math.round((Date.parse(`${next.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    return `Results ${next.unsure ? "~" : ""}${weekday(next.date)}${timing} · ${when}${unsure}. Yahoo date; company confirmation is not recorded${next.unsure ? "; Yahoo sources disagree" : ""}.`;
  }
  const filed = state.desk.companies[symbol]?.revenue_filed;
  return filed && next.date > filed
    ? `Results came out ${weekday(next.date)}${timing}; the figures here are from the ${day(filed)} filing.`
    : "";
}

// FINRA short interest from share/short-interest.json (written with Insights,
// Tue/Fri). Days to cover is the one ownership fact our Leg D test backed.
function shortLine(symbol) {
  const shorts = state.shorts;
  const row = shorts?.rows?.[symbol];
  if (!row) return "";
  const [daysToCover, change, rank] = row;
  if (!Number.isFinite(daysToCover)) return "";
  const when = shorts.date ? `FINRA, ${day(shorts.date)}` : "FINRA";
  const moved = Number.isFinite(change) ? `, ${change >= 0 ? "+" : ""}${change.toFixed(1)}% since the report before` : "";
  const facts = `${daysToCover.toFixed(1)} days to cover (${when}${moved})`;
  if (rank === "heavily") return `Heavily shorted: ${facts}, top 10% of eligible stocks of similar size.`;
  if (rank === "lightly") return `Lightly shorted: ${facts}, bottom 10% of eligible stocks of similar size.`;
  return `Short interest ${facts}; not in the top or bottom 10% of eligible stocks of similar size.`;
}

function trendLine(symbol) {
  const trend = trendOf(symbol);
  if (!trend) return "";
  return `Trend ${trendText(trend)} at the ${shortDay(state.trend.signal_date)} month-end close: ${trendDetail(trend)}.`;
}

function checkFirst(symbol) {
  const status = trustStatus(symbol);
  const reasons = state.desk.companies[symbol]?.trust?.reasons || [];
  const items = [];
  if (status !== "complete") {
    items.push(`<li class="qv-warn"><strong>${trustLabel(status)}</strong>${reasons.length ? `: ${reasons.map(escapeHtml).join("; ")}` : ""}</li>`);
  }
  const results = earningsLine(symbol);
  if (results) items.push(`<li>${escapeHtml(results)}</li>`);
  const trend = trendLine(symbol);
  if (trend) {
    items.push(`<li title="In our Leg D test (2021–26), stocks with each rule up beat those with it down by about 3–3.6% over six months.">${escapeHtml(trend)}</li>`);
  }
  const notes = standoutNotes(symbol);
  for (const note of notes) items.push(`<li class="qv-steer">${escapeHtml(note)}</li>`);
  const short = shortLine(symbol);
  if (short) {
    items.push(`<li title="In our Leg D test (2022–26), heavily shorted stocks trailed stocks of similar size over six months and lightly shorted ones led them.">${escapeHtml(short)}</li>`);
  }
  if (!items.length) return "";
  return `<h3>Check first</h3><ul class="qv-checks">${items.join("")}</ul>${notes.length
    ? "<p class=\"qv-note\">The steers are prompts to look further, not conclusions; they change nothing about the rank or score.</p>" : ""}`;
}

function metricsTable(symbol) {
  const sector = sectorOf(symbol);
  const medians = Boolean(state.desk.sector_medians);
  const head = medians ? `<th scope="col">${escapeHtml(sector === "unclassified" ? "Sector" : sectorLabel(sector))} median</th>` : "";
  const body = PANEL_METRICS.map(([key, label, kind]) => {
    const value = panelValue(symbol, key);
    const median = sectorMedian(symbol, key);
    const cell = Number.isFinite(value) ? oneDecimal(value, kind) : `<span class="na">${panelMissing(symbol, key)}</span>`;
    return `<tr><th scope="row">${label}</th><td>${cell}</td>${medians ? `<td class="qv-median">${Number.isFinite(median) ? oneDecimal(median, kind) : "—"}</td>` : ""}</tr>`;
  }).join("");
  const note = medians
    ? `<p class="qv-note">The same six numbers on every list. Medians are of this week's companies in the same sector; accounting ratios leave out statements that do not add up.${sector === "unclassified" ? " This industry has no sector, so no median." : ""}</p>`
    : "";
  return `<h3>The business vs its sector</h3>
    <table class="qv-metrics"><thead><tr><td></td><th scope="col">${escapeHtml(symbol)}</th>${head}</tr></thead><tbody>${body}</tbody></table>${note}`;
}

function analystLine(symbol) {
  const f = state.desk.companies[symbol]?.factors || {};
  if (!Number.isFinite(f.analyst_total)) return "";
  const parts = [Number.isFinite(f.strong_buy_count) ? `${f.strong_buy_count} of ${f.analyst_total} ratings strong buy` : `${f.analyst_total} ratings`];
  if (Number.isFinite(f.up_last_30_days) || Number.isFinite(f.down_last_30_days)) {
    parts.push(`EPS estimates in 30 days ${f.up_last_30_days ?? 0} up, ${f.down_last_30_days ?? 0} down`);
  }
  const conviction = rankedMap("conviction").get(symbol);
  return `Analysts: ${parts.join("; ")}.${conviction ? ` Analyst conviction rank ${conviction.rank} (Analyst ratings page).` : ""}`;
}

function dataDates(symbol, company) {
  const dates = [
    ["Price date", company.price_date],
    ["Revenue fiscal period end", company.revenue_period_end],
    ["Revenue filing date", company.revenue_filed],
    ["Quality filing date", company.quality_filed],
    ["Analyst observations collected", company.analyst?.retrieved_at],
  ];
  const profitable = company.profitable;
  const earns =
    profitable === false
      ? " Trailing twelve-month net income is negative; that is a fact about the business, not a problem with the evidence."
      : profitable === true
        ? " Trailing twelve-month net income is positive."
        : "";
  return `<details class="qv-dates"><summary>Data dates and limits</summary>
    <p><strong>${trustLabel(trustStatus(symbol))}</strong>. This statement status does not certify coverage, freshness, or valuation.${earns}</p>
    <dl>${dates.map(([label, value]) => `<dt>${label}</dt><dd>${value ? escapeHtml(day(value)) : "Not recorded in this snapshot"}</dd>`).join("")}</dl>
    <p>Filing dates are calendar dates, not exact publication timestamps. The quality filing date is not a separate fiscal period or filing date for every ratio component. Original accessions and share-count reconciliation are not included in this public snapshot.</p>
    ${company.analyst ? "<p>Analyst counts are dated by collection, which can be after the price date. EPS revisions cover the current fiscal year (Yahoo 0y). They are not individual report dates.</p>" : ""}
    ${state.desk.sector_medians?.basis ? `<p>Sector medians: ${escapeHtml(state.desk.sector_medians.basis)}</p>` : ""}
  </details>`;
}

function panelHeader(symbol, company) {
  const sector = sectorOf(symbol);
  const where = [company.industry, sector !== "unclassified" ? sectorLabel(sector) : ""].filter(Boolean).join(" · ");
  const quote = [Number.isFinite(company.price) ? `${price(company.price)}${company.price_date ? ` on ${day(company.price_date)}` : ""}` : "",
    Number.isFinite(company.market_cap) ? `market cap ${money(company.market_cap)}` : ""].filter(Boolean).join(" · ");
  const status = trustStatus(symbol);
  const income = company.factors?.ttm_net_income;
  const earns = company.profitable === false
    ? `<span class="qv-chip loss" title="A fact about the business, not a problem with the evidence">Loss-making${Number.isFinite(income) ? ` · TTM ${money(income)}` : ""}</span>`
    : company.profitable === true
      ? `<span class="qv-chip">Profitable${Number.isFinite(income) ? ` · TTM ${money(income)}` : ""}</span>`
      : "";
  return `<p class="qv-sub">${escapeHtml([where, quote].filter(Boolean).join(" · "))}</p>
    <div class="qv-actions">
      <span class="qv-chip trust-${status}" title="Statement status. It does not certify coverage, freshness, or valuation.">${trustLabel(status)}</span>${earns}
      <span class="qv-spacer"></span>${starHtml(symbol, company.name)}
      <a class="qv-ticker" href="./ticker.html?t=${encodeURIComponent(symbol)}">Full ticker page →</a>
    </div>`;
}

function panelPosition() {
  const list = state.panelRows || [];
  const at = list.indexOf(state.panelSymbol);
  const prev = $("evidence-prev");
  const next = $("evidence-next");
  const label = $("evidence-position");
  if (at < 0) {
    prev.hidden = true; next.hidden = true; label.textContent = "";
    return;
  }
  prev.hidden = false; next.hidden = false;
  prev.disabled = at === 0;
  next.disabled = at === list.length - 1;
  label.textContent = `${(at + 1).toLocaleString()} of ${list.length.toLocaleString()}`;
}

// Opening from the table remembers its current order, so ‹ › walk the same
// filtered, sorted list across pages without closing the panel.
function openCompany(symbol) {
  state.panelRows = shownRows();
  showEvidence(symbol);
}

function stepCompany(delta) {
  const list = state.panelRows || [];
  const at = list.indexOf(state.panelSymbol);
  const target = at < 0 ? null : list[at + delta];
  if (target) showEvidence(target);
}

function showEvidence(symbol) {
  const company = state.desk.companies[symbol];
  if (!company) return;
  state.panelSymbol = symbol;
  $("evidence-title").textContent = `${symbol} · ${company.name || symbol}`;
  const fscore = fscoreLine(symbol);
  const analysts = analystLine(symbol);
  const early = company.potential ? `<p class="qv-more">An early-stage research file for this company is on the <a href="./ticker.html?t=${encodeURIComponent(symbol)}">ticker page</a>.</p>` : "";
  $("evidence-content").innerHTML = `${panelHeader(symbol, company)}
    ${yearPlotHtml(symbol)}
    ${whyHere(symbol)}
    ${checkFirst(symbol)}
    ${metricsTable(symbol)}
    ${fscore || analysts ? `<p class="qv-more">${[fscore, analysts].filter(Boolean).map(escapeHtml).join("<br>")}</p>` : ""}
    <p class="qv-more">Insiders, 13F funds, the price chart and analyst targets are on the <a href="./ticker.html?t=${encodeURIComponent(symbol)}">full ticker page</a>.</p>
    ${early}
    ${dataDates(symbol, company)}`;
  panelPosition();
  const dialog = $("company-evidence");
  dialog.scrollTop = 0;
  if (!dialog.open) dialog.showModal();
  if (!state.volume && state.volumeState !== "loading" && state.volumeState !== "missing") loadYearChart();
}

// The one-year plot in the brief report. Same saved closes as the Ticker page
// (QQQ's last 253 sessions, adjusted). An image only: the dollar closes and
// both returns are on the full ticker page.
const YEAR_SESSIONS = 253;
function yearLine(volume, symbol) {
  const chart = volume && volume.chart;
  const days = chart && chart.days;
  const stock = volume && volume.closes && volume.closes[symbol];
  const qqq = chart && chart.qqq;
  if (!Array.isArray(days) || days.length !== YEAR_SESSIONS) return null;
  if (!Array.isArray(stock) || stock.length !== days.length) return null;
  if (!Array.isArray(qqq) || qqq.length !== days.length) return null;
  if (volume.as_of && state.desk?.as_of && volume.as_of !== state.desk.as_of) return null;
  const ok = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) > 0;
  const first = stock.findIndex(ok);
  const last = stock.length - 1 - [...stock].reverse().findIndex(ok);
  if (first < 0 || last <= first || !ok(qqq[first]) || !ok(qqq[last])) return null;
  return {
    days, stock, qqq, first, last,
    firstDay: days[first], lastDay: days[last],
    asOf: volume.as_of || days[days.length - 1],
  };
}
function yearPlotSvg(line, symbol) {
  const W = 640, H = 168, L = 8, R = 8, T = 10, B = 22;
  const rebase = (series) => series.map((v, i) => (
    i >= line.first && Number(v) > 0 && Number(series[line.first]) > 0 ? Number(v) / Number(series[line.first]) - 1 : null
  ));
  const stock = rebase(line.stock);
  const qqq = rebase(line.qqq);
  const known = [...stock, ...qqq].filter((v) => v !== null);
  const lo = Math.min(0, ...known);
  const hi = Math.max(0, ...known);
  const x = (i) => L + (i / (line.days.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const path = (vals) => {
    let d = "";
    vals.forEach((v, i) => {
      if (v !== null) d += `${d && vals[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  };
  const y0 = y(0).toFixed(1);
  return `<svg class="qv-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(symbol)} and QQQ, one-year adjusted closes, ${escapeHtml(day(line.firstDay))} to ${escapeHtml(day(line.lastDay))}. Both returns are on the full ticker page.">
    <line x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}" class="qv-plot-zero"/>
    <path d="${path(qqq)}" class="qv-plot-qqq"/>
    <path d="${path(stock)}" class="qv-plot-stock"/>
    <text x="${L}" y="${H - 6}" class="qv-plot-tick">${escapeHtml(shortDay(line.days[0]))}</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end" class="qv-plot-tick">${escapeHtml(shortDay(line.lastDay))}</text>
  </svg>`;
}
function yearPlotHtml(symbol) {
  if (state.volumeState === "missing") return "";
  if (!state.volume) return `<section class="qv-plot-box" aria-busy="true"><h3>One year vs QQQ</h3><p class="qv-note">Loading the one-year plot.</p></section>`;
  const line = yearLine(state.volume, symbol);
  if (!line) return `<section class="qv-plot-box"><h3>One year vs QQQ</h3><p class="qv-note">No one-year price line for ${escapeHtml(symbol)} in this week's snapshot. The ticker page says why.</p></section>`;
  return `<section class="qv-plot-box">
    <h3>One year vs QQQ</h3>
    <p class="qv-note">${escapeHtml(day(line.firstDay))} – ${escapeHtml(day(line.lastDay))}, adjusted closes, each line from its own first close. The plot is the shape; both returns, in dollars and percent, are on the full ticker page.</p>
    ${yearPlotSvg(line, symbol)}
    <p class="qv-legend"><span><i class="qv-sw stock"></i>${escapeHtml(symbol)}</span><span><i class="qv-sw qqq"></i>QQQ</span></p>
  </section>`;
}
async function loadYearChart() {
  if (state.volumeState === "loading" || state.volumeState === "missing" || state.volume) return;
  state.volumeState = "loading";
  const opened = state.panelSymbol;
  try {
    const response = await fetch("./ticker-volume.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.schema !== "ticker-volume-2" || !data.chart || !Array.isArray(data.chart.days)) throw new Error("unexpected chart file");
    if (state.desk?.as_of && data.as_of !== state.desk.as_of) throw new Error("chart is for another week");
    state.volume = data;
    state.volumeState = "ready";
  } catch (error) {
    console.warn("Temper Lab one-year chart is unavailable:", error);
    state.volume = null;
    state.volumeState = "missing";
  }
  if ($("company-evidence")?.open && state.panelSymbol === opened) showEvidence(state.panelSymbol);
}

// One line about a number already on the page, when that number is unusual
// enough to be worth a second look, with its sector median beside it. Nothing
// here is new data.
function standoutNotes(symbol) {
  const company = state.desk.companies[symbol];
  const factors = company?.factors ?? {};
  const notes = [];
  if (Number.isFinite(factors.leverage) && factors.leverage > LEVERAGE_STEER) {
    notes.push(
      `Liabilities are ${(factors.leverage * 100).toFixed(0)}% of assets${withMedian(symbol, "leverage", (m) => `${(m * 100).toFixed(0)}%`)}. What is normal varies widely by industry — banks, insurers and property trusts sit this high by construction — so compare it with similar companies rather than reading it as risk on its own.`,
    );
  }
  // Cash conversion is operating cash flow over net income, so it does not
  // exist at all when the company did not earn anything. A loss is a fact
  // about the business, never a reason to doubt the accounts.
  if (
    company?.profitable !== false &&
    Number.isFinite(factors.cash_conversion) &&
    factors.cash_conversion < CASH_CONVERSION_STEER
  ) {
    notes.push(
      `Operating cash flow is ${factors.cash_conversion.toFixed(2)}× net income${withMedian(symbol, "cash_conversion", (m) => `${m.toFixed(2)}×`)}, so less cash arrived than the profit line implies. One quarter of working capital or a one-off charge can do this; what matters is whether it persists.`,
    );
  }
  return notes;
}

// Optional files for the table's fact columns and the panel. The page works
// without them; the table and an open panel are redrawn when they arrive.
async function loadExtras() {
  const load = async (file, check) => {
    try {
      const response = await fetch(`./${file}`, { cache: "no-store" });
      if (!response.ok) return null;
      const data = await response.json();
      return check(data) ? data : null;
    } catch (error) {
      console.warn(`Temper Lab ${file} is unavailable:`, error);
      return null;
    }
  };
  const [earnings, shorts, trend] = await Promise.all([
    load("earnings-calendar.json", (data) => data.schema === "earnings-calendar-1"),
    load("short-interest.json", (data) => data.schema === "short-interest-1"),
    load("trend-rules.json", (data) => data.schema === "trend-rules-2"),
  ]);
  state.earnings = earnings;
  state.shorts = shorts;
  state.trend = trend;
  render();
  if ($("company-evidence").open && state.panelSymbol) showEvidence(state.panelSymbol);
}

// Piotroski F-Score in one line of the company panel; the nine checks are on
// the Ticker page. Context, not a signal: Leg D 2021-26 found no reliable
// return edge, so it is not a table column.
function fscoreLine(symbol) {
  if (!state.fscore) return "";
  const f = fscoreOf(symbol);
  if (!f) return "F-Score: no 10-K for a fiscal year ending in the last 15 months in this snapshot.";
  if (!f.scored) return `F-Score: Not scored: only ${f.computed} of 9 checks can be computed (needs 7).`;
  const missing = f.computed < 9 ? `; ${9 - f.computed} not available, counted as not passed` : "";
  return `F-Score ${f.passed}/9${f.computed < 9 ? "*" : ""}: ${f.passed} of 9 financial-health checks passed (Piotroski), 10-K for the year to ${day(f.fy_end)}${missing}. Context, not a signal; the nine checks are on the ticker page.`;
}
function fscoreOf(symbol) {
  return state.fscore?.companies?.[symbol] || null;
}

function renderScreenGates() {
  // A list's entry gates are a fact about the list, so they are stated once
  // here rather than repeated on every row. Labels come from desk.json's
  // setups.<screen>.gates, generated from the real gate definitions in
  // build_lake_ideas.py, never hardcoded here - hardcoded English drifted
  // from the actual gates once before. The Shortlist's rule is its membership.
  const element = $("screen-gates");
  const labels = state.screen === "composite"
    ? ["On 2+ of Growth, Cheap, Hot tape", "Positive equity", "Top 10: at most 3 per sector"]
    : state.desk.setups?.[state.screen]?.gates || [];
  if (!labels.length) {
    element.innerHTML = "";
    element.textContent = "No entry gates: every eligible company is scored.";
    return;
  }
  element.innerHTML =
    `<span class="gates-label">${state.screen === "composite" ? "Rule" : "Entry gates"}</span>` +
    labels.map((label) => `<span class="chip">${escapeHtml(label)}</span>`).join("");
}

function alsoOn(symbol) {
  if (state.screen === "composite") {
    const lists = rankedMap("composite").get(symbol)?.lists || [];
    return SCREENS.filter(([key]) => lists.includes(key)).map(([, label]) => label);
  }
  return SCREENS.filter(([key]) => key !== state.screen && rankedMap(key).has(symbol)).map(([, label]) => label);
}

function sortHeader(key, label, title = "") {
  const sorted = state.sortKey === key ? " sorted" : "";
  const direction = state.sortDir === "asc" ? "ascending" : "descending";
  return `<th scope="col" class="${sorted}"${sorted ? ` aria-sort="${direction}"` : ""}${title ? ` title="${escapeHtml(title)}"` : ""}><button type="button" data-sort="${key}">${label}${sorted ? ` <span aria-hidden="true">${state.sortDir === "asc" ? "↑" : "↓"}</span>` : ""}</button></th>`;
}

function renderHead() {
  let html = `<tr><th class="rank" title="Rank on this list. Sorting a column reorders the rows; this number stays the list rank.">#</th>${sortHeader("company", "Company")}<th scope="col" class="industry-column"><label for="sector">Sector</label><select id="sector" aria-label="Filter by sector" title="Eleven market sectors, the same buckets as GICS. Rows still show the Nasdaq industry. Rank is unchanged."></select></th>`;
  for (const [key, label] of currentMetrics()) {
    const [main, sub] = label.split(" · ");
    html += sortHeader(key, sub ? `${main} <small>${sub}</small>` : main);
  }
  if (SCORED.has(state.screen)) html += sortHeader("score", "Score");
  html += `<th scope="col">${state.screen === "composite" ? "On lists" : "Also on"}</th>`;
  const shortsDate = state.shorts?.date ? `FINRA, ${shortDay(state.shorts.date)}` : "FINRA";
  const trendDate = trendReady() ? `<small>month-end</small><small>${escapeHtml(shortDay(state.trend.signal_date))}</small>` : "";
  html += sortHeader("trend", `Trend ${trendDate}`, "Three rules that passed our test: price above its 200-day average, 12-month return skipping the last month above zero, 50-day average above the 200-day. Shown at the last month-end close, the signal that passed; a change between month-ends did not predict returns.");
  html += sortHeader("short", `Shorted <small>days to cover</small><small>${escapeHtml(shortsDate)}</small>`, "Days to cover from FINRA short interest. Heavy and Light mark the top and bottom 10% of eligible stocks of similar size, the split our test backed.");
  html += sortHeader("results", "Next results");
  html += `</tr>`;
  $("head").innerHTML = html;
  renderIndustries();
}

// Whether the company earns money is a fact about the business, not a doubt
// about its accounts, so it gets its own chip rather than a trust status.
// Absent in snapshots published before 2026-09-11, where it reads undefined
// and no chip is drawn.
function lossmakingChip(symbol) {
  return state.desk.companies[symbol]?.profitable === false
    ? `<span class="flag loss" title="Negative trailing twelve-month net income">Lossmaking</span>`
    : "";
}

// Watchlist star (watchlist.js); empty if that script is missing.
const starHtml = (symbol, name) => (globalThis.TLWatch ? globalThis.TLWatch.html(symbol, name) : "");

function companyCell(symbol) {
  const company = state.desk.companies[symbol];
  const status = trustStatus(symbol);
  const chip =
    (status !== "complete"
      ? `<span class="trust ${status}">${trustLabel(status)}</span>`
      : "") + lossmakingChip(symbol);
  return `<td><div class="tl-with-star">${starHtml(symbol, company?.name)}<button type="button" class="company-button" data-company="${escapeHtml(symbol)}" aria-label="Inspect evidence for ${escapeHtml(symbol)}"><span class="ticker">${escapeHtml(symbol)}${chip}</span><span class="name">${escapeHtml(company?.name ?? symbol)}</span></button></div></td>`;
}

function industryCell(symbol) {
  const industry = state.desk.companies[symbol]?.industry?.trim() || "";
  const label = compactIndustry(industry);
  const sector = sectorLabel(rowSector(symbol));
  const title = industry ? `${sector} · ${industry}` : sector;
  return `<td class="industry-column"><span class="industry" title="${escapeHtml(title)}">${escapeHtml(label)}</span></td>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function columnCount() {
  return 3 + currentMetrics().length + (SCORED.has(state.screen) ? 1 : 0) + 4;
}

function renderBody(pageRows) {
  const ranked = rankedMap(state.screen);
  const metrics = currentMetrics();
  if (!pageRows.length) {
    const message = searchNotice([]) || "No companies match. Reset filters to clear search, sector and the two boxes.";
    $("body").innerHTML = `<tr><td class="empty" colspan="${columnCount()}">${escapeHtml(message)}</td></tr>`;
    return;
  }
  $("body").innerHTML = pageRows
    .map((symbol) => {
      const idea = ranked.get(symbol);
      let cells = `<td class="rank">${idea?.rank ?? "—"}${movementChip(symbol)}</td>${companyCell(symbol)}${industryCell(symbol)}`;
      for (const [key, , kind] of metrics) cells += metricTd(symbol, key, kind);
      if (SCORED.has(state.screen)) cells += scoreCell(idea);
      cells += `<td><span class="chips">${alsoOn(symbol).map((label) => `<span class="chip also">${label}</span>`).join("")}</span></td>`;
      cells += trendCell(symbol) + shortCell(symbol) + resultsCell(symbol);
      return `<tr>${cells}</tr>`;
    })
    .join("");
}

// Names the 3-per-sector limit kept out of the first ten, with their score.
function heldBackNote() {
  const element = $("held-note");
  if (state.screen !== "composite") {
    element.hidden = true;
    return;
  }
  const held = (state.desk.setups.composite?.results || []).filter((row) => row.held_back);
  const total = state.desk.setups.composite?.results?.length || 0;
  const toggle = limitedToTop() || state.showAll
    ? ` <button type="button" id="show-all" class="link-button">${state.showAll ? "Show the first ten" : `Show all ${total}`}</button>`
    : "";
  element.hidden = false;
  element.innerHTML = held.length
    ? `Held back by the 3-per-sector limit: ${held.map((row) => `<strong>${escapeHtml(row.symbol)}</strong> ${row.score.toFixed(1)}`).join(" · ")}. They follow from rank ${SHORTLIST_TOP + 1}.${toggle}`
    : `No company was held back by the sector limit this week.${toggle}`;
}

function shownRows() {
  const all = rows();
  return limitedToTop() ? all.slice(0, SHORTLIST_TOP) : all;
}

function listNote() {
  if (state.screen === "composite") {
    return "Forward test: each week's top 10 is recorded and checked against QQQ after 6 and 12 months.";
  }
  if (state.screen === "growth") return "Score ranks profitability: five measures, each a percentile inside the list, averaged. Six months vs QQQ is the tape, not the rank.";
  if (state.screen === "undervalued") return "Rank is operating income divided by EV. OI / equity cap is shown so leverage is visible; it is not the rank.";
  return "Recent price, not a forecast. Loss-making leaders are expected; broken statements stay on a price list.";
}

function render() {
  const setup = state.desk.setups[state.screen];
  $("method-copy").textContent = setup.method || "Method not recorded in this snapshot.";
  $("method-version").textContent = `Method version: ${setup.version || "not recorded"}`;
  $("caption").textContent = state.desk.captions?.[state.screen] || "";
  renderScreenGates();
  renderTrajectory();
  renderFilters();
  $("ranked-n").textContent = setup.results.length.toLocaleString();
  $("of-n").textContent = ` of ${state.desk.universe_count.toLocaleString()} liquid companies`;
  for (const button of $("screen-switch").querySelectorAll?.("button") || []) {
    const on = button.dataset.screen === state.screen;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
  $("column-note").textContent = listNote();
  const all = shownRows();
  const pages = Math.max(1, Math.ceil(all.length / state.pageSize));
  state.page = Math.min(state.page, pages - 1);
  const start = state.page * state.pageSize;
  const shown = all.slice(start, start + state.pageSize);
  const sortLabel = { rank: "List rank", score: "Score", company: "Company", trend: "Trend", short: "Days to cover", results: "Next results" }[state.sortKey]
    || currentMetrics().find(([key]) => key === state.sortKey)?.[1] || "Metric";
  const sortDirection = state.sortKey === "company"
    ? (state.sortDir === "asc" ? "A to Z" : "Z to A")
    : state.sortKey === "rank" ? (state.sortDir === "desc" ? "first to last" : "last to first")
    : state.sortKey === "results" ? (state.sortDir === "desc" ? "soonest first" : "latest first")
      : (state.sortDir === "desc" ? "High to low" : "Low to high");
  $("order").textContent = `Sorted by ${sortLabel} · ${sortDirection}`;
  $("range").textContent = all.length
    ? `${start + 1}–${Math.min(start + state.pageSize, all.length)} of ${all.length.toLocaleString()} companies`
    : "0 companies";
  $("prev").disabled = state.page === 0;
  $("next").disabled = state.page >= pages - 1;
  setSearchStatus(searchNotice(all));
  renderHead();
  renderBody(shown);
  heldBackNote();
}

function renderIndustries() {
  const counts = new Map();
  for (const symbol of scopeRows()) {
    const key = rowSector(symbol);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const keys = SECTORS.map(([key]) => key).filter((key) => key !== "unclassified" || counts.get("unclassified"));
  $("sector").innerHTML = '<option value="">All sectors</option>' + keys.map((key) => {
    const count = counts.get(key) || 0;
    return `<option value="${escapeHtml(key)}"${count ? "" : " disabled"}>${escapeHtml(sectorLabel(key))} (${count})</option>`;
  }).join("");
  $("sector").value = state.sector;
  $("sector").classList.toggle("active", Boolean(state.sector));
}

function setScreen(screen) {
  state.screen = screen;
  state.sortKey = "rank";
  state.sortDir = "desc";
  state.page = 0;
  state.showAll = false;
  render();
}

function bind() {
  $("body").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-company]");
    if (button) openCompany(button.dataset.company);
  });
  $("held-note").addEventListener("click", (event) => {
    if (!event.target.closest("#show-all")) return;
    state.showAll = !state.showAll;
    state.page = 0;
    render();
  });
  $("evidence-prev").addEventListener("click", () => stepCompany(-1));
  $("evidence-next").addEventListener("click", () => stepCompany(1));
  $("company-evidence").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.target.closest?.("input, select, textarea")) return;
    event.preventDefault();
    stepCompany(event.key === "ArrowLeft" ? -1 : 1);
  });
  $("show-broken").addEventListener("change", (event) => {
    state.showBroken = event.target.checked;
    state.page = 0;
    render();
  });
  $("hide-loss").addEventListener("change", (event) => {
    state.hideLoss = event.target.checked;
    state.page = 0;
    render();
  });
  $("reset-filters").addEventListener("click", () => {
    state.query = "";
    state.sector = "";
    state.showBroken = false;
    state.hideLoss = false;
    state.page = 0;
    $("query").value = "";
    render();
  });
  // The column heading is rebuilt on sorting, paging and list changes.
  $("head").addEventListener("change", (event) => {
    if (event.target.id !== "sector") return;
    state.sector = event.target.value;
    state.page = 0;
    render();
    $("sector").focus();
  });
  const switcher = $("screen-switch");
  for (const [key, label] of SCREENS.filter(([key]) => state.desk.setups[key])) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.screen = key;
    button.innerHTML = `${escapeHtml(label)} <span class="n">${(state.desk.setups[key].results?.length || 0).toLocaleString()}</span>`;
    button.addEventListener("click", () => setScreen(key));
    switcher.append(button);
  }
  $("query").addEventListener("input", (event) => {
    state.query = event.target.value;
    state.page = 0;
    render();
  });
  $("prev").addEventListener("click", () => {
    state.page -= 1;
    render();
  });
  $("next").addEventListener("click", () => {
    state.page += 1;
    render();
  });
  $("head").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-sort]");
    if (!button) return;
    const key = button.dataset.sort;
    if (state.sortKey === key) state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
    else {
      state.sortKey = key;
      state.sortDir = key === "company" ? "asc" : "desc";
    }
    state.page = 0;
    render();
    $("head").querySelector(`button[data-sort="${key}"]`).focus();
  });
}

let controlsBound = false;

// Present only when the week's SEC download was incomplete (tools/export_public_desk.py
// sec_download_note): those companies keep the filings saved earlier, each with its date.
function renderInputsStatus() {
  const target = $("inputs-status");
  const sec = state.desk?.sec_download;
  if (!target) return;
  target.hidden = !sec;
  if (!sec) return;
  const failed = (sec.failed || []).slice(0, 5).join(", ");
  const more = (sec.failed || []).length > 5 ? ", …" : "";
  target.textContent = `SEC filings: this week's download was incomplete, so ${sec.kept_earlier ? `${sec.kept_earlier} companies keep` : "some companies keep"} the filings saved earlier${failed ? ` (failed: ${failed}${more})` : ""}.`;
}

async function start() {
  try {
    const response = await fetch("./desk.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Snapshot request failed: ${response.status}`);
    state.desk = await response.json();
    // A snapshot from before the Shortlist was published opens on Growth.
    if (!state.desk.setups[state.screen]) state.screen = SCREENS.find(([key]) => state.desk.setups[key])?.[0] || "growth";
    try {
      // Optional: the F-Score line in the company panel; the page works without it.
      const fscoreResponse = await fetch("./fscore.json", { cache: "no-store" });
      if (fscoreResponse.ok) {
        const fscore = await fscoreResponse.json();
        if (fscore.schema === "fscore-1" && fscore.as_of === state.desk.as_of) state.fscore = fscore;
      }
    } catch (fscoreError) {
      console.warn("Temper Lab F-Score checklist is unavailable:", fscoreError);
    }
    try {
      const releaseResponse = await fetch("./release.json", { cache: "no-store" });
      if (releaseResponse.ok) {
        const release = await releaseResponse.json();
        const historical = release.historical_validation?.status || "unknown";
        $("release-status").textContent = `Current release: ${release.status || "unknown"} · Historical validation: ${historical}`;
      }
    } catch (releaseError) {
      console.warn("Temper Lab release status is unavailable:", releaseError);
    }
    renderInputsStatus();
    const asOf = `Data as of ${day(state.desk.as_of)}`;
    $("heading-copy").textContent = state.desk.heading;
    $("week-chip").textContent = asOf;
    $("week-chip").title = "Price reference and fundamental signals use this date. Short interest and the results calendar carry their own dates.";
    $("snapshot-built").textContent = `${state.desk.universe_count.toLocaleString()} liquid names${state.desk.recorded_at ? ` · Snapshot built ${day(state.desk.recorded_at)}` : ""}`;
    $("aside-week").textContent = asOf;
    if (!controlsBound) {
      // Insights links here as ./?q=TICKER; an exact ticker shows that company.
      const linked = new URLSearchParams(location.search).get("q");
      if (linked && /^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(linked)) {
        state.query = linked.toUpperCase();
        $("query").value = state.query;
      }
      bind();
      controlsBound = true;
    }
    render();
    loadExtras();
  } catch (error) {
    console.error("Temper Lab could not load the screener:", error);
    $("body").innerHTML = `<tr><td class="empty" colspan="${$("head").querySelectorAll("th").length || 1}" role="alert">The screener could not load. <button type="button" id="retry-load">Try again</button></td></tr>`;
    $("retry-load").addEventListener("click", () => {
      $("retry-load").disabled = true;
      $("retry-load").textContent = "Loading…";
      start();
    });
  }
}

start();
