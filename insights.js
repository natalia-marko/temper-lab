/* Company-level insider trading evidence. Deliberately no forecast or investment score. */
const SCREEN_LABELS = { strength: "Strength", growth: "Growth", undervalued: "Cheap" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISSUE_LABELS = {
  possible_ownership_overlap: "possible double report",
  security_class_review: "unclear share class",
  amendment_review: "amended filing",
  amended_original_review: "amended filing",
  invalid_shares: "unclear share count",
  unpriced_trade: "no price reported",
  transaction_direction_mismatch: "unclear buy or sell",
};
// These caveats are true of every company, so the method footer states them once.
const PAGE_CAVEATS = [/open-market versus private/i, /historical coverage/i];
const PAGE_SIZE = 50;
const DEFAULT_FILTERS = { query: "", view: "buying", list: "all" };
const DEFAULT_SORT = { key: "filed", dir: "desc" };
const insightsState = { data: null, filters: { ...DEFAULT_FILTERS }, sort: null, limit: PAGE_SIZE };

function money(value, precise = false) {
  if (!Number.isFinite(value)) return "Unknown";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: precise || Math.abs(value) < 1 ? 2 : 0 }).format(value);
}
function shortMoney(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 1000) return money(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}
function percent(value) {
  return Number.isFinite(value) ? `${value.toLocaleString("en-US", { maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0 })}%` : "Unknown";
}
function shares(value) {
  return Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "?";
}
function plural(count, word, many = `${word}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;
}
// Dates are the UTC calendar dates the snapshot records; the window is a few weeks, so no year.
function day(stamp) {
  if (!stamp) return null;
  const [, month, date] = String(stamp).slice(0, 10).split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1]}`;
}
function dayTime(stamp) {
  return stamp ? `${day(stamp)}, ${String(stamp).slice(11, 16)} UTC` : "unknown";
}
function dayRange(since, until) {
  if (!since) return "unknown";
  if (!until || since === until) return day(since);
  return since.slice(0, 7) === until.slice(0, 7) ? `${Number(since.slice(8, 10))}–${day(until)}` : `${day(since)}–${day(until)}`;
}
function latest(stamps) {
  return stamps.filter(Boolean).sort().pop() || null;
}
function sum(rows, value) {
  return rows.reduce((total, row) => total + (value(row) || 0), 0);
}

function included(company, side) {
  return company.evidence.filter(e => e.status === "included" && (!side || e.side === side));
}
function heldForReview(company, side) {
  return company.evidence.filter(e => e.status !== "included" && (!side || e.side === side));
}
// The largest change in one disclosed account within one filing; a new account beats any percentage.
function biggestChange(company, side) {
  let best = null;
  for (const evidence of included(company, side)) {
    const change = evidence.holding_change || {};
    if (side === "purchase" && (change.status === "new_position" || change.new_position === true)) return { kind: "new", after: change.shares_after };
    if (change.status === "calculated" && Number.isFinite(change.change_pct) && (!best || change.change_pct > best.pct)) {
      best = { kind: "pct", pct: change.change_pct, before: change.shares_before, after: change.shares_after };
    }
  }
  return best;
}
function changeRank(change) {
  return !change ? null : change.kind === "new" ? Infinity : change.pct;
}
function officersBuying(company) {
  const officers = new Set();
  for (const evidence of included(company, "purchase")) {
    for (const owner of evidence.owners) if ((owner.roles || []).includes("officer")) officers.add(owner.cik || owner.name);
  }
  return officers.size;
}
function allSalesPlanned(company) {
  const sales = included(company, "sale");
  return sales.length > 0 && sales.every(e => e.plan_flag === true);
}
function issueLabel(issue) {
  return ISSUE_LABELS[issue] || issue.replaceAll("_", " ");
}
function reviewReasons(company) {
  return [...new Set(heldForReview(company).flatMap(e => e.issues.map(issueLabel)))];
}
function notOnList(rows) {
  return rows.filter(c => !c.screens.length).length;
}

