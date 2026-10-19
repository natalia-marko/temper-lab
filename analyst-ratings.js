const ANALYST_SORT_KEYS = ["company", "overlap", "total", "strong_buy", "buy", "hold", "sell", "strong_sell", "buy_share", "buy_share_delta", "eps_revisions", "friday_close", "target_median", "implied_upside", "target_range"];
const ANALYST_SORT_DEFAULT_DIR = { company: "asc" };
const ANALYST_DEFAULT_FILTERS = { query: "", minTotal: 3, category: "any", minShare: 0, sector: "", overlap: "all", sortKey: "overlap", sortDir: "desc" };
const analystState = { mood: null, desk: null, filters: { ...ANALYST_DEFAULT_FILTERS } };
const analystEl = (id) => document.getElementById(id);
const ANALYST_COLUMNS = 8;

const ANALYST_OVERLAP_GROUPS = [
  ["all", "All cross-screen"],
  ["triple", "All 3 screens"],
  ["strength_growth", "Hot Tape · Growth"],
  ["growth_undervalued", "Growth · Cheap"],
  ["strength_undervalued", "Hot Tape · Cheap"],
];
const ANALYST_SCREEN_LABELS = { strength: "Hot Tape", growth: "Growth", undervalued: "Cheap" };
const ANALYST_MIX_SEGMENTS = [
  ["strong_buy", "sb", "Strong Buy"],
  ["buy", "buy", "Buy"],
  ["hold", "hold", "Hold"],
  ["sell", "sell", "Sell"],
  ["strong_sell", "ss", "Strong Sell"],
];

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

function analystOverlapKey(row) {
  const screens = new Set(row?.screens || []);
  if (screens.size === 3) return "triple";
  if (screens.has("strength") && screens.has("growth") && !screens.has("undervalued")) return "strength_growth";
  if (screens.has("growth") && screens.has("undervalued") && !screens.has("strength")) return "growth_undervalued";
  if (screens.has("strength") && screens.has("undervalued") && !screens.has("growth")) return "strength_undervalued";
  return null;
}

function analystOverlapCounts(votes) {
  const rows = votes?.rows || [];
  const counts = { all: rows.length, triple: 0, strength_growth: 0, growth_undervalued: 0, strength_undervalued: 0 };
  for (const row of rows) {
    const key = analystOverlapKey(row);
    if (key && key in counts) counts[key] += 1;
  }
  return counts;
}

function rowEpsRevisions(row, desk = analystState.desk) {
  const factors = desk?.companies?.[row?.symbol]?.factors;
  const rawUp = row?.up_last_30_days ?? factors?.up_last_30_days;
  const rawDown = row?.down_last_30_days ?? factors?.down_last_30_days;
  const up = typeof rawUp === "number" && Number.isFinite(rawUp) && rawUp >= 0 ? rawUp : null;
  const down = typeof rawDown === "number" && Number.isFinite(rawDown) && rawDown >= 0 ? rawDown : null;
  if (up == null || down == null) return null;
  const total = up + down;
  const breadth = total > 0 ? (up - down) / total : 0;
  return { up, down, total, net: up - down, breadth };
}

function analystSortValue(row, key, desk = analystState.desk) {
  if (key === "company") return row.symbol;
  if (key === "overlap") return (row.screens || []).length;
  if (key === "buy_share") return buyShare(row);
  if (key === "buy_share_delta") return buyShareDelta(row);
  if (key === "eps_revisions") {
    const rev = rowEpsRevisions(row, desk);
    return rev ? rev.breadth : null;
  }
  if (key === "target_range") return row.target_dispersion ?? null;
  if (key === "target_median" || key === "implied_upside") return row[key] ?? null;
  return row[key] ?? null;
}

function analystCompareKey(a, b, key, direction, desk = analystState.desk) {
  const va = analystSortValue(a, key, desk);
  const vb = analystSortValue(b, key, desk);
  const aMissing = va == null || (typeof va === "number" && Number.isNaN(va));
  const bMissing = vb == null || (typeof vb === "number" && Number.isNaN(vb));
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof va === "string") return direction === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
  const diff = direction === "asc" ? va - vb : vb - va;
  if (diff !== 0) return diff;
  if (key === "eps_revisions") {
    const na = rowEpsRevisions(a, desk)?.net ?? 0;
    const nb = rowEpsRevisions(b, desk)?.net ?? 0;
    return direction === "asc" ? na - nb : nb - na;
  }
  return 0;
}

