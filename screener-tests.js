// Screener tests page: every rule written down in the forward tests, the Shortlist and Growth
// rule-versus-challenger status, and the Shortlist backtest windows — from
// share/screener-tests.json (tools/build_screener_tests.py, Saturday). Numbers come from the
// builder; this file only formats them and places the chart. Values are written as text,
// never as HTML.
(function () {
  "use strict";
  const SCHEMA = "screener-tests-1";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ROLES = [["site", "On the site"], ["challenger", "Challenger"], ["side", "Side test"],
    ["stopped", "Stopped"], ["replaced", "Replaced"]];
  const FILTERS = [["all", "All"], ["site", "On the site"], ["challenger", "Challengers"], ["side", "Side tests"],
    ["stopped", "Stopped"], ["replaced", "Replaced"]];
  const LISTS = { shortlist: { rule: "Shortlist", challenger: "60/40 order" }, growth: { rule: "Growth", challenger: "Growth v3" } };
  const BATCHES_SHOWN = 6;
  const NEEDED = 3;
  const BOX = { width: 1000, height: 320, left: 52, right: 990, top: 14, bottom: 290 };
  const TICK = 20;

  const state = { data: null, list: "shortlist", measure: "excess", index: null, filter: "all", allBatches: false,
    show: { shortlist: true, challenger: true, monthend: false } };
  let cursor = null;

  const $ = (id) => document.getElementById(id);
  const utc = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const dayYear = (iso) => { if (!iso) return "—"; const d = utc(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const signed = (value, digits = 1) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    const text = Math.abs(value).toFixed(digits);
    return Number(text) === 0 ? text : `${value > 0 ? "+" : "−"}${text}`;
  };
  const points = (value) => `${signed(value)} pts`;
  const percent = (value) => `${signed(value)}%`;
  const share = (part, whole) => `${part} of ${whole} (${Math.round((100 * part) / whole)}%)`;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function svgEl(tag, attributes) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
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
    return measure === "excess"
      ? { shortlist: s.shortlist_excess, challenger: s.challenger_excess, qqq: null }
      : { shortlist: s.shortlist_return, challenger: s.challenger_return, qqq: s.qqq_return };
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
    return register.filter((row) => filter === "all" || row.role === filter);
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

  // ---- One list: clock, rule vs challenger, batches, picks --------------------------------------
  function renderList() {
    const data = state.data, key = state.list, list = data.lists[key], names = LISTS[key];
    ["shortlist", "growth"].forEach((k) => {
      const tab = $(`st-tab-${k}`);
      tab.setAttribute("aria-selected", String(k === key));
      tab.className = k === key ? "on" : "";
    });
    $("st-list-title").textContent = names.rule;
    $("st-list-what").textContent = list.what;
    const oldest = list.batches[list.batches.length - 1];
    const backtest = data.backtest;
    $("st-clock-before").textContent = key !== "shortlist" ? "No backtest report yet."
      : backtest.available ? `Backtest of ${backtest.starts.length} Friday starts, ${dayYear(backtest.starts[0])} to ${dayYear(backtest.starts[backtest.starts.length - 1])}.`
        : `Backtest withheld: ${backtest.reason}`;
    $("st-clock-written").textContent = dayYear(list.registered_at);
    $("st-clock-after").textContent = `${list.batches.length} weekly batches since the list of ${dayYear(oldest.as_of)}. First 6-month result ${dayYear(oldest.exit_6m)}.`;

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
    const finished = oldest.exit_6m.slice(0, 10) <= data.as_of;
    $("st-pass").textContent = list.pass_rule ? list.pass_rule : "Pass/fail bar not written yet";
    $("st-pass-note").textContent = list.pass_rule ? "" : finished
      ? "The first batch has finished; a bar written now could be fitted to its result."
      : `Write it before ${dayYear(oldest.exit_6m)}, when the first batch finishes, so it cannot be fitted to the first results.`;

    renderBatches(list, names);
    renderPicks(list, names);
    renderBacktest();
  }

  // One window of the switch rule, as weekly_freeze/forward_evidence.py score_switch left it.
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
    $("st-picks").replaceChildren(
      pickCard(`${names.rule} (rule)`, "sl", picks.rule, shared, picks.as_of),
      pickCard(`${names.challenger} (challenger)`, "ch", picks.challenger, shared, picks.as_of));
    $("st-shared").textContent = picks.shared === null ? ""
      : `${picks.shared} of 10 picks are the same, so the two can only differ through the other ${10 - picks.shared} stocks each.`
        + (picks.challenger ? " Names in both are outlined." : "");
  }

  // ---- Backtest (Shortlist only) ----------------------------------------------------------------
  function renderBacktest() {
    const backtest = state.data.backtest;
    const empty = $("st-backtest-empty");
    if (state.list !== "shortlist" || !backtest.available) {
      const title = state.list !== "shortlist" ? "No backtest report for Growth yet" : "Backtest withheld";
      const note = state.list !== "shortlist" ? "This space stays empty rather than borrowing the Shortlist’s numbers." : backtest.reason;
      empty.replaceChildren(el("strong", "", title), document.createTextNode(note));
      empty.hidden = false;
      $("st-backtest").hidden = true;
      return;
    }
    empty.hidden = true;
    $("st-backtest").hidden = false;
    const n = backtest.starts.length;
    if (state.index === null || state.index >= n) state.index = n - 1;
    const slider = $("st-start");
    slider.setAttribute("max", String(n - 1));
    slider.value = String(state.index);
    $("st-show-shortlist").setAttribute("aria-pressed", String(state.show.shortlist));
    $("st-show-challenger").setAttribute("aria-pressed", String(state.show.challenger));
    $("st-show-monthend").setAttribute("aria-pressed", String(state.show.monthend));
    $("st-measure-excess").setAttribute("aria-pressed", String(state.measure === "excess"));
    $("st-measure-return").setAttribute("aria-pressed", String(state.measure === "return"));
    const legend = [];
    if (state.measure === "excess") legend.push("Each point is one Friday start: points ahead of (+) or behind (−) QQQ over the next 6 months; the dark line is level with QQQ.");
    else legend.push("Each point is one Friday start: the 6-month return; QQQ is the dashed line.");
    if (state.show.monthend) legend.push("Blue dots: month-end starts on the Shortlist line, the dates a monthly decision would use.");
    $("st-chart-legend").textContent = legend.join(" ");
    drawChart(backtest);
    renderReadout(backtest);
    renderStats(backtest);
    $("st-overlap").textContent = `The ${n} windows overlap, so they are not ${n} separate tests: only ${backtest.independent_windows} do not overlap.`;
    $("st-backtest-source").textContent = `Source: comparison report built ${dayYear(backtest.report_built_at)} on data to ${dayYear(backtest.data_as_of)}; `
      + `each window is held ${backtest.horizon_sessions} trading days; ${backtest.basis}.`;
  }

  function drawChart(backtest) {
    const series = seriesFor(backtest, state.measure);
    const [low, high] = niceRange([...series.shortlist, ...series.challenger, ...(series.qqq || [])]);
    const n = backtest.starts.length;
    const x = (i) => BOX.left + (i * (BOX.right - BOX.left)) / Math.max(1, n - 1);
    const y = (v) => BOX.top + ((high - v) * (BOX.bottom - BOX.top)) / (high - low);
    const label = state.measure === "excess" ? "lead over QQQ in points" : "6-month return in percent";
    const svg = svgEl("svg", { viewBox: `0 0 ${BOX.width} ${BOX.height}`, role: "img",
      "aria-label": `Chart of the ${label} for each Friday start from ${dayYear(backtest.starts[0])} to ${dayYear(backtest.starts[n - 1])}.` });
    for (let v = low; v <= high; v += TICK) {
      svg.appendChild(svgEl("line", { x1: BOX.left, x2: BOX.right, y1: y(v), y2: y(v), class: v === 0 ? "zero" : "grid" }));
      const t = svgEl("text", { x: BOX.left - 8, y: y(v) + 4, "text-anchor": "end" });
      t.textContent = v === 0 ? "0" : signed(v, 0);
      svg.appendChild(t);
    }
    let year = null;
    backtest.starts.forEach((start, i) => {
      const y4 = start.slice(0, 4);
      if (year !== null && y4 !== year) {
        svg.appendChild(svgEl("line", { x1: x(i), x2: x(i), y1: BOX.top, y2: BOX.bottom, class: "year" }));
        const t = svgEl("text", { x: x(i), y: BOX.bottom + 20, "text-anchor": "middle" });
        t.textContent = y4;
        svg.appendChild(t);
      }
      year = y4;
    });
    const path = (values) => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
    if (series.qqq) svg.appendChild(svgEl("path", { d: path(series.qqq), class: "line qqq" }));
    if (state.show.shortlist) svg.appendChild(svgEl("path", { d: path(series.shortlist), class: "line sl" }));
    if (state.show.challenger) svg.appendChild(svgEl("path", { d: path(series.challenger), class: "line ch" }));
    if (state.show.monthend) backtest.month_end.forEach((i) => svg.appendChild(svgEl("circle", { cx: x(i), cy: y(series.shortlist[i]), r: 3.6, class: "me" })));
    const line = svgEl("line", { y1: BOX.top, y2: BOX.bottom, class: "cursor" });
    const marks = { shortlist: svgEl("circle", { r: 4.5, fill: "#1e6547", stroke: "#fff" }),
      challenger: svgEl("circle", { r: 4.5, fill: "#c05a12", stroke: "#fff" }),
      qqq: svgEl("circle", { r: 4, fill: "#6b7280", stroke: "#fff" }) };
    svg.appendChild(line);
    if (state.show.shortlist) svg.appendChild(marks.shortlist);
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
    ["shortlist", "challenger", "qqq"].forEach((key) => {
      if (!cursor.series[key]) return;
      cursor.marks[key].setAttribute("cx", String(cursor.x(i)));
      cursor.marks[key].setAttribute("cy", String(cursor.y(cursor.series[key][i])));
    });
  }

  function setIndex(i) {
    state.index = i;
    $("st-start").value = String(i);
    placeCursor();
    renderReadout(state.data.backtest);
  }

  function renderReadout(backtest) {
    const i = state.index, s = backtest.series;
    const lines = [el("strong", "", `Bought ${dayYear(backtest.starts[i])} · sold ${dayYear(backtest.exits[i])}`)];
    const add = (kind, text) => { const line = el("span"); line.append(dot(kind), document.createTextNode(text)); lines.push(line); };
    if (state.show.shortlist) add("sl", `Shortlist: ${percent(s.shortlist_return[i])}, QQQ ${percent(s.qqq_return[i])}, lead ${points(s.shortlist_excess[i])}`);
    if (state.show.challenger) add("ch", `60/40 order: ${percent(s.challenger_return[i])}, QQQ ${percent(s.qqq_return[i])}, lead ${points(s.challenger_excess[i])}`);
    if (!state.show.shortlist && !state.show.challenger) lines.push(el("span", "", `QQQ: ${percent(s.qqq_return[i])}. Show the Shortlist or 60/40 to compare.`));
    if (state.show.monthend && backtest.month_end.includes(i)) lines.push(el("span", "", "Month-end start: a monthly decision would have bought this batch."));
    $("st-readout").replaceChildren(...lines);
  }

  function renderStats(backtest) {
    const stats = backtest.stats, m = state.measure, cards = [];
    const card = (title, kind, data) => {
      const box = el("div", "st-stat"), h = el("h4"), dl = el("dl", "st-rows");
      h.append(dot(kind), document.createTextNode(title));
      rows(dl, statRows(data, m));
      box.append(h, dl);
      cards.push(box);
    };
    if (state.show.shortlist) card("Shortlist", "sl", stats[m === "excess" ? "shortlist_excess" : "shortlist_return"]);
    if (state.show.challenger) card("60/40 order", "ch", stats[m === "excess" ? "challenger_excess" : "challenger_return"]);
    if (state.show.monthend) card("Shortlist, month-end starts", "me", stats[m === "excess" ? "month_end_excess" : "month_end_return"]);
    if (m === "return") card("QQQ", "qqq", stats.qqq_return);
    $("st-stats").replaceChildren(...cards);
  }

  // ---- Register -------------------------------------------------------------------------------
  function renderRegister() {
    const register = state.data.register;
    $("st-register-intro").textContent = `All ${register.length}, including side tests, stopped tests and replaced versions. `
      + "Showing every test, not only the ones that look good, is what keeps the winners honest.";
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
    [["st-show-shortlist", "shortlist"], ["st-show-challenger", "challenger"], ["st-show-monthend", "monthend"]].forEach(([id, key]) =>
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

  const api = { state, render, fail, checkFile, dayYear, signed, resultText, windowText, niceRange, statRows, registerRows, setIndex };
  globalThis.TLScreenerTests = api;
  wire();
  void start();
})();