function ownerLabel(owner) {
  const title = /^(see remarks|see footnotes?|officer|n\/a)$/i.test(owner.title || "") ? "" : owner.title;
  const roles = (owner.roles || []).map(role => role === "officer" && title ? title : role === "ten-percent owner" ? "10% owner" : role);
  return [owner.name || "Unnamed insider", roles.join(" · ")].filter(Boolean).join(" — ");
}
function planLabel(flag) {
  return flag === true ? "Trading plan box checked" : flag === false ? "Trading plan box not checked" : "Trading plan not stated";
}
function holdingLabel(evidence) {
  const change = evidence.holding_change || {};
  if (change.status === "new_position" || change.new_position === true) {
    return `New holding: this account started from zero${Number.isFinite(change.shares_after) ? ` (now ${shares(change.shares_after)} shares)` : ""}`;
  }
  if (change.status === "calculated") {
    const balances = `${shares(change.shares_before)} → ${shares(change.shares_after)} shares`;
    return evidence.side === "purchase" ? `Holding +${percent(change.change_pct)} (${balances}, this account only)` : `Sold ${percent(change.change_pct)} of this holding (${balances})`;
  }
  return `Holding change unknown: ${change.reason || "not enough information"}`;
}
function safeSecUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "www.sec.gov" ? url.href : null; }
  catch { return null; }
}

// Each view shows only the columns and top numbers that describe it.
const VIEWS = {
  buying: {
    label: "Buying", title: "Companies where insiders reported buying shares", side: "purchase",
    match: c => c.purchase_rows > 0,
    filed: c => c.latest_purchase_public_at,
    columns: ["company", "buyers", "bought", "boughtChange", "filed", "tags"],
    stats: rows => [["Companies", rows.length], ["Insiders buying", sum(rows, c => c.buyer_groups)], ["Not on any list", notOnList(rows)]],
  },
  several: {
    label: "Several insiders", title: "At least two insiders bought within 10 trading days", side: "purchase",
    match: c => (c.cluster_10d?.buyer_groups || 0) >= 2,
    filed: c => c.cluster_10d?.public_at,
    columns: ["company", "clusterBuyers", "clusterBought", "clusterDates", "filed", "tags"],
    stats: rows => [["Companies", rows.length], ["Insiders buying within 10 trading days", sum(rows, c => c.cluster_10d.buyer_groups)], ["Not on any list", notOnList(rows)]],
  },
  officers: {
    label: "Officers buying", title: "An officer, such as the CEO or CFO, bought shares", side: "purchase",
    match: c => c.officer_purchase_usd > 0,
    filed: c => c.latest_purchase_public_at,
    columns: ["company", "officerBought", "buyers", "boughtChange", "filed", "tags"],
    stats: rows => [["Companies", rows.length], ["Officers buying", sum(rows, officersBuying)], ["Not on any list", notOnList(rows)]],
  },
  selling: {
    label: "Selling", title: "Companies where insiders reported selling shares", side: "sale",
    match: c => c.sale_rows > 0,
    filed: c => latest(included(c, "sale").map(e => e.public_at)),
    columns: ["company", "sellers", "sold", "soldChange", "filed", "tags"],
    stats: rows => [["Companies", rows.length], ["Insiders selling", sum(rows, c => c.seller_groups)], ["Not on any list", notOnList(rows)]],
  },
  review: {
    label: "Needs review", title: "Transactions that stay out of totals until checked", side: null,
    match: c => c.review_rows > 0,
    filed: c => latest(heldForReview(c).map(e => e.public_at)),
    columns: ["company", "reviewRows", "reviewWhy", "filed", "tags"],
    stats: rows => [["Companies", rows.length], ["Transactions to check", sum(rows, c => c.review_rows)], ["Filings to check", sum(rows, c => new Set(heldForReview(c).map(e => e.accession)).size)]],
  },
  all: {
    label: "All activity", title: "Every company with a reported insider purchase or sale", side: null,
    match: () => true,
    filed: c => c.latest_public_at,
    columns: ["company", "bought", "sold", "filed", "tags"],
    stats: rows => [["Companies", rows.length], ["With insider buying", rows.filter(c => c.purchase_rows > 0).length], ["With insider selling", rows.filter(c => c.sale_rows > 0).length]],
  },
};

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function moneyCell(value) {
  const text = shortMoney(value);
  if (!text) return null;
  const node = el("span", text); node.title = money(value); return node;
}
function changeCell(change, sold = false) {
  if (!change) return el("span", "Unknown", "na");
  const node = el("span", change.kind === "new" ? "New holding" : `${sold ? "" : "+"}${percent(change.pct)}`);
  const before = change.kind === "new" ? 0 : change.before;
  if (Number.isFinite(before) && Number.isFinite(change.after)) node.append(el("span", `${shares(before)} → ${shares(change.after)} shares`, "own-sub"));
  return node;
}
function companyCell(company, viewKey) {
  const button = el("button", null, "company-button"); button.type = "button";
  button.title = `Show ${company.symbol} filings`;
  button.append(el("span", company.symbol, "ticker"), el("span", company.name, "name"));
  button.addEventListener("click", () => showFilings(company, viewKey));
  return button;
}
function tagsCell(company, viewKey) {
  const tags = company.screens.map(screen => [SCREEN_LABELS[screen] || screen, "chip", `On this week's ${SCREEN_LABELS[screen] || screen} list`]);
  if ((viewKey === "buying" || viewKey === "several") && company.officer_purchase_usd > 0) tags.push(["Officer", "chip also", "An officer was among the buyers"]);
  if (viewKey === "selling" && allSalesPlanned(company)) tags.push(["Trading plan", "chip also", "Every sale filing had the Rule 10b5-1 plan box checked"]);
  if (viewKey !== "review" && heldForReview(company, VIEWS[viewKey].side).length) tags.push(["Partial", "chip caution", "Some transactions need review and are left out of these totals"]);
  const box = el("span", null, "chips");
  for (const [text, className, title] of tags) { const tag = el("span", text, className); tag.title = title; box.append(tag); }
  return box;
}

