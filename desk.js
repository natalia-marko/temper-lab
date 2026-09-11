const SCREENS = [
  ["strength", "Strength"],
  ["growth", "Growth"],
  ["undervalued", "Cheap on operating profit"],
];
const VIEWS = [
  ["overview", "Overview"],
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
const state = {
  desk: null,
  screen: "strength",
  view: "overview",
  query: "",
  industry: "",
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

function rankedMap(key) {
  return new Map((state.desk.setups[key].results || []).map((row) => [row.symbol, row]));
}
function factor(symbol, key) {
  return state.desk.companies[symbol]?.factors?.[key];
}

function industryKey(company) {
  return company?.industry?.trim() || "__unclassified";
}

function scopeRows() {
  const ranked = rankedMap(state.screen);
  const needle = state.query.trim().toLowerCase();
  return Object.keys(state.desk.companies).filter((symbol) => {
    const company = state.desk.companies[symbol];
    const hay = `${symbol} ${company?.name ?? ""} ${company?.industry ?? ""}`.toLowerCase();
    return (!state.thisScreen || ranked.has(symbol)) && (!needle || hay.includes(needle));
  });
}

function rows() {
  const ranked = rankedMap(state.screen);
  return scopeRows()
    .filter((symbol) => !state.industry || industryKey(state.desk.companies[symbol]) === state.industry)
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

function hasRequiredMetrics(symbol) {
  return currentMetrics().every(([key]) => Number.isFinite(factor(symbol, key)));
}

function evidenceScope() {
  return scopeRows().filter((symbol) => !state.industry || industryKey(state.desk.companies[symbol]) === state.industry);
}

function renderEvidenceControls() {
  const base = evidenceScope();
  const accepted = base.filter(passesEvidence);
  const available = accepted.filter(hasRequiredMetrics).length;
  const cash = accepted.filter((symbol) => Number.isFinite(factor(symbol, "cash_conversion"))).length;
  const defaultNote = state.evidenceStatus === "default"
    ? priceOnlyView() ? "Price view includes all statement statuses." : "Fundamental view excludes broken statements by default."
    : "Evidence status is explicitly filtered.";
  $("coverage-note").textContent = `${defaultNote} Evidence status removes ${base.length - accepted.length} of ${base.length} names. Required metrics: ${currentMetrics().map(([, label]) => label).join(", ")}. Available for ${available} of ${accepted.length} remaining names; ${state.requiredMetrics ? "filter removes" : "enabling the filter would remove"} ${accepted.length - available}. Cash conversion available for ${cash} of ${accepted.length}. Availability means a finite value, not verified comparability.`;
  $("evidence-status").value = state.evidenceStatus;
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
  $("evidence-content").innerHTML = `<p><strong>${trustLabel(trustStatus(symbol))}</strong>. This statement status does not certify coverage, freshness, or valuation.</p>
    ${reasons.length ? `<ul>${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : "<p>No specific issue recorded.</p>"}
    <dl>${dates.map(([label, value]) => `<dt>${label}</dt><dd>${value ? escapeHtml(day(value)) : "Not recorded in this snapshot"}</dd>`).join("")}</dl>
    <p>Filing dates are calendar dates, not exact publication timestamps. The quality filing date is not a separate fiscal period or filing date for every ratio component. Original accessions and share-count reconciliation are not included in this public snapshot.</p>
    <h3>Metrics in this view</h3><dl>${currentMetrics().map(([key, label, kind]) => `<dt>${label}</dt><dd>${Number.isFinite(factor(symbol, key)) ? fmt(factor(symbol, key), kind) : "Unavailable"}</dd>`).join("")}</dl>
    <h3>Published screen membership</h3><ul>${SCREENS.map(([key, label]) => {
      const row = rankedMap(key).get(symbol);
      return `<li>${label}: ${row ? `original rank ${row.rank}, score ${row.score.toFixed(1)}` : "Outside the published list; a missing input, failed gate, or shortlist cutoff may apply. Individual exclusion reasons are not exported."}</li>`;
    }).join("")}</ul>`;
  $("company-evidence").showModal();
}

function growthChips(symbol) {
  // Labels come from desk.json's setups.growth.gates, which is generated
  // straight from the screen's real gate definitions in
  // research_engine/features/build_lake_ideas.py (GROWTH_GATE_LABELS), not
  // hardcoded here. A company only appears in the Growth list at all once it
  // has passed every one of those gates, so every visible row shows them all
  // as met - there is no "some gates, not others" state to render.
  const labels = state.desk.setups?.growth?.gates || [];
  if (rankedMap("growth").has(symbol)) {
    return labels.map((label) => [label, true]);
  }
  return [["Not on Growth", false]];
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
  let html = `<tr><th class="rank">Rank</th>${sortHeader("company", "Company")}<th scope="col" class="industry-column"><label for="industry">Industry</label><select id="industry" aria-label="Filter by industry" title="Filter this column; original ranks and scores stay fixed."></select></th>`;
  if (state.view === "overview") {
    if (state.screen === "growth") html += `<th>Gates</th>`;
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

function companyCell(symbol) {
  const company = state.desk.companies[symbol];
  const status = trustStatus(symbol);
  const chip =
    status !== "complete"
      ? `<span class="trust ${status}">${trustLabel(status)}</span>`
      : "";
  return `<td><button type="button" class="company-button" data-company="${escapeHtml(symbol)}" aria-label="Inspect evidence for ${escapeHtml(symbol)}"><span class="ticker">${escapeHtml(symbol)}${chip}</span><span class="name">${escapeHtml(company?.name ?? symbol)}</span></button></td>`;
}

function industryCell(symbol) {
  const industry = state.desk.companies[symbol]?.industry?.trim() || "Industry unavailable";
  return `<td class="industry-column"><span class="industry" title="${escapeHtml(industry)}">${escapeHtml(industry)}</span></td>`;
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
    const columnCount = 3 + metrics.length + (state.view === "overview" ? 4 + (state.screen === "growth" ? 1 : 0) : 1);
    $("body").innerHTML = `<tr><td class="empty" colspan="${columnCount}">No companies match. Reset filters to clear search, industry and evidence filters.</td></tr>`;
    return;
  }
  $("body").innerHTML = pageRows
    .map((symbol) => {
      const idea = ranked.get(symbol);
      let cells = `<td class="rank">${idea?.rank ?? "—"}</td>${companyCell(symbol)}${industryCell(symbol)}`;
      if (state.view === "overview") {
        if (state.screen === "growth") {
          cells += `<td><span class="chips">${growthChips(symbol)
            .map(([label, ok]) => `<span class="chip${ok ? "" : " out"}">${label}</span>`)
            .join("")}</span></td>`;
        }
        for (const [key, , kind] of metrics) {
          cells += `<td class="metric">${fmt(factor(symbol, key), kind)}</td>`;
        }
        cells += `<td class="score">${idea ? idea.score.toFixed(1) : "—"}</td>`;
        cells += `<td><span class="chips">${alsoOn(symbol)
          .map((label) => `<span class="chip also">${label}</span>`)
          .join("")}</span></td>`;
        cells += `<td>${price(state.desk.companies[symbol]?.price)}</td>`;
        cells += `<td>${money(state.desk.companies[symbol]?.market_cap)}</td>`;
      } else {
        for (const [key, , kind] of metrics) {
          cells += `<td class="metric">${fmt(factor(symbol, key), kind)}</td>`;
        }
        cells += `<td class="score">${idea ? idea.score.toFixed(1) : "—"}</td>`;
      }
      return `<tr>${cells}</tr>`;
    })
    .join("");
}

function screenLabel(key) {
  return SCREENS.find(([id]) => id === key)?.[1] ?? key;
}

function render() {
  const setup = state.desk.setups[state.screen];
  $("method-copy").textContent = setup.method || "Method not recorded in this snapshot.";
  $("method-version").textContent = `Method version: ${setup.version || "not recorded"}`;
  renderEvidenceControls();
  $("caption").textContent = state.desk.captions[state.screen];
  $("ranked-n").textContent = setup.results.length.toLocaleString();
  $("of-n").textContent = `of ${state.desk.universe_count.toLocaleString()} companies`;
  $("this-screen").classList.toggle("on", state.thisScreen);
  $("all-liquid").classList.toggle("on", !state.thisScreen);
  for (const button of document.querySelectorAll("#tabs button")) {
    button.classList.toggle("on", button.dataset.view === state.view);
  }
  const note = $("column-note");
  if (state.view === "overview") {
    note.hidden = true;
  } else {
    note.hidden = false;
    const viewLabel = VIEWS.find(([id]) => id === state.view)?.[1] ?? state.view;
    note.textContent = `Inspecting ${viewLabel.toLowerCase()} numbers. Rank and score are still ${screenLabel(state.screen)}.`;
  }
  const all = rows();
  const pages = Math.max(1, Math.ceil(all.length / state.pageSize));
  state.page = Math.min(state.page, pages - 1);
  const start = state.page * state.pageSize;
  const shown = all.slice(start, start + state.pageSize);
  const sortLabel = { score: "Score", company: "Company", price: "Price", market_cap: "Market cap" }[state.sortKey] || currentMetrics().find(([key]) => key === state.sortKey)?.[1] || "Metric";
  $("order").textContent = `Sorted by ${sortLabel} · ${state.sortKey === "company" ? (state.sortDir === "asc" ? "A to Z" : "Z to A") : (state.sortDir === "desc" ? "High to low" : "Low to high")} · Original ranks and scores stay fixed under all filters`;
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
    const industry = industryKey(state.desk.companies[symbol]);
    counts.set(industry, (counts.get(industry) || 0) + 1);
  }
  const industries = [...new Set(Object.values(state.desk.companies).map(industryKey))]
    .sort((a, b) => a === "__unclassified" ? 1 : b === "__unclassified" ? -1 : a.localeCompare(b));
  $("industry").innerHTML = '<option value="">All industries</option>' + industries.map((industry) => {
    const label = industry === "__unclassified" ? "Industry unavailable" : industry;
    const count = counts.get(industry) || 0;
    return `<option value="${escapeHtml(industry)}"${count ? "" : " disabled"}>${escapeHtml(label)} (${count})</option>`;
  }).join("");
  $("industry").value = state.industry;
  $("industry").classList.toggle("active", Boolean(state.industry));
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
    state.industry = "";
    state.evidenceStatus = "default";
    state.requiredMetrics = false;
    state.page = 0;
    $("query").value = "";
    render();
  });
  // The column heading is rebuilt on sorting, paging and screen changes.
  $("head").addEventListener("change", (event) => {
    if (event.target.id !== "industry") return;
    state.industry = event.target.value;
    state.page = 0;
    render();
    $("industry").focus();
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
