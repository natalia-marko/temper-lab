// Decision tape: two dated facts for a name you might hold.
// Jev raised? from the published suggestion book (same labels as jev-reads.html).
// Conviction revision up? from the Research freeze's 30-day EPS up/down counts.
// Lookups and labels only. No combined score. Not a buy or sell call.
"use strict";

(function (root) {
  const INDEX_SCHEMA = "jev-reads-index-1";
  const BOOK_SCHEMA = "jev-suggestion-book-3";

  function latestBook(index) {
    if (!index || index.schema !== INDEX_SCHEMA || !index.latest) return null;
    const latest = index.latest;
    const books = index.suggestion_books || {};
    const week = (index.weeks || []).find((w) => w && w.source === "research_shortlist"
      && (w.as_of === latest || w.id === latest));
    const book = books[latest] || (week && (books[week.id] || books[week.as_of])) || null;
    if (!book || book.schema !== BOOK_SCHEMA || !Array.isArray(book.releases) || book.as_of !== latest) {
      return null;
    }
    return book;
  }

  function jevOf(book, symbol) {
    const ticker = String(symbol || "").trim().toUpperCase();
    const href = "./jev-reads.html";
    if (!book) {
      return { state: "unavailable", label: "Unavailable", detail: "Jev reads not loaded", href, filed: null, as_of: null };
    }
    const row = (book.releases || []).find((r) => String(r.ticker || "").toUpperCase() === ticker);
    if (!row || !row.read || !row.read.guidance) {
      return {
        state: "unread", label: "Not read",
        detail: `Jev reads the Research Shortlist, week of ${book.as_of || "this snapshot"}`,
        href, filed: null, as_of: book.as_of || null,
      };
    }
    const g = row.read.guidance;
    const label = g.label || "No answer";
    const filed = row.filed || null;
    if (g.unsure) {
      return {
        state: "unsure", label: "AI unsure",
        detail: `${label} · confidence below 0.5 · filed ${filed || "n/a"}`,
        href, filed, as_of: book.as_of || null,
      };
    }
    if (label === "Raised") {
      return {
        state: "raised", label: "Raised",
        detail: `Company outlook vs its own previous guidance · filed ${filed || "n/a"}`,
        href, filed, as_of: book.as_of || null,
      };
    }
    return {
      state: "not_raised", label,
      detail: `Jev's read of the latest earnings release · filed ${filed || "n/a"}`,
      href, filed, as_of: book.as_of || null,
    };
  }

  function revisionOf(factors) {
    const f = factors || {};
    const upRaw = f.up_last_30_days;
    const downRaw = f.down_last_30_days;
    const up = typeof upRaw === "number" && Number.isFinite(upRaw) ? upRaw : null;
    const down = typeof downRaw === "number" && Number.isFinite(downRaw) ? downRaw : null;
    const stored = typeof f.revision_breadth === "number" && Number.isFinite(f.revision_breadth)
      ? f.revision_breadth : null;
    if (up === null && down === null && stored === null) {
      return { state: "missing", label: "No snapshot",
        detail: "No 30-day EPS revision counts in this week's Research freeze",
        up: null, down: null, breadth: null };
    }
    const u = up ?? 0;
    const d = down ?? 0;
    const breadth = stored !== null ? stored : (u + d ? (u - d) / (u + d) : 0);
    const counts = `${u} up · ${d} down`;
    if (breadth > 0) {
      return { state: "up", label: "Up", detail: `${counts}, current fiscal year`, up: u, down: d, breadth };
    }
    if (breadth < 0) {
      return { state: "down", label: "Down", detail: `${counts}, current fiscal year`, up: u, down: d, breadth };
    }
    return { state: "flat", label: "Unchanged", detail: `${counts}, current fiscal year`, up: u, down: d, breadth };
  }

  function tape(symbol, opts) {
    const options = opts || {};
    const jev = jevOf(options.book, symbol);
    const revision = revisionOf(options.factors);
    const retrieved = options.analystRetrievedAt;
    if (revision.state !== "missing" && typeof retrieved === "string" && retrieved.slice(0, 10)) {
      revision.detail = `${revision.detail} · retrieved ${retrieved.slice(0, 10)}`;
    }
    return {
      symbol: String(symbol || "").trim().toUpperCase(),
      jev,
      revision,
      as_of: options.asOf || jev.as_of || null,
    };
  }

  root.TLTape = { latestBook, jevOf, revisionOf, tape };
})(typeof globalThis !== "undefined" ? globalThis : this);
