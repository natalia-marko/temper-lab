// Current suggestion book. Frozen weekly selections and their tracking remain separate.
// Text-only rendering; external links are restricted to SEC and the verified issuer.
const INDEX_SCHEMA = "jev-reads-index-1";
const BOOK_SCHEMA = "jev-suggestion-book-1";
const GUIDANCE_LABEL = { raised: "Raised", lowered: "Cut", unchanged: "Maintained", provided_without_comparison: "Guidance provided without comparison", not_provided: "Withheld or withdrawn", unclear: "Unclear" };
const SETUP_LABEL = { asymmetric_growth_catalyst: "Growth setup", deteriorating_operations: "Deteriorating operations", mixed_operating_signals: "Mixed operating signals", stable_value_drift: "Stable, no catalyst", unclear: "Unclear" };
const GROUPS = ["Both", "Raised", "Growth"];
const jevState = { index: null, release: null, book: null, weekId: null, loadId: 0, filters: { query: "", newOnly: false } };

function weekId(entry) { return entry.id || entry.as_of; }
function signedPp(value) { return typeof value === "number" && Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(1)}` : "—"; }
function confidenceText(value) { return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—"; }
function secUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "www.sec.gov" && !url.username && !url.password && (!url.port || url.port === "443") ? url.href : null; } catch { return null; }
}
function byConfidence(a, b) {
  const ac = a.suggestion.confidence, bc = b.suggestion.confidence;
  return (bc == null ? -1 : bc) - (ac == null ? -1 : ac) || a.ticker.localeCompare(b.ticker);
}
function matchesQuery(row, query) {
  const value = String(query || "").trim().toLowerCase();
  return !value || String(row.ticker || "").toLowerCase().startsWith(value)
    || (String(row.company || "").toLowerCase().match(/[a-z0-9]+/g) || []).some(word => word.startsWith(value));
}
function partitionBook(book, filters) {
  const all = book.releases.filter(row => matchesQuery(row, filters.query));
  const carried = all.filter(row => !row.is_new);
  return {
    newRows: all.filter(row => row.is_new).sort(byConfidence),
    groups: filters.newOnly ? [] : GROUPS.map(label => [label, carried.filter(row => row.suggestion.group === label).sort(byConfidence)]).filter(([, rows]) => rows.length),
    other: filters.newOnly ? [] : carried.filter(row => row.suggestion.group === "Other suggestions").sort(byConfidence),
    shown: filters.newOnly ? all.filter(row => row.is_new).length : all.length,
  };
}
function validateBook(book, entry) {
  if (!book || book.schema !== BOOK_SCHEMA || book.as_of !== entry.as_of) throw new Error("Suggestion book does not match the selected snapshot.");
  const rows = book.releases;
  if (!Array.isArray(rows) || !rows.length || rows.length !== book.counts.companies || new Set(rows.map(row => row.ticker)).size !== rows.length) throw new Error("Suggestion book has incomplete or duplicate company membership.");
  const previous = new Date(`${book.as_of}T00:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 7);
  if (previous.toISOString().slice(0, 10) !== book.previous_friday) throw new Error("Suggestion book has an invalid filing window.");
  for (const row of rows) {
    if (!row.suggestion || !row.source_check || !/^\d{4}-\d{2}-\d{2}$/.test(row.filed) || row.filed > book.as_of) throw new Error("Invalid company evidence in the suggestion book.");
    const isNew = row.source_check.status === "supported" && row.filed > book.previous_friday;
    if (row.is_new !== isNew) throw new Error("New reading disagrees with the filing date.");
  }
  if (rows.filter(row => row.is_new).length !== book.counts.new) throw new Error("New reading count disagrees with the book.");
  return book;
}
function weekBanner(book, release, latest) {
  if (book.as_of !== latest) return `Archived snapshot ${book.as_of}. Latest published Jev week: ${latest}.`;
  if (release && release.as_of > book.as_of) return `The Research snapshot is newer (${release.as_of}). This book still describes ${book.as_of}.`;
  if (release && book.research_shortlist && release.run_id !== book.research_shortlist.run_id) return "This book and the current Research page use different saved runs. Check the selected snapshot.";
  return null;
}
function outcomeValue(row, key) {
  const index = jevState.index || {};
  const map = key === "3d" ? index.reactions_3d_qqq : index.later_returns_1m_qqq;
  const result = ((map || {})[jevState.weekId] || {})[row.event_id];
  const value = result && result[key === "3d" ? "excess_return_3d" : "excess_return_1m_qqq"];
  if (result && result.status === "ready" && typeof value === "number" && Number.isFinite(value)) return { text: `${signedPp(100 * value)} pp`, result };
  return { text: result && result.status === "waiting" ? "Pending" : "Unavailable", result };
}
function evidenceSentences(record) {
  if (!record) return ["Historical test data is unavailable."];
  const one = record.raised_minus_rest_1m_qqq;
  return [
    `Historical sample: ${record.releases} releases, ${record.period}. These results are not a source-accuracy audit.`,
    ...(one ? [`Raised versus the rest over the later 21-session window: ${signedPp(one.difference_pp)} percentage points (95% interval ${signedPp(one.ci_pp[0])} to ${signedPp(one.ci_pp[1])}). ${one.ci_pp[0] <= 0 && one.ci_pp[1] >= 0 ? "This saved test does not establish a return edge." : "An interval away from zero in this sample is not independent validation of this book."}`] : []),
    record.note || "",
  ].filter(Boolean);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function filingLink(source, text) {
  let safe = secUrl(source);
  if (!safe) {
    try { const url = new URL(source); if (url.protocol === "https:" && url.hostname === "investors.eogresources.com" && !url.username && !url.password && (!url.port || url.port === "443")) safe = url.href; } catch {}
  }
  if (!safe) return null;
  const link = el("a", "jev-sec-link", text || (secUrl(source) ? "Open filing on SEC.gov ↗" : "Open earnings release on issuer website ↗"));
  link.href = safe; link.target = "_blank"; link.rel = "noopener noreferrer";
  return link;
}
function paragraph(parent, label, text, className) {
  const p = el("p", className || ""); p.appendChild(el("strong", null, `${label} `)); p.appendChild(document.createTextNode(text)); parent.appendChild(p);
}
function passageColumn(label, passage, missing) {
  const col = el("div", "jev-passage");
  col.appendChild(el("h4", null, label));
  if (passage) {
    col.appendChild(el("p", "jev-pass-meta", `${passage.published_at || "Date unavailable"} · ${passage.section || "guidance"}${passage.truncated ? " · shortened" : ""}`));
    col.appendChild(el("blockquote", null, passage.text || "No passage extracted."));
    const link = filingLink(passage.source); if (link) col.appendChild(link);
  } else col.appendChild(el("p", "jev-pass-meta", missing || "No comparable guidance passage supplied."));
  return col;
}
function comparisonPanel(row, current, prior, label) {
  const box = el("section", "jev-comparison");
  box.appendChild(el("h3", null, label));
  const columns = el("div", "jev-compare");
  columns.appendChild(passageColumn("Prior guidance", prior.find(p => p.section === "guidance"), (row.previous || {}).reason));
  columns.appendChild(passageColumn("This guidance", current.find(p => p.section === "guidance"), "No guidance passage extracted. See the original input below."));
  box.appendChild(columns);
  return box;
}
function expandedRow(row) {
  const body = el("div", "jev-row-body");
  const suggestion = row.suggestion, ai = row.jev || {}, evidence = row.evidence || {};
  const audit = el("div", "jev-audit");
  audit.appendChild(el("span", null, `${row.company} · Research Shortlist #${row.shortlist_rank || "—"} · filing ${row.filed}`));
  if (globalThis.TLWatch && row.ticker) audit.appendChild(globalThis.TLWatch.button(row.ticker, row.company));
  const ticker = el("a", null, "Full ticker page →"); ticker.href = `./ticker.html?t=${encodeURIComponent(row.ticker)}`; audit.appendChild(ticker);
  body.appendChild(audit);
  body.appendChild(el("p", "jev-thesis", suggestion.label === "Source needs review" ? "A current earnings suggestion cannot be established from the saved input." : `Jev’s suggestion: ${suggestion.label}.`));
  if (suggestion.reason) body.appendChild(el("p", "jev-review-note", suggestion.reason));
  if (row.source_check.status !== "supported") body.appendChild(el("p", "jev-review-note", "The original AI answer is retained below for audit. It is not presented as a verified earnings read."));
  if (row.source_repair) {
    body.appendChild(el("p", "jev-review-note", `Source repaired: the ${row.source_repair.original_filed} input was replaced with the complete ${row.filed} earnings release and read again by Jev. The original answer remains in the frozen cohort.`));
    const original = filingLink(row.source_repair.original_source, "Original source retained for audit ↗"); if (original) body.appendChild(original);
  }
  if (row.input_provenance && !row.input_provenance.matches_saved_request) body.appendChild(el("p", "jev-review-note", `This answer was reused from ${row.input_provenance.source_run} with a different saved request. The original associated input is shown below. Changed excerpts have not been attributed to that AI answer.`));
  if (row.guidance_review) {
    paragraph(body, "Guidance review.", row.guidance_review.reason, "jev-review-note");
    paragraph(body, "Original AI guidance.", `${GUIDANCE_LABEL[row.guidance_review.raw_guidance] || "No answer"} · confidence ${confidenceText(row.guidance_review.raw_confidence)}. Corrections carry no replacement confidence.`);
  }
  paragraph(body, "Guidance answer.", `${GUIDANCE_LABEL[ai.guidance] || "No answer"} · confidence ${confidenceText(ai.guidance_confidence)}${row.guidance_review ? " · reviewed" : " · Jev (AI)"}.`);
  const lines = evidence.change_lines || [];
  const delta = el("section", "jev-delta");
  delta.appendChild(el("h3", null, "Delta · source language"));
  if (lines.length) lines.forEach(line => delta.appendChild(el("blockquote", null, line)));
  else delta.appendChild(el("p", null, "No explicit change sentence was extracted. No numeric delta has been inferred."));
  body.appendChild(delta);
  paragraph(body, "Operating answer.", `${SETUP_LABEL[ai.setup] || "No answer"} · confidence ${confidenceText(ai.setup_confidence)}. This is separate from the guidance comparison.`);
  const results = (evidence.current || []).find(p => p.section === "results");
  const operations = el("details", "jev-evidence-fold"); operations.appendChild(el("summary", null, "Operating evidence · original input"));
  operations.appendChild(el("blockquote", null, results ? results.text : "No separate operating passage was extracted. The release opening is retained below."));
  if (results && results.truncated) operations.appendChild(el("p", "jev-pass-meta", "This passage was shortened in the model input."));
  body.appendChild(operations);
  body.appendChild(comparisonPanel(row, evidence.current || [], evidence.previous || [], "Guidance passages · original AI input"));
  if (row.guidance_review) {
    const reviewed = el("details", "jev-evidence-fold"); reviewed.appendChild(el("summary", null, "Passages used by the later guidance review"));
    reviewed.appendChild(comparisonPanel(row, evidence.reviewed_current || [], evidence.reviewed_previous || [], "Later extraction · separate from what Jev read"));
    body.appendChild(reviewed);
  }
  const original = el("details", "jev-evidence-fold"); original.appendChild(el("summary", null, "Release opening supplied to Jev")); original.appendChild(el("blockquote", null, evidence.lead || "Unavailable")); body.appendChild(original);
  const source = filingLink((row.quote || {}).source); if (source) body.appendChild(source);
  if (row.filing_source && row.filing_source !== (row.quote || {}).source) { const filing = filingLink(row.filing_source); if (filing) body.appendChild(filing); }
  const context = el("aside", "jev-context"); context.appendChild(el("h3", null, "Realized context"));
  const dataDate = jevState.index.outcome_data_as_of || "not recorded";
  paragraph(context, "Versus QQQ.", `3 sessions: ${outcomeValue(row, "3d").text}. Later 21 sessions: ${outcomeValue(row, "21d").text}. Return data through ${dataDate}.`);
  const reaction = outcomeValue(row, "3d").result;
  if (reaction && reaction.window) paragraph(context, "Reaction dates.", reaction.window.join(" → "));
  paragraph(context, "Arithmetic checks.", row.floor ? "Passes all three checks. This does not validate the AI read." : (row.floor_reasons || ["Unavailable"]).join("; "));
  if ((row.related_filings || []).length) {
    const related = el("details", "jev-evidence-fold"); related.appendChild(el("summary", null, "Other saved filings for this company"));
    row.related_filings.forEach(filing => { const link = filingLink(filing.source, `${filing.filed} · ${filing.event_id}`); if (link) related.appendChild(link); });
    context.appendChild(related);
  }
  body.appendChild(context);
  return body;
}
function companyRow(row) {
  const details = el("details", "jev-row"); details.dataset.ticker = row.ticker;
  const summary = el("summary", "jev-row-summary");
  const company = el("span", "jev-company"); company.appendChild(el("strong", null, row.ticker)); company.appendChild(el("span", null, row.company)); summary.appendChild(company);
  summary.appendChild(el("span", `jev-suggestion${row.suggestion.group === "Other suggestions" ? " other" : ""}`, row.suggestion.label));
  const conf = el("span", "jev-number", confidenceText(row.suggestion.confidence)); conf.setAttribute("aria-label", `Model confidence ${confidenceText(row.suggestion.confidence)}`); summary.appendChild(conf);
  for (const key of ["3d", "21d"]) { const cell = el("span", "jev-number jev-return", outcomeValue(row, key).text); cell.setAttribute("aria-label", `${key === "3d" ? "3 sessions" : "21 sessions"} versus QQQ ${cell.textContent}`); summary.appendChild(cell); }
  summary.appendChild(el("span", "jev-filed", row.filed)); details.appendChild(summary);
  // Expand only requested evidence. Each row keeps independent native disclosure state.
  details.addEventListener("toggle", () => { if (details.open && !details.dataset.loaded) { details.appendChild(expandedRow(row)); details.dataset.loaded = "true"; } });
  return details;
}
function rowList(rows, empty) {
  const list = el("div", "jev-rows");
  if (!rows.length) { list.appendChild(el("p", "jev-empty", empty)); return list; }
  const head = el("div", "jev-row-head"); head.setAttribute("aria-hidden", "true");
  ["Company", "Suggestion", "Confidence", "3 sessions / QQQ", "21 sessions / QQQ", "Filed"].forEach(text => head.appendChild(el("span", null, text))); list.appendChild(head);
  rows.forEach(row => list.appendChild(companyRow(row))); return list;
}
function renderBook() {
  const book = jevState.book; const parts = partitionBook(book, jevState.filters);
  document.getElementById("jev-new").replaceChildren(rowList(parts.newRows, jevState.filters.query ? "No new earnings reads match this search." : "No confirmed new earnings reads in this filing window."));
  const still = document.getElementById("jev-still"); still.replaceChildren();
  parts.groups.forEach(([label, rows]) => { const group = el("section", "jev-group"); group.appendChild(el("h3", null, `${label} · ${rows.length}`)); group.appendChild(rowList(rows)); still.appendChild(group); });
  if (!parts.groups.length) still.appendChild(el("p", "jev-empty", "No suggestions in these groups for the selected view."));
  document.getElementById("jev-other").replaceChildren(rowList(parts.other, "No other suggestions match this view."));
  document.getElementById("jev-still-section").hidden = jevState.filters.newOnly;
  document.getElementById("jev-other-section").hidden = jevState.filters.newOnly;
  document.getElementById("jev-all-count").textContent = `${parts.shown} of ${book.counts.companies} companies shown`;
}
function renderWeek() {
  const book = jevState.book, counts = book.counts;
  document.getElementById("jev-week-chip").textContent = `Data as of ${book.as_of}`;
  document.getElementById("aside-week").textContent = book.as_of;
  const summary = document.getElementById("jev-summary"); summary.replaceChildren();
  [[counts.new, "New since Friday"], [counts.companies - counts.new - counts.source_needs_review, "Earlier earnings reads"], [counts.source_needs_review, "Sources needing review"]].forEach(([value, label]) => { const item = el("div"); item.appendChild(el("dt", null, label)); item.appendChild(el("dd", null, String(value))); summary.appendChild(item); });
  document.getElementById("jev-book-note").textContent = `${counts.companies} Research Shortlist companies. Only an earnings filing after ${book.previous_friday} and through ${book.as_of} is new. Earlier reads remain on the book; source gaps remain visible.`;
  document.getElementById("jev-new-note").textContent = `Earnings filings after Friday ${book.previous_friday}, through ${book.as_of}. A week with zero or two stays that short.`;
  const banner = document.getElementById("jev-banner"), message = weekBanner(book, jevState.release, jevState.index.latest);
  banner.textContent = message || ""; banner.hidden = !message;
  const evidence = document.getElementById("jev-evidence"); evidence.replaceChildren(); evidenceSentences(jevState.index.backtest).forEach(text => evidence.appendChild(el("li", null, text)));
  renderBook();
}
async function loadWeek(id) {
  const serial = ++jevState.loadId;
  const entry = jevState.index.weeks.find(w => weekId(w) === id);
  if (!entry) throw new Error("Unknown snapshot.");
  // A book is required. Never relabel a legacy filing-window cohort as the top 50.
  const book = validateBook((jevState.index.suggestion_books || {})[id], entry);
  if (serial !== jevState.loadId) return;
  jevState.weekId = id; jevState.book = book;
  renderWeek(); document.getElementById("jev-status").hidden = true;
}
function showError(error) {
  jevState.book = null; jevState.weekId = null;
  const status = document.getElementById("jev-status"); status.hidden = false; status.textContent = error.message || "Jev reads are unavailable.";
  for (const id of ["jev-new", "jev-still", "jev-other", "jev-summary", "jev-evidence"]) document.getElementById(id).replaceChildren();
  document.getElementById("jev-book-note").textContent = "The selected suggestion book could not be verified.";
  document.getElementById("jev-all-count").textContent = "";
  document.getElementById("jev-week-chip").textContent = "Unavailable";
  document.getElementById("aside-week").textContent = "Unavailable";
  document.getElementById("jev-new-note").textContent = "";
  document.getElementById("jev-banner").hidden = true;
}
async function fetchJson(path) { const response = await fetch(path, { cache: "no-store" }); if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`); return response.json(); }
async function startJevReads() {
  document.getElementById("jev-query").addEventListener("input", event => { jevState.filters.query = event.target.value; if (jevState.book) renderBook(); });
  document.getElementById("jev-new-only").addEventListener("change", event => { jevState.filters.newOnly = event.target.checked; if (jevState.book) renderBook(); });
  document.getElementById("jev-week").addEventListener("change", event => loadWeek(event.target.value).catch(showError));
  try {
    const [index, release] = await Promise.all([fetchJson("./jev-reads.json"), fetchJson("./release.json").catch(() => null)]);
    if (index.schema !== INDEX_SCHEMA) throw new Error("Unsupported Jev index.");
    jevState.index = index; jevState.release = release;
    const entries = (index.weeks || []).filter(entry => entry.source === "research_shortlist" && (index.suggestion_books || {})[weekId(entry)]);
    if (!entries.length) throw new Error("No verified Research Shortlist book has been exported yet.");
    const pick = document.getElementById("jev-week"); pick.replaceChildren();
    entries.forEach(entry => { const option = el("option", null, `Research Shortlist · ${entry.as_of}`); option.value = weekId(entry); pick.appendChild(option); });
    pick.value = weekId(entries[0]); await loadWeek(pick.value);
  } catch (error) { showError(error); }
}

startJevReads();
