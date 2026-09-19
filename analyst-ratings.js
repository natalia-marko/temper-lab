const ANALYST_SORT_KEYS = ["company", "overlap", "strong_buy", "buy", "hold", "sell", "strong_sell", "total", "buy_share", "buy_share_delta", "friday_close", "target_median", "implied_upside", "target_range"];
const ANALYST_SORT_DEFAULT_DIR = { company: "asc" };
const ANALYST_DEFAULT_FILTERS = { query: "", minTotal: 3, category: "any", minShare: 0, sector: "", sortKey: "overlap", sortDir: "desc" };
const analystState = { mood: null, filters: { ...ANALYST_DEFAULT_FILTERS } };
const analystEl = (id) => document.getElementById(id);
const ANALYST_COLUMNS = 14;

function analystDate(iso) {
  if (!iso) return "date unavailable";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function buyShare(row) {
  if (!row?.total) return null;
  return (row.strong_buy + row.buy) / row.total;
}

function trendShare(row, period) {
  const slot = row.trend?.[period];
  if (!slot?.total) return null;
  return (slot.strong_buy + slot.buy) / slot.total;
}

function buyShareDelta(row) {
  const current = buyShare(row);
  const prior = trendShare(row, "-1m");
  if (current == null || prior == null) return null;
  return current - prior;
}

function analystSortValue(row, key) {
  if (key === "company") return row.symbol;
  if (key === "overlap") return (row.screens || []).length;
  if (key === "buy_share") return buyShare(row);
  if (key === "buy_share_delta") return buyShareDelta(row);
  if (key === "target_range") return row.target_dispersion ?? null;
  if (key === "target_median" || key === "implied_upside") return row[key] ?? null;
  return row[key] ?? null;
}

function analystCompareKey(a, b, key, direction) {
  const va = analystSortValue(a, key);
  const vb = analystSortValue(b, key);
  const aMissing = va == null || (typeof va === "number" && Number.isNaN(va));
  const bMissing = vb == null || (typeof vb === "number" && Number.isNaN(vb));
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof va === "string") return direction === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
  return direction === "asc" ? va - vb : vb - va;
}

function analystRowCompare(a, b, sortKey, sortDir) {
  const primary = analystCompareKey(a, b, sortKey, sortDir);
  if (primary !== 0) return primary;
  if (sortKey !== "buy_share") {
    const secondary = analystCompareKey(a, b, "buy_share", "desc");
    if (secondary !== 0) return secondary;
  }
  if (sortKey !== "company") return a.symbol.localeCompare(b.symbol);
  return 0;
}

function rowSector(row) {
  return sectorFor(row?.industry);
}

