const analystState = { mood: null, filters: { query: "", minTotal: 3, category: "any", minShare: 0, order: "company" } };
const analystEl = (id) => document.getElementById(id);
const ANALYST_COLUMNS = 13;

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

function filteredAnalysts(votes, filters) {
  const query = filters.query.trim().toLowerCase();
  return (votes?.rows || [])
    .filter((row) => row.total >= filters.minTotal)
    .filter((row) => filters.category === "any" || row[filters.category] > 0)
    .filter((row) => buyShare(row) >= filters.minShare)
    .filter((row) => !query || `${row.symbol} ${row.name}`.toLowerCase().includes(query))
    .sort((a, b) => {
      if (filters.order === "share") return buyShare(b) - buyShare(a) || b.total - a.total || a.symbol.localeCompare(b.symbol);
      if (filters.order === "strong_buy") return b.strong_buy - a.strong_buy || b.total - a.total || a.symbol.localeCompare(b.symbol);
      if (filters.order === "coverage") return b.total - a.total || a.symbol.localeCompare(b.symbol);
      if (filters.order === "delta") {
        const deltaA = buyShareDelta(a);
        const deltaB = buyShareDelta(b);
        if (deltaA == null && deltaB == null) return a.symbol.localeCompare(b.symbol);
        if (deltaA == null) return 1;
        if (deltaB == null) return -1;
        return deltaB - deltaA || b.total - a.total || a.symbol.localeCompare(b.symbol);
      }
      return a.symbol.localeCompare(b.symbol);
    });
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

function renderAnalystResults() {
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

function startAnalystView() {
  for (const [id, key, event] of [
    ["analyst-query", "query", "input"], ["analyst-min-total", "minTotal", "change"],
    ["analyst-category", "category", "change"], ["analyst-min-share", "minShare", "change"],
    ["analyst-order", "order", "change"],
  ]) analystEl(id).addEventListener(event, (change) => {
    analystState.filters[key] = ["minTotal", "minShare"].includes(key) ? Number(change.target.value) : change.target.value;
    renderAnalystResults();
  });
  analystEl("analyst-reset").addEventListener("click", () => {
    analystState.filters = { query: "", minTotal: 3, category: "any", minShare: 0, order: "company" };
    for (const [id, value] of [["analyst-query", ""], ["analyst-min-total", "3"], ["analyst-category", "any"], ["analyst-min-share", "0"], ["analyst-order", "company"]]) analystEl(id).value = value;
    renderAnalystResults();
  });
  void loadAnalystSnapshot();
}

startAnalystView();
