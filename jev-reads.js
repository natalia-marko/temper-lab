// Jev reads: one published week of earnings releases read by Jev (AI), with the track record.
// Data: jev-reads.json (index) and jev-reads/<Friday>.json (one frozen file per week), built by
// `python -m jev.public_page`. Every value is written with textContent; links go to sec.gov only.

const INDEX_SCHEMA = "jev-reads-index-1";
const WEEK_SCHEMA = "jev-reads-week-1";
const GUIDANCE_ORDER = ["raised", "unchanged", "lowered", "provided_without_comparison", "not_provided", "unclear"];
const GUIDANCE_LABEL = {
  raised: "Raised",
  unchanged: "Unchanged or reaffirmed",
  lowered: "Lowered",
  provided_without_comparison: "Given, but nothing comparable before",
  not_provided: "Withheld or withdrawn",
  unclear: "Unclear or no guidance",
};
const SETUP_LABEL = {
  asymmetric_growth_catalyst: "growth catalyst",
  deteriorating_operations: "deteriorating operations",
  mixed_operating_signals: "mixed signals",
  stable_value_drift: "stable, no catalyst",
  unclear: "unclear",
};
const TIER_LABEL = {
  A: "Raised guidance and a growth setup",
  B: "Raised guidance",
  C: "Growth setup",
};
const QUOTE_LABEL = {
  guidance: "Guidance passage Jev read",
  results: "Results passage (the release has no guidance section)",
  opening: "Opening of the release (no guidance or results section found)",
};

const jevState = { index: null, release: null, week: null, filters: { query: "", floorOnly: false } };

