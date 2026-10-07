// "Results in the next 4 weeks" on the Market desk: when eligible stocks report,
// from share/earnings-calendar.json (Yahoo; refreshed by the Tue/Fri job).
// For planning, not a signal. Values are written as text, never as HTML.
(function () {
  "use strict";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const GROUPS = [["before open", "Before the open"], ["after close", "After the close"], [null, "Time not given"]];
  const BIGGEST = 6;

  const utc = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (isoDay, n) => { const d = utc(isoDay); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const monday = (isoDay) => addDays(isoDay, -((utc(isoDay).getUTCDay() + 6) % 7));
  const dayText = (isoDay) => { const d = utc(isoDay); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
  const weekdayText = (isoDay) => `${WEEKDAYS[utc(isoDay).getUTCDay()]} ${dayText(isoDay)}`;
  function spanText(from, to) {
    const a = utc(from), b = utc(to);
    if (from === to) return dayText(from);
    return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${dayText(to)}` : `${dayText(from)}–${dayText(to)}`;
  }
  function money(value) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return "";
    if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e11 ? 0 : 1)}B`;
    return `$${Math.round(v / 1e6)}M`;
  }
  const newYorkToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const byCap = (a, b) => (b.market_cap || 0) - (a.market_cap || 0) || a.symbol.localeCompare(b.symbol);

  // Rows from today to the end of the window, grouped Monday to Friday.
  function weeks(data, today, starred) {
    const rows = Object.entries(data.companies || {}).map(([symbol, c]) => ({ symbol, ...c }))
      .filter((r) => r.date >= today && r.date <= data.window.to);
    const groups = new Map();
    for (const r of rows) {
      const key = monday(r.date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([start, list]) => {
      const days = list.map((r) => r.date).sort();
      const from = start < today ? today : start;
      const friday = addDays(start, 4);
      const to = friday > data.window.to ? data.window.to : friday;
      const sorted = list.slice().sort(byCap);
      return { from: days[0] < from ? days[0] : from, to: days[days.length - 1] > to ? days[days.length - 1] : to,
        rows: sorted, starred: sorted.filter((r) => starred(r.symbol)), biggest: sorted.slice(0, BIGGEST) };
    });
  }

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function chip(r) {
    const node = el("span", "ea-chip");
    if (globalThis.TLWatch) node.append(globalThis.TLWatch.button(r.symbol, r.name));
    node.append(el("span", "ea-sym", r.symbol + (r.unsure ? " ~" : "")));
    node.title = [r.name, money(r.market_cap), r.unsure ? "date may change" : ""].filter(Boolean).join(" · ");
    return node;
  }
  function weekBlock(w) {
    const details = el("details", "ea-week");
    const summary = el("summary");
    summary.append(el("strong", "ea-when", spanText(w.from, w.to)),
      el("span", "ea-count", `${w.rows.length.toLocaleString("en-US")} ${w.rows.length === 1 ? "company" : "companies"}`));
    const names = el("span", "ea-names");
    if (w.starred.length) names.append(el("span", "ea-starred", `★ ${w.starred.map((r) => r.symbol).join(", ")}`));
    names.append(el("span", "", `biggest: ${w.biggest.map((r) => r.symbol).join(", ")}`));
    summary.append(names, el("span", "ea-toggle"));
    details.append(summary);
    const body = el("div", "ea-days");
    for (const d of [...new Set(w.rows.map((r) => r.date))].sort()) {
      const day = el("div", "ea-day");
      day.append(el("h3", "", weekdayText(d)));
      for (const [timing, label] of GROUPS) {
        const list = w.rows.filter((r) => r.date === d && (r.timing || null) === timing);
        if (!list.length) continue;
        const line = el("div", "ea-line");
        line.append(el("span", "ea-label", label));
        const chips = el("div", "ea-chips");
        chips.append(...list.map(chip));
        line.append(chips);
        day.append(line);
      }
      body.append(day);
    }
    details.append(body);
    return details;
  }
  function render(root, data) {
    const today = newYorkToday();
    const starred = (s) => Boolean(globalThis.TLWatch && globalThis.TLWatch.has(s));
    const list = weeks(data, today, starred);
    if (!list.length) { root.hidden = true; return; }
    const open = new Set([...root.querySelectorAll("details.ea-week[open]")].map((d) => d.dataset.week));
    document.getElementById("earnings-weeks").replaceChildren(...list.map((w) => {
      const block = weekBlock(w);
      block.dataset.week = w.from;
      if (open.has(w.from)) block.open = true;
      return block;
    }));
    const c = data.coverage || {};
    const reporting = list.reduce((n, w) => n + w.rows.length, 0);
    const unsure = list.reduce((n, w) => n + w.rows.filter((r) => r.unsure).length, 0);
    document.getElementById("earnings-built").textContent = data.built_at ? `Updated ${dayText(data.built_at)}` : "";
    document.getElementById("earnings-note").textContent =
      `${reporting.toLocaleString("en-US")} of ${Number(c.eligible || 0).toLocaleString("en-US")} eligible stocks report by ${dayText(data.window.to)}. `
      + `Dates come from Yahoo and can move until a company confirms${unsure ? `; ~ marks ${unsure} where Yahoo's two sources disagree` : ""}. `
      + "For planning, not a signal: our test found no price drift after results.";
    root.hidden = false;
  }
  function start() {
    const root = document.getElementById("earnings-ahead");
    if (!root) return;
    fetch("./earnings-calendar.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || data.schema !== "earnings-calendar-1" || !data.window) return;
        render(root, data);
        if (globalThis.TLWatch) globalThis.TLWatch.onChange(() => render(root, data));
      })
      .catch(() => { root.hidden = true; });
  }
  globalThis.TLEarnings = { weeks, monday, spanText, money };
  if (globalThis.document) start();
})();