function analystSectorCounts(votes) {
  const rows = votes?.rows || [];
  const counts = new Map();
  for (const row of rows) {
    const key = rowSector(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function analystSectorOptions(votes) {
  const counts = analystSectorCounts(votes);
  const options = [{ value: "", label: "All sectors", count: null, disabled: false }];
  for (const [key, label] of SECTORS) {
    const count = counts.get(key) || 0;
    if (key === "unclassified" && count === 0) continue;
    options.push({ value: key, label, count, disabled: count === 0 });
  }
  return options;
}

function filteredAnalysts(votes, filters) {
  const query = filters.query.trim().toLowerCase();
  const sector = filters.sector || "";
  const sortKey = ANALYST_SORT_KEYS.includes(filters.sortKey) ? filters.sortKey : "overlap";
  const sortDir = filters.sortDir === "asc" ? "asc" : "desc";
  return (votes?.rows || [])
    .filter((row) => row.total >= filters.minTotal)
    .filter((row) => filters.category === "any" || row[filters.category] > 0)
    .filter((row) => (buyShare(row) ?? 0) >= filters.minShare)
    .filter((row) => !sector || rowSector(row) === sector)
    .filter((row) => !query || `${row.symbol} ${row.name}`.toLowerCase().includes(query))
    .sort((a, b) => analystRowCompare(a, b, sortKey, sortDir));
}

function analystText(parent, tag, content, className) {
  const child = document.createElement(tag);
  child.textContent = content;
  if (className) child.className = className;
  parent.appendChild(child);
  return child;
}

function analystCell(parent, value, format, className) {
  if (value == null || Number.isNaN(value)) {
    return analystText(parent, "td", "n/a", "analyst-na");
  }
  return analystText(parent, "td", format(value), className || "analyst-count-cell");
}

function formatShare(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDelta(value) {
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)} pp`;
}

function formatPrice(value) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function syncAnalystSortHeaders() {
  const { sortKey, sortDir } = analystState.filters;
  for (const button of document.querySelectorAll("[data-analyst-sort]")) {
    const key = button.dataset.analystSort;
    const active = key === sortKey;
    const heading = button.closest("th");
    heading.classList.toggle("sorted", active);
    if (active) heading.setAttribute("aria-sort", sortDir === "asc" ? "ascending" : "descending");
    else heading.removeAttribute("aria-sort");
    button.textContent = key === "friday_close" && analystState.mood?.as_of
      ? `Close · ${analystDate(analystState.mood.as_of)}`
      : button.dataset.label;
    if (active) {
      const mark = document.createElement("span");
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = sortDir === "asc" ? " ↑" : " ↓";
      button.appendChild(mark);
    }
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
  syncAnalystSortHeaders();
  const votes = analystState.mood?.analyst_votes;
  const target = analystEl("analyst-results");
  target.replaceChildren();
  if (!votes?.rows?.length) {
    analystEl("analyst-count").textContent = "No usable analyst summaries in this snapshot.";
    const tr = analystText(target, "tr", "");
    analystText(tr, "td", "No dated ratings are available.", "empty").colSpan = ANALYST_COLUMNS;
    return;
  }
  const rows = filteredAnalysts(votes, analystState.filters);
  const missing = votes.missing_symbols?.length || 0;
  analystEl("analyst-count").textContent = `${rows.length} of ${votes.covered_count} rated cross-screen names match these filters. ${missing} missing ${missing === 1 ? "summary is" : "summaries are"} excluded.`;
  if (!rows.length) {
    const tr = analystText(target, "tr", "");
    analystText(tr, "td", "No rated companies match. Change or reset the filters.", "empty").colSpan = ANALYST_COLUMNS;
    return;
  }
  for (const row of rows) {
    const tr = analystText(target, "tr", "");
    const company = analystText(tr, "td", "");
    analystText(company, "strong", row.symbol);
    analystText(company, "small", row.name || row.symbol);
    analystText(tr, "td", (row.screens || []).map((key) => ({ strength: "Hot Tape", growth: "Growth", undervalued: "Cheap" }[key] || key)).join(" · "), "analyst-screens");
    for (const key of ["strong_buy", "buy", "hold", "sell", "strong_sell", "total"]) analystText(tr, "td", String(row[key]), "analyst-count-cell");
    analystCell(tr, buyShare(row), formatShare);
    analystCell(tr, buyShareDelta(row), formatDelta);
    analystCell(tr, row.friday_close, formatPrice);
    analystCell(tr, row.target_median, formatPrice);
    analystCell(tr, row.implied_upside, formatShare);
    analystCell(tr, row.target_dispersion, formatShare);
  }
}

async function loadAnalystSnapshot() {
  try {
    const [moodResponse, deskResponse, releaseResponse] = await Promise.all([
      fetch("./market-mood.json", { cache: "no-store" }),
      fetch("./desk.json", { cache: "no-store" }),
      fetch("./release.json", { cache: "no-store" }),
    ]);
    if (!moodResponse.ok || !deskResponse.ok) throw new Error("The weekly analyst snapshot is unavailable.");
    const [mood, desk] = await Promise.all([moodResponse.json(), deskResponse.json()]);
    if (mood.schema !== "market-mood-1" || mood.run_id !== desk.run_id || mood.as_of !== desk.as_of || !mood.analyst_votes) {
      throw new Error("The analyst screen is awaiting the matching weekly snapshot.");
    }
    if (releaseResponse.ok) {
      const release = await releaseResponse.json();
      if (release.run_id !== mood.run_id || release.as_of !== mood.as_of) throw new Error("The analyst screen is awaiting the current release.");
    }
    const votes = mood.analyst_votes;
    if (votes.attempted_count !== mood.screen_report?.multi_count || votes.covered_count !== votes.rows?.length) {
      throw new Error("Analyst coverage does not match the cross-screen shortlist.");
    }
    analystState.mood = mood;
    populateAnalystSectorSelect(votes);
    analystEl("week-chip").textContent = `Data as of ${analystDate(mood.as_of)}`;
    analystEl("aside-week").textContent = analystDate(mood.as_of);
    analystEl("analyst-coverage").textContent = `${votes.covered_count} of ${votes.attempted_count} summaries available`;
    analystEl("analyst-dates").textContent = `Screens: ${analystDate(mood.as_of)} · Analyst counts retrieved: ${analystDate(votes.retrieved_at)}`;
    renderAnalystResults();
  } catch (error) {
    analystEl("week-chip").textContent = "Snapshot unavailable";
    analystEl("analyst-coverage").textContent = "";
    analystEl("analyst-count").textContent = error instanceof Error ? error.message : "Unable to load analyst ratings.";
    analystEl("analyst-results").replaceChildren();
  }
}

function populateAnalystSectorSelect(votes) {
  const select = analystEl("analyst-sector");
  if (!select) return;
  const options = analystSectorOptions(votes);
  const current = analystState.filters.sector;
  select.replaceChildren();
  for (const { value, label, count, disabled } of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = count == null ? label : `${label} (${count})`;
    if (disabled) option.disabled = true;
    select.appendChild(option);
  }
  const enabled = new Set(options.filter((option) => !option.disabled).map(({ value }) => value));
  select.value = enabled.has(current) ? current : "";
  analystState.filters.sector = select.value;
}

function startAnalystView() {
  for (const [id, key, event] of [
    ["analyst-query", "query", "input"], ["analyst-min-total", "minTotal", "change"],
    ["analyst-category", "category", "change"], ["analyst-min-share", "minShare", "change"],
    ["analyst-sector", "sector", "change"],
  ]) analystEl(id).addEventListener(event, (change) => {
    analystState.filters[key] = ["minTotal", "minShare"].includes(key) ? Number(change.target.value) : change.target.value;
    renderAnalystResults();
  });
  analystEl("analyst-reset").addEventListener("click", () => {
    analystState.filters = { ...ANALYST_DEFAULT_FILTERS };
    for (const [id, value] of [["analyst-query", ""], ["analyst-min-total", "3"], ["analyst-category", "any"], ["analyst-min-share", "0"], ["analyst-sector", ""]]) analystEl(id).value = value;
    renderAnalystResults();
  });
  document.querySelector(".analyst-table-wrap thead").addEventListener("click", (event) => {
    const button = event.target.closest("[data-analyst-sort]");
    if (!button) return;
    toggleAnalystSort(button.dataset.analystSort);
    button.focus();
  });
  syncAnalystSortHeaders();
  void loadAnalystSnapshot();
}

startAnalystView();
