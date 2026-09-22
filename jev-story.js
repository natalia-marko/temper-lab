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

const READ_LABEL = {
  SHORTLIST: "Shortlist",
  REVIEW: "Needs review",
  REJECTED: "Read rejected",
  ERROR: "Read failed",
};

const SETUP_LABEL = {
  asymmetric_growth_catalyst: "Growth catalyst",
  overextended_valuation_risk: "Valuation risk",
  stable_value_drift: "No discrete catalyst",
  unclear: "Unclear",
};

function classifyBatch(names, policy, selected) {
  return names.filter((name) => selected.has(name.ticker) && runPhase1(name, policy).status === "PASSED");
}

function classifyCommand(tickers, maxMddPct) {
  const drawdown = Number(maxMddPct) / 100;
  return `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python tools/run_jev_story_reads.py --tickers ${tickers.join(" ")} --max-drawdown ${drawdown} --live`;
}

function downloadPending(tickers, maxMddPct) {
  const payload = {
    schema: "jev-story-pending-1",
    tickers,
    max_drawdown_pct: Number(maxMddPct),
    created_at: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "jev-story-pending.json";
  link.click();
  URL.revokeObjectURL(url);
}

function savedRead(name) {
  const read = name && name.jev;
  if (!read || typeof read !== "object" || !READ_LABEL[read.status]) return null;
  if (read.answers != null && (typeof read.answers !== "object" || !read.answers.setup)) return null;
  return read;
}

function readBlock(name) {
  const read = savedRead(name);
  if (!read) return `<p class="jev-tape">No Jev answer on file.</p>`;
  const answers = read.answers;
  const metrics = answers
    ? `<dl class="jev-metrics">
        <div><dt>Setup</dt><dd>${escapeText(SETUP_LABEL[answers.setup] || answers.setup)}</dd></div>
        <div><dt>Guidance</dt><dd>${formatRatio(answers.guidanceNoul)}</dd></div>
        <div><dt>Disruption</dt><dd>${formatRatio(answers.disruptionScore)}</dd></div>
        <div><dt>Confidence</dt><dd>${formatRatio(answers.setupConfidence)}</dd></div>
      </dl>`
    : "";
  const reasons = Array.isArray(read.reasons) && read.reasons.length
    ? `<p class="jev-tape">${escapeText(read.reasons.join(". "))}.</p>`
    : "";
  return `<p class="jev-verdict">${escapeText(READ_LABEL[read.status])}. Saved from a Mac run. This page did not call the model.</p>${metrics}${reasons}<p class="jev-tape">${escapeText(read.model || "No model recorded")} · ${escapeText(read.run || "")}</p>`;
}

function matchRank(name, query) {
  const ticker = name.ticker.toLowerCase();
  const company = name.name.toLowerCase();
  if (ticker === query) return 0;
  if (query.length >= 2 && ticker.startsWith(query)) return 1;
  if (query.length >= 3 && company.startsWith(query)) return 2;
  const words = company.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((word) => word === query)) return 3;
  if (query.length >= 5 && words.some((word) => word.startsWith(query))) return 4;
  return -1;
}

