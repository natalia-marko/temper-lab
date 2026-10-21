// Earnings read by Jev: the latest earnings release of each Research Shortlist company, read by Jev (AI).
// One row per company, in Shortlist order: Jev's read, its confidence, the checks and the returns never
// order the list. Data: jev-reads.json (`suggestion_books`, built by `python -m jev.public_page`) and
// earnings-calendar.json (next results, refreshed Tue/Fri). Every value is written as text; links go to
// sec.gov and one verified issuer host only.
const INDEX_SCHEMA = "jev-reads-index-1";
const BOOK_SCHEMA = "jev-suggestion-book-2";
const CALENDAR_SCHEMA = "earnings-calendar-1";
const ISSUER_HOSTS = ["investors.eogresources.com"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TONE = { Raised: "raised", Maintained: "kept", Cut: "cut", Withheld: "cut", "No comparison": "none", Unclear: "none", "No answer": "none", "Source needs review": "review" };
const SYMBOL = { Raised: "↑ ", Maintained: "= ", Cut: "↓ ", Withheld: "↓ " };
const GUIDANCE_SENTENCE = {
  Raised: "Raised its outlook against its own previous guidance.",
  Maintained: "Kept or reaffirmed its previous outlook.",
  Cut: "Cut its outlook against its own previous guidance.",
  Withheld: "Withheld or withdrew its outlook.",
  "No comparison": "Gave an outlook, but no earlier outlook for the same period could be compared.",
  Unclear: "No outlook in the passages, or Jev could not tell.",
  "Source needs review": "The earnings release could not be established from the saved input.",
  "No answer": "Jev gave no answer.",
};
const CHECK_SHORT = { dilution: "dilution", margin: "margin", drawdown: "fall from high" };
const jevState = { index: null, release: null, calendar: null, book: null, weekId: null, loadId: 0, selected: null, shown: [], filters: { query: "", flags: {} } };

// ---------------------------------------------------------------- values

function weekId(entry) { return entry.id || entry.as_of; }
function day(iso, year = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "—";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${year ? ` ${m[1]}` : ""}`;
}
function daysBetween(from, to) { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000); }
function addDays(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function signedPp(value) { return typeof value === "number" && Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(1)}` : "—"; }
function confidenceText(value) { return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—"; }
function median(values) {
  const v = values.slice().sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
}
function secUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "www.sec.gov" && !url.username && !url.password && (!url.port || url.port === "443") ? url.href : null; } catch { return null; }
}
function issuerUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && ISSUER_HOSTS.includes(url.hostname) && !url.username && !url.password && (!url.port || url.port === "443") ? url.href : null; } catch { return null; }
}

