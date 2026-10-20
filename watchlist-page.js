// The Watchlist page: names starred on any page, with facts from the latest
// Research snapshot (desk.json) and the earnings calendar. The Timing tab draws one year of
// daily closes with the 50-day and 200-day averages, RSI (14, Wilder) and MACD (12, 26, 9) from
// ticker-timing.json, loaded only when that tab opens. Colour has one meaning on that tab: the three
// trend rules tested in Leg D (green all up, amber mixed, red all down). RSI and MACD are context.
// Descriptions of past prices, not calls.
(function () {
  "use strict";
  const W = globalThis.TLWatch;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const svg = (tag, attrs, parent, text) => {
    const node = document.createElementNS ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v !== undefined && v !== null) node.setAttribute(k, String(v));
    }
    if (text !== undefined) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  };

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parts = (iso) => String(iso || "").slice(0, 10).split("-").map(Number);
  const shortDay = (iso) => { const [, m, d] = parts(iso); return m && d ? `${d} ${MONTHS[m - 1]}` : "—"; };
  const longDay = (iso) => { const [y, m, d] = parts(iso); return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : "—"; };
  function money(value) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return "—";
    if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e11 ? 0 : 1)}B`;
    if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
    return `$${Math.round(v).toLocaleString("en-US")}`;
  }
  const price = (value) => (Number(value) > 0 ? `$${Number(value).toFixed(2)}` : "—");
  const signedPct = (value, digits = 1) => (Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%` : "—");
  function resultsText(next) {
    if (!next || !next.date) return "—";
    return `${shortDay(next.date)}${next.timing ? `, ${next.timing}` : ""}${next.unsure ? " (may change)" : ""}`;
  }

  // Indicators are computed on the whole series (warm-up included) and then cut to the chart
  // window, so a value on the first chart day already has its history behind it when the
  // stock has that much history. Standard definitions, no tuning:
  //   SMA 50 and 200 of the closes; trend = the 50-day against the 200-day (the usual
  //   golden/death-cross pair). One pair only: offering a second lets a reader pick the one
  //   that tells the story they want, and neither has been tested on Temper Lab data.
  //   RSI (14): Wilder's. The first averages are the simple mean of 14 daily changes; after that
  //   avg = (avg × 13 + today) / 14. Undefined while the price has not moved at all.
  //   MACD (12, 26, 9): EMA 12 − EMA 26 of the closes; signal = EMA 9 of MACD; histogram =
  //   MACD − signal. Each EMA starts from the simple mean of its first values.
  // Events are dated the day they happen, from that day's close, and never move afterwards.
  const RSI_N = 14;
  const MACD_FAST = 12;
  const MACD_SLOW = 26;
  const MACD_SIGNAL = 9;
  const RSI_HIGH = 70;
  const RSI_LOW = 30;
  function computeIndicators(allDays, rawCloses, warmup = 0) {
    if (!Array.isArray(allDays) || !Array.isArray(rawCloses) || allDays.length !== rawCloses.length || allDays.length < 30) {
      return null;
    }
    const slowPeriod = 200;
    // The builder keeps only series whose gaps are at most 5 sessions; a gap carries the last close.
    const closes = rawCloses.slice();
    for (let i = 1; i < closes.length; i++) {
      if (!(closes[i] > 0) && closes[i - 1] > 0) closes[i] = closes[i - 1];
    }
    const firstValid = closes.findIndex((v) => v > 0);
    if (firstValid < 0 || closes.length - firstValid < 25) return null;
    const n = closes.length;

    const sma = (period) => {
      const out = new Array(n).fill(null);
      for (let i = firstValid + period - 1; i < n; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += closes[j];
        out[i] = sum / period;
      }
      return out;
    };
    const ema = (src, period, from) => {
      const out = new Array(n).fill(null);
      if (n - from < period) return out;
      let value = 0;
      for (let j = from; j < from + period; j++) value += src[j];
      value /= period;
      out[from + period - 1] = value;
      const k = 2 / (period + 1);
      for (let i = from + period; i < n; i++) {
        value = src[i] * k + value * (1 - k);
        out[i] = value;
      }
      return out;
    };
    const sma50 = sma(50);
    const sma200 = sma(200);
    const slow = sma200;

    const rsi = new Array(n).fill(null);
    if (n - firstValid > RSI_N) {
      let gain = 0;
      let loss = 0;
      for (let j = firstValid + 1; j <= firstValid + RSI_N; j++) {
        const d = closes[j] - closes[j - 1];
        if (d > 0) gain += d;
        else loss -= d;
      }
      gain /= RSI_N;
      loss /= RSI_N;
      const value = () => (loss === 0 ? (gain === 0 ? null : 100) : 100 - 100 / (1 + gain / loss));
      rsi[firstValid + RSI_N] = value();
      for (let i = firstValid + RSI_N + 1; i < n; i++) {
        const d = closes[i] - closes[i - 1];
        gain = (gain * (RSI_N - 1) + Math.max(d, 0)) / RSI_N;
        loss = (loss * (RSI_N - 1) + Math.max(-d, 0)) / RSI_N;
        rsi[i] = value();
      }
    }

    const fast = ema(closes, MACD_FAST, firstValid);
    const slowEma = ema(closes, MACD_SLOW, firstValid);
    const macd = fast.map((v, i) => (v !== null && slowEma[i] !== null ? v - slowEma[i] : null));
    const macdFrom = firstValid + MACD_SLOW - 1;
    const signal = macdFrom < n ? ema(macd, MACD_SIGNAL, macdFrom) : new Array(n).fill(null);
    const hist = macd.map((v, i) => (v !== null && signal[i] !== null ? v - signal[i] : null));

    const start = Math.min(Math.max(warmup, firstValid), Math.max(0, n - 20));
    const cut = (arr) => arr.slice(start);
    const days = allDays.slice(start);

    // Events, each on the day of the close that produced it.
    const maEvents = [];
    const rsiEvents = [];
    const macdEvents = [];
    for (let i = Math.max(start, 1); i < n; i++) {
      const at = { index: i - start, date: allDays[i], price: closes[i] };
      if (sma50[i - 1] !== null && slow[i - 1] !== null && sma50[i] !== null && slow[i] !== null) {
        if (sma50[i - 1] <= slow[i - 1] && sma50[i] > slow[i]) maEvents.push({ ...at, kind: "up" });
        else if (sma50[i - 1] >= slow[i - 1] && sma50[i] < slow[i]) maEvents.push({ ...at, kind: "down" });
      }
      if (rsi[i - 1] !== null && rsi[i] !== null) {
        if (rsi[i - 1] < RSI_HIGH && rsi[i] >= RSI_HIGH) rsiEvents.push({ ...at, value: rsi[i], kind: "high" });
        else if (rsi[i - 1] > RSI_LOW && rsi[i] <= RSI_LOW) rsiEvents.push({ ...at, value: rsi[i], kind: "low" });
      }
      if (macd[i - 1] !== null && signal[i - 1] !== null && macd[i] !== null && signal[i] !== null) {
        if (macd[i - 1] <= signal[i - 1] && macd[i] > signal[i]) macdEvents.push({ ...at, value: macd[i], kind: "up" });
        else if (macd[i - 1] >= signal[i - 1] && macd[i] < signal[i]) macdEvents.push({ ...at, value: macd[i], kind: "down" });
      }
    }

    const last = n - 1;
    const ratio = (a, b) => (a !== null && b ? a / b - 1 : null);
    // The three trend rules tested in Leg D (claude/leg-d-trend-rules-2026-10-18.md), on the last close:
    //   A price above its 200-day SMA; B 12-1 month return above zero (the close 21 sessions back
    //   against the close 252 sessions back); C 50-day SMA above the 200-day SMA.
    // A rule is null while the history is too short for it.
    const mom121 = last - 252 >= firstValid ? closes[last - 21] / closes[last - 252] - 1 : null;
    const rules = {
      A: sma200[last] !== null ? closes[last] > sma200[last] : null,
      B: mom121 !== null ? mom121 > 0 : null,
      C: sma50[last] !== null && sma200[last] !== null ? sma50[last] > sma200[last] : null,
    };
    const known = Object.values(rules).filter((v) => v !== null);
    const rulesUp = known.filter(Boolean).length;
    const ruleTone = known.length < 3 ? "none" : rulesUp === 3 ? "up" : rulesUp === 0 ? "down" : "mixed";
    const lastOf = (list, kind) => [...list].reverse().find((e) => !kind || e.kind === kind) || null;
    return {
      slowPeriod,
      history: n - firstValid,
      slowFrom: firstValid + slowPeriod - 1 < n ? allDays[firstValid + slowPeriod - 1] : null,
      days,
      close: cut(closes),
      sma50: cut(sma50),
      sma200: cut(sma200),
      slow: cut(slow),
      rsi14: cut(rsi),
      macd: cut(macd),
      signal: cut(signal),
      hist: cut(hist),
      events: { ma: maEvents, rsi: rsiEvents, macd: macdEvents },
      last: {
        date: allDays[last],
        close: closes[last],
        sma50: sma50[last],
        sma200: sma200[last],
        slow: slow[last],
        vsSma50: ratio(closes[last], sma50[last]),
        vsSlow: ratio(closes[last], slow[last]),
        sma50VsSlow: ratio(sma50[last], slow[last]),
        trend: sma50[last] !== null && slow[last] !== null ? (sma50[last] > slow[last] ? "up" : sma50[last] < slow[last] ? "down" : "flat") : null,
        mom121,
        rules,
        rulesUp,
        ruleTone,
        rsi14: rsi[last],
        macd: macd[last],
        signal: signal[last],
        hist: hist[last],
        lastMa: lastOf(maEvents),
        lastRsiHigh: lastOf(rsiEvents, "high"),
        lastRsiLow: lastOf(rsiEvents, "low"),
        lastMacd: lastOf(macdEvents),
      },
    };
  }

  let desk = {};
  let earnings = {};
  let timing = null; // share/ticker-timing.json, loaded the first time the Timing tab opens
  let timingState = "idle"; // idle → loading → ready | failed
  // The Research Shortlist's first ten (desk.json), offered when nothing is starred.
  let shortlistPicks = [];
  let bulkRows = []; // Keep bulk-unselected rows here so Select all can restore them this visit.
  let displayed = [];
  let activeTab = "saved";
  let activeSymbol = "";
  let oscMode = "both";
  const computed = new Map();

  function seriesFor(symbol) {
    if (!timing || !timing.closes || !Array.isArray(timing.closes[symbol])) return null;
    if (!computed.has(symbol)) computed.set(symbol, computeIndicators(timing.days, timing.closes[symbol], timing.warmup || 200));
    return computed.get(symbol);
  }

  function loadTiming() {
    if (timingState !== "idle") return;
    timingState = "loading";
    fetch("./ticker-timing.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data) => {
        timing = data && data.schema === "ticker-timing-1" && Array.isArray(data.days) ? data : null;
        timingState = timing ? "ready" : "failed";
        computed.clear();
        if (activeTab === "timing") renderTiming(W.list());
      });
  }

  function row(item) {
    const c = desk[item.symbol] || {};
    const tr = el("tr");
    const star = el("td", "wl-star");
    star.append(W.button(item.symbol, item.name || c.name || ""));
    const co = el("td");
    const name = el("strong");
    const link = el("a", "", item.symbol);
    link.href = `./ticker.html?t=${encodeURIComponent(item.symbol)}`;
    name.append(link);
    co.append(name, el("small", "", c.name || item.name || "Not in this week's Research snapshot"));
    const from = W.PAGES[item.page];
    tr.append(star, co, el("td", "num", price(c.price)), el("td", "num", money(c.market_cap)),
      el("td", "", resultsText(earnings[item.symbol])), el("td", "", `${longDay(item.added)}${from ? ` · ${from}` : ""}`));
    return tr;
  }

  // Prices in ticker-timing.json carry four significant digits; show them that way, not as cents.
  function p4(value) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return "—";
    if (v >= 1000) return `$${Math.round(v).toLocaleString("en-US")}`;
    const decimals = Math.min(4, Math.max(0, 3 - Math.floor(Math.log10(v))));
    return `$${v.toFixed(decimals)}`;
  }
  // The close shown as a figure: the Research snapshot's traded close when there is one.
  const closeText = (symbol, ta) => (desk[symbol] && Number(desk[symbol].price) > 0 ? price(desk[symbol].price) : p4(ta.last.close));
  const trendText = (L, slow) => (L.trend === "up" ? `50-day above ${slow}-day` : L.trend === "down" ? `50-day below ${slow}-day`
    : L.trend === "flat" ? `50-day equal to ${slow}-day` : `${slow}-day not formed yet`);
  // A past event's date: the year is added when it differs from the snapshot's, so "7 Nov" from
  // last year cannot be read as next month.
  const eventDay = (iso) => (timing && timing.as_of && String(iso).slice(0, 4) !== String(timing.as_of).slice(0, 4) ? longDay(iso) : shortDay(iso));
  const rsiZone = (r) => (r === null ? "—" : r >= RSI_HIGH ? `${RSI_HIGH} or above` : r <= RSI_LOW ? `${RSI_LOW} or below` : `between ${RSI_LOW} and ${RSI_HIGH}`);
  // Trend rules: green = all three tested rules up, red = all three down, amber = they disagree,
  // grey = too little history for all three. The rules passed the same test on weekly and on month-end
  // closes (tools/leg_d_trend.py, tools/leg_d_trend_weekly.py), so the weekly badge is a tested signal.
  const RULE_NAMES = { A: "price above 200-day", B: "12–1 month return above zero", C: "50-day above 200-day" };
  const ruleBadge = (L) => (L.ruleTone === "up" ? "Uptrend · 3 of 3" : L.ruleTone === "down" ? "Downtrend · 0 of 3"
    : L.ruleTone === "mixed" ? `Mixed · ${L.rulesUp} of 3` : "Not enough history");
  const ruleList = (L) => Object.entries(RULE_NAMES)
    .map(([k, name]) => `${L.rules[k] === null ? "–" : L.rules[k] ? "✓" : "✗"} ${name}${k === "B" && L.mom121 !== null ? ` (${signedPct(L.mom121, 0)})` : ""}`)
    .join(" · ");
  // No 50/200 cross to name: say why, so a young listing is not read as a calm year.
  const noCross = (ta, slowP) => (ta.slowFrom && ta.days.length && ta.slowFrom > ta.days[0]
    ? `None since the ${slowP}-day began (${eventDay(ta.slowFrom)})` : "None in the chart year");
  const axisNumber = (v) => {
    const a = Math.abs(v);
    return v.toFixed(a >= 10 ? 0 : a >= 1 ? 1 : a >= 0.1 ? 2 : 3);
  };

  // Price with the 50-day and slow averages, RSI (14) and MACD (12, 26, 9), one shared date axis.
  // Legends sit above each panel, never on the data. The drawing is as wide as its box (340–920
  // units), so text keeps its size on a phone.
  function drawTimingChart(symbol, ta) {
    const host = $("wl-timing-chart");
    if (!host) return;
    if (!ta) {
      host.replaceChildren(el("p", "wl-empty", timingState === "ready"
        ? `No daily price history for ${symbol} in this snapshot.`
        : timingState === "failed" ? "The price history could not be loaded." : `Loading the price history for ${symbol}…`));
      return;
    }
    const showRsi = oscMode === "both" || oscMode === "rsi";
    const showMacd = oscMode === "both" || oscMode === "macd";
    const slowP = ta.slowPeriod;
    const W_SVG = host.clientWidth ? Math.max(340, Math.min(920, host.clientWidth - 40)) : 920;
    const narrow = W_SVG < 560;
    const L = narrow ? 46 : 66;
    const R = narrow ? 10 : 24;
    const PW = W_SVG - L - R;
    const n = ta.days.length;
    const x = (i) => L + (n > 1 ? (i / (n - 1)) * PW : PW / 2);
    const chart = svg("svg", {
      class: "wl-ta-svg",
      role: "img",
      tabindex: "0",
      "aria-label": `${symbol}: daily close with 50-day and ${slowP}-day averages${showRsi ? ", RSI (14)" : ""}${showMacd ? ", MACD (12, 26, 9)" : ""}, ${longDay(ta.days[0])} to ${longDay(ta.days[n - 1])}`,
    });

    let cursor = 0;
    const legendItem = (item, lx, ly) => {
      if (item.shape === "up" || item.shape === "down") {
        const pts = item.shape === "up" ? `${lx + 10},${ly - 6} ${lx + 4.5},${ly + 4} ${lx + 15.5},${ly + 4}` : `${lx + 10},${ly + 4} ${lx + 4.5},${ly - 6} ${lx + 15.5},${ly - 6}`;
        svg("polygon", { points: pts, fill: item.color }, chart);
      } else if (item.shape === "dot") {
        svg("circle", { cx: lx + 10, cy: ly - 1, r: 3.6, fill: item.color, stroke: "#ffffff", "stroke-width": "1" }, chart);
      } else if (item.shape === "ring") {
        svg("circle", { cx: lx + 10, cy: ly - 1, r: 3.4, fill: "#ffffff", stroke: item.color, "stroke-width": "1.5" }, chart);
      } else if (item.shape === "bar") {
        svg("rect", { x: lx + 5, y: ly - 6, width: 10, height: 9, fill: item.color }, chart);
      } else {
        svg("line", { x1: lx, x2: lx + 20, y1: ly - 1, y2: ly - 1, stroke: item.color, "stroke-width": "1.8", "stroke-dasharray": item.dash || undefined }, chart);
      }
      svg("text", { x: lx + 25, y: ly + 3, fill: "#1f2937", "font-size": "10.5" }, chart, item.label);
    };
    const panel = (title, items, height, yLabel) => {
      svg("text", { x: L, y: cursor + 13, fill: "#111827", "font-size": "13", "font-weight": "600" }, chart, title);
      let lx = L;
      let ly = cursor + 31;
      for (const item of items) {
        const w = 28 + item.label.length * 6;
        if (lx > L && lx + w > L + PW) {
          lx = L;
          ly += 15;
        }
        legendItem(item, lx, ly);
        lx += w + 10;
      }
      const top = ly + 10;
      const bottom = top + height;
      svg("rect", { x: L, y: top, width: PW, height, fill: "#ffffff", stroke: "#374151", "stroke-width": "1" }, chart);
      const cy = (top + bottom) / 2;
      svg("text", { x: 12, y: cy, "text-anchor": "middle", fill: "#111827", "font-size": "11", transform: `rotate(-90 12 ${cy})` }, chart, yLabel);
      cursor = bottom + 22;
      return { top, bottom };
    };
    const buildPath = (arr, yFn) => {
      let d = "";
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v !== null && Number.isFinite(v)) d += `${d && arr[i - 1] !== null && Number.isFinite(arr[i - 1]) ? "L" : "M"}${x(i).toFixed(1)},${yFn(v).toFixed(1)}`;
      }
      return d;
    };
    const vLine = (top, bottom, i, color) => svg("line", { x1: x(i).toFixed(1), x2: x(i).toFixed(1), y1: top + 1, y2: bottom - 1, stroke: color, "stroke-width": "1", "stroke-dasharray": "3,3", "stroke-opacity": "0.45" }, chart);

    // --- Price panel ---
    const priceItems = [
      { color: "#1d4ed8", label: `${symbol} close` },
      { color: "#15803d", label: "50-day average" },
      { color: "#dc2626", label: `${slowP}-day average` },
      { shape: "up", color: "#15803d", label: `50-day crossed above ${slowP}-day` },
      { shape: "down", color: "#dc2626", label: `50-day crossed below ${slowP}-day` },
    ];
    const p1 = panel(narrow ? `${symbol} · adjusted close` : `${symbol} · daily close, adjusted for splits and dividends`, priceItems, narrow ? 190 : 225, "Price (USD)");
    const priceVals = [...ta.close, ...ta.sma50, ...ta.slow].filter((v) => v !== null && Number.isFinite(v));
    const pMin = Math.min(...priceVals);
    const pMax = Math.max(...priceVals);
    const pPad = (pMax - pMin || pMax * 0.1 || 1) * 0.08;
    const pLo = pMin - pPad;
    const pHi = pMax + pPad;
    const yPrice = (v) => p1.top + (1 - (v - pLo) / (pHi - pLo || 1)) * (p1.bottom - p1.top);
    const pRange = pHi - pLo;
    const mag = Math.pow(10, Math.floor(Math.log10(pRange / 5 || 1)));
    const pStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => pRange / s <= 6) || pRange / 5;
    for (let tick = Math.ceil(pLo / pStep) * pStep; tick <= pHi - pStep * 0.1; tick += pStep) {
      const yy = yPrice(tick);
      svg("line", { x1: L, x2: L + PW, y1: yy, y2: yy, stroke: "#e5e7eb", "stroke-width": "0.8" }, chart);
      svg("text", { x: L - 6, y: yy + 3.5, "text-anchor": "end", fill: "#1f2937", "font-size": "10.5" }, chart, pStep < 1 ? tick.toFixed(2) : Math.round(tick).toString());
    }
    svg("path", { d: buildPath(ta.close, yPrice), fill: "none", stroke: "#1d4ed8", "stroke-width": "1.6" }, chart);
    svg("path", { d: buildPath(ta.sma50, yPrice), fill: "none", stroke: "#15803d", "stroke-width": "1.6" }, chart);
    svg("path", { d: buildPath(ta.slow, yPrice), fill: "none", stroke: "#dc2626", "stroke-width": "1.7" }, chart);
    for (const e of ta.events.ma) {
      const cx = x(e.index);
      const cy = yPrice(e.price);
      const pts = e.kind === "up"
        ? `${cx.toFixed(1)},${(cy - 8).toFixed(1)} ${(cx - 6.5).toFixed(1)},${(cy + 5).toFixed(1)} ${(cx + 6.5).toFixed(1)},${(cy + 5).toFixed(1)}`
        : `${cx.toFixed(1)},${(cy + 8).toFixed(1)} ${(cx - 6.5).toFixed(1)},${(cy - 5).toFixed(1)} ${(cx + 6.5).toFixed(1)},${(cy - 5).toFixed(1)}`;
      svg("polygon", { points: pts, fill: e.kind === "up" ? "#15803d" : "#dc2626", stroke: "#ffffff", "stroke-width": "1" }, chart);
    }

    // --- RSI panel ---
    let p2 = null;
    let yRsi = null;
    if (showRsi) {
      p2 = panel(`${symbol} · RSI (14, Wilder)`, [
        { color: "#7e22ce", label: "RSI (14)" },
        { color: "#6b7280", dash: "5,4", label: `${RSI_HIGH} and ${RSI_LOW} lines` },
        { shape: "dot", color: "#7e22ce", label: `first day at ${RSI_HIGH}+ or at ${RSI_LOW} or below` },
      ], narrow ? 120 : 135, "RSI");
      yRsi = (v) => p2.top + (1 - v / 100) * (p2.bottom - p2.top);
      for (const tick of [0, 30, 50, 70, 100]) {
        const yy = yRsi(tick);
        svg("line", { x1: L, x2: L + PW, y1: yy, y2: yy, stroke: tick === 30 || tick === 70 ? "#6b7280" : "#f3f4f6", "stroke-width": tick === 30 || tick === 70 ? "1.2" : "0.8", "stroke-dasharray": tick === 30 || tick === 70 ? "5,4" : undefined }, chart);
        svg("text", { x: L - 6, y: yy + 3.5, "text-anchor": "end", fill: "#1f2937", "font-size": "10.5" }, chart, String(tick));
      }
      svg("path", { d: buildPath(ta.rsi14, yRsi), fill: "none", stroke: "#7e22ce", "stroke-width": "1.6" }, chart);
      for (const e of ta.events.rsi) svg("circle", { cx: x(e.index).toFixed(1), cy: yRsi(e.value).toFixed(1), r: "3.6", fill: "#7e22ce", stroke: "#ffffff", "stroke-width": "1" }, chart);
    }

    // --- MACD panel ---
    let p3 = null;
    if (showMacd) {
      const latest = ta.last.lastMacd;
      const crossNote = latest ? ` · crossed ${latest.kind === "up" ? "above" : "below"} signal ${eventDay(latest.date)}` : "";
      p3 = panel(narrow ? `MACD (12, 26, 9)${crossNote.replace(" signal", "")}` : `${symbol} · MACD (12, 26, 9)${crossNote}`, [
        { color: "#1d4ed8", label: "MACD" },
        { color: "#d97706", label: "Signal" },
        { shape: "bar", color: "#9ca3af", label: "Histogram" },
        { shape: "dot", color: "#4b5563", label: "crossed above signal" },
        { shape: "ring", color: "#4b5563", label: "crossed below signal" },
      ], narrow ? 140 : 158, "MACD ($)");
      const mVals = [...ta.macd, ...ta.signal, ...ta.hist].filter((v) => v !== null && Number.isFinite(v)).map(Math.abs);
      const mMax = (Math.max(0, ...mVals) || 1) * 1.15;
      const yMacd = (v) => p3.top + (1 - (v + mMax) / (2 * mMax)) * (p3.bottom - p3.top);
      const yZero = yMacd(0);
      for (const tick of [-mMax * 0.75, 0, mMax * 0.75]) {
        const yy = yMacd(tick);
        svg("line", { x1: L, x2: L + PW, y1: yy, y2: yy, stroke: tick === 0 ? "#9ca3af" : "#f3f4f6", "stroke-width": tick === 0 ? "1" : "0.8" }, chart);
        svg("text", { x: L - 6, y: yy + 3.5, "text-anchor": "end", fill: "#1f2937", "font-size": "10.5" }, chart, tick === 0 ? "0" : axisNumber(tick));
      }
      const barW = Math.max(1, (PW / n) * 0.65);
      for (let i = 0; i < n; i++) {
        const h = ta.hist[i];
        if (h === null || !Number.isFinite(h)) continue;
        const yy = yMacd(h);
        svg("rect", { x: (x(i) - barW / 2).toFixed(1), y: Math.min(yZero, yy).toFixed(1), width: barW.toFixed(1), height: Math.max(0.6, Math.abs(yy - yZero)).toFixed(1), fill: h >= 0 ? "#9ca3af" : "#d1d5db" }, chart);
      }
      svg("path", { d: buildPath(ta.macd, yMacd), fill: "none", stroke: "#1d4ed8", "stroke-width": "1.6" }, chart);
      svg("path", { d: buildPath(ta.signal, yMacd), fill: "none", stroke: "#d97706", "stroke-width": "1.6" }, chart);
      for (const e of ta.events.macd) {
        svg("circle", { cx: x(e.index).toFixed(1), cy: yMacd(e.value).toFixed(1), r: "3.4", fill: e.kind === "up" ? "#4b5563" : "#ffffff", stroke: e.kind === "up" ? "#ffffff" : "#4b5563", "stroke-width": e.kind === "up" ? "1" : "1.5" }, chart);
      }
    }

    // --- Shared month axis along the bottom panel ---
    const bottomY = (p3 || p2 || p1).bottom;
    let lastLabelX = -100;
    for (let i = 1; i < n; i++) {
      const ym = ta.days[i].slice(0, 7);
      if (ym === ta.days[i - 1].slice(0, 7)) continue;
      const xx = x(i);
      if (xx - lastLabelX < (narrow ? 58 : 70) || xx > L + PW - 22) continue;
      for (const p of [p1, p2, p3]) if (p) svg("line", { x1: xx, x2: xx, y1: p.top, y2: p.bottom, stroke: "#f3f4f6", "stroke-width": "0.8" }, chart);
      svg("text", { x: xx, y: bottomY + 15, "text-anchor": "middle", fill: "#1f2937", "font-size": "10.5" }, chart, `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`);
      lastLabelX = xx;
    }
    for (const e of ta.events.ma) for (const p of [p2, p3]) if (p) vLine(p.top, p.bottom, e.index, e.kind === "up" ? "#15803d" : "#dc2626");
    const H_SVG = bottomY + 24;
    chart.setAttribute("viewBox", `0 0 ${W_SVG} ${H_SVG}`);

    // Hover / keyboard readout: that day's numbers and events.
    const cross = svg("line", { y1: p1.top, y2: bottomY, stroke: "#6b7280", "stroke-width": "1", "stroke-dasharray": "3,3", visibility: "hidden" }, chart);
    const dot = svg("circle", { r: "4", fill: "#1d4ed8", stroke: "#fff", "stroke-width": "1.2", visibility: "hidden" }, chart);
    const tip = el("p", "wl-ta-tip");
    const readout = (idx) => {
      const i = Math.max(0, Math.min(n - 1, idx));
      const happened = [
        ...ta.events.ma.filter((e) => e.index === i).map((e) => `50-day crossed ${e.kind === "up" ? "above" : "below"} ${slowP}-day`),
        ...ta.events.rsi.filter((e) => e.index === i).map((e) => (e.kind === "high" ? `RSI reached ${RSI_HIGH}` : `RSI fell to ${RSI_LOW}`)),
        ...ta.events.macd.filter((e) => e.index === i).map((e) => `MACD crossed ${e.kind === "up" ? "above" : "below"} signal`),
      ];
      const parts = [
        `${longDay(ta.days[i])}: close ${p4(ta.close[i])}`,
        `50-day ${p4(ta.sma50[i])}`,
        `${slowP}-day ${p4(ta.slow[i])}`,
        `RSI ${ta.rsi14[i] !== null ? ta.rsi14[i].toFixed(1) : "—"}`,
        `MACD ${ta.macd[i] !== null ? axisNumber(ta.macd[i]) : "—"} / signal ${ta.signal[i] !== null ? axisNumber(ta.signal[i]) : "—"}`,
        ...happened,
      ];
      tip.textContent = parts.join(" · ");
      cross.setAttribute("x1", x(i).toFixed(1));
      cross.setAttribute("x2", x(i).toFixed(1));
      cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i).toFixed(1));
      dot.setAttribute("cy", yPrice(ta.close[i]).toFixed(1));
      dot.setAttribute("visibility", "visible");
    };
    readout(n - 1);
    chart.addEventListener("pointermove", (e) => {
      if (!chart.getBoundingClientRect) return;
      const box = chart.getBoundingClientRect();
      if (!box.width) return;
      readout(Math.round(((((e.clientX - box.left) / box.width) * W_SVG - L) / PW) * (n - 1)));
    });
    chart.addEventListener("pointerleave", () => {
      cross.setAttribute("visibility", "hidden");
      dot.setAttribute("visibility", "hidden");
      readout(n - 1);
    });
    chart.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const now = Number(chart.dataset ? chart.dataset.at || n - 1 : n - 1);
      const next = Math.max(0, Math.min(n - 1, now + (e.key === "ArrowLeft" ? -1 : 1)));
      if (chart.dataset) chart.dataset.at = String(next);
      readout(next);
    });
    host.replaceChildren(chart, tip);
  }

  function renderTiming(items) {
    const panelEl = $("wl-timing-panel");
    if (!panelEl) return;
    const slowP = 200;
    if ($("wl-timing-sub")) {
      const asOf = timing && timing.as_of;
      $("wl-timing-sub").textContent = `${asOf ? `Close on ${longDay(asOf)} (the weekly snapshot)` : "Weekly snapshot"}. `
        + `Colour shows three trend rules tested on Temper Lab data: price vs ${slowP}-day, 12–1 month return, 50-day vs ${slowP}-day. `
        + `They passed the same test on weekly closes and on month-end closes. `
        + `RSI (14, Wilder) and MACD (12, 26, 9) are context. Descriptions of past prices, not a buy or sell call.`;
    }
    if ($("wl-th-trend")) $("wl-th-trend").textContent = "Trend rules (tested)";
    if ($("wl-th-gap")) $("wl-th-gap").textContent = `Gap, 50 vs ${slowP}`;
    if ($("wl-th-cross")) $("wl-th-cross").textContent = `Last 50/${slowP} cross`;
    if ($("wl-timing-foot")) {
      $("wl-timing-foot").textContent = `Trend rules: in a Leg D test of US stocks with $1B+ market value and $10M+ daily trading, signals on weekly closes and, separately, on month-end closes, entries Jun 2021 – Apr 2026, `
        + `stocks with each rule up beat those with it down by 3.0% to 3.6% over the next 6 months in both (size-neutral, before costs, survivors only, past results). `
        + `Green = all three up, amber = they disagree, red = all three down, grey = too little history. `
        + `How these are made: prices are Yahoo adjusted closes (splits and dividends), four significant digits, so past levels can sit below the prices traded then. `
        + `Averages are simple moving averages; ▲/▼ mark the day the 50-day crossed the ${slowP}-day. RSI is Wilder's 14-day RSI; dots mark the first day at ${RSI_HIGH} or above or at ${RSI_LOW} or below. `
        + `MACD is 12/26/9 on exponential averages, in dollars, so it cannot be compared across stocks; every crossover of the signal line is drawn. `
        + `Up to 200 sessions before the chart are used to start the averages; a younger listing starts later. RSI and MACD have not been tested on Temper Lab data. None of this is a buy or sell call.`;
    }

    const starredSyms = items.map((x) => x.symbol);
    const symbols = starredSyms.length ? starredSyms : shortlistPicks.slice();
    if (!activeSymbol || (!symbols.includes(activeSymbol) && !shortlistPicks.includes(activeSymbol))) activeSymbol = symbols[0] || "";
    const tone = (ta) => (!ta ? "" : ta.last.ruleTone);

    const picksBar = $("wl-timing-picks");
    if (picksBar) {
      const pick = (sym) => {
        const btn = el("button", `wl-pick-btn${sym === activeSymbol ? " on" : ""}`);
        btn.type = "button";
        btn.append(el("span", `wl-pick-dot ${tone(seriesFor(sym))}`), el("span", "", sym));
        btn.addEventListener("click", () => {
          activeSymbol = sym;
          renderTiming(W.list());
        });
        return btn;
      };
      const nodes = [el("span", "wl-timing-picks-label", starredSyms.length ? "Your watchlist:" : "Research Shortlist, first ten (star any ticker to add your own):"), ...symbols.map(pick)];
      if (starredSyms.length) {
        const extra = shortlistPicks.filter((s) => !starredSyms.includes(s));
        if (extra.length) nodes.push(el("span", "wl-timing-picks-label", "Research Shortlist:"), ...extra.map(pick));
      }
      picksBar.replaceChildren(...nodes);
    }

    const summary = $("wl-timing-summary");
    const activeTa = activeSymbol ? seriesFor(activeSymbol) : null;
    if (summary) {
      if (!activeTa) {
        summary.replaceChildren(el("div", "wl-stat-card", timingState === "ready" ? `No price history for ${activeSymbol} in this snapshot.`
          : timingState === "failed" ? "The price history could not be loaded." : "Loading the price history…"));
      } else {
        const L = activeTa.last;
        const card = (title, strong, small, badge) => {
          const c = el("div", "wl-stat-card");
          c.append(el("span", "", title));
          if (badge) c.append(el("span", `wl-badge ${badge}`, strong));
          else c.append(el("strong", "", strong));
          c.append(el("small", "", small));
          return c;
        };
        const since = L.lastMa
          ? `Since ${longDay(L.lastMa.date)}, when the 50-day crossed ${L.lastMa.kind === "up" ? "above" : "below"} the ${slowP}-day.`
          : L.trend ? `${noCross(activeTa, slowP).replace("None", "No cross")}.` : `${activeTa.history} sessions of history; the ${slowP}-day average needs ${slowP}.`;
        const levels = [`50-day ${p4(L.sma50)}`, `${slowP}-day ${p4(L.slow)}`];
        const rsiLast = [`last reached ${RSI_HIGH}: ${L.lastRsiHigh ? eventDay(L.lastRsiHigh.date) : "not in the chart year"}`,
          `last fell to ${RSI_LOW}: ${L.lastRsiLow ? eventDay(L.lastRsiLow.date) : "not in the chart year"}`];
        summary.replaceChildren(
          card("Trend rules (tested)", ruleBadge(L), `${ruleList(L)}.`, tone(activeTa)),
          card(`50-day vs ${slowP}-day`, trendText(L, slowP), `${since}${L.sma50VsSlow !== null ? ` Gap ${signedPct(L.sma50VsSlow)}.` : ""}`),
          card("Price vs averages", `${closeText(activeSymbol, activeTa)} · ${signedPct(L.vsSma50)} vs 50-day`, `${levels.join(" · ")} · price ${signedPct(L.vsSlow)} vs ${slowP}-day`),
          card("RSI (14, Wilder) · context", L.rsi14 !== null ? `${L.rsi14.toFixed(1)} · ${rsiZone(L.rsi14)}` : "—", `${rsiLast.join(" · ")}. Not tested as a timing signal.`),
          card("MACD (12, 26, 9) · context", L.hist === null ? "—" : L.hist >= 0 ? "MACD above signal" : "MACD below signal",
            `${L.lastMacd ? `Since the ${eventDay(L.lastMacd.date)} crossover. ` : ""}Not tested as a timing signal.`),
          card("Next results", resultsText(earnings[activeSymbol]), "Can move the price a lot in one day; not part of the trend rules."),
        );
      }
    }

    drawTimingChart(activeSymbol, activeTa);

    const table = $("wl-timing-table");
    const tbody = $("wl-timing-rows");
    if (table && tbody) {
      const names = Object.fromEntries(items.map((x) => [x.symbol, x.name || ""]));
      const all = [...new Set([...symbols, ...(activeSymbol ? [activeSymbol] : [])])];
      table.hidden = all.length === 0;
      tbody.replaceChildren(...all.map((sym) => {
        const c = desk[sym] || {};
        const ta = seriesFor(sym);
        const tr = el("tr", sym === activeSymbol ? "on" : "");
        tr.addEventListener("click", () => {
          activeSymbol = sym;
          renderTiming(W.list());
        });
        const co = el("td");
        co.append(el("strong", "", sym), el("small", "", c.name || names[sym] || ""));
        if (!ta) {
          tr.append(co, ...["—", price(c.price), "—", "—", "—", "—", "—", resultsText(earnings[sym])].map((t, i) => el("td", i >= 1 && i <= 4 ? "num" : "", t)));
          return tr;
        }
        const L = ta.last;
        const trend = el("td");
        const badge = el("span", `wl-badge ${tone(ta)}`, ruleBadge(L));
        badge.title = ruleList(L);
        trend.append(badge);
        const plain = (v) => el("td", "num", signedPct(v));
        tr.append(co, trend, el("td", "num", closeText(sym, ta)), plain(L.vsSma50), plain(L.sma50VsSlow),
          el("td", "num", L.rsi14 !== null ? L.rsi14.toFixed(1) : "—"),
          el("td", "", L.hist === null ? "—" : `${L.hist >= 0 ? "Above" : "Below"} signal${L.lastMacd ? ` since ${eventDay(L.lastMacd.date)}` : ""}`),
          el("td", "", L.lastMa ? `${L.lastMa.kind === "up" ? "▲ above" : "▼ below"} · ${eventDay(L.lastMa.date)}` : L.trend ? noCross(ta, slowP) : `${slowP}-day not formed`),
          el("td", "", resultsText(earnings[sym])));
        return tr;
      }));
    }
  }

  function render(items) {
    if (bulkRows.every((item) => W.has(item.symbol))) bulkRows = [];
    displayed = W.clean([...items, ...bulkRows]);
    const sorted = displayed.slice().sort((a, b) => b.added.localeCompare(a.added) || a.symbol.localeCompare(b.symbol));
    const allSelected = displayed.length > 0 && displayed.every((item) => W.has(item.symbol));
    $("wl-select-all").setAttribute("aria-pressed", allSelected ? "true" : "false");
    $("wl-select-all").setAttribute("aria-label", allSelected ? "Unselect all" : "Select all");
    $("wl-select-all").disabled = displayed.length === 0;
    $("wl-count").textContent = bulkRows.length ? `${items.length} of ${displayed.length} starred` : items.length ? `${items.length} ${items.length === 1 ? "company" : "companies"}` : "";
    $("wl-empty").hidden = displayed.length > 0;
    $("wl-table").hidden = displayed.length === 0;
    $("wl-export").disabled = items.length === 0;
    $("wl-storage").hidden = W.stored();
    $("wl-rows").replaceChildren(...sorted.map(row));
    if (activeTab === "timing") renderTiming(items);
  }
  const say = (text) => { $("wl-status").textContent = text; };

  function setTab(tab) {
    activeTab = tab === "timing" ? "timing" : "saved";
    const tabSaved = $("wl-tab-saved");
    const tabTiming = $("wl-tab-timing");
    const savedPanel = $("wl-saved-panel");
    const timingPanel = $("wl-timing-panel");
    if (tabSaved && tabTiming && savedPanel && timingPanel) {
      const onTiming = activeTab === "timing";
      tabSaved.classList.toggle("on", !onTiming);
      tabSaved.setAttribute("aria-selected", String(!onTiming));
      tabTiming.classList.toggle("on", onTiming);
      tabTiming.setAttribute("aria-selected", String(onTiming));
      savedPanel.hidden = onTiming;
      timingPanel.hidden = !onTiming;
      if (onTiming) {
        loadTiming();
        renderTiming(W.list());
      }
    }
  }

  function setup() {
    $("wl-select-all").addEventListener("click", () => {
      const selected = !displayed.every((item) => W.has(item.symbol));
      const targets = displayed.slice();
      if (!selected) bulkRows = targets;
      W.setSelected(targets, selected);
      say(selected ? "All shown companies are starred." : "All shown companies are unstarred. Press the box beside Company to restore them before leaving this page.");
    });
    $("wl-export").addEventListener("click", () => {
      W.exportFile();
      say("Saved a copy to your downloads.");
    });
    $("wl-import").addEventListener("change", async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        const added = W.importText(await file.text());
        say(added ? `Added ${added} ${added === 1 ? "company" : "companies"} from the file.` : "Every company in the file was already on your watchlist.");
      } catch (error) {
        say(`Could not read this file: ${error.message}.`);
      }
      event.target.value = "";
    });
    if ($("wl-tab-saved") && $("wl-tab-timing")) {
      $("wl-tab-saved").addEventListener("click", () => setTab("saved"));
      $("wl-tab-timing").addEventListener("click", () => setTab("timing"));
    }
    if ($("wl-osc-switch") && $("wl-osc-switch").querySelectorAll) {
      for (const btn of $("wl-osc-switch").querySelectorAll("button[data-osc]")) {
        btn.addEventListener("click", () => {
          oscMode = btn.dataset.osc || "both";
          for (const b of $("wl-osc-switch").querySelectorAll("button[data-osc]")) {
            b.classList.toggle("on", b === btn);
          }
          renderTiming(W.list());
        });
      }
    }
    if (globalThis.location && globalThis.location.hash === "#timing") {
      setTab("timing");
    }
    W.onChange(render);
    render(W.list());
    const get = (url) => fetch(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get("./desk.json"), get("./earnings-calendar.json")]).then(([deskData, calendar]) => {
      desk = (deskData && deskData.companies) || {};
      earnings = (calendar && calendar.companies) || {};
      const shortlist = deskData && deskData.setups && deskData.setups.composite && deskData.setups.composite.results;
      shortlistPicks = Array.isArray(shortlist) ? shortlist.slice(0, 10).map((row) => row.symbol).filter(Boolean) : [];
      const asOf = Object.values(desk).find((c) => c && c.price_date);
      $("wl-source").textContent = asOf ? `Price and market value: close on ${longDay(asOf.price_date)} (Research snapshot).` : "";
      render(W.list());
    });
  }
  globalThis.TLWatchTiming = { computeIndicators };
  if (W && $("wl-rows")) setup();
})();
