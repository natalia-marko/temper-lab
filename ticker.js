// Ticker page: everything saved about one ticker, each fact with its date.
// Reads only files the weekly and Tue/Fri jobs already publish (desk.json,
// fscore.json, earnings-calendar.json, ownership-signals.json) plus
// ticker-volume.json (weekly) and ticker-funds.json (13F, quarterly).
// Nothing is computed here beyond lookups and formatting.
// Facts, not a buy or sell call. Values are set as text; links go to sec.gov or this site.
"use strict";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FILES = { desk: "./desk.json", fscore: "./fscore.json", earnings: "./earnings-calendar.json",
  own: "./ownership-signals.json", volume: "./ticker-volume.json", funds: "./ticker-funds.json" };
const LISTS = [["strength", "Strength"], ["growth", "Growth"], ["undervalued", "Cheap"], ["conviction", "Conviction"]];
const MONEY_LABEL = {
  buy: "bought", buy_plan: "bought under a 10b5-1 plan", buy_private: "bought privately or in an offering",
  sell_no_plan: "sold without a 10b5-1 plan", sell_plan: "sold under a 10b5-1 plan", sell_tax: "sold to cover tax",
  sell_private: "sold privately", transfer: "moved between related holders",
};
const BUY_KEYS = ["buy", "buy_plan"];
const SELL_KEYS = ["sell_no_plan", "sell_plan"];
// Same labels as the Research table.
// true = a change (signed), false = a level.
const FUNDAMENTALS = [
  ["revenue_yoy", "Revenue YoY", true], ["operating_margin", "TTM operating margin", false], ["net_margin", "TTM net margin", false],
  ["roe", "Return on equity", false], ["operating_earnings_yield_ev", "OI / EV", false], ["leverage", "Liabilities / assets", false],
  ["momentum_63", "63-session return", true], ["momentum_252", "252-session return", true],
];
const FSCORE_CHECKS = [
  ["roa_positive", "Net income positive"], ["cfo_positive", "Operating cash flow positive"],
  ["roa_up", "Return on assets up on the year before"], ["cfo_above_income", "Operating cash flow above net income"],
  ["leverage_not_up", "Long-term debt / assets not up"], ["current_ratio_up", "Current ratio up"],
  ["no_new_shares", "No more shares outstanding than a year before"], ["gross_margin_up", "Gross margin up"],
  ["turnover_up", "Asset turnover (revenue / assets) up"],
];
const VOLUME_FIELDS = ["normal_volume", "volume_x_5", "volume_x_21", "up_share_5", "up_share_21", "return_5", "return_21"];
const state = { data: {}, missing: [] };
const $ = (id) => document.getElementById(id);

// ---------- formatting ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
const num = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
function money(value) {
  if (!num(value)) return "n/a";
  const v = Number(value);
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 999500) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1000) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}
function count(value) {
  if (!num(value)) return "n/a";
  const n = Number(value);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}
function pct(value, digits = 1) {
  if (!num(value)) return "n/a";
  const v = Number(value) * 100;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;
}
const level = (value) => (num(value) ? `${Number(value) < 0 ? "−" : ""}${Math.abs(Number(value) * 100).toFixed(1)}%` : "n/a");
const share = (value) => (num(value) ? `${Math.round(Number(value) * 100)}%` : "n/a");
function day(iso) {
  const [, m, d] = String(iso || "").slice(0, 10).split("-");
  return m && d ? `${Number(d)} ${MONTHS[Number(m) - 1]}` : "";
}
function longDay(iso) {
  const [y] = String(iso || "").split("-");
  return day(iso) ? `${day(iso)} ${y}` : "";
}
function monthYear(iso) {
  const [y, m] = String(iso || "").split("-");
  return m ? `${MONTHS[Number(m) - 1]} ${y}` : "";
}
function span(first, last) {
  if (!first) return "";
  return !last || first === last ? day(first) : `${day(first)}–${day(last)}`;
}
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}
function secUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.sec.gov" ? url.href : null;
  } catch { return null; }
}
// Tickers are stored with a dot for share classes (BRK.B); BRK-B and brk/b find it too.
function norm(query) {
  return String(query || "").trim().toUpperCase().replace(/[-/]/g, ".").replace(/[^A-Z0-9.]/g, "");
}