function validateBook(book, entry) {
  if (!book || book.schema !== BOOK_SCHEMA || book.as_of !== entry.as_of) throw new Error("The earnings reads do not match the selected snapshot.");
  const rows = book.releases;
  if (!Array.isArray(rows) || !rows.length || rows.length !== book.counts.companies || new Set(rows.map(row => row.ticker)).size !== rows.length) throw new Error("The earnings reads have incomplete or duplicate companies.");
  if (addDays(book.as_of, -7) !== book.previous_friday) throw new Error("The earnings reads have an invalid filing window.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(book.month_end_freeze || "") || book.month_end_freeze < book.as_of) throw new Error("The earnings reads have no month-end snapshot date.");
  for (const row of rows) {
    if (!row.read || !row.read.guidance || !row.read.operations || !Array.isArray(row.checks) || row.checks.length !== 3 || !row.source_check || !/^\d{4}-\d{2}-\d{2}$/.test(row.filed) || row.filed > book.as_of) throw new Error("Invalid company evidence in the earnings reads.");
    const isNew = row.source_check.status === "supported" && row.filed > book.previous_friday;
    if (row.is_new !== isNew) throw new Error("A new read disagrees with its filing date.");
  }
  if (rows.filter(row => row.is_new).length !== book.counts.new) throw new Error("The new-read count disagrees with the rows.");
  return book;
}
function validateCalendar(calendar) {
  return calendar && calendar.schema === CALENDAR_SCHEMA && calendar.companies && typeof calendar.companies === "object" && calendar.window ? calendar : null;
}

// Next results from the calendar: only a date after the snapshot counts; "before" = on or before the month-end freeze.
function nextResults(row, book = jevState.book, calendar = jevState.calendar) {
  const entry = calendar && calendar.companies[row.ticker];
  if (!entry || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date || "") || entry.date <= book.as_of) return null;
  return { date: entry.date, timing: entry.timing || "", unsure: !!entry.unsure, before: entry.date <= book.month_end_freeze };
}
function unsure(row) { return !!(row.read.guidance.unsure || row.read.operations.unsure); }
function failing(row) { return row.checks.filter(check => check.state !== "pass"); }
function flags(book) {
  return [
    ["new", `New since ${day(book.previous_friday)}`, row => row.is_new],
    ["raised", "Raised", row => row.read.guidance.label === "Raised"],
    ["cut", "Cut or withheld", row => ["Cut", "Withheld"].includes(row.read.guidance.label)],
    ["growth", "Growth setup", row => row.read.operations.label === "Growth setup"],
    ["checks", "Checks not passed", row => failing(row).length > 0],
    ["unsure", "AI unsure", unsure],
    ["soon", `Results by ${day(book.month_end_freeze)}`, row => { const next = nextResults(row, book); return !!(next && next.before); }],
  ];
}
function shortlistOrder(a, b) {
  const ra = Number.isFinite(a.shortlist_rank) ? a.shortlist_rank : Infinity, rb = Number.isFinite(b.shortlist_rank) ? b.shortlist_rank : Infinity;
  return ra - rb || String(a.ticker).localeCompare(String(b.ticker));
}
function matchesQuery(row, query) {
  const value = String(query || "").trim().toLowerCase();
  return !value || String(row.ticker || "").toLowerCase().startsWith(value)
    || (String(row.company || "").toLowerCase().match(/[a-z0-9]+/g) || []).some(word => word.startsWith(value));
}
function visibleRows(book, filters) {
  const tests = flags(book).filter(([key]) => filters.flags[key]).map(([, , test]) => test);
  return book.releases.filter(row => matchesQuery(row, filters.query) && tests.every(test => test(row))).sort(shortlistOrder);
}
function outcomeValue(row, key) {
  const index = jevState.index || {};
  const map = key === "3d" ? index.reactions_3d_qqq : index.later_returns_1m_qqq;
  const result = ((map || {})[jevState.weekId] || {})[row.event_id];
  const value = result && result[key === "3d" ? "excess_return_3d" : "excess_return_1m_qqq"];
  if (result && result.status === "ready" && typeof value === "number" && Number.isFinite(value)) return { text: `${signedPp(100 * value)} pp`, value, result };
  return { text: result && result.status === "waiting" ? "Pending" : "Unavailable", value: null, result };
}