function analystRowCompare(a, b, sortKey, sortDir, desk = analystState.desk) {
  const primary = analystCompareKey(a, b, sortKey, sortDir, desk);
  if (primary !== 0) return primary;
  if (sortKey !== "buy_share") {
    const secondary = analystCompareKey(a, b, "buy_share", "desc", desk);
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

function filteredAnalysts(votes, filters, desk = analystState.desk) {
  const query = (filters.query || "").trim().toLowerCase();
  const sector = filters.sector || "";
  const overlap = filters.overlap || "all";
  const sortKey = ANALYST_SORT_KEYS.includes(filters.sortKey) ? filters.sortKey : "overlap";
  const sortDir = filters.sortDir === "asc" ? "asc" : "desc";
  return (votes?.rows || [])
    .filter((row) => overlap === "all" || analystOverlapKey(row) === overlap)
    .filter((row) => row.total >= filters.minTotal)
    .filter((row) => filters.category === "any" || row[filters.category] > 0)
    .filter((row) => (buyShare(row) ?? 0) >= filters.minShare)
    .filter((row) => !sector || rowSector(row) === sector)
    .filter((row) => !query || `${row.symbol} ${row.name}`.toLowerCase().includes(query))
    .sort((a, b) => analystRowCompare(a, b, sortKey, sortDir, desk));
}

function analystText(parent, tag, content, className) {
  const child = document.createElement(tag);
  child.textContent = content;
  if (className) child.className = className;
  parent.appendChild(child);
  return child;
}

function formatShare(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedShare(value) {
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function formatDelta(value) {
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)} pp`;
}

function formatPrice(value) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function syncAnalystSortHeaders() {
  const { sortKey, sortDir } = analystState.filters;
  const buttons = [...document.querySelectorAll("[data-analyst-sort]")];
  const activeHeadings = new Set();
  for (const button of buttons) {
    const key = button.dataset.analystSort;
    const active = key === sortKey;
    const heading = button.closest("th");
    button.classList.toggle("sorted-btn", active);
    if (active && heading) activeHeadings.add(heading);
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
  for (const button of buttons) {
    const heading = button.closest("th");
    if (!heading) continue;
    const isSorted = activeHeadings.has(heading);
    heading.classList.toggle("sorted", isSorted);
    if (isSorted) heading.setAttribute("aria-sort", sortDir === "asc" ? "ascending" : "descending");
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

function renderMixCell(tr, row) {
  const td = analystText(tr, "td", "", "analyst-mix-cell");
  const bar = analystText(td, "div", "", "analyst-mix-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute(
    "aria-label",
    `${row.strong_buy} Strong Buy, ${row.buy} Buy, ${row.hold} Hold, ${row.sell} Sell, ${row.strong_sell} Strong Sell of ${row.total} ratings`,
  );
  for (const [key, cls, label] of ANALYST_MIX_SEGMENTS) {
    const count = row[key] || 0;
    if (count <= 0) continue;
    const seg = analystText(bar, "i", "", `mix-seg ${cls}`);
    seg.setAttribute("style", `flex:${count}`);
    seg.setAttribute("title", `${label}: ${count}`);
  }
  const counts = analystText(td, "div", "", "analyst-mix-counts");
  analystText(counts, "span", `${row.strong_buy} · ${row.buy} · ${row.hold} · ${row.sell} · ${row.strong_sell}`);
  analystText(counts, "strong", `(${row.total})`);
}

function renderShareCell(tr, row) {
  const share = buyShare(row);
  if (share == null || Number.isNaN(share)) {
    analystText(tr, "td", "n/a", "analyst-na");
    return;
  }
  const td = analystText(tr, "td", "", "analyst-count-cell analyst-stack-cell");
  analystText(td, "strong", formatShare(share));
  analystText(td, "small", `${(row.strong_buy || 0) + (row.buy || 0)} of ${row.total}`);
}

function renderDeltaCell(tr, row) {
  const delta = buyShareDelta(row);
  if (delta == null || Number.isNaN(delta)) {
    analystText(tr, "td", "n/a", "analyst-na");
    return;
  }
  const td = analystText(tr, "td", "", "analyst-count-cell analyst-stack-cell");
  const tone = delta > 1e-9 ? "delta-up" : delta < -1e-9 ? "delta-down" : "delta-flat";
  analystText(td, "strong", formatDelta(delta), tone);
  const priorTotal = row.trend?.["-1m"]?.total;
  if (typeof priorTotal === "number" && Number.isFinite(priorTotal)) {
    if (priorTotal !== row.total) {
      const note = analystText(td, "small", `n: ${priorTotal} → ${row.total}`, "coverage-shift");
      note.setAttribute("title", "Total analyst coverage changed from last month");
    } else {
      analystText(td, "small", `n = ${row.total}`);
    }
  }
}

function renderEpsCell(tr, row) {
  const rev = rowEpsRevisions(row);
  if (!rev) {
    analystText(tr, "td", "n/a", "analyst-na");
    return;
  }
  const td = analystText(tr, "td", "", "analyst-count-cell analyst-eps-cell");
  analystText(td, "strong", `${rev.up} up · ${rev.down} down`);
  const bar = analystText(td, "div", "", "analyst-rev-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", `${rev.up} upward and ${rev.down} downward EPS revisions in 30 days`);
  if (rev.total > 0) {
    if (rev.up > 0) {
      const upSeg = analystText(bar, "i", "", "up");
      upSeg.setAttribute("style", `flex:${rev.up}`);
    }
    if (rev.down > 0) {
      const downSeg = analystText(bar, "i", "", "down");
      downSeg.setAttribute("style", `flex:${rev.down}`);
    }
  } else {
    const flatSeg = analystText(bar, "i", "", "flat");
    flatSeg.setAttribute("style", "flex:1");
  }
}

function renderTargetCell(tr, row) {
  const close = typeof row.friday_close === "number" && Number.isFinite(row.friday_close) ? row.friday_close : null;
  const median = typeof row.target_median === "number" && Number.isFinite(row.target_median) ? row.target_median : null;
  const low = typeof row.target_low === "number" && Number.isFinite(row.target_low) ? row.target_low : null;
  const high = typeof row.target_high === "number" && Number.isFinite(row.target_high) ? row.target_high : null;
  if (close == null && median == null) {
    analystText(tr, "td", "n/a", "analyst-na");
    return;
  }
  const td = analystText(tr, "td", "", "analyst-count-cell analyst-target-cell");
  const top = analystText(td, "div", "", "analyst-target-top");
  const closeWrap = analystText(top, "span", "Close ", "target-pair");
  analystText(closeWrap, "strong", close != null ? formatPrice(close) : "n/a", "target-close-val");
  analystText(top, "span", " · ", "target-sep");
  const medWrap = analystText(top, "span", "Med ", "target-pair");
  analystText(medWrap, "strong", median != null ? formatPrice(median) : "n/a", "target-med-val");
  if (close != null && low != null && high != null && high >= low) {
    if (close < low) {
      const flag = analystText(top, "span", "Below low", "target-flag below");
      flag.setAttribute("title", `Frozen Friday close (${formatPrice(close)}) is below the lowest analyst target (${formatPrice(low)})`);
    } else if (close > high) {
      const flag = analystText(top, "span", "Above high", "target-flag above");
      flag.setAttribute("title", `Frozen Friday close (${formatPrice(close)}) is above the highest analyst target (${formatPrice(high)})`);
    }
  }
  if (low != null && high != null && high >= low) {
    const points = [low, high];
    if (close != null) points.push(close);
    if (median != null) points.push(median);
    const lo = Math.min(...points);
    const hi = Math.max(...points);
    const span = hi - lo || 1;
    const pct = (v) => `${Math.max(0, Math.min(100, ((v - lo) / span) * 100)).toFixed(1)}%`;
    const gauge = analystText(td, "div", "", "analyst-target-gauge");
    analystText(gauge, "small", formatPrice(low), "gauge-end");
    const track = analystText(gauge, "div", "", "gauge-track");
    track.setAttribute("role", "img");
    track.setAttribute("aria-label", `Target low ${formatPrice(low)}, high ${formatPrice(high)}`);
    const band = analystText(track, "i", "", "gauge-band");
    const leftPct = Math.max(0, Math.min(100, ((low - lo) / span) * 100));
    const widthPct = Math.max(2, Math.min(100 - leftPct, ((high - low) / span) * 100));
    band.setAttribute("style", `left:${leftPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%`);
    if (median != null) {
      const medMark = analystText(track, "i", "", "gauge-mark med");
      medMark.setAttribute("style", `left:${pct(median)}`);
      medMark.setAttribute("title", `Median target: ${formatPrice(median)}`);
    }
    if (close != null) {
      const closeMark = analystText(track, "i", "", "gauge-mark close");
      closeMark.setAttribute("style", `left:${pct(close)}`);
      closeMark.setAttribute("title", `Reference close: ${formatPrice(close)}`);
    }
    analystText(gauge, "small", formatPrice(high), "gauge-end");
  }
}

function renderUpsideCell(tr, row) {
  const upside = typeof row.implied_upside === "number" && Number.isFinite(row.implied_upside) ? row.implied_upside : null;
  const disp = typeof row.target_dispersion === "number" && Number.isFinite(row.target_dispersion) ? row.target_dispersion : null;
  if (upside == null && disp == null) {
    analystText(tr, "td", "n/a", "analyst-na");
    return;
  }
  const td = analystText(tr, "td", "", "analyst-count-cell analyst-stack-cell");
  const tone = upside == null ? "" : upside > 1e-9 ? "upside-pos" : upside < -1e-9 ? "upside-neg" : "";
  analystText(td, "strong", upside != null ? formatSignedShare(upside) : "n/a", tone);
  analystText(td, "small", disp != null ? `Range ${formatShare(disp)}` : "Range n/a");
}

function renderAnalystResults() {
  syncAnalystSortHeaders();
  syncAnalystOverlapPills();
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
    const company = analystText(tr, "td", "", "analyst-company-cell");
    if (globalThis.TLWatch) company.appendChild(Object.assign(globalThis.TLWatch.button(row.symbol, row.name), { className: "tl-star lead" }));
    const link = analystText(company, "a", row.symbol, "analyst-symbol-link");
    link.setAttribute("href", `./ticker.html?t=${encodeURIComponent(row.symbol)}`);
    analystText(company, "small", row.name || row.symbol);

    const screensTd = analystText(tr, "td", "", "analyst-screens");
    const chips = analystText(screensTd, "div", "", "chips analyst-screen-chips");
    for (const key of row.screens || []) {
      analystText(chips, "span", ANALYST_SCREEN_LABELS[key] || key, `chip chip-${key}`);
    }

    renderMixCell(tr, row);
    renderShareCell(tr, row);
    renderDeltaCell(tr, row);
    renderEpsCell(tr, row);
    renderTargetCell(tr, row);
    renderUpsideCell(tr, row);
  }
}

function populateAnalystOverlapPills(votes) {
  const container = analystEl("analyst-overlap-pills");
  if (!container) return;
  const counts = analystOverlapCounts(votes);
  container.replaceChildren();
  for (const [key, label] of ANALYST_OVERLAP_GROUPS) {
    const count = counts[key] || 0;
    const btn = analystText(container, "button", `${label} (${count})`, "overlap-chip");
    btn.type = "button";
    btn.dataset.overlapKey = key;
    if (key !== "all" && count === 0) btn.disabled = true;
    btn.addEventListener("click", () => {
      analystState.filters.overlap = key;
      renderAnalystResults();
    });
  }
  syncAnalystOverlapPills();
}

function syncAnalystOverlapPills() {
  const container = analystEl("analyst-overlap-pills");
  if (!container?.children) return;
  const current = analystState.filters.overlap || "all";
  for (const btn of container.children) {
    const active = btn.dataset?.overlapKey === current;
    btn.classList?.toggle("on", active);
    btn.setAttribute?.("aria-pressed", active ? "true" : "false");
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
    analystState.desk = desk;
    populateAnalystOverlapPills(votes);
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
