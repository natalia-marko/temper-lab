// The Watchlist page: names starred on any page, with facts from the latest
// Research snapshot (desk.json), earnings calendar, and 1-year technical timing
// indicators (50-day SMA, 100-day SMA, 14-day RSI, and MACD 12/26/9) from ticker-volume.json.
(function () {
  "use strict";
  const W = globalThis.TLWatch;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DEFAULT_OUTLOOK = ["MPC", "EOG", "HRMY", "EXEL", "EXPD"];
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

  // Compute 50-day SMA, 100-day SMA, 200-day SMA, 14-day RSI, and MACD on the full series,
  // then slice to the display window so every indicator is warmed up from the first displayed day.
  // horizon = "mid" (default): 50/200-day SMA regime + 100d support + MACD (19, 39, 9) (Appel mid-term)
  // horizon = "swing": 50/100-day SMA regime + MACD (12, 26, 9)
  function computeIndicators(allDays, rawCloses, warmup = 0, horizon = "mid") {
    if (!Array.isArray(allDays) || !Array.isArray(rawCloses) || allDays.length !== rawCloses.length || allDays.length < 30) {
      return null;
    }
    const isMid = horizon !== "swing";
    const slowPeriod = isMid ? 200 : 100;
    const macdFast = isMid ? 19 : 12;
    const macdSlow = isMid ? 39 : 26;
    const macdSig = 9;

    // Forward-fill isolated single-day gaps for indicator continuity while keeping rawCloses for validity checks.
    const closes = rawCloses.slice();
    for (let i = 1; i < closes.length; i++) {
      if (!(closes[i] > 0) && closes[i - 1] > 0) closes[i] = closes[i - 1];
    }
    const firstValid = closes.findIndex((v) => v > 0);
    if (firstValid < 0 || closes.length - firstValid < 25) return null;

    const n = closes.length;
    const sma50 = new Array(n).fill(null);
    const sma100 = new Array(n).fill(null);
    const sma200 = new Array(n).fill(null);
    const rsi14 = new Array(n).fill(null);
    const macd = new Array(n).fill(null);
    const signal = new Array(n).fill(null);
    const hist = new Array(n).fill(null);

    for (let i = firstValid; i < n; i++) {
      if (i - firstValid + 1 >= 50) {
        let sum50 = 0;
        for (let j = i - 49; j <= i; j++) sum50 += closes[j];
        sma50[i] = sum50 / 50;
      }
      if (i - firstValid + 1 >= 100) {
        let sum100 = 0;
        for (let j = i - 99; j <= i; j++) sum100 += closes[j];
        sma100[i] = sum100 / 100;
      }
      if (i - firstValid + 1 >= 200) {
        let sum200 = 0;
        for (let j = i - 199; j <= i; j++) sum200 += closes[j];
        sma200[i] = sum200 / 200;
      }
      if (i - firstValid >= 14) {
        let gains = 0;
        let losses = 0;
        for (let j = i - 13; j <= i; j++) {
          const diff = closes[j] - closes[j - 1];
          if (diff > 0) gains += diff;
          else if (diff < 0) losses -= diff;
        }
        const avgGain = gains / 14;
        const avgLoss = losses / 14;
        rsi14[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    }

    const kFast = 2 / (macdFast + 1);
    const kSlow = 2 / (macdSlow + 1);
    const kSig = 2 / (macdSig + 1);
    let emaFast = closes[firstValid];
    let emaSlow = closes[firstValid];
    let sigEma = 0;
    for (let i = firstValid; i < n; i++) {
      const c = closes[i];
      emaFast = i === firstValid ? c : c * kFast + emaFast * (1 - kFast);
      emaSlow = i === firstValid ? c : c * kSlow + emaSlow * (1 - kSlow);
      if (i - firstValid >= macdSlow - 1) {
        const m = emaFast - emaSlow;
        macd[i] = m;
        sigEma = i - firstValid === macdSlow - 1 ? m : m * kSig + sigEma * (1 - kSig);
        signal[i] = sigEma;
        hist[i] = m - sigEma;
      }
    }

    const start = Math.min(Math.max(warmup, firstValid), Math.max(0, n - 20));
    const dDays = allDays.slice(start);
    const dClose = closes.slice(start);
    const dSma50 = sma50.slice(start);
    const dSma100 = sma100.slice(start);
    const dSma200 = sma200.slice(start);
    const dSlowSma = (isMid && dSma200.some((v) => v !== null)) ? dSma200 : dSma100;
    const effectiveSlowPeriod = dSlowSma === dSma200 ? 200 : 100;
    const dRsi = rsi14.slice(start);
    const dMacd = macd.slice(start);
    const dSig = signal.slice(start);
    const dHist = hist.slice(start);
    const m = dDays.length;

    // Identify clean, non-overlapping Buy (▲) and Sell (▼) signals in the display window:
    // - RSI <= 30 oversold episode trough (▲) and RSI >= 70 overbought episode peak (▼)
    // - 50/slow SMA Golden Cross (▲) and Death Cross (▼)
    const buySignals = [];
    const sellSignals = [];
    let inOversold = false;
    let minIdx = -1;
    let inOverbought = false;
    let maxIdx = -1;

    for (let i = 0; i < m; i++) {
      const r = dRsi[i];
      if (r !== null && r <= 30) {
        if (!inOversold) {
          inOversold = true;
          minIdx = i;
        } else if (dClose[i] <= dClose[minIdx]) {
          minIdx = i;
        }
      } else if (inOversold) {
        buySignals.push({ index: minIdx, date: dDays[minIdx], price: dClose[minIdx], rsi: dRsi[minIdx], reason: `RSI oversold (${dRsi[minIdx].toFixed(1)})` });
        inOversold = false;
      }

      if (r !== null && r >= 70) {
        if (!inOverbought) {
          inOverbought = true;
          maxIdx = i;
        } else if (dClose[i] >= dClose[maxIdx]) {
          maxIdx = i;
        }
      } else if (inOverbought) {
        sellSignals.push({ index: maxIdx, date: dDays[maxIdx], price: dClose[maxIdx], rsi: dRsi[maxIdx], reason: `RSI overbought (${dRsi[maxIdx].toFixed(1)})` });
        inOverbought = false;
      }

      if (i > 0 && dSma50[i - 1] !== null && dSlowSma[i - 1] !== null && dSma50[i] !== null && dSlowSma[i] !== null) {
        if (dSma50[i - 1] <= dSlowSma[i - 1] && dSma50[i] > dSlowSma[i]) {
          buySignals.push({ index: i, date: dDays[i], price: dClose[i], rsi: dRsi[i], reason: `50/${effectiveSlowPeriod}d SMA Golden Cross` });
        } else if (dSma50[i - 1] >= dSlowSma[i - 1] && dSma50[i] < dSlowSma[i]) {
          sellSignals.push({ index: i, date: dDays[i], price: dClose[i], rsi: dRsi[i], reason: `50/${effectiveSlowPeriod}d SMA Death Cross` });
        }
      }
    }
    if (inOversold && minIdx >= 0) {
      buySignals.push({ index: minIdx, date: dDays[minIdx], price: dClose[minIdx], rsi: dRsi[minIdx], reason: `RSI oversold (${dRsi[minIdx].toFixed(1)})` });
    }
    if (inOverbought && maxIdx >= 0) {
      sellSignals.push({ index: maxIdx, date: dDays[maxIdx], price: dClose[maxIdx], rsi: dRsi[maxIdx], reason: `RSI overbought (${dRsi[maxIdx].toFixed(1)})` });
    }

    const rawMacdCrosses = [];
    for (let i = 1; i < m; i++) {
      if (dMacd[i - 1] !== null && dSig[i - 1] !== null && dMacd[i] !== null && dSig[i] !== null) {
        if (dMacd[i - 1] <= dSig[i - 1] && dMacd[i] > dSig[i]) {
          rawMacdCrosses.push({ index: i, date: dDays[i], kind: "buy", value: dMacd[i], label: "MACD Golden Cross" });
        } else if (dMacd[i - 1] >= dSig[i - 1] && dMacd[i] < dSig[i]) {
          rawMacdCrosses.push({ index: i, date: dDays[i], kind: "sell", value: dMacd[i], label: "MACD Bearish Cross" });
        }
      }
    }
    // Filter out 1-to-4 day micro-graze whipsaws so Golden/Bearish crossover markers never pile on top of each other.
    const macdCrosses = [];
    let k = 0;
    while (k < rawMacdCrosses.length) {
      const curr = rawMacdCrosses[k];
      const next = rawMacdCrosses[k + 1];
      if (
        macdCrosses.length > 0 &&
        next &&
        next.kind !== curr.kind &&
        next.index - curr.index <= 4 &&
        next.index < m - 5
      ) {
        // curr and next cancelled each other out within <= 4 days; skip both to preserve clean alternation
        k += 2;
        continue;
      }
      if (macdCrosses.length > 0 && macdCrosses[macdCrosses.length - 1].kind === curr.kind) {
        macdCrosses[macdCrosses.length - 1] = curr;
      } else {
        macdCrosses.push(curr);
      }
      k += 1;
    }

    const lastIdx = m - 1;
    const lastClose = dClose[lastIdx];
    const lastSma50 = dSma50[lastIdx];
    const lastSma100 = dSma100[lastIdx];
    const lastSma200 = dSma200[lastIdx];
    const lastSlowSma = dSlowSma[lastIdx];
    const lastRsi = dRsi[lastIdx];
    const lastMacd = dMacd[lastIdx];
    const lastSig = dSig[lastIdx];
    const lastHist = dHist[lastIdx];
    const vsSma50 = lastSma50 ? lastClose / lastSma50 - 1 : null;
    const sma50Vs100 = lastSma50 && lastSma100 ? lastSma50 / lastSma100 - 1 : null;
    const sma50Vs200 = lastSma50 && lastSma200 ? lastSma50 / lastSma200 - 1 : null;
    const sma50VsSlow = lastSma50 && lastSlowSma ? lastSma50 / lastSlowSma - 1 : null;
    const recentBuy = buySignals.length ? buySignals[buySignals.length - 1] : null;
    const recentSell = sellSignals.length ? sellSignals[sellSignals.length - 1] : null;
    const lastSignal = !recentBuy ? recentSell : !recentSell ? recentBuy
      : recentBuy.index >= recentSell.index ? { ...recentBuy, type: "buy" } : { ...recentSell, type: "sell" };
    if (lastSignal && !lastSignal.type) lastSignal.type = recentBuy ? "buy" : "sell";

    // Timing classification answering "Is it the right time to buy?"
    let setup = { tone: "caution", label: "Mixed / neutral", detail: "Inspect trend and RSI before entry." };
    const uptrend = sma50VsSlow !== null ? sma50VsSlow > 0 : (vsSma50 !== null && vsSma50 > 0);
    const recentOversold = recentBuy && (lastIdx - recentBuy.index <= 12);
    if (lastRsi !== null && lastRsi >= 70) {
      setup = {
        tone: "wait",
        label: "Overbought · wait for pullback",
        detail: `RSI (14) is ${lastRsi.toFixed(1)} (≥ 70 overbought). Trend is strong, but short-term entry is stretched.`,
      };
    } else if (uptrend && ((lastRsi !== null && lastRsi <= 40) || recentOversold)) {
      setup = {
        tone: "buy",
        label: "Pullback in uptrend · ▲ setup",
        detail: `50d SMA > ${effectiveSlowPeriod}d SMA with RSI (14) at ${lastRsi !== null ? lastRsi.toFixed(1) : "—"}${recentOversold ? ` (▲ ${recentBuy.reason} on ${shortDay(recentBuy.date)})` : ""}.`,
      };
    } else if (uptrend && lastClose >= (lastSma50 || 0)) {
      setup = {
        tone: "steady",
        label: "Steady uptrend · Golden Cross",
        detail: `Price above 50d & ${effectiveSlowPeriod}d SMA with neutral RSI (${lastRsi !== null ? lastRsi.toFixed(1) : "—"})${lastHist > 0 ? " and positive MACD momentum." : "."}`,
      };
    } else if (uptrend) {
      setup = {
        tone: "caution",
        label: `Testing ${effectiveSlowPeriod === 200 ? "100d/200d" : "100d"} SMA support`,
        detail: `Longer trend is positive (50d > ${effectiveSlowPeriod}d SMA), but price is ${signedPct(vsSma50)} below 50d SMA (RSI ${lastRsi !== null ? lastRsi.toFixed(1) : "—"}).`,
      };
    } else {
      setup = {
        tone: "wait",
        label: "Below trend · Death Cross",
        detail: `50d SMA is below ${effectiveSlowPeriod}d SMA (${signedPct(sma50VsSlow)}). Wait for trend repair or RSI ≤ 30 washout.`,
      };
    }

    return {
      horizon: isMid ? "mid" : "swing",
      slowPeriod: effectiveSlowPeriod,
      macdFast,
      macdSlow,
      macdSig,
      days: dDays,
      close: dClose,
      sma50: dSma50,
      sma100: dSma100,
      sma200: dSma200,
      slowSma: dSlowSma,
      rsi14: dRsi,
      macd: dMacd,
      signal: dSig,
      hist: dHist,
      buySignals,
      sellSignals,
      macdCrosses,
      last: {
        date: dDays[lastIdx],
        close: lastClose,
        sma50: lastSma50,
        sma100: lastSma100,
        sma200: lastSma200,
        slowSma: lastSlowSma,
        vsSma50,
        sma50Vs100,
        sma50Vs200,
        sma50VsSlow,
        rsi14: lastRsi,
        macd: lastMacd,
        signal: lastSig,
        hist: lastHist,
        lastSignal,
        lastMacdCross: macdCrosses.length ? macdCrosses[macdCrosses.length - 1] : null,
        setup,
      },
    };
  }

  let desk = {};
  let earnings = {};
  let volume = null;
  let outlookPicks = DEFAULT_OUTLOOK.slice();
  let bulkRows = []; // Keep bulk-unselected rows here so Select all can restore them this visit.
  let displayed = [];
  let activeTab = "saved";
  let activeSymbol = "";
  let oscMode = "both";
  let horizonMode = "mid";

  function seriesFor(symbol) {
    if (!volume) return null;
    if (volume.timing && volume.timing.closes && Array.isArray(volume.timing.closes[symbol])) {
      return computeIndicators(volume.timing.days, volume.timing.closes[symbol], volume.timing.warmup || 200, horizonMode);
    }
    if (volume.chart && volume.closes && Array.isArray(volume.closes[symbol])) {
      return computeIndicators(volume.chart.days, volume.closes[symbol], 0, horizonMode);
    }
    return null;
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

  // Draw the multi-panel Technical Analysis SVG (Price + 50/200 or 50/100 SMA + Buy/Sell triangles + RSI 14 + MACD).
  function drawTimingChart(symbol, ta) {
    const host = $("wl-timing-chart");
    if (!host) return;
    if (!ta) {
      host.replaceChildren(el("p", "wl-empty", `No daily price history available for ${symbol} in this snapshot.`));
      return;
    }

    const showRsi = oscMode === "both" || oscMode === "rsi";
    const showMacd = oscMode === "both" || oscMode === "macd";
    const isMid = ta.slowPeriod === 200;
    const macdTitle = `MACD (${ta.macdFast}, ${ta.macdSlow}, ${ta.macdSig})`;
    const W_SVG = 920;
    const L = 66;
    const R = 24;
    const PW = W_SVG - L - R;

    const P1_TOP = 30;
    const P1_H = 225;
    const P1_BOT = P1_TOP + P1_H;

    const GAP = 42;
    const RSI_H = 135;
    const MACD_H = 158;

    const P2_TOP = showRsi ? P1_BOT + GAP : P1_BOT;
    const P2_BOT = showRsi ? P2_TOP + RSI_H : P1_BOT;

    const P3_TOP = showMacd ? (showRsi ? P2_BOT + GAP : P1_BOT + GAP) : P2_BOT;
    const P3_BOT = showMacd ? P3_TOP + MACD_H : P2_BOT;

    const H_SVG = (showMacd ? P3_BOT : showRsi ? P2_BOT : P1_BOT) + 34;
    const n = ta.days.length;
    const x = (i) => L + (n > 1 ? (i / (n - 1)) * PW : PW / 2);

    const chart = svg("svg", {
      viewBox: `0 0 ${W_SVG} ${H_SVG}`,
      class: "wl-ta-svg",
      role: "img",
      tabindex: "0",
      "aria-label": `Technical Analysis for ${symbol}: 1-year close price, 50-day SMA, ${ta.slowPeriod}-day SMA, buy/sell signals${showRsi ? ", RSI (14)" : ""}${showMacd ? `, and ${macdTitle}` : ""}`,
    });

    // Helper for framed panel + title + y-label
    const drawFrame = (top, bottom, title, yLabel) => {
      svg("text", { x: L + PW / 2, y: top - 9, "text-anchor": "middle", fill: "#111827", "font-size": "13.5", "font-weight": "600" }, chart, title);
      svg("rect", { x: L, y: top, width: PW, height: bottom - top, fill: "#ffffff", stroke: "#374151", "stroke-width": "1" }, chart);
      if (yLabel) {
        const cy = (top + bottom) / 2;
        svg("text", { x: 18, y: cy, "text-anchor": "middle", fill: "#111827", "font-size": "11.5", transform: `rotate(-90 18 ${cy})` }, chart, yLabel);
      }
    };

    // --- PANEL 1: Price + 50-day SMA + 200-day (or 100-day) SMA + ▲ Buy / ▼ Sell Signals ---
    drawFrame(P1_TOP, P1_BOT, `Technical Analysis for ${symbol} (${isMid ? "Mid-term 50/200d SMA" : "Swing 50/100d SMA"})`, "Price (USD)");
    const priceVals = [...ta.close, ...ta.sma50, ...ta.sma100, ...(isMid ? ta.sma200 : [])].filter((v) => v !== null && Number.isFinite(v));
    const pMinRaw = Math.min(...priceVals);
    const pMaxRaw = Math.max(...priceVals);
    const pPad = (pMaxRaw - pMinRaw || pMaxRaw * 0.1 || 1) * 0.08;
    const pLo = pMinRaw - pPad;
    const pHi = pMaxRaw + pPad;
    const yPrice = (v) => P1_TOP + (1 - (v - pLo) / (pHi - pLo || 1)) * P1_H;

    // Price y-axis ticks (5 clean steps)
    const pRange = pHi - pLo;
    const rawStep = pRange / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const pStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => pRange / s <= 6) || rawStep;
    for (let tick = Math.ceil(pLo / pStep) * pStep; tick <= pHi - pStep * 0.1; tick += pStep) {
      const yy = yPrice(tick);
      svg("line", { x1: L, x2: L + PW, y1: yy, y2: yy, stroke: "#e5e7eb", "stroke-width": "0.8" }, chart);
      svg("line", { x1: L - 4, x2: L, y1: yy, y2: yy, stroke: "#374151", "stroke-width": "1" }, chart);
      svg("text", { x: L - 7, y: yy + 3.5, "text-anchor": "end", fill: "#1f2937", "font-size": "10.5" }, chart,
        pStep < 1 ? tick.toFixed(2) : Math.round(tick).toString());
    }

    const buildPath = (arr, yFn) => {
      let d = "";
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v !== null && Number.isFinite(v)) {
          d += `${d && arr[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${yFn(v).toFixed(1)}`;
        }
      }
      return d;
    };

    svg("path", { d: buildPath(ta.close, yPrice), fill: "none", stroke: "#1d4ed8", "stroke-width": "1.6" }, chart);
    svg("path", { d: buildPath(ta.sma50, yPrice), fill: "none", stroke: "#15803d", "stroke-width": "1.6" }, chart);
    if (isMid) {
      svg("path", { d: buildPath(ta.sma100, yPrice), fill: "none", stroke: "#d97706", "stroke-width": "1.2", "stroke-dasharray": "4,3" }, chart);
      svg("path", { d: buildPath(ta.sma200, yPrice), fill: "none", stroke: "#dc2626", "stroke-width": "1.7" }, chart);
    } else {
      svg("path", { d: buildPath(ta.sma100, yPrice), fill: "none", stroke: "#dc2626", "stroke-width": "1.6" }, chart);
    }

    const legLine = (g, rowIdx, color, dash, label) => {
      const yy = 14 + rowIdx * 16;
      svg("line", { x1: 8, x2: 28, y1: yy, y2: yy, stroke: color, "stroke-width": "1.8", "stroke-dasharray": dash || undefined }, g);
      svg("text", { x: 35, y: yy + 3.5, fill: "#1f2937", "font-size": "10.5" }, g, label);
    };

    // Panel 1 Legend Box (top-left, styled like matplotlib legend)
    const leg1 = svg("g", { transform: `translate(${L + 10}, ${P1_TOP + 10})` }, chart);
    if (isMid) {
      svg("rect", { x: 0, y: 0, width: 170, height: 104, rx: 3, fill: "#ffffff", "fill-opacity": "0.92", stroke: "#d1d5db", "stroke-width": "1" }, leg1);
      legLine(leg1, 0, "#1d4ed8", null, `${symbol} Close Price`);
      legLine(leg1, 1, "#15803d", null, "50-day SMA");
      legLine(leg1, 2, "#d97706", "4,3", "100-day SMA (support)");
      legLine(leg1, 3, "#dc2626", null, "200-day SMA (regime)");
      svg("polygon", { points: "18,73 12.5,84 23.5,84", fill: "#15803d" }, leg1);
      svg("text", { x: 35, y: 82, fill: "#1f2937", "font-size": "10.5" }, leg1, "Buy Signal");
      svg("polygon", { points: "18,100 12.5,89 23.5,89", fill: "#dc2626" }, leg1);
      svg("text", { x: 35, y: 98, fill: "#1f2937", "font-size": "10.5" }, leg1, "Sell Signal");
    } else {
      svg("rect", { x: 0, y: 0, width: 154, height: 88, rx: 3, fill: "#ffffff", "fill-opacity": "0.92", stroke: "#d1d5db", "stroke-width": "1" }, leg1);
      legLine(leg1, 0, "#1d4ed8", null, `${symbol} Close Price`);
      legLine(leg1, 1, "#15803d", null, "50-day SMA");
      legLine(leg1, 2, "#dc2626", null, "100-day SMA");
      svg("polygon", { points: "18,57 12.5,68 23.5,68", fill: "#15803d" }, leg1);
      svg("text", { x: 35, y: 66, fill: "#1f2937", "font-size": "10.5" }, leg1, "Buy Signal");
      svg("polygon", { points: "18,84 12.5,73 23.5,73", fill: "#dc2626" }, leg1);
      svg("text", { x: 35, y: 82, fill: "#1f2937", "font-size": "10.5" }, leg1, "Sell Signal");
    }

    // Draw ▲ Buy Signal and ▼ Sell Signal triangles on top of legend so none are hidden
    for (const sig of ta.buySignals) {
      const cx = x(sig.index);
      const cy = yPrice(sig.price);
      svg("polygon", {
        points: `${cx.toFixed(1)},${(cy - 7).toFixed(1)} ${(cx - 6.5).toFixed(1)},${(cy + 6).toFixed(1)} ${(cx + 6.5).toFixed(1)},${(cy + 6).toFixed(1)}`,
        fill: "#15803d",
        stroke: "#ffffff",
        "stroke-width": "1",
      }, chart);
    }
    for (const sig of ta.sellSignals) {
      const cx = x(sig.index);
      const cy = yPrice(sig.price);
      svg("polygon", {
        points: `${cx.toFixed(1)},${(cy + 7).toFixed(1)} ${(cx - 6.5).toFixed(1)},${(cy - 6).toFixed(1)} ${(cx + 6.5).toFixed(1)},${(cy - 6).toFixed(1)}`,
        fill: "#dc2626",
        stroke: "#ffffff",
        "stroke-width": "1",
      }, chart);
    }

    // --- PANEL 2: RSI (14) with 70 Overbought & 30 Oversold dashed lines ---
    if (showRsi) {
      drawFrame(P2_TOP, P2_BOT, `${symbol} RSI (14)`, "RSI");
      const yRsi = (v) => P2_TOP + (1 - v / 100) * RSI_H;
      for (const tick of [0, 20, 40, 60, 80, 100]) {
        const yy = yRsi(tick);
        svg("line", { x1: L, x2: L + PW, y1: yy, y2: yy, stroke: "#f3f4f6", "stroke-width": "0.8" }, chart);
        svg("line", { x1: L - 4, x2: L, y1: yy, y2: yy, stroke: "#374151", "stroke-width": "1" }, chart);
        svg("text", { x: L - 7, y: yy + 3.5, "text-anchor": "end", fill: "#1f2937", "font-size": "10.5" }, chart, String(tick));
      }
      // Overbought (70) and Oversold (30) dashed lines
      svg("line", { x1: L, x2: L + PW, y1: yRsi(70), y2: yRsi(70), stroke: "#dc2626", "stroke-width": "1.4", "stroke-dasharray": "5,4" }, chart);
      svg("line", { x1: L, x2: L + PW, y1: yRsi(30), y2: yRsi(30), stroke: "#15803d", "stroke-width": "1.4", "stroke-dasharray": "5,4" }, chart);
      svg("path", { d: buildPath(ta.rsi14, yRsi), fill: "none", stroke: "#7e22ce", "stroke-width": "1.6" }, chart);

      const leg2 = svg("g", { transform: `translate(${L + 10}, ${P2_TOP + 10})` }, chart);
      svg("rect", { x: 0, y: 0, width: 118, height: 54, rx: 3, fill: "#ffffff", "fill-opacity": "0.92", stroke: "#d1d5db", "stroke-width": "1" }, leg2);
      legLine(leg2, 0, "#7e22ce", null, "RSI (14)");
      legLine(leg2, 1, "#dc2626", "4,3", "Overbought");
      legLine(leg2, 2, "#15803d", "4,3", "Oversold");
    }

    // --- PANEL 3: MACD with high-visibility ▲ Golden / ▼ Bearish crossover badges & callouts ---
    if (showMacd) {
      drawFrame(P3_TOP, P3_BOT, `${symbol} ${macdTitle}`, "MACD");
      const mVals = [...ta.macd, ...ta.signal, ...ta.hist].filter((v) => v !== null && Number.isFinite(v));
      const mMax = Math.max(...mVals.map((v) => Math.abs(v)), 0.5) * 1.28;
      const yMacd = (v) => P3_TOP + (1 - (v + mMax) / (2 * mMax)) * MACD_H;
      const yZero = yMacd(0);

      for (const tick of [-mMax * 0.72, 0, mMax * 0.72]) {
        const yy = yMacd(tick);
        svg("line", { x1: L, x2: L + PW, y1: yy, y2: yy, stroke: tick === 0 ? "#9ca3af" : "#f3f4f6", "stroke-width": tick === 0 ? "1" : "0.8" }, chart);
        svg("line", { x1: L - 4, x2: L, y1: yy, y2: yy, stroke: "#374151", "stroke-width": "1" }, chart);
        svg("text", { x: L - 7, y: yy + 3.5, "text-anchor": "end", fill: "#1f2937", "font-size": "10.5" }, chart, tick === 0 ? "0" : tick.toFixed(1));
      }

      const barW = Math.max(1.2, (PW / n) * 0.65);
      for (let i = 0; i < n; i++) {
        const h = ta.hist[i];
        if (h === null || !Number.isFinite(h)) continue;
        const yy = yMacd(h);
        svg("rect", {
          x: (x(i) - barW / 2).toFixed(1),
          y: Math.min(yZero, yy).toFixed(1),
          width: barW.toFixed(1),
          height: Math.max(0.8, Math.abs(yy - yZero)).toFixed(1),
          fill: h >= 0 ? "#86efac" : "#fca5a5",
        }, chart);
      }

      // Vertical dashed guide lines at each MACD crossover so Golden/Bearish dates are easy to trace
      for (const cr of ta.macdCrosses) {
        const cx = x(cr.index);
        const isBuy = cr.kind === "buy";
        svg("line", {
          x1: cx.toFixed(1),
          x2: cx.toFixed(1),
          y1: (P3_TOP + 2).toFixed(1),
          y2: (P3_BOT - 2).toFixed(1),
          stroke: isBuy ? "#16a34a" : "#dc2626",
          "stroke-width": "1",
          "stroke-dasharray": "3,3",
          "stroke-opacity": "0.45",
        }, chart);
      }

      svg("path", { d: buildPath(ta.macd, yMacd), fill: "none", stroke: "#1d4ed8", "stroke-width": "1.6" }, chart);
      svg("path", { d: buildPath(ta.signal, yMacd), fill: "none", stroke: "#d97706", "stroke-width": "1.6" }, chart);

      // Place MACD legend where curve has the most room, and draw explicit Golden ▲ and Bearish ▼ badges
      const leg3 = svg("g", { transform: `translate(${L + 10}, ${P3_TOP + 8})` }, chart);
      svg("rect", { x: 0, y: 0, width: 162, height: 70, rx: 3, fill: "#ffffff", "fill-opacity": "0.92", stroke: "#d1d5db", "stroke-width": "1" }, leg3);
      legLine(leg3, 0, "#1d4ed8", null, `MACD (${ta.macdFast}, ${ta.macdSlow})`);
      legLine(leg3, 1, "#d97706", null, `Signal (${ta.macdSig})`);
      // Row 3: Golden Cross (buy) badge + ▲
      svg("circle", { cx: "18", cy: "46", r: "5.5", fill: "#15803d", stroke: "#ffffff", "stroke-width": "1.2" }, leg3);
      svg("polygon", { points: "18,42.5 14.8,48.2 21.2,48.2", fill: "#ffffff" }, leg3);
      svg("text", { x: 35, y: 49.5, fill: "#15803d", "font-size": "10.5", "font-weight": "600" }, leg3, "Golden Cross (buy)");
      // Row 4: Bearish Cross (sell) badge + ▼
      svg("circle", { cx: "18", cy: "61", r: "5.5", fill: "#dc2626", stroke: "#ffffff", "stroke-width": "1.2" }, leg3);
      svg("polygon", { points: "18,64.5 14.8,58.8 21.2,58.8", fill: "#ffffff" }, leg3);
      svg("text", { x: 35, y: 64.5, fill: "#b91c1c", "font-size": "10.5", "font-weight": "600" }, leg3, "Bearish Cross (sell)");

      // Draw prominent Golden Cross (green badge + ▲) and Bearish Cross (red badge + ▼) markers on top
      const lastBuyCross = [...ta.macdCrosses].reverse().find((c) => c.kind === "buy");
      const lastSellCross = [...ta.macdCrosses].reverse().find((c) => c.kind === "sell");
      for (const cr of ta.macdCrosses) {
        const cx = x(cr.index);
        const cy = yMacd(cr.value);
        const isBuy = cr.kind === "buy";
        const isLatest = cr === lastBuyCross || cr === lastSellCross;
        const rad = isLatest ? 7 : 5.8;
        // White outer halo + colored circle badge + crisp white triangle inside
        svg("circle", {
          cx: cx.toFixed(1),
          cy: cy.toFixed(1),
          r: (rad + 1.8).toFixed(1),
          fill: "#ffffff",
          "fill-opacity": "0.95",
        }, chart);
        svg("circle", {
          cx: cx.toFixed(1),
          cy: cy.toFixed(1),
          r: rad.toFixed(1),
          fill: isBuy ? "#15803d" : "#dc2626",
          stroke: isLatest ? (isBuy ? "#052e16" : "#450a0a") : "#ffffff",
          "stroke-width": isLatest ? "1.3" : "1",
        }, chart);
        if (isBuy) {
          svg("polygon", {
            points: `${cx.toFixed(1)},${(cy - 3.6).toFixed(1)} ${(cx - 3.3).toFixed(1)},${(cy + 2.4).toFixed(1)} ${(cx + 3.3).toFixed(1)},${(cy + 2.4).toFixed(1)}`,
            fill: "#ffffff",
          }, chart);
        } else {
          svg("polygon", {
            points: `${cx.toFixed(1)},${(cy + 3.6).toFixed(1)} ${(cx - 3.3).toFixed(1)},${(cy - 2.4).toFixed(1)} ${(cx + 3.3).toFixed(1)},${(cy - 2.4).toFixed(1)}`,
            fill: "#ffffff",
          }, chart);
        }

        // Direct on-chart callout pill for the latest Golden Cross and latest Bearish Cross
        if (isLatest) {
          const pillText = `${isBuy ? "▲ Golden" : "▼ Bearish"} · ${shortDay(cr.date)}`;
          const pillW = 94;
          const pillH = 17;
          const rawPx = cx - pillW / 2;
          const px = Math.max(L + 176, Math.min(L + PW - pillW - 4, rawPx));
          const placeAbove = isBuy ? cy > P3_TOP + 32 : cy > P3_BOT - 30;
          const py = placeAbove ? Math.max(P3_TOP + 4, cy - 26) : Math.min(P3_BOT - pillH - 4, cy + 10);
          svg("rect", {
            x: px.toFixed(1),
            y: py.toFixed(1),
            width: String(pillW),
            height: String(pillH),
            rx: "8.5",
            fill: isBuy ? "#dcfce7" : "#fee2e2",
            stroke: isBuy ? "#15803d" : "#dc2626",
            "stroke-width": "1.1",
          }, chart);
          svg("text", {
            x: (px + pillW / 2).toFixed(1),
            y: (py + 11.8).toFixed(1),
            "text-anchor": "middle",
            fill: isBuy ? "#14532d" : "#7f1d1d",
            "font-size": "10",
            "font-weight": "700",
          }, chart, pillText);
        }
      }
    }

    // --- Shared YYYY-MM X-axis ticks along the bottom panel ---
    const bottomY = showMacd ? P3_BOT : showRsi ? P2_BOT : P1_BOT;
    let lastLabelX = -100;
    for (let i = 0; i < n; i++) {
      const ym = ta.days[i].slice(0, 7);
      const prevYm = i > 0 ? ta.days[i - 1].slice(0, 7) : "";
      if (i > 0 && ym !== prevYm) {
        const xx = x(i);
        if (xx - lastLabelX >= 70 && xx <= L + PW - 25) {
          svg("line", { x1: xx, x2: xx, y1: P1_TOP, y2: P1_BOT, stroke: "#f3f4f6", "stroke-width": "0.8" }, chart);
          svg("line", { x1: xx, x2: xx, y1: bottomY, y2: bottomY + 5, stroke: "#374151", "stroke-width": "1" }, chart);
          svg("text", { x: xx, y: bottomY + 18, "text-anchor": "middle", fill: "#1f2937", "font-size": "11" }, chart, ym);
          lastLabelX = xx;
        }
      }
    }

    // Interactive hover / keyboard readout
    const cross = svg("line", { y1: P1_TOP, y2: bottomY, stroke: "#6b7280", "stroke-width": "1", "stroke-dasharray": "3,3", visibility: "hidden" }, chart);
    const dotP = svg("circle", { r: "4", fill: "#1d4ed8", stroke: "#fff", "stroke-width": "1.2", visibility: "hidden" }, chart);
    const tip = el("p", "wl-ta-tip");
    const formatReadout = (idx) => {
      const i = Math.max(0, Math.min(n - 1, idx));
      const d = ta.days[i];
      const sigHere = [
        ...ta.buySignals.filter((s) => s.index === i).map((s) => `▲ ${s.reason}`),
        ...ta.sellSignals.filter((s) => s.index === i).map((s) => `▼ ${s.reason}`),
        ...ta.macdCrosses.filter((s) => s.index === i).map((s) => (s.kind === "buy" ? `▲ ${s.label}` : `▼ ${s.label}`)),
      ];
      const partsText = [
        `${longDay(d)}: Close ${price(ta.close[i])}`,
        `50d SMA ${ta.sma50[i] !== null ? price(ta.sma50[i]) : "—"}`,
        `100d SMA ${ta.sma100[i] !== null ? price(ta.sma100[i]) : "—"}`,
        ...(ta.sma200[i] !== null ? [`200d SMA ${price(ta.sma200[i])}`] : []),
        `RSI (14) ${ta.rsi14[i] !== null ? ta.rsi14.toFixed(1) : "—"}`,
        `MACD (${ta.macdFast},${ta.macdSlow},${ta.macdSig}) ${ta.macd[i] !== null ? ta.macd[i].toFixed(2) : "—"} / Signal ${ta.signal[i] !== null ? ta.signal[i].toFixed(2) : "—"}`,
      ];
      if (sigHere.length) partsText.push(sigHere.join(" · "));
      tip.textContent = partsText.join(" · ");
      cross.setAttribute("x1", x(i).toFixed(1));
      cross.setAttribute("x2", x(i).toFixed(1));
      cross.setAttribute("visibility", "visible");
      dotP.setAttribute("cx", x(i).toFixed(1));
      dotP.setAttribute("cy", yPrice(ta.close[i]).toFixed(1));
      dotP.setAttribute("visibility", "visible");
    };
    formatReadout(n - 1);

    chart.addEventListener("pointermove", (e) => {
      if (!chart.getBoundingClientRect) return;
      const box = chart.getBoundingClientRect();
      if (!box.width) return;
      const relX = ((e.clientX - box.left) / box.width) * W_SVG;
      const idx = Math.round(((relX - L) / PW) * (n - 1));
      formatReadout(idx);
    });
    chart.addEventListener("pointerleave", () => {
      cross.setAttribute("visibility", "hidden");
      dotP.setAttribute("visibility", "hidden");
      formatReadout(n - 1);
    });

    host.replaceChildren(chart, tip);
  }

  function renderTiming(items) {
    const panel = $("wl-timing-panel");
    if (!panel) return;

    const isMid = horizonMode !== "swing";
    if ($("wl-timing-sub")) {
      $("wl-timing-sub").textContent = isMid
        ? "1-year mid-term technical setup (50-day & 200-day SMA with 100-day support, 14-day RSI oversold/overbought signals, and MACD 19/39/9 crossovers) from the Friday close."
        : "1-year swing technical setup (50-day & 100-day SMA, 14-day RSI oversold/overbought signals, and MACD 12/26/9 crossovers) from the Friday close.";
    }
    if ($("wl-th-trend")) $("wl-th-trend").textContent = isMid ? "50d vs 200d SMA" : "50d vs 100d SMA";
    if ($("wl-th-macd")) $("wl-th-macd").textContent = isMid ? "MACD (19,39,9)" : "MACD (12,26,9)";
    if ($("wl-timing-foot")) {
      $("wl-timing-foot").textContent = `Signals are historical rule readouts (▲ Buy Signal: RSI ≤ 30 oversold trough or 50/${isMid ? 200 : 100}-day SMA Golden Cross; ▼ Sell Signal: RSI ≥ 70 overbought peak or 50/${isMid ? 200 : 100}-day SMA Death Cross), not investment advice. Moving averages and oscillators use 200 prior sessions of warmup before the 252-session chart window.`;
    }

    const starredSyms = items.map((x) => x.symbol);
    const symbols = starredSyms.length ? starredSyms : outlookPicks.slice();
    if (!activeSymbol || !symbols.includes(activeSymbol)) {
      activeSymbol = symbols[0] || "MPC";
    }

    // 1. Render ticker selector pills
    const picksBar = $("wl-timing-picks");
    if (picksBar) {
      const nodes = [
        el("span", "wl-timing-picks-label", starredSyms.length ? "Your watchlist:" : "5 Outlook picks (star any ticker to customize):"),
      ];
      for (const sym of symbols) {
        const ta = seriesFor(sym);
        const tone = ta ? ta.last.setup.tone : "";
        const btn = el("button", `wl-pick-btn${sym === activeSymbol ? " on" : ""}`);
        btn.type = "button";
        btn.append(el("span", `wl-pick-dot ${tone}`), el("span", "", sym));
        btn.addEventListener("click", () => {
          activeSymbol = sym;
          renderTiming(W.list());
        });
        nodes.push(btn);
      }
      // If user has starred items, also offer quick pills for Outlook picks not yet starred
      if (starredSyms.length) {
        const extra = outlookPicks.filter((s) => !starredSyms.includes(s));
        if (extra.length) {
          nodes.push(el("span", "wl-timing-picks-label", "12M Outlook:"));
          for (const sym of extra) {
            const ta = seriesFor(sym);
            const tone = ta ? ta.last.setup.tone : "";
            const btn = el("button", `wl-pick-btn${sym === activeSymbol ? " on" : ""}`);
            btn.type = "button";
            btn.append(el("span", `wl-pick-dot ${tone}`), el("span", "", sym));
            if (sym === activeSymbol && !symbols.includes(sym)) symbols.push(sym);
            btn.addEventListener("click", () => {
              activeSymbol = sym;
              renderTiming(W.list());
            });
            nodes.push(btn);
          }
        }
      }
      picksBar.replaceChildren(...nodes);
    }

    // 2. Render summary cards for activeSymbol
    const summaryHost = $("wl-timing-summary");
    const activeTa = seriesFor(activeSymbol);
    const vRow = volume && volume.rows && volume.rows[activeSymbol];
    if (summaryHost) {
      if (!activeTa) {
        summaryHost.replaceChildren(el("div", "wl-stat-card", `Loading technical series for ${activeSymbol}…`));
      } else {
        const L = activeTa.last;
        const slowLbl = `${activeTa.slowPeriod}d SMA`;
        const c1 = el("div", "wl-stat-card");
        const badge = el("span", `wl-badge ${L.setup.tone}`, L.setup.label);
        c1.append(el("span", "", `${activeSymbol} · Timing verdict`), badge, el("small", "", L.setup.detail));

        const c2 = el("div", "wl-stat-card");
        const supportNote = activeTa.slowPeriod === 200 && L.sma100
          ? `50d ${price(L.sma50)} · 100d ${price(L.sma100)} · 200d ${price(L.sma200)} (${signedPct(L.sma50VsSlow)})`
          : `50d SMA ${price(L.sma50)} · ${slowLbl} ${price(L.slowSma)} (${signedPct(L.sma50VsSlow)})`;
        c2.append(
          el("span", "", `Price vs 50d & ${slowLbl}`),
          el("strong", "", `${price(L.close)} (${signedPct(L.vsSma50)} vs 50d)`),
          el("small", "", supportNote)
        );

        const c3 = el("div", "wl-stat-card");
        const rsiState = L.rsi14 >= 70 ? "Overbought (≥70)" : L.rsi14 <= 30 ? "Oversold (≤30)" : L.rsi14 <= 42 ? "Pullback zone" : "Neutral (30–70)";
        const sigNote = L.lastSignal
          ? `Last signal: ${L.lastSignal.type === "buy" ? "▲" : "▼"} ${L.lastSignal.reason} on ${shortDay(L.lastSignal.date)}`
          : "No extreme RSI or MA cross in 1Y";
        c3.append(
          el("span", "", "RSI (14) & signals"),
          el("strong", "", `${L.rsi14 !== null ? L.rsi14.toFixed(1) : "—"} · ${rsiState}`),
          el("small", "", sigNote)
        );

        const c4 = el("div", "wl-stat-card");
        const macdState = L.hist !== null ? (L.hist >= 0 ? "Bullish (MACD > Signal)" : "Bearish (MACD < Signal)") : "—";
        const crossNote = L.lastMacdCross
          ? `${L.lastMacdCross.kind === "buy" ? "▲" : "▼"} ${L.lastMacdCross.label} on ${shortDay(L.lastMacdCross.date)}`
          : "No recent MACD crossover";
        const nextEarn = resultsText(earnings[activeSymbol]);
        const upVol = vRow && Number.isFinite(vRow[4]) ? ` · 21d up-vol ${Math.round(vRow[4] * 100)}%` : "";
        c4.append(
          el("span", "", `MACD (${activeTa.macdFast}, ${activeTa.macdSlow}, ${activeTa.macdSig}) & events`),
          el("strong", "", macdState),
          el("small", "", `${crossNote} · Next results: ${nextEarn}${upVol}`)
        );

        summaryHost.replaceChildren(c1, c2, c3, c4);
      }
    }

    // 3. Draw SVG chart
    drawTimingChart(activeSymbol, activeTa);

    // 4. Render comparison table for all shown symbols
    const table = $("wl-timing-table");
    const tbody = $("wl-timing-rows");
    if (table && tbody) {
      const allSyms = [...new Set([...(starredSyms.length ? starredSyms : outlookPicks), activeSymbol])];
      table.hidden = allSyms.length === 0;
      const trs = allSyms.map((sym) => {
        const c = desk[sym] || {};
        const ta = seriesFor(sym);
        const tr = el("tr", sym === activeSymbol ? "on" : "");
        tr.addEventListener("click", () => {
          activeSymbol = sym;
          renderTiming(W.list());
        });
        const co = el("td");
        const st = el("strong", "", sym);
        co.append(st, el("small", "", c.name || ""));
        if (!ta) {
          tr.append(co, el("td", "", "—"), el("td", "num", price(c.price)), el("td", "num", "—"),
            el("td", "num", "—"), el("td", "num", "—"), el("td", "", "—"), el("td", "", "—"), el("td", "", resultsText(earnings[sym])));
          return tr;
        }
        const L = ta.last;
        const setupTd = el("td");
        setupTd.append(el("span", `wl-badge ${L.setup.tone}`, L.setup.label));
        const vs50Td = el("td", `num ${L.vsSma50 >= 0 ? "wl-pos" : "wl-neg"}`, signedPct(L.vsSma50));
        const vsSlowTd = el("td", `num ${L.sma50VsSlow >= 0 ? "wl-pos" : "wl-neg"}`, signedPct(L.sma50VsSlow));
        const rsiTd = el("td", `num ${L.rsi14 >= 70 ? "wl-neg" : L.rsi14 <= 35 ? "wl-pos" : ""}`, L.rsi14 !== null ? L.rsi14.toFixed(1) : "—");
        const macdTd = el("td", "", L.lastMacdCross ? `${L.lastMacdCross.kind === "buy" ? "▲" : "▼"} ${shortDay(L.lastMacdCross.date)} (${L.hist >= 0 ? "+" : ""}${L.hist.toFixed(2)})` : "—");
        const sigTd = el("td", "", L.lastSignal ? `${L.lastSignal.type === "buy" ? "▲" : "▼"} ${L.lastSignal.reason} (${shortDay(L.lastSignal.date)})` : "—");
        tr.append(co, setupTd, el("td", "num", price(L.close)), vs50Td, vsSlowTd, rsiTd, macdTd, sigTd, el("td", "", resultsText(earnings[sym])));
        return tr;
      });
      tbody.replaceChildren(...trs);
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
    renderTiming(items);
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
      if (onTiming) renderTiming(W.list());
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
    if ($("wl-horizon-switch") && $("wl-horizon-switch").querySelectorAll) {
      for (const btn of $("wl-horizon-switch").querySelectorAll("button[data-horizon]")) {
        btn.addEventListener("click", () => {
          horizonMode = btn.dataset.horizon || "mid";
          for (const b of $("wl-horizon-switch").querySelectorAll("button[data-horizon]")) {
            b.classList.toggle("on", b === btn);
          }
          renderTiming(W.list());
        });
      }
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
    Promise.all([get("./desk.json"), get("./earnings-calendar.json"), get("./ticker-volume.json"), get("./outlook.json")]).then(([deskData, calendar, volData, outlookData]) => {
      desk = (deskData && deskData.companies) || {};
      earnings = (calendar && calendar.companies) || {};
      volume = volData || null;
      if (outlookData && Array.isArray(outlookData.candidates) && outlookData.candidates.length) {
        outlookPicks = outlookData.candidates.map((c) => c.symbol).filter(Boolean);
      }
      const asOf = Object.values(desk).find((c) => c && c.price_date);
      $("wl-source").textContent = asOf ? `Price and market value: close on ${longDay(asOf.price_date)} (Research snapshot).` : "";
      render(W.list());
    });
  }
  globalThis.TLWatchTiming = { computeIndicators };
  if (W && $("wl-rows")) setup();
})();