function tiles(rows, book, index, calendar) {
  const n = rows.length;
  const count = test => rows.filter(test).length;
  const ages = rows.map(row => daysBetween(row.filed, book.as_of));
  const label = name => count(row => row.read.guidance.label === name);
  const rest = [["Cut", "cut"], ["Withheld", "withheld"], ["Maintained", "maintained"], ["No comparison", "no comparison"], ["Unclear", "unclear"], ["Source needs review", "source to review"]]
    .map(([name, text]) => [label(name), text]).filter(([value]) => value).map(([value, text]) => `${value} ${text}`);
  const next = rows.map(row => nextResults(row, book, calendar));
  const one = index && index.backtest && index.backtest.raised_minus_rest_1m_qqq;
  const edge = one && !(one.ci_pp[0] <= 0 && one.ci_pp[1] >= 0);
  return [
    { k: `New since ${day(book.previous_friday)}`, v: String(count(row => row.is_new)), of: n,
      s: n ? `Releases filed ${day(addDays(book.previous_friday, 1))}–${day(book.as_of)}. The median read is ${median(ages)} days old; the oldest ${Math.max(...ages)}.` : "—" },
    { k: "Guidance raised", v: String(label("Raised")), of: n,
      s: `${rest.join(" · ") || "—"}${count(row => row.read.guidance.unsure) ? ` · AI unsure on ${count(row => row.read.guidance.unsure)}` : ""}` },
    calendar
      ? { k: `Results again by ${day(calendar.window.to)}`, v: String(next.filter(Boolean).length), of: n,
          s: `${next.filter(x => x && x.before).length} by the ${day(book.month_end_freeze)} month-end snapshot. Their read here will be replaced.` }
      : { k: "Next results", v: "—", s: "The results calendar could not be loaded." },
    { k: "Checks 3 of 3", v: String(count(row => !failing(row).length)), of: n,
      s: `${count(row => row.checks.some(c => c.state === "fail"))} fail at least one · ${count(row => !row.checks.some(c => c.state === "fail") && row.checks.some(c => c.state === "missing"))} can’t be checked (a missing number)` },
    { k: "Does the read predict?", v: one ? (edge ? "See the test" : "No edge found") : "Not tested", context: true,
      s: one ? `${index.backtest.releases} past releases: “raised” vs the rest over the next 21 sessions, ${signedPp(one.difference_pp)} pp (95%: ${signedPp(one.ci_pp[0])} to ${signedPp(one.ci_pp[1])}).` : "No saved test." },
  ];
}
function evidenceSentences(record) {
  if (!record) return ["The historical test is unavailable."];
  const up = record.reaction_after_raised || {}, down = record.reaction_after_lowered || {}, one = record.raised_minus_rest_1m_qqq;
  return [
    `Past test: ${record.releases} earnings releases, ${String(record.period).split(" to ").map(d => day(d, true)).join(" to ")}, read by Jev with the same questions.`,
    ...(up.releases ? [`Over the first 3 sessions the market mostly agreed with the read: ${signedPp(up.mean_pct)}% vs QQQ after “raised” (${Math.round(100 * up.share_up)}% of them rose), ${signedPp(down.mean_pct)}% after “lowered”. Many single cases went the other way.`] : []),
    ...(one ? [`After those 3 sessions, “raised” vs the rest over the next 21 sessions: ${signedPp(one.difference_pp)} percentage points (95% interval ${signedPp(one.ci_pp[0])} to ${signedPp(one.ci_pp[1])}). ${one.ci_pp[0] <= 0 && one.ci_pp[1] >= 0 ? "No return edge." : "An interval away from zero in one sample is not yet a tested rule."}`] : []),
    record.note || "",
  ].filter(Boolean);
}
function weekBanner(book, release, latest) {
  if (book.as_of !== latest) return `Archived snapshot of ${day(book.as_of, true)}. The latest published week is ${day(latest, true)}.`;
  if (release && release.as_of > book.as_of) return `The Research snapshot is newer (${day(release.as_of, true)}). These reads still describe ${day(book.as_of, true)}.`;
  if (release && book.research_shortlist && release.run_id !== book.research_shortlist.run_id) return "These reads and the Research page use different saved runs. Check the selected snapshot.";
  return null;
}

// ---------------------------------------------------------------- DOM

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function filingLink(source, text) {
  const sec = secUrl(source), safe = sec || issuerUrl(source);
  if (!safe) return null;
  const link = el("a", "jev-sec-link", text || (sec ? "Open the filing on SEC.gov ↗" : "Open the release on the company’s site ↗"));
  link.href = safe; link.target = "_blank"; link.rel = "noopener noreferrer";
  return link;
}
function pill(label) { return el("span", `jev-pill ${TONE[label] || "none"}`, `${SYMBOL[label] || ""}${label}`); }
function tag(text, className) { return el("span", `jev-tag ${className}`, text); }
function guidanceTags(row) {
  const out = [], g = row.read.guidance;
  if (row.is_new) out.push(tag("New", "new"));
  if (g.unsure) out.push(tag("AI unsure", "unsure"));
  if (g.corrected) out.push(tag("Corrected", "fixed"));
  if (g.different_periods && g.label === "Raised") out.push(tag("Periods differ", "unsure"));
  return out;
}
function checksText(row) {
  const bad = failing(row);
  if (!bad.length) return { mark: "✓ 3 of 3", tone: "pass", note: "" };
  const fail = bad.find(c => c.state === "fail");
  const passed = 3 - bad.length;
  return fail
    ? { mark: `✗ ${passed} of 3`, tone: "fail", note: bad.map(c => `${CHECK_SHORT[c.check]}${c.state === "missing" ? " missing" : ""}`).join(", ") }
    : { mark: `? ${passed} of 3`, tone: "missing", note: bad.map(c => `${CHECK_SHORT[c.check]} missing`).join(", ") };
}
function stack(strong, small) {
  const box = el("span", "jev-stack");
  box.appendChild(el("strong", null, strong));
  if (small) box.appendChild(el("small", null, small));
  return box;
}
function cell(row, content, className) { const td = el("td", className || null); if (content) td.appendChild(content); row.appendChild(td); return td; }