const COLUMNS = {
  company: { label: "Company", kind: "text", sort: c => c.symbol, cell: companyCell },
  buyers: { label: "Insiders buying", kind: "number", sort: c => c.buyer_groups, cell: c => String(c.buyer_groups), className: "num" },
  bought: { label: "$ bought", kind: "number", sort: c => c.purchases_usd, cell: c => moneyCell(c.purchases_usd), className: "num lead" },
  boughtChange: {
    label: "Biggest holding change", kind: "number", title: "Largest increase in one disclosed holding account within one filing; not the person's total holdings",
    sort: c => changeRank(biggestChange(c, "purchase")), cell: c => changeCell(biggestChange(c, "purchase")), className: "num",
  },
  clusterBuyers: { label: "Insiders in 10 trading days", kind: "number", sort: c => c.cluster_10d.buyer_groups, cell: c => String(c.cluster_10d.buyer_groups), className: "num" },
  clusterBought: { label: "$ bought in those days", kind: "number", sort: c => c.cluster_10d.purchase_usd, cell: c => moneyCell(c.cluster_10d.purchase_usd), className: "num lead" },
  clusterDates: { label: "Trade dates", kind: "date", sort: c => c.cluster_10d.until, cell: c => dayRange(c.cluster_10d.since, c.cluster_10d.until), className: "num" },
  officerBought: { label: "$ bought by officers", kind: "number", sort: c => c.officer_purchase_usd, cell: c => moneyCell(c.officer_purchase_usd), className: "num lead" },
  sellers: { label: "Insiders selling", kind: "number", sort: c => c.seller_groups, cell: c => String(c.seller_groups), className: "num" },
  sold: { label: "$ sold", kind: "number", sort: c => c.sales_usd, cell: c => moneyCell(c.sales_usd), className: "num lead" },
  soldChange: {
    label: "Biggest holding sold", kind: "number", title: "Largest share of one disclosed holding account sold within one filing",
    sort: c => changeRank(biggestChange(c, "sale")), cell: c => changeCell(biggestChange(c, "sale"), true), className: "num",
  },
  reviewRows: { label: "Transactions to check", kind: "number", sort: c => c.review_rows, cell: c => String(c.review_rows), className: "num" },
  reviewWhy: { label: "Why", cell: c => reviewReasons(c).join(", "), className: "own-why" },
  filed: { label: "Latest filing", kind: "date", title: "When the SEC accepted the newest filing behind this row (UTC date)", sort: (c, viewKey) => VIEWS[viewKey].filed(c), cell: (c, viewKey) => day(VIEWS[viewKey].filed(c)), className: "num" },
  tags: { label: "Tags", cell: tagsCell },
};