function visibleNames(names, policy, query, filter) {
  const q = (query || "").trim().toLowerCase();
  const rows = names.filter((name) => {
    const result = runPhase1(name, policy);
    if (filter === "survivors" && result.status !== "PASSED") return false;
    if (filter === "rejected" && result.status !== "REJECTED") return false;
    if (filter === "unmeasured" && result.status !== "NOT_MEASURED") return false;
    if (filter === "read" && !savedRead(name)) return false;
    if (!q) return true;
    return matchRank(name, q) >= 0;
  });
  if (!q) return rows;
  return rows.sort((a, b) => matchRank(a, q) - matchRank(b, q) || a.ticker.localeCompare(b.ticker));
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
    jev: savedRead(name),
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
    notice: "",
    active: names[0] ? names[0].ticker : "",
  };
  const status = document.querySelector("#jev-status");
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
    document.querySelector("#jev-n-all").textContent = names.length.toLocaleString();
    document.querySelector("#jev-n-rejected").textContent = rejected.toLocaleString();
    document.querySelector("#jev-n-passed").textContent = passed.toLocaleString();
    document.querySelector("#jev-n-gap").textContent = unmeasured.toLocaleString();
    document.querySelector("#jev-shown").textContent = `${rows.length.toLocaleString()} of ${names.length.toLocaleString()}`;
    document.querySelector("#jev-ticked").textContent = state.selected.size ? `${state.selected.size} ticked` : "";
    const typed = state.query.trim().toLowerCase();
    const exact = typed ? names.find((name) => name.ticker.toLowerCase() === typed) : null;
    const exactHidden = exact && !rows.some((name) => name.ticker === exact.ticker);
    status.textContent = exactHidden
      ? `${exact.ticker} is ${runPhase1(exact, policy).status === "REJECTED" ? "rejected" : "not measured"} (${reasonLabel(runPhase1(exact, policy).reason)}). Choose All to see it.`
      : `${rows.length.toLocaleString()} shown. Prices and filings through ${book.as_of}. Not Saturday’s lists.`;
    const chip = document.querySelector("#jev-chip");
    if (chip) chip.textContent = book.as_of;
    const batch = classifyBatch(names, policy, state.selected);
    const classify = document.querySelector("#jev-classify");
    classify.textContent = `Classify selected (${batch.length})`;
    classify.disabled = batch.length === 0;
    const batchLine = document.querySelector("#jev-batch");
    batchLine.textContent = state.notice || (state.selected.size && !batch.length ? "A name that failed a gate is not classified." : "");
    modeButton.textContent = "";
    modeButton.setAttribute("aria-pressed", state.mode === "deselect" ? "true" : "false");
    modeButton.setAttribute("aria-label", state.mode === "select" ? "Tick the names on screen" : "Clear ticks on screen");

    if (!rows.length) {
      const empty = state.filter === "read" && !state.query.trim()
        ? "No saved Jev answer is in this file."
        : "No names match that search.";
      list.innerHTML = `<p class="empty">${empty}</p>`;
    } else {
      list.innerHTML = `<table class="insights-table jev-table"><thead><tr>
        <th></th><th>Ticker</th><th>MDD</th><th>Beta</th><th>D/E</th><th>OM</th><th>Status</th><th>Read</th>
      </tr></thead><tbody>${rows.map((name) => {
        const result = runPhase1(name, policy);
        const on = state.selected.has(name.ticker);
        const label = result.status === "PASSED" ? "Passed math" : result.status === "NOT_MEASURED" ? "Not measured" : reasonLabel(result.reason);
        const tone = result.status === "PASSED" ? "pass" : result.status === "REJECTED" ? "fail" : "gap";
        return `<tr data-ticker="${escapeText(name.ticker)}" class="${state.active === name.ticker ? "on" : ""} ${result.status === "REJECTED" ? "rejected" : ""}">
          <td><button type="button" data-tick="${escapeText(name.ticker)}" aria-label="${on ? "Deselect" : "Select"} ${escapeText(name.ticker)}">${on ? "✓" : ""}</button></td>
          <td><span class="ticker">${escapeText(name.ticker)}</span><span class="meta">${escapeText(name.name)}</span></td>
          <td>${formatPct(name.ttmMaxDrawdownPct)}</td>
          <td>${formatRatio(name.betaVsSpy)}</td>
          <td>${formatRatio(name.debtToEquity)}</td>
          <td>${formatMargin(name.operatingMargin)}</td>
          <td><span class="jev-chip ${tone}">${label}</span></td>
          <td>${savedRead(name) ? `<span class="jev-chip ${savedRead(name).status === "SHORTLIST" ? "pass" : savedRead(name).status === "ERROR" ? "gap" : "fail"}">${escapeText(READ_LABEL[savedRead(name).status])}</span>` : `<span class="jev-tape">n/a</span>`}</td>
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
    const tone = result.status === "PASSED" ? "pass" : result.status === "REJECTED" ? "fail" : "gap";
    const statusLabel = result.status === "PASSED" ? "Passed math" : result.status === "NOT_MEASURED" ? "Not measured" : reasonLabel(result.reason);
    detail.hidden = false;
    detail.innerHTML = `<div class="jev-inspector-top"><div>
        <p class="jev-kicker">${escapeText(active.ticker)}</p>
        <h2>${escapeText(active.name)}</h2>
        <p class="jev-industry">${escapeText(active.industry || "Industry unavailable")}</p>
      </div><span class="jev-chip ${tone}">${statusLabel}</span></div>
      <p class="jev-verdict">${verdict}</p>
      <dl class="jev-metrics">
        <div><dt>MDD</dt><dd>${formatPct(active.ttmMaxDrawdownPct)}</dd></div>
        <div><dt>Beta</dt><dd>${formatRatio(active.betaVsSpy)}</dd></div>
        <div><dt>D/E</dt><dd>${formatRatio(active.debtToEquity)}</dd></div>
        <div><dt>OM</dt><dd>${formatMargin(active.operatingMargin)}</dd></div>
      </dl>
      <p class="jev-kicker">Catalyst</p>
      ${catalyst}
      <p class="jev-kicker">Jev read</p>
      ${readBlock(active)}
      <details><summary>Facts</summary><pre>${escapeText(JSON.stringify(factsOnly(active, book.as_of), null, 2))}</pre></details>`;
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
  document.querySelector("#jev-clear").addEventListener("click", () => {
    state.notice = "";
    paint();
  });
  document.querySelector("#jev-classify").addEventListener("click", () => {
    const policy = readPolicy(document);
    const batch = classifyBatch(names, policy, state.selected);
    if (!batch.length) return;
    const answered = batch.filter((name) => savedRead(name));
    const ready = batch.filter((name) => name.catalyst && name.catalyst.source && name.catalyst.source.startsWith("https://"));
    const noCatalyst = batch.filter((name) => !ready.includes(name) && !savedRead(name));
    if (answered.length && answered.length === batch.length) {
      state.filter = "read";
      state.query = "";
      document.querySelector("#jev-query").value = "";
      document.querySelectorAll("[data-filter]").forEach((item) => {
        item.classList.toggle("on", item.getAttribute("data-filter") === "read");
      });
      state.active = answered[0].ticker;
      state.notice = `${answered.map((name) => name.ticker).join(", ")} already ${answered.length === 1 ? "has a saved answer" : "have saved answers"}.`;
      paint();
      return;
    }
    if (!ready.length) {
      state.active = batch[0].ticker;
      state.notice = noCatalyst.length
        ? `${noCatalyst.map((name) => name.ticker).join(", ")} need a sourced catalyst before a Mac run.`
        : `${batch.map((name) => name.ticker).join(", ")} passed math. No Jev answer is on file.`;
      paint();
      return;
    }
    const tickers = ready.map((name) => name.ticker);
    const command = classifyCommand(tickers, policy.maxMddPct);
    downloadPending(tickers, policy.maxMddPct);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(command).catch(() => {});
    }
    state.active = ready[0].ticker;
    state.notice = `Mac next: ${command}${noCatalyst.length ? ` Skipped without catalyst: ${noCatalyst.map((name) => name.ticker).join(", ")}.` : ""}`;
    paint();
  });
  modeButton.addEventListener("click", () => {
    state.notice = "";
    const policy = readPolicy(document);
    const rows = visibleNames(names, policy, state.query, state.filter);
    if (state.mode === "select") {
      rows.forEach((name) => state.selected.add(name.ticker));
      state.mode = "deselect";
    } else {
      rows.forEach((name) => state.selected.delete(name.ticker));
      state.mode = "select";
    }
    paint();
  });
  list.addEventListener("click", (event) => {
    const tick = event.target.closest("[data-tick]");
    if (tick) {
      const ticker = tick.getAttribute("data-tick");
      state.notice = "";
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