function tableRow(row) {
  const tr = el("tr", row.ticker === jevState.selected ? "on" : null);
  tr.dataset.ticker = row.ticker;
  cell(tr, el("span", "jev-rank", row.shortlist_rank == null ? "—" : String(row.shortlist_rank)), "c-rank");
  const company = el("div", "jev-company");
  if (globalThis.TLWatch) company.appendChild(globalThis.TLWatch.button(row.ticker, row.company));
  const open = el("button", "jev-open");
  open.type = "button";
  open.setAttribute("aria-label", `Open the read of ${row.ticker}, ${row.company}`);
  open.appendChild(el("strong", null, row.ticker));
  open.appendChild(el("small", null, row.company || ""));
  open.addEventListener("click", () => openPanel(row.ticker));
  company.appendChild(open);
  cell(tr, company);
  cell(tr, stack(day(row.filed), `${daysBetween(row.filed, jevState.book.as_of)} days ago`), "c-age");
  const guidance = el("div", "jev-guidance");
  guidance.appendChild(pill(row.read.guidance.label));
  const tags = guidanceTags(row);
  if (tags.length) { const box = el("span", "jev-tags"); tags.forEach(t => box.appendChild(t)); guidance.appendChild(box); }
  cell(tr, guidance);
  const ops = row.read.operations;
  cell(tr, stack(ops.label, ops.unsure ? "AI unsure" : ""), "c-ops");
  const checks = checksText(row);
  const ck = el("span", "jev-stack");
  ck.appendChild(el("strong", `jev-check ${checks.tone}`, checks.mark));
  if (checks.note) ck.appendChild(el("small", null, checks.note));
  cell(tr, ck, "c-checks");
  const reaction = outcomeValue(row, "3d");
  cell(tr, el("span", `jev-num ${reaction.value == null ? "na" : reaction.value >= 0 ? "up" : "down"}`, reaction.text), "c-react r");
  const next = nextResults(row);
  const nx = el("span", "jev-stack");
  if (next) {
    nx.appendChild(el("strong", null, `${day(next.date)}${next.unsure ? " ~" : ""}`));
    if (next.timing) nx.appendChild(el("small", null, next.timing));
    if (next.before) nx.appendChild(tag(`Before ${day(jevState.book.month_end_freeze)}`, "soon"));
  } else nx.appendChild(el("small", null, jevState.calendar ? `None by ${day(jevState.calendar.window.to)}` : "—"));
  cell(tr, nx, "c-next");
  return tr;
}
function renderTable(rows) {
  const table = document.getElementById("jev-table");
  table.replaceChildren();
  const head = el("tr");
  [["#", "c-rank"], ["Company"], ["Latest results", "c-age"], ["Guidance", null, "vs its own previous outlook"], ["Operations", "c-ops"], ["Checks", "c-checks"], ["Reaction", "c-react r", "3 sessions vs QQQ"], ["Next results", "c-next"]]
    .forEach(([label, className, sub]) => { const th = el("th", className || null, label); th.scope = "col"; if (sub) th.appendChild(el("span", "jev-th-sub", sub)); head.appendChild(th); });
  const thead = el("thead"); thead.appendChild(head); table.appendChild(thead);
  const body = el("tbody");
  if (!rows.length) { const tr = el("tr"); const td = cell(tr, null, "jev-empty"); td.colSpan = 8; td.textContent = "No company matches these filters."; body.appendChild(tr); }
  rows.forEach(row => body.appendChild(tableRow(row)));
  table.appendChild(body);
}
function renderTiles(rows) {
  const box = document.getElementById("jev-tiles");
  box.replaceChildren();
  tiles(rows, jevState.book, jevState.index, jevState.calendar).forEach(t => {
    const tile = el("div", `jev-tile${t.context ? " context" : ""}`);
    tile.appendChild(el("span", "k", t.k));
    const v = el("span", "v", t.v);
    if (t.of != null) v.appendChild(el("small", null, ` of ${t.of}`));
    tile.appendChild(v);
    tile.appendChild(el("span", "s", t.s));
    if (t.context) tile.appendChild(el("span", "jev-tag soon", "Context, not a signal"));
    box.appendChild(tile);
  });
}
function renderFlags() {
  const box = document.getElementById("jev-flags");
  box.replaceChildren();
  box.appendChild(el("span", "jev-flags-label", "Show only"));
  flags(jevState.book).forEach(([key, label, test]) => {
    const on = !!jevState.filters.flags[key];
    const b = el("button", `jev-flag${on ? " on" : ""}`, label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(on));
    b.appendChild(el("span", "c", String(jevState.book.releases.filter(test).length)));
    b.addEventListener("click", () => { jevState.filters.flags[key] = !on; renderList(); });
    box.appendChild(b);
  });
}
function renderList() {
  const rows = visibleRows(jevState.book, jevState.filters);
  jevState.shown = rows.map(row => row.ticker);
  renderFlags();
  renderTiles(rows);
  renderTable(rows);
  document.getElementById("jev-count").textContent = `Showing ${rows.length} of ${jevState.book.releases.length} · Shortlist order`;
  if (jevState.selected) updateStep();
}
function renderTracking() {
  const list = document.getElementById("jev-evidence");
  list.replaceChildren();
  evidenceSentences(jevState.index.backtest).forEach(text => list.appendChild(el("li", null, text)));
  const rows = (jevState.index.tracking || []);
  const horizons = Object.keys(jevState.index.tracking_horizons_sessions || { "1m": 21, "3m": 63, "6m": 126, "12m": 252 });
  const value = (row, h) => row[`mean_excess_vs_qqq_${h}`];
  const ready = rows.filter(row => horizons.some(h => value(row, h) != null));
  const note = document.getElementById("jev-tracking-note"), table = document.getElementById("jev-tracking");
  table.replaceChildren();
  if (!ready.length) {
    note.textContent = "Forward tracking: each published week’s reads are recorded and measured against QQQ at 1, 3, 6 and 12 months. No week has reached its first 21 sessions yet; results appear here when one has.";
    table.hidden = true;
    return;
  }
  note.textContent = "Forward tracking: mean return minus QQQ of each published week’s reads, from the first session after its Friday. Jev’s old reading queue is kept as its own group. One week is noise; judge only after many weeks.";
  const head = el("tr");
  ["Week", "Group", "Releases", ...horizons.map(h => `${h} vs QQQ`)].forEach(label => { const th = el("th", null, label); th.scope = "col"; head.appendChild(th); });
  const thead = el("thead"); thead.appendChild(head); table.appendChild(thead);
  const body = el("tbody");
  ready.forEach(row => {
    const tr = el("tr");
    [day(row.week, true), row.source === "research_shortlist" ? `Shortlist · ${row.group}` : `New filings · ${row.group}`, String(row.releases),
      ...horizons.map(h => (value(row, h) == null ? "not yet" : `${signedPp(100 * value(row, h))} pp`))].forEach(text => tr.appendChild(el("td", null, text)));
    body.appendChild(tr);
  });
  table.appendChild(body);
  table.hidden = false;
}

