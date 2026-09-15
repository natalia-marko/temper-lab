const SCREENS = [
  ["growth", "Growth"],
  ["strength", "Hot tape"],
  ["undervalued", "Cheap on operating profit"],
];
const VIEWS = [
  ["overview", "Summary"],
  ["quality", "Quality & cash flow"],
  ["price", "Price"],
  ["revenue", "Revenue"],
  ["valuation", "Valuation"],
];
const OVERVIEW = {
  strength: [
    ["momentum_63", "63-session return", "percent"],
    ["momentum_252", "252-session return", "percent"],
  ],
  growth: [
    ["revenue_yoy", "Revenue YoY", "percent"],
    ["relative_strength_6m", "6-month vs QQQ", "percent"],
    ["roe", "Return on equity", "percent"],
  ],
  undervalued: [["operating_earnings_yield", "Operating yield", "percent"]],
};
const COLUMNS = {
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
    ["operating_earnings_yield", "Operating yield", "percent"],
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
  thisScreen: true,
  sortKey: "score",
  sortDir: "desc",
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
  const lead = state.screen === "undervalued" && key === "operating_earnings_yield";
  return `<td class="metric${lead ? " lead" : ""}">${metricCell(symbol, key, kind)}</td>`;
}

function rankedMap(key) {
  return new Map((state.desk.setups[key].results || []).map((row) => [row.symbol, row]));
}
function factor(symbol, key) {
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

// Nasdaq industry string → one of the 11 GICS sector buckets used by S&P, MSCI,
// Fidelity and Seeking Alpha. This is Temper Lab's map of vendor labels, not
// S&P's company-level GICS codes. The vendor's own sector field was not used:
// 27 industries sit in more than one of their sectors.
const SECTORS = [
  ["basic_materials", "Basic materials"],
  ["communication", "Communication services"],
  ["consumer_cyclical", "Consumer cyclical"],
  ["consumer_defensive", "Consumer defensive"],
  ["energy", "Energy"],
  ["financials", "Financials"],
  ["healthcare", "Healthcare"],
  ["industrials", "Industrials"],
  ["real_estate", "Real estate"],
  ["technology", "Technology"],
  ["utilities", "Utilities"],
  ["unclassified", "Unclassified"],
];
const INDUSTRY_SECTOR = {
  "Computer Software: Prepackaged Software": "technology",
  "Computer Software: Programming Data Processing": "technology",
  "Semiconductors": "technology",
  "EDP Services": "technology",
  "Electronic Components": "technology",
  "Computer Communications Equipment": "technology",
  "Computer Manufacturing": "technology",
  "Computer peripheral equipment": "technology",
  "Telecommunications Equipment": "technology",
  "Radio And Television Broadcasting And Communications Equipment": "technology",
  "Biotechnology: Pharmaceutical Preparations": "healthcare",
  "Biotechnology: Biological Products (No Diagnostic Substances)": "healthcare",
  "Biotechnology: Commercial Physical & Biological Resarch": "healthcare",
  "Biotechnology: Electromedical & Electrotherapeutic Apparatus": "healthcare",
  "Biotechnology: In Vitro & In Vivo Diagnostic Substances": "healthcare",
  "Biotechnology: Laboratory Analytical Instruments": "healthcare",
  "Medical/Dental Instruments": "healthcare",
  "Medical Specialities": "healthcare",
  "Medical/Nursing Services": "healthcare",
  "Hospital/Nursing Management": "healthcare",
  "Misc Health and Biotechnology Services": "healthcare",
  "Medical Electronics": "healthcare",
  "Ophthalmic Goods": "healthcare",
  "Medicinal Chemicals and Botanical Products": "healthcare",
  "Other Pharmaceuticals": "healthcare",
  "Major Banks": "financials",
  "Property-Casualty Insurers": "financials",
  "Investment Bankers/Brokers/Service": "financials",
  "Investment Managers": "financials",
  "Finance: Consumer Services": "financials",
  "Life Insurance": "financials",
  "Specialty Insurers": "financials",
  "Accident &Health Insurance": "financials",
  "Savings Institutions": "financials",
  "Finance Companies": "financials",
  "Finance/Investors Services": "financials",
  "Misc Corporate Leasing Services": "financials",
  "Real Estate Investment Trusts": "real_estate",
  "Real Estate": "real_estate",
  "Building operators": "real_estate",
  "Oil & Gas Production": "energy",
  "Integrated oil Companies": "energy",
  "Oil/Gas Transmission": "energy",
  "Oilfield Services/Equipment": "energy",
  "Oil and Gas Field Machinery": "energy",
  "Oil Refining/Marketing": "energy",
  "Coal Mining": "energy",
  "Electric Utilities: Central": "utilities",
  "Natural Gas Distribution": "utilities",
  "Power Generation": "utilities",
  "Water Supply": "utilities",
  "Major Chemicals": "basic_materials",
  "Agricultural Chemicals": "basic_materials",
  "Specialty Chemicals": "basic_materials",
  "Containers/Packaging": "basic_materials",
  "Steel/Iron Ore": "basic_materials",
  "Mining & Quarrying of Nonmetallic Minerals (No Fuels)": "basic_materials",
  "Metal Mining": "basic_materials",
  "Precious Metals": "basic_materials",
  "Aluminum": "basic_materials",
  "Forest Products": "basic_materials",
  "Paper": "basic_materials",
  "Plastic Products": "basic_materials",
  "Paints/Coatings": "basic_materials",
  "Building Materials": "basic_materials",
  "Industrial Machinery/Components": "industrials",
  "Business Services": "industrials",
  "Military/Government/Technical": "industrials",
  "Metal Fabrications": "industrials",
  "Electrical Products": "industrials",
  "Industrial Specialties": "industrials",
  "Diversified Commercial Services": "industrials",
  "Aerospace": "industrials",
  "Engineering & Construction": "industrials",
  "Professional Services": "industrials",
  "Transportation Services": "industrials",
  "Trucking Freight/Courier Services": "industrials",
  "Air Freight/Delivery Services": "industrials",
  "Marine Transportation": "industrials",
  "Railroads": "industrials",
  "Integrated Freight & Logistics": "industrials",
  "Construction/Ag Equipment/Trucks": "industrials",
  "Fluid Controls": "industrials",
  "Environmental Services": "industrials",
  "Water Sewer Pipeline Comm & Power Line Construction": "industrials",
  "Office Equipment/Supplies/Services": "industrials",
  "Rental/Leasing Companies": "industrials",
  "Pollution Control Equipment": "industrials",
  "Precision Instruments": "industrials",
  "Ordnance And Accessories": "industrials",
  "Multi-Sector Companies": "industrials",
  "General Bldg Contractors - Nonresidential Bldgs": "industrials",
  "Building Products": "industrials",
  "Miscellaneous manufacturing industries": "industrials",
  "Professional and commerical equipment": "industrials",
  "Tools/Hardware": "industrials",
  "Wholesale Distributors": "industrials",
  "Electronics Distribution": "industrials",
  "Hotels/Resorts": "consumer_cyclical",
  "Restaurants": "consumer_cyclical",
  "Homebuilding": "consumer_cyclical",
  "Auto Parts:O.E.M.": "consumer_cyclical",
  "Other Consumer Services": "consumer_cyclical",
  "Services-Misc. Amusement & Recreation": "consumer_cyclical",
  "Other Specialty Stores": "consumer_cyclical",
  "Department/Specialty Retail Stores": "consumer_cyclical",
  "Retail-Auto Dealers and Gas Stations": "consumer_cyclical",
  "Catalog/Specialty Distribution": "consumer_cyclical",
  "Apparel": "consumer_cyclical",
  "Auto Manufacturing": "consumer_cyclical",
  "Clothing/Shoe/Accessory Stores": "consumer_cyclical",
  "Consumer Electronics/Appliances": "consumer_cyclical",
  "Home Furnishings": "consumer_cyclical",
  "RETAIL: Building Materials": "consumer_cyclical",
  "Recreational Games/Products/Toys": "consumer_cyclical",
  "Shoe Manufacturing": "consumer_cyclical",
  "Auto & Home Supply Stores": "consumer_cyclical",
  "Automotive Aftermarket": "consumer_cyclical",
  "Retail: Computer Software & Peripheral Equipment": "consumer_cyclical",
  "Garments and Clothing": "consumer_cyclical",
  "Consumer Electronics/Video Chains": "consumer_cyclical",
  "Motor Vehicles": "consumer_cyclical",
  "Consumer Specialties": "consumer_cyclical",
  "Durable Goods": "consumer_cyclical",
  "Textiles": "consumer_cyclical",
  "Packaged Foods": "consumer_defensive",
  "Beverages (Production/Distribution)": "consumer_defensive",
  "Farming/Seeds/Milling": "consumer_defensive",
  "Food Distributors": "consumer_defensive",
  "Package Goods/Cosmetics": "consumer_defensive",
  "Food Chains": "consumer_defensive",
  "Meat/Poultry/Fish": "consumer_defensive",
  "Specialty Foods": "consumer_defensive",
  "Retail-Drug Stores and Proprietary Stores": "consumer_defensive",
  "Tobacco": "consumer_defensive",
  "Cable & Other Pay Television Services": "communication",
  "Broadcasting": "communication",
  "Newspapers/Magazines": "communication",
  "Advertising": "communication",
  "Movies/Entertainment": "communication",
  "Publishing": "communication",
  "Books": "communication",
  Software: "technology",
  Banks: "financials",
};

function sectorFor(name) {
  const raw = (name || "").trim();
  if (!raw || raw === "__unclassified") return "unclassified";
  return INDUSTRY_SECTOR[raw] || "unclassified";
}

function sectorLabel(key) {
  return SECTORS.find(([id]) => id === key)?.[1] ?? key;
}

function scopeRows() {
  const ranked = rankedMap(state.screen);
  const needle = state.query.trim().toLowerCase();
  return Object.keys(state.desk.companies).filter((symbol) => {
    const company = state.desk.companies[symbol];
    const hay = `${symbol} ${company?.name ?? ""} ${company?.industry ?? ""} ${compactIndustry(company?.industry)} ${sectorLabel(sectorFor(company?.industry))}`.toLowerCase();
    return (!state.thisScreen || ranked.has(symbol)) && (!needle || hay.includes(needle));
  });
}

function rows() {
  const ranked = rankedMap(state.screen);
  return scopeRows()
    .filter((symbol) => !state.sector || sectorFor(industryKey(state.desk.companies[symbol])) === state.sector)
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
  return state.view === "overview" ? OVERVIEW[state.screen] : COLUMNS[state.view];
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

function passesEvidence(symbol) {
  const status = trustStatus(symbol);
  if (state.evidenceStatus === "all") return true;
  if (state.evidenceStatus === "default") return priceOnlyView() || status !== "broken";
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
  return priceOnlyView()
    ? "Usual: show everyone (price list)"
    : "Usual: hide statements that do not add up";
}

function evidenceHint() {
  const prefix = "This is the accounts, not profit. A loss-making company can still add up.";
  if (state.evidenceStatus === "default") {
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
  const cash = accepted.filter((symbol) => Number.isFinite(factor(symbol, "cash_conversion"))).length;
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
  $("coverage-note").textContent =
    `This filter hides ${hidden} of ${base.length} names. ` +
    `Numbers on screen: ${currentMetrics().map(([, label]) => label).join(", ")}. ` +
    `Available for ${available} of ${accepted.length} remaining names; ` +
    `${state.requiredMetrics ? "filter removes" : "enabling the filter would remove"} ${accepted.length - available}. ` +
    `Cash conversion available for ${cash} of ${accepted.length}.${naNote} ` +
    `Availability means a finite value, not verified comparability.`;
  $("required-metrics").checked = state.requiredMetrics;
}

function showEvidence(symbol) {
  const company = state.desk.companies[symbol];
  if (!company) return;
  $("evidence-title").textContent = `${symbol} · ${company.name || symbol}`;
  const dates = [
    ["Price date", company.price_date],
    ["Revenue fiscal period end", company.revenue_period_end],
    ["Revenue filing date", company.revenue_filed],
    ["Quality filing date", company.quality_filed],
  ];
  const reasons = company.trust?.reasons || [];
  const notes = standoutNotes(symbol);
  const profitable = state.desk.companies[symbol]?.profitable;
  const earns =
    profitable === false
      ? " Trailing twelve-month net income is negative; that is a fact about the business, not a problem with the evidence."
      : profitable === true
        ? " Trailing twelve-month net income is positive."
        : "";
  $("evidence-content").innerHTML = `<p><strong>${trustLabel(trustStatus(symbol))}</strong>. This statement status does not certify coverage, freshness, or valuation.${earns}</p>
    ${reasons.length ? `<ul>${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : "<p>No specific issue recorded.</p>"}
    <dl>${dates.map(([label, value]) => `<dt>${label}</dt><dd>${value ? escapeHtml(day(value)) : "Not recorded in this snapshot"}</dd>`).join("")}</dl>
    <p>Filing dates are calendar dates, not exact publication timestamps. The quality filing date is not a separate fiscal period or filing date for every ratio component. Original accessions and share-count reconciliation are not included in this public snapshot.</p>
    <h3>Metrics in this view</h3><dl>${currentMetrics().map(([key, label, kind]) => `<dt>${label}</dt><dd>${Number.isFinite(factor(symbol, key)) ? fmt(factor(symbol, key), kind) : notReported(symbol, key) ? "Not reported by this filer" : "Unavailable"}</dd>`).join("")}</dl>
    ${notes.length ? `<h3>What stands out</h3><ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul><p>These are prompts to look further, not conclusions, and they change nothing about the rank or score.</p>` : ""}
    <h3>Published screen membership</h3><ul>${SCREENS.map(([key, label]) => {
      const row = rankedMap(key).get(symbol);
      const moved = movementLabel(key, symbol);
      const since = moved ? ` <em>${escapeHtml(moved)}</em>` : "";
      return `<li>${label}: ${row ? `original rank ${row.rank}, score ${row.score.toFixed(1)}${since}` : `Outside the published list; a missing input, failed gate, or shortlist cutoff may apply. Individual exclusion reasons are not exported.${since}`}</li>`;
    }).join("")}</ul>`;
  $("company-evidence").showModal();
}

// One line about a number already on the page, when that number is unusual
// enough to be worth a second look. Nothing here is new data.
function standoutNotes(symbol) {
  const company = state.desk.companies[symbol];
  const factors = company?.factors ?? {};
  const notes = [];
  if (Number.isFinite(factors.leverage) && factors.leverage > LEVERAGE_STEER) {
    notes.push(
      `Liabilities are ${(factors.leverage * 100).toFixed(0)}% of assets. How much balance sheet is normal varies widely by industry — banks, insurers and property trusts sit this high by construction — so compare it against similar companies rather than reading it as risk on its own.`,
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
      `Operating cash flow is ${factors.cash_conversion.toFixed(2)}× net income, so less cash arrived than the profit line implies. One quarter of working capital or a one-off charge can do this; what matters is whether it persists.`,
    );
  }
  return notes;
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
  const labels = state.desk.setups?.[state.screen]?.gates || [];
  const element = $("screen-gates");
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

function sortHeader(key, label) {
  const sorted = state.sortKey === key ? " sorted" : "";
  const direction = state.sortDir === "asc" ? "ascending" : "descending";
  return `<th scope="col" class="${sorted}"${sorted ? ` aria-sort="${direction}"` : ""}><button type="button" data-sort="${key}">${label}${sorted ? ` <span aria-hidden="true">${state.sortDir === "asc" ? "↑" : "↓"}</span>` : ""}</button></th>`;
}

function renderHead() {
  const metrics =
    state.view === "overview" ? OVERVIEW[state.screen] : COLUMNS[state.view];
  let html = `<tr><th class="rank" title="Rank on this list. Sorting a column reorders the rows; this number stays the list rank.">List rank</th>${sortHeader("company", "Company")}<th scope="col" class="industry-column"><label for="sector">Sector</label><select id="sector" aria-label="Filter by sector" title="Eleven market sectors, the same buckets as GICS. Rows still show the Nasdaq industry. Rank is unchanged."></select></th>`;
  if (state.view === "overview") {
    for (const [key, label] of metrics) html += sortHeader(key, label);
    html += `${sortHeader("score", "Score")}<th>Also on</th>${sortHeader("price", "Price")}${sortHeader("market_cap", "Market cap")}`;
  } else {
    for (const [key, label] of metrics) html += sortHeader(key, label);
    html += sortHeader("score", "Score");
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

function companyCell(symbol) {
  const company = state.desk.companies[symbol];
  const status = trustStatus(symbol);
  const chip =
    (status !== "complete"
      ? `<span class="trust ${status}">${trustLabel(status)}</span>`
      : "") + lossmakingChip(symbol);
  return `<td><button type="button" class="company-button" data-company="${escapeHtml(symbol)}" aria-label="Inspect evidence for ${escapeHtml(symbol)}"><span class="ticker">${escapeHtml(symbol)}${chip}</span><span class="name">${escapeHtml(company?.name ?? symbol)}</span></button></td>`;
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
  const metrics =
    state.view === "overview" ? OVERVIEW[state.screen] : COLUMNS[state.view];
  if (!pageRows.length) {
    const columnCount = 3 + metrics.length + (state.view === "overview" ? 4 : 1);
    $("body").innerHTML = `<tr><td class="empty" colspan="${columnCount}">No companies match. Reset filters to clear search, sector and evidence filters.</td></tr>`;
    return;
  }
  $("body").innerHTML = pageRows
    .map((symbol) => {
      const idea = ranked.get(symbol);
      let cells = `<td class="rank">${idea?.rank ?? "—"}${movementChip(symbol)}</td>${companyCell(symbol)}${industryCell(symbol)}`;
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
        cells += scoreCell(idea);
      }
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
    growth: "6-month return versus QQQ (60%) and ROE (40%), after the profit and growth gates",
    undervalued: "operating income divided by equity market cap",
  }[key];
}

function inspectNote() {
  const list = screenLabel(state.screen);
  const viewLabel = VIEWS.find(([id]) => id === state.view)?.[1] ?? state.view;
  const rankedBy = rankedByPhrase(state.screen);
  if (state.view === "overview") {
    return (
      `This list is ${list}: List rank is ${rankedBy}. ` +
      `Inspect only changes which columns you see; it does not pick a different set of companies or a new rank.`
    );
  }
  if (
    state.screen === "strength" &&
    (state.view === "quality" || state.view === "revenue" || state.view === "valuation")
  ) {
    return (
      `Same ${list} names, now showing ${viewLabel.toLowerCase()}. ` +
      `List rank is still the tape, not these ratios. Loss-making leaders are expected on a price list.`
    );
  }
  return (
    `Same ${list} names, now showing ${viewLabel.toLowerCase()}. ` +
    `List rank and score are still ${rankedBy}.`
  );
}

function render() {
  const setup = state.desk.setups[state.screen];
  $("method-copy").textContent = setup.method || "Method not recorded in this snapshot.";
  $("method-version").textContent = `Method version: ${setup.version || "not recorded"}`;
  renderEvidenceControls();
  $("caption").textContent = state.desk.captions[state.screen];
  renderScreenGates();
  renderTrajectory();
  $("ranked-n").textContent = setup.results.length.toLocaleString();
  $("of-n").textContent = `of ${state.desk.universe_count.toLocaleString()} companies`;
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
  const sortLabel = { score: "Score", company: "Company", price: "Price", market_cap: "Market cap" }[state.sortKey] || currentMetrics().find(([key]) => key === state.sortKey)?.[1] || "Metric";
  const sortDirection = state.sortKey === "company"
    ? (state.sortDir === "asc" ? "A to Z" : "Z to A")
    : (state.sortDir === "desc" ? "High to low" : "Low to high");
  const rankFixed = state.sortKey === "score"
    ? `List rank is ${screenLabel(state.screen)}`
    : `Rows are reordered; List rank is still ${screenLabel(state.screen)}`;
  $("order").textContent = `Sorted by ${sortLabel} · ${sortDirection} · ${rankFixed}`;
  $("range").textContent = all.length
    ? `${start + 1}–${Math.min(start + state.pageSize, all.length)} of ${all.length.toLocaleString()} companies`
    : "0 companies";
  $("prev").disabled = state.page === 0;
  $("next").disabled = state.page >= pages - 1;
  renderHead();
  renderBody(shown);
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
    if (button) showEvidence(button.dataset.company);
  });
  $("evidence-status").addEventListener("change", (event) => {
    state.evidenceStatus = event.target.value;
    state.page = 0;
    render();
  });
  $("required-metrics").addEventListener("change", (event) => {
    state.requiredMetrics = event.target.checked;
    state.page = 0;
    render();
  });
  $("reset-filters").addEventListener("click", () => {
    state.query = "";
    state.sector = "";
    state.evidenceStatus = "default";
    state.requiredMetrics = false;
    state.page = 0;
    $("query").value = "";
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
  select.innerHTML = SCREENS.map(
    ([key, label]) => `<option value="${key}">${label}</option>`,
  ).join("");
  select.value = state.screen;
  select.addEventListener("change", () => {
    state.screen = select.value;
    state.view = "overview";
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
    $("week-chip").title = "Prices and rankings use this date. Fundamental figures use their latest available filings.";
    $("snapshot-built").textContent = `${state.desk.universe_count.toLocaleString()} liquid names${state.desk.recorded_at ? ` · Snapshot built ${day(state.desk.recorded_at)}` : ""}`;
    $("aside-week").textContent = asOf;
    if (!controlsBound) {
      bind();
      controlsBound = true;
    }
    render();
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