// ---------- lookups (pure: data in, facts out) ----------
function checkedRow(own, symbol) {
  const checked = own && own.checked;
  if (!checked || !Array.isArray(checked.rows)) return null;
  const f = Object.fromEntries((checked.fields || []).map((name, i) => [name, i]));
  const hit = checked.rows.find((r) => (r[f.symbols] || []).some((s) => String(s).toUpperCase() === symbol));
  if (!hit) return null;
  const get = (name) => (f[name] === undefined ? null : hit[f[name]]);
  return { symbol: get("symbol"), name: get("name"), eligible: get("eligible"), insider: get("last_insider"),
    stake: get("last_stake"), short_shares: get("short_shares"), change_pct: get("short_change_pct"),
    days_to_cover: get("days_to_cover"), rank: get("short_rank") };
}
function listsOf(desk, symbol) {
  const out = [];
  for (const [key, label] of LISTS) {
    const hit = (((desk.setups || {})[key] || {}).results || []).find((r) => r.symbol === symbol);
    if (hit) out.push(`${label} #${hit.rank}`);
  }
  return out;
}
function historyNote(own, person) {
  const h = own.history;
  const x = person.history;
  if (!h || !x) return "";
  const m = person.money || {};
  const gap = own.window && daysBetween(h.filed_until, own.window.since) > 1 ? ` (saved history to ${monthYear(h.filed_until)})` : "";
  const out = [];
  if (BUY_KEYS.some((k) => m[k])) out.push(x.last_buy ? `last bought ${monthYear(x.last_buy)}` : `first buy since ${monthYear(h.filed_from)}${gap}`);
  if (SELL_KEYS.some((k) => m[k])) out.push(x.last_sell ? `last sold ${monthYear(x.last_sell)}` : `first sale since ${monthYear(h.filed_from)}${gap}`);
  if (x.label) out.push(x.label === "routine" ? "trades in the same month every year" : "no yearly trading pattern");
  return out.join(" · ");
}
// "Last filing" dates from the checked list are not used: an issuer's SEC feed also lists filings it
// made as a holder of other companies (UBER's own 13D/A of 17 Sep 2026 is about another issuer).
function insidersOf(own, company) {
  const people = ((company && company.people) || [])
    .filter((p) => Object.values(p.money || {}).some((v) => v))
    .map((p) => {
      const h = p.holding;
      const title = (p.titles || []).find((t) => t && t !== "See Remarks");
      return {
        name: (p.names || []).join(", "), role: title ? `${p.role} · ${title}` : p.role,
        actions: Object.keys(MONEY_LABEL).filter((k) => (p.money || {})[k]).map((k) => `${MONEY_LABEL[k]} ${money(p.money[k])}`),
        dates: span(p.first_trade, p.last_trade),
        holding: !h ? "" : h.status === "new_position" ? "new holding"
          : `holding ${pct((h.side === "sale" ? -1 : 1) * Math.abs(Number(h.change_pct)) / 100)}`,
        plan: (p.plan_adopted || []).length ? `plan adopted ${p.plan_adopted.map(longDay).join(", ")}` : "",
        history: historyNote(own, p),
      };
    });
  const routine = Object.values((company && company.routine) || {}).reduce((a, b) => a + b, 0);
  return { window: own.window || {}, headline: company ? company.headline : "", people, routine,
    toCheck: (company && company.flags && company.flags.rows_to_check) || 0 };
}
function stakesOf(own, company) {
  const rows = ((company && company.stakes) || []).map((s) => ({
    form: s.form, kind: s.kind, holder: s.lead || ((s.holders || [])[0] || {}).name || "", pct: s.pct, shares: s.shares,
    event: s.event, day: s.day, exit: Boolean(s.exit), url: secUrl(s.url),
    purpose: s.kind === "13D" && s.purpose ? String(s.purpose).slice(0, 320) + (String(s.purpose).length > 320 ? "…" : "") : "",
  }));
  return { window: own.window || {}, rows };
}
function shortOf(own, company, checked) {
  const date = (own.short_interest || {}).date;
  const s = checked && num(checked.days_to_cover) ? checked : company && company.short;
  return date && s ? { date, short_shares: s.short_shares, change_pct: s.change_pct, days_to_cover: s.days_to_cover, rank: s.rank || null } : null;
}
function volumeOf(volume, symbol) {
  const row = volume && volume.rows && volume.rows[symbol];
  if (!row) return null;
  const fields = volume.fields || VOLUME_FIELDS;
  return { as_of: volume.as_of, ...Object.fromEntries(fields.map((f, i) => [f, row[i]])) };
}
function fundsOf(funds, symbol) {
  const row = funds && funds.rows && funds.rows[symbol];
  if (!funds || !funds.rows) return null;
  const base = { quarter: funds.quarter, previous: funds.previous, deadline: funds.deadline,
    continuing: (funds.managers || {}).continuing };
  if (!row) return { ...base, linked: false };
  const f = Object.fromEntries((funds.fields || []).map((name, i) => [name, row[i]]));
  const names = funds.manager_names || {};
  const people = (list) => (list || []).map(([cik, before, after, value]) => ({ name: names[cik] || `CIK ${cik}`, before, after, value }));
  return { ...base, linked: true, ...f, top_added: people(f.top_added), top_cut: people(f.top_cut) };
}
// As on Research: an fscore.json for another snapshot date is not shown.
function fscoreOf(data, symbol) {
  const f = data.fscore && data.fscore.companies && data.fscore.companies[symbol];
  return f && data.desk && data.fscore.as_of === data.desk.as_of ? { ...f, as_of: data.fscore.as_of } : null;
}
function card(data, query) {
  const symbol = norm(query);
  if (!symbol) return null;
  const own = data.own || null;
  const checked = checkedRow(own, symbol);
  const desk = (data.desk && data.desk.companies && data.desk.companies[symbol]) || null;
  const volume = volumeOf(data.volume, symbol);
  if (!checked && !desk && !volume) return { symbol, found: false };
  const company = checked ? (own.companies || []).find((c) => c.symbol === checked.symbol) || null : null;
  const calendar = data.earnings || null;
  return {
    symbol, found: true,
    name: (desk && desk.name) || (checked && checked.name) || (company && company.name) || "",
    industry: (desk && desk.industry) || (company && company.industry) || "",
    eligible: Boolean(desk), filer: checked ? checked.symbol : null, cik: company ? company.cik : null,
    research: desk ? { as_of: data.desk.as_of, price: desk.price, price_date: desk.price_date, market_cap: desk.market_cap,
      lists: listsOf(data.desk, symbol), factors: desk.factors || {}, analyst: desk.analyst || {},
      revenue_period_end: desk.revenue_period_end, revenue_filed: desk.revenue_filed, quality_filed: desk.quality_filed } : null,
    insiders: own ? insidersOf(own, company) : null,
    stakes: own ? stakesOf(own, company) : null,
    short: own ? shortOf(own, company, checked) : null,
    volume,
    funds: fundsOf(data.funds, symbol),
    fscore: fscoreOf(data, symbol),
    earnings: calendar ? { window: calendar.window || {}, next: (calendar.companies || {})[symbol] || null } : null,
  };
}