// ---------------------------------------------------------------- panel

function paragraph(parent, label, text, className) {
  const p = el("p", className || null);
  if (label) p.appendChild(el("strong", null, `${label} `));
  p.appendChild(document.createTextNode(text));
  parent.appendChild(p);
  return p;
}
function section(parent, title, sub) {
  const box = el("section", "jev-psec");
  const h = el("h3", null, title);
  if (sub) h.appendChild(el("span", null, ` · ${sub}`));
  box.appendChild(h);
  parent.appendChild(box);
  return box;
}
function passageBox(title, passage, periods, missing, previous) {
  const box = el("div", `jev-passage${previous ? " previous" : ""}`);
  const head = el("div", "jev-passage-head");
  head.appendChild(el("strong", null, passage ? `${title} · ${day(passage.published_at, true)}` : title));
  if (periods && periods.length) head.appendChild(el("span", null, `Periods named: ${periods.join(", ")}`));
  box.appendChild(head);
  if (passage) {
    box.appendChild(el("blockquote", null, passage.text || "No text could be extracted."));
    if (passage.truncated) box.appendChild(el("p", "jev-pass-meta", "Shortened in the input Jev read."));
    const link = filingLink(passage.source); if (link) box.appendChild(link);
  } else box.appendChild(el("p", "jev-pass-meta", missing));
  return box;
}
function panelBody(row) {
  const body = el("div");
  const g = row.read.guidance, ops = row.read.operations, ev = row.evidence || {};
  const head = el("header", "jev-phead");
  const top = el("div", "jev-phead-top");
  if (globalThis.TLWatch) top.appendChild(globalThis.TLWatch.button(row.ticker, row.company));
  const title = el("h2", null, row.ticker); title.id = "jev-panel-title"; top.appendChild(title);
  head.appendChild(top);
  head.appendChild(el("p", "jev-pname", row.company || ""));
  head.appendChild(el("p", "jev-pmeta", `Shortlist #${row.shortlist_rank == null ? "—" : row.shortlist_rank} · latest results ${day(row.filed, true)} (${daysBetween(row.filed, jevState.book.as_of)} days before the snapshot)`));
  const next = nextResults(row);
  head.appendChild(el("p", "jev-pmeta", next
    ? `Next results ${day(next.date, true)}${next.timing ? `, ${next.timing}` : ""}${next.unsure ? " (date not confirmed)" : ""}${next.before ? ` — before the ${day(jevState.book.month_end_freeze)} month-end snapshot` : ""}`
    : jevState.calendar ? `No results date by ${day(jevState.calendar.window.to, true)} in the calendar.` : "Results calendar unavailable."));
  const ticker = el("a", "jev-plink", "Full ticker page →"); ticker.href = `./ticker.html?t=${encodeURIComponent(row.ticker)}`; head.appendChild(ticker);
  body.appendChild(head);

  if (row.source_repair) {
    const p = paragraph(body, "Source repaired.", `The ${day(row.source_repair.original_filed, true)} input was not the earnings release. Jev read the complete ${day(row.filed, true)} release again; the original answer stays in the frozen record.`, "jev-pnote");
    const original = filingLink(row.source_repair.original_source, "Original input ↗"); if (original) { p.appendChild(document.createTextNode(" ")); p.appendChild(original); }
  }
  if (row.input_provenance && !row.input_provenance.matches_saved_request) paragraph(body, "Reused answer.", `This answer was first given in ${row.input_provenance.source_run} for a different saved input. The passages below are that original input.`, "jev-pnote");

  const read = section(body, "What Jev read", "AI");
  const grid = el("div", "jev-read");
  grid.appendChild(el("span", "lbl", "Guidance"));
  const gv = el("span", "val"); gv.appendChild(pill(g.label));
  if (g.confidence != null) gv.appendChild(el("span", "jev-conf", `confidence ${confidenceText(g.confidence)}`));
  guidanceTags(row).filter(t => t.textContent !== "New").forEach(t => gv.appendChild(t));
  grid.appendChild(gv);
  grid.appendChild(el("p", "jev-sentence", GUIDANCE_SENTENCE[g.label] || ""));
  grid.appendChild(el("span", "lbl", "Operations"));
  const ov = el("span", "val"); ov.appendChild(el("strong", null, ops.label));
  if (ops.confidence != null) ov.appendChild(el("span", "jev-conf", `confidence ${confidenceText(ops.confidence)}`));
  if (ops.unsure) ov.appendChild(tag("AI unsure", "unsure"));
  grid.appendChild(ov);
  const ai = row.jev || {};
  if (ai.product_score != null) { grid.appendChild(el("span", "lbl", "Product")); grid.appendChild(el("span", "val", `${Number(ai.product_score).toFixed(1)} of 3`)); }
  read.appendChild(grid);
  if (row.read.note) paragraph(read, null, row.read.note, "jev-warn");
  else if (g.different_periods && g.label === "Raised") paragraph(read, null, "The two guidance passages cover different periods, so their figures are not a like-for-like comparison. The raise rests on the release’s own sentence below.", "jev-warn");
  if (row.guidance_review) paragraph(read, "Corrected after a check of the source.", `Jev first said ${(row.guidance_review.raw_guidance || "no answer").replace(/_/g, " ")}${row.guidance_review.raw_confidence == null ? "" : ` (confidence ${confidenceText(row.guidance_review.raw_confidence)})`}. Why: ${row.guidance_review.reason}`, "jev-fix");
  read.appendChild(el("p", "jev-caveat", "AI answers can be wrong. The sentences and passages below are what it read."));

  const says = section(body, "What the release says", "verbatim");
  const lines = ev.change_lines || [];
  if (lines.length) lines.forEach(line => says.appendChild(el("blockquote", "jev-line", line)));
  else says.appendChild(el("p", "jev-caveat", "No sentence in the release states a change. Compare the two passages below."));

  const check = section(body, "Check it yourself", "guidance passages Jev read");
  const periods = row.periods || {};
  check.appendChild(passageBox("This release", (ev.current || []).find(p => p.section === "guidance"), periods.current, "No guidance passage was found in this release.", false));
  check.appendChild(passageBox("Previous release", (ev.previous || []).find(p => p.section === "guidance"), periods.previous, (row.previous || {}).reason || "No previous guidance passage.", true));
  if (row.guidance_review) {
    const fold = el("details", "jev-fold"); fold.appendChild(el("summary", null, "Passages used by the later check"));
    fold.appendChild(passageBox("This release", (ev.reviewed_current || []).find(p => p.section === "guidance"), null, "None.", false));
    fold.appendChild(passageBox("Previous release", (ev.reviewed_previous || []).find(p => p.section === "guidance"), null, "None.", true));
    check.appendChild(fold);
  }
  const results = (ev.current || []).find(p => p.section === "results");
  const ops2 = el("details", "jev-fold"); ops2.appendChild(el("summary", null, "Operating evidence Jev read"));
  ops2.appendChild(el("blockquote", null, results ? results.text : "No separate results passage; the release opening is below."));
  check.appendChild(ops2);
  const lead = el("details", "jev-fold"); lead.appendChild(el("summary", null, "Release opening Jev read"));
  lead.appendChild(el("blockquote", null, ev.lead || "Unavailable.")); check.appendChild(lead);
  const links = el("div", "jev-links");
  [filingLink((row.quote || {}).source), row.filing_source && row.filing_source !== (row.quote || {}).source ? filingLink(row.filing_source) : null].filter(Boolean).forEach(a => links.appendChild(a));
  check.appendChild(links);

  const arithmetic = section(body, "Checks", "Python arithmetic, no AI");
  const list = el("ul", "jev-checks");
  row.checks.forEach(c => {
    const li = el("li");
    li.appendChild(el("span", `jev-mark ${c.state}`, c.state === "pass" ? "✓" : c.state === "fail" ? "✗" : "?"));
    li.appendChild(el("span", null, `${c.state === "pass" ? "Passes" : c.state === "fail" ? "Fails" : "Missing"}: ${c.text}`));
    list.appendChild(li);
  });
  arithmetic.appendChild(list);

  const market = section(body, "How the market took it", "realized, not a forecast");
  const three = outcomeValue(row, "3d"), later = outcomeValue(row, "21d");
  const span = three.result && three.result.window ? ` (${day(three.result.window[0])}–${day(three.result.window[1])})` : "";
  const grid2 = el("div", "jev-market");
  grid2.appendChild(el("span", null, `3 sessions around the filing${span}`)); grid2.appendChild(el("span", `jev-num ${three.value == null ? "na" : three.value >= 0 ? "up" : "down"}`, `${three.text}${three.value == null ? "" : " vs QQQ"}`));
  grid2.appendChild(el("span", null, "The 21 sessions after that")); grid2.appendChild(el("span", `jev-num ${later.value == null ? "na" : later.value >= 0 ? "up" : "down"}`, `${later.text}${later.value == null ? "" : " vs QQQ"}`));
  market.appendChild(grid2);
  market.appendChild(el("p", "jev-caveat", `Prices through ${day(jevState.index.outcome_data_as_of, true)}.`));

  if ((row.related_filings || []).length) {
    const other = section(body, "Other filings that day");
    row.related_filings.forEach(f => { const a = filingLink(f.source, `${day(f.filed, true)} · not the earnings release ↗`); if (a) other.appendChild(a); });
  }
  return body;
}
function updateStep() {
  const i = jevState.shown.indexOf(jevState.selected);
  document.getElementById("jev-step-text").textContent = i < 0 ? "not in this view" : `${i + 1} of ${jevState.shown.length}`;
  const table = document.getElementById("jev-table");
  (table.querySelectorAll ? table.querySelectorAll("tr[data-ticker]") : []).forEach(tr => tr.classList.toggle("on", tr.dataset.ticker === jevState.selected));
}
function docked() { return typeof matchMedia === "function" && matchMedia("(min-width: 1600px)").matches; }
function openPanel(ticker) {
  const row = jevState.book.releases.find(r => r.ticker === ticker);
  if (!row) return;
  jevState.selected = ticker;
  document.getElementById("jev-panel-body").replaceChildren(panelBody(row));
  updateStep();
  const dialog = document.getElementById("jev-panel");
  if (typeof dialog.showModal !== "function") return;
  const dock = docked();
  document.body.classList.toggle("jev-docked", dock);
  dialog.classList.toggle("docked", dock);
  if (!dialog.open) { if (dock) dialog.show(); else dialog.showModal(); }
  dialog.scrollTop = 0;
}
function stepPanel(delta) {
  if (!jevState.shown.length) return;
  const i = jevState.shown.indexOf(jevState.selected);
  openPanel(jevState.shown[i < 0 ? 0 : (i + delta + jevState.shown.length) % jevState.shown.length]);
}

