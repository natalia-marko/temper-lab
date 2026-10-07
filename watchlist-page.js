// The Watchlist page: names starred on any page, with facts from the latest
// Research snapshot (desk.json) and the earnings calendar when it exists.
(function () {
  "use strict";
  const W = globalThis.TLWatch;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parts = (iso) => String(iso || "").slice(0, 10).split("-").map(Number);
  const shortDay = (iso) => { const [, m, d] = parts(iso); return m && d ? `${d} ${MONTHS[m - 1]}` : "—"; };
  const longDay = (iso) => { const [y, m, d] = parts(iso); return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : "—"; };
  function money(value) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return "—";
    if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e11 ? 0 : 1)}B`;
    if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
    return `$${Math.round(v).toLocaleString("en-US")}`;
  }
  const price = (value) => (Number(value) > 0 ? `$${Number(value).toFixed(2)}` : "—");
  function resultsText(next) {
    if (!next || !next.date) return "—";
    return `${shortDay(next.date)}${next.timing ? `, ${next.timing}` : ""}${next.unsure ? " (may change)" : ""}`;
  }

  let desk = {};
  let earnings = {};
  function row(item) {
    const c = desk[item.symbol] || {};
    const tr = el("tr");
    const star = el("td", "wl-star");
    star.append(W.button(item.symbol, item.name || c.name || ""));
    const co = el("td");
    co.append(el("strong", "", item.symbol), el("small", "", c.name || item.name || "Not in this week's Research snapshot"));
    const from = W.PAGES[item.page];
    tr.append(star, co, el("td", "num", price(c.price)), el("td", "num", money(c.market_cap)),
      el("td", "", resultsText(earnings[item.symbol])), el("td", "", `${longDay(item.added)}${from ? ` · ${from}` : ""}`));
    return tr;
  }
  function render(items) {
    const sorted = items.slice().sort((a, b) => b.added.localeCompare(a.added) || a.symbol.localeCompare(b.symbol));
    $("wl-count").textContent = items.length ? `${items.length} ${items.length === 1 ? "company" : "companies"}` : "";
    $("wl-empty").hidden = items.length > 0;
    $("wl-table").hidden = items.length === 0;
    $("wl-export").disabled = items.length === 0;
    $("wl-storage").hidden = W.stored();
    $("wl-rows").replaceChildren(...sorted.map(row));
  }
  const say = (text) => { $("wl-status").textContent = text; };

  function setup() {
    $("wl-export").addEventListener("click", () => {
      const link = el("a");
      link.href = URL.createObjectURL(new Blob([W.exportText()], { type: "application/json" }));
      link.download = `temperlab-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
      say("Saved a copy to your downloads.");
    });
    $("wl-import").addEventListener("change", async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        const added = W.importText(await file.text());
        say(added ? `Added ${added} ${added === 1 ? "company" : "companies"} from the file.` : "Every company in the file was already on your watchlist.");
      } catch (error) {
        say(`Could not read this file: ${error.message}.`);
      }
      event.target.value = "";
    });
    W.onChange(render);
    render(W.list());
    const get = (url) => fetch(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get("./desk.json"), get("./earnings-calendar.json")]).then(([deskData, calendar]) => {
      desk = (deskData && deskData.companies) || {};
      earnings = (calendar && calendar.companies) || {};
      const asOf = Object.values(desk).find((c) => c && c.price_date);
      $("wl-source").textContent = asOf ? `Price and market value: close on ${longDay(asOf.price_date)} (Research snapshot).` : "";
      render(W.list());
    });
  }
  if (W && $("wl-rows")) setup();
})();