function signedPct(fraction, digits = 1) {
  if (fraction == null || Number.isNaN(Number(fraction))) return "n/a";
  const value = Number(fraction) * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function signedPp(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "n/a";
  return `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(digits)}`;
}

function guidanceLabel(choice) {
  return GUIDANCE_LABEL[choice] || "No answer";
}

function setupLabel(choice) {
  return SETUP_LABEL[choice] || "no answer";
}

function secUrl(url) {
  return typeof url === "string" && url.startsWith("https://www.sec.gov/") ? url : null;
}

function reactionText(release, late) {
  const reaction = release.reaction || {};
  if (reaction.status === "ready") return `3-day reaction vs SPY ${signedPct(reaction.excess_return_3d)}`;
  const filled = late && late[release.event_id];
  if (filled) return `3-day reaction vs SPY ${signedPct(filled.excess_return_3d)} (completed after this week was published)`;
  return "3-day reaction: not complete when published (filed late in the week)";
}

function answersText(release) {
  const jev = release.jev || {};
  const bits = [
    `Guidance: ${guidanceLabel(jev.guidance)}${jev.guidance_confidence == null ? "" : ` (confidence ${Number(jev.guidance_confidence).toFixed(2)})`}`,
    `Operations: ${setupLabel(jev.setup)}${jev.setup_confidence == null ? "" : ` (confidence ${Number(jev.setup_confidence).toFixed(2)})`}`,
  ];
  if (jev.product_score != null) bits.push(`Product: ${Number(jev.product_score).toFixed(1)} of 3`);
  return `Jev (AI) · ${bits.join(" · ")}`;
}

function floorText(release) {
  if (release.floor) return "Passes the floor";
  return `Fails the floor: ${(release.floor_reasons || []).join("; ")}`;
}

function shortListOf(releases) {
  return (releases || []).filter((r) => r.short_list_position)
    .slice().sort((a, b) => a.short_list_position - b.short_list_position);
}

function matchesQuery(release, query) {
  if (!query) return true;
  const ticker = String(release.ticker || "").toLowerCase();
  if (ticker.startsWith(query)) return true;
  const words = String(release.company || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  return words.some((word) => word.startsWith(query));
}

function filterReleases(releases, filters) {
  const query = String((filters && filters.query) || "").trim().toLowerCase();
  return (releases || []).filter((r) => (!filters || !filters.floorOnly || r.floor) && matchesQuery(r, query));
}

function groupByGuidance(releases) {
  const groups = GUIDANCE_ORDER.map((key) => [key, (releases || []).filter((r) => (r.jev || {}).guidance === key)]);
  const known = new Set(GUIDANCE_ORDER);
  const other = (releases || []).filter((r) => !known.has((r.jev || {}).guidance));
  if (other.length) groups.push(["other", other]);
  return groups.filter(([, rows]) => rows.length);
}

function weekBanner(week, release, latest) {
  if (!week) return null;
  if (latest && week.as_of !== latest) return `Archived week ending ${week.as_of}. The latest published week ends ${latest}.`;
  if (release && release.as_of && week.as_of < release.as_of) {
    return `These reads are for the week ending ${week.as_of}. The screener snapshot is newer (${release.as_of}); that week's reads are not published yet.`;
  }
  return null;
}

function evidenceSentences(record) {
  if (!record) return [];
  const up = record.reaction_after_raised || {};
  const down = record.reaction_after_lowered || {};
  const six = record.raised_minus_rest_6m || {};
  const twelve = record.raised_minus_rest_12m || {};
  const split = record.market_disagreed_minus_agreed_6m || {};
  const range = (ci) => (ci ? `${signedPp(ci[0])} to ${signedPp(ci[1])}` : "n/a");
  return [
    `Past test: ${record.releases} earnings releases from ${record.period}, read by Jev with the same questions.`,
    `On average the market agreed with Jev's guidance read over the first three days: ${signedPp(up.mean_pct)}% after "raised" (${Math.round(100 * (up.share_up || 0))}% of them rose), ${signedPp(down.mean_pct)}% after "lowered". Many single cases went the other way.`,
    `After those three days, "raised" showed no advantage over the other releases: ${signedPp(six.difference_pp)} percentage points over 6 months (95% interval ${range(six.ci_pp)}) and ${signedPp(twelve.difference_pp)} over 12 months (${range(twelve.ci_pp)}). The test could only detect differences larger than about ${Number(six.detectable_pp).toFixed(1)} points at 6 months and ${Number(twelve.detectable_pp).toFixed(1)} at 12 months.`,
    `Releases where the market fell despite a "raised" read showed no clear difference afterwards: ${signedPp(split.difference_pp)} points over 6 months (${range(split.ci_pp)}).`,
    record.note || "",
  ].filter(Boolean);
}

function trackingRows(index) {
  const horizons = ["3m", "6m", "12m"];
  return (index.tracking || []).map((row) => ({
    week: row.week,
    group: row.group,
    releases: row.releases,
    values: horizons.map((h) => row[`mean_excess_vs_universe_${h}`]),
  }));
}

// ---------------------------------------------------------------- DOM

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function link(url, text) {
  const safe = secUrl(url);
  if (!safe) return null;
  const node = el("a", "jev-link", text);
  node.href = safe;
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
}

function quoteBlock(release) {
  const box = el("div", "jev-quotes");
  const quote = release.quote || {};
  box.appendChild(el("p", "jev-quote-label", `${QUOTE_LABEL[quote.section] || "Passage"} (verbatim${quote.truncated ? ", shortened" : ""})`));
  box.appendChild(el("blockquote", "jev-quote", quote.text || "No text could be extracted."));
  const current = link(quote.source, "This release on SEC.gov");
  if (current) box.appendChild(current);
  const previous = release.previous || {};
  const label = previous.published_at ? `Previous release, ${previous.published_at}` : "Previous release";
  if (previous.text) {
    box.appendChild(el("p", "jev-quote-label", `${label}: guidance passage (verbatim${previous.truncated ? ", shortened" : ""})`));
    box.appendChild(el("blockquote", "jev-quote previous", previous.text));
    const before = link(previous.source, "Previous release on SEC.gov");
    if (before) box.appendChild(before);
  } else {
    box.appendChild(el("p", "jev-quote-label", `${label}: ${previous.reason || "no passage."}`));
  }
  const periods = release.periods || {};
  if ((periods.current || []).length || (periods.previous || []).length) {
    box.appendChild(el("p", "jev-periods",
      `Periods named by Python: this release ${(periods.current || []).join(", ") || "none found"}; previous ${(periods.previous || []).join(", ") || "none found"}.`));
  }
  return box;
}

function card(release, late) {
  const node = el("article", "jev-card");
  const head = el("div", "jev-card-head");
  head.appendChild(el("strong", "jev-ticker", release.ticker || ""));
  head.appendChild(el("span", "jev-company", release.company || ""));
  if (release.tier) head.appendChild(el("span", `jev-tier tier-${release.tier}`, `Tier ${release.tier}: ${TIER_LABEL[release.tier] || ""}`));
  node.appendChild(head);
  node.appendChild(el("p", "jev-meta", `Filed ${release.filed} · ${floorText(release)}`));
  node.appendChild(el("p", "jev-answers", answersText(release)));
  node.appendChild(el("p", "jev-reaction", reactionText(release, late)));
  node.appendChild(quoteBlock(release));
  return node;
}

function row(release, late) {
  const details = el("details", "jev-row");
  const summary = el("summary");
  summary.appendChild(el("strong", "jev-ticker", release.ticker || ""));
  summary.appendChild(el("span", "jev-company", release.company || ""));
  summary.appendChild(el("span", "jev-row-meta",
    `${release.filed} · operations: ${setupLabel((release.jev || {}).setup)} · ${reactionText(release, late)}${release.floor ? "" : " · fails the floor"}`));
  details.appendChild(summary);
  details.appendChild(el("p", "jev-answers", answersText(release)));
  details.appendChild(el("p", "jev-meta", floorText(release)));
  details.appendChild(quoteBlock(release));
  return details;
}

function renderFunnel(counts) {
  const list = document.getElementById("jev-funnel");
  if (!list) return;
  list.replaceChildren();
  const steps = [
    [counts.eightk_checked, "8-K filings checked"],
    [counts.earnings_releases, "earnings releases"],
    [counts.in_screener_universe, `in the screener universe (${counts.smaller_companies_not_shown} smaller companies read, not shown)`],
    [counts.read_by_jev, "read by Jev"],
    [counts.passed_floor, "pass the floor"],
    [counts.short_list, "on the short list"],
  ];
  steps.forEach(([value, label], i) => {
    const item = el("li");
    item.appendChild(el("span", "k", String(i + 1).padStart(2, "0")));
    item.appendChild(el("strong", null, value == null ? "—" : Number(value).toLocaleString("en-US")));
    item.appendChild(el("span", null, label));
    list.appendChild(item);
  });
}

function renderShortList() {
  const box = document.getElementById("jev-short");
  if (!box) return;
  box.replaceChildren();
  const late = (jevState.index.late_reactions || {})[jevState.week.as_of] || {};
  const rows = shortListOf(jevState.week.releases);
  if (!rows.length) {
    box.appendChild(el("p", "insights-note", "No release made the short list this week."));
    return;
  }
  rows.forEach((release) => box.appendChild(card(release, late)));
}

function renderAll() {
  const box = document.getElementById("jev-all");
  const count = document.getElementById("jev-all-count");
  if (!box) return;
  box.replaceChildren();
  const late = (jevState.index.late_reactions || {})[jevState.week.as_of] || {};
  const rows = filterReleases(jevState.week.releases, jevState.filters);
  if (count) count.textContent = `${rows.length} of ${(jevState.week.releases || []).length} releases shown`;
  groupByGuidance(rows).forEach(([key, members]) => {
    const group = el("section", "jev-group");
    group.appendChild(el("h3", null, `${key === "other" ? "Other" : guidanceLabel(key)} (${members.length})`));
    members.forEach((release) => group.appendChild(row(release, late)));
    box.appendChild(group);
  });
}

function renderTrack() {
  const list = document.getElementById("jev-evidence");
  if (list) {
    list.replaceChildren();
    evidenceSentences(jevState.index.backtest).forEach((text) => list.appendChild(el("li", null, text)));
  }
  const table = document.getElementById("jev-tracking");
  const note = document.getElementById("jev-tracking-note");
  if (!table) return;
  table.replaceChildren();
  const head = el("tr");
  ["Week", "Group", "Releases", "3 months", "6 months", "12 months"].forEach((label) => head.appendChild(el("th", null, label)));
  const thead = el("thead");
  thead.appendChild(head);
  table.appendChild(thead);
  const body = el("tbody");
  trackingRows(jevState.index).forEach((r) => {
    const line = el("tr");
    [r.week, r.group, String(r.releases), ...r.values.map((v) => (v == null ? "not yet" : signedPct(v)))]
      .forEach((text) => line.appendChild(el("td", null, text)));
    body.appendChild(line);
  });
  table.appendChild(body);
  if (note) {
    note.textContent = "Tracking: mean return of each group minus the average screener-universe stock, from the first session after the week's Friday. "
      + "\"Not yet\" means that much time has not passed. One week is noise; judge only after many weeks.";
  }
}

function renderWeek() {
  const week = jevState.week;
  const chip = document.getElementById("jev-week-chip");
  const aside = document.getElementById("aside-week");
  const rule = document.getElementById("jev-universe-rule");
  const banner = document.getElementById("jev-banner");
  if (chip) chip.textContent = `Week ending ${week.as_of}`;
  if (aside) aside.textContent = week.as_of;
  if (rule && week.universe_rule) rule.textContent = week.universe_rule;
  const message = weekBanner(week, jevState.release, jevState.index.latest);
  if (banner) {
    banner.textContent = message || "";
    banner.hidden = !message;
  }
  renderFunnel(week.counts || {});
  renderShortList();
  renderAll();
  renderTrack();
}

function loadWeek(asOf) {
  const entry = (jevState.index.weeks || []).find((w) => w.as_of === asOf);
  if (!entry) return Promise.reject(new Error(`no published week ${asOf}`));
  return fetch(`./${entry.file}`, { cache: "no-store" }).then((r) => r.json()).then((week) => {
    if (week.schema !== WEEK_SCHEMA) throw new Error(`week file schema is not ${WEEK_SCHEMA}`);
    if (week.as_of !== asOf) throw new Error("week file does not match the index");
    jevState.week = week;
    renderWeek();
  });
}

function showError(error) {
  const status = document.getElementById("jev-status");
  if (status) {
    status.hidden = false;
    status.textContent = (error && error.message) || "Jev reads are unavailable.";
  }
}

function bindJev() {
  const query = document.getElementById("jev-query");
  const floorOnly = document.getElementById("jev-floor-only");
  const pick = document.getElementById("jev-week");
  if (query) query.addEventListener("input", () => { jevState.filters.query = query.value; renderAll(); });
  if (floorOnly) floorOnly.addEventListener("change", () => { jevState.filters.floorOnly = floorOnly.checked; renderAll(); });
  if (pick) pick.addEventListener("change", () => { loadWeek(pick.value).catch(showError); });
}

function startJevReads() {
  bindJev();
  Promise.all([
    fetch("./jev-reads.json", { cache: "no-store" }).then((r) => r.json()),
    fetch("./release.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
  ]).then(([index, release]) => {
    if (index.schema !== INDEX_SCHEMA) throw new Error(`index schema is not ${INDEX_SCHEMA}`);
    if (!index.latest || !(index.weeks || []).length) throw new Error("No week has been published yet.");
    jevState.index = index;
    jevState.release = release;
    const pick = document.getElementById("jev-week");
    if (pick) {
      index.weeks.forEach((w) => {
        const option = el("option", null, `Week ending ${w.as_of}`);
        option.value = w.as_of;
        pick.appendChild(option);
      });
      pick.value = index.latest;
    }
    return loadWeek(index.latest);
  }).then(() => {
    const status = document.getElementById("jev-status");
    if (status) status.hidden = true;
  }).catch(showError);
}

startJevReads();
