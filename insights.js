const KIND_LABEL = {
  open_market_buy: "Open-market buy",
  open_market_sell: "Open-market sell",
  passive_holder: "Passive 13G",
  exercise_or_convert: "Exercise / convert",
  ownership_disclosure: "Ownership filing",
};

const insightsState = {
  digest: null,
  desk: null,
  release: null,
  filters: { query: "", kind: "open_market_buy" },
};

function kindClass(type) {
  if (type === "open_market_buy") return "kind";
  if (type === "open_market_sell") return "kind sell";
  return "kind other";
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
    const blob = [event.symbol, event.name, event.filer, event.plain_reason].join(" ").toLowerCase();
    return blob.includes(query);
  });
}

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return "";
  return `$${Math.round(Number(value)).toLocaleString("en-US")}`;
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
  for (const event of rows) {
    const card = document.createElement("article");
    card.className = "insight-card";
    const header = document.createElement("header");
    const who = document.createElement("strong");
    who.textContent = `${event.symbol} · ${event.name || event.symbol}`;
    const kind = document.createElement("span");
    kind.className = kindClass(event.event_type);
    kind.textContent = KIND_LABEL[event.event_type] || event.event_type;
    header.appendChild(who);
    header.appendChild(kind);
    const reason = document.createElement("p");
    reason.textContent = event.plain_reason;
    const meta = document.createElement("small");
    const screens = (event.screens || []).map(screenLabel).join(" · ");
    const bits = [event.form, screens, event.trade_date || event.accepted_at, money(event.usd)].filter(Boolean);
    meta.textContent = bits.join(" · ");
    card.appendChild(header);
    card.appendChild(reason);
    card.appendChild(meta);
    if (event.sec_url) {
      const link = document.createElement("a");
      link.href = event.sec_url;
      link.textContent = "SEC filing";
      link.rel = "noopener noreferrer";
      card.appendChild(link);
    }
    root.appendChild(card);
  }
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
    fetch("./insights.json").then(r => r.json()),
    fetch("./desk.json").then(r => r.json()),
    fetch("./release.json").then(r => r.json()),
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
