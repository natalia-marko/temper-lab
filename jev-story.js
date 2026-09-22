const DEFAULT_POLICY = {
  maxMddPct: 28,
  maxBeta: 1.8,
  maxDebtToEquity: 1.5,
  requirePositiveMargin: true,
};

const REASON_LABEL = {
  max_drawdown: "Max drawdown",
  beta: "Beta vs SPY",
  margin: "Operating margin",
  leverage: "Debt / equity",
  passed: "Passed math",
  not_measured: "Not measured",
};

function known(value) {
  return value != null && Number.isFinite(Number(value));
}

function runPhase1(name, policy) {
  const breaches = [];
  if (known(name.ttmMaxDrawdownPct) && name.ttmMaxDrawdownPct >= policy.maxMddPct) breaches.push("max_drawdown");
  if (known(name.betaVsSpy) && Math.abs(name.betaVsSpy) > policy.maxBeta) breaches.push("beta");
  if (policy.requirePositiveMargin && known(name.operatingMargin) && name.operatingMargin <= 0) breaches.push("margin");
  if (name.nonpositiveBookEquity || (known(name.debtToEquity) && name.debtToEquity > policy.maxDebtToEquity)) breaches.push("leverage");
  if (breaches.length) return { ticker: name.ticker, status: "REJECTED", reason: breaches[0] };
  const gaps = [];
  if (!known(name.ttmMaxDrawdownPct)) gaps.push("max_drawdown");
  if (!known(name.betaVsSpy)) gaps.push("beta");
  if (!known(name.debtToEquity) && !name.nonpositiveBookEquity) gaps.push("leverage");
  if (policy.requirePositiveMargin && !known(name.operatingMargin)) gaps.push("margin");
  if (gaps.length) return { ticker: name.ticker, status: "NOT_MEASURED", reason: gaps[0] };
  return { ticker: name.ticker, status: "PASSED", reason: "passed" };
}

function reasonLabel(reason) {
  return REASON_LABEL[reason] || reason;
}

function visibleNames(names, policy, query, filter) {
  const q = (query || "").trim().toLowerCase();
  return names.filter((name) => {
    const result = runPhase1(name, policy);
    if (filter === "survivors" && result.status !== "PASSED") return false;
    if (filter === "rejected" && result.status !== "REJECTED") return false;
    if (filter === "unmeasured" && result.status !== "NOT_MEASURED") return false;
    if (!q) return true;
    return [name.ticker, name.name, name.industry].join(" ").toLowerCase().includes(q);
  });
}

function formatPct(value) {
  if (!known(value)) return "n/a";
  return `${Number(value).toFixed(1)}%`;
}

function formatRatio(value) {
  if (!known(value)) return "n/a";
  return Number(value).toFixed(2);
}

