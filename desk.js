const SCREENS = [
  ["growth", "Growth"],
  ["strength", "Hot tape"],
  ["undervalued", "Cheap on operating profit"],
  ["conviction", "Conviction · analysts"],
];
const VIEWS = [
  ["overview", "Summary"],
  ["quality", "Quality & cash flow"],
  ["price", "Price"],
  ["revenue", "Revenue"],
  ["valuation", "Valuation"],
  ["analysts", "Analysts"],
];
const OVERVIEW = {
  strength: [
    ["momentum_63", "63-session return", "percent"],
    ["momentum_252", "252-session return", "percent"],
    ["operating_earnings_yield_ev", "OI / EV", "percent"],
  ],
  growth: [
    ["roe", "Return on equity", "percent"],
    ["revenue_yoy", "Revenue YoY", "percent"],
    ["relative_strength_6m", "6-month vs QQQ", "percent"],
  ],
  undervalued: [
    ["operating_earnings_yield_ev", "OI / EV", "percent"],
    ["operating_earnings_yield", "OI / equity cap", "percent"],
    ["operating_margin", "TTM operating margin", "percent"],
  ],
  conviction: [
    ["strong_buy", "Strong-buy share", "share"],
    ["analyst_total", "Ratings", "count"],
    ["up_last_30_days", "EPS up · 30d", "count"],
    ["down_last_30_days", "EPS down · 30d", "count"],
    ["revision_breadth", "Revision breadth", "percent"],
  ],
};
const COLUMNS = {
  potential: [["research_revenue", "TTM revenue", "money"], ["research_burn", "TTM operating cash flow", "money"], ["research_runway", "Funding coverage · months", "months"], ["research_dilution", "Shares outstanding · YoY", "percent"]],
  analysts: OVERVIEW.conviction,
  quality: [
    ["roe", "TTM return on equity", "percent"],
    ["net_margin", "TTM net margin", "percent"],
    ["gross_margin", "TTM gross margin", "percent"],
    ["operating_margin", "TTM operating margin", "percent"],
    ["cash_conversion", "TTM cash / profit", "multiple"],
    ["leverage", "Liabilities / assets", "percent"],
  ],
  price: [
    ["momentum_63", "63-session return", "percent"],
    ["momentum_252", "252-session return", "percent"],
  ],
  revenue: [
    ["revenue_yoy", "Revenue YoY", "percent"],
    ["acceleration", "Revenue acceleration", "points"],
  ],
  valuation: [
    ["operating_earnings_yield_ev", "OI / EV", "percent"],
    ["operating_earnings_yield", "OI / equity cap", "percent"],
    ["roe", "Return on equity", "percent"],
    ["net_margin", "Net margin", "percent"],
  ],
};
// Two named steers, deliberately not a scoring engine. Both are minority
// signals on the week they were set: liabilities above 75% of assets flags 26
// of 242 Growth names, cash conversion under 0.7 flags 29. They point at a
// number worth asking a question about. Neither is a verdict, neither feeds a
// rank, and neither is an industry-adjusted judgement - the site audit is
// explicit that a single leverage cutoff does not travel across industries,
// which is why the note says so rather than pretending otherwise.
const LEVERAGE_STEER = 0.75;
const CASH_CONVERSION_STEER = 0.7;
const state = {
  desk: null,
  screen: "growth",
  view: "overview",
  query: "",
  sector: "",
  evidenceStatus: "default",
  requiredMetrics: false,
  potentialStatus: "",
  thisScreen: true,
  sortKey: "score",
  sortDir: "desc",
  panel: "screener",
  experiment: "outlook",
  screenerView: "overview",
  page: 0,
  pageSize: 25,
};

const $ = (id) => document.getElementById(id);

function pct(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}
function points(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)} pp`;
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
function fmt(value, kind) {
  if (kind === "money") return money(value);
  if (kind === "months") return value == null ? "—" : value.toFixed(1);
  if (kind === "share") return value == null ? "—" : `${(value * 100).toFixed(2)}%`;
  if (kind === "percent") return pct(value);
  if (kind === "points") return points(value);
  if (kind === "multiple") return value == null ? "—" : `${value.toFixed(2)}×`;
  return value == null ? "—" : String(value);
}

function scoreCell(idea) {
  if (!idea) return `<td class="score">—</td>`;
  return (
    `<td class="score" title="${idea.score.toFixed(1)} out of 100 on this list">` +
    `<span class="score-value">${idea.score.toFixed(1)}</span><small>/100</small></td>`
  );
}

function metricTd(symbol, key, kind) {
  const lead =
    (state.screen === "undervalued" && key === "operating_earnings_yield_ev") ||
    (state.screen === "growth" && key === "roe");
  return `<td class="metric${lead ? " lead" : ""}">${metricCell(symbol, key, kind)}</td>`;
}

function rankedMap(key) {
  return new Map((state.desk.setups[key]?.results || []).map((row) => [row.symbol, row]));
}
function factor(symbol, key) {
  const p = state.desk.companies[symbol]?.potential;
  if (key.startsWith("research_")) return ({ research_revenue: p?.ttm_revenue, research_burn: p?.ttm_operating_cash_flow, research_runway: p?.funding?.runway_months, research_dilution: p?.shares?.change })[key];
  return state.desk.companies[symbol]?.factors?.[key];
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
function renderTrajectory() {
  const element = $("trajectory-note");
  const track = trajectoryFor(state.screen);
  if (!track) {
    element.textContent = state.desk.trajectory
      ? "This screen has no comparison in the previous published week."
      : "No earlier week is published yet, so nothing is compared.";
    return;
  }
  const since = day(state.desk.trajectory.previous_as_of);
  const rows = Object.values(track.rows);
  const entered = rows.filter((row) => row.change === "entered").length;
  const moved = rows.filter((row) => row.rank_change).length;
  const dropped = track.exited.map((row) => `${row.symbol} (was ${row.previous_rank})`).join(", ");
  element.textContent =
    `Since ${since}: ${entered} new, ${track.exited.length} dropped, ` +
    (track.comparable
      ? `${moved} changed rank. No marker means the rank did not move.`
      : "and the method changed between the two weeks, so their ranks are not compared.") +
    (dropped ? ` Dropped: ${dropped}.` : "");
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
    return `${symbol} is in the liquid universe, not on this published list.`;
  }
  if (visible.length) return "";
  if (looksLikeTicker(q)) {
    return `${q.toUpperCase()} is not among this week's ${n} liquid names.`;
  }
  return "No companies match. Reset filters to clear search, sector and evidence filters.";
}