function filteredCompanies(companies, filters) {
  const view = VIEWS[filters.view] || VIEWS.buying;
  const query = String(filters.query || "").trim().toLowerCase();
  return companies.filter(company => {
    if (!view.match(company)) return false;
    if (filters.list === "outside" && company.screens.length) return false;
    if (filters.list && filters.list !== "all" && filters.list !== "outside" && !company.screens.includes(filters.list)) return false;
    const words = [company.symbol, company.name, ...company.evidence.flatMap(e => e.owners.map(o => o.name || ""))]
      .join(" ").toLowerCase().split(/[^a-z0-9]+/);
    return !query || query.split(/\s+/).every(part => words.some(word => word.startsWith(part)));
  });
}
function currentSort(viewKey, sort) {
  return sort && VIEWS[viewKey].columns.includes(sort.key) ? sort : DEFAULT_SORT;
}
// Missing values sort last in either direction; ties fall back to newest filing, then ticker.
function sortCompanies(rows, viewKey, sort) {
  const { key, dir } = currentSort(viewKey, sort);
  const value = COLUMNS[key].sort;
  const compare = (a, b) => {
    if (a === b) return 0;
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    const order = typeof a === "string" ? a.localeCompare(b) : a < b ? -1 : 1;
    return dir === "asc" ? order : -order;
  };
  const filed = COLUMNS.filed.sort;
  return [...rows].sort((a, b) => compare(value(a, viewKey), value(b, viewKey))
    || String(filed(b, viewKey) || "").localeCompare(String(filed(a, viewKey) || "")) || a.symbol.localeCompare(b.symbol));
}
function sortDescription(viewKey, sort) {
  const { key, dir } = currentSort(viewKey, sort);
  const kind = COLUMNS[key].kind;
  const order = kind === "text" ? (dir === "asc" ? "A to Z" : "Z to A") : kind === "date" ? (dir === "asc" ? "oldest first" : "newest first") : (dir === "asc" ? "low to high" : "high to low");
  return `sorted by ${COLUMNS[key].label.toLowerCase()}, ${order}`;
}

function validateSnapshot(data, desk) {
  if (data.schema !== "ownership-research-1" || !Array.isArray(data.companies)) throw new Error("Ownership research is unavailable: unsupported snapshot.");
  if (data.freeze_run_id !== desk.run_id || data.freeze_as_of !== desk.as_of) throw new Error("Ownership research is awaiting a refresh for this week's eligible universe.");
  if (data.coverage?.failed_requests !== 0 || data.coverage?.issuer_indexes_checked !== data.universe_n) throw new Error("Ownership source coverage is incomplete. No totals are shown.");
}