// ---------------------------------------------------------------- loading

function renderWeek() {
  const book = jevState.book;
  document.getElementById("jev-week-chip").textContent = `Data as of ${day(book.as_of, true)}`;
  document.getElementById("aside-week").textContent = day(book.as_of, true);
  const filed = book.releases.map(row => row.filed).sort();
  document.getElementById("jev-dates").textContent = `${book.counts.companies} Shortlist companies · releases ${day(filed[0])} – ${day(filed[filed.length - 1], true)}`;
  const cal = jevState.calendar;
  document.getElementById("jev-sources").textContent = `${cal ? `Results dates from Yahoo, ${day(cal.retrieved_at, true)}` : "Results calendar unavailable"} · prices through ${day(jevState.index.outcome_data_as_of, true)}`;
  const banner = document.getElementById("jev-banner"), message = weekBanner(book, jevState.release, jevState.index.latest);
  banner.textContent = message || ""; banner.hidden = !message;
  renderList();
  renderTracking();
}
async function loadWeek(id) {
  const serial = ++jevState.loadId;
  const entry = jevState.index.weeks.find(w => weekId(w) === id);
  if (!entry) throw new Error("Unknown snapshot.");
  const book = validateBook((jevState.index.suggestion_books || {})[id], entry);
  if (serial !== jevState.loadId) return;
  jevState.weekId = id; jevState.book = book; jevState.selected = null;
  renderWeek();
  document.getElementById("jev-status").hidden = true;
}
function showError(error) {
  jevState.book = null; jevState.weekId = null; jevState.selected = null; jevState.shown = [];
  const status = document.getElementById("jev-status"); status.hidden = false; status.textContent = error.message || "The earnings reads are unavailable.";
  for (const id of ["jev-tiles", "jev-flags", "jev-table", "jev-evidence"]) document.getElementById(id).replaceChildren();
  for (const id of ["jev-count", "jev-dates", "jev-sources", "jev-tracking-note"]) document.getElementById(id).textContent = "";
  document.getElementById("jev-week-chip").textContent = "Unavailable";
  document.getElementById("aside-week").textContent = "Unavailable";
  document.getElementById("jev-banner").hidden = true;
  const dialog = document.getElementById("jev-panel");
  if (dialog.open && typeof dialog.close === "function") dialog.close();
}
async function fetchJson(path) { const response = await fetch(path, { cache: "no-store" }); if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`); return response.json(); }
async function startJevReads() {
  const query = document.getElementById("jev-query");
  query.addEventListener("input", event => { jevState.filters.query = event.target.value; if (jevState.book) renderList(); });
  document.getElementById("jev-reset").addEventListener("click", () => { jevState.filters = { query: "", flags: {} }; query.value = ""; if (jevState.book) renderList(); });
  document.getElementById("jev-week").addEventListener("change", event => loadWeek(event.target.value).catch(showError));
  document.getElementById("jev-prev").addEventListener("click", () => stepPanel(-1));
  document.getElementById("jev-next").addEventListener("click", () => stepPanel(1));
  const dialog = document.getElementById("jev-panel");
  dialog.addEventListener("keydown", event => {
    if (event.target.closest && event.target.closest("input, select, textarea")) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); stepPanel(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); stepPanel(1); }
  });
  dialog.addEventListener("close", () => {
    document.body.classList.remove("jev-docked"); dialog.classList.remove("docked");
    jevState.selected = null; if (jevState.book) updateStep();
  });
  try {
    const [index, release, calendar] = await Promise.all([fetchJson("./jev-reads.json"), fetchJson("./release.json").catch(() => null), fetchJson("./earnings-calendar.json").catch(() => null)]);
    if (index.schema !== INDEX_SCHEMA) throw new Error("Unsupported earnings-reads index.");
    jevState.index = index; jevState.release = release; jevState.calendar = validateCalendar(calendar);
    const entries = (index.weeks || []).filter(entry => entry.source === "research_shortlist" && (index.suggestion_books || {})[weekId(entry)]);
    if (!entries.length) throw new Error("No verified Research Shortlist reads have been exported yet.");
    const pick = document.getElementById("jev-week"); pick.replaceChildren();
    entries.forEach(entry => { const option = el("option", null, `Shortlist · ${day(entry.as_of, true)}`); option.value = weekId(entry); pick.appendChild(option); });
    pick.value = weekId(entries[0]); await loadWeek(pick.value);
  } catch (error) { showError(error); }
}

startJevReads();
