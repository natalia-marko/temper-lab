"use strict";
// Insights: who bought and sold each company's shares, from SEC Form 4 and 5.
// Reads ownership-signals.json only. Every value from the data is set with
// textContent; nothing is parsed as HTML. Links go to sec.gov or this site only.

const SCHEMA = "ownership-signals-1";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INSIDER = new Set(["CEO", "CFO", "Officer", "Director"]);
const EXEC = new Set(["CEO", "CFO", "Officer"]);
const ROLE_ORDER = ["CEO", "CFO", "Officer", "Director", "10% owner", "Other"];
const ROLE_WORD = { Officer: "officer", Director: "director", "10% owner": "10% owner", Other: "other filer" };
const ROUTINE_LABEL = { grant: "award", exercise: "exercise", tax_withholding: "tax withholding", gift: "gift", other: "other row" };
const MONEY_LABEL = {
  buy: "bought", buy_plan: "bought under a 10b5-1 plan", buy_private: "bought privately or in an offering",
  sell_no_plan: "sold without a 10b5-1 plan", sell_plan: "sold under a 10b5-1 plan", sell_tax: "sold to cover tax",
  sell_private: "sold privately", transfer: "moved between related holders",
};
const KEYS = {
  buy: ["buy", "buy_plan"], discretionary: ["sell_no_plan"], planned: ["sell_plan", "sell_tax"],
  holder: ["buy", "buy_plan", "sell_no_plan", "sell_plan"], other: ["transfer", "buy_private", "sell_private"],
};
const VIEWS = [
  { key: "all", label: "All", head: "Amount", sort: "signal",
    note: "Form 4 buying and selling by insiders and big holders, most informative first." },
  { key: "buy", label: "Buys", head: "Bought", sort: "evidence",
    note: "Officers and directors buying their company's shares (Form 4), most checks met first." },
  { key: "sell", label: "Sells", head: "Sold", sort: "amount",
    note: "Officers and directors selling (Form 4): sales without a 10b5-1 plan first, then plan or tax sales." },
  { key: "holders", label: "Fund & 10% owner trades", head: "Traded", sort: "amount",
    note: "Shares bought or sold by funds and 10% owners (Form 4), in dollars. A different motive from executives." },
  { key: "stakes", label: "5%+ ownership reports", head: "Stake", sort: "signal",
    note: "Who reports owning 5% or more (Schedule 13D/13G): new stakes, changes and exits, in percent. Reports, not trades." },
];
const HISTORY_KEYS = ["buy", "buy_plan", "sell_no_plan", "sell_plan"];
const OTHER = { key: "other", label: "Not counted", head: "Moved", sort: "amount" };
const SORTS = { signal: "Signal type", evidence: "Checks 3 → 0", amount: "Amount", newest: "Newest filing" };
// "Signal type" lists the most informative kind first: insider buys (clusters, then single
// buys), sales without a plan, big holders, then planned or routine sales. A fixed order, not a score.
const SIGNAL_RANK = { "Group buy, incl. officer": 0, "Group buy, directors": 1, "Officer buy": 2, "Director buy": 3,
  "Sale, no plan": 4, "Fund/10% owner buy": 5, "Fund/10% owner sale": 5, "Plan or tax sale": 6,
  // 5%+ stakes tab only.
  "New stake, active (13D)": 0, "Switched to active (13D)": 0, "Stake change (13D)": 1,
  "New stake, passive (13G)": 2, "Stake change (13G)": 3, "Below 5%": 4 };
const PAGE = 50;
const state = { view: "all", sort: "signal", eligible: true, lists: false, fresh: false, query: "", shown: PAGE, data: null,
  selected: null, panelView: null, panelClosed: false };
const $ = (id) => document.getElementById(id);
// Wide screens keep the company panel open beside the list; narrower ones open it over the list.
const WIDE = typeof matchMedia === "function" ? matchMedia("(min-width: 1600px)") : null;
const docked = () => Boolean(WIDE && WIDE.matches);

// ---------- formatting ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function money(value) {
  const v = Number(value) || 0;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 999500) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1000) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}
