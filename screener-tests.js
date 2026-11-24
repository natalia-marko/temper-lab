// Screener tests page: 1. Unified backtest comparison (8 independent periods, crash & range,
// all 193 weeks), 2. Live forward tests (Shortlist / Growth batches & challengers), and
// 3. Test register — from share/screener-tests.json (tools/build_screener_tests.py, Saturday).
// Numbers come from the builder; this file only formats them and draws the charts.
// Values are written as text, never as HTML.
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
    growth: { label: "Growth", kind: "gr", color: "#2663a8" },
    challenger: { label: "60/40 order", kind: "ch", color: "#c05a12" },
    qqq: { label: "QQQ", kind: "qqq", color: "#6b7280" },
  };
  const BATCHES_SHOWN = 6;
  const NEEDED = 3;
  const BOX = { width: 1000, height: 310, left: 54, right: 988, top: 22, bottom: 268 };
  const TICK = 20;

  const state = {
    data: null, list: "shortlist", view: "periods", measure: "excess",
    index: null, periodIndex: null, filter: "active", allBatches: false,
    show: { shortlist: true, growth: true, challenger: true, monthend: false },
  };
  let cursor = null;

  const $ = (id) => document.getElementById(id);
  const utc = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const dayYear = (iso) => { if (!iso) return "—"; const d = utc(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const monthYr = (iso) => { if (!iso) return "—"; const d = utc(iso); return `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`; };
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
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function svgEl(tag, attributes, text) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function dot(kind) { return el("span", `st-dot ${kind}`); }

  // The file must be this release's: the same run and Friday as share/release.json.
  function checkFile(data, release) {
    if (!data || data.schema !== SCHEMA || !Array.isArray(data.register) || !data.lists || !data.backtest) {
      return "The screener tests snapshot is in an unknown format.";
    }
    if (release && (release.run_id !== data.desk_run_id || release.as_of !== data.as_of)) {
      return "Screener tests are awaiting the latest Friday refresh.";
    }
    return "";
  }

  // A finished horizon: excess return over QQQ and SPY in points; null while the batch is held.
  function resultText(result) {
    if (!result) return null;
    if (!result.complete) return `not counted: ${result.reason || "incomplete"}`;
    return `${points(100 * result.excess_qqq)} vs QQQ, ${points(100 * result.excess_spy)} vs SPY`;
  }

  // Chart scale: the measure's full range, rounded out to the tick step, the same whichever lines are shown.
  function niceRange(values) {
    const finite = values.filter(Number.isFinite);
    const low = Math.min(0, ...finite), high = Math.max(0, ...finite);
    return [Math.floor(low / TICK) * TICK, Math.ceil(high / TICK) * TICK];
  }

  function seriesFor(backtest, measure) {
    const s = backtest.series;
    const hasGrowth = Boolean(backtest.growth_available && s.growth_excess && s.growth_return);
    return measure === "excess"
      ? { shortlist: s.shortlist_excess, growth: hasGrowth ? s.growth_excess : null, challenger: s.challenger_excess, qqq: null }
      : { shortlist: s.shortlist_return, growth: hasGrowth ? s.growth_return : null, challenger: s.challenger_return, qqq: s.qqq_return };
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
      cells.forEach((cell) => tr.appendChild(cell));
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

  // ---- Section 1: Unified Backtest --------------------------------------------------------------
  function periodSeriesKeys(backtest) {
    return backtest.growth_available ? ["shortlist", "growth", "challenger"] : ["shortlist", "challenger"];
  }

  function renderVerdict(backtest) {
    const st = backtest.stats;
    const hasGrowth = Boolean(backtest.growth_available && st.growth_return && st.growth_excess);
    const periods = periodsOf(backtest);
    const items = [];
    const pushCard = (key, retStat, exStat, sub) => {
      const meta = SERIES_META[key];
      const card = el("div", "st-verdict-card");
      const head = el("div", "st-verdict-head");
      const title = el("span");
      title.append(dot(meta.kind), document.createTextNode(meta.label));
      head.append(title, el("span", "st-verdict-sub", sub));
      const main = el("div", "st-verdict-main");
      main.append(
        el("span", "st-verdict-val", percent(retStat.median)),
        el("span", "st-verdict-beat", exStat ? `beat QQQ ${Math.round((100 * exStat.above_zero) / exStat.n)}%` : "typical 6M"),
      );
      const risk = el("div", "st-verdict-risk");
      risk.append(document.createTextNode("Worst 6M: "));
      risk.append(el("strong", retStat.worst <= -25 ? "st-crash" : "", percent(retStat.worst)));
      card.append(head, main, risk);
      items.push(card);
    };
    const slBeat = periods.filter((p) => p.shortlist_excess > 0).length;
    const chWins = periods.filter((p) => p.challenger_excess > p.shortlist_excess).length;
    pushCard("shortlist", st.shortlist_return, st.shortlist_excess, `${slBeat}/${periods.length} > QQQ`);
    if (hasGrowth) {
      const grBeat = periods.filter((p) => p.growth_excess > 0).length;
      pushCard("growth", st.growth_return, st.growth_excess, `${grBeat}/${periods.length} > QQQ`);
    }
    pushCard("challenger", st.challenger_return, st.challenger_excess, `${chWins}/${periods.length} vs Shortlist`);
    pushCard("qqq", st.qqq_return, null, `${backtest.starts.length} Fridays`);
    $("st-verdict").replaceChildren(...items);
  }

  function renderBacktest() {
    const backtest = state.data.backtest;
    const empty = $("st-backtest-empty");
    if (!backtest.available) {
      $("st-clock-before").textContent = `Backtest withheld: ${backtest.reason}`;
      empty.replaceChildren(el("strong", "", "Backtest withheld"), document.createTextNode(backtest.reason));
      empty.hidden = false;
      $("st-backtest").hidden = true;
      return;
    }
    const n = backtest.starts.length;
    const periods = periodsOf(backtest);
    const hasGrowth = Boolean(backtest.growth_available);
    $("st-clock-before").textContent = `${n} Friday starts (${periods.length} independent 6-month holds), ${dayYear(backtest.starts[0])} to ${dayYear(backtest.starts[n - 1])}. Shown once — never repeated.`;
    empty.hidden = true;
    $("st-backtest").hidden = false;

    if (state.index === null || state.index >= n) state.index = n - 1;
    if (state.periodIndex === null || state.periodIndex >= periods.length) state.periodIndex = periods.length - 1;

    $("st-view-periods").textContent = `${periods.length} independent periods`;
    $("st-view-weekly").textContent = `All ${n} weeks`;
    [["st-view-periods", "periods"], ["st-view-range", "range"], ["st-view-weekly", "weekly"]].forEach(([id, v]) =>
      $(id).setAttribute("aria-pressed", String(state.view === v)));

    const isWeekly = state.view === "weekly";
    $("st-weekly-controls").hidden = !isWeekly;
    $("st-slider-wrap").hidden = !isWeekly;
    $("st-show-growth").hidden = !hasGrowth;
    const slider = $("st-start");
    slider.setAttribute("max", String(n - 1));
    slider.value = String(state.index);
    $("st-show-shortlist").setAttribute("aria-pressed", String(state.show.shortlist));
    $("st-show-growth").setAttribute("aria-pressed", String(state.show.growth && hasGrowth));
    $("st-show-challenger").setAttribute("aria-pressed", String(state.show.challenger));
    $("st-show-monthend").setAttribute("aria-pressed", String(state.show.monthend));
    $("st-measure-excess").setAttribute("aria-pressed", String(state.measure === "excess"));
    $("st-measure-return").setAttribute("aria-pressed", String(state.measure === "return"));

    renderVerdict(backtest);

    const chartBox = $("st-chart");
    chartBox.className = `st-chart ${state.view}`;
    if (state.view === "periods") {
      const keys = periodSeriesKeys(backtest);
      const names = keys.map((k) => SERIES_META[k].label).join(", ");
      $("st-chart-legend").textContent = `${periods.length} non-overlapping 6-month holds: bars show points ahead of (+) or behind (−) QQQ (${names}). Hover or click any period.`;
      drawPeriodsChart(periods, keys);
      renderPeriodReadout(periods, keys);
    } else if (state.view === "range") {
      $("st-chart-legend").textContent = `Full 6-month return spread across all ${n} Friday starts: Worst (red) ← [10th pct … Median] → Best. Shows crash risk beside typical upside.`;
      drawRangeChart(backtest);
      renderRangeReadout(backtest);
    } else {
      const legend = [];
      if (state.measure === "excess") legend.push("Each point is one Friday start: points ahead of (+) or behind (−) QQQ over the next 6 months; the dark line is level with QQQ.");
      else legend.push("Each point is one Friday start: the 6-month return; QQQ is the dashed line.");
      if (state.show.monthend) legend.push("Blue dots: month-end starts on the Shortlist line, the dates a monthly decision would use.");
      $("st-chart-legend").textContent = legend.join(" ");
      drawWeeklyChart(backtest);
      renderWeeklyReadout(backtest);
    }

    renderStats(backtest);
    $("st-overlap").textContent = `The ${n} windows overlap, so they are not ${n} separate tests: only ${backtest.independent_windows} do not overlap.`;
    $("st-backtest-source").textContent = `Source: comparison report built ${dayYear(backtest.report_built_at)} on data to ${dayYear(backtest.data_as_of)}; `
      + `each window is held ${backtest.horizon_sessions} trading days; ${backtest.basis}.`;
  }

  function drawPeriodsChart(periods, keys) {
    cursor = null;
    const vals = periods.flatMap((p) => keys.map((k) => p[`${k}_excess`]));
    const [rawLow, rawHigh] = niceRange(vals);
    // Add vertical headroom/footroom so labels above tall bars and below negative bars never clip
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const low = minVal < 0 ? Math.min(rawLow, Math.floor((minVal - 10) / 10) * 10) : rawLow;
    const high = Math.max(rawHigh, Math.ceil((maxVal + 8) / 10) * 10);
    const L = 54, R = 986, T = 24, B = 252;
    const y = (v) => T + ((high - v) * (B - T)) / Math.max(1, high - low);
    const y0 = y(0);
    const svg = svgEl("svg", {
      viewBox: `0 0 ${BOX.width} ${BOX.height}`, role: "img",
      "aria-label": `${periods.length} independent 6-month periods comparing ${keys.map((k) => SERIES_META[k].label).join(", ")} versus QQQ.`,
    });
    for (let v = rawLow; v <= rawHigh; v += TICK) {
      svg.appendChild(svgEl("line", { x1: L, x2: R, y1: y(v), y2: y(v), class: v === 0 ? "zero" : "grid" }));
      svg.appendChild(svgEl("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end" }, v === 0 ? "QQQ 0" : signed(v, 0)));
    }
    const slot = (R - L) / Math.max(1, periods.length);
    const kCount = keys.length;
    const gap = kCount >= 3 ? 5 : 6;
    const bw = Math.min(kCount >= 3 ? 25 : 32, Math.max(14, Math.floor((slot - 24 - gap * (kCount - 1)) / kCount)));
    const totalW = kCount * bw + (kCount - 1) * gap;
    const groups = [];
    periods.forEach((p, i) => {
      const cx = L + slot * (i + 0.5);
      const startX = cx - totalW / 2;
      const g = svgEl("g", { class: `bar-group${i === state.periodIndex ? " selected" : ""}` });
      g.appendChild(svgEl("rect", { x: L + slot * i + 4, y: T - 6, width: slot - 8, height: B - T + 36, rx: 8, class: "bar-hit" }));
      keys.forEach((key, idx) => {
        const val = p[`${key}_excess`];
        const xPos = startX + idx * (bw + gap);
        const top = val >= 0 ? y(val) : y0;
        const h = Math.max(2.5, Math.abs(y(val) - y0));
        g.appendChild(svgEl("rect", { x: xPos, y: top, width: bw, height: h, rx: 3, fill: SERIES_META[key].color }));
        const ty = val >= 0 ? top - 5 : top + h + 12;
        g.appendChild(svgEl("text", { x: xPos + bw / 2, y: ty, "text-anchor": "middle", class: "bar-val" }, signed(val, 1)));
      });
      g.appendChild(svgEl("text", { x: cx, y: 292, "text-anchor": "middle" }, monthYr(p.start)));
      const choose = () => {
        state.periodIndex = i;
        groups.forEach((node, idx) => node.setAttribute("class", `bar-group${idx === i ? " selected" : ""}`));
        renderPeriodReadout(periods, keys);
      };
      g.addEventListener("pointerenter", choose);
      g.addEventListener("click", choose);
      groups.push(g);
      svg.appendChild(g);
    });
    $("st-chart").replaceChildren(svg);
  }

  function renderPeriodReadout(periods, keys) {
    const p = periods[state.periodIndex];
    if (!p) return;
    const lines = [el("strong", "", `Period ${state.periodIndex + 1} of ${periods.length} · Bought ${dayYear(p.start)} → sold ${dayYear(p.exit)} (QQQ ${percent(p.qqq_return)})`)];
    keys.forEach((key) => {
      const m = SERIES_META[key];
      const line = el("span");
      line.append(dot(m.kind), document.createTextNode(`${m.label}: ${percent(p[`${key}_return`])} (${points(p[`${key}_excess`])} vs QQQ)`));
      lines.push(line);
    });
    $("st-readout").replaceChildren(...lines);
  }

  function drawRangeChart(backtest) {
    cursor = null;
    const st = backtest.stats;
    const entries = [
      { key: "shortlist", stat: st.shortlist_return },
      ...(backtest.growth_available && st.growth_return ? [{ key: "growth", stat: st.growth_return }] : []),
      { key: "challenger", stat: st.challenger_return },
      { key: "qqq", stat: st.qqq_return },
    ];
    const [low, high] = niceRange(entries.flatMap((e) => [e.stat.worst, e.stat.best]));
    const L = 128, R = 972, T = 20, B = 248;
    const x = (v) => L + ((v - low) * (R - L)) / Math.max(1, high - low);
    const svg = svgEl("svg", {
      viewBox: `0 0 ${BOX.width} 280`, role: "img",
      "aria-label": "6-month return range from worst to best across Shortlist, Growth, 60/40 order, and QQQ.",
    });
    for (let v = low; v <= high; v += TICK) {
      svg.appendChild(svgEl("line", { x1: x(v), x2: x(v), y1: T, y2: B, class: v === 0 ? "zero" : "grid" }));
      svg.appendChild(svgEl("text", { x: x(v), y: B + 20, "text-anchor": "middle" }, v === 0 ? "0%" : `${signed(v, 0)}%`));
    }
    const step = (B - T) / entries.length;
    entries.forEach((entry, i) => {
      const cy = T + step * (i + 0.5);
      const m = SERIES_META[entry.key];
      const s = entry.stat;
      svg.appendChild(svgEl("text", { x: L - 14, y: cy + 4, "text-anchor": "end", class: "range-label" }, m.label));
      svg.appendChild(svgEl("line", { x1: x(s.worst), x2: x(s.best), y1: cy, y2: cy, stroke: m.color, "stroke-width": 2.5, "stroke-opacity": 0.4 }));
      if (s.worst < 0) {
        svg.appendChild(svgEl("line", { x1: x(s.worst), x2: x(Math.min(0, s.p10)), y1: cy, y2: cy, stroke: "#b42318", "stroke-width": 4.5, "stroke-linecap": "round" }));
      }
      const bandL = x(Math.min(s.p10, s.median));
      const bandW = Math.max(5, Math.abs(x(s.median) - x(s.p10)));
      svg.appendChild(svgEl("rect", { x: bandL, y: cy - 7, width: bandW, height: 14, rx: 4, fill: m.color, "fill-opacity": 0.85 }));
      svg.appendChild(svgEl("circle", { cx: x(s.worst), cy, r: 5, fill: "#b42318" }));
      svg.appendChild(svgEl("circle", { cx: x(s.median), cy, r: 6, fill: m.color, stroke: "#fff", "stroke-width": 1.8 }));
      svg.appendChild(svgEl("circle", { cx: x(s.best), cy, r: 4, fill: m.color }));
      svg.appendChild(svgEl("text", { x: x(s.worst), y: cy - 12, "text-anchor": "middle", class: "range-crash" }, percent(s.worst)));
      svg.appendChild(svgEl("text", { x: x(s.median), y: cy - 12, "text-anchor": "middle", class: "range-med" }, `med ${percent(s.median)}`));
      svg.appendChild(svgEl("text", { x: x(s.best), y: cy - 12, "text-anchor": "middle", class: "range-best" }, percent(s.best)));
    });
    $("st-chart").replaceChildren(svg);
  }

  function renderRangeReadout(backtest) {
    const st = backtest.stats;
    const lines = [el("strong", "", `Downside check across all ${backtest.starts.length} Friday starts`)];
    const add = (key, s) => {
      const m = SERIES_META[key];
      const line = el("span");
      line.append(dot(m.kind), document.createTextNode(`${m.label}: median ${percent(s.median)}, 1-in-10 worse than ${percent(s.p10)}, worst ${percent(s.worst)} (from ${dayYear(s.worst_start)})`));
      lines.push(line);
    };
    add("shortlist", st.shortlist_return);
    if (backtest.growth_available && st.growth_return) add("growth", st.growth_return);
    add("challenger", st.challenger_return);
    add("qqq", st.qqq_return);
    $("st-readout").replaceChildren(...lines);
  }

  function drawWeeklyChart(backtest) {
    const series = seriesFor(backtest, state.measure);
    const allVals = [...series.shortlist, ...series.challenger, ...(series.growth || []), ...(series.qqq || [])];
    const [low, high] = niceRange(allVals);
    const n = backtest.starts.length;
    const x = (i) => BOX.left + (i * (BOX.right - BOX.left)) / Math.max(1, n - 1);
    const y = (v) => BOX.top + ((high - v) * (BOX.bottom - BOX.top)) / Math.max(1, high - low);
    const label = state.measure === "excess" ? "lead over QQQ in points" : "6-month return in percent";
    const svg = svgEl("svg", { viewBox: `0 0 ${BOX.width} ${BOX.height}`, role: "img",
      "aria-label": `Chart of the ${label} for each Friday start from ${dayYear(backtest.starts[0])} to ${dayYear(backtest.starts[n - 1])}.` });
    for (let v = low; v <= high; v += TICK) {
      svg.appendChild(svgEl("line", { x1: BOX.left, x2: BOX.right, y1: y(v), y2: y(v), class: v === 0 ? "zero" : "grid" }));
      svg.appendChild(svgEl("text", { x: BOX.left - 8, y: y(v) + 4, "text-anchor": "end" }, v === 0 ? "0" : signed(v, 0)));
    }
    let year = null;
    backtest.starts.forEach((start, i) => {
      const y4 = start.slice(0, 4);
      if (year !== null && y4 !== year) {
        svg.appendChild(svgEl("line", { x1: x(i), x2: x(i), y1: BOX.top, y2: BOX.bottom, class: "year" }));
        svg.appendChild(svgEl("text", { x: x(i), y: BOX.bottom + 20, "text-anchor": "middle" }, y4));
      }
      year = y4;
    });
    const path = (values) => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
    if (series.qqq) svg.appendChild(svgEl("path", { d: path(series.qqq), class: "line qqq" }));
    if (state.show.shortlist) svg.appendChild(svgEl("path", { d: path(series.shortlist), class: "line sl" }));
    if (state.show.growth && series.growth) svg.appendChild(svgEl("path", { d: path(series.growth), class: "line gr" }));
    if (state.show.challenger) svg.appendChild(svgEl("path", { d: path(series.challenger), class: "line ch" }));
    if (state.show.monthend) backtest.month_end.forEach((i) => svg.appendChild(svgEl("circle", { cx: x(i), cy: y(series.shortlist[i]), r: 3.6, class: "me" })));
    const line = svgEl("line", { y1: BOX.top, y2: BOX.bottom, class: "cursor" });
    const marks = {
      shortlist: svgEl("circle", { r: 4.5, fill: SERIES_META.shortlist.color, stroke: "#fff" }),
      growth: svgEl("circle", { r: 4.5, fill: SERIES_META.growth.color, stroke: "#fff" }),
      challenger: svgEl("circle", { r: 4.5, fill: SERIES_META.challenger.color, stroke: "#fff" }),
      qqq: svgEl("circle", { r: 4, fill: SERIES_META.qqq.color, stroke: "#fff" }),
    };
    svg.appendChild(line);
    if (state.show.shortlist) svg.appendChild(marks.shortlist);
    if (state.show.growth && series.growth) svg.appendChild(marks.growth);
    if (state.show.challenger) svg.appendChild(marks.challenger);
    if (series.qqq) svg.appendChild(marks.qqq);
    const pick = (event) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const vx = ((event.clientX - rect.left) / rect.width) * BOX.width;
      const i = Math.max(0, Math.min(n - 1, Math.round(((vx - BOX.left) / (BOX.right - BOX.left)) * (n - 1))));
      if (i !== state.index) setIndex(i);
    };
    svg.addEventListener("pointermove", pick);
    svg.addEventListener("pointerdown", pick);
    cursor = { line, marks, series, x, y };
    $("st-chart").replaceChildren(svg);
    placeCursor();
  }

  function placeCursor() {
    if (!cursor) return;
    const i = state.index;
    cursor.line.setAttribute("x1", String(cursor.x(i)));
    cursor.line.setAttribute("x2", String(cursor.x(i)));
    ["shortlist", "growth", "challenger", "qqq"].forEach((key) => {
      if (!cursor.series[key]) return;
      cursor.marks[key].setAttribute("cx", String(cursor.x(i)));
      cursor.marks[key].setAttribute("cy", String(cursor.y(cursor.series[key][i])));
    });
  }

  function setIndex(i) {
    state.index = i;
    $("st-start").value = String(i);
    placeCursor();
    renderWeeklyReadout(state.data.backtest);
  }

  function renderWeeklyReadout(backtest) {
    const i = state.index, s = backtest.series;
    const hasGrowth = Boolean(backtest.growth_available && s.growth_return && s.growth_excess);
    const lines = [el("strong", "", `Bought ${dayYear(backtest.starts[i])} · sold ${dayYear(backtest.exits[i])}`)];
    const add = (kind, text) => { const line = el("span"); line.append(dot(kind), document.createTextNode(text)); lines.push(line); };
    if (state.show.shortlist) add("sl", `Shortlist: ${percent(s.shortlist_return[i])}, QQQ ${percent(s.qqq_return[i])}, lead ${points(s.shortlist_excess[i])}`);
    if (state.show.growth && hasGrowth) add("gr", `Growth: ${percent(s.growth_return[i])}, QQQ ${percent(s.qqq_return[i])}, lead ${points(s.growth_excess[i])}`);
    if (state.show.challenger) add("ch", `60/40 order: ${percent(s.challenger_return[i])}, QQQ ${percent(s.qqq_return[i])}, lead ${points(s.challenger_excess[i])}`);
    if (!state.show.shortlist && !(state.show.growth && hasGrowth) && !state.show.challenger) {
      lines.push(el("span", "", `QQQ: ${percent(s.qqq_return[i])}. Show a screener above to compare.`));
    }
    if (state.show.monthend && backtest.month_end.includes(i)) lines.push(el("span", "", "Month-end start: a monthly decision would have bought this batch."));
    $("st-readout").replaceChildren(...lines);
  }

  function renderStats(backtest) {
    const stats = backtest.stats, m = state.measure, cards = [];
    const hasGrowth = Boolean(backtest.growth_available && stats.growth_excess && stats.growth_return);
    const card = (title, kind, data) => {
      if (!data) return;
      const box = el("div", "st-stat"), h = el("h4"), dl = el("dl", "st-rows");
      h.append(dot(kind), document.createTextNode(title));
      rows(dl, statRows(data, m));
      box.append(h, dl);
      cards.push(box);
    };
    if (state.show.shortlist || state.view !== "weekly") card("Shortlist", "sl", stats[m === "excess" ? "shortlist_excess" : "shortlist_return"]);
    if (hasGrowth && (state.show.growth || state.view !== "weekly")) card("Growth", "gr", stats[m === "excess" ? "growth_excess" : "growth_return"]);
    if (state.show.challenger || state.view !== "weekly") card("60/40 order", "ch", stats[m === "excess" ? "challenger_excess" : "challenger_return"]);
    if (state.show.monthend && state.view === "weekly") card("Shortlist, month-end starts", "me", stats[m === "excess" ? "month_end_excess" : "month_end_return"]);
    if (m === "return" || state.view === "range") card("QQQ", "qqq", stats.qqq_return);
    $("st-stats").replaceChildren(...cards);
  }

  // ---- Section 2: Live Forward Tests (only per-list section) ------------------------------------
  function renderList() {
    const data = state.data, key = state.list, list = data.lists[key], names = LISTS[key];
    ["shortlist", "growth"].forEach((k) => {
      const tab = $(`st-tab-${k}`);
      tab.setAttribute("aria-selected", String(k === key));
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
    $("st-pass-note").textContent = list.pass_rule ? "" : !oldest
      ? "Write it before the first batch finishes, so it cannot be fitted to the first results."
      : finished
        ? "The first batch has finished; a bar written now could be fitted to its result."
        : `Write it before ${dayYear(oldest.exit_6m)}, when the first batch finishes, so it cannot be fitted to the first results.`;

    renderBatches(list, names);
    renderPicks(list, names);
  }

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
    const lines = [["rule", names.rule], ["challenger", names.challenger]]
      .map(([side, name]) => [name, row[side] ? resultText(row[side][horizon]) : null])
      .filter(([, text]) => text !== null);
    if (!lines.length) td.appendChild(el("span", "st-due", `Due ${dayYear(due)}`));
    lines.forEach(([name, text]) => td.appendChild(el("span", "st-result-line", `${name}: ${text}`)));
    return td;
  }

  function renderBatches(list, names) {
    if (!list.batches.length) {
      $("st-batches").replaceChildren(el("p", "st-small", "No weekly batches yet."));
      $("st-batches-more").hidden = true;
      return;
    }
    const shown = state.allBatches ? list.batches : list.batches.slice(0, BATCHES_SHOWN);
    const body = shown.map((row) => {
      const first = el("td");
      first.appendChild(document.createTextNode(dayYear(row.as_of)));
      if (row.month_end) first.appendChild(el("span", "st-tag", "month-end"));
      return [first, cell(dayYear(row.entry)), batchCell(row, "6m", row.exit_6m, names), batchCell(row, "12m", row.exit_12m, names)];
    });
    const t = table(["List of", "Bought (paper)", "After 6 months", "After 12 months"], body);
    t.className = "st-batches";
    $("st-batches").replaceChildren(t);
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

  // ---- Section 3: Test Register -----------------------------------------------------------------
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

  function setView(view) {
    state.view = view;
    if (state.data) renderBacktest();
  }

  function render(data) {
    state.data = data;
    $("st-week").textContent = `Data as of ${dayYear(data.as_of)}`;
    $("aside-week").textContent = dayYear(data.as_of);
    $("st-status").hidden = true;
    $("st-content").hidden = false;
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
    [["st-view-periods", "periods"], ["st-view-range", "range"], ["st-view-weekly", "weekly"]].forEach(([id, v]) =>
      $(id).addEventListener("click", () => setView(v)));
    [["st-show-shortlist", "shortlist"], ["st-show-growth", "growth"], ["st-show-challenger", "challenger"], ["st-show-monthend", "monthend"]].forEach(([id, key]) =>
      $(id).addEventListener("click", () => { state.show[key] = !state.show[key]; renderBacktest(); }));
    [["st-measure-excess", "excess"], ["st-measure-return", "return"]].forEach(([id, key]) =>
      $(id).addEventListener("click", () => { state.measure = key; renderBacktest(); }));
    $("st-start").addEventListener("input", (event) => setIndex(Number(event.target.value)));
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

  const api = { state, render, fail, checkFile, dayYear, signed, resultText, windowText, niceRange, statRows, registerRows, setIndex, setView };
  globalThis.TLScreenerTests = api;
  wire();
  void start();
})();
