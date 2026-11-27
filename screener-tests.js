// Screener tests page: top live countdown ribbon, split-screen 8-period heatmap matrix +
// 193-week range/spread + 10-stock batch X-ray, and expandable live forward tests & audit register.
// Numbers come from share/screener-tests.json (tools/build_screener_tests.py).
// Values are written as text/DOM nodes only, never as HTML.
(function () {
  "use strict";
  const SCHEMA = "screener-tests-1";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ROLES = [["site", "On the site"], ["challenger", "Challenger"], ["side", "Side test"],
    ["stopped", "Stopped"], ["replaced", "Replaced"]];
  const ACTIVE_ROLES = new Set(["site", "challenger", "side"]);
  const FILTERS = [["active", "Active"], ["all", "All"], ["site", "On the site"], ["challenger", "Challengers"],
    ["side", "Side tests"], ["stopped", "Stopped"], ["replaced", "Replaced"]];
  const LISTS = { shortlist: { rule: "Shortlist", challenger: "60/40 order" }, growth: { rule: "Growth", challenger: "Growth v3" } };
  const SERIES_META = {
    shortlist: { label: "Shortlist", kind: "sl", color: "#1e6547" },
    growth: { label: "Growth", kind: "gr", color: "#2d5f8b" },
    challenger: { label: "60/40 order", kind: "ch", color: "#a86c28" },
    qqq: { label: "QQQ", kind: "qqq", color: "#6b7b72" },
  };
  const BATCHES_SHOWN = 6;
  const NEEDED = 3;
  const TICK = 20;

  const state = {
    data: null, list: "shortlist", hmMode: "excess", subView: "range",
    periodIndex: null, xrayKey: "shortlist", holdingsSort: "return",
    drawerOpen: false, filter: "active", allBatches: false,
  };

  const $ = (id) => document.getElementById(id);
  const utc = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const dayYear = (iso) => { if (!iso) return "—"; const d = utc(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const monYr = (iso) => { if (!iso) return "—"; const d = utc(iso); return `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`; };
  const signed = (value, digits = 1) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    const text = Math.abs(value).toFixed(digits);
    return Number(text) === 0 ? text : `${value > 0 ? "+" : "−"}${text}`;
  };
  const points = (value) => `${signed(value)} pts`;
  const percent = (value) => `${signed(value)}%`;
  const share = (part, whole) => `${part} of ${whole} (${Math.round((100 * part) / whole)}%)`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function svgEl(tag, attributes, text) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function dot(kind) { return el("span", `st-dot ${kind}`); }

  function checkFile(data, release) {
    if (!data || data.schema !== SCHEMA || !Array.isArray(data.register) || !data.lists || !data.backtest) {
      return "The screener tests snapshot is in an unknown format.";
    }
    if (release && (release.run_id !== data.desk_run_id || release.as_of !== data.as_of)) {
      return "Screener tests are awaiting the latest Friday refresh.";
    }
    return "";
  }

  function resultText(result) {
    if (!result) return null;
    if (!result.complete) return `not counted: ${result.reason || "incomplete"}`;
    return `${points(100 * result.excess_qqq)} vs QQQ, ${points(100 * result.excess_spy)} vs SPY`;
  }

  function niceRange(values) {
    const finite = values.filter(Number.isFinite);
    const low = Math.min(0, ...finite), high = Math.max(0, ...finite);
    return [Math.floor(low / TICK) * TICK, Math.ceil(high / TICK) * TICK];
  }

  function statRows(stats, measure) {
    const value = measure === "excess" ? points : percent;
    return [
      measure === "excess" ? ["Ahead of QQQ", share(stats.above_zero, stats.n)] : ["Lost money", share(stats.below_zero, stats.n)],
      [measure === "excess" ? "Typical lead (median)" : "Typical return (median)", value(stats.median)],
      ["1 in 10 was worse than", value(stats.p10)],
      ["Worst", `${value(stats.worst)} · from ${dayYear(stats.worst_start)}`],
      ["Best", `${value(stats.best)} · from ${dayYear(stats.best_start)}`],
    ];
  }

  function registerRows(register, filter) {
    if (filter === "all") return register;
    if (filter === "active") return register.filter((row) => ACTIVE_ROLES.has(row.role));
    return register.filter((row) => row.role === filter);
  }

  function rows(container, pairs) {
    container.replaceChildren(...pairs.map(([label, value]) => {
      const row = el("div");
      row.append(el("dt", "", label), el("dd", "", value));
      return row;
    }));
  }

  function table(headers, body) {
    const t = el("table");
    const head = el("thead"), headRow = el("tr");
    headers.forEach((h) => { const th = el("th", "", h); th.setAttribute("scope", "col"); headRow.appendChild(th); });
    head.appendChild(headRow);
    const tbody = el("tbody");
    body.forEach((cells) => {
      const tr = el("tr");
      cells.forEach((c) => tr.appendChild(c));
      tbody.appendChild(tr);
    });
    t.append(head, tbody);
    return t;
  }
  function cell(text, className) { return el("td", className, text); }

  function periodsOf(backtest) {
    if (Array.isArray(backtest.periods) && backtest.periods.length) return backtest.periods;
    const picked = [];
    let lastExit = null;
    for (let i = 0; i < backtest.starts.length; i += 1) {
      if (lastExit === null || backtest.starts[i] > lastExit) {
        const s = backtest.series;
        const item = {
          start: backtest.starts[i], exit: backtest.exits[i],
          shortlist_excess: s.shortlist_excess[i], shortlist_return: s.shortlist_return[i],
          challenger_excess: s.challenger_excess[i], challenger_return: s.challenger_return[i],
          qqq_return: s.qqq_return[i],
        };
        if (backtest.growth_available && s.growth_excess) {
          item.growth_excess = s.growth_excess[i];
          item.growth_return = s.growth_return[i];
        }
        picked.push(item);
        lastExit = backtest.exits[i];
      }
    }
    return picked;
  }

  function strategyKeys(backtest) {
    return backtest.growth_available ? ["shortlist", "growth", "challenger"] : ["shortlist", "challenger"];
  }

  function exBestStats(holdings, qqqRet) {
    const valid = (holdings || []).filter((h) => Number.isFinite(h.r));
    if (!valid.length) return null;
    const sorted = [...valid].sort((a, b) => b.r - a.r);
    const avg = valid.reduce((sum, x) => sum + x.r, 0) / valid.length;
    const rest = sorted.slice(1);
    const exBest = rest.length ? rest.reduce((sum, x) => sum + x.r, 0) / rest.length : avg;
    const beatQ = Number.isFinite(qqqRet) ? valid.filter((x) => x.r > qqqRet).length : 0;
    return { avg, exBest, top: sorted[0], beatQ, count: valid.length, sorted };
  }

  function heatClass(value, isQqq) {
    if (!Number.isFinite(value)) return "st-hm-c-flat";
    if (isQqq) return value >= 15 ? "st-hm-c-qhi" : (value >= 0 ? "st-hm-c-qmid" : "st-hm-c-qneg");
    if (value >= 25) return "st-hm-c-hi";
    if (value >= 10) return "st-hm-c-pos";
    if (value >= 2) return "st-hm-c-mild";
    if (value >= -2) return "st-hm-c-flat";
    if (value >= -10) return "st-hm-c-soft";
    return "st-hm-c-neg";
  }

  function daysBetween(a, b) {
    if (!a || !b) return 0;
    return Math.max(0, Math.round((utc(b).getTime() - utc(a).getTime()) / 864e5));
  }

  function isResearcherMode() {
    const root = document.documentElement;
    return Boolean(root && root.getAttribute && root.getAttribute("data-site-mode") === "0");
  }

  // ---- Live Countdown Ribbon --------------------------------------------------------------------
  function renderRibbon() {
    const data = state.data;
    const sl = data.lists.shortlist || { batches: [] };
    const gr = data.lists.growth || { batches: [] };
    const oldest = sl.batches[sl.batches.length - 1] || gr.batches[gr.batches.length - 1] || null;
    const activeCount = registerRows(data.register, "active").length;
    const archivedCount = data.register.length - activeCount;

    $("st-rib-summary").textContent = oldest
      ? `${plural(sl.batches.length || gr.batches.length, "weekly batch", "weekly batches")} · Shortlist & Growth`
      : "No weekly batches sealed yet · awaiting next Friday run";

    const fill = $("st-tl-fill");
    const dates = $("st-tl-dates");
    if (oldest) {
      const elapsed = daysBetween(oldest.as_of, data.as_of);
      const total = Math.max(1, daysBetween(oldest.as_of, oldest.exit_6m));
      const pctDone = Math.max(4, Math.min(100, Math.round((elapsed / total) * 100)));
      if (fill.style) fill.style.width = `${pctDone}%`;
      const mkSpan = (prefix, bold) => {
        const s = el("span", "");
        s.append(document.createTextNode(`${prefix} `), el("strong", "", bold));
        return s;
      };
      dates.replaceChildren(
        mkSpan("Sealed", dayYear(oldest.as_of)),
        mkSpan("First 6M verdict", dayYear(oldest.exit_6m)),
        mkSpan("12M", dayYear(oldest.exit_12m)),
      );
    } else {
      if (fill.style) fill.style.width = "0%";
      dates.replaceChildren(el("span", "", "First batch recorded at the next weekly run."));
    }

    const btn = $("st-drawer-toggle");
    btn.setAttribute("aria-expanded", String(state.drawerOpen));
    if (isResearcherMode()) {
      btn.textContent = state.drawerOpen
        ? "Hide live batches & audit ↑"
        : `Live batches & audit (${activeCount} active / ${archivedCount} archived) ▾`;
    } else {
      btn.textContent = state.drawerOpen ? "Hide live batches ↑" : "Live batches ▾";
    }
    $("st-live-drawer").hidden = !state.drawerOpen;
  }

  // ---- Split-Screen Backtest: Heatmap Matrix + 193-Week Visual + Batch X-Ray --------------------
  function renderMatrix(backtest, periods, keys) {
    const st = backtest.stats;
    const t = el("table", "st-hm");
    const thead = el("thead"), htr = el("tr");
    const addTh = (text, cls) => { const th = el("th", cls || "", text); th.setAttribute("scope", "col"); htr.appendChild(th); };
    addTh("Strategy");
    periods.forEach((p, i) => addTh(monYr(p.start), i === state.periodIndex ? "col-active" : ""));
    addTh("Med");
    addTh("Worst");
    thead.appendChild(htr);

    const tbody = el("tbody");
    const rowSpecs = [...keys, "qqq"];
    rowSpecs.forEach((key) => {
      const isQ = key === "qqq";
      const rStat = st[`${key}_return`];
      const tr = el("tr");
      const nameTd = el("td");
      nameTd.append(dot(SERIES_META[key].kind), document.createTextNode(SERIES_META[key].label));
      tr.appendChild(nameTd);

      periods.forEach((p, idx) => {
        const raw = isQ || state.hmMode === "return";
        const val = raw ? p[`${key}_return`] : p[`${key}_excess`];
        const td = el("td");
        const isSel = idx === state.periodIndex && !isQ && key === state.xrayKey;
        const colHi = idx === state.periodIndex && !isSel;
        const btn = el("button", `st-hm-btn ${heatClass(val, isQ)}${isSel ? " cell-sel" : ""}${colHi ? " col-hi" : ""}`,
          raw ? percent(val) : signed(val));
        btn.setAttribute("type", "button");
        btn.setAttribute("aria-pressed", String(isSel));
        btn.setAttribute("title", `${SERIES_META[key].label} · ${dayYear(p.start)} to ${dayYear(p.exit)}: ${percent(p[`${key}_return`])}${isQ ? "" : ` (${points(p[`${key}_excess`])} vs QQQ)`}`);
        btn.addEventListener("click", () => {
          state.periodIndex = idx;
          if (!isQ) state.xrayKey = key;
          renderBacktest();
        });
        td.appendChild(btn);
        tr.appendChild(td);
      });

      tr.appendChild(cell(percent(rStat ? rStat.median : null), "st-hm-sum"));
      const worstCls = `st-hm-sum${rStat && rStat.worst <= -25 ? " st-crash" : ""}`;
      tr.appendChild(cell(percent(rStat ? rStat.worst : null), worstCls));
      tbody.appendChild(tr);
    });

    t.append(thead, tbody);
    $("st-matrix").replaceChildren(t);
  }

  function renderDumbbell(backtest, keys) {
    const st = backtest.stats;
    const rowSpecs = [...keys, "qqq"].map((k) => [k, st[`${k}_return`]]).filter(([, s]) => s);
    const W = 620, H = 195, L = 98, R = 26, T = 18, B = 166;
    const allV = rowSpecs.flatMap(([, s]) => [s.worst, s.best]).filter(Number.isFinite);
    const lo = Math.min(-45, Math.floor((Math.min(...allV) - 5) / 20) * 20);
    const hi = Math.max(105, Math.ceil((Math.max(...allV) + 5) / 20) * 20);
    const x = (v) => L + ((v - lo) / Math.max(hi - lo, 1)) * (W - L - R);
    const rh = (B - T) / Math.max(1, rowSpecs.length);

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": "Worst, 10th percentile, median and best 6-month returns across all Friday starts." });
    for (let t = Math.ceil(lo / 20) * 20; t <= hi; t += 20) {
      const tx = x(t).toFixed(1);
      svg.appendChild(svgEl("line", { x1: tx, x2: tx, y1: T, y2: B, stroke: t === 0 ? "#5d7263" : "#edf1ed", "stroke-width": t === 0 ? 1.3 : 1 }));
      svg.appendChild(svgEl("text", { x: tx, y: H - 6, "text-anchor": "middle" }, `${t > 0 ? "+" : ""}${t}%`));
    }
    rowSpecs.forEach(([key, r], idx) => {
      const m = SERIES_META[key], cy = T + (idx + 0.5) * rh;
      svg.appendChild(svgEl("text", { x: L - 8, y: (cy + 4).toFixed(1), "text-anchor": "end", class: "st-svg-lbl" }, m.label));
      svg.appendChild(svgEl("line", { x1: x(r.worst).toFixed(1), x2: x(r.best).toFixed(1), y1: cy, y2: cy, stroke: "#d4ddd7", "stroke-width": 5, "stroke-linecap": "round" }));
      svg.appendChild(svgEl("line", { x1: x(r.p10).toFixed(1), x2: x(r.median).toFixed(1), y1: cy, y2: cy, stroke: m.color, "stroke-width": 8, "stroke-linecap": "round", opacity: 0.35 }));
      svg.appendChild(svgEl("circle", { cx: x(r.worst).toFixed(1), cy, r: 4.5, fill: "#ad4c3f" }));
      svg.appendChild(svgEl("circle", { cx: x(r.median).toFixed(1), cy, r: 5.5, fill: m.color }));
      svg.appendChild(svgEl("circle", { cx: x(r.best).toFixed(1), cy, r: 4, fill: "#4f8f69" }));
      svg.appendChild(svgEl("text", { x: x(r.worst).toFixed(1), y: (cy - 8).toFixed(1), "text-anchor": "middle", class: "st-svg-neg" }, percent(r.worst)));
      svg.appendChild(svgEl("text", { x: x(r.median).toFixed(1), y: (cy + 16).toFixed(1), "text-anchor": "middle", class: "st-svg-lbl" }, percent(r.median)));
      svg.appendChild(svgEl("text", { x: x(r.best).toFixed(1), y: (cy - 8).toFixed(1), "text-anchor": "middle", class: "st-svg-pos" }, percent(r.best)));
    });
    $("st-chart").replaceChildren(svg);
    $("st-chart-legend").textContent = "Red dot = worst 6M crash · thick band = 10th pct to median · green dot = best 6M.";
  }

  function renderSpreadHistogram(backtest) {
    const key = state.xrayKey;
    const vals = (backtest.series[`${key}_excess`] || []).filter(Number.isFinite);
    const exS = backtest.stats[`${key}_excess`];
    const m = SERIES_META[key];
    const minB = -45, maxB = 65, step = 5;
    const bins = [];
    for (let v = minB; v < maxB; v += step) bins.push({ lo: v, hi: v + step, count: 0 });
    vals.forEach((v) => {
      const idx = Math.max(0, Math.min(bins.length - 1, Math.floor((v - minB) / step)));
      bins[idx].count += 1;
    });
    const maxC = Math.max(...bins.map((b) => b.count), 1);
    const W = 620, H = 195, L = 12, R = 12, T = 26, B = 166, pw = W - L - R, bw = pw / bins.length;
    const xOf = (v) => L + Math.max(0, Math.min(1, (v - minB) / (maxB - minB))) * pw;

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `${m.label} 6-month excess returns versus QQQ across ${vals.length} Friday starts.` });
    bins.forEach((b, i) => {
      const bh = (b.count / maxC) * (B - T), bx = L + i * bw + 1;
      svg.appendChild(svgEl("rect", {
        x: bx.toFixed(1), y: (B - bh).toFixed(1),
        width: Math.max(2, bw - 2).toFixed(1), height: bh.toFixed(1), rx: 2,
        fill: b.lo >= 0 ? "#5c9372" : "#cf968b",
      }));
    });
    svg.appendChild(svgEl("line", { x1: xOf(0).toFixed(1), x2: xOf(0).toFixed(1), y1: T - 6, y2: B + 4, stroke: "#3d5346", "stroke-width": 1.3 }));
    if (exS) {
      const mx = xOf(exS.median).toFixed(1);
      svg.appendChild(svgEl("line", { x1: mx, x2: mx, y1: T - 6, y2: B, stroke: m.color, "stroke-width": 1.8, "stroke-dasharray": "3 2" }));
      svg.appendChild(svgEl("circle", { cx: mx, cy: T - 6, r: 3.5, fill: m.color }));
      svg.appendChild(svgEl("text", { x: mx, y: T - 12, "text-anchor": "middle", class: "st-svg-lbl" },
        `${m.label} med ${points(exS.median)} (${Math.round((100 * exS.above_zero) / exS.n)}% > QQQ)`));
    }
    [-40, -20, 0, 20, 40, 60].forEach((t) => {
      svg.appendChild(svgEl("text", { x: xOf(t).toFixed(1), y: H - 6, "text-anchor": "middle" }, t === 0 ? "QQQ" : `${t > 0 ? "+" : ""}${t}`));
    });
    $("st-chart").replaceChildren(svg);
    $("st-chart-legend").textContent = `${m.label} across all ${vals.length} Friday starts: green = ahead of QQQ, terracotta = behind QQQ (pp).`;
  }

  function renderXray(periods, keys) {
    const card = $("st-xray-card");
    const p = periods[state.periodIndex];
    if (!p) { card.hidden = true; return; }
    card.hidden = false;
    if (!keys.includes(state.xrayKey)) state.xrayKey = keys[0];

    $("st-xray-title").textContent = `Period ${state.periodIndex + 1} · ${monYr(p.start)} → ${monYr(p.exit)}`;
    const qWrap = $("st-xray-qqq");
    qWrap.replaceChildren(document.createTextNode("QQQ "), el("strong", "", percent(p.qqq_return)));

    $("st-xray-tabs").replaceChildren(...keys.map((key) => {
      const btn = el("button", "", SERIES_META[key].label);
      btn.setAttribute("type", "button");
      btn.setAttribute("aria-pressed", String(key === state.xrayKey));
      btn.addEventListener("click", () => { state.xrayKey = key; renderBacktest(); });
      return btn;
    }));
    $("st-xray-sort").replaceChildren(...[["return", "Best → Worst"], ["rank", "Rank #1–10"]].map(([mode, label]) => {
      const btn = el("button", "", label);
      btn.setAttribute("type", "button");
      btn.setAttribute("aria-pressed", String(state.holdingsSort === mode));
      btn.addEventListener("click", () => { state.holdingsSort = mode; renderXray(periods, keys); });
      return btn;
    }));

    const key = state.xrayKey;
    const rawHoldings = p.holdings && p.holdings[key] ? p.holdings[key] : null;
    const stx = exBestStats(rawHoldings, p.qqq_return);
    const kpiBox = $("st-xray-kpis"), barsBox = $("st-xray-bars"), foot = $("st-xray-foot");

    const mkKpi = (label, value, sub, tone) => {
      const box = el("div", "st-mk");
      box.append(el("span", "", label), el("strong", tone || "", value), el("small", "", sub));
      return box;
    };

    if (!stx) {
      kpiBox.replaceChildren(
        mkKpi("Batch 6M", percent(p[`${key}_return`]), points(p[`${key}_excess`]), p[`${key}_return`] < 0 ? "st-neg" : "st-pos"),
        mkKpi("QQQ 6M", percent(p.qqq_return), "same window"),
      );
      barsBox.replaceChildren(el("p", "st-small", "Individual period holdings are not included in this snapshot."));
      foot.textContent = "";
      return;
    }

    kpiBox.replaceChildren(
      mkKpi("Batch 6M", percent(p[`${key}_return`]), points(p[`${key}_excess`]), p[`${key}_return`] < 0 ? "st-neg" : "st-pos"),
      mkKpi(`Ex-#1 (${stx.top.s})`, percent(stx.exBest), "without top stock", stx.exBest < 0 ? "st-neg" : "st-pos"),
      mkKpi("Beat QQQ", `${stx.beatQ} / ${stx.count}`, "stocks above QQQ"),
    );

    const ordered = state.holdingsSort === "rank"
      ? rawHoldings.map((item, idx) => ({ ...item, rank: idx + 1 }))
      : stx.sorted;
    const vals = ordered.map((x) => x.r).filter(Number.isFinite);
    const lo = Math.min(0, Number.isFinite(p.qqq_return) ? p.qqq_return : 0, ...vals);
    const hi = Math.max(0, Number.isFinite(p.qqq_return) ? p.qqq_return : 0, ...vals);
    const span = Math.max(hi - lo, 1);
    const pos = (v) => ((v - lo) / span) * 100;
    const z = pos(0), qx = Number.isFinite(p.qqq_return) ? pos(p.qqq_return) : null;

    barsBox.replaceChildren(...ordered.map((item) => {
      const row = el("div", "st-stk-row");
      const link = el("a", "st-stk-sym", item.s);
      link.setAttribute("href", `./ticker.html?t=${encodeURIComponent(item.s)}`);
      const track = el("div", "st-stk-tr");
      const zero = el("span", "st-stk-z");
      if (zero.style) zero.style.left = `${z}%`;
      track.appendChild(zero);
      if (qx !== null) {
        const qMark = el("span", "st-stk-q");
        if (qMark.style) qMark.style.left = `${qx}%`;
        qMark.setAttribute("title", `QQQ ${percent(p.qqq_return)}`);
        track.appendChild(qMark);
      }
      if (Number.isFinite(item.r)) {
        const end = pos(item.r);
        const bar = el("span", `st-stk-b${item.r < 0 ? " neg" : ""}`);
        if (bar.style) { bar.style.left = `${Math.min(end, z)}%`; bar.style.width = `${Math.abs(end - z)}%`; }
        track.appendChild(bar);
      }
      const val = el("span", `st-stk-v${Number.isFinite(item.r) && item.r < 0 ? " st-neg" : " st-pos"}`, percent(item.r));
      row.append(link, track, val);
      return row;
    }));
    foot.textContent = `Dark vertical tick marks QQQ (${percent(p.qqq_return)}). Click any ticker for its full page.`;
  }

  function renderStats(backtest, keys) {
    const st = backtest.stats;
    const cards = [];
    const push = (title, kind, data, measure) => {
      if (!data) return;
      const card = el("div", "st-stat-card");
      const h = el("h4");
      h.append(dot(kind), document.createTextNode(title));
      const dl = el("dl", "st-rows");
      rows(dl, statRows(data, measure));
      card.append(h, dl);
      cards.push(card);
    };
    const m = state.hmMode === "return" ? "return" : "excess";
    keys.forEach((k) => push(SERIES_META[k].label, SERIES_META[k].kind, st[`${k}_${m}`], m));
    if (m === "return" && st.qqq_return) push("QQQ", "qqq", st.qqq_return, "return");
    $("st-stats").replaceChildren(...cards);
  }

  function renderBacktest() {
    const backtest = state.data.backtest;
    const empty = $("st-backtest-empty");
    if (!backtest.available) {
      $("st-clock-before").textContent = `Backtest withheld: ${backtest.reason}`;
      empty.replaceChildren(el("strong", "", "Backtest withheld"), document.createTextNode(backtest.reason));
      empty.hidden = false;
      $("st-backtest").hidden = true;
      $("st-xray-card").hidden = true;
      return;
    }
    const n = backtest.starts.length;
    const periods = periodsOf(backtest);
    const keys = strategyKeys(backtest);
    if (state.periodIndex === null || state.periodIndex >= periods.length) state.periodIndex = periods.length - 1;
    if (!keys.includes(state.xrayKey)) state.xrayKey = keys[0];

    $("st-clock-before").textContent = `${n} Friday starts (${periods.length} independent 6-month holds), ${dayYear(backtest.starts[0])} to ${dayYear(backtest.starts[n - 1])}. Click any cell to inspect its 10 stocks.`;
    empty.hidden = true;
    $("st-backtest").hidden = false;

    $("st-hm-excess").setAttribute("aria-pressed", String(state.hmMode === "excess"));
    $("st-hm-return").setAttribute("aria-pressed", String(state.hmMode === "return"));
    $("st-sub-range").setAttribute("aria-pressed", String(state.subView === "range"));
    $("st-sub-hist").setAttribute("aria-pressed", String(state.subView === "hist"));
    $("st-sub-title").textContent = `All ${n} Friday starts (${dayYear(backtest.starts[0])} → ${dayYear(backtest.starts[n - 1])})`;

    renderMatrix(backtest, periods, keys);
    if (state.subView === "range") renderDumbbell(backtest, keys);
    else renderSpreadHistogram(backtest);
    renderXray(periods, keys);
    renderStats(backtest, keys);

    $("st-overlap").textContent = `The ${n} windows overlap, so they are not ${n} separate tests: only ${backtest.independent_windows} do not overlap.`;
    $("st-backtest-source").textContent = `Source: comparison report built ${dayYear(backtest.report_built_at)} on data to ${dayYear(backtest.data_as_of)}; `
      + `each window is held ${backtest.horizon_sessions} trading days; ${backtest.basis}.`;
  }

  // ---- Live Forward Tests (Inside Expandable Drawer) --------------------------------------------
  function windowText(w, i, names) {
    const head = `Window ${i + 1} · list of ${dayYear(w.freeze)} · ends ${dayYear(w.exit)}: `;
    if (w.status === "open") return `${head}open`;
    if (w.status === "awaiting_observation") return `${head}ended; waiting for the Saturday observation`;
    if (w.status === "skipped") return `${head}skipped, a price is missing on one side (not counted)`;
    return `${head}${names.rule} ${points(100 * w.default_excess)} vs QQQ; ${names.challenger} ${points(100 * w.challenger_excess)}`
      + ` (${points(100 * w.challenger_without_best)} without its best stock): ${w.challenger_wins ? "challenger wins" : "rule holds"}`;
  }

  function batchCell(row, horizon, due, names) {
    const td = el("td", "st-result");
    const a = resultText(row.rule[horizon]), b = resultText(row.challenger && row.challenger[horizon]);
    if (!a && !b) { td.appendChild(el("span", "st-due", `Due ${dayYear(due)}`)); return td; }
    if (a) td.appendChild(el("span", "st-result-line", `${names.rule}: ${a}`));
    if (b) td.appendChild(el("span", "st-result-line", `${names.challenger}: ${b}`));
    return td;
  }

  function renderBatches(list, names) {
    if (!list.batches.length) {
      $("st-batches").replaceChildren(el("p", "st-small", "No weekly batches yet."));
      $("st-batches-more").hidden = true;
      return;
    }
    const shown = state.allBatches ? list.batches : list.batches.slice(0, BATCHES_SHOWN);
    const body = shown.map((row) => [
      cell(dayYear(row.as_of) + (row.month_end ? " · month-end" : "")),
      cell(dayYear(row.entry)),
      batchCell(row, "6m", row.exit_6m, names),
      batchCell(row, "12m", row.exit_12m, names),
    ]);
    $("st-batches").replaceChildren(table(["List of", "Paper buy", "6-month result", "12-month result"], body));
    const more = $("st-batches-more");
    more.hidden = list.batches.length <= BATCHES_SHOWN;
    more.textContent = state.allBatches ? "Show fewer" : `Show all ${list.batches.length} batches`;
  }

  function pickCard(title, kind, symbols, shared, asOf) {
    const card = el("div", "st-pick");
    const h = el("h4");
    h.append(dot(kind), document.createTextNode(title));
    card.append(h, el("p", "st-small", `Month-end list of ${dayYear(asOf)}, in rank order`));
    if (!symbols) {
      card.appendChild(el("p", "st-small", "Not published: a paper challenger’s names stay off the site."));
      return card;
    }
    const ol = el("ol");
    symbols.forEach((symbol) => ol.appendChild(el("li", shared.has(symbol) ? "both" : "", symbol)));
    card.appendChild(ol);
    return card;
  }

  function renderPicks(list, names) {
    const picks = list.picks;
    if (!picks) {
      $("st-picks").replaceChildren(el("p", "st-small", "No month-end batch yet."));
      $("st-shared").textContent = "";
      return;
    }
    const shared = new Set(picks.challenger ? picks.rule.filter((s) => picks.challenger.includes(s)) : []);
    const primaryKind = state.list === "growth" ? "gr" : "sl";
    $("st-picks").replaceChildren(
      pickCard(`${names.rule} (rule)`, primaryKind, picks.rule, shared, picks.as_of),
      pickCard(`${names.challenger} (challenger)`, "ch", picks.challenger, shared, picks.as_of));
    $("st-shared").textContent = picks.shared === null ? ""
      : `${picks.shared} of 10 picks are the same, so the two can only differ through the other ${10 - picks.shared} stocks each.`
        + (picks.challenger ? " Names in both are outlined." : "");
  }

  function renderList() {
    const data = state.data, key = state.list, list = data.lists[key], names = LISTS[key];
    ["shortlist", "growth"].forEach((k) => {
      $(`st-tab-${k}`).setAttribute("aria-selected", String(k === key));
    });
    $("st-list-title").textContent = `Live forward test: ${names.rule}`;
    $("st-list-what").textContent = list.what;
    const oldest = list.batches[list.batches.length - 1];
    $("st-clock-written").textContent = dayYear(list.registered_at);
    $("st-clock-after").textContent = oldest
      ? `${plural(list.batches.length, "weekly batch", "weekly batches")} since the list of ${dayYear(oldest.as_of)} · First 6-month result due ${dayYear(oldest.exit_6m)}.`
      : "No weekly batches yet; the first batch is recorded at the next weekly run.";

    const sw = list.switch;
    const board = [["Rule on the site", names.rule], ["Challenger, on paper", names.challenger]];
    if (sw) {
      board.push(["Switch rule written down", dayYear(sw.rule_written_at)], ["Windows counted", `${sw.counted} of ${NEEDED}`]);
      if (sw.counted) board.push(["Challenger wins", `${sw.challenger_wins} of ${sw.counted}`]);
      board.push(sw.decision ? ["Decision", sw.decision === "switch" ? `Switch to ${names.challenger}` : `Keep ${names.rule}`]
        : ["Earliest decision", dayYear(sw.earliest_decision)]);
    } else board.push(["Windows", "No paired batches yet"]);
    rows($("st-board"), board);
    $("st-windows").replaceChildren(...(sw ? sw.windows : []).map((w, i) => el("li", "", windowText(w, i, names))));
    const unit = sw && sw.month_end ? "month-end" : "week";
    $("st-switch").textContent = sw ? `Written rule: switch to ${names.challenger} only if it wins at least 2 of the first 3 `
      + `${sw.month_end ? "month-end " : ""}windows, each a pair of batches from the same ${unit}: ahead of ${names.rule} versus QQQ, `
      + `and still ahead after dropping its single best stock. No other reason to switch.` : "";

    $("st-pass-title").textContent = `Does ${names.rule} itself beat QQQ?`;
    const finished = oldest ? oldest.exit_6m.slice(0, 10) <= data.as_of : false;
    $("st-pass").textContent = list.pass_rule ? list.pass_rule : "Pass/fail bar not written yet";
    $("st-pass-card").className = list.pass_rule ? "st-card st-bar" : "st-card st-bar st-bar-unfinished";
    $("st-cards-grid").className = list.pass_rule ? "st-cards" : "st-cards st-cards-single";
    $("st-pass-note").textContent = list.pass_rule ? "" : !oldest
      ? "Write it before the first batch finishes, so it cannot be fitted to the first results."
      : finished
        ? "The first batch has finished; a bar written now could be fitted to its result."
        : `Write it before ${dayYear(oldest.exit_6m)}, when the first batch finishes, so it cannot be fitted to the first results.`;

    renderBatches(list, names);
    renderPicks(list, names);
  }

  // ---- Permanent Audit Register -----------------------------------------------------------------
  function renderRegister() {
    const register = state.data.register;
    const activeCount = registerRows(register, "active").length;
    $("st-register-intro").textContent = `Showing ${state.filter === "active" ? `${activeCount} active` : `all ${register.length}`} tests. `
      + "Retired and stopped experiments stay one click away so winners are never cherry-picked.";
    const filters = FILTERS.map(([key, label]) => {
      const count = registerRows(register, key).length;
      if (!count) return null;
      const button = el("button", "", `${label} · ${count}`);
      button.setAttribute("type", "button");
      button.setAttribute("aria-pressed", String(state.filter === key));
      button.addEventListener("click", () => { state.filter = key; renderRegister(); });
      return button;
    }).filter(Boolean);
    $("st-filters").replaceChildren(...filters);
    const roleLabel = Object.fromEntries(ROLES);
    const body = registerRows(register, state.filter).map((row) => {
      const name = el("td");
      name.append(el("div", "st-name", row.name), el("span", `st-role ${row.role}`, roleLabel[row.role] || row.role));
      const written = dayYear(row.registered_at) + (row.rule_written_at ? `; switch rule ${dayYear(row.rule_written_at)}` : "");
      const span = row.first && row.first !== row.latest ? ` (${dayYear(row.first)} – ${dayYear(row.latest)})` : "";
      const batches = `${row.cohorts} ${row.cadence}${row.role === "replaced" || row.role === "stopped" ? span : ""}`;
      const decision = (row.decision || "") + (row.earliest_decision ? ` Earliest: ${dayYear(row.earliest_decision)}.` : "");
      return [name, cell(row.what), cell(written), cell(batches), cell(dayYear(row.first_result)), cell(decision)];
    });
    $("st-register").replaceChildren(table(["Test", "What it tests", "Written down", "Batches so far", "First result", "Decision"], body));
  }

  function render(data) {
    state.data = data;
    $("st-week").textContent = `Data as of ${dayYear(data.as_of)}`;
    $("aside-week").textContent = dayYear(data.as_of);
    $("st-status").hidden = true;
    $("st-content").hidden = false;
    renderRibbon();
    renderBacktest();
    renderList();
    renderRegister();
  }

  function fail(message) {
    $("st-status").textContent = message;
    $("st-status").hidden = false;
    $("st-content").hidden = true;
    $("aside-week").textContent = "Unavailable";
  }

  function wire() {
    ["shortlist", "growth"].forEach((key) => $(`st-tab-${key}`).addEventListener("click", () => {
      state.list = key; state.allBatches = false; renderList();
    }));
    $("st-hm-excess").addEventListener("click", () => { state.hmMode = "excess"; if (state.data) renderBacktest(); });
    $("st-hm-return").addEventListener("click", () => { state.hmMode = "return"; if (state.data) renderBacktest(); });
    $("st-sub-range").addEventListener("click", () => { state.subView = "range"; if (state.data) renderBacktest(); });
    $("st-sub-hist").addEventListener("click", () => { state.subView = "hist"; if (state.data) renderBacktest(); });
    $("st-drawer-toggle").addEventListener("click", () => { state.drawerOpen = !state.drawerOpen; if (state.data) renderRibbon(); });
    $("st-batches-more").addEventListener("click", () => { state.allBatches = !state.allBatches; renderList(); });
  }

  async function start() {
    try {
      const [response, releaseResponse] = await Promise.all([
        fetch("./screener-tests.json", { cache: "no-cache" }), fetch("./release.json", { cache: "no-cache" })]);
      if (!response.ok) throw new Error("The screener tests snapshot is unavailable.");
      const data = await response.json();
      const release = releaseResponse.ok ? await releaseResponse.json() : null;
      const problem = checkFile(data, release);
      if (problem) throw new Error(problem);
      render(data);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to load the screener tests.");
    }
  }

  const api = { state, render, fail, checkFile, dayYear, signed, resultText, windowText, niceRange, statRows, registerRows, exBestStats };
  globalThis.TLScreenerTests = api;
  wire();
  void start();
})();