function filingRecord(evidence) {
  const row = el("article", null, "ownership-record");
  const held = evidence.status !== "included";
  const verb = evidence.side === "purchase" ? "Bought" : evidence.side === "sale" ? "Sold" : "Traded";
  row.append(el("h4", `${verb} ${Number.isFinite(evidence.usd) ? money(evidence.usd) : "· amount unknown"}${held ? " · needs review" : ""}`));
  row.append(el("p", evidence.owners.map(ownerLabel).join("; "), "ownership-owner"));
  const size = Number.isFinite(evidence.shares)
    ? `${shares(evidence.shares)} shares${Number.isFinite(evidence.weighted_price) ? ` at ${money(evidence.weighted_price, true)} average` : ""}` : null;
  row.append(el("p", [`Traded ${dayRange(evidence.trade_since, evidence.trade_until)}`, `filed ${dayTime(evidence.public_at)}`, `Form ${evidence.form}`, size].filter(Boolean).join(" · "), "ownership-meta"));
  const account = evidence.ownership === "D" ? "Direct" : evidence.ownership === "I" ? `Indirect${evidence.ownership_nature ? `: ${evidence.ownership_nature}` : ""}` : "Ownership form unknown";
  row.append(el("p", [evidence.security_title || "Security not identified", account, planLabel(evidence.plan_flag)].join(" · "), "ownership-meta"));
  row.append(el("p", holdingLabel(evidence), "ownership-holding"));
  if (held) row.append(el("p", `Left out of totals: ${evidence.issues.map(issueLabel).join(", ") || "under review"}`, "ownership-caution"));
  const url = safeSecUrl(evidence.source_url);
  if (url) { const link = el("a", "SEC filing ↗"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; row.append(link); }
  if (evidence.footnotes?.length) {
    const notes = el("details", null, "ownership-footnotes");
    notes.append(el("summary", "Filing footnotes"));
    evidence.footnotes.forEach(note => notes.append(el("p", note)));
    row.append(notes);
  }
  return row;
}
function filingsView(company, viewKey) {
  const root = el("div", null, "own-filings");
  const facts = el("dl");
  const fact = (label, value) => facts.append(el("dt", label), el("dd", value));
  if (company.purchase_rows) { fact("Insiders buying", String(company.buyer_groups)); fact("$ bought", money(company.purchases_usd)); }
  if (company.officer_purchase_usd) fact("$ bought by officers", money(company.officer_purchase_usd));
  const cluster = company.cluster_10d;
  if ((cluster?.buyer_groups || 0) >= 2) fact("Several insiders", `${cluster.buyer_groups} bought within 10 trading days (${dayRange(cluster.since, cluster.until)}), ${money(cluster.purchase_usd)}`);
  if (company.sale_rows) { fact("Insiders selling", String(company.seller_groups)); fact("$ sold", money(company.sales_usd)); }
  if (company.review_rows) fact("Needs review", `${plural(company.review_rows, "transaction")} left out of totals`);
  if (company.screens.length) fact("On lists", company.screens.map(s => SCREEN_LABELS[s] || s).join(", "));
  root.append(facts);
  const first = viewKey === "selling" ? "sale" : "purchase";
  const rank = e => viewKey === "review" ? Number(e.status === "included") : Number(e.side !== first);
  const records = [...company.evidence].sort((a, b) => rank(a) - rank(b) || String(b.public_at).localeCompare(String(a.public_at)));
  root.append(el("h3", `Filings (${records.length})`));
  records.forEach(evidence => root.append(filingRecord(evidence)));
  const uncertain = company.uncertainties.filter(text => !PAGE_CAVEATS.some(pattern => pattern.test(text)));
  if (uncertain.length) {
    root.append(el("h3", "What remains uncertain"));
    uncertain.forEach(text => root.append(el("p", text, "ownership-caution")));
  }
  return root;
}
function showFilings(company, viewKey) {
  document.getElementById("insights-evidence-title").textContent = `${company.symbol} · ${company.name}`;
  document.getElementById("insights-evidence-body").replaceChildren(filingsView(company, viewKey));
  const dialog = document.getElementById("insights-evidence");
  if (typeof dialog.showModal === "function") dialog.showModal();
}

function renderViews() {
  for (const button of document.getElementById("insights-views").children) {
    const on = button.value === insightsState.filters.view;
    button.className = on ? "on" : "";
    button.setAttribute("aria-pressed", String(on));
  }
}
function renderStats(viewKey) {
  const rows = insightsState.data.companies.filter(VIEWS[viewKey].match);
  const stats = document.getElementById("insights-stats"); stats.replaceChildren();
  for (const [label, value] of VIEWS[viewKey].stats(rows)) {
    const node = el("div", null, "ownership-metric");
    node.append(el("span", label), el("strong", value.toLocaleString("en-US"))); stats.append(node);
  }
}
function renderHead(viewKey) {
  const sort = currentSort(viewKey, insightsState.sort);
  const row = el("tr");
  for (const key of VIEWS[viewKey].columns) {
    const column = COLUMNS[key];
    const th = el("th"); th.scope = "col";
    if (column.title) th.title = column.title;
    if (column.kind) {
      const active = sort.key === key;
      if (active) { th.className = "sorted"; th.setAttribute("aria-sort", sort.dir === "asc" ? "ascending" : "descending"); }
      const button = el("button", `${column.label}${active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}`); button.type = "button";
      button.addEventListener("click", () => {
        insightsState.sort = active ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: column.kind === "text" ? "asc" : "desc" };
        insightsState.limit = PAGE_SIZE; renderInsights();
      });
      th.append(button);
    } else th.textContent = column.label;
    row.append(th);
  }
  document.getElementById("insights-head").replaceChildren(row);
}
function companyRow(company, viewKey) {
  const row = el("tr");
  for (const key of VIEWS[viewKey].columns) {
    const column = COLUMNS[key];
    const td = el("td", null, column.className);
    const content = column.cell(company, viewKey);
    if (content === null || content === undefined || content === "") td.append(el("span", "—", "na"));
    else if (typeof content === "string") td.textContent = content;
    else td.append(content);
    row.append(td);
  }
  return row;
}
function emptyRow(viewKey) {
  const { data, filters } = insightsState;
  const td = el("td", null, "empty"); td.colSpan = VIEWS[viewKey].columns.length;
  td.append(el("span", `No companies match in ${VIEWS[viewKey].label}.`));
  const elsewhere = Object.keys(VIEWS).filter(key => key !== viewKey && filteredCompanies(data.companies, { ...filters, view: key }).length);
  if (elsewhere.length) {
    td.append(el("span", " Found under: "));
    elsewhere.forEach(key => {
      const button = el("button", VIEWS[key].label, "own-jump"); button.type = "button";
      button.addEventListener("click", () => switchView(key));
      td.append(button);
    });
  }
  const row = el("tr"); row.append(td); return row;
}
function renderInsights() {
  const data = insightsState.data;
  if (!data) return;
  const viewKey = insightsState.filters.view;
  document.getElementById("week-chip").textContent = `Filings through ${day(data.public_cutoff)} ${data.public_cutoff.slice(0, 4)}`;
  document.getElementById("aside-week").textContent = `Eligible universe: ${data.freeze_as_of}`;
  document.getElementById("insights-coverage").textContent = `${data.universe_n.toLocaleString("en-US")} eligible stocks · trades ${dayRange(data.trade_window.since, data.trade_window.until)} (${data.trade_window.sessions} trading days)`;
  renderViews(); renderStats(viewKey); renderHead(viewKey);
  const rows = sortCompanies(filteredCompanies(data.companies, insightsState.filters), viewKey, insightsState.sort);
  const visible = rows.slice(0, insightsState.limit);
  const shown = visible.length === rows.length ? plural(rows.length, "company", "companies") : `Showing ${visible.length} of ${rows.length} companies`;
  document.getElementById("insights-count").textContent = `${shown} · ${sortDescription(viewKey, insightsState.sort)}`;
  const body = document.getElementById("insights-body");
  body.replaceChildren(...(rows.length ? visible.map(company => companyRow(company, viewKey)) : [emptyRow(viewKey)]));
  document.getElementById("insights-more").hidden = visible.length >= rows.length;
  document.getElementById("insights-build").textContent = `Built ${dayTime(data.built_at)} from filings through ${day(data.public_cutoff)}. Eligible universe and lists: ${data.freeze_as_of}.`;
}
function switchView(viewKey) {
  insightsState.filters.view = viewKey; insightsState.sort = null; insightsState.limit = PAGE_SIZE;
  renderInsights();
}
function bindInsights() {
  const views = document.getElementById("insights-views");
  for (const [key, view] of Object.entries(VIEWS)) {
    const button = el("button", view.label); button.type = "button"; button.value = key; button.title = view.title;
    button.addEventListener("click", () => switchView(key));
    views.append(button);
  }
  for (const [id, key, event] of [["insights-query", "query", "input"], ["insights-lists", "list", "change"]]) {
    const node = document.getElementById(id);
    node.addEventListener(event, () => { insightsState.filters[key] = node.value; insightsState.limit = PAGE_SIZE; renderInsights(); });
  }
  document.getElementById("insights-reset").addEventListener("click", () => {
    insightsState.filters = { ...DEFAULT_FILTERS, view: insightsState.filters.view }; insightsState.sort = null; insightsState.limit = PAGE_SIZE;
    document.getElementById("insights-query").value = ""; document.getElementById("insights-lists").value = "all";
    renderInsights();
  });
  document.getElementById("insights-more").addEventListener("click", () => { insightsState.limit += PAGE_SIZE; renderInsights(); });
}
async function startInsights() {
  bindInsights();
  const status = document.getElementById("insights-status");
  try {
    const read = async path => { const response = await fetch(path, { cache: "no-store" }); if (!response.ok) throw new Error("Ownership research could not be loaded. Try again later."); return response.json(); };
    const [data, desk] = await Promise.all([read("./insights-research.json"), read("./desk.json")]);
    validateSnapshot(data, desk); insightsState.data = data; renderInsights(); status.hidden = true;
  } catch (error) { status.textContent = error.message || "Ownership research is unavailable."; }
}
startInsights();
