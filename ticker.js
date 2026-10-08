// Ticker page: everything saved about one ticker, each fact with its date.
// Reads only files the weekly and Tue/Fri jobs already publish (desk.json,
// fscore.json, earnings-calendar.json, ownership-signals.json) plus
// ticker-volume.json (weekly: volume facts and the 3-month price chart) and ticker-funds.json (13F, quarterly).
// Nothing is computed here beyond lookups, formatting, changes along the saved price line, sums of the
// dollar amounts shown, and two ratios of figures from one Research record (price / earnings, EV / operating income).
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
// Short names for the summary line and the legend.
const MONEY_SHORT = {
  buy: "bought", buy_plan: "bought under a plan", buy_private: "bought privately", sell_no_plan: "no plan",
  sell_plan: "10b5-1 plan", sell_tax: "tax", sell_private: "sold privately", transfer: "transfers",
};
const BUY_KEYS = ["buy", "buy_plan"];
const SELL_KEYS = ["sell_no_plan", "sell_plan"];
// Drawn as bars and chart marks, in this order; the other kinds are listed in text only.
// [key, legend label, colour class, chart row label]
const TRADE_KINDS = [["buy", "Bought", "k-buy", "Buy"], ["buy_plan", "Bought under a plan", "k-buyplan", "Plan buy"],
  ["sell_no_plan", "Sold, no plan", "k-noplan", "No plan"], ["sell_plan", "Sold under a plan", "k-plan", "Plan"],
  ["sell_tax", "Sold for tax", "k-tax", "Tax"]];