function formatMargin(value) {
  if (!known(value)) return "n/a";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function factsOnly(name, asOf) {
  return {
    ticker: name.ticker,
    industry: name.industry,
    asOf,
    beta_benchmark: "SPY",
    ttm_max_drawdown_pct: name.ttmMaxDrawdownPct,
    beta_vs_spy: name.betaVsSpy,
    interest_bearing_debt_to_book_equity: name.debtToEquity,
    operating_margin: name.operatingMargin,
    catalyst: name.catalyst || null,
  };
}

function readPolicy(root) {
  const num = (id) => Number(root.querySelector(id).value);
  return {
    maxMddPct: num("#jev-mdd"),
    maxBeta: num("#jev-beta"),
    maxDebtToEquity: num("#jev-de"),
    requirePositiveMargin: root.querySelector("#jev-margin").checked,
  };
}

function startJev() {
  const root = document;
  const status = root.querySelector("#jev-status");
  fetch("./jev-story.json")
    .then((response) => {
      if (!response.ok) throw new Error("book missing");
      return response.json();
    })
    .then((book) => {
      if (book.schema !== "jev-story-book-1" || book.kind !== "measured" || !Array.isArray(book.names) || book.names.length < 1000) {
        throw new Error("book schema");
      }
      renderBook(book);
    })
    .catch(() => {
      status.textContent = "The US book did not load.";
    });
}

function renderBook(book) {
  const names = book.names;
  const state = {
    query: "",
    filter: "all",
    mode: "select",
    selected: new Set(),
    active: names[0] ? names[0].ticker : "",
  };
  const status = document.querySelector("#jev-status");
  const counts = document.querySelector("#jev-counts");
  const list = document.querySelector("#jev-list");
  const detail = document.querySelector("#jev-detail");
  const modeButton = document.querySelector("#jev-mode");

  function paint() {
    const policy = readPolicy(document);
    const scored = names.map((name) => ({ name, result: runPhase1(name, policy) }));
    const passed = scored.filter((row) => row.result.status === "PASSED").length;
    const rejected = scored.filter((row) => row.result.status === "REJECTED").length;
    const unmeasured = scored.filter((row) => row.result.status === "NOT_MEASURED").length;
    const rows = visibleNames(names, policy, state.query, state.filter);
    counts.textContent = `${names.length} names · ${rejected} rejected · ${passed} passed math · ${unmeasured} not measured`;
    status.textContent = `${rows.length} shown. Prices and filings through ${book.as_of}. Not Saturday’s lists.`;
    const chip = document.querySelector("#jev-chip");
    if (chip) chip.textContent = book.as_of;
    modeButton.textContent = state.mode === "select" ? "Select" : "Deselect";
    modeButton.setAttribute("aria-pressed", state.mode === "deselect" ? "true" : "false");

    if (!rows.length) {
      list.innerHTML = `<p class="empty">No names match that search.</p>`;
    } else {
      list.innerHTML = `<table class="insights-table jev-table"><thead><tr>
        <th></th><th>Ticker</th><th>MDD</th><th>Beta</th><th>D/E</th><th>OM</th><th>Status</th>
      </tr></thead><tbody>${rows.map((name) => {
        const result = runPhase1(name, policy);
        const on = state.selected.has(name.ticker);
        const can = result.status === "PASSED";
        const label = result.status === "PASSED" ? "Passed math" : result.status === "NOT_MEASURED" ? "Not measured" : reasonLabel(result.reason);
        const tone = result.status === "PASSED" ? "pass" : result.status === "REJECTED" ? "fail" : "gap";
        return `<tr data-ticker="${escapeText(name.ticker)}" class="${state.active === name.ticker ? "on" : ""} ${result.status === "REJECTED" ? "rejected" : ""}">
          <td><button type="button" data-tick="${escapeText(name.ticker)}" ${can ? "" : "disabled"} aria-label="${on ? "Deselect" : "Select"} ${escapeText(name.ticker)}">${on ? "✓" : ""}</button></td>
          <td><span class="ticker">${escapeText(name.ticker)}</span><span class="meta">${escapeText(name.name)}</span></td>
          <td>${formatPct(name.ttmMaxDrawdownPct)}</td>
          <td>${formatRatio(name.betaVsSpy)}</td>
          <td>${formatRatio(name.debtToEquity)}</td>
          <td>${formatMargin(name.operatingMargin)}</td>
          <td class="${tone}">${label}</td>
        </tr>`;
      }).join("")}</tbody></table>`;
    }

    const active = rows.find((name) => name.ticker === state.active) || rows[0];
    if (!active) {
      detail.hidden = true;
      return;
    }
    state.active = active.ticker;
    const result = runPhase1(active, policy);
    const verdict = result.status === "PASSED"
      ? "Passed math. The model is not called from this page."
      : result.status === "NOT_MEASURED"
        ? `Missing ${reasonLabel(result.reason)}. A blank is not a pass.`
        : `Blocked by ${reasonLabel(result.reason)}. The classifier is not called.`;
    const catalyst = active.catalyst && active.catalyst.source
      ? `<p class="jev-catalyst">${escapeText(active.catalyst.text)}</p><p class="jev-tape"><a href="${escapeText(active.catalyst.source)}">${escapeText(active.catalyst.published_at)}</a></p>`
      : `<p class="jev-tape">No catalyst on file.</p>`;
    detail.hidden = false;
    detail.innerHTML = `<p class="jev-kicker">${escapeText(active.ticker)} · ${escapeText(active.name)}</p>
      <p>${verdict}</p>
      ${catalyst}
      <pre>${escapeText(JSON.stringify(factsOnly(active, book.as_of), null, 2))}</pre>`;
  }

  document.querySelector("#jev-query").addEventListener("input", (event) => {
    state.query = event.target.value;
    paint();
  });
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.getAttribute("data-filter");
      document.querySelectorAll("[data-filter]").forEach((item) => {
        item.classList.toggle("on", item === button);
      });
      paint();
    });
  });
  ["#jev-mdd", "#jev-beta", "#jev-de"].forEach((id) => {
    document.querySelector(id).addEventListener("input", paint);
  });
  document.querySelector("#jev-margin").addEventListener("change", paint);
  modeButton.addEventListener("click", () => {
    const policy = readPolicy(document);
    const rows = visibleNames(names, policy, state.query, state.filter);
    const survivors = rows.filter((name) => runPhase1(name, policy).status === "PASSED");
    if (state.mode === "select") {
      survivors.forEach((name) => state.selected.add(name.ticker));
      state.mode = "deselect";
    } else {
      survivors.forEach((name) => state.selected.delete(name.ticker));
      state.mode = "select";
    }
    paint();
  });
  list.addEventListener("click", (event) => {
    const tick = event.target.closest("[data-tick]");
    if (tick && !tick.disabled) {
      const ticker = tick.getAttribute("data-tick");
      if (state.selected.has(ticker)) state.selected.delete(ticker);
      else state.selected.add(ticker);
      state.active = ticker;
      paint();
      return;
    }
    const row = event.target.closest("tr[data-ticker]");
    if (row) {
      state.active = row.getAttribute("data-ticker");
      paint();
    }
  });
  paint();
}

startJev();
