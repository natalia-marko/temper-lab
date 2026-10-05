"use strict";
// Ownership Signals (beta). Reads ownership-signals.json only. All SEC-derived
// text is set with textContent; nothing from the data is parsed as HTML.
(() => {
  const SCHEMA = "ownership-signals-1";
  const MONEY_LABEL = {
    buy: "bought", buy_plan: "bought under a 10b5-1 plan", buy_private: "bought privately or in an offering",
    sell_no_plan: "sold, no 10b5-1 plan", sell_plan: "sold under a 10b5-1 plan", sell_tax: "sold to cover tax",
    sell_private: "sold privately", transfer: "moved between related holders",
  };
  const ROUTINE_LABEL = { grant: "award", exercise: "exercise", tax_withholding: "tax withholding", gift: "gift", other: "other row" };
  const sum = (m, keys) => keys.reduce((total, key) => total + ((m || {})[key] || 0), 0);
  // Officers and directors ("insider") are kept apart from 10% owners and other holders.
  const TABS = [
    { key: "buy", label: "Insider buying", head: "Bought", by: "insider", keys: ["buy", "buy_plan"] },
    { key: "sell", label: "Selling, no plan", head: "Sold, no plan", by: "insider", keys: ["sell_no_plan"] },
    { key: "plan", label: "Plan & tax sales", head: "Sold", by: "insider", keys: ["sell_plan", "sell_tax"] },
    { key: "holders", label: "10% owners", head: "Traded", by: "holder", keys: ["buy", "buy_plan", "sell_no_plan", "sell_plan"] },
    { key: "other", label: "Private, transfers & routine", head: "Moved", by: null, keys: ["transfer", "buy_private", "sell_private"] },
  ];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const state = { tab: "buy", eligible: true, lists: false, query: "", shown: 50, data: null };
  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function money(value) {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 999500) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1000) return `$${Math.round(value / 1e3)}K`;
    return `$${Math.round(value)}`;
  }
  function day(iso) {
    const [, month, date] = String(iso || "").split("-");
    return month ? `${Number(date)} ${MONTHS[Number(month) - 1]}` : "";
  }
  function span(first, last) {
    return first === last ? day(first) : `${day(first)}–${day(last)}`;
  }
  function amount(company, tab) {
    return sum(tab.by ? (company.money_by || {})[tab.by] : company.money, tab.keys);
  }
  function inTab(company, tab) {
    if (tab.key === "other") return !TABS.slice(0, -1).some((t) => amount(company, t) > 0);
    return amount(company, tab) > 0;
  }
  function isNew(company) {
    const until = new Date(`${state.data.window.until}T00:00:00Z`);
    const filed = new Date(`${company.latest_filing_day}T00:00:00Z`);
    return (until - filed) / 864e5 <= 6;
  }
  function holdingText(person) {
    const h = person.holding;
    if (!h) return "";
    if (h.status === "new_position") return ", new holding";
    const sign = h.side === "sale" ? "−" : "+";
    return `, holding ${sign}${Math.abs(h.change_pct)}%`;
  }
  const INSIDER = new Set(["CEO", "CFO", "Officer", "Director"]);
  function detailLine(company, tab) {
    const people = company.people.filter((p) => tab.keys.some((key) => p.money[key])
      && (!tab.by || (tab.by === "insider") === INSIDER.has(p.role)));
    const lead = people[0] || company.people[0];
    if (!lead) return "";
    let text = `${lead.role} ${lead.names[0]}${holdingText(lead)}`;
    if (lead.plan_adopted && lead.plan_adopted.length) text += `, plan adopted ${lead.plan_adopted[0]}`;
    if (people.length > 1) text += ` and ${people.length - 1} more`;
    return text;
  }
  function tags(company) {
    const f = company.flags;
    const out = [];
    if (f.buyers_within_10_sessions >= 2) out.push([`${f.buyers_within_10_sessions} insiders bought within 10 sessions`, ""]);
    if (f.ceo_or_cfo_bought) out.push(["CEO or CFO bought", ""]);
    if (f.holding_up_5pct_on_50k) out.push(["holding +5% or new, on $50K+", ""]);
    if (f.officers_sold_without_plan >= 2) out.push([`${f.officers_sold_without_plan} officers sold, no plan`, "warn"]);
    if (company.money.sell_tax) out.push(["sold to cover tax", "muted"]);
    if (f.transfers) out.push(["transfer between related holders", "muted"]);
    if (f.rows_to_check) out.push([`${f.rows_to_check} row${f.rows_to_check > 1 ? "s" : ""} to check`, "warn"]);
    return out;
  }
  function visible() {
    const tab = TABS.find((t) => t.key === state.tab);
    const query = state.query.trim().toLowerCase();
    return state.data.companies
      .filter((c) => inTab(c, tab))
      .filter((c) => !state.eligible || c.eligible)
      .filter((c) => !state.lists || c.lists.length)
      .filter((c) => !query || [c.symbol, c.name, ...c.people.flatMap((p) => p.names)]
        .some((text) => String(text || "").toLowerCase().includes(query)))
      .sort((a, b) => amount(b, tab) - amount(a, tab) || String(b.latest_filing_day).localeCompare(a.latest_filing_day));
  }
  function row(company, tab) {
    const button = el("button", "os-row");
    button.type = "button";
    button.addEventListener("click", () => openDetail(company));
    const co = el("span", "os-co");
    const tk = el("span", "os-tk");
    tk.append(el("strong", "", company.symbol));
    if (company.lists.length) tk.append(el("span", "os-chip", company.lists.join(" · ")));
    co.append(tk, el("span", "os-name", company.name));
    const meta = [company.price ? `$${company.price.toFixed(2)}` : "", company.market_cap ? money(company.market_cap) : ""]
      .filter(Boolean).join(" · ");
    co.append(el("span", "os-meta", meta || (company.eligible ? "" : "outside eligible set")));
    const what = el("span", "os-what");
    what.append(el("span", "os-headline", company.headline));
    const line = detailLine(company, tab);
    if (line) what.append(el("span", "os-detail-line", line));
    const tagBox = el("span", "os-tags");
    for (const [text, kind] of tags(company)) tagBox.append(el("span", `os-tag ${kind}`.trim(), text));
    if (tagBox.childNodes.length) what.append(tagBox);
    const value = amount(company, tab);
    const filed = el("span", "os-filed", day(company.latest_filing_day));
    if (isNew(company)) filed.append(el("span", "os-new", "NEW"));
    button.append(co, what, el("span", "os-amount num", value ? money(value) : "—"), filed, el("span", "os-chev", "›"));
    return button;
  }
  function render() {
    const tab = TABS.find((t) => t.key === state.tab);
    const list = visible();
    $("os-amount-head").textContent = tab.head;
    const box = $("os-rows");
    box.replaceChildren(...list.slice(0, state.shown).map((c) => row(c, tab)));
    $("os-count").textContent = `${list.length} companies · sorted by amount, then newest filing`;
    $("os-more").hidden = list.length <= state.shown;
    for (const button of $("os-tabs").querySelectorAll("button")) {
      const on = button.dataset.tab === state.tab;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    }
  }
  function openDetail(company) {
    const body = $("os-detail-body");
    const title = el("h2", "", `${company.symbol} · ${company.name}`);
    title.id = "os-detail-title";
    const parts = [title];
    const meta = [company.lists.join(" · "), company.market_cap ? `market cap ${money(company.market_cap)}` : "",
      company.eligible ? "" : "outside the eligible set"].filter(Boolean).join(" · ");
    if (meta) parts.push(el("p", "os-meta", meta));
    parts.push(el("p", "os-headline", company.headline));
    const tiles = el("div", "os-tiles");
    for (const [key, label] of Object.entries(MONEY_LABEL)) {
      if (!company.money[key]) continue;
      const tile = el("div", "os-tile");
      tile.append(el("b", "", money(company.money[key])), el("span", "", label));
      tiles.append(tile);
    }
    if (tiles.childNodes.length) parts.push(tiles);
    const routine = Object.entries(company.routine || {}).map(([k, n]) => `${n} ${ROUTINE_LABEL[k] || k}${n > 1 ? "s" : ""}`);
    if (routine.length) parts.push(el("p", "os-detail-line", `Also filed: ${routine.join(", ")}.`));
    const section = el("div", "os-section");
    section.append(el("h3", "", "Who traded"));
    const table = el("table", "os-people");
    const head = el("tr");
    for (const h of ["Role", "Name", "Activity", "Traded", "Holding", "Plan adopted"]) head.append(el("th", "", h));
    table.append(head);
    for (const person of company.people) {
      const activity = Object.entries(person.money).map(([k, v]) => `${MONEY_LABEL[k]} ${money(v)}`);
      for (const [k, n] of Object.entries(person.routine || {})) activity.push(`${n} ${ROUTINE_LABEL[k] || k}${n > 1 ? "s" : ""}`);
      const tr = el("tr");
      tr.append(el("td", "", person.role), el("td", "", person.names.join(", ")), el("td", "", activity.join("; ")),
        el("td", "", span(person.first_trade, person.last_trade)), el("td", "", holdingText(person).replace(/^, /, "") || "—"),
        el("td", "", (person.plan_adopted || []).join(", ") || "—"));
      table.append(tr);
    }
    section.append(table);
    parts.push(section);
    const filings = el("div", "os-section os-filings");
    filings.append(el("h3", "", "SEC filings"));
    for (const filing of company.filings) {
      if (!String(filing.url).startsWith("https://www.sec.gov/")) continue;
      const link = el("a", "", `${day(filing.day)} · ${filing.accession}`);
      link.href = filing.url;
      link.rel = "noopener";
      link.target = "_blank";
      filings.append(link);
    }
    parts.push(filings);
    body.replaceChildren(...parts);
    $("os-detail").showModal();
  }
  function setup(data) {
    state.data = data;
    const { window: w, universe, coverage, counts } = data;
    $("os-window").textContent = `Filings ${day(w.since)}–${day(w.until)} (${w.sessions} sessions)`;
    $("os-coverage").textContent = `${universe.issuers.toLocaleString()} issuers (${universe.scope}) · `
      + `${universe.eligible.toLocaleString()} eligible · ${coverage.xml_read.toLocaleString()} Form 4/5 filings read`;
    $("os-built").textContent = `Built ${String(data.built_at).slice(0, 10)}`;
    const rows = counts.rows || {};
    $("os-excluded").textContent = `Not counted: ${rows.repeat || 0} repeated reports, ${rows.superseded || 0} amended originals, `
      + `${rows.review || 0} rows to check, ${rows.outside_window || 0} late reports of older trades.`;
    $("os-build").textContent = `Run ${data.run_id} · method ${data.method_version}`;
    const tabBox = $("os-tabs");
    for (const tab of TABS) {
      const button = el("button", "", tab.label);
      button.type = "button";
      button.dataset.tab = tab.key;
      button.addEventListener("click", () => { state.tab = tab.key; state.shown = 50; render(); });
      tabBox.append(button);
    }
    $("os-eligible").addEventListener("change", (e) => { state.eligible = e.target.checked; state.shown = 50; render(); });
    $("os-lists").addEventListener("change", (e) => { state.lists = e.target.checked; state.shown = 50; render(); });
    $("os-query").addEventListener("input", (e) => { state.query = e.target.value; state.shown = 50; render(); });
    $("os-more").addEventListener("click", () => { state.shown += 50; render(); });
    $("os-status").hidden = true;
    render();
  }
  fetch("./ownership-signals.json", { cache: "no-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      if (data.schema !== SCHEMA) throw new Error("unexpected data version");
      setup(data);
    })
    .catch(() => {
      const status = $("os-status");
      status.textContent = "Ownership signals are not published yet or could not be read. This beta page awaits its first run.";
      status.classList.add("error");
    });
})();
