// "Earnings in the next 4 weeks" on Market mood, above the Market desk / Lists tabs: when eligible
// stocks report, from share/earnings-calendar.json (Yahoo; refreshed by the Tue/Fri job). For
// planning, not a signal (stated in "What these charts measure"). Values are written as text, never as HTML.
(function () {
  "use strict";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const GROUPS = [["before open", "Before the open"], ["after close", "After the close"], [null, "Time not given"]];
  const BIGGEST = 6;      // largest companies named in a week row
  const MINE_IN_ROW = 3;  // watchlist names (with day and time) in a week row
  const DAY_LIMIT = 20;   // companies shown per day before "+ N more"

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
  // With weekdays, for weeks that are not Monday to Friday: "Thu 8–Fri 9 Oct", "Fri 30 Oct–Mon 2 Nov".
  function weekdaySpan(from, to) {
    if (from === to) return weekdayText(from);
    const a = utc(from), b = utc(to), wa = WEEKDAYS[a.getUTCDay()], wb = WEEKDAYS[b.getUTCDay()];
    return a.getUTCMonth() === b.getUTCMonth() ? `${wa} ${a.getUTCDate()}–${wb} ${dayText(to)}` : `${wa} ${dayText(from)}–${wb} ${dayText(to)}`;
  }
  // Row label, honest about partial weeks: "This week · Thu 8–Fri 9 Oct", "Next week · 12–16 Oct",
  // "Mon 2–Tue 3 Nov (window ends)".
  function weekLabel(w, today, windowTo) {
    const start = monday(w.from), thisWeek = monday(today);
    const full = w.from === start && w.to === addDays(start, 4);
    const text = full ? spanText(w.from, w.to) : weekdaySpan(w.from, w.to);
    if (start === thisWeek) return `This week · ${text}`;
    if (start === addDays(thisWeek, 7)) return `Next week · ${text}`;
    return w.to === windowTo && !full ? `${text} (window ends)` : text;
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
  const TIME_ORDER = { "before open": 0, "after close": 1 };
  const byWhen = (a, b) => a.date.localeCompare(b.date) || (TIME_ORDER[a.timing] ?? 2) - (TIME_ORDER[b.timing] ?? 2) || byCap(a, b);
  const when = (r) => `${weekdayText(r.date)}${r.timing ? `, ${r.timing}` : ""}`;
  const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
  // "★ MSFT Wed 28 Oct, after close · AAPL Thu 29 Oct, after close · +2 more of yours"
  function mineText(list) {
    const sorted = list.slice().sort(byWhen);
    const shown = sorted.slice(0, MINE_IN_ROW).map((r) => `${r.symbol}${r.unsure ? " ~" : ""} ${when(r)}`);
    return `★ ${shown.join(" · ")}${sorted.length > MINE_IN_ROW ? ` · +${sorted.length - MINE_IN_ROW} more of yours` : ""}`;
  }

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
  // One day: the largest DAY_LIMIT companies by timing, then "+ N more" for the rest.
  function dayBlock(isoDay, list) {
    const day = el("div", "ea-day");
    const sorted = list.slice().sort(byCap);
    const draw = (all) => {
      const shown = all ? sorted : sorted.slice(0, DAY_LIMIT);
      const parts = [el("h3", "", `${weekdayText(isoDay)} · ${plural(sorted.length, "company", "companies")}`)];
      for (const [timing, label] of GROUPS) {
        const group = shown.filter((r) => (r.timing || null) === timing);
        if (!group.length) continue;
        const line = el("div", "ea-line");
        const chips = el("div", "ea-chips");
        chips.append(...group.map(chip));
        line.append(el("span", "ea-label", label), chips);
        parts.push(line);
      }
      if (sorted.length > shown.length) {
        const more = el("button", "ea-more", `+ ${(sorted.length - shown.length).toLocaleString("en-US")} more, smaller companies`);
        more.type = "button";
        more.addEventListener("click", () => draw(true));
        parts.push(more);
      }
      day.replaceChildren(...parts);
    };
    draw(false);
    return day;
  }
  function weekBlock(w, ctx) {
    const rows = ctx.mine ? w.starred : w.rows;
    const details = el("details", "ea-week");
    const summary = el("summary");
    const count = el("span", "ea-count");
    const bar = el("span", "ea-bar");
    const fill = el("span");
    fill.style.width = `${ctx.max && rows.length ? Math.max(3, Math.round((100 * rows.length) / ctx.max)) : 0}%`;
    bar.append(fill);
    count.append(bar, el("span", "ea-n", rows.length.toLocaleString("en-US")));
    count.title = plural(rows.length, "company reports", "companies report");
    const names = el("span", "ea-names");
    if (w.starred.length) names.append(el("span", "ea-starred", mineText(w.starred)));
    if (!ctx.mine) names.append(el("span", "", `Largest: ${w.biggest.map((r) => r.symbol + (r.unsure ? " ~" : "")).join(", ")}`));
    else if (!w.starred.length) names.append(el("span", "ea-none", "none of yours"));
    summary.append(el("strong", "ea-when", weekLabel(w, ctx.today, ctx.windowTo)), count, names, el("span", "ea-toggle"));
    details.append(summary);
    const body = el("div", "ea-days");
    const days = [...new Set(rows.map((r) => r.date))].sort();
    if (!days.length) body.append(el("p", "ea-none", "None of your watchlist stocks report this week."));
    for (const d of days) body.append(dayBlock(d, rows.filter((r) => r.date === d)));
    details.append(body);
    return details;
  }
  const state = { mine: false };
  function render(root, data) {
    const today = newYorkToday();
    const starred = (s) => Boolean(globalThis.TLWatch && globalThis.TLWatch.has(s));
    const list = weeks(data, today, starred);
    if (!list.length) { root.hidden = true; return; }
    const windowTo = data.window.to;
    const mineAll = list.flatMap((w) => w.starred).sort(byWhen);
    const max = Math.max(1, ...list.map((w) => (state.mine ? w.starred : w.rows).length));
    const open = new Set([...root.querySelectorAll("details.ea-week[open]")].map((d) => d.dataset.week));
    document.getElementById("earnings-weeks").replaceChildren(...list.map((w) => {
      const block = weekBlock(w, { mine: state.mine, today, windowTo, max });
      block.dataset.week = w.from;
      if (open.has(w.from)) block.open = true;
      return block;
    }));

    // One line with what matters: coverage, the busiest week, and your names.
    const c = data.coverage || {};
    const reporting = list.reduce((n, w) => n + w.rows.length, 0);
    const busiest = list.reduce((a, w) => (w.rows.length > a.rows.length ? w : a), list[0]);
    const thisWeek = list[0] && monday(list[0].from) === monday(today) ? list[0].starred.length : 0;
    const watched = globalThis.TLWatch ? globalThis.TLWatch.list().length : 0;
    let mine = "";
    if (mineAll.length && thisWeek) mine = `★ ${thisWeek} of yours this week`;
    else if (mineAll.length) mine = `★ next of yours: ${mineAll[0].symbol} ${when(mineAll[0])}`;
    else if (watched) mine = "★ none of your watchlist stocks in this window";
    const parts = state.mine
      ? [`★ ${plural(mineAll.length, "of your watchlist stocks reports", "of your watchlist stocks report")} by ${dayText(windowTo)}`]
      : [`${reporting.toLocaleString("en-US")} of ${Number(c.eligible || 0).toLocaleString("en-US")} eligible stocks report by ${dayText(windowTo)}`,
        `busiest week ${spanText(busiest.from, busiest.to)} (${busiest.rows.length.toLocaleString("en-US")})`];
    if (!state.mine && mine) parts.push(mine);
    document.getElementById("earnings-summary").textContent = parts.join(" · ");
    document.getElementById("earnings-built").textContent = data.built_at ? `Updated ${weekdayText(data.built_at)}` : "";
    const mineButton = document.getElementById("ea-mine");
    if (mineButton) mineButton.textContent = `★ My watchlist (${mineAll.length})`;

    // "~" legend only when such dates exist in the window.
    const unsure = list.reduce((n, w) => n + w.rows.filter((r) => r.unsure).length, 0);
    const note = document.getElementById("earnings-note");
    note.textContent = unsure ? `~ = date not yet confirmed: Yahoo's two sources disagree (${unsure} in this window).` : "";
    note.hidden = !unsure;
    root.hidden = false;
  }
  function start() {
    const root = document.getElementById("earnings-ahead");
    if (!root) return;
    fetch("./earnings-calendar.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || data.schema !== "earnings-calendar-1" || !data.window) return;
        for (const [id, mine] of [["ea-all", false], ["ea-mine", true]]) {
          const b = document.getElementById(id);
          if (!b) continue;
          b.addEventListener("click", () => {
            state.mine = mine;
            for (const [other, value] of [["ea-all", false], ["ea-mine", true]]) {
              const x = document.getElementById(other);
              if (x) { x.classList.toggle("on", value === mine); x.setAttribute("aria-pressed", String(value === mine)); }
            }
            render(root, data);
          });
        }
        render(root, data);
        if (globalThis.TLWatch) globalThis.TLWatch.onChange(() => render(root, data));
      })
      .catch(() => { root.hidden = true; });
  }
  globalThis.TLEarnings = { weeks, monday, spanText, weekdaySpan, weekLabel, mineText, money };
  if (globalThis.document) start();
})();
