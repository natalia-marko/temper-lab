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
// A joint filing group takes the highest role among its members, in this order.
const ROLE_ORDER = ["ceo", "cfo", "officer", "owner10", "director", "other"];
const ROLE_NAMES = {
  ceo: ["CEO", "CEOs"], cfo: ["CFO", "CFOs"], officer: ["officer", "officers"],
  owner10: ["10% owner", "10% owners"], director: ["director", "directors"], other: ["insider", "insiders"],
};
const ROLE_FILTERS = { ceo_cfo: ["CEO or CFO", ["ceo", "cfo"]], director: ["Director", ["director"]], owner10: ["10% owner", ["owner10"]] };
const LIST_FILTERS = { strength: "Strength", growth: "Growth", undervalued: "Cheap", outside: "Not on a list" };
const PAGE_SIZE = 50;
const DEFAULT_FILTERS = { query: "", view: "buying", role: "", several: false, list: "" };
const DEFAULT_SORT = { key: "filed", dir: "desc" };
const insightsState = { data: null, universe: null, filters: { ...DEFAULT_FILTERS }, sort: null, limit: PAGE_SIZE };

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
// Table cells shorten six-figure balances; the pop-up keeps exact share counts.
function shortShares(value) {
  return Number.isFinite(value) && Math.abs(value) >= 100000
    ? new Intl.NumberFormat("en-US", { notation: "compact", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value) : shares(value);
}
function plural(count, word, many = `${word}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;
}
function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
// Calendar dates (trade dates, the window, the freeze) are shown as recorded; the window is a few weeks, so no year.
function day(date) {
  if (!date) return null;
  const [, month, dayOfMonth] = String(date).slice(0, 10).split("-");
  return `${Number(dayOfMonth)} ${MONTHS[Number(month) - 1]}`;
}
function dayRange(since, until) {
  if (!since) return "unknown";
  if (!until || since === until) return day(since);
  return since.slice(0, 7) === until.slice(0, 7) ? `${Number(since.slice(8, 10))}–${day(until)}` : `${day(since)}–${day(until)}`;
}
// SEC acceptance times are stored in UTC; show them in New York time, as EDGAR does.
const NEW_YORK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function newYork(stamp) {
  if (!stamp || !Number.isFinite(Date.parse(stamp))) return null;
  const parts = Object.fromEntries(NEW_YORK.formatToParts(new Date(stamp)).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
function filedDay(stamp) {
  const local = newYork(stamp);
  return local ? day(local.date) : null;
}
function filedTime(stamp) {
  const local = newYork(stamp);
  return local ? `${day(local.date)}, ${local.time} ET` : "unknown";
}
function latest(stamps) {
  return stamps.filter(Boolean).sort().pop() || null;
}
function sum(rows, value) {
  return rows.reduce((total, row) => total + (value(row) || 0), 0);
}
// SEC names are often filed in capitals ("BUFFETT WARREN E"); show them in normal case.
function displayName(name) {
  if (!name) return "Unnamed insider";
  if (/[a-z]/.test(name)) return name;
  return name.toLowerCase().replace(/[a-z][a-z'.]*/g, word =>
    /^(ii|iii|iv|llc|l\.l\.c\.|lp|l\.p\.|n\.a\.)$/.test(word) ? word.toUpperCase() : capitalize(word));
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
function allPlanned(company, side) {
  const filings = included(company, side);
  return filings.length > 0 && filings.every(e => e.plan_flag === true);
}
function issueLabel(issue) {
  return ISSUE_LABELS[issue] || issue.replaceAll("_", " ");
}
function reviewReasons(company) {
  return [...new Set(heldForReview(company).flatMap(e => e.issues.map(issueLabel)))];
}

function usableTitle(owner) {
  return /^(see remarks|see footnotes?|officer|n\/a)$/i.test(owner.title || "") ? "" : owner.title || "";
}
function personRole(owner) {
  const roles = owner.roles || [];
  if (roles.includes("officer")) {
    const title = usableTitle(owner);
    if (/\bceo\b|chief executive/i.test(title)) return "ceo";
    if (/\bcfo\b|chief financial/i.test(title)) return "cfo";
    return "officer";
  }
  if (roles.includes("ten-percent owner")) return "owner10";
  if (roles.includes("director")) return "director";
  return "other";
}
// Owners who file together are one group, as in the research build: joint filers are not
// independent decisions. Each group takes its highest role.
const groupCache = new WeakMap();
function insiderGroups(company, side, status = "included") {
  const cache = groupCache.get(company) || {};
  groupCache.set(company, cache);
  const key = `${side || "any"}|${status}`;
  if (cache[key]) return cache[key];
  const evidence = status === "included" ? included(company, side) : heldForReview(company, side);
  const parent = new Map();
  const id = owner => owner.cik || owner.name || "unknown";
  const root = node => { while (parent.get(node) !== node) node = parent.get(node); return node; };
  for (const record of evidence) {
    const ids = record.owners.map(id);
    ids.forEach(node => { if (!parent.has(node)) parent.set(node, node); });
    ids.slice(1).forEach(node => parent.set(root(node), root(ids[0])));
  }
  const groups = new Map();
  for (const record of evidence) {
    for (const owner of record.owners) {
      const top = root(id(owner));
      if (!groups.has(top)) groups.set(top, { owners: new Map(), evidence: new Set() });
      groups.get(top).owners.set(id(owner), owner);
      groups.get(top).evidence.add(record);
    }
  }
  cache[key] = [...groups.values()].map(group => {
    const owners = [...group.owners.values()];
    const role = ROLE_ORDER.find(candidate => owners.some(owner => personRole(owner) === candidate));
    const records = [...group.evidence];
    return { role, lead: owners.find(owner => personRole(owner) === role), owners, evidence: records, usd: sum(records, e => e.usd) };
  }).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || b.usd - a.usd);
  return cache[key];
}
function whoLabel(groups) {
  const parts = ROLE_ORDER.map(role => [role, groups.filter(group => group.role === role).length]).filter(([, count]) => count)
    .map(([role, count]) => count === 1 ? ROLE_NAMES[role][0] : /^\d/.test(ROLE_NAMES[role][1]) ? `${ROLE_NAMES[role][1]} (${count})` : `${count} ${ROLE_NAMES[role][1]}`);
  return capitalize(parts.join(" + "));
}
function roleTitle(group) {
  const title = ["ceo", "cfo", "officer"].includes(group.role) ? usableTitle(group.lead) : "";
  return title || capitalize(ROLE_NAMES[group.role][0]);
}

function ownerLabel(owner) {
  const title = usableTitle(owner);
  const roles = (owner.roles || []).map(role => role === "officer" && title ? title : role === "ten-percent owner" ? "10% owner" : role);
  return [displayName(owner.name), roles.join(" · ")].filter(Boolean).join(" — ");
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

// Each view shows only the columns and filters that describe it. Needs review is reached
// from the count line; its tab appears only while it is open.
const VIEWS = {
  all: {
    label: "All activity", title: "Every company with a reported insider purchase or sale", side: null, tab: true,
    match: () => true,
    filed: c => c.latest_public_at,
    columns: ["company", "bought", "sold", "filed", "tags"],
    facets: ["role", "list"],
  },
  buying: {
    label: "Buying", title: "Companies where insiders reported buying shares", side: "purchase", tab: true,
    match: c => c.purchase_rows > 0,
    filed: c => c.latest_purchase_public_at,
    columns: ["company", "who", "buyers", "bought", "boughtChange", "filed", "tags"],
    facets: ["role", "several", "list"],
  },
  selling: {
    label: "Selling", title: "Companies where insiders reported selling shares", side: "sale", tab: true,
    match: c => c.sale_rows > 0,
    filed: c => latest(included(c, "sale").map(e => e.public_at)),
    columns: ["company", "who", "sellers", "sold", "soldChange", "filed", "tags"],
    facets: ["role", "list"],
  },
  review: {
    label: "Needs review", title: "Transactions that stay out of totals until checked", side: null, tab: false,
    match: c => c.review_rows > 0,
    filed: c => latest(heldForReview(c).map(e => e.public_at)),
    columns: ["company", "reviewRows", "reviewWhy", "filed", "tags"],
    facets: ["list"],
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
  if (Number.isFinite(before) && Number.isFinite(change.after)) {
    // Short forms can round to the same value (1.0M → 1.0M); then show the exact counts.
    const [from, to] = [shortShares(before), shortShares(change.after)];
    node.append(el("span", from === to ? `${shares(before)} → ${shares(change.after)} shares` : `${from} → ${to} shares`, "own-sub"));
  }
  return node;
}
function companyCell(company, viewKey) {
  const button = el("button", null, "company-button"); button.type = "button";
  button.title = `Show ${company.symbol} filings`;
  button.append(el("span", company.symbol, "ticker"), el("span", company.name, "name"));
  button.addEventListener("click", () => showFilings(company, viewKey));
  return button;
}
function whoCell(company, viewKey) {
  const groups = insiderGroups(company, VIEWS[viewKey].side);
  if (!groups.length) return null;
  const node = el("span", whoLabel(groups));
  const lead = `${displayName(groups[0].lead.name)}${groups.length > 1 ? ` and ${plural(groups.length - 1, "other")}` : ""}`;
  const sub = el("span", lead, "own-sub"); sub.title = groups.map(group => `${displayName(group.lead.name)} — ${roleTitle(group)}`).join("\n");
  node.append(sub);
  return node;
}
function tagsCell(company, viewKey) {
  const side = VIEWS[viewKey].side;
  const tags = company.screens.map(screen => [SCREEN_LABELS[screen] || screen, "chip", `On this week's ${SCREEN_LABELS[screen] || screen} list`]);
  const cluster = company.cluster_10d;
  if (viewKey === "buying" && (cluster?.buyer_groups || 0) >= 2) {
    tags.push([`${cluster.buyer_groups} in 10 days`, "chip also", `${cluster.buyer_groups} insiders bought within 10 trading days (${dayRange(cluster.since, cluster.until)}), ${money(cluster.purchase_usd)} in total`]);
  }
  if (side && allPlanned(company, side)) tags.push(["Trading plan", "chip also", `Every ${side === "sale" ? "sale" : "purchase"} filing had the Rule 10b5-1 trading plan box checked`]);
  if (viewKey !== "review" && heldForReview(company, side).length) tags.push(["Partial", "chip caution", "Some transactions need review and are left out of these totals"]);
  const box = el("span", null, "chips");
  for (const [text, className, title] of tags) { const tag = el("span", text, className); tag.title = title; box.append(tag); }
  return box;
}

const COLUMNS = {
  company: { label: "Company", kind: "text", sort: c => c.symbol, cell: companyCell, className: "own-company" },
  who: { label: "Who", title: "Each insider's highest role. Joint filers, such as a fund and its manager, count once.", cell: whoCell, className: "own-who" },
  buyers: { label: "Insiders buying", kind: "number", sort: c => c.buyer_groups, cell: c => String(c.buyer_groups), className: "num" },
  bought: { label: "$ bought", kind: "number", sort: c => c.purchases_usd, cell: c => moneyCell(c.purchases_usd), className: "num lead" },
  boughtChange: {
    label: "Biggest holding change", kind: "number", title: "Largest increase in one disclosed holding account within one filing; not the person's total holdings",
    sort: c => changeRank(biggestChange(c, "purchase")), cell: c => changeCell(biggestChange(c, "purchase")), className: "num",
  },
  sellers: { label: "Insiders selling", kind: "number", sort: c => c.seller_groups, cell: c => String(c.seller_groups), className: "num" },
  sold: { label: "$ sold", kind: "number", sort: c => c.sales_usd, cell: c => moneyCell(c.sales_usd), className: "num lead" },
  soldChange: {
    label: "Biggest holding sold", kind: "number", title: "Largest share of one disclosed holding account sold within one filing",
    sort: c => changeRank(biggestChange(c, "sale")), cell: c => changeCell(biggestChange(c, "sale"), true), className: "num",
  },
  reviewRows: { label: "Transactions to check", kind: "number", sort: c => c.review_rows, cell: c => String(c.review_rows), className: "num" },
  reviewWhy: { label: "Why", cell: c => reviewReasons(c).join(", "), className: "own-why" },
  filed: {
    label: "Latest filing", kind: "date", title: "When the SEC accepted the newest filing behind this row (New York date)",
    sort: (c, viewKey) => VIEWS[viewKey].filed(c), cell: (c, viewKey) => filedDay(VIEWS[viewKey].filed(c)), className: "num",
  },
  tags: { label: "Tags", cell: tagsCell },
};

function searchText(filters) {
  return String(filters.query || "").trim().toLowerCase();
}
function matchesSearch(query, texts) {
  const words = texts.join(" ").toLowerCase().split(/[^a-z0-9]+/);
  return !query || query.split(/\s+/).every(part => words.some(word => word.startsWith(part)));
}
// Filters a view does not offer are ignored, so switching views never hides rows silently.
function filteredCompanies(companies, filters) {
  const view = VIEWS[filters.view] || VIEWS.buying;
  const query = searchText(filters);
  const role = view.facets.includes("role") && ROLE_FILTERS[filters.role];
  const several = view.facets.includes("several") && filters.several;
  const list = view.facets.includes("list") && filters.list;
  return companies.filter(company => {
    if (!view.match(company)) return false;
    if (role && !insiderGroups(company, view.side).some(group => role[1].includes(group.role))) return false;
    if (several && (company.cluster_10d?.buyer_groups || 0) < 2) return false;
    if (list === "outside" && company.screens.length) return false;
    if (list && list !== "outside" && !company.screens.includes(list)) return false;
    return matchesSearch(query, [company.symbol, company.name, ...company.evidence.flatMap(e => e.owners.map(o => o.name || ""))]);
  });
}
// Every eligible stock was checked, but only those with a reported buy or sell are listed.
// Claim "checked" only when the published universe is the one the research covered.
function checkedUniverse(desk, data) {
  const companies = Object.entries(desk.companies || {});
  return companies.length === data.universe_n ? companies.map(([symbol, company]) => ({ symbol, name: company.name || symbol })) : null;
}
function quietMatches(filters) {
  const query = searchText(filters);
  const { data, universe } = insightsState;
  if (!query || !universe) return [];
  const active = new Set(data.companies.map(company => company.symbol));
  return universe.filter(company => !active.has(company.symbol) && matchesSearch(query, [company.symbol, company.name]));
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

function filingRecord(evidence, showOwners) {
  const row = el("article", null, "ownership-record");
  const held = evidence.status !== "included";
  const verb = evidence.side === "purchase" ? "Bought" : evidence.side === "sale" ? "Sold" : "Traded";
  row.append(el("h4", `${verb} ${Number.isFinite(evidence.usd) ? money(evidence.usd) : "· amount unknown"}${held ? " · needs review" : ""}`));
  if (showOwners) row.append(el("p", evidence.owners.map(ownerLabel).join("; "), "ownership-owner"));
  const size = Number.isFinite(evidence.shares)
    ? `${shares(evidence.shares)} shares${Number.isFinite(evidence.weighted_price) ? ` at ${money(evidence.weighted_price, true)} average` : ""}` : null;
  row.append(el("p", [`Traded ${dayRange(evidence.trade_since, evidence.trade_until)}`, `filed ${filedTime(evidence.public_at)}`, `Form ${evidence.form}`, size].filter(Boolean).join(" · "), "ownership-meta"));
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
function groupSummary(group, side) {
  const verb = !side ? "Traded" : side === "purchase" ? "Bought" : "Sold";
  const amount = group.evidence.every(e => Number.isFinite(e.usd)) ? money(group.usd) : "amount partly unknown";
  const filings = new Map(group.evidence.map(e => [e.accession, e.plan_flag === true]));
  const planned = [...filings.values()].filter(Boolean).length;
  const plan = planned === 0 ? "trading plan box not checked" : planned === filings.size ? "trading plan box checked" : `trading plan box checked on ${planned} of ${filings.size}`;
  const since = group.evidence.map(e => e.trade_since).filter(Boolean).sort()[0];
  const until = latest(group.evidence.map(e => e.trade_until));
  return `${verb} ${amount} · ${plural(filings.size, "filing")} · traded ${dayRange(since, until)} · ${plan}`;
}
function insiderBlock(group, side, open) {
  const block = el("details", null, "own-insider"); block.open = open;
  const summary = el("summary");
  const names = group.owners.length > 1 ? `${displayName(group.lead.name)} and ${plural(group.owners.length - 1, "joint filer")}` : displayName(group.lead.name);
  summary.append(el("span", names, "own-insider-name"), el("span", roleTitle(group), "own-insider-role"), el("span", groupSummary(group, side), "own-insider-sum"));
  block.append(summary);
  [...group.evidence].sort((a, b) => String(b.public_at).localeCompare(String(a.public_at)))
    .forEach(evidence => block.append(filingRecord(evidence, group.owners.length > 1)));
  return block;
}
function filingsView(company, viewKey) {
  const root = el("div", null, "own-filings");
  const facts = el("dl");
  const fact = (label, value) => facts.append(el("dt", label), el("dd", value));
  if (company.purchase_rows) { fact("Insiders buying", String(company.buyer_groups)); fact("$ bought", money(company.purchases_usd)); }
  const cluster = company.cluster_10d;
  if ((cluster?.buyer_groups || 0) >= 2) fact("Several insiders", `${cluster.buyer_groups} bought within 10 trading days (${dayRange(cluster.since, cluster.until)}), ${money(cluster.purchase_usd)}`);
  if (company.sale_rows) { fact("Insiders selling", String(company.seller_groups)); fact("$ sold", money(company.sales_usd)); }
  if (company.review_rows) fact("Needs review", `${plural(company.review_rows, "transaction")} left out of totals`);
  if (company.screens.length) fact("On lists", company.screens.map(s => SCREEN_LABELS[s] || s).join(", "));
  root.append(facts);
  // One block per insider; their filings open underneath. Small companies open fully.
  const open = company.evidence.length <= 6;
  const sections = [
    ["purchase", "Bought by", insiderGroups(company, "purchase")],
    ["sale", "Sold by", insiderGroups(company, "sale")],
    [null, "Needs review:", insiderGroups(company, null, "review")],
  ];
  const first = viewKey === "selling" ? "sale" : viewKey === "review" ? null : "purchase";
  sections.sort((a, b) => Number(b[0] === first) - Number(a[0] === first));
  for (const [side, heading, groups] of sections) {
    if (!groups.length) continue;
    root.append(el("h3", `${heading} ${plural(groups.length, "insider")}`));
    [...groups].sort((a, b) => b.usd - a.usd).forEach(group => root.append(insiderBlock(group, side, open)));
  }
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
    button.hidden = !VIEWS[button.value].tab && !on;
    button.setAttribute("aria-pressed", String(on));
  }
}
function setFilter(key, value) {
  insightsState.filters[key] = value; insightsState.limit = PAGE_SIZE; renderInsights();
}
// Each option shows how many companies it would leave, given the other filters.
function renderFacets(viewKey) {
  const { data, filters } = insightsState;
  const view = VIEWS[viewKey];
  const root = document.getElementById("insights-facets"); root.replaceChildren();
  const groups = {
    role: ["Role",
      Object.entries(ROLE_FILTERS).map(([value, [label]]) => [value, label, null])],
    several: ["Participation", [[true, "Several insiders", "At least two insiders bought within 10 trading days"]]],
    list: ["On screener", Object.entries(LIST_FILTERS).map(([value, label]) => [value, label, null])],
  };
  for (const key of view.facets) {
    const [label, options] = groups[key];
    const group = el("div", null, `own-facet-group own-facet-${key}`);
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    group.append(el("span", label, "own-facet-label"));
    const choices = el("div", null, "own-facet-choices");
    for (const [value, text, title] of options) {
      const on = filters[key] === value;
      const count = filteredCompanies(data.companies, { ...filters, [key]: value }).length;
      const chip = el("button", null, `own-chip${on ? " on" : ""}`); chip.type = "button";
      chip.append(el("span", text), el("b", count.toLocaleString("en-US")));
      chip.setAttribute("aria-pressed", String(on));
      if (title) chip.title = title;
      chip.disabled = !on && count === 0;
      chip.addEventListener("click", () => setFilter(key, on ? DEFAULT_FILTERS[key] : value));
      choices.append(chip);
    }
    group.append(choices);
    root.append(group);
  }
  if (filters.query || view.facets.some(key => filters[key] !== DEFAULT_FILTERS[key])) {
    const clear = el("button", "Clear filters", "own-clear"); clear.type = "button";
    clear.addEventListener("click", clearFilters);
    root.append(clear);
  }
}
function renderHead(viewKey) {
  const sort = currentSort(viewKey, insightsState.sort);
  const row = el("tr");
  for (const key of VIEWS[viewKey].columns) {
    const column = COLUMNS[key];
    const active = column.kind && sort.key === key;
    const th = el("th", null, [column.className, active ? "sorted" : ""].filter(Boolean).join(" ")); th.scope = "col";
    if (column.title) th.title = column.title;
    if (column.kind) {
      if (active) th.setAttribute("aria-sort", sort.dir === "asc" ? "ascending" : "descending");
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
  const quiet = quietMatches(filters);
  if (quiet.length) {
    const names = quiet.length === 1 ? `${quiet[0].symbol} (${quiet[0].name})`
      : `${quiet.slice(0, 5).map(company => company.symbol).join(", ")}${quiet.length > 5 ? ` and ${quiet.length - 5} more` : ""}`;
    td.append(el("p", `${names}: checked, no insider buys or sells ${dayRange(data.trade_window.since, data.trade_window.until)}.`, "own-quiet"));
  }
  const row = el("tr"); row.append(td); return row;
}
function renderCount(viewKey, rows, visible) {
  const data = insightsState.data;
  const total = data.companies.filter(VIEWS[viewKey].match).length;
  let text = rows.length === total ? plural(total, "company", "companies") : `${rows.length.toLocaleString("en-US")} of ${plural(total, "company", "companies")}`;
  if (visible.length < rows.length) text += `, first ${visible.length} shown`;
  const count = document.getElementById("insights-count");
  count.replaceChildren(el("span", `${text} · ${sortDescription(viewKey, insightsState.sort)}`));
  const reviewCompanies = data.companies.filter(VIEWS.review.match).length;
  if (viewKey !== "review" && reviewCompanies) {
    const link = el("button", `${plural(reviewCompanies, "company", "companies")} ${reviewCompanies === 1 ? "needs" : "need"} data review →`, "own-review-link"); link.type = "button";
    link.title = "Unresolved transactions excluded from totals";
    link.addEventListener("click", () => switchView("review"));
    count.append(el("span", " · "), link);
  }
}
function renderInsights() {
  const data = insightsState.data;
  if (!data) return;
  const viewKey = insightsState.filters.view;
  document.getElementById("week-chip").textContent = `Filings through ${day(data.public_cutoff)} ${data.public_cutoff.slice(0, 4)}`;
  document.getElementById("aside-week").textContent = `Eligible universe: ${data.freeze_as_of}`;
  document.getElementById("insights-coverage").textContent = `${data.universe_n.toLocaleString("en-US")} eligible stocks · trades ${dayRange(data.trade_window.since, data.trade_window.until)} (${data.trade_window.sessions} trading days)`;
  renderViews(); renderFacets(viewKey); renderHead(viewKey);
  const rows = sortCompanies(filteredCompanies(data.companies, insightsState.filters), viewKey, insightsState.sort);
  const visible = rows.slice(0, insightsState.limit);
  renderCount(viewKey, rows, visible);
  const body = document.getElementById("insights-body");
  body.replaceChildren(...(rows.length ? visible.map(company => companyRow(company, viewKey)) : [emptyRow(viewKey)]));
  document.getElementById("insights-more").hidden = visible.length >= rows.length;
  document.getElementById("insights-build").textContent = `Built ${filedTime(data.built_at)} from filings through ${day(data.public_cutoff)}. Eligible universe and lists: ${data.freeze_as_of}.`;
}
// A new view keeps the search and list, and drops filters that described the old one.
function switchView(viewKey) {
  Object.assign(insightsState.filters, { view: viewKey, role: "", several: false });
  insightsState.sort = null; insightsState.limit = PAGE_SIZE;
  renderInsights();
}
function clearFilters() {
  insightsState.filters = { ...DEFAULT_FILTERS, view: insightsState.filters.view }; insightsState.limit = PAGE_SIZE;
  document.getElementById("insights-query").value = "";
  renderInsights();
}
function bindInsights() {
  const views = document.getElementById("insights-views");
  for (const [key, view] of Object.entries(VIEWS)) {
    const button = el("button", view.label); button.type = "button"; button.value = key; button.title = view.title;
    button.addEventListener("click", () => switchView(key));
    views.append(button);
  }
  const query = document.getElementById("insights-query");
  query.addEventListener("input", () => setFilter("query", query.value));
  document.getElementById("insights-more").addEventListener("click", () => { insightsState.limit += PAGE_SIZE; renderInsights(); });
}
async function startInsights() {
  bindInsights();
  const status = document.getElementById("insights-status");
  try {
    const read = async path => { const response = await fetch(path, { cache: "no-store" }); if (!response.ok) throw new Error("Ownership research could not be loaded. Try again later."); return response.json(); };
    const [data, desk] = await Promise.all([read("./insights-research.json"), read("./desk.json")]);
    validateSnapshot(data, desk); insightsState.data = data; insightsState.universe = checkedUniverse(desk, data); renderInsights(); status.hidden = true;
  } catch (error) { status.textContent = error.message || "Ownership research is unavailable."; }
}
startInsights();
