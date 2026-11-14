// Decision tape: a dated fact for a name you might hold.
// EPS revisions up? from the Research freeze's 30-day EPS up/down counts.
// ("Jev raised?" left with the Earnings read by Jev page on 13 Nov 2026: no edge after 3 days.)
// Lookups and labels only. No combined score. Not a buy or sell call.
"use strict";

(function (root) {
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
    const revision = revisionOf(options.factors);
    const retrieved = options.analystRetrievedAt;
    if (revision.state !== "missing" && typeof retrieved === "string" && retrieved.slice(0, 10)) {
      revision.detail = `${revision.detail} · retrieved ${retrieved.slice(0, 10)}`;
    }
    return {
      symbol: String(symbol || "").trim().toUpperCase(),
      revision,
      as_of: options.asOf || null,
    };
  }

  root.TLTape = { revisionOf, tape };
})(typeof globalThis !== "undefined" ? globalThis : this);
