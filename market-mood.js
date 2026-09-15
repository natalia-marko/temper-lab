const $ = (id) => document.getElementById(id);

function day(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function percent(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function levelPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function vixPoints(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} pts`;
}

function appendText(parent, tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}

function renderIndices(indices) {
  const target = $("index-rows");
  target.replaceChildren();
  for (const [symbol, label] of [["SPY", "S&P 500"], ["QQQ", "Nasdaq-100"]]) {
    const snapshot = indices?.[symbol];
    const row = appendText(target, "div", "", "index-row");
    const name = appendText(row, "div", "", "index-name");
    appendText(name, "strong", symbol);
    appendText(name, "span", label);
    const metrics = appendText(row, "div", "", "index-metrics");
    appendText(metrics, "strong", percent(snapshot?.return_63), snapshot?.return_63 < 0 ? "negative" : "positive");
    appendText(metrics, "small", `63 sessions · ${percent(snapshot?.return_252)} over 252`);
  }
}

function renderExtremes(id, rows) {
  const target = $(id);
  target.replaceChildren();
  if (!rows?.length) {
    const tr = appendText(target, "tr", "");
    appendText(tr, "td", "No complete price histories for this Friday.", "empty").colSpan = 3;
    return;
  }
  for (const [index, item] of rows.entries()) {
    const tr = appendText(target, "tr", "");
    const company = appendText(tr, "td", "");
    const companyLine = appendText(company, "div", "", "extreme-company");
    appendText(companyLine, "span", String(index + 1).padStart(2, "0"), "extreme-number");
    const identity = appendText(companyLine, "span", "", "extreme-identity");
    appendText(identity, "strong", item.symbol);
    appendText(identity, "small", item.name || item.symbol);
    appendText(tr, "td", percent(item.momentum_63), item.momentum_63 < 0 ? "extreme-return negative" : "extreme-return positive");
    appendText(tr, "td", Number.isInteger(item.hot_tape_rank) ? `#${item.hot_tape_rank}` : "—", "extreme-rank");
  }
}

function renderScreenLeaders(id, rows) {
  const target = $(id);
  target.replaceChildren();
  if (!rows?.length) {
    const tr = appendText(target, "tr", "");
    appendText(tr, "td", "No screen leaders recorded for this Friday.", "empty").colSpan = 3;
    return;
  }
  for (const item of rows) {
    const tr = appendText(target, "tr", "");
    const company = appendText(tr, "td", "");
    const identity = appendText(company, "div", "", "extreme-identity");
    appendText(identity, "strong", item.symbol);
    appendText(identity, "small", item.name || item.symbol);
    appendText(tr, "td", levelPercent(item.metric), "extreme-return");
    appendText(tr, "td", Number.isInteger(item.rank) ? `#${item.rank}` : "—", "extreme-rank");
  }
}

function render(mood) {
  $("week-chip").textContent = `Data as of ${day(mood.as_of)}`;
  $("aside-week").textContent = day(mood.as_of);
  $("coverage-date").textContent = `${mood.price_history_count.toLocaleString()} complete price histories · ${mood.universe_count.toLocaleString()} liquid names`;
  $("vix-close").textContent = Number.isFinite(mood.vix?.close) ? mood.vix.close.toFixed(2) : "—";
  $("vix-week").textContent = mood.vix
    ? `${vixPoints(mood.vix.change_points_week)} since the prior Friday close`
    : "The matching Cboe Friday close is unavailable in this snapshot.";
  const share = mood.breadth?.up_63;
  $("breadth-up").textContent = Number.isFinite(share) ? `${(share * 100).toFixed(0)}%` : "—";
  $("breadth-fill").style.width = Number.isFinite(share) ? `${Math.max(0, Math.min(100, share * 100))}%` : "0%";
  $("breadth-copy").textContent = `${mood.breadth?.n_63 ?? 0} complete names · median 63-session return ${percent(mood.breadth?.median_63)}. Breadth is a snapshot of this liquid universe, not all stocks.`;
  renderIndices(mood.indices);
  renderExtremes("winners-body", mood.winners);
  renderScreenLeaders("growth-body", mood.growth_leaders);
  renderScreenLeaders("cheap-body", mood.cheap_leaders);
  $("mood-status").hidden = true;
  $("mood-content").hidden = false;
}

async function loadMood() {
  try {
    const [moodResponse, releaseResponse] = await Promise.all([
      fetch("./market-mood.json", { cache: "no-store" }),
      fetch("./release.json", { cache: "no-store" }),
    ]);
    if (!moodResponse.ok) throw new Error("The market-mood snapshot is unavailable.");
    const mood = await moodResponse.json();
    if (mood.schema !== "market-mood-1" || !mood.as_of || !mood.run_id) {
      throw new Error("The market-mood snapshot is incomplete.");
    }
    if (releaseResponse.ok) {
      const release = await releaseResponse.json();
      if (release.run_id !== mood.run_id || release.as_of !== mood.as_of) {
        throw new Error("Market mood is awaiting the latest Friday refresh.");
      }
    }
    render(mood);
  } catch (error) {
    $("mood-status").textContent = error instanceof Error ? error.message : "Unable to load market mood.";
  }
}

void loadMood();