// Average reported prices per kind, as on Insights.
const PAID_LABEL = [["buy", "bought"], ["buy_plan", "bought under a plan"], ["sell_no_plan", "sold without a plan"], ["sell_plan", "sold under a plan"]];
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
const points = (value) => (num(value) ? `${Number(value) > 0 ? "+" : Number(value) < 0 ? "−" : ""}${Math.abs(Number(value) * 100).toFixed(1)} pts` : "n/a");
const times = (value) => (num(value) ? `${Number(value).toFixed(Number(value) < 10 ? 1 : 0)}×` : "n/a");
const whole = (value) => Number(value).toLocaleString("en-US");
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
function localToday() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
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
const sum = (values) => values.reduce((a, b) => a + (num(b) ? Number(b) : 0), 0);

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
  return movesOf(desk, symbol).map((m) => m.label);
}
// Each published list the stock is on, with its rank against last week's list.
function movesOf(desk, symbol) {
  const out = [];
  for (const [key, label] of LISTS) {
    const hit = (((desk.setups || {})[key] || {}).results || []).find((r) => r.symbol === symbol);
    if (!hit) continue;
    const screen = ((desk.trajectory || {}).screens || {})[key] || {};
    const row = screen.comparable ? (screen.rows || {})[symbol] : null;
    const before = row ? row.previous_rank : null;
    let note = "";
    if (row && row.change === "entered") note = "new on the list this week";
    else if (num(before)) note = before === hit.rank ? "same rank as last week" : `${before > hit.rank ? "up" : "down"} from #${before} last week`;
    out.push({ label: `${label} #${hit.rank}`, note });
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
// Plan adoption dates as filed: ISO dates when there are any; free text from a footnote
// ("Febuary 11, 2026") only when nothing else was parsed, so one date is not shown twice.
function planDates(list) {
  const all = (list || []).map((d) => String(d || "").trim()).filter(Boolean);
  const iso = all.filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).map(longDay).filter(Boolean);
  return [...new Set(iso.length ? iso : all)];
}
// "Last filing" dates from the checked list are not used: an issuer's SEC feed also lists filings it
// made as a holder of other companies (UBER's own 13D/A of 17 Sep 2026 is about another issuer).
function insidersOf(own, company) {
  const people = ((company && company.people) || [])
    .filter((p) => Object.values(p.money || {}).some((v) => v))
    .map((p) => {
      const h = p.holding;
      const title = (p.titles || []).find((t) => t && t !== "See Remarks");
      const plans = planDates(p.plan_adopted);
      return {
        name: (p.names || []).join(", "), role: title ? `${p.role} · ${title}` : p.role,
        money: { ...(p.money || {}) },
        actions: Object.keys(MONEY_LABEL).filter((k) => (p.money || {})[k]).map((k) => `${MONEY_LABEL[k]} ${money(p.money[k])}`),
        dates: span(p.first_trade, p.last_trade),
        holding: !h ? "" : h.status === "new_position" ? "new holding"
          : `holding ${pct((h.side === "sale" ? -1 : 1) * Math.abs(Number(h.change_pct)) / 100)}`,
        plan: plans.length ? `plan adopted ${plans.join(", ")}` : "",
        history: historyNote(own, p),
      };
    });
  const totals = {};
  for (const p of people) for (const [k, v] of Object.entries(p.money)) if (num(v) && v) totals[k] = (totals[k] || 0) + Number(v);
  const routine = Object.values((company && company.routine) || {}).reduce((a, b) => a + b, 0);
  const prices = (company && company.prices) || {};
  return { window: own.window || {}, headline: company ? company.headline : "", people, routine, totals,
    toCheck: (company && company.flags && company.flags.rows_to_check) || 0,
    trade_days: prices.trade_days || {}, filed_days: prices.filed_days || {}, paid: prices.paid || {}, close: prices.close || null,
    split_after: Boolean(prices.split_after_trades) };
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
// The 3-month line from ticker-volume.json: the stock and QQQ on one date axis, null on a day without a bar.
function priceOf(volume, symbol) {
  const chart = volume && volume.chart;
  const stock = volume && volume.closes && volume.closes[symbol];
  const days = chart && chart.days;
  if (!Array.isArray(days) || days.length < 2 || !Array.isArray(stock) || stock.length !== days.length) return null;
  const ok = (v) => num(v) && Number(v) > 0;
  const first = stock.findIndex(ok);
  const last = stock.length - 1 - [...stock].reverse().findIndex(ok);
  if (first < 0 || last <= first) return null;
  const qqq = Array.isArray(chart.qqq) && chart.qqq.length === days.length ? chart.qqq : null;
  const change = (series) => (series && ok(series[first]) && ok(series[last]) ? series[last] / series[first] - 1 : null);
  return { as_of: volume.as_of, days, stock, qqq, first, last, first_day: days[first], last_day: days[last],
    close: stock[last], change: change(stock), qqq_change: change(qqq) };
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
// Two ratios of figures from the same Research record. Not shown for a loss: a negative multiple reads as cheap.
function valuationOf(research) {
  const f = research.factors || {};
  const income = num(f.ttm_net_income) ? Number(f.ttm_net_income) : null;
  const yieldEv = num(f.operating_earnings_yield_ev) ? Number(f.operating_earnings_yield_ev) : null;
  return {
    pe: num(research.market_cap) && income > 0 ? Number(research.market_cap) / income : null,
    ev_oi: yieldEv > 0 ? 1 / yieldEv : null, oi_ev: yieldEv,
    net_income: income, ev: num(f.enterprise_value) ? Number(f.enterprise_value) : null,
    net_debt: num(f.net_debt) ? Number(f.net_debt) : null,
  };
}
// SEC filing days on the chart's date axis: when the market could know. A filing on a day without a
// session is drawn on the next session; filings after the last close are counted, not drawn.
function filingMarks(c) {
  const p = c.price;
  if (!p) return null;
  const last = p.days[p.days.length - 1];
  const snap = (d) => p.days.find((x) => x >= d) || null;
  const marks = (list) => [...new Set((list || []).map((d) => String(d || "").slice(0, 10))
    .filter((d) => d >= p.days[0] && d <= last).map(snap).filter(Boolean))].sort();
  const filed = (c.insiders && c.insiders.filed_days) || {};
  const form4 = Object.fromEntries(TRADE_KINDS.map(([k]) => [k, marks(filed[k])]).filter(([, days]) => days.length));
  const stakeDays = ((c.stakes && c.stakes.rows) || []).map((r) => r.day);
  const reportDays = [c.research && c.research.revenue_filed, c.research && c.research.quality_filed, c.fscore && c.fscore.filed];
  const later = new Set([...TRADE_KINDS.flatMap(([k]) => filed[k] || []), ...stakeDays]
    .map((d) => String(d || "").slice(0, 10)).filter((d) => d > last)).size;
  return { reports: marks(reportDays), stakes: marks(stakeDays), form4, later };
}
function card(data, query) {
  const symbol = norm(query);
  if (!symbol) return null;
  const own = data.own || null;
  const checked = checkedRow(own, symbol);
  const desk = (data.desk && data.desk.companies && data.desk.companies[symbol]) || null;
  const volume = volumeOf(data.volume, symbol);
  const price = priceOf(data.volume, symbol);
  if (!checked && !desk && !volume && !price) return { symbol, found: false };
  const company = checked ? (own.companies || []).find((c) => c.symbol === checked.symbol) || null : null;
  const calendar = data.earnings || null;
  const research = desk ? { as_of: data.desk.as_of, price: desk.price, price_date: desk.price_date, market_cap: desk.market_cap,
    lists: listsOf(data.desk, symbol), moves: movesOf(data.desk, symbol), factors: desk.factors || {}, analyst: desk.analyst || {},
    revenue_period_end: desk.revenue_period_end, revenue_filed: desk.revenue_filed, quality_filed: desk.quality_filed } : null;
  if (research) research.valuation = valuationOf(research);
  return {
    symbol, found: true,
    name: (desk && desk.name) || (checked && checked.name) || (company && company.name) || "",
    industry: (desk && desk.industry) || (company && company.industry) || "",
    eligible: Boolean(desk), filer: checked ? checked.symbol : null, cik: company ? company.cik : null,
    research,
    insiders: own ? insidersOf(own, company) : null,
    stakes: own ? stakesOf(own, company) : null,
    short: own ? shortOf(own, company, checked) : null,
    volume, price,
    funds: fundsOf(data.funds, symbol),
    fscore: fscoreOf(data, symbol),
    earnings: calendar ? { window: calendar.window || {}, next: (calendar.companies || {})[symbol] || null } : null,
  };
}
function untilText(iso, today) {
  const n = daysBetween(today, iso);
  return n > 1 ? `in ${n} days` : n === 1 ? "tomorrow" : n === 0 ? "today" : "";
}
// The summary strip: one dated line per section that has data, in page order. At most six: short
// interest, which keeps its own box under the chart, is left out first.
function glance(c) {
  const out = [];
  const p = c.price;
  if (p && num(p.change)) {
    out.push({ key: "price", title: "Price · 3 months", value: pct(p.change), target: "tk-price",
      context: [p.qqq_change !== null ? `QQQ ${pct(p.qqq_change)}` : "", `${day(p.first_day)} – ${day(p.last_day)}`].filter(Boolean).join(" · ") });
  }
  const r = c.research;
  if (r) {
    const f = r.factors;
    out.push({ key: "business", title: "Business", target: "tk-business",
      value: num(f.revenue_yoy) ? `${pct(f.revenue_yoy)} revenue` : "Revenue n/a",
      context: [r.revenue_period_end ? `year on year, quarter to ${day(r.revenue_period_end)}` : "year on year",
        num(f.operating_margin) ? `${level(f.operating_margin)} operating margin` : "",
        c.fscore && c.fscore.scored ? `F-Score ${c.fscore.passed}/9${c.fscore.computed < 9 ? "*" : ""}` : ""].filter(Boolean).join(" · ") });
    const up = num(f.up_last_30_days) ? Number(f.up_last_30_days) : null;
    const down = num(f.down_last_30_days) ? Number(f.down_last_30_days) : null;
    if (up !== null || down !== null) {
      out.push({ key: "expectations", title: r.analyst.retrieved_at ? `EPS estimates · ${day(r.analyst.retrieved_at)}` : "EPS estimates",
        target: "tk-business", value: `${up ?? 0} up · ${down ?? 0} down`,
        context: ["changes in 30 days, current fiscal year", num(f.analyst_total) && num(f.strong_buy_count)
          ? `${f.strong_buy_count} of ${f.analyst_total} ratings strong buy` : ""].filter(Boolean).join(" · ") });
    }
    const v = r.valuation;
    out.push({ key: "valuation", title: `Valuation · ${day(r.price_date)}`, target: "tk-business",
      value: v.pe !== null ? `${times(v.pe)} earnings` : v.net_income !== null && v.net_income <= 0 ? "Net loss" : "P/E n/a",
      context: [v.ev_oi !== null ? `${times(v.ev_oi)} EV / operating income` : v.oi_ev !== null ? "operating loss" : "",
        v.net_debt === null ? "" : v.net_debt >= 0 ? `net debt ${money(v.net_debt)}` : `net cash ${money(-v.net_debt)}`].filter(Boolean).join(" · ") });
  }
  const i = c.insiders;
  if (i) {
    const t = i.totals;
    const bought = sum([t.buy, t.buy_plan, t.buy_private]);
    const sold = sum([t.sell_no_plan, t.sell_plan, t.sell_tax, t.sell_private]);
    out.push({ key: "insiders", title: `Insiders · ${i.window.sessions || 21} sessions`, target: "tk-owners",
      value: bought && sold ? `Bought ${money(bought)} · sold ${money(sold)}` : sold ? `Sold ${money(sold)}` : bought ? `Bought ${money(bought)}`
        : i.people.length ? "Transfers only" : "No buys or sales",
      context: i.people.length ? Object.keys(MONEY_LABEL).filter((k) => t[k]).map((k) => `${MONEY_SHORT[k]} ${money(t[k])}`).join(" · ")
        : `Form 4, filed ${day(i.window.since)} – ${day(i.window.until)}` });
  }
  const f = c.funds;
  if (f && f.linked && num(f.holders_now)) {
    const diff = num(f.holders_prev) ? Number(f.holders_now) - Number(f.holders_prev) : null;
    out.push({ key: "funds", title: `Funds (13F) · ${day(f.quarter)}`, target: "tk-owners",
      value: `${whole(f.holders_now)} managers`,
      context: [diff !== null ? `${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${whole(Math.abs(diff))} since ${day(f.previous)}` : "",
        num(f.shares_prev) && f.shares_prev > 0 ? `shares held ${pct(f.shares_now / f.shares_prev - 1)}` : ""].filter(Boolean).join(" · ") });
  }
  const s = c.short;
  if (s) {
    out.push({ key: "short", title: `Short interest · ${day(s.date)}`, target: "tk-price",
      value: num(s.days_to_cover) ? `${Number(s.days_to_cover).toFixed(1)} days to cover` : `${count(s.short_shares)} short`,
      context: [`${count(s.short_shares)} shares short`, num(s.change_pct) ? `${pct(s.change_pct / 100)} since the previous report` : ""].filter(Boolean).join(" · ") });
  }
  return out.length > 6 ? out.filter((item) => item.key !== "short") : out;
}

// ---------- rendering ----------
const SVG = "http://www.w3.org/2000/svg";
function svg(tag, attrs, parent, text) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  if (parent) parent.append(node);
  return node;
}
function section(title, when, ...children) {
  const box = el("section", "tk-box");
  const head = el("div", "tk-head");
  head.append(el("h3", "", title));
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
function band(id, title, when, className, ...columns) {
  const head = el("div", "tk-band-head");
  head.id = id;
  head.append(el("h2", "", title));
  if (when) head.append(el("small", "", when));
  const grid = el("div", `tk-band ${className}`);
  grid.append(...columns.filter(Boolean));
  return [head, grid];
}
// Detail that stays one click away; the summary line says what is inside.
function more(summary, ...children) {
  const box = el("details", "tk-more");
  box.append(el("summary", "", summary), ...children.filter(Boolean));
  return box;
}
function stack(...boxes) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  const s = el("div", "tk-stack");
  s.append(...list);
  return s;
}
// A bar with a reference mark: `value` and `mark` on a 0..`max` scale.
function meter(value, max, mark, cls) {
  const m = el("div", `tk-meter${cls ? ` ${cls}` : ""}`);
  const fill = el("i");
  fill.style.width = `${Math.max(0, Math.min(1, Number(value) / max)) * 100}%`;
  m.append(fill);
  if (mark !== null && mark !== undefined) {
    const ref = el("span", "tk-ref");
    ref.style.left = `${(mark / max) * 100}%`;
    m.append(ref);
  }
  return m;
}
function sparkline(p) {
  const W = 120, H = 34, P = 3;
  const s = svg("svg", { class: "tk-spark", viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
  const known = p.stock.filter((v) => num(v) && v > 0);
  const lo = Math.min(...known), hi = Math.max(...known);
  const x = (i) => P + (i / (p.stock.length - 1)) * (W - 2 * P);
  const y = (v) => P + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * P);
  let d = "";
  p.stock.forEach((v, i) => { if (num(v) && v > 0) d += `${d && num(p.stock[i - 1]) ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
  svg("path", { d, class: "tk-ln stock", "stroke-width": 1.5 }, s);
  svg("circle", { cx: x(p.last), cy: y(p.stock[p.last]), r: 3, class: "tk-dot stock" }, s);
  return s;
}

function headerBox(c) {
  const box = el("section", "tk-title");
  const left = el("div");
  const top = el("div", "tk-name");
  if (globalThis.TLWatch) top.append(globalThis.TLWatch.button(c.symbol, c.name));
  top.append(el("h1", "", c.symbol), el("span", "", c.name));
  left.append(top);
  const line = [c.industry];
  if (c.research && num(c.research.market_cap)) line.push(`market value ${money(c.research.market_cap)}`);
  left.append(el("p", "tk-sub", line.filter(Boolean).join(" · ")));
  const chips = el("div", "tk-chips");
  const next = c.earnings && c.earnings.next;
  if (next) {
    const when = untilText(next.date, localToday());
    chips.append(el("span", "tk-chip event", [`Next results ${longDay(next.date)}`, next.timing, when,
      next.unsure ? "dates differ between sources" : ""].filter(Boolean).join(" · ")));
  } else if (c.eligible && c.earnings) {
    chips.append(el("span", "tk-chip quiet", `No results date to ${longDay(c.earnings.window.to)}`));
  }
  if (c.research) {
    for (const m of c.research.moves) chips.append(el("span", "tk-chip", m.note ? `${m.label} · ${m.note}` : m.label));
  }
  if (c.eligible) chips.append(link(`Open ${c.symbol} in Research →`, `./?q=${encodeURIComponent(c.symbol)}`));
  const sec = secUrl(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(c.cik || c.filer || c.symbol)}&owner=include&count=40`);
  if (sec) chips.append(link("SEC filings ↗", sec, true));
  left.append(chips);
  left.append(note(c.eligible
    ? `In Research, week of ${longDay(c.research.as_of)}${c.research.lists.length ? "" : "; not on a published list"}.`
    : "Outside the Research universe (not one of this week's liquid stocks): price, SEC filings, short interest and volume only."));
  box.append(left);
  if (c.research && num(c.research.price)) {
    const price = el("div", "tk-price");
    price.append(el("b", "", `$${Number(c.research.price).toFixed(2)}`), el("span", "", `${longDay(c.research.price_date)} close`));
    box.append(price);
  }
  return box;
}
function glanceBox(c) {
  const items = glance(c);
  if (!items.length) return null;
  const box = el("section", "tk-glance");
  box.setAttribute("aria-label", `${c.symbol} at a glance`);
  const cols = items.length <= 4 ? items.length : 3;
  box.style.setProperty("--cols", String(cols));
  box.style.setProperty("--cols-mid", String(Math.min(cols, 2)));
  const inner = el("div", "tk-glance-in");
  for (const item of items) {
    const a = el("a", "tk-cell");
    a.href = `#${item.target}`;
    a.append(el("span", "tk-k", item.title));
    const v = el("span", "tk-v", item.value);
    if (item.key === "price") v.append(sparkline(c.price));
    a.append(v, el("span", "tk-c", item.context));
    inner.append(a);
  }
  box.append(inner);
  return box;
}

function priceBox(c) {
  const p = c.price;
  if (!p) return section("Price vs QQQ, 3 months", "", missing("ticker-volume.json") || note("No reliable 3-month price line for this ticker this week (fewer than half the days, or a split mix-up in the price data)."));
  const W = 720, L = 54, R = 96, T = 26, PB = 196;
  const n = p.days.length;
  const rebase = (series, i0) => (series ? series.map((v) => (num(v) && v > 0 && num(series[i0]) ? v / series[i0] - 1 : null)) : null);
  const a = rebase(p.stock, p.first);
  const q = rebase(p.qqq, p.first);
  const all = [...a, ...(q || [])].filter((v) => v !== null);
  // Round the scale out to whole steps (at most five) so every gridline names a value inside the drawing.
  const range = Math.max(...all, 0) - Math.min(...all, 0);
  const step = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10].find((s) => range / s <= 5) || 20;
  const lo = Math.min(0, Math.floor(Math.min(...all) / step) * step), hi = Math.max(0, Math.ceil(Math.max(...all) / step) * step);
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (PB - T);
  const i = c.insiders;
  const lastDay = p.days[n - 1];
  const marks = filingMarks(c);
  // One row per kind of filing: the company's own reports, 13D/13G stakes, then Form 4 by kind.
  const rows = [
    ...(marks.reports.length ? [["Report", "k-report", marks.reports, "Report filed with the SEC", "report filed"]] : []),
    ...(marks.stakes.length ? [["13D/G", "k-stake", marks.stakes, "13D/13G filed", "13D/13G filed"]] : []),
    ...TRADE_KINDS.filter(([k]) => marks.form4[k]).map(([k, label, cls, rowLabel]) =>
      [rowLabel, cls, marks.form4[k], `Form 4: ${label.toLowerCase()}`, `Form 4 filed: ${label.toLowerCase()}`]),
  ];
  const H = PB + 26 + rows.length * 18 + (rows.length ? 8 : 0);
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: "0",
    "aria-label": `${c.symbol} ${pct(p.change)} from ${longDay(p.first_day)} to ${longDay(p.last_day)}${p.qqq_change !== null ? `, QQQ ${pct(p.qqq_change)}` : ""}. Left and right arrow keys read each day.` });
  for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + 1e-9; t += step) {
    const v = Math.abs(t) < 1e-9 ? 0 : t;
    svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? "tk-zero" : "tk-grid" }, chart);
    svg("text", { x: L - 6, y: y(v) + 3.5, "text-anchor": "end", class: "tk-tick" }, chart, v === 0 ? "0%" : pct(v, 0));
  }
  const path = (vals) => {
    let d = "";
    vals.forEach((v, k) => { if (v !== null) d += `${d && vals[k - 1] !== null ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`; });
    return d;
  };
  const known = a.map((v, k) => (v === null ? null : k)).filter((k) => k !== null);
  svg("path", { d: `${path(a)}L${x(known[known.length - 1]).toFixed(1)},${y(0).toFixed(1)}L${x(known[0]).toFixed(1)},${y(0).toFixed(1)}Z`, class: "tk-area" }, chart);
  if (q) svg("path", { d: path(q), class: "tk-ln qqq" }, chart);
  svg("path", { d: path(a), class: "tk-ln stock" }, chart);
  // End labels, pushed apart when the two lines finish close together.
  let ya = y(a[p.last]);
  let yq = q && q[p.last] !== null ? y(q[p.last]) : null;
  if (yq !== null && Math.abs(ya - yq) < 14) { const m = (ya + yq) / 2; [ya, yq] = ya <= yq ? [m - 7, m + 7] : [m + 7, m - 7]; }
  if (yq !== null) svg("circle", { cx: x(p.last), cy: y(q[p.last]), r: 3.5, class: "tk-dot qqq" }, chart);
  svg("circle", { cx: x(p.last), cy: y(a[p.last]), r: 4.5, class: "tk-dot stock" }, chart);
  svg("text", { x: x(n - 1) + 9, y: ya + 4, class: "tk-tick strong" }, chart, `${c.symbol} ${pct(a[p.last])}`);
  if (yq !== null) svg("text", { x: x(n - 1) + 9, y: yq + 4, class: "tk-tick" }, chart, `QQQ ${pct(q[p.last])}`);
  const next = c.earnings && c.earnings.next;
  if (next && next.date > lastDay) svg("text", { x: W - R, y: T - 12, "text-anchor": "end", class: "tk-tick event" }, chart, `Next results ${day(next.date)} →`);
  svg("text", { x: x(0), y: PB + 16, class: "tk-tick" }, chart, day(p.days[0]));
  p.days.forEach((d, k) => {
    if (k > 4 && k < n - 6 && d.slice(5, 7) !== p.days[k - 1].slice(5, 7)) svg("text", { x: x(k), y: PB + 16, "text-anchor": "middle", class: "tk-tick" }, chart, MONTHS[Number(d.slice(5, 7)) - 1]);
  });
  svg("text", { x: x(n - 1), y: PB + 16, "text-anchor": "end", class: "tk-tick" }, chart, day(lastDay));
  // Filing days on the same date axis; the company's own reports also get a line through the price.
  for (const d of marks.reports) svg("line", { x1: x(p.days.indexOf(d)), x2: x(p.days.indexOf(d)), y1: T, y2: PB, class: "tk-report-line" }, chart);
  rows.forEach(([rowLabel, cls, days], r) => {
    const ty = PB + 40 + r * 18;
    svg("line", { x1: L, x2: W - R, y1: ty, y2: ty, class: "tk-track" }, chart);
    svg("text", { x: L - 6, y: ty + 3.5, "text-anchor": "end", class: "tk-tick" }, chart, rowLabel);
    for (const d of days) {
      const at = p.days.indexOf(d);
      if (at >= 0) svg("rect", { x: x(at) - 2.5, y: ty - 6, width: 5, height: 12, rx: 2, class: cls }, chart);
    }
  });
  // Hover and keyboard readout.
  const cross = svg("line", { y1: T, y2: H - 4, class: "tk-cross", visibility: "hidden" }, chart);
  const da = svg("circle", { r: 4.5, class: "tk-dot stock", visibility: "hidden" }, chart);
  const dq = svg("circle", { r: 3.5, class: "tk-dot qqq", visibility: "hidden" }, chart);
  const wrap = el("div", "tk-chart");
  const tip = el("div", "tk-tip");
  tip.hidden = true;
  let cur = p.last;
  const show = (k) => {
    cur = Math.max(0, Math.min(n - 1, k));
    const on = a[cur] !== null;
    cross.setAttribute("visibility", "visible");
    cross.setAttribute("x1", x(cur)); cross.setAttribute("x2", x(cur));
    da.setAttribute("visibility", on ? "visible" : "hidden");
    if (on) { da.setAttribute("cx", x(cur)); da.setAttribute("cy", y(a[cur])); }
    const qon = q && q[cur] !== null;
    dq.setAttribute("visibility", qon ? "visible" : "hidden");
    if (qon) { dq.setAttribute("cx", x(cur)); dq.setAttribute("cy", y(q[cur])); }
    const filedHere = rows.filter(([, , days]) => days.includes(p.days[cur])).map((row) => row[4]);
    tip.replaceChildren(el("b", "", longDay(p.days[cur])),
      el("div", "", on ? `${c.symbol} $${Number(p.stock[cur]).toLocaleString("en-US", { maximumFractionDigits: 2 })} · ${pct(a[cur])}` : `${c.symbol}: no trade this day`));
    if (qon) tip.append(el("div", "", `QQQ ${pct(q[cur])}`));
    for (const text of filedHere) tip.append(el("div", "tk-tip-trade", text));
    tip.hidden = false;
    const px = (x(cur) / W) * wrap.clientWidth;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(wrap.clientWidth - w, px > wrap.clientWidth / 2 ? px - w - 12 : px + 12))}px`;
  };
  const hide = () => { for (const node of [cross, da, dq]) node.setAttribute("visibility", "hidden"); tip.hidden = true; };
  chart.addEventListener("pointermove", (e) => {
    const box = chart.getBoundingClientRect();
    show(Math.round((((e.clientX - box.left) / box.width) * W - L) / (W - L - R) * (n - 1)));
  });
  chart.addEventListener("pointerleave", hide);
  chart.addEventListener("blur", hide);
  chart.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); show(cur + (e.key === "ArrowRight" ? 1 : -1)); }
    if (e.key === "Escape") hide();
  });
  wrap.append(chart, tip);
  const legend = el("div", "tk-legend");
  const item = (cls, text) => { const s = el("span"); s.append(el("i", cls), text); return s; };
  legend.append(item("tk-sw-line", c.symbol));
  if (q) legend.append(item("tk-sw-line qqq", "QQQ"));
  for (const [, cls, , label] of rows) legend.append(item(`tk-sw ${cls}`, label));
  const notes = [];
  if (rows.length) notes.push("Marks are SEC filing days, when the market could know; a Form 4 is due within two business days of the trade.");
  if (marks.later) notes.push(`${marks.later} filing day${marks.later === 1 ? "" : "s"} after ${day(lastDay)} ${marks.later === 1 ? "is" : "are"} not on the chart yet.`);
  if (i) {
    const paid = PAID_LABEL.filter(([k]) => i.paid[k] && num(i.paid[k].avg)).map(([k, label]) => {
      const pp = i.paid[k];
      return `${label} at $${Number(pp.avg).toFixed(2)}${pp.low !== pp.high ? ` ($${Number(pp.low).toFixed(2)}–$${Number(pp.high).toFixed(2)})` : ""}`;
    });
    if (paid.length) {
      // Compared with the chart's last close: the Research price when it is for the same day.
      const close = c.research && c.research.price_date === lastDay && num(c.research.price) ? Number(c.research.price) : Number(p.close);
      notes.push(`Average prices: insiders ${paid.join("; ")}. ${i.split_after
        ? "A stock split was recorded during or after these trades, so these prices do not compare with today's."
        : `${c.symbol} closed at $${close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on ${day(p.last_day)}.`}`);
    }
  }
  return section("Price vs QQQ, 3 months", `daily closes, ${longDay(p.days[0])} – ${longDay(lastDay)}`, legend, wrap,
    note(["Hover, or focus the chart and use the arrow keys, to read each day.", ...notes].join(" ")));
}
function volumeBox(c) {
  const v = c.volume;
  if (!v) return section("Volume", "", missing("ticker-volume.json") || note("No volume facts for this ticker (no full 84-session history to the freeze Friday)."));
  const row = (label, x, up, ret) => {
    const r = el("div", "tk-mrow");
    const top = el("div", "tk-mtop");
    top.append(el("span", "", label), el("b", "", `${num(x) ? `${Number(x).toFixed(2)}× normal` : "n/a"} · price ${pct(ret)}`));
    r.append(...[top, num(x) ? meter(x, 2, 1) : null, el("small", "", `${share(up)} of volume on up days`)].filter(Boolean));
    return r;
  };
  const scale = el("div", "tk-scale");
  scale.append(el("span", "", "0×"), el("span", "", "1× normal"), el("span", "", "2×"));
  return section("Volume", `to ${longDay(v.as_of)} · normal ${count(v.normal_volume)} shares a day`,
    row("Last week (5 sessions)", v.volume_x_5, v.up_share_5, v.return_5),
    row("Last month (21 sessions)", v.volume_x_21, v.up_share_21, v.return_21), scale);
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
function financialsBox(c) {
  const r = c.research;
  const f = r.factors;
  const v = r.valuation;
  const table = el("table", "tk-fin");
  const body = el("tbody");
  const group = (title, when) => {
    const tr = el("tr");
    const th = el("th", "", title);
    th.colSpan = 3;
    if (when) th.append(el("small", "", when));
    tr.append(th);
    body.append(tr);
  };
  const line = (label, value, extra) => {
    const tr = el("tr");
    tr.append(el("td", "", label), el("td", "tk-fv", value), el("td", "tk-fn", extra || ""));
    body.append(tr);
  };
  group("Growth", r.revenue_period_end ? `quarter to ${longDay(r.revenue_period_end)}, filed ${longDay(r.revenue_filed) || "n/a"}` : "");
  line("Revenue, year on year", pct(f.revenue_yoy));
  line("Change in that growth", points(f.acceleration), "against the quarter before");
  group("Profitability", `trailing 12 months, filed ${longDay(r.quality_filed) || "n/a"}`);
  line("Operating margin", level(f.operating_margin));
  line("Net margin", level(f.net_margin), v.net_income !== null ? `net income ${v.net_income < 0 ? "−" : ""}${money(Math.abs(v.net_income))}` : "");
  line("Cash conversion", num(f.cash_conversion) ? `${Number(f.cash_conversion).toFixed(2)}×` : "n/a", "operating cash flow / net income");
  line("Return on equity", level(f.roe));
  group("Valuation", `at the ${longDay(r.price_date)} close`);
  line("Price / earnings", v.pe !== null ? times(v.pe) : v.net_income !== null && v.net_income <= 0 ? "net loss" : "n/a", "market value / net income");
  line("EV / operating income", v.ev_oi !== null ? times(v.ev_oi) : v.oi_ev !== null ? "operating loss" : "n/a", `OI / EV on Research: ${level(v.oi_ev)}`);
  line("Enterprise value", money(v.ev), v.net_debt === null ? "" : v.net_debt >= 0 ? `net debt ${money(v.net_debt)}` : `net cash ${money(-v.net_debt)}`);
  group("Balance sheet");
  line("Liabilities / assets", level(f.leverage));
  group("Price trend", `to ${longDay(r.price_date)}`);
  line("63 sessions", pct(f.momentum_63));
  line("252 sessions", pct(f.momentum_252));
  line("6 months, minus QQQ", points(f.relative_strength_6m), "the stock's 6-month return minus QQQ's");
  table.append(body);
  return section("Financials", `Research snapshot, week of ${longDay(r.as_of)}`, table);
}
function fscoreBox(c) {
  const f = c.fscore;
  if (!f) return section("F-Score", "", missing("fscore.json") || note("No F-Score for this week's snapshot."));
  const cells = el("div", "tk-fs");
  cells.setAttribute("role", "img");
  cells.setAttribute("aria-label", f.scored ? `${f.passed} of 9 checks passed` : "not scored");
  const check = (k, label) => {
    const v = f.checks[k];
    return el("li", v === true ? "yes" : v === false ? "no" : "na", `${v === true ? "✓" : v === false ? "✗" : "–"} ${label}`);
  };
  for (const [k] of FSCORE_CHECKS) {
    const v = f.checks[k];
    cells.append(el("i", v === true ? "yes" : v === false ? "no" : "na"));
  }
  // Failed and missing checks stay in view; all nine, in order, are one click away.
  const open = FSCORE_CHECKS.filter(([k]) => f.checks[k] !== true);
  const list = el("ul", "tk-checks");
  list.append(...open.map(([k, label]) => check(k, label)));
  const all = el("ul", "tk-checks");
  all.append(...FSCORE_CHECKS.map(([k, label]) => check(k, label)));
  const score = f.scored ? `${f.passed}/9${f.computed < 9 ? "*" : ""}` : "not scored";
  return section(`F-Score ${score}`, `10-K for the year to ${longDay(f.fy_end)}, filed ${longDay(f.filed)}`, cells,
    open.length ? list : note("All nine checks passed."), more("All nine checks", all),
    f.computed < 9 ? note(`${f.computed} of 9 could be computed; * = a missing check counts as not passed.`) : null);
}
function analystsBox(c) {
  const f = c.research.factors;
  const a = c.research.analyst;
  const up = num(f.up_last_30_days) ? Number(f.up_last_30_days) : null;
  const down = num(f.down_last_30_days) ? Number(f.down_last_30_days) : null;
  const rev = el("div", "tk-mrow");
  const top = el("div", "tk-mtop");
  top.append(el("span", "", "EPS estimates, last 30 days"), el("b", "", up === null && down === null ? "n/a" : `${up ?? 0} up · ${down ?? 0} down`));
  rev.append(top);
  if ((up || 0) + (down || 0) > 0) {
    const split = el("div", "tk-split");
    split.setAttribute("role", "img");
    split.setAttribute("aria-label", `${up ?? 0} up, ${down ?? 0} down`);
    if (up) { const i = el("i", "up"); i.style.flex = String(up); split.append(i); }
    if (down) { const i = el("i", "down"); i.style.flex = String(down); split.append(i); }
    rev.append(split);
  }
  rev.append(el("small", "", "current fiscal year"));
  const sb = el("div", "tk-mrow");
  const sbTop = el("div", "tk-mtop");
  sbTop.append(el("span", "", "Strong buy"), el("b", "", num(f.analyst_total)
    ? `${num(f.strong_buy_count) ? f.strong_buy_count : "n/a"} of ${f.analyst_total} ratings${num(f.strong_buy) ? ` (${share(f.strong_buy)})` : ""}` : "n/a"));
  sb.append(...[sbTop, num(f.strong_buy) ? meter(f.strong_buy, 1, null, "soft") : null].filter(Boolean));
  return section("Analysts", a.retrieved_at ? `Yahoo, retrieved ${longDay(a.retrieved_at)}` : "", rev, sb);
}
function insidersBox(c) {
  const i = c.insiders;
  if (!i) return section("Insider trades", "", missing("ownership-signals.json"));
  const when = `Form 4, filed ${longDay(i.window.since)} – ${longDay(i.window.until)}`;
  if (!i.people.length) {
    return section("Insider trades", when, note(`No insider buys or sales of ${c.symbol} filed in these ${i.window.sessions || 21} sessions.`
      + (i.routine ? ` ${i.routine} routine rows (awards, exercises, tax withholding) are not counted.` : "")));
  }
  const legend = el("div", "tk-legend");
  for (const k of Object.keys(MONEY_LABEL).filter((kk) => i.totals[kk])) {
    const kind = TRADE_KINDS.find(([kk]) => kk === k);
    const s = el("span");
    if (kind) s.append(el("i", `tk-sw ${kind[2]}`));
    s.append(`${MONEY_SHORT[k][0].toUpperCase()}${MONEY_SHORT[k].slice(1)} ${money(i.totals[k])}`);
    legend.append(s);
  }
  const barTotal = (p) => sum(TRADE_KINDS.map(([k]) => p.money[k]));
  const max = Math.max(...i.people.map(barTotal), 1);
  const list = el("div", "tk-ins");
  for (const p of i.people) {
    const row = el("div", "tk-ins-row");
    const who = el("div", "tk-who");
    const name = el("div");
    name.append(el("strong", "", p.name), el("span", "", p.role));
    who.append(name, el("b", "", money(sum(Object.values(p.money)))));
    row.append(who);
    if (barTotal(p) > 0) {
      const bar = el("div", "tk-stackbar");
      bar.style.width = `${(barTotal(p) / max) * 100}%`;
      for (const [k, label, cls] of TRADE_KINDS) {
        if (!(num(p.money[k]) && p.money[k] > 0)) continue;
        const seg = el("i", cls);
        seg.style.flex = String(p.money[k]);
        seg.title = `${label}: ${money(p.money[k])}`;
        bar.append(seg);
      }
      row.append(bar);
    }
    row.append(el("small", "", [p.dates && `traded ${p.dates}`, p.holding].filter(Boolean).join(" · ")));
    list.append(row);
  }
  const detail = el("div", "tk-ins-detail");
  for (const p of i.people) {
    const row = el("div");
    row.append(el("strong", "", p.name), el("div", "", p.actions.join("; ")));
    const extra = [p.plan, p.history].filter(Boolean).join(" · ");
    if (extra) row.append(el("small", "", extra));
    detail.append(row);
  }
  return section("Insider trades", when, el("p", "tk-lead", i.headline), legend, list,
    more(`Each person: amounts by kind, 10b5-1 plan dates, trading history`, detail),
    i.routine ? note(`${i.routine} routine rows (awards, exercises, tax withholding) are not counted.`) : null,
    i.toCheck ? note(`${i.toCheck} rows are still to be checked and are left out of the amounts.`) : null);
}
function stakesBox(c) {
  const s = c.stakes;
  if (!s) return section("5%+ holders", "", missing("ownership-signals.json"));
  const when = `Schedule 13D/13G, filed ${longDay(s.window.since)} – ${longDay(s.window.until)}`;
  if (!s.rows.length) {
    const slim = el("div", "tk-slim");
    slim.append(el("b", "", "5%+ holders (13D / 13G)"), el("span", "", `None filed about ${c.symbol} from ${longDay(s.window.since)} to ${longDay(s.window.until)}.`));
    return slim;
  }
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
  return section("5%+ holders", when, list);
}
function fundsBox(c) {
  const f = c.funds;
  if (!f) return section("Funds (13F)", "", missing("ticker-funds.json") || note("Not built yet."));
  const when = `quarter to ${longDay(f.quarter)}, filed by ${longDay(f.deadline)}`;
  if (!f.linked) return section("Funds (13F)", when, note(`${c.symbol} is not linked to a security in this quarter's 13F filings.`));
  const changed = num(f.shares_prev) && f.shares_prev > 0 ? `${pct(f.shares_now / f.shares_prev - 1)} vs ${day(f.previous)}${f.split_adjusted ? " (split-adjusted)" : ""}` : "";
  const parts = [facts([
    ["Managers holding", num(f.holders_prev) ? `${whole(f.holders_prev)} → ${whole(f.holders_now)}` : whole(f.holders_now),
      `${num(f.holders_prev) ? `${day(f.previous)} → ${day(f.quarter)} · ` : ""}of ${whole(f.continuing || 0)} that filed both quarters`],
    ["Shares held", count(f.shares_now), [changed, `${money(f.value_now)} at the quarter-end price the filers report`].filter(Boolean).join(" · ")],
  ])];
  if (num(f.new)) {
    const out = sum([f.cut, f.exited]), inn = sum([f.new, f.added]), side = Math.max(out, inn, 1);
    const flow = el("div", "tk-flow");
    flow.setAttribute("role", "img");
    flow.setAttribute("aria-label", `${f.exited} sold out, ${f.cut} cut, ${f.new} new, ${f.added} added`);
    const l = el("div", "l"), r = el("div", "r");
    const seg = (value, cls) => { const s = el("i", cls); s.style.width = `${(Number(value || 0) / side) * 100}%`; s.title = String(value); return s; };
    l.append(seg(f.exited, "exited"), seg(f.cut, "cut"));
    r.append(seg(f.new, "new"), seg(f.added, "added"));
    flow.append(l, r);
    const key = el("div", "tk-flow-key");
    key.append(el("div", "", `${whole(f.exited)} sold out · ${whole(f.cut)} cut`), el("div", "", `${whole(f.new)} new · ${whole(f.added)} added`));
    const box = el("div");
    box.append(flow, key);
    parts.push(box);
  }
  const lists = [["Largest increases", f.top_added || [], "up"], ["Largest decreases", f.top_cut || [], "down"]].filter(([, people]) => people.length);
  if (lists.length) {
    const scale = Math.max(...lists.flatMap(([, people]) => people.flatMap((p) => [Number(p.before) || 0, Number(p.after) || 0])), 1);
    const at = (v) => `${((Number(v) || 0) / scale) * 100}%`;
    const box = el("div", "tk-db");
    for (const [title, people, cls] of lists) {
      box.append(el("h4", "", title));
      for (const p of people) {
        const row = el("div", `tk-db-row ${cls}`);
        const name = el("span", "tk-db-name", p.name);
        if (num(p.value) && p.after) name.append(el("small", "", ` · ${money(p.value)}`));
        const bar = el("div", "tk-db-bar");
        const segment = el("i", "seg");
        segment.style.left = at(Math.min(p.before || 0, p.after || 0));
        segment.style.width = at(Math.abs((p.after || 0) - (p.before || 0)));
        const before = el("i", "before");
        before.style.left = at(p.before);
        const after = el("i", "after");
        after.style.left = at(p.after);
        bar.append(segment, before, after);
        row.title = `${p.name}: ${p.before ? count(p.before) : "none"} shares on ${longDay(f.previous)}, ${p.after ? count(p.after) : "none (sold out)"} on ${longDay(f.quarter)}`;
        row.append(name, bar, el("span", "tk-db-val", `${p.before ? count(p.before) : "none"} → ${p.after ? count(p.after) : "none"}`));
        box.append(row);
      }
    }
    box.append(note(`One scale for both lists, 0 to ${count(scale)} shares. ○ ${day(f.previous)} · ● ${day(f.quarter)}.`));
    parts.push(more(`Largest increases and decreases by manager, ${day(f.previous)} → ${day(f.quarter)}`, box));
  }
  if (f.left_out) parts.push(note(`${f.left_out} manager${f.left_out === 1 ? "" : "s"} left out: the reported value did not match the shares.`));
  return section("Funds (13F)", when, ...parts);
}
function aboutBox(c) {
  const box = el("details", "tk-about");
  box.append(el("summary", "", "About the data"));
  const ul = el("ul");
  const lines = [
    "Price: adjusted daily closes to the freeze Friday, the same day as the Research snapshot. No line when fewer than half the days have a close or a one-day move is beyond 3× (a split mix-up in the price data).",
    "Valuation: price / earnings is market value over trailing net income; EV / operating income is the inverse of OI / EV on Research. Neither is shown for a loss.",
    "Insider trades include officers, directors and 10% owners. A 10b5-1 plan is a trading plan set in advance.",
    "13D: an active holder, filed within 5 business days. 13G: a passive holder or institution, filed within 5 business days to 45 days after the quarter.",
    "13F: managers with $100M+ report long positions within 45 days of each quarter end; no short positions. One manager can combine many funds and client accounts, so a change can be flows, not a decision. SEC publishes these data sets every three months; managers whose table in them is incomplete are left out.",
    "Volume: normal is the average of the 63 sessions before the last 21. Up-day share is volume on days the price rose, out of volume on days it rose or fell; above 50% means on-balance volume (OBV) rose.",
    "F-Score: Piotroski's nine financial-health checks. Context, not a signal.",
  ];
  ul.append(...lines.map((t) => el("li", "", t)));
  box.append(ul);
  return box;
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
  const research = c.research
    ? band("tk-business", "The business", `Research snapshot, week of ${longDay(c.research.as_of)}`, "biz",
      financialsBox(c), stack(fscoreBox(c), analystsBox(c)))
    : [];
  out.replaceChildren(headerBox(c), ...[glanceBox(c)].filter(Boolean),
    ...band("tk-price", "Price and trading", "", "wide", priceBox(c), stack(volumeBox(c), shortBox(c))),
    ...research,
    ...band("tk-owners", "Who owns and trades it", "SEC Form 4, 13D/13G and 13F filings", "own",
      stack(insidersBox(c), stakesBox(c)), fundsBox(c)),
    aboutBox(c), note("Facts with their dates, not a buy or sell call."));
}
function starters() {
  const box = el("div", "tk-start");
  const names = globalThis.TLWatch ? globalThis.TLWatch.list().map((i) => i.symbol).sort() : [];
  box.append(note(names.length ? "Type a ticker, or pick one of your starred names:" : "Type a ticker, e.g. UBER."));
  for (const s of names) {
    const b = el("button", "tk-chip-btn", s);
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
