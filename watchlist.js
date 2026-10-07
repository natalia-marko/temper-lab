// Temper Lab watchlist: a star beside every ticker on every page. Starred names
// are kept in this browser only (localStorage) and listed on watchlist.html.
// Nothing is sent anywhere. Values are written as text, never as HTML.
(function () {
  "use strict";
  const KEY = "temperlab.watchlist.v1";
  const SCHEMA = "temperlab-watchlist-1";
  const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const PAGES = { index: "Research", "market-mood": "Market mood", "analyst-ratings": "Analyst ratings",
    insights: "Insights", "jev-reads": "Jev reads", watchlist: "Watchlist" };
  const page = (String(globalThis.location?.pathname || "").split("/").pop() || "index.html").replace(/\.html$/, "") || "index";
  const listeners = [];
  let stored = true; // false when the browser blocks storage: stars then last for this visit only

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // Keeps valid rows only, one per symbol (the earliest date added wins).
  function clean(list) {
    const out = new Map();
    for (const x of Array.isArray(list) ? list : []) {
      const symbol = String((x && x.symbol) || "").trim().toUpperCase();
      if (!SYMBOL.test(symbol)) continue;
      const row = { symbol, name: typeof x.name === "string" ? x.name.slice(0, 120) : "",
        added: DAY.test(x.added) ? x.added : today(), page: typeof x.page === "string" ? x.page.slice(0, 40) : "" };
      const prev = out.get(symbol);
      if (!prev || row.added < prev.added) out.set(symbol, { ...row, name: row.name || (prev && prev.name) || "" });
      else if (!prev.name && row.name) prev.name = row.name;
    }
    return [...out.values()];
  }
  function load() {
    try {
      return clean(JSON.parse(globalThis.localStorage.getItem(KEY) || "[]"));
    } catch (error) {
      stored = false;
      return [];
    }
  }
  function save() {
    try {
      globalThis.localStorage.setItem(KEY, JSON.stringify(items));
      stored = true;
    } catch (error) {
      stored = false;
    }
    return stored;
  }
  let items = load();

  const has = (symbol) => items.some((x) => x.symbol === symbol);
  const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const label = (on) => (on ? "On your watchlist. Press to remove." : "Add to your watchlist");

  function paint(button) {
    const on = has(button.dataset.star);
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
    button.title = label(on);
    button.textContent = on ? "★" : "☆";
  }
  function refresh() {
    if (globalThis.document) {
      for (const b of document.querySelectorAll(".tl-star[data-star]")) paint(b);
      for (const n of document.querySelectorAll(".tl-watch-count")) n.textContent = items.length ? String(items.length) : "";
    }
    for (const fn of listeners) fn(items.slice());
  }
  function toggle(symbol, name) {
    symbol = String(symbol || "").trim().toUpperCase();
    if (!SYMBOL.test(symbol)) return false;
    if (has(symbol)) items = items.filter((x) => x.symbol !== symbol);
    else items = clean([...items, { symbol, name: name || "", added: today(), page }]);
    save();
    refresh();
    return has(symbol);
  }
  // A star as a DOM button (pages that build elements) ...
  function button(symbol, name) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tl-star";
    b.dataset.star = String(symbol || "").toUpperCase();
    if (name) b.dataset.name = name;
    b.setAttribute("aria-label", `Watch ${b.dataset.star}`);
    paint(b);
    return b;
  }
  // ... or as escaped HTML (pages that build strings). Never place it inside another button or link.
  function html(symbol, name) {
    const s = String(symbol || "").toUpperCase();
    const on = has(s);
    return `<button type="button" class="tl-star${on ? " on" : ""}" data-star="${escape(s)}"${name ? ` data-name="${escape(name)}"` : ""}`
      + ` aria-label="Watch ${escape(s)}" aria-pressed="${on}" title="${label(on)}">${on ? "★" : "☆"}</button>`;
  }
  function exportText() {
    return JSON.stringify({ schema: SCHEMA, exported_at: new Date().toISOString(), items }, null, 2);
  }
  // Adds the names from an exported file (or a plain list); returns how many were new.
  function importText(text) {
    const data = JSON.parse(text);
    const incoming = clean(Array.isArray(data) ? data : data && data.schema === SCHEMA ? data.items : null);
    if (!incoming.length) throw new Error("no watchlist names in this file");
    const before = new Set(items.map((x) => x.symbol));
    items = clean([...items, ...incoming]);
    save();
    refresh();
    return items.filter((x) => !before.has(x.symbol)).length;
  }

  if (globalThis.document) {
    // One listener for every star; it runs first so a star never opens the row it sits next to.
    document.addEventListener("click", (event) => {
      const b = event.target instanceof Element ? event.target.closest(".tl-star[data-star]") : null;
      if (!b) return;
      event.preventDefault();
      event.stopPropagation();
      toggle(b.dataset.star, b.dataset.name || "");
    }, true);
    // Another tab starred something: show it here too.
    globalThis.addEventListener("storage", (event) => {
      if (event.key === KEY || event.key === null) {
        items = load();
        refresh();
      }
    });
    refresh();
  }

  globalThis.TLWatch = { KEY, SCHEMA, PAGES, button, html, has, toggle, clean, exportText, importText,
    list: () => items.slice(), stored: () => stored, onChange: (fn) => listeners.push(fn) };
})();
