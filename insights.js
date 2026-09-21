const KIND_LABEL = {
  open_market_buy: "Open-market buy",
  open_market_sell: "Open-market sell",
  passive_holder: "Passive 13G",
  exercise_or_convert: "Exercise / convert",
  ownership_disclosure: "Ownership filing",
};
const SIDE_LABEL = {
  open_market_buy: "bought",
  open_market_sell: "sold",
  passive_holder: "13G",
  exercise_or_convert: "exercise",
  ownership_disclosure: "filed",
};

const insightsState = {
  digest: null,
  desk: null,
  release: null,
  filters: { query: "", kind: "open_market_buy" },
};

function kindClass(type) {
  if (type === "open_market_buy") return "buy";
  if (type === "open_market_sell") return "sell";
  return "other";
}

function screenLabel(key) {
  return { strength: "Hot Tape", growth: "Growth", undervalued: "Cheap" }[key] || key;
}

function filteredInsights(events, filters) {
  const query = (filters.query || "").trim().toLowerCase();
  return (events || []).filter(event => {
    if (filters.kind === "open_market_buy" && event.event_type !== "open_market_buy") return false;
    if (filters.kind === "open_market_sell" && event.event_type !== "open_market_sell") return false;
    if (filters.kind === "other" && (event.event_type === "open_market_buy" || event.event_type === "open_market_sell")) return false;
    if (!query) return true;
    const blob = [event.symbol, event.name, event.filer, event.filer_title, event.filer_kind, event.plain_reason].join(" ").toLowerCase();
    return blob.includes(query);
  });
}

function compactUsd(value) {
  if (value == null || Number.isNaN(Number(value))) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value));
}

