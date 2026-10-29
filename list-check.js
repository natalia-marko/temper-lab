// Market mood "List check" tab: what this week's Research lists hold before the month-end
// decision — sector mix, month-end trend, changes since the last month-end freeze, results
// dates around the decision, and the forward tests — from share/list-check.json
// (tools/build_list_check.py, Saturday). Also fills the Shortlist line of the Market desk
// strip. Descriptions, not forecasts. Values are written as text, never as HTML.
(function () {
  "use strict";
  const SCHEMA = "list-check-1";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // [key, label, chip class]; Eligible is the reference row, not a list.
  const GROUPS = [["eligible", "Eligible", "e"], ["strength", "Hot tape", "h"], ["growth", "Growth", "g"],
    ["undervalued", "Cheap", "c"], ["shortlist", "Shortlist", "sl"], ["top10", "Shortlist top 10", "sl"]];
  const LISTS = GROUPS.filter(([key]) => key !== "eligible");
  const CHANGE_ROWS = LISTS.filter(([key]) => key !== "top10");
  const SHORT_SECTOR = { consumer_cyclical: "Cons. cyclical", consumer_defensive: "Cons. defensive",
    basic_materials: "Basic materials", communication: "Commu\u00adnication", industrials: "Indus\u00adtrials",
    technology: "Tech\u00adnology", healthcare: "Health\u00adcare", financials: "Finan\u00adcials" };
  const TREND_PARTS = [["up", "Up on all 3", "lc-up"], ["mixed", "Mixed", "lc-mixed"], ["down", "Down on all 3", "lc-down"],
    ["short", "Too little history", "lc-short"]];
  const RESULT_PARTS = [["before", "lc-before"], ["after", "lc-after"], ["later", "lc-later"]];
  const TILT = { share: 0.1, ratio: 2 };  // ×n mark: at least 10% of the list and twice the eligible share
  // Retired first versions, in reading order; an unknown track shows its id after these.
  const RETIRED = [["composite-top10-v1", "the lake-9 Shortlist"], ["composite-strength-roe-top10-v1", "its 60/40 challenger"],
    ["growth-top10-v1", "Growth on ROE"]];

  const $ = (id) => document.getElementById(id);
  const utc = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const dayText = (iso) => { const d = utc(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
  const weekdayText = (iso) => `${WEEKDAYS[utc(iso).getUTCDay()]} ${dayText(iso)}`;
  const monthText = (iso) => { const d = utc(iso); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const dayYear = (iso) => `${dayText(iso)} ${utc(iso).getUTCFullYear()}`;
  const monthName = (iso) => MONTH_NAMES[utc(iso).getUTCMonth()];
  function spanText(from, to) {
    if (from === to) return dayText(from);
    const a = utc(from), b = utc(to);
    return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${dayText(to)}` : `${dayText(from)}–${dayText(to)}`;
  }
  const share = (n, total) => (total ? n / total : 0);
  const pct = (x) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;
  const count = (n) => Number(n || 0).toLocaleString("en-US");
  const groupLabel = (key) => (GROUPS.find(([k]) => k === key) || [key, key])[1];
  const sectorName = (key) => (typeof sectorLabel === "function" ? sectorLabel(key) : key);

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function chip(key) {
    const [, label, cls] = GROUPS.find(([k]) => k === key);
    return el("span", `lc-chip lc-chip-${cls}`, label);
  }
  function tickerLink(symbol, cls) {
    const link = el("a", `lc-tick${cls ? ` ${cls}` : ""}`, symbol);
    link.href = `./ticker.html?t=${encodeURIComponent(symbol)}`;
    return link;
  }

  // Sector columns: by eligible count, Unclassified last and only when some group has one.
  function sectorColumns(counts) {
    const keys = new Set();
    for (const group of Object.values(counts || {})) for (const [key, n] of Object.entries(group || {})) if (n > 0) keys.add(key);
    const eligible = counts?.eligible || {};
    return [...keys].sort((a, b) => (a === "unclassified") - (b === "unclassified") || (eligible[b] || 0) - (eligible[a] || 0) || a.localeCompare(b));
  }
  function binClass(x) {
    return x <= 0 ? "lc-b0" : x < 0.05 ? "lc-b1" : x < 0.1 ? "lc-b2" : x < 0.2 ? "lc-b3" : x < 0.3 ? "lc-b4" : "lc-b5";
  }
  function tiltOf(check, key, sector) {
    const groups = check.groups, counts = check.sectors.counts;
    const own = share(counts[key]?.[sector] || 0, groups[key].count);
    const base = share(counts.eligible?.[sector] || 0, groups.eligible.count);
    return { share: own, base, ratio: base ? own / base : null };
  }
  const tilted = (t) => t.share >= TILT.share && t.ratio !== null && t.ratio >= TILT.ratio;

  // The Shortlist's largest sector, its share and its tilt against the eligible universe.
  function largestTilt(check, key = "shortlist") {
    const largest = check.sectors.concentration?.[key]?.largest;
    if (!largest) return null;
    return { sector: largest.sector, count: largest.count, ...tiltOf(check, key, largest.sector) };
  }

  function stack(parts, total, label) {
    const bar = el("div", "lc-stack");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", label);
    for (const part of parts) {
      if (!part.n) continue;
      const seg = el("span", part.cls, share(part.n, total) >= part.min ? part.text : "");
      seg.style.flex = `${part.n} 1 0px`;
      seg.title = `${part.label}: ${part.n} of ${total}`;
      bar.appendChild(seg);
    }
    return bar;
  }
  function barRow(key, total, parts, label) {
    const row = el("div", "lc-bar-row");
    const name = el("div", "lc-lab", groupLabel(key));
    name.appendChild(el("small", "", `${count(total)} names`));
    row.append(name, stack(parts, total, label));
    return row;
  }
  function unavailable(target, reason) {
    target.replaceChildren(el("p", "lc-unavailable", `Not available this week: ${reason}.`));
  }

  function renderDates(check) {
    const parts = [`Lists: ${dayText(check.as_of)} freeze`];
    if (check.trend.available) parts.push(`trend: ${dayText(check.trend.signal_date)} month-end close`);
    if (check.changes.available) parts.push(`compared with the ${dayText(check.changes.previous_as_of)} month-end lists`);
    parts.push(check.is_decision_freeze ? "this is the month-end snapshot" : `month-end snapshot: ${weekdayText(check.decision_date)}`);
    $("lc-dates").textContent = parts.join(" · ");
  }

  function renderPopulation(check) {
    $("lc-population").textContent = `${count(check.union.count)} names on at least one list · ${count(check.groups.shortlist.count)} on the Shortlist (two or more lists, positive equity) · ${count(check.union.on_all_three)} on all three`;
  }
  function tile(key, value, unit, sub, flagged = false) {
    const node = el("div", `lc-tile${flagged ? " flagged" : ""}`);
    node.appendChild(el("span", "k", key));
    const v = el("span", "v", value);
    if (unit) v.appendChild(el("small", "", ` ${unit}`));
    node.append(v, el("span", "s", sub));
    return node;
  }
  function renderTiles(check) {
    const g = check.groups, tiles = [];
    const big = largestTilt(check);
    tiles.push(big
      ? tile("1 · Shortlist’s largest sector", `${sectorName(big.sector)} ${pct(big.share)}`, "",
        big.ratio !== null ? `${big.ratio.toFixed(1)}× its share of eligible stocks (${pct(big.base)})` : "Not among eligible stocks", tilted(big))
      : tile("1 · Shortlist’s largest sector", "—", "", "No Shortlist this week"));
    if (check.trend.available) {
      const t = check.trend.counts;
      tiles.push(tile("2 · Uptrend on all 3 rules", count(t.shortlist.up), `of ${count(g.shortlist.count)} Shortlist`,
        `Eligible stocks: ${pct(share(t.eligible.up, g.eligible.count))} · at the ${dayText(check.trend.signal_date)} close`));
    } else tiles.push(tile("2 · Uptrend on all 3 rules", "—", "", "The trend file for this week is not available"));
    if (check.changes.available) {
      const c = check.changes.lists;
      const changed = c.shortlist.previous_version && c.shortlist.previous_version !== c.shortlist.version;
      const others = ["strength", "growth", "undervalued"].map((k) => `${groupLabel(k)} ${count(c[k].kept)} of ${count(c[k].previous)}`).join(" · ");
      tiles.push(tile(`3 · Kept since ${monthName(check.changes.previous_as_of).slice(0, 3)} month-end`, count(c.shortlist.kept),
        `of ${count(c.shortlist.previous)} Shortlist`,
        changed ? `Shortlist method changed: ${c.shortlist.previous_version} → ${c.shortlist.version} · ${others}` : others, changed));
    } else tiles.push(tile("3 · Kept since the last month-end", "—", "", "No earlier month-end freeze on file"));
    const r = check.results;
    if (r.available && r.after) {
      tiles.push(tile(`4 · Report right after ${dayText(check.decision_date)}`, count(r.counts.shortlist.after),
        `of ${count(g.shortlist.count)} Shortlist`,
        `Results ${spanText(r.after.from, r.after.to)}; ${count(r.counts.top10.after)} of the top ${count(g.top10.count)} · calendar of ${dayText(r.calendar_built_at)}`));
    } else tiles.push(tile(`4 · Report right after ${dayText(check.decision_date)}`, "—", "", "No results dates for that window yet"));
    $("lc-tiles").replaceChildren(...tiles);
  }

  function renderMix(check) {
    const counts = check.sectors.counts, columns = sectorColumns(counts);
    const head = el("tr");
    head.appendChild(el("th", "lc-row-head", "List")).scope = "col";
    for (const key of columns) {
      const th = el("th", "", SHORT_SECTOR[key] || sectorName(key));
      th.scope = "col";
      th.title = sectorName(key);
      head.appendChild(th);
    }
    for (const label of ["Effective sectors", "Largest"]) head.appendChild(el("th", "lc-sum-head", label)).scope = "col";
    const body = [];
    for (const [key] of GROUPS) {
      const total = check.groups[key].count;
      const tr = el("tr", key === "eligible" ? "lc-ref" : "");
      const th = el("th", "lc-row-head");
      th.scope = "row";
      th.append(chip(key), el("small", "", `${count(total)} names`));
      tr.appendChild(th);
      for (const sector of columns) {
        const n = counts[key]?.[sector] || 0, t = tiltOf(check, key, sector);
        const td = el("td", `${binClass(t.share)}${t.share >= 0.2 ? " dark" : ""}`, n ? pct(t.share) : "—");
        td.title = `${sectorName(sector)}: ${n} of ${total}${key === "eligible" ? "" : ` · eligible ${pct(t.base)}`}`;
        if (key !== "eligible" && tilted(t)) td.appendChild(el("span", "x", `×${t.ratio.toFixed(1)}`));
        tr.appendChild(td);
      }
      const conc = check.sectors.concentration[key] || {};
      const eff = el("td", "lc-sum");
      eff.append(el("b", "", Number.isFinite(conc.effective) ? conc.effective.toFixed(1) : "—"), el("small", "", "of 11"));
      const largest = el("td", "lc-sum");
      largest.append(el("b", "", conc.largest ? sectorName(conc.largest.sector) : "—"),
        el("small", "", conc.largest ? pct(share(conc.largest.count, total)) : ""));
      tr.append(eff, largest);
      body.push(tr);
    }
    $("lc-mix-head").replaceChildren(head);
    $("lc-mix-body").replaceChildren(...body);
    const notes = ["Effective sectors = 1 ÷ the sum of squared sector shares: 11 would be an even spread, 1 a single sector."];
    const big = largestTilt(check), sl = check.groups.shortlist.count, top = check.groups.top10.count;
    if (big && sl > top) {
      const rest = (counts.shortlist[big.sector] || 0) - (counts.top10[big.sector] || 0);
      notes.push(`The Shortlist’s first ${top} hold at most 3 per sector; the other ${sl - top} Shortlist names are ${pct(share(rest, sl - top))} ${sectorName(big.sector).toLowerCase()}.`);
    }
    notes.push("Sectors: the shared Nasdaq industry map plus reviewed company corrections (tankers count as energy), the same rule as the Overview’s sector chart, here over all eligible names. Cheap has no financials by design: operating income / EV does not apply to them.");
    $("lc-mix-note").textContent = notes.join(" ");
  }

  function renderTrend(check) {
    const target = $("lc-trend");
    if (!check.trend.available) {
      $("lc-trend-copy").textContent = "The three trend rules tested in Leg D, at the last month-end close.";
      unavailable(target, check.trend.reason);
      return;
    }
    $("lc-trend-copy").textContent = `The three trend rules tested in Leg D, at the ${dayText(check.trend.signal_date)} month-end close: price above its 200-day average, 12-1 month return above zero, 50-day average above the 200-day.`;
    target.replaceChildren(...GROUPS.map(([key]) => {
      const c = check.trend.counts[key], total = check.groups[key].count;
      const parts = TREND_PARTS.map(([k, label, cls]) => ({ n: c[k], label, cls, text: pct(share(c[k], total)), min: 0.08 }));
      return barRow(key, total, parts, `${groupLabel(key)}: ${c.up} up, ${c.mixed} mixed, ${c.down} down, ${c.short} too little history`);
    }));
  }

  function versionNote(row, previousAsOf) {
    return `${row.previous_version} on ${dayText(previousAsOf)}, ${row.version} now`;
  }
  function renderChanges(check) {
    const ch = check.changes;
    const table = $("lc-change-table"), top = $("lc-top"), note = $("lc-change-note");
    if (!ch.available) {
      $("lc-change-title").textContent = "3 · What changed since the last month-end";
      $("lc-change-copy").textContent = "Membership against the last month-end freeze, the last decision snapshot.";
      table.hidden = true;
      top.replaceChildren();
      note.textContent = `Not available this week: ${ch.reason}.`;
      return;
    }
    table.hidden = false;
    $("lc-change-title").textContent = `3 · What changed since the ${monthName(ch.previous_as_of)} month-end`;
    $("lc-change-copy").textContent = `Membership on ${dayText(check.as_of)} against the ${dayText(ch.previous_as_of)} freeze, the last month-end snapshot.`;
    $("lc-change-prev").textContent = dayText(ch.previous_as_of);
    const changed = [];
    $("lc-change-body").replaceChildren(...CHANGE_ROWS.map(([key]) => {
      const row = ch.lists[key], tr = el("tr");
      const name = el("td");
      name.appendChild(chip(key));
      if (row.previous_version !== row.version) {
        const flag = el("span", "lc-flag", "method changed");
        flag.title = versionNote(row, ch.previous_as_of);
        name.appendChild(flag);
        changed.push(`${groupLabel(key)} ${versionNote(row, ch.previous_as_of)}`);
      }
      tr.append(name, el("td", "", count(row.previous)), el("td", "", count(row.now)), el("td", "", count(row.kept)),
        el("td", "lc-new", count(row.added)), el("td", "", count(row.dropped)),
        el("td", "lc-strong", row.previous ? `${Math.round((100 * row.kept) / row.previous)}%` : "—"));
      return tr;
    }));
    const t = ch.top10, size = check.groups.top10.count;
    const heading = el("div", "lc-top-head", `Shortlist top ${size}: ${t.kept.length} of ${size} the same`);
    if (t.previous_version !== t.version) heading.appendChild(el("span", "lc-flag", "not like for like"));
    const line = (label, symbols, cls) => {
      const row = el("div", "lc-top-line");
      row.appendChild(el("span", "lc-top-label", label));
      if (!symbols.length) row.appendChild(el("span", "lc-top-none", "none"));
      for (const symbol of symbols) row.appendChild(tickerLink(symbol, cls));
      return row;
    };
    top.replaceChildren(heading, line("Kept", t.kept, ""), line("In", t.added, "in"), line("Out", t.dropped, "out"));
    note.textContent = changed.length
      ? `Method changed between the two dates (${changed.join("; ")}): memberships compare, ranks and the first ${size} are not like for like.`
      : `The same methods on both dates.`;
  }

  function renderResults(check) {
    const r = check.results, target = $("lc-results"), legend = $("lc-results-legend");
    $("lc-results-copy").textContent = check.is_decision_freeze
      ? "When list names report, against this month-end snapshot."
      : `When list names report, against the ${weekdayText(check.decision_date)} month-end snapshot.`;
    if (!r.available) {
      legend.replaceChildren();
      $("lc-results-note").textContent = "";
      unavailable(target, r.reason);
      return;
    }
    const labels = {
      before: r.before ? `${spanText(r.before.from, r.before.to)}, up to the snapshot` : "",
      after: r.after ? `${spanText(r.after.from, r.after.to)}, right after` : "",
      later: "Later, or no date yet",
    };
    legend.replaceChildren(...RESULT_PARTS.filter(([k]) => labels[k]).map(([k, cls]) => {
      const item = el("span", "");
      item.append(el("i", cls), document.createTextNode(labels[k]));
      return item;
    }));
    target.replaceChildren(...LISTS.map(([key]) => {
      const c = r.counts[key], total = check.groups[key].count;
      const parts = RESULT_PARTS.map(([k, cls]) => ({ n: c[k], label: labels[k] || k, cls, text: String(c[k]), min: 0.1 }));
      return barRow(key, total, parts, `${groupLabel(key)}: ${c.before} up to the snapshot, ${c.after} right after, ${c.later} later or no date`);
    }));
    const notes = [`Yahoo’s dates as of ${weekdayText(r.calendar_built_at)}, refreshed Tuesday and Friday; a date can move until the company confirms it.`];
    const full = new Date(utc(check.decision_date).getTime() + r.after_days * 864e5).toISOString().slice(0, 10);
    if (r.freeze_capture) notes.push(`Dates up to ${dayText(r.freeze_capture.to)} come from the calendar saved on ${weekdayText(r.freeze_capture.retrieved)}.`);
    if (r.after && r.after.to < full) notes.push(`The calendar reaches ${dayText(r.window.to)}; later dates are not listed yet.`);
    notes.push("Our test found no price drift after results: this is for planning, not a signal.");
    $("lc-results-note").textContent = notes.join(" ");
  }

  const FORWARD = [
    { id: "composite-top10-v2", pair: "composite-strength-roe-top10-v2", title: "Shortlist top 10", tail: " vs the 60/40 challenger",
      text: "Each week’s first ten against QQQ and SPY; switch only if the challenger wins 2 of the first 3 six-month windows." },
    { id: "growth-top10-v2", title: "Growth top 10", tail: " (five profitability measures)",
      text: "Each week’s first ten against QQQ and SPY at 6 and 12 months." },
    { id: "momentum-12-1-top20-monthly-v1", title: "Momentum top 20", tail: ", month-end only",
      text: "12-1 month return, equal weight; nothing is published unless 8 of the first 12 cohorts beat QQQ, among other conditions." },
  ];
  function forwardWhen(track, monthly) {
    const lines = [];
    const unit = monthly ? "monthly" : "weekly";
    lines.push(track.cohorts
      ? `${track.cohorts} ${unit} cohort${track.cohorts === 1 ? "" : "s"} since ${dayText(track.first)}`
      : `First cohort: the ${dayText(track.next_record)} freeze`);
    const readout = track.readout_basis === "registered" ? dayYear(track.first_readout) : `~${monthText(track.first_readout)}`;
    lines.push(`First 6-month readout ${readout}`);
    if (track.earliest_decision) lines.push(`Decision ~${monthText(track.earliest_decision)} at the earliest`);
    return lines;
  }
  function renderForward(check) {
    const tracks = Object.fromEntries((check.forward_tests?.tracks || []).map((t) => [t.id, t]));
    const rows = [];
    for (const item of FORWARD) {
      const track = tracks[item.id];
      if (!track) continue;
      const row = el("div", "lc-ft");
      const what = el("span", "");
      what.append(el("b", "", item.title), document.createTextNode(item.tail));
      let text = item.text;
      const pair = item.pair && tracks[item.pair];
      if (pair && pair.cohorts !== track.cohorts) text += ` The challenger has ${pair.cohorts} cohort${pair.cohorts === 1 ? "" : "s"}.`;
      what.appendChild(el("small", "", text));
      const when = el("em", "");
      forwardWhen(track, item.id.includes("monthly")).forEach((line, i) => { if (i) when.appendChild(el("br")); when.appendChild(document.createTextNode(line)); });
      row.append(what, when);
      rows.push(row);
    }
    const retired = check.forward_tests?.retired || [];
    if (retired.length) {
      const row = el("div", "lc-ft lc-ft-retired");
      const what = el("span", "");
      what.appendChild(el("b", "", "Retired first versions"));
      const order = (id) => { const i = RETIRED.findIndex(([key]) => key === id); return i < 0 ? RETIRED.length : i; };
      const label = (id) => (RETIRED.find(([key]) => key === id) || [id, id])[1];
      const when = (t) => (!t.first ? "no cohorts" : t.first === t.latest ? dayText(t.first) : spanText(t.first, t.latest));
      const names = retired.slice().sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id))
        .map((t) => `${label(t.id)} (${when(t)})`);
      what.appendChild(el("small", "", `${names.join(", ")}: still observed, not used for decisions.`));
      const total = retired.reduce((n, t) => n + t.cohorts, 0);
      row.append(what, el("em", "", `${total} cohort${total === 1 ? "" : "s"}`));
      rows.push(row);
    }
    $("lc-forward").replaceChildren(...rows);
    const first = (check.forward_tests?.tracks || []).filter((t) => t.first_readout).sort((a, b) => a.first_readout.localeCompare(b.first_readout))[0];
    $("lc-forward-next").textContent = first
      ? `· first readout ${first.readout_basis === "registered" ? dayYear(first.first_readout) : `~${monthText(first.first_readout)}`}`
      : "";
  }

  function renderStrip(check) {
    const value = $("desk-shortlist-value"), decision = $("desk-decision"), clock = $("clock-decision");
    if (!value || !decision) return;
    if (!check) {
      value.textContent = "—";
      decision.textContent = "—";
      if (clock) clock.textContent = "—";
      return;
    }
    value.textContent = count(check.groups.shortlist.count);
    decision.textContent = weekdayText(check.decision_date);
    if (clock) clock.textContent = weekdayText(check.decision_date);
  }
  function render(check) {
    api.current = check;
    renderStrip(check);
    renderDates(check);
    renderPopulation(check);
    renderTiles(check);
    renderMix(check);
    renderTrend(check);
    renderChanges(check);
    renderResults(check);
    renderForward(check);
    $("lc-research-count").textContent = count(check.groups.shortlist.count);
    $("lc-status").hidden = true;
    $("lc-body").hidden = false;
    // The Overview's sector rank and the earnings Shortlist column read this file too.
    if (typeof globalThis.renderSectorRank === "function") globalThis.renderSectorRank();
    if (globalThis.TLEarnings && typeof globalThis.TLEarnings.refresh === "function") globalThis.TLEarnings.refresh();
  }
  function fail(message) {
    renderStrip(null);
    $("lc-status").textContent = message;
    $("lc-status").hidden = false;
    $("lc-body").hidden = true;
  }

  // The file must be this release's: the same run and Friday as share/release.json.
  function checkFile(check, release) {
    if (!check || check.schema !== SCHEMA || !check.groups || !check.sectors) return "The List check snapshot is in an unknown format.";
    if (release && (release.run_id !== check.desk_run_id || release.as_of !== check.as_of)) return "List check is awaiting the latest Friday refresh.";
    return "";
  }
  async function start() {
    try {
      const [response, releaseResponse] = await Promise.all([
        fetch("./list-check.json", { cache: "no-store" }), fetch("./release.json", { cache: "no-store" })]);
      if (!response.ok) throw new Error("The List check snapshot is unavailable.");
      const check = await response.json();
      const release = releaseResponse.ok ? await releaseResponse.json() : null;
      const problem = checkFile(check, release);
      if (problem) throw new Error(problem);
      render(check);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to load the List check.");
    }
  }

  const api = { current: null, render, fail, checkFile, sectorColumns, binClass, tiltOf, largestTilt, pct, spanText, forwardWhen };
  globalThis.TLListCheck = api;
  void start();
})();