function setSearchStatus(message) {
  const node = $("search-status");
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

function scopeRows() {
  const ranked = rankedMap(state.screen);
  const exact = matchedSymbol(state.query);
  if (exact) return [exact];
  const needle = state.query.trim().toLowerCase();
  return Object.keys(state.desk.companies).filter((symbol) => {
    const company = state.desk.companies[symbol];
    const hay = `${symbol} ${company?.name ?? ""} ${company?.industry ?? ""} ${compactIndustry(company?.industry)} ${sectorLabel(sectorFor(company?.industry))} ${(company?.potential?.tags || []).join(" ")}`.toLowerCase();
    return (!state.thisScreen || ranked.has(symbol)) && (!needle || hay.includes(needle));
  });
}

function rows() {
  const ranked = rankedMap(state.screen);
  return scopeRows()
    .filter((symbol) => !state.sector || sectorFor(industryKey(state.desk.companies[symbol])) === state.sector)
    .filter((symbol) => {
      const p = state.desk.companies[symbol]?.potential;
      return !state.potentialStatus || (state.potentialStatus === "tracked" ? !!p : p?.status === state.potentialStatus);
    })
    .filter(passesEvidence)
    .filter((symbol) => !state.requiredMetrics || hasRequiredMetrics(symbol))
    .sort((a, b) => {
      const dir = state.sortDir === "asc" ? 1 : -1;
      let va;
      let vb;
      if (state.sortKey === "score") {
        va = ranked.get(a)?.score;
        vb = ranked.get(b)?.score;
      } else if (state.sortKey === "company") {
        va = a;
        vb = b;
      } else if (state.sortKey === "price") {
        va = state.desk.companies[a]?.price;
        vb = state.desk.companies[b]?.price;
      } else if (state.sortKey === "fscore") {
        va = fscoreValue(a);
        vb = fscoreValue(b);
      } else if (state.sortKey === "market_cap") {
        va = state.desk.companies[a]?.market_cap;
        vb = state.desk.companies[b]?.market_cap;
      } else {
        va = factor(a, state.sortKey);
        vb = factor(b, state.sortKey);
      }
      if (va == null && vb == null) return a.localeCompare(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") return va.localeCompare(vb) * (state.sortKey === "company" ? dir : 1);
      if (va === vb) return a.localeCompare(b);
      return va > vb ? dir : -dir;
    });
}

function currentMetrics() {
  if (state.view === "overview") return OVERVIEW[state.screen];
  if (state.view === "quality" && state.screen === "undervalued") {
    // Cheap ranks on operating income / equity cap. ROE is NI / book — leverage
    // lifts both — so it is not a quality stamp here. Gross margin is mostly
    // unfiled on this list. Operating margin shares the ranking numerator.
    return [
      ["operating_margin", "TTM operating margin", "percent"],
      ["net_margin", "TTM net margin", "percent"],
      ["cash_conversion", "TTM cash / profit", "multiple"],
      ["leverage", "Liabilities / assets", "percent"],
    ];
  }
  return COLUMNS[state.view];
}

function trustStatus(symbol) {
  const status = state.desk.companies[symbol]?.trust?.status;
  return ["complete", "review", "broken"].includes(status) ? status : "unknown";
}

function trustLabel(status) {
  return { complete: "No flagged issue", review: "Needs review", broken: "Broken statement", unknown: "Unknown" }[status];
}

function priceOnlyView() {
  return state.view === "price" || (state.view === "overview" && state.screen === "strength");
}

function analystView() {
  return state.view === "analysts" || (state.view === "overview" && state.screen === "conviction");
}

function passesEvidence(symbol) {
  const status = trustStatus(symbol);
  if (state.evidenceStatus === "all") return true;
  if (state.evidenceStatus === "default") return priceOnlyView() || analystView() || status !== "broken";
  return status === state.evidenceStatus;
}

// Why a metric is absent, when the snapshot records it. A property-casualty
// insurer files no gross-profit line, so it has no gross margin to be missing;
// requiring one deleted 137 of 242 Growth names — every insurer, most energy —
// from a comparison their other ratios could have joined. A snapshot published
// before coverage existed carries none, and is read exactly as it was before.
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
  if (Number.isFinite(factor(symbol, key))) return fmt(factor(symbol, key), kind);
  return `<span class="na" title="${missingMetricTitle(symbol, key)}">n/a</span>`;
}

function hasRequiredMetrics(symbol) {
  // A line the company never files is not a gap in the evidence. Anything
  // else absent still is: a trailing year we failed to build, or a ratio a
  // rule declined to publish, both of which do block a comparison.
  return currentMetrics().every(
    ([key]) => Number.isFinite(factor(symbol, key)) || notReported(symbol, key),
  );
}

function evidenceScope() {
  return scopeRows().filter((symbol) => !state.sector || sectorFor(industryKey(state.desk.companies[symbol])) === state.sector);
}

function usualAccountsLabel() {
  if (analystView()) return "Usual: show everyone (analyst view)";
  return priceOnlyView()
    ? "Usual: show everyone (price list)"
    : "Usual: hide statements that do not add up";
}

function evidenceHint() {
  const prefix = "This is the accounts, not profit. A loss-making company can still add up.";
  if (state.evidenceStatus === "default") {
    if (analystView()) return "Analyst sentiment does not grade the accounts. Statement flags remain visible; use Quality & cash flow to inspect them.";
    return priceOnlyView()
      ? `${prefix} On a price list, everyone stays, including broken statements.`
      : `${prefix} On these columns, statements that do not add up are hidden.`;
  }
  if (state.evidenceStatus === "all") {
    return `${prefix} Everyone is shown.`;
  }
  if (state.evidenceStatus === "complete") {
    return `${prefix} Only statements with no flag. That is not the same as every ratio being present.`;
  }
  if (state.evidenceStatus === "review") {
    return `${prefix} Only statements that need a look (thin equity, mixed dates, or stale revenue).`;
  }
  if (state.evidenceStatus === "broken") {
    return `${prefix} Only statements that do not add up.`;
  }
  if (state.evidenceStatus === "unknown") {
    return `${prefix} Only names with no statement grade in this snapshot.`;
  }
  return prefix;
}

function renderEvidenceControls() {
  const base = evidenceScope();
  const accepted = base.filter(passesEvidence);
  const available = accepted.filter(hasRequiredMetrics).length;
  const notApplicable = accepted.filter((symbol) =>
    currentMetrics().some(([key]) => notReported(symbol, key)),
  ).length;
  const naNote = notApplicable
    ? ` ${notApplicable} of them do not report at least one of these lines at all; that is shown as n/a and is not counted as missing.`
    : "";
  const hidden = base.length - accepted.length;
  const select = $("evidence-status");
  const options = [
    ["default", usualAccountsLabel()],
    ["all", "Everyone, including broken statements"],
    ["complete", "Only statements that add up"],
    ["review", "Only statements that need a look"],
    ["broken", "Only statements that do not add up"],
    ["unknown", "Only ungraded statements"],
  ];
  select.innerHTML = options
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  select.value = state.evidenceStatus;
  $("evidence-hint").textContent = evidenceHint();
  $("evidence-hint").hidden = state.view === "potential" || state.evidenceStatus === "default";
  $("coverage-note").textContent =
    `Numbers on screen: ${currentMetrics().map(([, label]) => label).join(", ")}. ` +
    `Available for ${available} of ${accepted.length}; ` +
    `${state.requiredMetrics ? "filter removes" : "the filter would remove"} ${accepted.length - available}.` +
    naNote;
  $("coverage-note").hidden = state.view === "potential" || (hidden === 0 && !state.requiredMetrics && notApplicable === 0);
  $("required-metrics").checked = state.requiredMetrics;
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
  if (screen === "growth") {
    const parts = [has("revenue_yoy") ? `revenue ${oneDecimal(f.revenue_yoy, "change")} year on year` : "",
      has("relative_strength_6m") ? `6 months vs QQQ ${oneDecimal(f.relative_strength_6m, "change")}` : ""].filter(Boolean);
    return `Ranked by return on equity${has("roe") ? ` (${oneDecimal(f.roe, "level")})` : ""}; revenue growth is an entry gate, not the score.${parts.length ? ` Now ${parts.join(", ")}.` : ""}`;
  }
  if (screen === "strength") {
    const now = [has("momentum_63") ? `63 sessions ${oneDecimal(f.momentum_63, "change")}` : "",
      has("momentum_252") ? `252 sessions ${oneDecimal(f.momentum_252, "change")}` : ""].filter(Boolean);
    return `Score is 60% the 63-session and 40% the 252-session return.${now.length ? ` Now ${now.join(", ")}.` : ""} Recent price, not a forecast.`;
  }
  if (screen === "undervalued") {
    return `Ranked by operating income / EV${has("operating_earnings_yield_ev") ? ` (${oneDecimal(f.operating_earnings_yield_ev, "level")})` : ""}${has("operating_earnings_yield") ? `; on equity market cap it is ${oneDecimal(f.operating_earnings_yield, "level")}` : ""}. Cheap is not a quality grade.`;
  }
  if (screen === "conviction") {
    const ratings = has("strong_buy_count") && has("analyst_total")
      ? `${f.strong_buy_count} of ${f.analyst_total} ratings strong buy${has("strong_buy") ? ` (${oneDecimal(f.strong_buy, "level")})` : ""}` : "";
    const revisions = has("up_last_30_days") || has("down_last_30_days")
      ? `EPS estimates in 30 days: ${has("up_last_30_days") ? f.up_last_30_days : 0} up, ${has("down_last_30_days") ? f.down_last_30_days : 0} down${has("revision_breadth") ? ` (breadth ${oneDecimal(f.revision_breadth, "change")})` : ""}` : "";
    const now = [ratings, revisions].filter(Boolean).join("; ");
    return `Score blends two percentiles equally: strong-buy share and EPS-revision breadth.${now ? ` Now ${now}.` : ""}`;
  }
  return "";
}

function whyHere(symbol) {
  if (state.view === "potential") {
    return `<h3>Potential research</h3><p>Unranked research context: no list rank, score or predictive claim.</p>`;
  }
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
  return `<h3>${row ? "Why it's on" : "Not on"} ${escapeHtml(screenName(key))}</h3>
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
    return `Results ${next.unsure ? "~" : ""}${weekday(next.date)}${timing} · ${when}${unsure}.`;
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

function checkFirst(symbol) {
  const status = trustStatus(symbol);
  const reasons = state.desk.companies[symbol]?.trust?.reasons || [];
  const items = [];
  if (status !== "complete") {
    items.push(`<li class="qv-warn"><strong>${trustLabel(status)}</strong>${reasons.length ? `: ${reasons.map(escapeHtml).join("; ")}` : ""}</li>`);
  }
  const results = earningsLine(symbol);
  if (results) items.push(`<li>${escapeHtml(results)}</li>`);
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
  if (state.screen === "conviction") return "";
  const f = state.desk.companies[symbol]?.factors || {};
  if (!Number.isFinite(f.analyst_total)) return "";
  const parts = [Number.isFinite(f.strong_buy_count) ? `${f.strong_buy_count} of ${f.analyst_total} ratings strong buy` : `${f.analyst_total} ratings`];
  if (Number.isFinite(f.up_last_30_days) || Number.isFinite(f.down_last_30_days)) {
    parts.push(`EPS estimates in 30 days ${f.up_last_30_days ?? 0} up, ${f.down_last_30_days ?? 0} down`);
  }
  return `Analysts: ${parts.join("; ")}.`;
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
  state.panelRows = rows();
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
  $("evidence-content").innerHTML = `${panelHeader(symbol, company)}
    ${whyHere(symbol)}
    ${checkFirst(symbol)}
    ${metricsTable(symbol)}
    ${fscore || analysts ? `<p class="qv-more">${[fscore, analysts].filter(Boolean).map(escapeHtml).join("<br>")}</p>` : ""}
    <p class="qv-more">Insiders, 13F funds, the price chart and analyst targets are on the <a href="./ticker.html?t=${encodeURIComponent(symbol)}">full ticker page</a>.</p>
    ${potentialEvidence(company.potential)}
    ${dataDates(symbol, company)}`;
  panelPosition();
  const dialog = $("company-evidence");
  dialog.scrollTop = 0;
  if (!dialog.open) dialog.showModal();
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

// Optional files for the panel. The page works without them; a panel already
// open is redrawn when they arrive.
async function loadPanelExtras() {
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
  const [earnings, shorts] = await Promise.all([
    load("earnings-calendar.json", (data) => data.schema === "earnings-calendar-1"),
    load("short-interest.json", (data) => data.schema === "short-interest-1"),
  ]);
  state.earnings = earnings;
  state.shorts = shorts;
  if ($("company-evidence").open && state.panelSymbol) showEvidence(state.panelSymbol);
}

// Piotroski F-Score in one line; the nine checks are on the Ticker page.
// Context, not a signal: Leg D 2021-26 found no reliable return edge.
function fscoreLine(symbol) {
  if (!state.fscore) return "";
  const f = fscoreOf(symbol);
  if (!f) return "F-Score: no 10-K for a fiscal year ending in the last 15 months in this snapshot.";
  if (!f.scored) return `F-Score: Not scored: only ${f.computed} of 9 checks can be computed (needs 7).`;
  const missing = f.computed < 9 ? `; ${9 - f.computed} not available, counted as not passed` : "";
  return `F-Score ${f.passed}/9${f.computed < 9 ? "*" : ""}: ${f.passed} of 9 financial-health checks passed (Piotroski), 10-K for the year to ${day(f.fy_end)}${missing}. Context, not a signal; the nine checks are on the ticker page.`;
}
function renderScreenGates() {
  // A screen's entry gates are a fact about the screen, so they are stated
  // once here rather than repeated on every row. They used to be a per-row
  // column, which showed the same three chips 242 times on Growth and told
  // the reader nothing: a company is only in the list once it has passed
  // every gate, so the value never varied. Rank already shows non-membership
  // as an em dash when the scope is widened to all companies.
  //
  // Labels still come from desk.json's setups.<screen>.gates, generated from
  // the real gate definitions in build_lake_ideas.py, never hardcoded here -
  // hardcoded English drifted from the actual gates once before.
  const element = $("screen-gates");
  if (state.view === "potential") {
    element.innerHTML = "";
    element.textContent = "Unranked research context. Statuses have no Potential score or predictive claim.";
    return;
  }
  const labels = state.desk.setups?.[state.screen]?.gates || [];
  if (!labels.length) {
    element.innerHTML = "";
    element.textContent = "No entry gates: every eligible company is scored.";
    return;
  }
  element.innerHTML =
    `<span class="gates-label">Entry gates</span>` +
    labels.map((label) => `<span class="chip">${escapeHtml(label)}</span>`).join("");
}

function alsoOn(symbol) {
  return SCREENS.filter(([key]) => key !== state.screen && rankedMap(key).has(symbol)).map(
    ([key, label]) => (key === "undervalued" ? "Value" : label),
  );
}

// Piotroski F-Score as a financial-health checklist (share/fscore.json, built weekly by
// tools/build_fscore.py). Context, not a signal: Leg D 2021-26 found no reliable return edge.
const FSCORE_CHECKS = [
  ["roa_positive", "Net income positive"],
  ["cfo_positive", "Operating cash flow positive"],
  ["roa_up", "Return on assets up on the year before"],
  ["cfo_above_income", "Operating cash flow above net income"],
  ["leverage_not_up", "Long-term debt / assets not up"],
  ["current_ratio_up", "Current ratio up"],
  ["no_new_shares", "No more shares outstanding than a year before"],
  ["gross_margin_up", "Gross margin up"],
  ["turnover_up", "Asset turnover (revenue / assets) up"],
];
function fscoreOf(symbol) {
  return state.fscore?.companies?.[symbol] || null;
}
// The standard 0-9 scale: a check that cannot be computed counts as not passed, so 7 of 7
// computable reads 7/9* and sorts below 8/9. Ties: more checks available first.
function fscoreValue(symbol) {
  const f = fscoreOf(symbol);
  return f?.scored ? f.passed + f.computed / 100 : null;
}
function fscoreBand(f) {
  if (!f?.scored) return "";
  return f.passed >= 8 ? "high" : f.passed <= 2 ? "low" : "";
}
function fscoreMissing(f) {
  return FSCORE_CHECKS.filter(([key]) => f.checks?.[key] == null).map(([, label]) => label);
}
function fscoreCell(symbol) {
  const f = fscoreOf(symbol);
  if (!f) return `<td class="fscore-cell"><span class="fscore none" title="No F-Score: no 10-K in the last 15 months in this snapshot">—</span></td>`;
  if (!f.scored) return `<td class="fscore-cell"><span class="fscore none" title="Only ${f.computed} of 9 checks can be computed (needs 7); open the company for the checks">—</span></td>`;
  const band = fscoreBand(f);
  const missing = fscoreMissing(f);
  const title = `${f.passed} of 9 financial-health checks passed (Piotroski), 10-K for the year ending ${day(f.fy_end)}.`
    + (f.computed < 9 ? ` * Not available: ${missing.length ? missing.join(", ") : `${9 - f.computed} checks`}.` : "") + " Context, not a signal.";
  return `<td class="fscore-cell"><span class="fscore ${band}" title="${escapeHtml(title)}">${f.passed}/9${f.computed < 9 ? "*" : ""}</span></td>`;
}
function sortHeader(key, label) {
  const sorted = state.sortKey === key ? " sorted" : "";
  const direction = state.sortDir === "asc" ? "ascending" : "descending";
  return `<th scope="col" class="${sorted}"${sorted ? ` aria-sort="${direction}"` : ""}><button type="button" data-sort="${key}">${label}${sorted ? ` <span aria-hidden="true">${state.sortDir === "asc" ? "↑" : "↓"}</span>` : ""}</button></th>`;
}

function renderHead() {
  const metrics = currentMetrics();
  let html = `<tr><th class="rank" title="Rank on this list. Sorting a column reorders the rows; this number stays the list rank.">List rank</th>${sortHeader("company", "Company")}<th scope="col" class="industry-column"><label for="sector">Sector</label><select id="sector" aria-label="Filter by sector" title="Eleven market sectors, the same buckets as GICS. Rows still show the Nasdaq industry. Rank is unchanged."></select></th>${sortHeader("fscore", "F-Score")}`;
  if (state.view === "overview") {
    for (const [key, label] of metrics) html += sortHeader(key, label);
    html += `${sortHeader("score", "Score")}<th>Also on</th>${sortHeader("price", "Price")}${sortHeader("market_cap", "Market cap")}`;
  } else {
    for (const [key, label] of metrics) html += sortHeader(key, label);
    html += sortHeader("score", "Score");
  }
  if (state.view === "potential") {
    html = html.replace(/<th class="rank"[^>]*>.*?<\/th>/, "<th>Research status</th>");
    html = html.replace(sortHeader("score", "Score"), "");
  }
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
  const researchChip = company?.potential ? `<span class="flag">${escapeHtml(company.potential.status)}</span>` : "";
  return `<td><div class="tl-with-star">${starHtml(symbol, company?.name)}<button type="button" class="company-button" data-company="${escapeHtml(symbol)}" aria-label="Inspect evidence for ${escapeHtml(symbol)}"><span class="ticker">${escapeHtml(symbol)}${chip}${researchChip}</span><span class="name">${escapeHtml(company?.name ?? symbol)}</span></button></div></td>`;
}

function industryCell(symbol) {
  const industry = state.desk.companies[symbol]?.industry?.trim() || "";
  const label = compactIndustry(industry);
  const sector = sectorLabel(sectorFor(industry));
  const title = industry ? `${sector} · ${industry}` : "Industry unavailable";
  return `<td class="industry-column"><span class="industry" title="${escapeHtml(title)}">${escapeHtml(label)}</span></td>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function renderBody(pageRows) {
  const ranked = rankedMap(state.screen);
  const metrics = currentMetrics();
  if (!pageRows.length) {
    const columnCount = 4 + metrics.length + (state.view === "overview" ? 4 : state.view === "potential" ? 0 : 1);
    const message = searchNotice([])
      || (state.screen === "conviction" && state.thisScreen && !ranked.size
        ? "No Conviction names were published for this snapshot. Analyst inputs may be unavailable or below the coverage requirements; inspect a company for its exclusion reason."
        : "No companies match. Reset filters to clear search, sector and evidence filters.");
    $("body").innerHTML = `<tr><td class="empty" colspan="${columnCount}">${escapeHtml(message)}</td></tr>`;
    return;
  }
  $("body").innerHTML = pageRows
    .map((symbol) => {
      const idea = ranked.get(symbol);
      let cells = `<td class="rank">${idea?.rank ?? "—"}${movementChip(symbol)}</td>${companyCell(symbol)}${industryCell(symbol)}${fscoreCell(symbol)}`;
      if (state.view === "overview") {
        for (const [key, , kind] of metrics) {
          cells += metricTd(symbol, key, kind);
        }
        cells += scoreCell(idea);
        cells += `<td><span class="chips">${alsoOn(symbol)
          .map((label) => `<span class="chip also">${label}</span>`)
          .join("")}</span></td>`;
        cells += `<td>${price(state.desk.companies[symbol]?.price)}</td>`;
        cells += `<td>${money(state.desk.companies[symbol]?.market_cap)}</td>`;
      } else {
        for (const [key, , kind] of metrics) {
          cells += metricTd(symbol, key, kind);
        }
        if (state.view !== "potential") cells += scoreCell(idea);
      }
      if (state.view === "potential") cells = cells.replace(/<td class="rank">.*?<\/td>/, `<td>${escapeHtml(state.desk.companies[symbol]?.potential?.status || "Not tracked")}</td>`);
      return `<tr>${cells}</tr>`;
    })
    .join("");
}

function screenLabel(key) {
  return SCREENS.find(([id]) => id === key)?.[1] ?? key;
}

function rankedByPhrase(key) {
  return {
    strength: "recent 63- and 252-session return",
    growth: "return on equity, after the profit and growth gates",
    undervalued: "operating income divided by EV (equity cap + interest-bearing debt − cash)",
    conviction: "50% strong-buy-share percentile + 50% EPS-revision-breadth percentile",
  }[key];
}

function inspectNote() {
  if (state.view === "potential") return "No score. Funding coverage is a constant-burn scenario, not a forecast.";
  const list = screenLabel(state.screen);
  const rankedBy = rankedByPhrase(state.screen);
  if (analystView()) {
    const dates = state.desk.setups.conviction?.analyst_dates;
    const collected = dates ? `Collected ${day(dates.first)}${day(dates.last) !== day(dates.first) ? `–${day(dates.last)}` : ""}; price reference ${day(state.desk.as_of)}.` : "No dated analyst capture is available for this price week.";
    return `${list} rank stays ${rankedBy}. ${collected} One upward revision can have the same breadth as ten.`;
  }
  if (state.view === "overview" && state.screen === "growth") {
    return "Six-month vs QQQ is the tape, not the rank.";
  }
  if (state.view === "overview" && state.screen === "strength") {
    return "This list is Hot tape. OI / EV is not the Hot tape rank. Inspect does not pick a different set of companies.";
  }
  if (state.view === "overview" && state.screen === "undervalued") {
    return "Rank is operating income divided by EV. OI / equity cap is not the rank.";
  }
  if (state.screen === "strength" && state.view !== "overview" && state.view !== "price") {
    return "Same Hot tape names. Rank is still the tape. Loss-making leaders are expected.";
  }
  if (state.screen === "undervalued" && state.view === "quality") {
    return "Same Cheap names. Gross margin is omitted: most Cheap names never file a gross-profit line. ROE is net income over book, so it stays on Valuation.";
  }
  if (state.screen === "undervalued" && state.view === "valuation") {
    return "Same Cheap names. ROE here is net income over book, not a Cheap quality grade.";
  }
  if (state.view === "overview") return `This list is ${list}. Rank is ${rankedBy}.`;
  return `Same ${list} names. Rank is still ${rankedBy}.`;
}

function markTab(id, on) {
  const button = $(id);
  button.classList.toggle("on", on);
  if (typeof button.setAttribute === "function") button.setAttribute("aria-selected", on ? "true" : "false");
}

function applyPanels() {
  const experiment = state.panel === "experiment";
  const potential = experiment && state.experiment === "potential";
  const outlook = experiment && !potential;
  $("experiment-switch").hidden = !experiment;
  $("outlook").hidden = !outlook;
  $("screener-panel").hidden = outlook;
  $("screener-tools").hidden = potential;
  $("potential-tools").hidden = !potential;
  markTab("show-screener", !experiment);
  markTab("show-experiment", experiment);
  markTab("show-outlook", outlook);
  markTab("show-potential", potential);
}

function setResearchPanel(panel, experiment) {
  if (panel === "experiment") {
    state.panel = "experiment";
    state.experiment = experiment === "potential" ? "potential" : (experiment || state.experiment || "outlook");
    if (state.experiment === "potential" && state.view !== "potential") {
      state.screenerView = state.view;
      state.savedEvidence = state.evidenceStatus;
      state.savedRequired = state.requiredMetrics;
      state.savedThisScreen = state.thisScreen;
      state.view = "potential";
      state.thisScreen = false;
      if (!state.potentialStatus) state.potentialStatus = "tracked";
      state.requiredMetrics = false;
      state.evidenceStatus = "all";
      state.sortKey = "company";
      state.sortDir = "asc";
      state.page = 0;
    }
  } else {
    state.panel = "screener";
    if (state.view === "potential") {
      state.view = state.screenerView && state.screenerView !== "potential" ? state.screenerView : "overview";
      state.thisScreen = state.savedThisScreen !== false;
      state.evidenceStatus = state.savedEvidence || "default";
      state.requiredMetrics = Boolean(state.savedRequired);
      state.potentialStatus = "";
      state.sortKey = "score";
      state.sortDir = "desc";
      state.page = 0;
    }
  }
  applyPanels();
}

function render() {
  const setup = state.desk.setups[state.screen];
  $("method-copy").textContent = setup.method || "Method not recorded in this snapshot.";
  $("method-version").textContent = `Method version: ${setup.version || "not recorded"}`;
  renderEvidenceControls();
  $("potential-status").value = state.potentialStatus;
  $("caption").textContent = state.view === "potential"
    ? "Research context — revenue, funding, dilution and milestones; no rank."
    : state.desk.captions[state.screen];
  renderScreenGates();
  renderTrajectory();
  const potentialCount = Object.values(state.desk.companies).filter((company) => company.potential).length;
  const research = state.view === "potential";
  $("ranked-n").textContent = (research ? potentialCount : setup.results.length).toLocaleString();
  $("of-n").textContent = research
    ? `tracked research entries of ${state.desk.universe_count.toLocaleString()} liquid companies`
    : `of ${state.desk.universe_count.toLocaleString()} companies`;
  $("potential-n").textContent = potentialCount.toLocaleString();
  $("potential-of").textContent = ` of ${state.desk.universe_count.toLocaleString()} liquid companies`;
  $("trajectory-note").hidden = research;
  $("this-screen").classList.toggle("on", state.thisScreen);
  $("all-liquid").classList.toggle("on", !state.thisScreen);
  for (const button of document.querySelectorAll("#tabs button")) {
    button.classList.toggle("on", button.dataset.view === state.view);
  }
  const note = $("column-note");
  note.hidden = false;
  note.textContent = inspectNote();
  note.classList.toggle(
    "tape-warning",
    state.screen === "strength" && state.view !== "overview" && state.view !== "price",
  );
  const all = rows();
  const pages = Math.max(1, Math.ceil(all.length / state.pageSize));
  state.page = Math.min(state.page, pages - 1);
  const start = state.page * state.pageSize;
  const shown = all.slice(start, start + state.pageSize);
  const sortLabel = { score: "Score", company: "Company", price: "Price", market_cap: "Market cap", fscore: "F-Score (checks passed)" }[state.sortKey] || currentMetrics().find(([key]) => key === state.sortKey)?.[1] || "Metric";
  const sortDirection = state.sortKey === "company"
    ? (state.sortDir === "asc" ? "A to Z" : "Z to A")
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
  applyPanels();
}

function renderIndustries() {
  const counts = new Map();
  for (const symbol of scopeRows()) {
    const key = sectorFor(industryKey(state.desk.companies[symbol]));
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

function bind() {
  $("body").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-company]");
    if (button) openCompany(button.dataset.company);
  });
  $("evidence-prev").addEventListener("click", () => stepCompany(-1));
  $("evidence-next").addEventListener("click", () => stepCompany(1));
  $("company-evidence").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.target.closest?.("input, select, textarea")) return;
    event.preventDefault();
    stepCompany(event.key === "ArrowLeft" ? -1 : 1);
  });
  $("evidence-status").addEventListener("change", (event) => {
    state.evidenceStatus = event.target.value;
    state.page = 0;
    render();
  });
  $("potential-status").addEventListener("change", (event) => {
    state.potentialStatus = event.target.value;
    if (state.potentialStatus) {
      state.thisScreen = false; state.view = "potential";
      state.sortKey = "company"; state.sortDir = "asc";
      state.requiredMetrics = false; state.evidenceStatus = "all";
    }
    state.page = 0; render();
  });
  $("required-metrics").addEventListener("change", (event) => {
    state.requiredMetrics = event.target.checked;
    state.page = 0;
    render();
  });
  const resetQuery = () => {
    state.query = "";
    state.sector = "";
    state.page = 0;
    $("query").value = "";
  };
  $("reset-filters").addEventListener("click", () => {
    resetQuery();
    state.evidenceStatus = "default";
    state.requiredMetrics = false;
    state.potentialStatus = "";
    render();
  });
  $("reset-potential").addEventListener("click", () => {
    resetQuery();
    state.potentialStatus = "tracked";
    state.requiredMetrics = false;
    state.evidenceStatus = "all";
    state.sortKey = "company";
    state.sortDir = "asc";
    render();
  });
  // The column heading is rebuilt on sorting, paging and screen changes.
  $("head").addEventListener("change", (event) => {
    if (event.target.id !== "sector") return;
    state.sector = event.target.value;
    state.page = 0;
    render();
    $("sector").focus();
  });
  const select = $("screen");
  select.innerHTML = SCREENS.filter(([key]) => state.desk.setups[key]).map(
    ([key, label]) => `<option value="${key}">${label}</option>`,
  ).join("");
  select.value = state.screen;
  select.addEventListener("change", () => {
    state.screen = select.value;
    state.view = "overview";
    state.screenerView = "overview";
    state.sortKey = "score";
    state.sortDir = "desc";
    state.page = 0;
    render();
  });
  const tabs = $("tabs");
  for (const [key, label] of VIEWS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.view = key;
    button.textContent = label;
    if (key === "overview") button.classList.add("on");
    button.addEventListener("click", () => {
      state.view = key;
      state.screenerView = key;
      state.sortKey = "score";
      state.sortDir = "desc";
      state.page = 0;
      render();
    });
    tabs.append(button);
  }
  $("this-screen").addEventListener("click", () => {
    state.thisScreen = true;
    state.page = 0;
    render();
  });
  $("all-liquid").addEventListener("click", () => {
    state.thisScreen = false;
    state.page = 0;
    render();
  });
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
  $("show-screener").addEventListener("click", () => {
    setResearchPanel("screener");
    render();
  });
  $("show-experiment").addEventListener("click", () => {
    setResearchPanel("experiment", state.experiment);
    render();
  });
  $("show-outlook").addEventListener("click", () => {
    setResearchPanel("experiment", "outlook");
    render();
  });
  $("show-potential").addEventListener("click", () => {
    setResearchPanel("experiment", "potential");
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

async function start() {
  try {
    const response = await fetch("./desk.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Snapshot request failed: ${response.status}`);
    state.desk = await response.json();
    try {
      // Optional: the F-Score checklist column; the page works without it.
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
    const asOf = `Data as of ${day(state.desk.as_of)}`;
    $("heading-copy").textContent = state.desk.heading;
    $("week-chip").textContent = asOf;
    $("week-chip").title = "Price reference and fundamental signals use this date. Analyst observations use their separately displayed collection dates.";
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
    loadPanelExtras();
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


function potentialEvidence(p) {
  if (!p) return "";
  const f = p.funding || {};
  const link = (url, label) => typeof url === "string" && url.startsWith("https://")
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label);
  const fields = [
    ["Status", p.status], ["Tags", (p.tags || []).join(", ") || "None"],
    ["Research review recorded · may be after the price date", p.review?.reviewed_at || "Not reviewed"],
    ["Review due", p.review?.review_due || "Not set"],
    ["TTM revenue", money(p.ttm_revenue)], ["TTM operating cash flow", money(p.ttm_operating_cash_flow)],
    ["Cash only · incomplete funding measure", money(p.cash_only)],
    ["Cash + short-term investments less restrictions and near-term debt", money(f.available_funds)],
    ["Long-term investments · excluded from coverage", money(f.long_term_investments)],
    ["Monthly operating burn + cash capex", money(f.monthly_burn)],
    ["Funding period end", f.period_end || "Unknown"],
    ["Funding coverage · constant-burn months", f.runway_months == null ? "Unknown / not applicable" : f.runway_months.toFixed(1)],
    ["Shares outstanding · YoY", p.shares ? `${pct(p.shares.change)} (${p.shares.from} to ${p.shares.to})` : "Unknown; requires comparable counts and no intervening split"],
    ["Debt review", p.review?.debt_review || "Unknown"],
    ["Dilution review", p.review?.dilution_review || "Unknown"],
    ["Going-concern review", p.review?.going_concern_review || "Unknown"],
    ["Growth research graduation", p.growth_promotion?.confirmed ? "Confirmed for two consecutive reporting periods" : "Not confirmed for two consecutive reporting periods"],
  ];
  return `<h3>Potential / research status</h3><p>${escapeHtml(p.validation)}</p>
    <dl>${fields.map(([k,v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>
    <p>${escapeHtml(f.basis || "Funding evidence unavailable")}</p><p>${escapeHtml(f.commitments_note || "")}</p>
    <p>${escapeHtml(p.review?.notes || "Operating milestones and funding require a sourced review.")}</p>
    ${p.review ? `<p>${link(p.review.source_url, "Review source")} · source date ${escapeHtml(p.review.source_date)}</p>` : ""}
    <p>${escapeHtml(p.growth_promotion?.meaning || "")}</p>
    <h4>Evidence still needed / risks</h4><ul>${(p.reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join("") || "<li>No rule flagged; still experimental.</li>"}</ul>
    <h4>Revenue history and TTM gross margin at each filing</h4><ul>${(p.history || []).map(r => `<li>${escapeHtml(r.period_end)} · revenue ${money(r.revenue)} · YoY ${pct(r.revenue_yoy)} · TTM gross margin ${pct(r.gross_margin)} · filed ${escapeHtml(r.filed)}</li>`).join("")}</ul>
    <h4>Milestones</h4><ul>${(p.review?.milestones || []).map(m => `<li>${escapeHtml(m.target_date)} · ${escapeHtml(m.state)} · ${escapeHtml(m.description)} (${escapeHtml(m.date_basis)}) · ${link(m.source_url, "Source")}</li>`).join("") || "<li>No dated milestone reviewed.</li>"}</ul>`;
}

start();