// ---------- rendering ----------
function section(title, when, ...children) {
  const box = el("section", "tk-box");
  const head = el("div", "tk-head");
  head.append(el("h2", "", title));
  if (when) head.append(el("small", "", when));
  box.append(head, ...children.filter(Boolean));
  return box;
}
function facts(rows) {
  const dl = el("dl", "tk-facts");
  for (const [label, value, note] of rows) {
    const dd = el("dd", "", value);
    if (note) dd.append(el("small", "", note));
    dl.append(el("dt", "", label), dd);
  }
  return dl;
}
const note = (text) => el("p", "tk-note", text);
function link(text, href, external) {
  const a = el("a", "tk-link", text);
  a.href = href;
  if (external) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  return a;
}
function missing(file) {
  return state.missing.includes(file) ? note(`${file} could not be loaded.`) : null;
}

function headerBox(c) {
  const box = el("section", "tk-title");
  const top = el("div", "tk-name");
  if (globalThis.TLWatch) top.append(globalThis.TLWatch.button(c.symbol, c.name));
  top.append(el("h1", "", c.symbol), el("span", "", c.name));
  box.append(top);
  const line = [c.industry];
  if (c.research && num(c.research.price)) line.push(`$${Number(c.research.price).toFixed(2)} at the ${longDay(c.research.price_date)} close`);
  if (c.research && num(c.research.market_cap)) line.push(`market value ${money(c.research.market_cap)}`);
  box.append(el("p", "tk-sub", line.filter(Boolean).join(" · ")));
  box.append(note(c.eligible
    ? `In Research (week of ${longDay(c.research.as_of)})${c.research.lists.length ? `: ${c.research.lists.join(" · ")}` : ", not on a published list"}.`
    : "Outside the Research universe (not one of this week's liquid stocks): SEC filings, short interest and volume only."));
  const links = el("div", "tk-links");
  if (c.eligible) links.append(link(`Open ${c.symbol} in Research →`, `./?q=${encodeURIComponent(c.symbol)}`));
  const sec = secUrl(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(c.cik || c.filer || c.symbol)}&owner=include&count=40`);
  if (sec) links.append(link("SEC filings ↗", sec, true));
  box.append(links);
  return box;
}
function insidersBox(c) {
  const i = c.insiders;
  if (!i) return section("Insider trades", "", missing("ownership-signals.json"));
  const when = `Form 4, filed ${longDay(i.window.since)} – ${longDay(i.window.until)}`;
  if (!i.people.length) {
    return section("Insider trades", when, note(`No insider buys or sales of ${c.symbol} filed in these ${i.window.sessions || 21} sessions.`
      + (i.routine ? ` ${i.routine} routine rows (awards, exercises, tax withholding) are not counted.` : "")));
  }
  const list = el("ul", "tk-people");
  for (const p of i.people) {
    const li = el("li");
    li.append(el("strong", "", p.name), el("span", "tk-role", p.role));
    li.append(el("div", "", [p.actions.join("; "), p.dates, p.holding].filter(Boolean).join(" · ")));
    const extra = [p.plan, p.history].filter(Boolean).join(" · ");
    if (extra) li.append(el("small", "", extra));
    list.append(li);
  }
  return section("Insider trades", when, el("p", "tk-lead", i.headline), list,
    i.routine ? note(`${i.routine} routine rows (awards, exercises, tax withholding) are not counted.`) : null,
    i.toCheck ? note(`${i.toCheck} rows are still to be checked and are left out of the amounts.`) : null,
    note("Includes officers, directors and 10% owners. A 10b5-1 plan is a trading plan set in advance."));
}
function stakesBox(c) {
  const s = c.stakes;
  if (!s) return section("5%+ holders", "", missing("ownership-signals.json"));
  const when = `Schedule 13D/13G, filed ${longDay(s.window.since)} – ${longDay(s.window.until)}`;
  if (!s.rows.length) return section("5%+ holders", when, note(`No 13D/13G about ${c.symbol} filed in this window.`));
  const list = el("ul", "tk-people");
  for (const r of s.rows) {
    const li = el("li");
    li.append(el("strong", "", r.holder), el("span", "tk-role", `${r.form} · filed ${longDay(r.day)}`));
    li.append(el("div", "", r.exit ? `now 5% or less (${num(r.pct) ? `${Number(r.pct).toFixed(1)}%` : "n/a"})`
      : `${num(r.pct) ? `${Number(r.pct).toFixed(1)}%` : "n/a"} of the class · ${count(r.shares)} shares${r.event ? ` · as of ${longDay(r.event)}` : ""}`));
    if (r.purpose) li.append(el("small", "", `Stated purpose: ${r.purpose}`));
    if (r.url) li.append(link("Filing ↗", r.url, true));
    list.append(li);
  }
  return section("5%+ holders", when, list, note("13D: an active holder, filed within 5 business days. 13G: a passive holder or institution, filed within 5 business days to 45 days after the quarter."));
}
function fundsBox(c) {
  const f = c.funds;
  if (!f) return section("Fund holdings (13F)", "", missing("ticker-funds.json") || note("Not built yet."));
  const when = `quarter to ${longDay(f.quarter)}, filed by ${longDay(f.deadline)}`;
  if (!f.linked) return section("Fund holdings (13F)", when, note(`${c.symbol} is not linked to a security in this quarter's 13F filings.`));
  const changed = num(f.shares_prev) && f.shares_prev > 0 ? `${pct(f.shares_now / f.shares_prev - 1)} vs ${day(f.previous)}${f.split_adjusted ? " (split-adjusted)" : ""}` : "";
  const rows = [
    ["Managers holding", Number(f.holders_now).toLocaleString("en-US"),
      `${num(f.holders_prev) ? `${Number(f.holders_prev).toLocaleString("en-US")} at ${longDay(f.previous)} · ` : ""}of ${Number(f.continuing || 0).toLocaleString("en-US")} that filed both quarters`],
    ["Shares held", count(f.shares_now), changed],
    ["Value", money(f.value_now), "at the quarter-end price the filers report"],
  ];
  if (num(f.new)) rows.push(["Changes", `${f.new} new, ${f.added} added`, `${f.cut} cut, ${f.exited} sold out`]);
  const list = (title, people) => {
    if (!people.length) return null;
    const box = el("div", "tk-sub-list");
    box.append(el("h3", "", title));
    const ul = el("ul", "tk-people tk-compact");
    for (const p of people) {
      const li = el("li");
      li.append(el("strong", "", p.name), el("span", "", `${p.before ? count(p.before) : "none"} → `
        + (p.after ? `${count(p.after)} shares${num(p.value) ? ` · ${money(p.value)}` : ""}` : "none (sold out)")));
      ul.append(li);
    }
    box.append(ul);
    return box;
  };
  return section("Fund holdings (13F)", when, facts(rows),
    list("Largest increases", f.top_added || []), list("Largest decreases", f.top_cut || []),
    f.left_out ? note(`${f.left_out} manager${f.left_out === 1 ? "" : "s"} left out: the reported value did not match the shares.`) : null,
    note("Managers with $100M+ report long positions within 45 days of each quarter end; no short positions. One manager can combine many funds and client accounts, so a change can be flows, not a decision. SEC publishes these data sets every three months; managers whose table in them is incomplete are left out."));
}
function shortBox(c) {
  const s = c.short;
  if (!c.insiders) return null;
  if (!s) return section("Short interest", "", note("No FINRA figure for this ticker."));
  return section("Short interest", `FINRA, settlement ${longDay(s.date)}`, facts([
    ["Shares short", count(s.short_shares), num(s.change_pct) ? `${pct(s.change_pct / 100)} since the previous report` : ""],
    ["Days to cover", num(s.days_to_cover) ? Number(s.days_to_cover).toFixed(1) : "n/a", "shares short / average daily volume"],
    ...(s.rank ? [["Among similar-size stocks", `${s.rank} shorted`, s.rank === "lightly" ? "bottom 10%" : "top 10%"]] : []),
  ]));
}
function volumeBox(c) {
  const v = c.volume;
  if (!v) return section("Volume", "", missing("ticker-volume.json") || note("No volume facts for this ticker (no full 84-session history to the freeze Friday)."));
  const x = (m) => (num(m) ? `${Number(m).toFixed(2)}× normal` : "n/a");
  return section("Volume", `daily bars to ${longDay(v.as_of)}`, facts([
    ["Normal", `${count(v.normal_volume)} shares a day`, "average of the 63 sessions before the last 21"],
    ["Last week (5 sessions)", x(v.volume_x_5), `${share(v.up_share_5)} on up days · price ${pct(v.return_5)}`],
    ["Last month (21 sessions)", x(v.volume_x_21), `${share(v.up_share_21)} on up days · price ${pct(v.return_21)}`],
  ]), note("Up-day share: volume on days the price rose, out of volume on days it rose or fell. Above 50% means on-balance volume (OBV) rose."));
}
function analystsBox(c) {
  if (!c.research) return null;
  const f = c.research.factors;
  const a = c.research.analyst;
  return section("Analysts", a.retrieved_at ? `Yahoo, retrieved ${longDay(a.retrieved_at)}` : "", facts([
    ["Ratings", num(f.analyst_total) ? String(f.analyst_total) : "n/a",
      num(f.strong_buy_count) ? `${f.strong_buy_count} strong buy (${share(f.strong_buy)})` : ""],
    ["EPS estimate changes, 30 days", num(f.up_last_30_days) || num(f.down_last_30_days) ? `${f.up_last_30_days ?? 0} up, ${f.down_last_30_days ?? 0} down` : "n/a",
      "current fiscal year"],
  ]));
}
function fundamentalsBox(c) {
  if (!c.research) return null;
  const r = c.research;
  return section("Research snapshot", `week of ${longDay(r.as_of)}`, facts(FUNDAMENTALS.map(([k, label, signed]) => [label, signed ? pct(r.factors[k]) : level(r.factors[k])])),
    note(`Revenue to ${longDay(r.revenue_period_end) || "n/a"} (filed ${longDay(r.revenue_filed) || "n/a"}); quality figures filed ${longDay(r.quality_filed) || "n/a"}.`));
}
function fscoreBox(c) {
  if (!c.research) return null;
  const f = c.fscore;
  if (!f) return section("F-Score", "", missing("fscore.json") || note("No F-Score for this week's snapshot."));
  const list = el("ul", "tk-checks");
  for (const [k, label] of FSCORE_CHECKS) {
    const v = f.checks[k];
    list.append(el("li", v === true ? "yes" : v === false ? "no" : "na", `${v === true ? "✓" : v === false ? "✗" : "–"} ${label}`));
  }
  const score = f.scored ? `${f.passed}/9${f.computed < 9 ? "*" : ""}` : "not scored";
  return section("F-Score", `10-K for the year to ${longDay(f.fy_end)}, filed ${longDay(f.filed)}`,
    facts([["Checks passed", score, f.computed < 9 ? `${f.computed} of 9 could be computed; * = a missing check counts as not passed` : ""]]), list,
    note("Piotroski's nine financial-health checks. Context, not a signal."));
}
function earningsBox(c) {
  const e = c.earnings;
  if (!e) return c.research ? section("Next results", "", missing("earnings-calendar.json")) : null;
  const when = `calendar ${longDay(e.window.from)} – ${longDay(e.window.to)}`;
  if (e.next) return section("Next results", when, facts([["Date", longDay(e.next.date), [e.next.timing, e.next.unsure ? "dates differ between sources" : ""].filter(Boolean).join(" · ")]]));
  return section("Next results", when, note(c.eligible ? "No results date in this window." : "The calendar covers Research stocks only."));
}
function render() {
  const query = $("tk-query").value;
  const out = $("tk-out");
  const c = card(state.data, query);
  if (!c) {
    out.replaceChildren(starters());
    return;
  }
  if (!c.found) {
    out.replaceChildren(note(`${c.symbol} is not in the saved data (${(state.data.own?.checked?.rows || []).length.toLocaleString("en-US")} SEC filers checked).`));
    return;
  }
  document.title = `Temper Lab — ${c.symbol}`;
  const grid = el("div", "tk-grid");
  grid.append(...[insidersBox(c), stakesBox(c), fundsBox(c), shortBox(c), volumeBox(c), analystsBox(c), earningsBox(c),
    fundamentalsBox(c), fscoreBox(c)].filter(Boolean));
  out.replaceChildren(headerBox(c), grid, note("Facts with their dates, not a buy or sell call."));
}
function starters() {
  const box = el("div", "tk-start");
  const names = globalThis.TLWatch ? globalThis.TLWatch.list().map((i) => i.symbol).sort() : [];
  box.append(note(names.length ? "Type a ticker, or pick one of your starred names:" : "Type a ticker, e.g. UBER."));
  for (const s of names) {
    const b = el("button", "tk-chip", s);
    b.type = "button";
    b.addEventListener("click", () => go(s));
    box.append(b);
  }
  return box;
}
function go(query) {
  $("tk-query").value = norm(query);
  const url = new URL(location.href);
  if (norm(query)) url.searchParams.set("t", norm(query)); else url.searchParams.delete("t");
  history.replaceState(null, "", url);
  render();
}
function setup() {
  const symbols = new Set(Object.keys(state.data.desk?.companies || {}));
  const own = state.data.own;
  if (own && own.checked) {
    const i = own.checked.fields.indexOf("symbols");
    for (const r of own.checked.rows) for (const s of r[i] || []) symbols.add(s);
  }
  $("tk-symbols").replaceChildren(...[...symbols].sort().map((s) => { const o = el("option"); o.value = s; return o; }));
  $("tk-form").addEventListener("submit", (e) => { e.preventDefault(); go($("tk-query").value); });
  if (globalThis.TLWatch) globalThis.TLWatch.onChange(() => { if (!norm($("tk-query").value)) render(); });
  const built = [state.data.desk && `Research ${longDay(state.data.desk.as_of)}`, own && `Insights to ${longDay(own.window?.until)}`].filter(Boolean);
  $("tk-built").textContent = built.join(" · ");
  $("tk-status").hidden = true;
  $("tk-query").value = norm(new URLSearchParams(location.search).get("t"));
  render();
}
function start() {
  const names = Object.keys(FILES);
  Promise.allSettled(names.map((k) => fetch(FILES[k], { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }))).then((results) => {
    results.forEach((r, i) => {
      if (r.status === "fulfilled") state.data[names[i]] = r.value;
      else state.missing.push(FILES[names[i]].slice(2));
    });
    if (state.data.own && state.data.own.schema !== "ownership-signals-1") { state.missing.push("ownership-signals.json"); delete state.data.own; }
    if (!state.data.desk && !state.data.own) throw new Error("no data");
    setup();
  }).catch((error) => {
    console.error("Ticker page could not load:", error);
    const status = $("tk-status");
    status.textContent = "The ticker data could not be loaded. Try again later.";
    status.classList.add("error");
  });
}
start();
