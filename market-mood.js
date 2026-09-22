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

function renderIndices(indices) {
  const target = $("index-rows");
  target.replaceChildren();
  for (const [symbol, label] of [["SPY", "S&P 500"], ["QQQ", "Nasdaq-100"]]) {
    const snapshot = indices?.[symbol];
    const row = appendText(target, "div", "", "index-row");
    const name = appendText(row, "div", "", "index-name");
    appendText(name, "strong", symbol);
    appendText(name, "span", label);
    const metrics = appendText(row, "div", "", "index-metrics");
    appendText(metrics, "strong", percent(snapshot?.return_63), snapshot?.return_63 < 0 ? "negative" : "positive");
    appendText(metrics, "small", `63 sessions · ${percent(snapshot?.return_252)} over 252`);
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
    ? `Since ${day(report.previous_as_of)}: ${report.new_overlap_count} names entered the two-or-more-screen group and ${report.lost_overlap_count} left it. Net ${report.multi_count - report.previous_multi_count >= 0 ? "+" : ""}${report.multi_count - report.previous_multi_count}. Membership changes are not analyst upgrades.`
    : "No prior weekly snapshot is available for an overlap comparison.";
  renderOverlapCard(report);
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
  $("week-chip").textContent = `Data as of ${day(mood.as_of)}`;
  $("aside-week").textContent = day(mood.as_of);
  $("coverage-date").textContent = `${mood.price_history_count.toLocaleString()} complete price histories · ${mood.universe_count.toLocaleString()} liquid names`;
  $("vix-close").textContent = Number.isFinite(mood.vix?.close) ? mood.vix.close.toFixed(2) : "—";
  $("vix-week").textContent = mood.vix
    ? `${vixPoints(mood.vix.change_points_week)} since the prior Friday close`
    : "The matching Cboe Friday close is unavailable in this snapshot.";
  const share = mood.breadth?.up_63;
  $("breadth-up").textContent = Number.isFinite(share) ? `${(share * 100).toFixed(0)}%` : "—";
  $("breadth-fill").style.width = Number.isFinite(share) ? `${Math.max(0, Math.min(100, share * 100))}%` : "0%";
  $("breadth-copy").textContent = `${mood.breadth?.n_63 ?? 0} complete names · median 63-session return ${percent(mood.breadth?.median_63)}. Breadth is a snapshot of this liquid universe, not all stocks.`;
  renderIndices(mood.indices);
  renderScreenLeaders("conviction-body", mood.conviction_leaders, "score");
  renderScreenLeaders("growth-body", mood.growth_leaders);
  renderScreenLeaders("cheap-body", mood.cheap_leaders);
  renderScreenReport(mood.screen_report);
  bindOverlapControls();
  $("mood-status").hidden = true;
  $("mood-content").hidden = false;
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
