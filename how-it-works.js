"use strict";
// Live snapshot & data status for How Temper Lab works (researcher mode, data-site-mode="0").
// In public mode (mode=1), does nothing and makes zero network requests.
// Writes text only (textContent); never parses data as HTML.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FILES = {
  release: "./release.json",
  listCheck: "./list-check.json",
  shortInterest: "./short-interest.json",
  earnings: "./earnings-calendar.json",
  tickerShared: "./ticker-shared.json",
  screenerTests: "./screener-tests.json",
};

function isResearcherMode() {
  const root = typeof document !== "undefined" && document.documentElement;
  const body = typeof document !== "undefined" && document.body;
  return (root && root.dataset && root.dataset.siteMode === "0")
    || (body && body.dataset && body.dataset.siteMode === "0");
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "—";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function fmtShortDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "—";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

function fmtStamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtNum(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US") : "—";
}

function insightsCutoff(runId) {
  const m = /^(\d{4}-\d{2}-\d{2})-/.exec(String(runId || ""));
  return m ? m[1] : null;
}

function summarizeLive(payloads) {
  const rel = payloads.release || null;
  const lc = payloads.listCheck || null;
  const si = payloads.shortInterest || null;
  const earn = payloads.earnings || null;
  const ts = payloads.tickerShared || null;
  const st = payloads.screenerTests || null;

  const freezeRun = rel && rel.run_id ? rel.run_id : null;
  const freezeAsOf = rel && rel.as_of ? rel.as_of : null;
  const hv = (rel && rel.historical_validation) || {};
  const groups = (lc && lc.groups) || {};
  const funds = (ts && ts.data && ts.data.funds) || null;
  const insightsUntil = si ? insightsCutoff(si.run_id) : null;

  const warnings = [];
  for (const [label, key] of [
    ["release.json", "release"], ["list-check.json", "listCheck"],
    ["short-interest.json", "shortInterest"], ["earnings-calendar.json", "earnings"],
    ["ticker-shared.json", "tickerShared"], ["screener-tests.json", "screenerTests"],
  ]) {
    if (!payloads[key]) warnings.push(`${label} could not be loaded`);
  }
  if (freezeRun) {
    if (lc && lc.desk_run_id && lc.desk_run_id !== freezeRun) {
      warnings.push(`list-check.json points to ${lc.desk_run_id} (release is ${freezeRun})`);
    }
    if (st && st.desk_run_id && st.desk_run_id !== freezeRun) {
      warnings.push(`screener-tests.json points to ${st.desk_run_id} (release is ${freezeRun})`);
    }
    if (ts && ts.data) {
      for (const name of ["volume", "quiet", "fscore", "implies"]) {
        const block = ts.data[name];
        if (block && block.desk_run_id && block.desk_run_id !== freezeRun) {
          warnings.push(`ticker-shared (${name}) points to ${block.desk_run_id} (release is ${freezeRun})`);
        }
      }
    }
  }
  if (rel && rel.current_checks && rel.current_checks !== "passed") {
    warnings.push(`current checks: ${rel.current_checks}`);
  }
  if (hv.status && hv.status !== "passed") {
    warnings.push(`historical validation: ${hv.status}`);
  }

  const cards = [
    {
      label: "Weekly freeze",
      value: freezeAsOf ? fmtDay(freezeAsOf) : "—",
      detail: rel
        ? `${hv.formula_version || "freeze"} · checks ${rel.current_checks || "—"} · hist ${hv.status || "—"}`
        : "release.json unavailable",
      ok: Boolean(rel && rel.current_checks === "passed" && hv.status === "passed"),
    },
    {
      label: "Universe & lists",
      value: groups.eligible ? `${fmtNum(groups.eligible.count)} eligible` : "—",
      detail: lc
        ? `Shortlist ${fmtNum(groups.shortlist && groups.shortlist.count)} · Growth ${fmtNum(groups.growth && groups.growth.count)} · Cheap ${fmtNum(groups.undervalued && groups.undervalued.count)}`
        : "list-check.json unavailable",
      ok: Boolean(lc),
    },
    {
      label: "Insights & FINRA",
      value: insightsUntil ? `To ${fmtShortDay(insightsUntil)}` : "—",
      detail: si
        ? `FINRA ${fmtDay(si.date)} · ${fmtNum(si.rows ? Object.keys(si.rows).length : 0)} symbols`
        : "short-interest.json unavailable",
      ok: Boolean(si),
    },
    {
      label: "Next results",
      value: earn && earn.coverage ? `${fmtNum(earn.coverage.reporting)} reporting` : "—",
      detail: earn && earn.window
        ? `${fmtShortDay(earn.window.from)}–${fmtShortDay(earn.window.to)} (${earn.coverage.differ || 0} dates differ)`
        : "earnings-calendar.json unavailable",
      ok: Boolean(earn),
    },
  ];

  const rows = [
    {
      source: "Weekly freeze (Research, Market mood)",
      dataDate: freezeAsOf ? `${fmtDay(freezeAsOf)} (${freezeRun})` : "—",
      updated: rel ? fmtStamp(rel.published_at) : "—",
      detail: rel
        ? `Formula ${hv.formula_version || "—"} · checks ${rel.current_checks || "—"} · historical validation ${hv.status || "—"} (${fmtStamp(hv.checked_at)})`
        : "Unavailable",
      ok: Boolean(rel && rel.current_checks === "passed" && hv.status === "passed"),
    },
    {
      source: "Lists & month-end trend",
      dataDate: lc
        ? `Trend ${fmtDay(lc.trend && lc.trend.signal_date)} · decision ${fmtDay(lc.decision_date)}`
        : "—",
      updated: lc ? fmtStamp(lc.built_at) : "—",
      detail: lc
        ? `${fmtNum(lc.union && lc.union.count)} unique on lists (${fmtNum(groups.strength && groups.strength.count)} Hot tape ${groups.strength && groups.strength.version || ""}, ${fmtNum(groups.growth && groups.growth.count)} Growth ${groups.growth && groups.growth.version || ""}, ${fmtNum(groups.undervalued && groups.undervalued.count)} Cheap ${groups.undervalued && groups.undervalued.version || ""})`
        : "Unavailable",
      ok: Boolean(lc && (!freezeRun || lc.desk_run_id === freezeRun)),
    },
    {
      source: "Insights & FINRA short interest",
      dataDate: si
        ? `SEC filings through ${fmtDay(insightsUntil)} · FINRA ${fmtDay(si.date)}`
        : "—",
      updated: si ? fmtStamp(si.built_at) : "—",
      detail: si
        ? `Run ${si.run_id || "—"} · ${fmtNum(si.rows ? Object.keys(si.rows).length : 0)} symbols with FINRA short interest`
        : "Unavailable",
      ok: Boolean(si),
    },
    {
      source: "Earnings calendar",
      dataDate: earn && earn.window
        ? `${fmtDay(earn.window.from)} – ${fmtDay(earn.window.to)}`
        : "—",
      updated: earn ? fmtStamp(earn.built_at) : "—",
      detail: earn && earn.coverage
        ? `${fmtNum(earn.coverage.reporting)} of ${fmtNum(earn.coverage.eligible)} eligible stocks (${earn.coverage.calendar} Yahoo calendar, ${earn.coverage.company_pages} company pages, ${earn.coverage.differ} differ)`
        : "Unavailable",
      ok: Boolean(earn),
    },
    {
      source: "Ticker shards & 13F holdings",
      dataDate: funds
        ? `13F ${fmtDay(funds.quarter)} vs ${fmtDay(funds.previous)} (filings to ${fmtDay(funds.filings_through)})`
        : "—",
      updated: ts ? fmtStamp(ts.built_at) : "—",
      detail: ts && funds
        ? `${fmtNum(ts.tickers)} ticker shards · ${fmtNum(funds.managers && funds.managers.continuing)} continuing 13F managers · ${fmtNum(funds.coverage && funds.coverage.research_linked)}/${fmtNum(funds.coverage && funds.coverage.research_stocks)} research stocks linked`
        : "Unavailable",
      ok: Boolean(ts && funds),
    },
    {
      source: "Screener tests",
      dataDate: st ? `Freeze ${fmtDay(st.as_of)}` : "—",
      updated: st ? fmtStamp(st.built_at) : "—",
      detail: st
        ? `${fmtNum(st.register)} registered rules · active: ${st.lists && st.lists.shortlist ? st.lists.shortlist.rule : "—"}, ${st.lists && st.lists.growth ? st.lists.growth.rule : "—"}`
        : "Unavailable",
      ok: Boolean(st && (!freezeRun || st.desk_run_id === freezeRun)),
    },
  ];

  return { cards, rows, warnings };
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function renderLive(summary, checkedAt) {
  const status = document.getElementById("how-live-status");
  const warnBox = document.getElementById("how-live-warn");
  const cardsBox = document.getElementById("how-live-cards");
  const tbody = document.getElementById("how-live-rows");
  if (!cardsBox || !tbody) return;

  if (status) {
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${pad(checkedAt.getHours())}:${pad(checkedAt.getMinutes())}:${pad(checkedAt.getSeconds())}`;
    status.textContent = summary.warnings.length
      ? `Checked ${stamp} · ${summary.warnings.length} warning${summary.warnings.length === 1 ? "" : "s"}`
      : `Checked ${stamp} · all snapshot files aligned`;
  }

  if (warnBox) {
    warnBox.hidden = !summary.warnings.length;
    warnBox.textContent = summary.warnings.length
      ? `Attention: ${summary.warnings.join(" · ")}.`
      : "";
  }

  cardsBox.replaceChildren(...summary.cards.map((card) => {
    const box = el("div", `how-live-card${card.ok ? "" : " warn"}`);
    box.append(
      el("span", "how-live-label", card.label),
      el("strong", "how-live-value", card.value),
      el("span", "how-live-detail", card.detail),
    );
    return box;
  }));

  tbody.replaceChildren(...summary.rows.map((row) => {
    const tr = el("tr", row.ok ? "" : "how-live-row-warn");
    const th = el("th", "", row.source);
    th.scope = "row";
    tr.append(
      th,
      el("td", "num", row.dataDate),
      el("td", "num", row.updated),
      el("td", "", row.detail),
    );
    return tr;
  }));
}

let inFlight = false;
async function loadLive() {
  if (!isResearcherMode() || inFlight) return;
  inFlight = true;
  const button = document.getElementById("how-live-refresh");
  if (button) button.disabled = true;
  try {
    const entries = await Promise.all(
      Object.entries(FILES).map(async ([key, url]) => [key, await fetchJson(url)]),
    );
    const payloads = Object.fromEntries(entries);
    renderLive(summarizeLive(payloads), new Date());
  } finally {
    inFlight = false;
    if (button) button.disabled = false;
  }
}

function start() {
  if (!isResearcherMode()) return;
  const button = document.getElementById("how-live-refresh");
  if (button) button.addEventListener("click", () => { loadLive(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadLive();
  });
  loadLive();
}
start();