function price(value) {
  return value === null || value === undefined ? "" : `$${Number(value).toFixed(2)}`;
}
function pct(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  const v = Number(value) * 100;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;
}
function day(iso) {
  const [, month, date] = String(iso || "").split("-");
  return month ? `${Number(date)} ${MONTHS[Number(month) - 1]}` : "";
}
function longDay(iso) {
  const [year] = String(iso || "").split("-");
  return year ? `${day(iso)} ${year}` : "";
}
function span(first, last) {
  if (!first) return "";
  if (first === last || !last) return day(first);
  const [, m1] = first.split("-");
  const [, m2, d2] = last.split("-");
  return m1 === m2 ? `${Number(first.split("-")[2])}–${Number(d2)} ${MONTHS[Number(m2) - 1]}` : `${day(first)}–${day(last)}`;
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
function sum(m, keys) {
  return keys.reduce((total, key) => total + ((m || {})[key] || 0), 0);
}
function plural(n, word, many) {
  return `${n} ${n === 1 ? word : (many || `${word}s`)}`;
}

// ---------- facts per company ----------
function insiderMoney(c) { return (c.money_by || {}).insider || {}; }
function holderMoney(c) { return (c.money_by || {}).holder || {}; }
function peopleWith(company, keys, insiders) {
  return (company.people || []).filter((p) => keys.some((k) => (p.money || {})[k])
    && (insiders === null || INSIDER.has(p.role) === insiders));
}
// The kind of event a row shows in a view. Facts only: role, plan, several buyers.
function signal(company, view) {
  if (view === "stakes") return stakeSignal(company);
  const ins = insiderMoney(company);
  const buys = sum(ins, KEYS.buy), discretionary = sum(ins, KEYS.discretionary), planned = sum(ins, KEYS.planned);
  const held = sum(holderMoney(company), KEYS.holder);
  const pick = view === "all" ? (buys ? "buy" : discretionary ? "discretionary" : held ? "holder" : planned ? "planned" : "other")
    : view === "buy" ? "buy" : view === "sell" ? (discretionary ? "discretionary" : "planned")
      : view === "holders" ? "holder" : "other";
  if (pick === "buy") {
    const exec = peopleWith(company, KEYS.buy, true).some((p) => EXEC.has(p.role));
    const several = ((company.flags || {}).buyers_within_10_sessions || 0) >= 2;
    return { kind: "buy", side: "buy", keys: KEYS.buy, insiders: true,
      text: several ? (exec ? "Group buy, incl. officer" : "Group buy, directors") : (exec ? "Officer buy" : "Director buy") };
  }
  if (pick === "discretionary") return { kind: "discretionary", side: "sell", keys: KEYS.discretionary, insiders: true, text: "Sale, no plan" };
  if (pick === "planned") return { kind: "planned", side: "routine", keys: KEYS.planned, insiders: true, text: "Plan or tax sale" };
  if (pick === "holder") {
    const h = holderMoney(company);
    const buying = sum(h, KEYS.buy) >= sum(h, ["sell_no_plan", "sell_plan"]);
    return { kind: "holder", side: "holder", keys: KEYS.holder, insiders: false, text: buying ? "Fund/10% owner buy" : "Fund/10% owner sale" };
  }
  const m = company.money || {};
  return { kind: "other", side: "routine", keys: KEYS.other, insiders: null,
    text: m.transfer ? "Transfer" : (m.buy_private || m.sell_private) ? "Private trade" : "Routine filings" };
}
function signalRank(sig) {
  return SIGNAL_RANK[sig.text] ?? 7;
}

// ---------- 5%+ stakes (Schedule 13D/13G) ----------
const RULE_WORD = { b: "institution, Rule 13d-1(b)", c: "passive investor, Rule 13d-1(c)", d: "exempt holder, Rule 13d-1(d)" };
const TYPE_WORD = { BD: "broker-dealer", BK: "bank", IC: "insurance company", IV: "investment company", IA: "investment adviser",
  EP: "benefit plan or endowment", HC: "parent holding company", SA: "savings association", CP: "church plan",
  CO: "corporation", PN: "partnership", IN: "individual", FI: "non-U.S. institution", OO: "other" };
// One chain per holder: its filings in the window, oldest first. The newest
// gives the stake now; the first, the stake when the window began.
function stakeChains(company) {
  const chains = new Map();
  for (const s of [...(company.stakes || [])].sort((a, b) => String(a.day).localeCompare(String(b.day)))) {
    if (!chains.has(s.lead)) chains.set(s.lead, []);
    chains.get(s.lead).push(s);
  }
  return [...chains.entries()].map(([lead, filings]) => {
    const first = filings[0], last = filings[filings.length - 1];
    const fresh = filings.find((f) => f.amendment === null || f.amendment === undefined);
    const label = last.exit ? "Below 5%"
      : new Set(filings.map((f) => f.kind)).size > 1 && last.kind === "13D" ? "Switched to active (13D)"
        : fresh ? (fresh.kind === "13D" ? "New stake, active (13D)" : "New stake, passive (13G)") : `Stake change (${last.kind})`;
    return { lead, label, first, last, filings };
  });
}
function mainChain(company) {
  return stakeChains(company).sort((a, b) => signalRank({ text: a.label }) - signalRank({ text: b.label })
    || String(b.last.day).localeCompare(String(a.last.day)))[0] || null;
}
function stakeSignal(company) {
  const chain = mainChain(company);
  return { kind: "stake", side: "holder", keys: [], insiders: false, chain,
    text: chain ? chain.label : "5%+ stake", filed: chain ? chain.first.day : null };
}
function pctText(value) {
  return value === null || value === undefined ? "" : `${Number(value).toFixed(1)}%`;
}
function count(value) {
  const n = Number(value) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}
function holderType(stake, name) {
  const h = (stake.holders || []).find((x) => x.name === name) || (stake.holders || [])[0];
  return h ? (TYPE_WORD[h.type] || "") : "";
}
function stakeKindText(stake) {
  if (stake.kind === "13D") return "13D: not filed as passive";
  const rules = (stake.rules || []).map((r) => RULE_WORD[r]).filter(Boolean);
  return `13G: ${rules.join("; ") || "passive"}`;
}
function amount(company, sig) {
  if (sig.kind === "stake") return sig.chain ? Number(sig.chain.last.pct) || 0 : 0;
  if (sig.kind === "holder") return sum(holderMoney(company), sig.keys);
  if (sig.kind === "other") return sum(company.money, sig.keys);
  return sum(insiderMoney(company), sig.keys);
}
function inView(company, view) {
  const ins = insiderMoney(company);
  const buy = sum(ins, KEYS.buy) > 0;
  const sell = sum(ins, [...KEYS.discretionary, ...KEYS.planned]) > 0;
  const holder = sum(holderMoney(company), KEYS.holder) > 0;
  if (view === "buy") return buy;
  if (view === "sell") return sell;
  if (view === "holders") return holder;
  if (view === "stakes") return (company.stakes || []).length > 0;
  if (view === "all") return buy || sell || holder;
  // Not counted: Form 4 filings without buying or selling (13D/13G-only companies have none).
  return (company.filings || []).length > 0 && !(buy || sell || holder);
}
// Buys rank by how many of three facts hold, then by amount. No hidden score.
function evidence(company) {
  const f = company.flags || {};
  return (f.buyers_within_10_sessions >= 2 ? 1 : 0) + (f.ceo_or_cfo_bought ? 1 : 0) + (f.holding_up_5pct_on_50k ? 1 : 0);
}
// The day a row is dated by: the newest 13D/13G on the stakes tab, else the newest Form 4.
function rowDay(company, view) {
  return String((view === "stakes" ? ((company.stakes || [])[0] || {}).day : company.latest_filing_day) || "");
}
function isNew(company, until, view) {
  const d = daysBetween(rowDay(company, view), until);
  return Number.isFinite(d) && d <= 6;
}
function who(people) {
  const counts = {};
  for (const p of people) counts[p.role] = (counts[p.role] || 0) + 1;
  if (people.length === 1) return people[0].role === "Other" ? "Insider" : people[0].role;
  return ROLE_ORDER.filter((r) => counts[r]).map((r) => (r === "CEO" || r === "CFO")
    ? (counts[r] === 1 ? r : `${counts[r]} ${r}s`)
    : r === "10% owner" && counts[r] === 1 ? "a 10% owner" : plural(counts[r], ROLE_WORD[r])).join(" + ");
}
function holdingChange(person) {
  const h = person && person.holding;
  if (!h) return null;
  if (h.status === "new_position") return { text: "new holding", value: null };
  const value = (h.side === "sale" ? -1 : 1) * Math.abs(Number(h.change_pct)) / 100;
  return { text: `holding ${pct(value)}`, value };
}
function medianHolding(people) {
  const values = people.map(holdingChange).filter((h) => h && h.value !== null).map((h) => h.value).sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}
// Trade dates behind a signal: per money key when known, else every trade of these people.
function tradeSpan(people, keys) {
  const firsts = [], lasts = [];
  for (const p of people) {
    const spans = (keys || []).map((k) => (p.key_days || {})[k]).filter(Boolean);
    if (spans.length) for (const [a, b] of spans) { firsts.push(a); lasts.push(b); }
    else { if (p.first_trade) firsts.push(p.first_trade); if (p.last_trade) lasts.push(p.last_trade); }
  }
  return { first: firsts.sort()[0], last: lasts.sort().slice(-1)[0] };
}
function monthsAgo(iso, until) {
  const d = daysBetween(iso, until);
  if (!Number.isFinite(d) || d < 0) return "";
  const m = Math.round(d / 30.44);
  return m < 1 ? "this month" : `${plural(m, "month")} ago`;
}
function planText(company, sig) {
  const m = sig.kind === "holder" ? holderMoney(company) : insiderMoney(company);
  if (sig.kind === "buy") return m.buy_plan && !m.buy ? "under a 10b5-1 plan" : m.buy_plan ? "partly under a 10b5-1 plan" : "no 10b5-1 plan";
  return "";
}
// One bold line: what happened, in the words of the filings.
function headline(company, sig) {
  if (sig.kind === "stake") {
    const c = sig.chain;
    if (!c) return "";
    const others = (c.last.holders || []).length > 1 ? ` (+${plural(c.last.holders.length - 1, "co-filer")})` : "";
    const from = c.filings.length > 1 && c.first.pct !== c.last.pct ? `, from ${pctText(c.first.pct)} on ${day(c.first.day)}` : "";
    return `${c.lead}${others} reported ${pctText(c.last.pct)}${from}`;
  }
  const people = peopleWith(company, sig.keys, sig.insiders);
  const value = money(amount(company, sig));
  const n = people.length;
  const lead = people[0];
  const { first, last } = tradeSpan(people, sig.keys);
  // Dates, not "in N days": the totals cover the whole window; the dates show how close together the trades were.
  const when = first && last && first !== last ? `, ${span(first, last)}` : first ? ` on ${day(first)}` : "";
  const hold = lead ? holdingChange(lead) : null;
  if (sig.kind === "buy") {
    if (n >= 2) return `${n} insiders bought ${value}${when}`;
    return `${lead ? lead.role : "Insider"} bought ${value}${hold ? ` (${hold.text})` : ""}`;
  }
  if (sig.kind === "discretionary") {
    if (n >= 2) return `${n} insiders sold ${value} without a 10b5-1 plan`;
    return `${lead ? lead.role : "Insider"} sold ${value} without a 10b5-1 plan${hold ? ` (${hold.text})` : ""}`;
  }
  if (sig.kind === "planned") {
    const ins = insiderMoney(company);
    const how = ins.sell_plan ? "under a 10b5-1 plan" : "to cover tax";
    return `${n >= 2 ? `${n} insiders` : lead ? lead.role : "Insider"} sold ${value} ${how}`;
  }
  if (sig.kind === "holder") {
    const h = holderMoney(company);
    const verb = sum(h, KEYS.buy) >= sum(h, ["sell_no_plan", "sell_plan"]) ? "bought" : "sold";
    return `${lead ? lead.names[0] : "A 10% owner"} ${verb} ${value}${hold ? ` (${hold.text})` : ""}`;
  }
  return company.headline;
}
// The short explanation under it: who, holding change, plan, the other side.
function explanation(company, sig) {
  if (sig.kind === "stake") {
    const c = sig.chain;
    if (!c) return "";
    const parts = [holderType(c.last, c.lead), stakeKindText(c.last)];
    const said = [...c.filings].reverse().find((f) => (f.mentions || []).length);
    if (said) parts.push(`Item 4 mentions ${said.mentions.join(", ")}`);
    if (c.last.event) parts.push(`event ${day(c.last.event)}`);
    if (c.last.amendment) parts.push(`amendment ${c.last.amendment}`);
    if (/prefer/i.test(c.last.class || "")) parts.push(`class: ${c.last.class}`);
    const more = stakeChains(company).length - 1;
    if (more > 0) parts.push(`${plural(more, "other holder")} filed too`);
    return parts.filter(Boolean).join(" · ");
  }
  const people = peopleWith(company, sig.keys, sig.insiders);
  const until = state.data ? state.data.window.until : "";
  const ins = insiderMoney(company);
  const parts = [];
  if (people.length > 1 || sig.kind === "planned") parts.push(who(people) || "");
  if (sig.kind === "buy") {
    const median = medianHolding(people);
    if (people.length > 1 && median !== null) parts.push(`median holding ${pct(median)}`);
    parts.push(...historyFacts(company, sig, people));
    parts.push(planText(company, sig));
    if (ins.sell_no_plan) parts.push(`insiders also sold ${money(ins.sell_no_plan)} without a plan`);
  } else if (sig.kind === "discretionary") {
    const median = medianHolding(people);
    if (people.length > 1 && median !== null) parts.push(`median holding ${pct(median)}`);
    parts.push(...historyFacts(company, sig, people));
    if (ins.sell_plan) parts.push(`also ${money(ins.sell_plan)} under 10b5-1 plans`);
    if (sum(ins, KEYS.buy)) parts.push(`insiders also bought ${money(sum(ins, KEYS.buy))}`);
  } else if (sig.kind === "planned") {
    const adopted = people.flatMap((p) => p.plan_adopted || []).sort();
    if (adopted.length) parts.push(`plan adopted ${monthsAgo(adopted[0], until)} (${adopted[0]})`);
    else if (ins.sell_plan) parts.push("plan adoption date not stated");
    const median = medianHolding(people);
    if (median !== null) parts.push(`${people.length > 1 ? "median " : ""}holding ${pct(median)}`);
  } else if (sig.kind === "holder") {
    const lead = people[0];
    if (lead) parts.push(people.length > 1 ? `${plural(people.length, "10% owner")}` : "10% owner");
    if (lead && (lead.plan_adopted || []).length) parts.push(`10b5-1 plan adopted ${lead.plan_adopted[0]}`);
    if (sum(ins, KEYS.buy)) parts.push(`insiders also bought ${money(sum(ins, KEYS.buy))}`);
  } else {
    const lead = (company.people || [])[0];
    if (lead) parts.push(`${lead.role} ${lead.names[0]}`);
  }
  return parts.filter(Boolean).join(" · ");
}
// Small labels that show why a row ranks where it does.
function reasons(company, sig) {
  const f = company.flags || {};
  const out = [];
  if (sig.kind === "buy") {
    // The three checks behind the Buys ranking, in a fixed order; spelled out in the panel.
    const dots = [f.buyers_within_10_sessions >= 2, f.ceo_or_cfo_bought, f.holding_up_5pct_on_50k].map((on) => (on ? "●" : "○")).join("");
    out.push([`Checks ${dots}`, ""]);
  }
  if (sig.kind === "discretionary" && f.officers_sold_without_plan >= 2) out.push([`${f.officers_sold_without_plan} officers, no plan`, "warn"]);
  if (f.rows_to_check) out.push([`${plural(f.rows_to_check, "row")} to check`, "muted"]);
  return out;
}
function monthYear(iso) {
  const [y, m] = String(iso || "").split("-");
  return m ? `${MONTHS[Number(m) - 1]} ${y}` : "";
}
// Facts from the saved history before the window, for the row sentence: no score, no guess.
function historyFacts(company, sig, people) {
  const data = state.data || {};
  const h = data.history;
  if (!h || !people.length || (sig.kind !== "buy" && sig.kind !== "discretionary")) return [];
  const buy = sig.kind === "buy";
  // A gap between the saved filings and the window is said, not hidden.
  const gap = data.window && daysBetween(h.filed_until, data.window.since) > 1 ? ` (data to ${monthYear(h.filed_until)})` : "";
  const since = `first ${buy ? "buy" : "sale"} since ${monthYear(h.filed_from)}`;
  const none = people.filter((p) => !(p.history && p.history[buy ? "last_buy" : "last_sell"]));
  const out = [];
  if (people.length === 1) {
    const x = people[0].history;
    if (none.length) out.push(since + gap);
    else if (buy) out.push(`last bought ${monthYear(x.last_buy)}`);
    // Routine / opportunistic (Cohen, Malloy & Pomorski 2012) in words; groups: see the History tab.
    if (x && x.label) out.push(x.label === "routine" ? "trades in the same month every year" : "no yearly trading pattern");
  } else if (none.length) out.push(`${since} for ${none.length} of ${people.length}${gap}`);
  return out;
}
function signCls(text) {
  const t = String(text || "").trim();
  return t.startsWith("+") ? "pos" : t.startsWith("−") ? "neg" : "";
}
// A line whose signed percentages are coloured: green up, red down.
function withSigns(cls, text) {
  const p = el("p", cls);
  let last = 0;
  for (const m of String(text).matchAll(/[+−]\d[\d.,]*%/g)) {
    p.append(text.slice(last, m.index), el("span", signCls(m[0]), m[0]));
    last = m.index + m[0].length;
  }
  p.append(text.slice(last));
  return p;
}
function keyMetric(company, sig) {
  if (sig.kind === "stake") {
    const c = sig.chain;
    return c ? [c.last.shares ? `${count(c.last.shares)} shares` : "", c.filings.length > 1 ? plural(c.filings.length, "filing") : ""].filter(Boolean) : [];
  }
  const people = peopleWith(company, sig.keys, sig.insiders);
  const lines = [];
  if (people.length > 1) {
    const median = medianHolding(people);
    if (median !== null) lines.push(`${pct(median)} median`);
  } else if (people[0]) {
    const h = holdingChange(people[0]);
    if (h) lines.push(h.value === null ? h.text : `${pct(h.value)} holding`);
  }
  if (people.length) lines.push(plural(people.length, sig.insiders === false ? "holder" : "insider"));
  return lines;
}
function matches(company, query) {
  if (!query) return true;
  return [company.symbol, company.name, ...(company.people || []).flatMap((p) => p.names),
    ...(company.stakes || []).flatMap((s) => (s.holders || []).map((h) => h.name))]
    .some((text) => String(text || "").toLowerCase().includes(query));
}
function base(companies, filters) {
  return companies.filter((c) => (!filters.eligible || c.eligible) && (!filters.lists || (c.lists || []).length));
}
function fresh(company, view, filters) {
  return !filters.fresh || isNew(company, state.data ? state.data.window.until : filters.until, view);
}
function visible(companies, filters) {
  const view = filters.view;
  const query = String(filters.query || "").trim().toLowerCase();
  const rows = base(companies, filters).filter((c) => inView(c, view) && fresh(c, view, filters) && matches(c, query));
  const sort = filters.sort || "amount";
  const value = (c) => amount(c, signal(c, view));
  const group = (c) => (view === "sell" && signal(c, view).kind === "planned" ? 1 : 0);
  const rank = (c) => signalRank(signal(c, view));
  return rows.sort((a, b) => group(a) - group(b)
    || (sort === "signal" ? rank(a) - rank(b) : 0)
    || (sort === "evidence" ? evidence(b) - evidence(a) : 0)
    || (sort === "newest" || sort === "signal" ? rowDay(b, view).localeCompare(rowDay(a, view)) : 0)
    || value(b) - value(a)
    || rowDay(b, view).localeCompare(rowDay(a, view))
    || String(a.symbol).localeCompare(String(b.symbol)));
}
function viewCounts(companies, filters) {
  const shown = base(companies, filters);
  return Object.fromEntries([...VIEWS, OTHER].map((v) => [v.key, shown.filter((c) => inView(c, v.key) && fresh(c, v.key, filters)).length]));
}
function notCounted(data, filters) {
  const shown = base(data.companies, { ...filters, lists: false, fresh: false }).filter((c) => inView(c, "other"));
  const transfers = shown.filter((c) => (c.money || {}).transfer > 0);
  const priv = shown.filter((c) => (c.money || {}).buy_private || (c.money || {}).sell_private);
  const routine = shown.filter((c) => !sum(c.money, KEYS.other));
  const rows = (data.counts || {}).rows || {};
  const n = (value) => Number(value || 0).toLocaleString();
  const parts = [];
  if (transfers.length) parts.push(`${plural(transfers.length, "company", "companies")} with transfers between related holders (${money(transfers.reduce((s, c) => s + c.money.transfer, 0))} — ${transfers.slice(0, 4).map((c) => c.symbol).join(", ")}${transfers.length > 4 ? ", …" : ""})`);
  if (priv.length) parts.push(`${plural(priv.length, "company", "companies")} with private trades only`);
  if (routine.length) parts.push(`${plural(routine.length, "company", "companies")} with only awards, exercises, gifts or tax withholding`);
  if (rows.review) parts.push(`${n(rows.review)} rows held back to check`);
  if (rows.outside_window) parts.push(`${n(rows.outside_window)} late reports of trades before the window`);
  return parts;
}

// ---------- list ----------
function row(company, view, until) {
  const sig = signal(company, view);
  // Planned and routine rows are kept quieter: they carry the least information.
  const button = el("button", sig.side === "routine" ? "os-row quiet" : "os-row");
  button.type = "button";
  button.dataset.symbol = company.symbol;
  button.addEventListener("click", () => openDetail(company, view, button));
  const co = el("span", "os-co");
  const tk = el("span", "os-tk");
  tk.append(el("strong", "", company.symbol));
  if ((company.lists || []).length) tk.append(el("span", "os-chip", company.lists.join(" · ")));
  co.append(tk, el("span", "os-name", company.name));
  const close = (company.prices || {}).close;
  const meta = [close ? price(close.value) : company.price ? price(company.price) : "", company.market_cap ? money(company.market_cap) : ""]
    .filter(Boolean).join(" · ");
  co.append(el("span", "os-meta", meta || (company.eligible ? "" : "outside eligible set")));
  const kind = el("span", `os-signal ${sig.side}`, sig.text);
  const why = el("span", "os-what");
  why.append(el("span", "os-headline", headline(company, sig)));
  const line = explanation(company, sig);
  if (line) why.append(el("span", "os-detail-line", line));
  const labels = reasons(company, sig);
  if (labels.length) {
    const box = el("span", "os-tags");
    for (const [text, cls] of labels) box.append(el("span", `os-tag ${cls}`.trim(), text));
    why.append(box);
  }
  const metric = el("span", "os-metric");
  const value = amount(company, sig);
  metric.append(el("span", "os-amount num", sig.kind === "stake" ? pctText(sig.chain && sig.chain.last.pct) : value ? money(value) : "—"));
  for (const text of keyMetric(company, sig)) metric.append(el("span", `os-sub num ${signCls(text)}`.trim(), text));
  const filed = el("span", "os-filed", day(rowDay(company, view)));
  // With "New this week" on, every row is new, so the badge would say nothing.
  if (!state.fresh && isNew(company, until, view)) filed.append(el("span", "os-new", "NEW"));
  button.append(co, kind, why, metric, filed);
  return button;
}
function render() {
  const data = state.data;
  const view = state.view === "other" ? OTHER : VIEWS.find((v) => v.key === state.view);
  const list = visible(data.companies, state);
  const counts = viewCounts(data.companies, state);
  $("os-amount-head").textContent = view.head;
  $("os-rows").replaceChildren(...list.slice(0, state.shown).map((c) => row(c, view.key, data.window.until)));
  if (!list.length) $("os-rows").append(el("p", "empty", "No company matches these filters."));
  $("os-count").textContent = `${list.length.toLocaleString()} companies · sorted by ${SORTS[state.sort].toLowerCase()}`
    + (state.sort === "signal" ? ", then newest" : "") + (view.key === "sell" ? " · sales without a plan first" : "");
  $("os-more").hidden = list.length <= state.shown;
  $("os-more").textContent = `Show ${Math.min(PAGE, list.length - state.shown)} more`;
  for (const button of $("os-tabs").querySelectorAll("button")) {
    const on = button.dataset.view === state.view;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
    button.querySelector(".cnt").textContent = (counts[button.dataset.view] || 0).toLocaleString();
  }
  $("os-other-banner").hidden = state.view !== "other";
  $("os-tab-note").textContent = view.note || "";
  $("os-tab-note").hidden = !view.note;
  $("os-sort").value = state.sort;
  $("os-sort").querySelector('option[value="evidence"]').disabled = state.view !== "buy";
  const scope = state.eligible ? data.universe.eligible : data.universe.issuers;
  $("os-data").textContent = `Data through ${longDay(data.window.until)} (${data.window.sessions} trading days) · ${Number(scope).toLocaleString()} stocks`;
  const parts = notCounted(data, state);
  $("os-excluded-list").replaceChildren(...parts.map((text) => el("li", "", text)));
  $("os-excluded").hidden = !parts.length;
  markSelected();
  // Beside the list, the panel always shows a listed company: the one picked, else the first row.
  if (docked() && !state.panelClosed && list.length) {
    const current = list.slice(0, state.shown).find((c) => c.symbol === state.selected);
    if (!current || !$("os-detail").open || state.panelView !== view.key) openDetail(current || list[0], view.key);
  }
}
function markSelected() {
  const open = $("os-detail").open;
  for (const r of $("os-rows").querySelectorAll(".os-row")) {
    const on = open && r.dataset.symbol === state.selected;
    r.classList.toggle("on", on);
    if (on) r.setAttribute("aria-current", "true"); else r.removeAttribute("aria-current");
  }
}
function setView(key) {
  state.view = key;
  state.sort = (key === "other" ? OTHER : VIEWS.find((v) => v.key === key)).sort;
  state.shown = PAGE;
  render();
}

// ---------- panel ----------
function chart(company, data, sig) {
  const ctx = company.prices || {};
  const days = (data.chart || {}).days || [];
  const stock = ctx.chart;
  const box = el("div", "os-section os-chart");
  const head = el("div", "os-chart-head");
  head.append(el("h3", "", "Price performance vs QQQ"), el("span", "", "solid line = first filing · dashed = trade dates"));
  box.append(head);
  if (!stock || !days.length) {
    box.append(el("p", "os-detail-line", "No reliable 3-month price series for this stock (missing days or a split mix-up in the price data)."));
    return box;
  }
  const rebase = (values) => {
    const first = (values || []).find((v) => v);
    return first ? values.map((v) => (v ? (v / first - 1) : null)) : null;
  };
  const a = rebase(stock);
  const q = rebase((data.chart || {}).qqq);
  const all = [...a, ...(q || [])].filter((v) => v !== null);
  const lo = Math.min(...all, 0), hi = Math.max(...all, 0);
  const W = 480, H = 170, L = 38, R = 8, T = 10, B = 22;
  const x = (i) => L + (i / (days.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${company.symbol} price change over the last 3 months against QQQ`);
  const line = (x1, y1, x2, y2, cls) => {
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", x1); l.setAttribute("x2", x2); l.setAttribute("y1", y1); l.setAttribute("y2", y2);
    l.setAttribute("class", cls);
    svg.append(l);
  };
  const text = (value, tx, ty, anchor, cls) => {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", tx); t.setAttribute("y", ty); t.setAttribute("text-anchor", anchor); t.setAttribute("class", cls);
    t.textContent = value;
    svg.append(t);
  };
  line(L, y(0), W - R, y(0), "os-zero");
  // Axis labels for the top, zero and bottom, skipped when they would overlap.
  text("0%", L - 4, y(0) + 4, "end", "os-tick");
  if (y(0) - y(hi) > 12) text(pct(hi, 0), L - 4, y(hi) + 4, "end", "os-tick");
  if (y(lo) - y(0) > 12) text(pct(lo, 0), L - 4, y(lo) + 4, "end", "os-tick");
  for (const [key, list] of Object.entries(ctx.trade_days || {})) {
    if (!sig.keys.includes(key)) continue;
    for (const d of list) {
      const i = days.indexOf(d);
      if (i >= 0) line(x(i), T, x(i), H - B, `os-mark ${key.startsWith("buy") ? "buy" : "sell"}`);
    }
  }
  const filed = sig.filed || firstFiled(ctx, sig.keys);
  const fi = filed ? days.findIndex((d) => d >= filed) : -1;
  if (fi >= 0) {
    line(x(fi), T, x(fi), H - B, "os-filing");
    text("Filed", x(fi) + 3, T + 9, "start", "os-tick strong");
  }
  const path = (values, cls) => {
    let d = "";
    values.forEach((v, i) => { if (v !== null) d += `${d && values[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("class", cls);
    svg.append(p);
  };
  if (q) path(q, "os-line qqq");
  path(a, "os-line stock");
  text(day(days[0]), x(0), H - 6, "start", "os-tick");
  // Month starts, kept clear of the first and last date labels.
  days.forEach((d, i) => { if (i > 4 && i < days.length - 6 && d.slice(5, 7) !== days[i - 1].slice(5, 7)) text(MONTHS[Number(d.slice(5, 7)) - 1], x(i), H - 6, "middle", "os-tick"); });
  text(day(days[days.length - 1]), x(days.length - 1), H - 6, "end", "os-tick");
  box.append(svg);
  const legend = el("p", "os-legend");
  const item = (cls, name, value) => { const s = el("span", cls, `${name} `); s.append(el("b", signCls(value), value)); return s; };
  legend.append(item("stock", company.symbol, pct(a[a.length - 1])), item("qqq", "QQQ", q ? pct(q[q.length - 1]) : ""));
  box.append(legend);
  const since = sinceFiling(company, data, sig.keys, sig.filed);
  if (since) box.append(withSigns("os-detail-line os-tabular", since));
  return box;
}
function firstFiled(ctx, keys) {
  const filed = (ctx || {}).filed_days || {};
  return keys.flatMap((k) => filed[k] || []).sort()[0] || null;
}
// Change from the first session on or after the first filing to the last close,
// for the stock and QQQ. Only days that have passed; nothing is projected.
function sinceFiling(company, data, keys, filedDay) {
  const ctx = company.prices || {};
  const days = (data.chart || {}).days || [];
  const filed = filedDay || firstFiled(ctx, keys);
  if (!filed || !ctx.chart || !days.length) return "";
  const i = days.findIndex((d) => d >= filed);
  const last = days.length - 1;
  if (i < 0 || i >= last || !ctx.chart[i] || !ctx.chart[last]) return filed ? `Filed ${day(filed)}: no full trading day since the filing yet.` : "";
  const stock = ctx.chart[last] / ctx.chart[i] - 1;
  const qqq = (data.chart.qqq || [])[i] && data.chart.qqq[last] ? data.chart.qqq[last] / data.chart.qqq[i] - 1 : null;
  return `Since the first filing (${day(filed)}, ${plural(last - i, "trading day")}): ${company.symbol} ${pct(stock)}${qqq === null ? "" : ` vs QQQ ${pct(qqq)}`}.`;
}
function priceLine(company, sig) {
  const ctx = company.prices || {};
  const keys = sig.keys.filter((k) => (ctx.paid || {})[k]);
  if (!keys.length) return "";
  const p = ctx.paid[keys[0]];
  const verb = keys[0].startsWith("buy") ? "paid" : "sold at";
  let text = `Insiders ${verb} ${price(p.avg)} on average`;
  if (p.low !== p.high) text += ` (${price(p.low)}–${price(p.high)})`;
  if (ctx.split_after_trades) return `${text}. A stock split was recorded during or after these trades, so these prices do not compare with today's.`;
  if (ctx.close) text += ` · ${price(ctx.close.value)} on ${day(ctx.close.day)} (${pct(ctx.close.value / p.avg - 1)})`;
  return text;
}
function checks(company, sig) {
  const f = company.flags || {};
  const people = peopleWith(company, sig.keys, sig.insiders);
  if (sig.kind !== "buy") return [];
  const ceo = people.find((p) => p.role === "CEO" || p.role === "CFO");
  const stake = people.find((p) => p.holding && (p.holding.status === "new_position" || (p.holding.side === "purchase" && p.holding.change_pct >= 5)));
  return [
    [f.buyers_within_10_sessions >= 2, f.buyers_within_10_sessions >= 2 ? `Several insiders: ${f.buyers_within_10_sessions} bought within 10 sessions.` : "Several insiders within 10 sessions: no."],
    [Boolean(f.ceo_or_cfo_bought), ceo ? `CEO or CFO: ${ceo.role} ${ceo.names[0]} bought ${money(sum(ceo.money, sig.keys))}.` : "CEO or CFO bought: no."],
    [Boolean(f.holding_up_5pct_on_50k), f.holding_up_5pct_on_50k && stake ? `Holding +5% or new: ${stake.role} ${stake.names[0]}, ${holdingChange(stake).text}.` : "A holding up 5% or new, on $50K+: no."],
  ];
}
function peopleTable(list, columns) {
  const table = el("table", "os-people");
  const head = el("tr");
  for (const [label, cls] of columns) head.append(el("th", cls || "", label));
  table.append(head);
  for (const person of list) {
    const tr = el("tr");
    for (const [, cls, cell] of columns) {
      const value = cell(person);
      const td = el("td", [cls, value instanceof Node ? "" : signCls(value)].filter(Boolean).join(" "));
      if (value instanceof Node) td.append(value); else td.textContent = value;
      tr.append(td);
    }
    table.append(tr);
  }
  return table;
}
function nameCell(person) {
  const box = el("span", "");
  box.append(el("span", "", person.names.join(", ")));
  if ((person.titles || [])[0]) box.append(el("small", "", person.titles[0]));
  return box;
}
function overview(company, data, sig) {
  const parts = [];
  const people = peopleWith(company, sig.keys, sig.insiders);
  const card = el("div", "os-card");
  const top = el("div", "os-card-top");
  top.append(el("span", `os-signal ${sig.side}`, sig.text));
  if (sig.kind === "buy") top.append(el("span", "os-evidence", `Checks ${evidence(company)} of 3`));
  card.append(top, el("p", "os-d-head", headline(company, sig)));
  const line = explanation(company, sig);
  if (line) card.append(el("p", "os-detail-line", line));
  const tiles = el("div", "os-tiles");
  const tile = (value, label) => { const t = el("div", "os-tile"); t.append(el("b", signCls(value), value), el("span", "", label)); tiles.append(t); };
  const value = amount(company, sig);
  if (value) tile(money(value), sig.kind === "buy" ? "total bought" : sig.kind === "other" ? "moved" : sig.kind === "holder" ? "traded" : "total sold");
  if (people.length) tile(String(people.length), people.length === 1 ? (sig.insiders === false ? "holder" : "insider") : (sig.insiders === false ? "holders" : "insiders"));
  const { first, last } = tradeSpan(people, sig.keys);
  if (first) tile(first === last ? day(first) : plural(daysBetween(first, last) + 1, "day"), first === last ? "traded" : `traded ${span(first, last)}`);
  const median = people.length > 1 ? medianHolding(people) : null;
  const lead = people.find((p) => p.holding);
  if (median !== null) tile(pct(median), "median holding change");
  else if (lead) tile(holdingChange(lead).text.replace("holding ", ""), `holding · ${lead.role} ${lead.names[0]}`);
  if (tiles.childNodes.length) card.append(tiles);
  parts.push(card);
  const why = checks(company, sig);
  if (why.length) {
    const section = el("div", "os-section");
    section.append(el("h3", "", "Why it's listed"));
    for (const [on, text] of why) {
      const item = el("div", "os-check");
      item.append(el("span", `os-pip${on ? " on" : ""}`), el("span", "", text));
      section.append(item);
    }
    parts.push(section);
  }
  parts.push(chart(company, data, sig));
  const paidLine = priceLine(company, sig);
  if (paidLine) parts.push(withSigns("os-detail-line os-tabular", paidLine));
  if (people.length) {
    const section = el("div", "os-section");
    section.append(el("h3", "", sig.insiders === false ? "Holders involved" : "Insiders involved"));
    section.append(peopleTable(people, [
      ["Role", "", (p) => p.role], ["Name", "", nameCell],
      [sig.kind === "buy" ? "Bought" : sig.kind === "holder" ? "Traded" : "Sold", "num", (p) => money(sum(p.money, sig.keys))],
      ["Holding", "num", (p) => { const h = holdingChange(p); return h ? h.text.replace("holding ", "") : "—"; }],
    ]));
    parts.push(section);
  }
  if ((company.stakes || []).length) parts.push(stakesSection(company));
  const lists = el("div", "os-section");
  lists.append(el("h3", "", "Screener membership"));
  const chips = el("div", "os-d-chips");
  if ((company.lists || []).length) for (const item of company.lists) chips.append(el("span", "os-chip", item));
  else chips.append(el("span", "os-detail-line", company.eligible ? "Not on this week's Strength, Growth or Cheap lists." : "Outside the eligible universe."));
  lists.append(chips);
  parts.push(lists);
  const limits = el("div", "os-section os-limits");
  limits.append(el("h3", "", "What we can't tell yet"));
  limits.append(el("p", "", "Codes P and S do not prove an open-market trade; a trade is called private only when its footnote says so."));
  limits.append(el("p", "", data.history
    ? `History covers buys and sales filed ${longDay(data.history.filed_from)} – ${longDay(data.history.filed_until)} (History tab); later filings are not in the SEC's quarterly data yet.`
    : `Whether this is unusual for these people: this page holds the last ${data.window.sessions} trading days only, not their history.`));
  if ((company.flags || {}).rows_to_check) limits.append(el("p", "", `${plural(company.flags.rows_to_check, "row")} held back to check, not in the totals.`));
  parts.push(limits);
  return parts;
}
function stakesSection(company) {
  const box = el("div", "os-section os-filings");
  box.append(el("h3", "", "13D/13G filed in the window"));
  for (const s of company.stakes || []) {
    const text = `${day(s.day)} · ${String(s.form).replace("SCHEDULE ", "")}${s.amendment ? ` No. ${s.amendment}` : ""} · ${s.lead} ${pctText(s.pct)}${s.exit ? " (5% or less)" : ""}`;
    const url = secUrl(s.url);
    if (!url) { box.append(el("p", "os-detail-line", text)); continue; }
    const a = el("a", "", `${text} ↗`);
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    box.append(a);
  }
  return box;
}
function stakeOverview(company, data, sig) {
  const c = sig.chain;
  const parts = [];
  const card = el("div", "os-card");
  const top = el("div", "os-card-top");
  top.append(el("span", `os-signal ${sig.side}`, sig.text));
  card.append(top, el("p", "os-d-head", headline(company, sig)));
  const line = explanation(company, sig);
  if (line) card.append(el("p", "os-detail-line", line));
  if (c) {
    const tiles = el("div", "os-tiles");
    const tile = (value, label) => { const t = el("div", "os-tile"); t.append(el("b", signCls(value), value), el("span", "", label)); tiles.append(t); };
    tile(pctText(c.last.pct), "of the class");
    if (c.last.shares) tile(count(c.last.shares), "shares");
    if (c.last.event) tile(day(c.last.event), "event date");
    tile(day(c.last.day), "filed");
    card.append(tiles);
  }
  parts.push(card);
  if (c) {
    const said = [...c.filings].reverse().find((f) => f.purpose);
    if (said) {
      const section = el("div", "os-section");
      section.append(el("h3", "", `Stated purpose (13D Item 4, filed ${day(said.day)}, as written)`));
      section.append(el("p", "os-purpose", said.purpose));
      parts.push(section);
    }
    const section = el("div", "os-section");
    section.append(el("h3", "", "Holders in the latest filing"));
    section.append(peopleTable(c.last.holders || [], [
      ["Holder", "", (h) => h.name], ["Type", "", (h) => TYPE_WORD[h.type] || h.type || ""],
      ["Stake", "num", (h) => pctText(h.pct)], ["Shares", "num", (h) => (h.shares ? count(h.shares) : "—")],
    ]));
    parts.push(section);
  }
  parts.push(chart(company, data, sig));
  parts.push(stakesSection(company));
  const limits = el("div", "os-section os-limits");
  limits.append(el("h3", "", "What we can't tell yet"));
  limits.append(el("p", "", "The stake is as of the event date in the filing, not today. Holders amend only for material changes. Members of a group each report what they may be deemed to own, so the largest figure is shown, never the sum."));
  limits.append(el("p", "", "A 13D is filed by holders who do not claim to be passive; on its own it does not mean an activist campaign. The purpose text is the holder's own words."));
  parts.push(limits);
  return parts;
}
function historyTab(company, data) {
  const h = data.history;
  const box = el("div", "os-section");
  box.append(el("p", "os-detail-line", `Open-market buys and sales (codes P and S) in SEC filings from ${longDay(h.filed_from)} to ${longDay(h.filed_until)}, before each person's first trade in this window. Later filings are not in the SEC's quarterly data yet.`));
  const people = (company.people || []).filter((p) => HISTORY_KEYS.some((k) => (p.money || {})[k]));
  if (!people.length) box.append(el("p", "os-detail-line", "Nobody here bought or sold in the window."));
  for (const p of people) {
    const x = p.history;
    const item = el("div", "os-section");
    item.append(el("h3", "", `${p.role} · ${p.names[0]}`));
    box.append(item);
    if (!x) { item.append(el("p", "os-detail-line", "No buys or sales in this period.")); continue; }
    item.append(el("p", "os-detail-line", x.label === "routine"
      ? `Routine trader: ${x.reason} (${(x.months || []).map((m) => MONTHS[m - 1]).join(", ")}).`
      : x.label === "opportunistic" ? `Opportunistic trader: ${x.reason}.` : `Not labelled routine or opportunistic: ${x.reason}.`));
    item.append(el("p", "os-detail-line", [x.last_buy ? `last buy ${longDay(x.last_buy)}` : "no buy",
      x.last_sell ? `last sale ${longDay(x.last_sell)}` : "no sale", `${plural(x.buys, "buy")}, ${plural(x.sells, "sale")}`].join(" · ")));
    item.append(peopleTable(x.trades || [], [
      ["Traded", "", (t) => longDay(t[0])], ["", "", (t) => (t[1] === "P" ? "bought" : "sold")],
      ["Shares", "num", (t) => Number(t[2] || 0).toLocaleString()], ["Price", "num", (t) => price(t[3])],
      ["Value", "num", (t) => (t[2] && t[3] ? money(t[2] * t[3]) : "—")],
    ]));
  }
  return [box];
}
function filingsTab(company) {
  const box = el("div", "os-section os-filings");
  box.append(el("p", "os-detail-line", `${plural((company.filings || []).length, "filing")} in the window, newest first.`));
  for (const filing of company.filings || []) {
    const url = secUrl(filing.url);
    if (!url) continue;
    const a = el("a", "", `${day(filing.day)} · ${filing.accession} ↗`);
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    box.append(a);
  }
  return [box];
}
function insidersTab(company) {
  const activity = (p) => {
    const items = Object.entries(p.money || {}).map(([k, v]) => `${MONEY_LABEL[k] || k} ${money(v)}`);
    for (const [k, n] of Object.entries(p.routine || {})) items.push(plural(n, ROUTINE_LABEL[k] || k));
    return items.join("; ");
  };
  const section = el("div", "os-section");
  section.append(peopleTable(company.people || [], [
    ["Role", "", (p) => p.role], ["Name", "", nameCell], ["Activity", "", activity],
    ["Traded", "", (p) => span(p.first_trade, p.last_trade)],
    ["Holding", "", (p) => { const h = holdingChange(p); return h ? h.text.replace("holding ", "") : "—"; }],
    ["Plan adopted", "", (p) => (p.plan_adopted || []).join(", ") || "—"],
  ]));
  return [section];
}
function openDetail(company, view, from) {
  const data = state.data;
  state.selected = company.symbol;
  state.panelView = view;
  state.panelClosed = false;
  const sig = signal(company, view);
  const body = $("os-detail-body");
  const top = el("div", "os-d-top");
  const title = el("h2", "", company.symbol);
  title.id = "os-detail-title";
  const ctx = company.prices || {};
  const facts = withSigns("os-d-facts", [ctx.close ? `${price(ctx.close.value)} close ${day(ctx.close.day)}` : "",
    ctx.move_3m !== null && ctx.move_3m !== undefined ? `3-mo ${pct(ctx.move_3m)}` : "",
    company.market_cap ? `${money(company.market_cap)} market cap` : ""].filter(Boolean).join(" · "));
  const chips = el("div", "os-d-chips");
  if ((company.lists || []).length) chips.append(el("span", "os-chip", company.lists.join(" · ")));
  if (!company.eligible) chips.append(el("span", "os-chip muted", "outside eligible set"));
  if (isNew(company, data.window.until)) chips.append(el("span", "os-new", "NEW THIS WEEK"));
  top.append(title, el("div", "os-d-name", company.name), facts, chips);
  const tabs = el("div", "os-d-tabs");
  tabs.setAttribute("role", "tablist");
  const pane = el("div", "os-d-pane");
  const panes = { overview: () => (sig.kind === "stake" ? stakeOverview(company, data, sig) : overview(company, data, sig)),
    filings: () => filingsTab(company), insiders: () => insidersTab(company) };
  const labels = { overview: "Overview", filings: `Filings (${(company.filings || []).length})`, insiders: `Insiders (${(company.people || []).length})` };
  if (data.history) { panes.history = () => historyTab(company, data); labels.history = "History"; }
  const show = (key) => {
    pane.replaceChildren(...panes[key]());
    for (const b of tabs.children) {
      const on = b.dataset.key === key;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    }
  };
  for (const key of Object.keys(panes)) {
    const b = el("button", "", labels[key]);
    b.type = "button";
    b.dataset.key = key;
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => show(key));
    tabs.append(b);
  }
  const links = el("div", "os-d-links");
  if (company.eligible) {
    const r = el("a", "os-button primary", `Open ${company.symbol} in Research →`);
    r.href = `./?q=${encodeURIComponent(company.symbol)}`;
    links.append(r);
  }
  const all = secUrl(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(company.cik)}&type=4&dateb=&owner=include&count=40`);
  if (all) { const a = el("a", "os-button", "All Form 4 filings on SEC ↗"); a.href = all; a.target = "_blank"; a.rel = "noopener noreferrer"; links.append(a); }
  body.replaceChildren(top, tabs, pane, links);
  show("overview");
  const dialog = $("os-detail");
  const dock = docked();
  document.body.classList.toggle("os-docked", dock);
  dialog.classList.toggle("docked", dock);
  if (!dialog.open) {
    if (dock) dialog.show(); else dialog.showModal();
    // Beside the list, focus stays in the list, so the next row is one key away.
    if (dock && from) from.focus({ preventScroll: true });
    else if (dock && document.activeElement) document.activeElement.blur();
  }
  dialog.scrollTop = 0;
  markSelected();
}

// ---------- start ----------
function setup(data) {
  state.data = data;
  const { universe, coverage } = data;
  const read = Number((coverage || {}).xml_read) || 0;
  $("os-built").textContent = `Built ${day(String(data.built_at).slice(0, 10))}`;
  $("os-build").textContent = `Run ${data.run_id} · method ${data.method_version} · lists from freeze ${data.freeze_as_of || "unknown"}`
    + (read ? ` · ${read.toLocaleString()} Form 4/5 filings read for ${Number(universe.issuers).toLocaleString()} issuers` : "");
  $("os-eligible-count").textContent = Number(universe.eligible).toLocaleString();
  const tabBox = $("os-tabs");
  for (const view of VIEWS) {
    const button = el("button", "", view.label);
    button.type = "button";
    button.dataset.view = view.key;
    button.append(el("span", "cnt num", ""));
    button.addEventListener("click", () => setView(view.key));
    tabBox.append(button);
  }
  const sort = $("os-sort");
  for (const [key, label] of Object.entries(SORTS)) {
    const option = el("option", "", label);
    option.value = key;
    sort.append(option);
  }
  sort.addEventListener("change", (e) => { state.sort = e.target.value; state.shown = PAGE; render(); });
  $("os-eligible").addEventListener("change", (e) => { state.eligible = e.target.checked; state.shown = PAGE; render(); });
  $("os-lists").addEventListener("change", (e) => { state.lists = e.target.checked; state.shown = PAGE; render(); });
  $("os-fresh").addEventListener("change", (e) => { state.fresh = e.target.checked; state.shown = PAGE; render(); });
  $("os-query").addEventListener("input", (e) => { state.query = e.target.value; state.shown = PAGE; render(); });
  $("os-more").addEventListener("click", () => { state.shown += PAGE; render(); });
  $("os-show-other").addEventListener("click", () => { setView("other"); $("os-tabs").scrollIntoView({ block: "start" }); });
  $("os-back").addEventListener("click", () => setView("all"));
  const dialog = $("os-detail");
  // Closing the panel beside the list keeps it shut until a row is picked again.
  dialog.querySelector(".os-close").addEventListener("click", () => { if (docked()) state.panelClosed = true; });
  dialog.addEventListener("close", () => {
    if (dialog.open) return; // reopened in the meantime (window resized)
    document.body.classList.remove("os-docked");
    dialog.classList.remove("docked");
    markSelected();
  });
  if (WIDE) WIDE.addEventListener("change", () => { if (dialog.open) dialog.close(); render(); });
  $("os-status").hidden = true;
  render();
}
function start() {
  fetch("./ownership-signals.json", { cache: "no-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      if (data.schema !== SCHEMA || !Array.isArray(data.companies)) throw new Error("unexpected data version");
      setup(data);
    })
    .catch((error) => {
      console.error("Insights could not load:", error);
      const status = $("os-status");
      status.textContent = "Insights could not be loaded. Try again later.";
      status.classList.add("error");
    });
}
start();
