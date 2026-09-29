/* Company-level ownership evidence. Deliberately no forecast or investment score. */
const SCREEN_LABELS = { strength: "Strength", growth: "Growth", undervalued: "Cheap" };
const insightsState = { data: null, filters: { query: "", kind: "purchases", context: "all", sort: "recent" }, limit: 30 };

function money(value, precise = false) {
  if (!Number.isFinite(value)) return "Unknown";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: precise || Math.abs(value) < 1 ? 2 : 0 }).format(value);
}
function percent(value) {
  return Number.isFinite(value) ? `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%` : "Unknown";
}
function ownerLabel(owner) {
  const title = /^(see remarks|see footnotes?|officer|n\/a)$/i.test(owner.title || "") ? "" : owner.title;
  const roles = (owner.roles || []).map(role => role === "officer" && title ? title : role);
  return [owner.name || "Unnamed filer", roles.join(" · ")].filter(Boolean).join(" — ");
}
function planLabel(flag) {
  return flag === true ? "Plan-flagged filing" : flag === false ? "Plan box unchecked; discretion unverified" : "Plan status unavailable";
}
function holdingLabel(evidence) {
  const change = evidence.holding_change || {};
  if (change.status === "new_position") return "Disclosed account started from zero";
  if (change.status === "calculated") {
    const balances = ` (${change.shares_before.toLocaleString("en-US", {maximumFractionDigits: 4})} → ${change.shares_after.toLocaleString("en-US", {maximumFractionDigits: 4})} shares)`;
    return (evidence.side === "purchase" ? `+${percent(change.change_pct)} in this holding account` : `${percent(change.change_pct)} of this holding account sold`) + balances;
  }
  return `Holding change unknown: ${change.reason || "insufficient evidence"}`;
}
function safeSecUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "www.sec.gov" ? url.href : null; }
  catch { return null; }
}
function filteredCompanies(companies, filters) {
  const query = String(filters.query || "").trim().toLowerCase();
  return companies.filter(company => {
    const cluster = (company.cluster_10d?.buyer_groups || 0) >= 2;
    if (filters.kind === "purchases" && !company.purchase_rows) return false;
    if (filters.kind === "clusters" && !cluster) return false;
    if (filters.kind === "officers" && !company.officer_purchase_usd) return false;
    if (filters.kind === "sales" && !company.sale_rows) return false;
    if (filters.kind === "review" && !company.review_rows) return false;
    if (filters.context === "outside" && company.screens.length) return false;
    if (filters.context !== "all" && filters.context !== "outside" && !company.screens.includes(filters.context)) return false;
    const words = [company.symbol, company.name, ...company.evidence.flatMap(e => e.owners.map(o => o.name || ""))]
      .join(" ").toLowerCase().split(/[^a-z0-9]+/);
    return !query || query.split(/\s+/).every(part => words.some(word => word.startsWith(part)));
  }).sort((a, b) => {
    if (filters.sort === "company") return a.symbol.localeCompare(b.symbol);
    if (filters.sort === "buyers") {
      const groups = (b.cluster_10d?.buyer_groups || 0) - (a.cluster_10d?.buyer_groups || 0);
      if (groups) return groups;
    }
    const purchases = ["purchases", "clusters", "officers"].includes(filters.kind);
    const at = purchases ? a.latest_purchase_public_at : a.latest_public_at;
    const bt = purchases ? b.latest_purchase_public_at : b.latest_public_at;
    return String(bt || "").localeCompare(String(at || "")) || a.symbol.localeCompare(b.symbol);
  });
}
function validateSnapshot(data, desk) {
  if (data.schema !== "ownership-research-1" || !Array.isArray(data.companies)) throw new Error("Ownership research is unavailable: unsupported snapshot.");
  if (data.freeze_run_id !== desk.run_id || data.freeze_as_of !== desk.as_of) throw new Error("Ownership research is awaiting a refresh for this week's eligible universe.");
  if (data.coverage?.failed_requests !== 0 || data.coverage?.issuer_indexes_checked !== data.universe_n) throw new Error("Ownership source coverage is incomplete. No totals are shown.");
}
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function metric(parent, label, value) {
  const node = el("div", null, "ownership-metric");
  node.append(el("span", label), el("strong", value)); parent.append(node);
}
function evidenceView(company) {
  const root = el("div", null, "ownership-evidence");
  for (const evidence of company.evidence) {
    const row = el("article", null, "ownership-record");
    const held = evidence.status !== "included";
    row.append(el("h4", `${held ? "Held for review · " : ""}${evidence.side === "purchase" ? "Purchase" : "Sale"} · ${money(evidence.usd, true)}`));
    row.append(el("p", evidence.owners.map(ownerLabel).join("; "), "ownership-owner"));
    const date = evidence.trade_since === evidence.trade_until ? evidence.trade_since : `${evidence.trade_since}–${evidence.trade_until}`;
    row.append(el("p", `Traded ${date || "unknown"} · Public ${evidence.public_at.replace("T", " ")} · ${evidence.form}`, "ownership-meta"));
    row.append(el("p", `${evidence.security_title || "Security not identified"} · ${evidence.ownership === "D" ? "Direct ownership" : evidence.ownership === "I" ? "Indirect ownership" : "Ownership form unknown"}${evidence.ownership_nature ? `: ${evidence.ownership_nature}` : ""}`, "ownership-meta"));
    if (Number.isFinite(evidence.weighted_price)) row.append(el("p", `Average reported price: ${money(evidence.weighted_price, true)} · ${evidence.row_count} transaction row(s)`, "ownership-meta"));
    row.append(el("p", holdingLabel(evidence), "ownership-holding"));
    row.append(el("p", planLabel(evidence.plan_flag), "ownership-meta"));
    if (held) row.append(el("p", evidence.issues.join(" · ").replaceAll("_", " "), "ownership-caution"));
    const url = safeSecUrl(evidence.source_url);
    if (url) { const link = el("a", "Read the SEC filing ↗"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; row.append(link); }
    if (evidence.footnotes?.length) {
      const notes = el("details", null, "ownership-footnotes");
      notes.append(el("summary", "Filing footnotes"));
      evidence.footnotes.forEach(note => notes.append(el("p", note)));
      row.append(notes);
    }
    root.append(row);
  }
  return root;
}
function companyCard(company) {
  const card = el("article", null, "ownership-card");
  const head = el("div", null, "ownership-card-head");
  const name = el("div"); name.append(el("h2", company.symbol), el("span", company.name, "ownership-name")); head.append(name);
  const badge = company.review_rows ? "Partial totals" : company.screens.length ? company.screens.map(s => SCREEN_LABELS[s]).join(" · ") : "Outside the three lists";
  head.append(el("span", badge, `ownership-tag${company.review_rows ? " caution" : ""}`)); card.append(head);
  const metrics = el("div", null, "ownership-metrics");
  metric(metrics, "Reported purchases", money(company.purchases_usd));
  metric(metrics, "Buyer groups", String(company.buyer_groups));
  metric(metrics, "Reported sales", money(company.sales_usd));
  const cluster = company.cluster_10d;
  metric(metrics, "Most buyers / 10 sessions", cluster ? String(cluster.buyer_groups) : "—");
  card.append(metrics);
  const reasons = el("ul", null, "ownership-reasons"); company.reasons.forEach(reason => reasons.append(el("li", reason))); card.append(reasons);
  if (cluster && cluster.buyer_groups >= 2) card.append(el("p", `Cluster trades: ${cluster.since}–${cluster.until} · ${money(cluster.purchase_usd)} · evidence public by ${cluster.public_at.slice(0, 10)}. Groups may be related.`, "ownership-meta"));
  const latest = company.latest_purchase_public_at || company.latest_public_at;
  card.append(el("p", `Latest ${company.latest_purchase_public_at ? "purchase " : ""}filing: ${latest.slice(0, 10)} · Historical unusualness: unknown`, "ownership-meta"));
  const details = el("details", null, "ownership-details");
  details.append(el("summary", `Who traded, holdings and source evidence (${company.evidence.length})`));
  let populated = false;
  details.addEventListener("toggle", () => { if (details.open && !populated) { details.append(evidenceView(company)); populated = true; } });
  card.append(details);
  const uncertainty = el("details", null, "ownership-details uncertainty");
  uncertainty.append(el("summary", "What remains uncertain"));
  company.uncertainties.forEach(text => uncertainty.append(el("p", text)));
  card.append(uncertainty);
  return card;
}
function renderInsights() {
  const data = insightsState.data;
  if (!data) return;
  document.getElementById("week-chip").textContent = `Filings through ${data.public_cutoff}`;
  document.getElementById("aside-week").textContent = `Eligible universe: ${data.freeze_as_of}`;
  document.getElementById("insights-coverage").textContent = `${data.universe_n.toLocaleString()} eligible stocks checked · trades ${data.trade_window.since}–${data.trade_window.until}`;
  const stats = document.getElementById("insights-stats"); stats.replaceChildren();
  metric(stats, "Companies with purchases", String(data.counts.companies_with_purchases));
  metric(stats, "Outside the three lists", String(data.counts.outside_screen_lists));
  metric(stats, "Multiple buyers / 10 sessions", String(data.counts.companies_with_clusters));
  const rows = filteredCompanies(data.companies, insightsState.filters);
  const visible = rows.slice(0, insightsState.limit);
  document.getElementById("insights-count").textContent = `${visible.length} of ${rows.length} companies shown · ${data.counts.review_rows} transaction rows held for review across this snapshot. Sorting describes activity, not expected returns.`;
  const root = document.getElementById("insights-list"); root.replaceChildren();
  if (!rows.length) root.append(el("p", "No companies match these filters. This does not prove there was no ownership activity.", "empty"));
  visible.forEach(company => root.append(companyCard(company)));
  const more = document.getElementById("insights-more"); more.hidden = visible.length >= rows.length;
  document.getElementById("insights-build").textContent = `Research built ${data.built_at.replace("T", " ")}. Eligibility and screen context: ${data.freeze_as_of}. Filing availability and research build time are stored separately.`;
}
function bindInsights() {
  for (const [id, key, event] of [["insights-query", "query", "input"], ["insights-kind", "kind", "change"], ["insights-context", "context", "change"], ["insights-sort", "sort", "change"]]) {
    const node = document.getElementById(id);
    node.addEventListener(event, () => { insightsState.filters[key] = node.value; insightsState.limit = 30; renderInsights(); });
  }
  document.getElementById("insights-reset").addEventListener("click", () => {
    insightsState.filters = { query: "", kind: "purchases", context: "all", sort: "recent" }; insightsState.limit = 30;
    for (const key of ["query", "kind", "context", "sort"]) document.getElementById(`insights-${key}`).value = insightsState.filters[key];
    renderInsights();
  });
  document.getElementById("insights-more").addEventListener("click", () => { insightsState.limit += 30; renderInsights(); });
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