function formatFracCap(frac) {
  if (frac == null || Number.isNaN(Number(frac))) return "n/a";
  const pct = Number(frac) * 100;
  const abs = Math.abs(pct);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

function monthTape(return21) {
  if (return21 == null || Number.isNaN(Number(return21))) return "";
  const pct = Number(return21) * 100;
  const digits = Math.abs(pct) >= 1 ? 0 : 1;
  const shown = `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
  const trend = return21 > 0 ? "trending up" : return21 < 0 ? "trending down" : "flat";
  return `Price: ${shown} past month (${trend})`;
}

function sideLabel(type) {
  return SIDE_LABEL[type] || KIND_LABEL[type] || type;
}

const ROLE_LABEL = {
  officer: "Officer",
  director: "Director",
  "ten-percent holder": "10% holder",
  insider: "Insider",
  institution: "Institution",
};
const ENTITY_NAME = /\b(l\.?p\.?|llp|llc|inc\.?|ltd\.?|corp\.?|plc|partners|management|advisors?)\b/i;

function whoLabel(event) {
  const form = String(event.form || "");
  const namedInstitution = ENTITY_NAME.test(event.filer || "");
  const kind = event.filer_kind
    || (form.startsWith("SC 13") || event.filer_role === "institution" || namedInstitution ? "institution" : "person");
  let title = (event.filer_title || "").trim();
  if (!title) {
    if (event.event_type === "passive_holder") title = "13G";
    else if (event.event_type === "exercise_or_convert") title = "Exercise";
    else if (event.event_type === "ownership_disclosure") title = event.form || "13D";
    else title = ROLE_LABEL[event.filer_role] || event.filer_role || "filer";
  }
  return `${kind === "institution" ? "Institution" : "Person"} · ${title}`;
}

function overlayContext(event) {
  const company = insightsState.desk?.companies?.[event.symbol] || {};
  const cap = event.market_cap ?? company.market_cap;
  let frac = event.usd_frac_cap;
  if (frac == null && cap > 0 && event.usd != null) {
    frac = event.usd / cap;
    if (event.event_type === "open_market_sell") frac = -frac;
  }
  return {
    cap,
    usd: event.usd,
    frac,
    return21: event.return_21,
  };
}

function appendText(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function renderInsights() {
  const digest = insightsState.digest;
  const root = document.getElementById("insights-list");
  const count = document.getElementById("insights-count");
  const chip = document.getElementById("week-chip");
  const coverage = document.getElementById("insights-coverage");
  const aside = document.getElementById("aside-week");
  if (!digest) return;
  const asOf = digest.freeze_as_of;
  if (chip) chip.textContent = `Data as of ${asOf}`;
  if (aside) aside.textContent = asOf;
  if (coverage) {
    coverage.textContent = `${digest.universe_n} published Strength / Growth / Cheap names · filings ${digest.since} to ${digest.until}`;
  }
  const rows = filteredInsights(digest.events, insightsState.filters);
  const buys = (digest.counts && digest.counts.open_market_buy) || 0;
  if (count) {
    count.textContent = `${rows.length} shown · ${buys} open-market buys in this window. This is not a rank.`;
  }
  if (!root) return;
  root.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = insightsState.filters.kind === "open_market_buy"
      ? "No reported open-market buys in this window."
      : "No filings match these filters.";
    root.appendChild(empty);
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "insights-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Ticker", "Side", "Who", "Amount", "% cap", "Price"]) {
    appendText(headRow, "th", label);
  }
  head.appendChild(headRow);
  table.appendChild(head);
  const body = document.createElement("tbody");
  for (const event of rows) {
    const ctx = overlayContext(event);
    const tr = document.createElement("tr");
    const ticker = appendText(tr, "td", event.symbol, "ticker");
    const name = document.createElement("span");
    name.className = "meta";
    name.textContent = event.name || event.symbol;
    ticker.appendChild(name);
    appendText(tr, "td", sideLabel(event.event_type), `side ${kindClass(event.event_type)}`);
    const who = appendText(tr, "td", whoLabel(event), "who");
    const filer = document.createElement("span");
    filer.className = "meta";
    filer.textContent = event.filer || "";
    who.appendChild(filer);
    appendText(tr, "td", compactUsd(ctx.usd), "amount");
    appendText(tr, "td", formatFracCap(ctx.frac), "frac");
    const tape = monthTape(ctx.return21) || "n/a";
    const price = appendText(
      tr,
      "td",
      tape,
      `tape${ctx.return21 > 0 ? " up" : ctx.return21 < 0 ? " down" : ""}`,
    );
    const reason = document.createElement("span");
    reason.className = "meta";
    const screens = (event.screens || []).map(screenLabel).join(" · ");
    const bits = [event.plain_reason, event.form, screens, event.trade_date || event.accepted_at].filter(Boolean);
    reason.textContent = bits.join(" · ");
    price.appendChild(reason);
    if (event.sec_url) {
      const link = document.createElement("a");
      link.href = event.sec_url;
      link.textContent = "SEC filing";
      link.rel = "noopener noreferrer";
      price.appendChild(link);
    }
    body.appendChild(tr);
  }
  table.appendChild(body);
  wrap.appendChild(table);
  root.appendChild(wrap);
}

function bindInsights() {
  const query = document.getElementById("insights-query");
  const kind = document.getElementById("insights-kind");
  const reset = document.getElementById("insights-reset");
  if (query) query.addEventListener("input", () => {
    insightsState.filters.query = query.value;
    renderInsights();
  });
  if (kind) kind.addEventListener("change", () => {
    insightsState.filters.kind = kind.value;
    renderInsights();
  });
  if (reset) reset.addEventListener("click", () => {
    insightsState.filters = { query: "", kind: "open_market_buy" };
    if (query) query.value = "";
    if (kind) kind.value = "open_market_buy";
    renderInsights();
  });
}

function startInsights() {
  bindInsights();
  Promise.all([
    fetch("./insights.json", { cache: "no-store" }).then(r => r.json()),
    fetch("./desk.json", { cache: "no-store" }).then(r => r.json()),
    fetch("./release.json", { cache: "no-store" }).then(r => r.json()),
  ]).then(([digest, desk, release]) => {
    const status = document.getElementById("insights-status");
    if (digest.schema !== "ownership-digest-1") {
      throw new Error("insights schema is not ownership-digest-1");
    }
    if (digest.freeze_run_id !== desk.run_id || digest.freeze_as_of !== desk.as_of) {
      throw new Error("insights freeze does not match the public desk");
    }
    if (release.run_id && release.run_id !== desk.run_id) {
      throw new Error("release pointer does not match the public desk");
    }
    insightsState.digest = digest;
    insightsState.desk = desk;
    insightsState.release = release;
    if (status) status.hidden = true;
    renderInsights();
  }).catch(error => {
    const status = document.getElementById("insights-status");
    if (status) status.textContent = error.message || "Insights are unavailable.";
  });
}

startInsights();
