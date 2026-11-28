// The Watchlist page: names starred on any page. The Saved tab answers, per name, where it stands
// in Temper Lab this week: on which lists (desk.json), the three tested trend rules at the last
// month-end close (trend-rules.json, the only per-stock signal with a tested edge), a one-year line
// (ticker-sparks.json, every 5th close) with the 3- and 12-month returns, the next results date
// (earnings-calendar.json) and EPS revisions as untested context. Rows sort by next results; four
// counts on top say what needs a look.
// No purchase or "since starred" price: a reference price makes winners easier to sell and losers
// easier to hold (Frydman and Rangel 2014). The Timing tab draws one year of
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
  let deskLoaded = false;
  let deskRunId = null;
  let deskAsOf = null;
  let members = {}; // symbol -> { shortlist: rank, lists: ["Hot tape", ...] } from desk.json setups
  let sparks = null; // share/ticker-sparks.json: every 5th close of the year, for the Saved tab's lines
  let earnings = {};
  let insiders = {}; // share/watchlist-insiders.json (~140 KB companion to ownership-signals.json)
  let shortInterest = {}; // share/short-interest.json (~120 KB FINRA days to cover)
  let shortInterestDate = "";
  let shortlistAll = []; // full composite shortlist from desk.json for same-sector peer lookup
  let timing = null; // share/ticker-timing.json, loaded the first time the Timing tab opens
  let trend = null; // share/trend-rules.json: the tested rules at the last month-end close, same file as Research
  let timingState = "idle"; // idle → loading → ready | failed
  // The Research Shortlist's first ten (desk.json), offered when nothing is starred.
  let shortlistPicks = [];
  let shortlistRanks = {};
  let bulkRows = []; // Keep bulk-unselected rows here so Select all can restore them this visit.
  let displayed = [];
  let activeTab = "saved";
  let activeSymbol = "";
  let selectedSaved = "";
  const computed = new Map();
  const noteSubs = new Map();

  // Personal 1-line thesis notes (kept in this browser only, never sent anywhere).
  const NOTES_KEY = "temperlab.watchlist.notes.v1";
  let notesCache = null;
  function loadNotes() {
    if (notesCache) return notesCache;
    notesCache = {};
    try {
      const raw = globalThis.localStorage && globalThis.localStorage.getItem(NOTES_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string" && v.trim()) notesCache[k.toUpperCase()] = v.slice(0, 180);
        }
      }
    } catch {}
    return notesCache;
  }
  function saveNote(symbol, text) {
    const map = loadNotes();
    const clean = String(text || "").trim().slice(0, 180);
    if (clean) map[symbol] = clean;
    else delete map[symbol];
    try {
      if (globalThis.localStorage) globalThis.localStorage.setItem(NOTES_KEY, JSON.stringify(map));
    } catch {}
  }

  // Personal auto-checked "Wait for..." triggers (kept in this browser only, never sent anywhere).
  const TRIGGERS_KEY = "temperlab.watchlist.triggers.v1";
  const VALID_TRIGGERS = new Set(["none", "trend3", "shortlist", "after_earn", "price"]);
  let triggersCache = null;
  function loadTriggers() {
    if (triggersCache) return triggersCache;
    triggersCache = {};
    try {
      const raw = globalThis.localStorage && globalThis.localStorage.getItem(TRIGGERS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (v && typeof v === "object" && VALID_TRIGGERS.has(v.kind) && v.kind !== "none") {
            const target = Number(v.target);
            triggersCache[k.toUpperCase()] = v.kind === "price" && Number.isFinite(target) && target > 0
              ? { kind: "price", target }
              : v.kind !== "price" ? { kind: v.kind } : null;
            if (!triggersCache[k.toUpperCase()]) delete triggersCache[k.toUpperCase()];
          }
        }
      }
    } catch {}
    return triggersCache;
  }
  function saveTrigger(symbol, trig) {
    const map = loadTriggers();
    if (!trig || !VALID_TRIGGERS.has(trig.kind) || trig.kind === "none") {
      delete map[symbol];
    } else if (trig.kind === "price") {
      const t = Number(trig.target);
      if (Number.isFinite(t) && t > 0) map[symbol] = { kind: "price", target: t };
      else delete map[symbol];
    } else {
      map[symbol] = { kind: trig.kind };
    }
    try {
      if (globalThis.localStorage) globalThis.localStorage.setItem(TRIGGERS_KEY, JSON.stringify(map));
    } catch {}
  }
  function usdShort(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "—";
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
    return `$${Math.round(n)}`;
  }
  function medianOf(values) {
    const arr = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!arr.length) return null;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  }
  function evalTrigger(symbol, today) {
    const trig = loadTriggers()[symbol];
    if (!trig || trig.kind === "none") return null;
    const c = desk[symbol] || {};
    const T = savedRules(symbol);
    const m = members[symbol];
    const r = resultsFor(symbol, today);
    const px = Number(c.price);
    if (trig.kind === "trend3") {
      const met = Boolean(T && T.ruleTone === "up");
      return {
        met,
        label: met ? "✓ Met · Trend 3/3" : `Wait · Trend ${T ? `${T.rulesUp}/3` : "—"}`,
        detail: met ? "All 3 tested trend rules are up" : `Waiting for Trend → 3/3 (now ${T ? `${T.rulesUp} of 3` : "n/a"})`,
      };
    }
    if (trig.kind === "shortlist") {
      const met = Boolean(m && m.shortlist);
      return {
        met,
        label: met ? `✓ Met · Shortlist #${m.shortlist}` : "Wait · Shortlist",
        detail: met ? `On Research Shortlist #${m.shortlist}` : "Waiting for Research Shortlist entry",
      };
    }
    if (trig.kind === "after_earn") {
      const pending = Boolean(r && r.days >= 0);
      const met = !pending;
      return {
        met,
        label: met ? "✓ Met · Clear" : `Wait · After ${shortDay(r.date)}`,
        detail: met ? "No upcoming results date blocking" : `Waiting past ${shortDay(r.date)} results`,
      };
    }
    if (trig.kind === "price" && Number(trig.target) > 0) {
      const t = Number(trig.target);
      const met = px > 0 && px <= t;
      return {
        met,
        label: met ? `✓ Met · ≤ $${t}` : `Wait · ≤ $${t}`,
        detail: met ? `Closed ${price(px)} ≤ $${t}` : px > 0 ? `Closed ${price(px)} vs $${t}` : `Waiting for ≤ $${t}`,
      };
    }
    return null;
  }
  function autoTension(symbol, today) {
    const T = savedRules(symbol);
    const m = members[symbol];
    const o = insiders[symbol];
    const r = resultsFor(symbol, today);
    const inDesk = Boolean(desk[symbol]);
    if (deskLoaded && !inDesk) return null;
    const hasBuy = Boolean(o && (o.buy >= 50000 || o.ceo_buy));
    const hasSell = Boolean(o && o.off_sell > 0 && o.sell_no_plan >= 250000);
    if (hasBuy && (!T || T.ruleTone !== "up")) {
      return { cls: "ten-div", text: "Insiders vs tape", sub: `Buy ${usdShort(o.buy)}`, why: `${o.headline} while trend is ${ruleBadge(T)}` };
    }
    if (hasBuy) {
      return { cls: "ten-clean", text: "Insider buy · 3/3", sub: `Buy ${usdShort(o.buy)}`, why: `${o.headline} with all 3 trend rules up` };
    }
    if (hasSell && ((T && T.ruleTone === "up") || m)) {
      return { cls: "ten-warn", text: "Officer sell on list", sub: `No-plan ${usdShort(o.sell_no_plan)}`, why: `Officer sold ${usdShort(o.sell_no_plan)} (no 10b5-1)` };
    }
    if (T && T.ruleTone === "up" && m && !hasSell) {
      return { cls: "ten-clean", text: "All aligned", sub: r && r.days >= 0 ? `Results ${shortDay(r.date)}` : "Clean", why: "3/3 tested trend + on a Research list + no unscheduled officer sells" };
    }
    if (T && T.ruleTone === "down" && !m) {
      return { cls: "ten-break", text: "Broken · off list", sub: hasSell ? `No-plan ${usdShort(o.sell_no_plan)}` : "0/3 trend", why: "0/3 tested trend and not on any Research list this week" };
    }
    if (T && T.ruleTone === "down") {
      return { cls: "ten-break", text: "Trend 0/3", sub: "On list, broken trend", why: "Still on a Research list, but all 3 tested trend rules are down" };
    }
    if (hasSell) {
      return { cls: "ten-warn", text: "Unscheduled sell", sub: `No-plan ${usdShort(o.sell_no_plan)}`, why: `Officer sold ${usdShort(o.sell_no_plan)} (no 10b5-1)` };
    }
    return null;
  }
  function sectorPeer(symbol) {
    const sec = desk[symbol] && desk[symbol].sector;
    if (!sec || !shortlistAll.length) return null;
    for (const r of shortlistAll) {
      if (!r || r.symbol === symbol) continue;
      const c = desk[r.symbol];
      const T = savedRules(r.symbol);
      if (c && c.sector === sec && T && T.ruleTone === "up") {
        return { symbol: r.symbol, rank: r.rank, name: c.name || r.symbol };
      }
    }
    return null;
  }

  const SECTOR_LABELS = {
    technology: "Technology", healthcare: "Healthcare", health_care: "Healthcare", financials: "Financials",
    consumer_cyclical: "Consumer cyclical", consumer_defensive: "Consumer staples",
    industrials: "Industrials", energy: "Energy", basic_materials: "Basic materials", materials: "Basic materials",
    utilities: "Utilities", real_estate: "Real estate", communication: "Communication",
    unclassified: "Other",
  };
  const SECTOR_COLORS = {
    energy: "#b55d47", consumer_cyclical: "#c58b32", technology: "#3d6385",
    industrials: "#5b7d69", healthcare: "#2e7a57", health_care: "#2e7a57", financials: "#7b6c94",
    basic_materials: "#8f6f4c", materials: "#8f6f4c", consumer_defensive: "#6f8f7b", utilities: "#768995",
    real_estate: "#a37b63", communication: "#597594", unclassified: "#9aa89f",
  };
  const sectorLabel = (k) => SECTOR_LABELS[k] || (k ? String(k).replace(/_/g, " ") : "Other");
  const sectorColor = (k) => SECTOR_COLORS[k] || "#8a9990";

  // Accessible copy confirmation bubble outside button (opacity-only, repeated VoiceOver announcement).
  const copyTimers = new WeakMap();
  let lastCopyMsg = "";
  function reportCopy(button, ok, okText = "Copied") {
    if (!button) return;
    const tip = button.nextElementSibling;
    clearTimeout(copyTimers.get(button));
    if (button.removeAttribute) {
      button.removeAttribute("data-copied");
      button.removeAttribute("data-failed");
    }
    let msg = ok ? okText : "Copy failed";
    if (msg === lastCopyMsg) msg += "\u00A0";
    lastCopyMsg = msg;
    if (tip) tip.textContent = "";
    if (typeof button.offsetWidth === "number") void button.offsetWidth;
    if (button.setAttribute) button.setAttribute(ok ? "data-copied" : "data-failed", "");
    const write = () => { if (tip) tip.textContent = msg; };
    if (typeof globalThis.requestAnimationFrame === "function") globalThis.requestAnimationFrame(write);
    else write();
    if (typeof setTimeout === "function") {
      copyTimers.set(button, setTimeout(() => {
        if (button.removeAttribute) {
          button.removeAttribute("data-copied");
          button.removeAttribute("data-failed");
        }
        if (tip) tip.textContent = "";
      }, 2200));
    }
  }

  function seriesFor(symbol) {
    if (!timing || !timing.closes || !Array.isArray(timing.closes[symbol])) return null;
    if (!computed.has(symbol)) computed.set(symbol, computeIndicators(timing.days, timing.closes[symbol], timing.warmup || 200));
    return computed.get(symbol);
  }

  function loadTiming() {
    if (timingState !== "idle") return;
    timingState = "loading";
    const load = (file) => fetch(`./${file}`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    Promise.all([load("ticker-timing.json"), load("trend-rules.json")])
      .then(([data, rules]) => {
        timing = data && data.schema === "ticker-timing-1" && Array.isArray(data.days) ? data : null;
        trend = rules && rules.schema === "trend-rules-2" && rules.signal_date && rules.rules ? rules : null;
        timingState = timing ? "ready" : "failed";
        computed.clear();
        if (activeTab === "timing") renderTiming(W.list());
      });
  }

  // New York's date, as the earnings calendar uses: "today" for the reader is the market's day.
  const marketToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const daysUntil = (iso, today) => Math.round((Date.UTC(...parts(iso).map((v, i) => (i === 1 ? v - 1 : v)))
    - Date.UTC(...parts(today).map((v, i) => (i === 1 ? v - 1 : v)))) / 864e5);
  const SOON = 7; // days: results this close get the amber mark

  function resultsFor(symbol, today) {
    const next = earnings[symbol];
    if (!next || !next.date) return null;
    return { ...next, days: daysUntil(next.date, today) };
  }

  // One-year line: word-sized, one colour, the last close marked (Tufte's sparkline).
  function sparkline(symbol) {
    if (!sparks || !deskRunId || sparks.desk_run_id !== deskRunId) return null;
    const series = sparks.closes && sparks.closes[symbol];
    if (!Array.isArray(series)) return null;
    const pts = series.map((v, i) => [i, Number(v)]).filter(([, v]) => Number.isFinite(v) && v > 0);
    if (pts.length < 2) return null;
    const w = 96, h = 24, pad = 3;
    const lo = Math.min(...pts.map(([, v]) => v)), hi = Math.max(...pts.map(([, v]) => v));
    const x = (i) => pad + (i / (series.length - 1)) * (w - 2 * pad);
    const y = (v) => (hi > lo ? h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad) : h / 2);
    const node = svg("svg", { class: "wl-spark", viewBox: `0 0 ${w} ${h}`, width: w, height: h, "aria-hidden": "true" });
    svg("polyline", { points: pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" "), class: "wl-spark-line" }, node);
    const [li, lv] = pts[pts.length - 1];
    svg("circle", { cx: x(li).toFixed(1), cy: y(lv).toFixed(1), r: 2.2, class: "wl-spark-end" }, node);
    return node;
  }

  function row(item, today) {
    const c = desk[item.symbol] || {};
    const inDesk = Boolean(desk[item.symbol]);
    const r = resultsFor(item.symbol, today);
    const T = savedRules(item.symbol);
    const m = members[item.symbol];
    const o = insiders[item.symbol];
    const attn = Boolean((r && r.days >= 0 && r.days <= 14) || (T && T.ruleTone === "down") || (deskLoaded && inDesk && !m) || (o && o.off_sell > 0 && o.sell_no_plan >= 250000));
    const isSel = item.symbol === selectedSaved;
    const tr = el("tr", `${isSel ? "on" : ""}${attn ? " wl-attn" : ""}`.trim());
    tr.addEventListener("click", (event) => {
      const target = event && event.target;
      if (target && typeof target.closest === "function" && target.closest("button, a")) return;
      selectedSaved = isSel ? "" : item.symbol;
      render(W.list());
      const drawer = $("wl-inspector");
      if (selectedSaved && drawer && typeof drawer.scrollIntoView === "function") {
        drawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
    const star = el("td", "wl-star");
    star.append(W.button(item.symbol, item.name || c.name || ""));
    const co = el("td");
    const name = el("strong");
    const link = el("a", "", item.symbol);
    link.href = `./ticker.html?t=${encodeURIComponent(item.symbol)}`;
    name.append(link, el("span", "wl-caret", "▸"));
    const from = W.PAGES[item.page];
    const cap = money(c.market_cap);
    const fallbackSub = `Added ${longDay(item.added)}${from ? ` · ${from}` : ""}`;
    const savedNote = loadNotes()[item.symbol];
    const subEl = el("small", savedNote ? "wl-note-line" : "wl-meta-line", savedNote ? `“${savedNote}”` : fallbackSub);
    noteSubs.set(item.symbol, { node: subEl, fallback: fallbackSub });
    co.append(name, el("small", "", `${c.name || item.name || item.symbol}${cap !== "—" ? ` · ${cap}` : ""}`), subEl);

    // Where it stands in Temper Lab this week.
    const listCell = el("td", "wl-lists");
    if (deskLoaded && !inDesk) listCell.append(el("span", "wl-flag", "Not in the universe"));
    else if (m && (m.shortlist || m.lists.length)) {
      if (m.shortlist) listCell.append(el("span", "wl-chip sl", `Shortlist #${m.shortlist}`));
      for (const label of m.lists) listCell.append(el("span", "wl-chip", label));
    } else if (deskLoaded) listCell.append(el("span", "wl-flag", "On no list"));
    else listCell.append(el("span", "wl-quiet", "—"));

    // The tested signal, the same file and words as the Timing tab.
    const ruleCell = el("td", "wl-rules");
    ruleCell.title = ruleList(T);
    const dots = el("span", "wl-dots");
    for (const k of ["A", "B", "C"]) dots.append(el("i", `wl-dot ${!T || T.rules[k] === null ? "none" : T.rules[k] ? "on" : "off"}`));
    ruleCell.append(dots, el("span", `wl-badge ${T ? T.ruleTone : "none"}`, ruleBadge(T)));

    // One year of closes, with the two return windows used across the site.
    const yearCell = el("td", "wl-year");
    const line = sparkline(item.symbol);
    if (line) yearCell.append(line);
    const f = c.factors || {};
    yearCell.append(el("small", "", inDesk
      ? `3m ${signedPct(f.momentum_63, 0)} · 12m ${signedPct(f.momentum_252, 0)}`
      : "Not in this week's Research snapshot"));
    if (Number(c.price) > 0) yearCell.title = `${price(c.price)} at the ${longDay(c.price_date)} close`;

    // When the next results are: the sort key.
    const resCell = el("td", "wl-results");
    if (r) {
      resCell.append(el("span", r.days >= 0 && r.days <= SOON ? "wl-soon" : "", `${shortDay(r.date)}${r.timing ? `, ${r.timing}` : ""}`));
      const when = r.days === 0 ? "today" : r.days > 0 ? `in ${r.days} day${r.days === 1 ? "" : "s"}` : "date passed";
      resCell.append(el("small", "", `${when}${r.unsure ? " · may change" : ""}`));
    } else resCell.append(el("span", "wl-quiet", inDesk ? "No date in the calendar" : "—"));

    // Context, not tested on Temper Lab data.
    const rev = globalThis.TLTape ? globalThis.TLTape.revisionOf(f) : null;
    const revCell = el("td", "wl-quiet");
    revCell.textContent = rev && rev.state !== "missing" ? `${rev.up ?? 0}↑ ${rev.down ?? 0}↓` : "—";
    if (rev && rev.state !== "missing") revCell.title = `${rev.detail}. Context: not tested on Temper Lab data.`;

    // Zero-upkeep auto tension & notable insider activity (context, not tested).
    const sigCell = el("td", "wl-sig");
    const ten = autoTension(item.symbol, today);
    if (ten) {
      sigCell.append(el("span", `wl-ten-pill ${ten.cls}`, ten.text), el("span", "wl-sig-sub", ten.sub));
      sigCell.title = ten.why;
    } else sigCell.append(el("span", "wl-quiet", "—"));

    // Personal auto-checked "Wait for..." trigger.
    const trigCell = el("td", "wl-trig");
    const ev = evalTrigger(item.symbol, today);
    if (ev) {
      const p = el("span", ev.met ? "wl-zone-pill" : "wl-wait-pill", ev.label);
      p.title = ev.detail;
      trigCell.append(p);
    } else trigCell.append(el("span", "wl-quiet", "Set trigger…"));

    tr.append(star, co, listCell, ruleCell, yearCell, resCell, revCell, sigCell, trigCell);
    return tr;
  }

  // Upcoming results first (soonest on top), then dates already passed (latest first), then names with
  // no date, then names outside the universe.
  function sortRows(items, today) {
    const key = (item) => {
      if (deskLoaded && !desk[item.symbol]) return [4, 0];
      const r = resultsFor(item.symbol, today);
      if (!r) return [3, 0];
      return r.days >= 0 ? [1, r.days] : [2, -r.days];
    };
    return items.slice().sort((a, b) => {
      const [ga, va] = key(a), [gb, vb] = key(b);
      return ga - gb || va - vb || a.symbol.localeCompare(b.symbol);
    });
  }

  // Slim Pulse: Sector mix & Median 1Y max DD (left) + tiny clickable Next earnings column (right); 4 KPI tiles kept for ?mode=0.
  function renderSummary(items, today) {
    const box = $("wl-summary");
    const pulse = $("wl-pulse");
    const hidden = !deskLoaded || items.length === 0;
    if (pulse) pulse.hidden = hidden;
    if (box) {
      box.hidden = hidden;
      if (hidden) {
        box.replaceChildren();
      } else {
        const soon = items.filter((i) => { const r = resultsFor(i.symbol, today); return r && r.days >= 0 && r.days <= SOON; }).length;
        const ruled = items.map((i) => savedRules(i.symbol)).filter((T) => T && T.ruleTone !== "none");
        const allUp = ruled.filter((T) => T.ruleTone === "up").length;
        const inDesk = items.filter((i) => desk[i.symbol]);
        const noList = inDesk.filter((i) => !members[i.symbol]).length;
        const outside = items.length - inDesk.length;
        const tile = (label, value, flag) => {
          const zero = value === "0";
          const t = el("div", `wl-sum${flag ? " wl-sum-flag" : ""}${zero ? " wl-sum-zero" : ""}`);
          t.append(el("span", "", label), el("strong", "", value));
          return t;
        };
        box.replaceChildren(
          tile(`Report within ${SOON} days`, String(soon), soon > 0),
          tile("Up on all 3 trend rules", ruled.length ? `${allUp} of ${ruled.length}` : "—", false),
          tile("On no list this week", String(noList), noList > 0),
          tile("Not in the universe", String(outside), outside > 0));
      }
    }
    if (hidden) return;

    // Sector mix & risk (concentration + Median 1Y max DD)
    const secBar = $("wl-sector-bar");
    const secLeg = $("wl-sector-leg");
    const secWarn = $("wl-sector-warn");
    if (secBar && secLeg) {
      const counts = new Map();
      for (const it of items) {
        const key = (desk[it.symbol] && desk[it.symbol].sector) || "unclassified";
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const list = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      secBar.replaceChildren(...list.map(([key, n]) => {
        const seg = el("i");
        if (seg.style) { seg.style.flex = String(n); seg.style.background = sectorColor(key); }
        seg.title = `${sectorLabel(key)}: ${n} of ${items.length}`;
        return seg;
      }));
      secLeg.replaceChildren(...list.slice(0, 4).map(([key, n]) => {
        const sp = el("span");
        const dot = el("i", "wl-sec-dot");
        if (dot.style) dot.style.background = sectorColor(key);
        sp.append(dot, el("span", "", `${sectorLabel(key)} ${n}/${items.length}`));
        return sp;
      }));
      if (secWarn) {
        const top = list[0];
        const share = top ? Math.round((top[1] / items.length) * 100) : 0;
        const medDd = medianOf(items.map((it) => desk[it.symbol] && desk[it.symbol].factors && desk[it.symbol].factors.max_drawdown_252));
        const bits = [];
        if (top && items.length >= 3 && share >= 40) bits.push(`${share}% in ${sectorLabel(top[0])}`);
        if (medDd !== null) bits.push(`Median 1Y max DD ${signedPct(medDd, 0)}`);
        secWarn.textContent = bits.join(" · ");
      }
    }

    // Tiny clickable Next earnings column
    const nextBox = $("wl-next-earn");
    if (nextBox) {
      const upcoming = items
        .map((it) => { const r = resultsFor(it.symbol, today); return r && r.days >= 0 ? { sym: it.symbol, ...r } : null; })
        .filter(Boolean)
        .sort((a, b) => a.days - b.days);
      const head = el("div", "wl-earn-head");
      head.append(el("span", "wl-sector-k", "Next earnings"),
        el("span", "wl-earn-cnt", upcoming.length ? `${upcoming.length} scheduled` : ""));
      if (!upcoming.length) {
        nextBox.replaceChildren(head, el("div", "wl-earn-none", "None in calendar"));
      } else {
        const rowsEl = el("div", "wl-earn-list");
        for (const u of upcoming.slice(0, 2)) {
          const btn = el("button", `wl-earn-row${u.days <= SOON ? " soon" : ""}${u.sym === selectedSaved ? " on" : ""}`);
          btn.type = "button";
          btn.append(
            el("strong", "", u.sym),
            el("span", "", `${shortDay(u.date)}${u.timing ? ` · ${u.timing}` : ""}`),
            el("small", "", u.days === 0 ? "today" : `in ${u.days}d`),
          );
          btn.addEventListener("click", () => {
            selectedSaved = u.sym;
            render(W.list());
            const drawer = $("wl-inspector");
            if (drawer && typeof drawer.scrollIntoView === "function") drawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
          rowsEl.append(btn);
        }
        nextBox.replaceChildren(head, rowsEl);
      }
    }
  }

  // Full-Width Expandable 3-Column Ticker Card (opens under the list when a row is clicked; zero Timing fetch on Saved!)
  function renderInspector(sorted, today) {
    const drawer = $("wl-inspector");
    const hint = $("wl-drawer-hint");
    if (!drawer) return;
    const hasRows = sorted.length > 0;
    const isOpen = hasRows && Boolean(selectedSaved) && sorted.some((it) => it.symbol === selectedSaved);
    if (hint) hint.hidden = !hasRows || isOpen;
    drawer.hidden = !isOpen;
    if (!isOpen) { drawer.replaceChildren(); return; }

    const sym = selectedSaved;
    const c = desk[sym] || {};
    const f = c.factors || {};
    const T = savedRules(sym);
    const r = resultsFor(sym, today);
    const m = members[sym];
    const o = insiders[sym];
    const si = shortInterest[sym];
    const inDesk = Boolean(desk[sym]);

    // Card header bar
    const head = el("div", "wl-drawer-head");
    const idWrap = el("div", "wl-drawer-id");
    const symA = el("a", "wl-ins-sym", sym);
    symA.href = `./ticker.html?t=${encodeURIComponent(sym)}`;
    idWrap.append(
      symA,
      el("span", "wl-ins-px", price(c.price)),
      el("span", "wl-ins-sub", `${c.name || sym}${c.sector ? ` · ${sectorLabel(c.sector)}` : ""}`),
      el("span", `wl-badge ${T ? T.ruleTone : "none"}`, ruleBadge(T)),
    );
    if (m && (m.shortlist || m.lists.length)) {
      if (m.shortlist) idWrap.append(el("span", "wl-chip sl", `Shortlist #${m.shortlist}`));
      for (const label of m.lists.slice(0, 2)) idWrap.append(el("span", "wl-chip", label));
    } else if (deskLoaded && inDesk) {
      idWrap.append(el("span", "wl-flag", "On no list"));
    }

    const actions = el("div", "wl-drawer-actions");
    const timingBtn = el("button", "wl-btn-primary", "Full Timing chart →");
    timingBtn.type = "button";
    timingBtn.addEventListener("click", () => {
      activeSymbol = sym;
      setTab("timing");
    });
    const dossierLink = el("a", "wl-btn-ghost", "Ticker dossier");
    dossierLink.href = `./ticker.html?t=${encodeURIComponent(sym)}`;
    const closeBtn = el("button", "wl-drawer-close", "× Close");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", () => {
      selectedSaved = "";
      render(W.list());
    });
    actions.append(timingBtn, dossierLink, closeBtn);
    head.append(idWrap, actions);

    const blocks = [head];
    if (deskLoaded && !inDesk) {
      blocks.push(el("p", "wl-ins-out", "Not in this week’s Temper Lab universe — tracked by symbol, personal trigger, and thesis note only."));
    }

    // 3-Column Horizontal Grid
    const grid = el("div", "wl-drawer-grid");

    // Col 1: 1Y Sparkline + Street Target Gauge
    const col1 = el("div", "wl-drawer-col");
    if (sparks && deskRunId && sparks.desk_run_id === deskRunId && Array.isArray(sparks.closes && sparks.closes[sym])) {
      const series = sparks.closes[sym];
      const pts = series.map((v, i) => [i, Number(v)]).filter(([, v]) => Number.isFinite(v) && v > 0);
      if (pts.length >= 2) {
        const sbox = el("div", "wl-ins-spark-box");
        const sh = el("div", "wl-ins-spark-head");
        const riskBits = [];
        if (Number.isFinite(f.below_high_252)) riskBits.push(`${signedPct(f.below_high_252, 0)} vs high`);
        if (Number.isFinite(f.max_drawdown_252)) riskBits.push(`Max DD ${signedPct(f.max_drawdown_252, 0)}`);
        sh.append(el("span", "wl-ins-spark-title", `1Y path ${signedPct(f.momentum_252, 0)}`),
          el("span", "", riskBits.join(" · ")));
        const w = 320, h = 52, pad = 4;
        const lo = Math.min(...pts.map(([, v]) => v)), hi = Math.max(...pts.map(([, v]) => v));
        const x = (i) => pad + (i / (series.length - 1)) * (w - 2 * pad);
        const y = (v) => (hi > lo ? h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad) : h / 2);
        const s = svg("svg", { class: "wl-ins-spark-svg", viewBox: `0 0 ${w} ${h}`, "aria-hidden": "true" });
        const [fi, fv] = pts[0];
        const yStart = y(fv);
        svg("line", { x1: pad, x2: w - pad, y1: yStart.toFixed(1), y2: yStart.toFixed(1), stroke: "#d9e2dc", "stroke-width": "1", "stroke-dasharray": "3,3" }, s);
        const dPts = pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
        const [li, lv] = pts[pts.length - 1];
        const areaPts = `${x(fi).toFixed(1)},${(h - pad).toFixed(1)} ${dPts} ${x(li).toFixed(1)},${(h - pad).toFixed(1)}`;
        svg("polygon", { points: areaPts, fill: "#24342d", "fill-opacity": "0.05" }, s);
        svg("polyline", { points: dPts, fill: "none", stroke: "#24342d", "stroke-width": "1.75", "stroke-linejoin": "round" }, s);
        svg("circle", { cx: x(li).toFixed(1), cy: y(lv).toFixed(1), r: "3", fill: "#1e6547", stroke: "#fff", "stroke-width": "1.2" }, s);
        sbox.append(sh, s);
        col1.append(sbox);
      }
    }
    const tLow = Number(f.target_low), tMed = Number(f.target_median), tHigh = Number(f.target_high), pxVal = Number(c.price);
    const nAnalysts = Number(f.analyst_total);
    const coverageOk = !Number.isFinite(nAnalysts) || nAnalysts === 0 || nAnalysts >= 3;
    if (coverageOk && Number.isFinite(tLow) && Number.isFinite(tMed) && Number.isFinite(tHigh) && tLow > 0 && tHigh > tLow && pxVal > 0) {
      const lo = Math.min(tLow, pxVal), hi = Math.max(tHigh, pxVal), span = hi - lo || 1;
      const pos = (v) => `${Math.max(2, Math.min(98, ((v - lo) / span) * 100)).toFixed(1)}%`;
      const upside = tMed / pxVal - 1;
      const tbar = el("div", "wl-tbar");
      const tHead = el("div", "wl-tbar-head");
      const tLeg = el("span", "wl-tbar-leg");
      tLeg.append(el("i", "wl-tleg-dot close"), el("span", "", "Close"), el("i", "wl-tleg-dot med"), el("span", "", "Median"));
      tHead.append(
        el("span", "", `Street targets${Number.isFinite(nAnalysts) && nAnalysts >= 3 ? ` (${Math.round(nAnalysts)} analysts, opinion)` : " (opinion)"}`),
        tLeg,
      );
      tbar.append(tHead, el("div", "wl-tbar-nums", `Low ${price(tLow)} · Med ${price(tMed)} (${signedPct(upside, 0)}) · High ${price(tHigh)}`));
      const trk = el("div", "wl-ttrack");
      const medMark = el("i", "wl-tmark med");
      if (medMark.style) medMark.style.left = pos(tMed);
      const clMark = el("i", "wl-tmark close");
      if (clMark.style) clMark.style.left = pos(pxVal);
      trk.append(medMark, clMark);
      tbar.append(trk);
      col1.append(tbar);
    }

    // Col 2: Dated 3-Rule Tested Checklist + Earnings Window
    const col2 = el("div", "wl-drawer-col");
    if (T || r) {
      const card = el("div", "wl-chk-card");
      if (T && trend && trend.signal_date) {
        card.append(el("div", "wl-chk-head", `Tested trend rules · ${shortDay(trend.signal_date)} month-end close`));
      }
      const ul = el("ul", "wl-checklist");
      const addChk = (label, stateCls, val) => {
        const li = el("li");
        li.append(el("span", "", label), el("span", stateCls, val));
        ul.append(li);
      };
      if (T) {
        addChk("Price above 200-day SMA", T.rules.A === true ? "wl-chk-ok" : T.rules.A === false ? "wl-chk-no" : "", T.rules.A === true ? "✓ Yes" : T.rules.A === false ? "✗ Below" : "—");
        addChk("12–1 month return > 0", T.rules.B === true ? "wl-chk-ok" : T.rules.B === false ? "wl-chk-no" : "", T.rules.B === true ? `✓ ${T.mom121 !== null ? signedPct(T.mom121, 0) : "Yes"}` : T.rules.B === false ? `✗ ${T.mom121 !== null ? signedPct(T.mom121, 0) : "Below"}` : "—");
        addChk("50-day above 200-day SMA", T.rules.C === true ? "wl-chk-ok" : T.rules.C === false ? "wl-chk-no" : "", T.rules.C === true ? "✓ Yes" : T.rules.C === false ? "✗ Below" : "—");
      }
      const earnNear = r && r.days >= 0 && r.days <= 14;
      addChk("Earnings within 14 days", earnNear ? "wl-chk-warn" : "wl-chk-muted", r ? `${shortDay(r.date)}${earnNear ? ` (in ${r.days}d)` : ""}` : "None in calendar");
      card.append(ul);
      col2.append(card);
    }

    // Col 3: Ownership & Crowding (Insiders + Short Interest) + Same-Sector Shortlist Peer Contrast
    const col3 = el("div", "wl-drawer-col");
    const ownLines = [];
    if (o && (o.buy >= 50000 || o.ceo_buy)) {
      ownLines.push({ cls: "wl-chk-ok", label: "Fresh insider buy", val: o.headline || `Bought ${usdShort(o.buy)}` });
    }
    if (o && o.off_sell > 0 && o.sell_no_plan >= 250000) {
      ownLines.push({ cls: "wl-chk-warn", label: "Unscheduled officer sell", val: `Sold ${usdShort(o.sell_no_plan)} (no 10b5-1)` });
    }
    if (Array.isArray(si) && Number.isFinite(si[0])) {
      const chg = Number.isFinite(si[1]) ? ` (${si[1] >= 0 ? "+" : ""}${Math.round(si[1])}%)` : "";
      ownLines.push({ cls: "wl-chk-muted", label: `Short interest${shortInterestDate ? ` (${shortDay(shortInterestDate)})` : ""}`, val: `${si[0].toFixed(1)}d to cover${chg}` });
    }
    if (ownLines.length) {
      const oc = el("div", "wl-own-card");
      const oh = el("div", "wl-own-head");
      const insLink = el("a", "", "Insights →");
      insLink.href = `./insights.html?q=${encodeURIComponent(sym)}`;
      oh.append(el("span", "", "Ownership & crowding · context"), insLink);
      const oul = el("ul", "wl-checklist");
      for (const ln of ownLines) {
        const li = el("li");
        li.append(el("span", "", ln.label), el("span", ln.cls, ln.val));
        oul.append(li);
      }
      oc.append(oh, oul);
      col3.append(oc);
    }
    if ((T && T.ruleTone === "down") || (deskLoaded && inDesk && !m)) {
      const peer = sectorPeer(sym);
      if (peer) {
        const pc = el("div", "wl-peer-box");
        const txt = el("div");
        txt.append(
          el("span", "wl-peer-k", `Same-sector Shortlist peer (${sectorLabel(c.sector)})`),
          el("div", "wl-peer-v", `${peer.symbol} · ${peer.name} · SL #${peer.rank} · 3/3`),
        );
        const peerBtn = el("button", "wl-btn-ghost", W.has(peer.symbol) ? "Inspect →" : "+ Add");
        peerBtn.type = "button";
        peerBtn.addEventListener("click", () => {
          if (!W.has(peer.symbol)) {
            if (W.setSelected) W.setSelected([{ symbol: peer.symbol, name: peer.name, page: "watchlist" }], true);
            else W.toggle(peer.symbol, peer.name);
          }
          selectedSaved = peer.symbol;
          render(W.list());
        });
        pc.append(txt, peerBtn);
        col3.append(pc);
      }
    }

    if (col1.children.length || col2.children.length || col3.children.length) {
      grid.append(col1, col2, col3);
      blocks.push(grid);
    }

    // Bottom row: Auto-Checked "Wait for..." Trigger Editor + Personal Thesis Note
    const bot = el("div", "wl-drawer-bottom");
    const curTrig = loadTriggers()[sym] || { kind: "none" };
    const ev = evalTrigger(sym, today);
    const trigCard = el("div", "wl-trig-card");
    const th = el("div", "wl-trig-head");
    th.append(
      el("span", "", "Wait for (auto-checked weekly)"),
      ev ? el("span", ev.met ? "wl-trig-met" : "wl-trig-wait", ev.detail) : el("span", "wl-trig-wait", "No trigger"),
    );
    const trow = el("div", "wl-trig-row");
    for (const [k, label] of [["none", "None"], ["trend3", "Trend → 3/3"], ["shortlist", "Shortlist"], ["after_earn", "After earnings"], ["price", "Close ≤ $"]]) {
      const b = el("button", `wl-trig-btn${curTrig.kind === k ? " on" : ""}`, label);
      b.type = "button";
      b.addEventListener("click", () => {
        if (k === "price") {
          const fallback = Number(c.price) > 0 ? Math.max(1, Math.round(Number(c.price) * 0.95)) : 100;
          saveTrigger(sym, { kind: "price", target: curTrig.target || fallback });
        } else {
          saveTrigger(sym, { kind: k });
        }
        render(W.list());
      });
      trow.append(b);
    }
    if (curTrig.kind === "price") {
      const numIn = el("input", "wl-trig-price");
      numIn.type = "number";
      numIn.setAttribute("step", "any");
      numIn.setAttribute("aria-label", `Watch price for ${sym}`);
      numIn.value = curTrig.target ? String(curTrig.target) : "";
      numIn.addEventListener("change", () => {
        const v = Number(numIn.value);
        if (Number.isFinite(v) && v > 0) saveTrigger(sym, { kind: "price", target: v });
        else saveTrigger(sym, { kind: "none" });
        render(W.list());
      });
      trow.append(numIn);
    }
    trigCard.append(th, trow);

    const noteWrap = el("div", "wl-thesis-box");
    const noteId = `wl-note-${sym.replace(/[^A-Z0-9]/g, "")}`;
    const lbl = el("label", "", "Personal thesis note (saved in browser)");
    lbl.setAttribute("for", noteId);
    const inp = el("input");
    inp.id = noteId;
    inp.type = "text";
    inp.value = loadNotes()[sym] || "";
    inp.setAttribute("placeholder", "Write 1 line on why you’re watching this stock…");
    inp.addEventListener("input", () => {
      saveNote(sym, inp.value);
      const ref = noteSubs.get(sym);
      if (ref && ref.node) {
        const clean = String(inp.value || "").trim().slice(0, 180);
        ref.node.textContent = clean ? `“${clean}”` : ref.fallback;
        ref.node.className = clean ? "wl-note-line" : "wl-meta-line";
      }
    });
    noteWrap.append(lbl, inp);
    bot.append(trigCard, noteWrap);
    blocks.push(bot);

    drawer.replaceChildren(...blocks);
  }

  // Empty-state Shortlist Top 10 starter grid
  function renderStarterGrid() {
    const grid = $("wl-starter-grid");
    if (!grid) return;
    if (!shortlistPicks.length) { grid.replaceChildren(); return; }
    grid.replaceChildren(...shortlistPicks.map((sym) => {
      const c = desk[sym] || {};
      const b = el("button", "wl-starter-chip");
      b.type = "button";
      b.append(el("span", "star", "☆"), el("span", "rk", `#${shortlistRanks[sym] || ""}`),
        el("span", "", sym), el("span", "nm", c.name || ""));
      b.addEventListener("click", () => {
        W.toggle(sym, c.name || "");
        selectedSaved = sym;
      });
      return b;
    }));
  }

  // Shareable PNG Scorecard + Pasteable Text List + Card/PDF Dialog + Copy Link
  function formatShareText(items) {
    const notes = loadNotes();
    const lines = [`Temper Lab Watchlist${deskAsOf ? ` · ${longDay(deskAsOf)}` : ""} (${items.length} stocks)`];
    for (const it of items) {
      const c = desk[it.symbol] || {};
      const T = savedRules(it.symbol);
      const m = members[it.symbol];
      const lists = m ? [m.shortlist ? `Shortlist #${m.shortlist}` : "", ...m.lists].filter(Boolean).join(", ") : "Off list";
      const er = earnings[it.symbol];
      const noteText = notes[it.symbol] ? ` — "${notes[it.symbol]}"` : "";
      lines.push(`• ${it.symbol} (${price(c.price)}) · ${ruleBadge(T)} · ${lists}${er && er.date ? ` · Results ${shortDay(er.date)}` : ""}${noteText}`);
    }
    const syms = items.map((i) => i.symbol).join(",");
    lines.push(`Open live: https://temper-lab.com/watchlist.html?w=${encodeURIComponent(syms)}`);
    return lines.join("\n");
  }

  function drawShareCard(canvas, items) {
    if (!canvas || typeof canvas.getContext !== "function") return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const notes = loadNotes();
    const rows = items.slice(0, 14);
    const W = 880, rowH = 44, headH = 98, footH = 44;
    const H = headH + Math.max(1, rows.length) * rowH + footH;
    const S = 2;
    canvas.width = W * S; canvas.height = H * S;
    ctx.scale(S, S);
    const font = (w, sz) => `${w} ${sz}px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const rrect = (x, y, w, h, r, fill, stroke) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    };
    ctx.fillStyle = "#f6f7f4"; ctx.fillRect(0, 0, W, H);
    rrect(20, 16, W - 40, H - 32, 12, "#ffffff", "#dbe3de");
    rrect(36, 30, 22, 22, 5, "#1e4d36");
    ctx.fillStyle = "#f0e6bf"; ctx.font = font(700, 14); ctx.textAlign = "center"; ctx.fillText("t", 47, 46);
    ctx.fillStyle = "#1f3328"; ctx.font = font(700, 17); ctx.textAlign = "left";
    ctx.fillText(`Temper Lab · Watchlist (${items.length})`, 68, 47);
    ctx.fillStyle = "#5d7263"; ctx.font = font(500, 12); ctx.textAlign = "right";
    if (deskAsOf) ctx.fillText(`Snapshot ${longDay(deskAsOf)}`, W - 36, 46);

    const cy = 78;
    ctx.fillStyle = "#6c7f72"; ctx.font = font(600, 10.5); ctx.textAlign = "left";
    ctx.fillText("TICKER & NOTE", 36, cy);
    ctx.fillText("CLOSE", 310, cy);
    ctx.fillText("TREND (TESTED)", 395, cy);
    ctx.fillText("LISTS", 540, cy);
    ctx.fillText("NEXT RESULTS", 700, cy);
    ctx.strokeStyle = "#e6ece7"; ctx.beginPath(); ctx.moveTo(36, cy + 8); ctx.lineTo(W - 36, cy + 8); ctx.stroke();

    rows.forEach((it, idx) => {
      const y = headH + idx * rowH;
      if (idx > 0) { ctx.strokeStyle = "#f0f3f0"; ctx.beginPath(); ctx.moveTo(36, y - 6); ctx.lineTo(W - 36, y - 6); ctx.stroke(); }
      const c = desk[it.symbol] || {};
      const T = savedRules(it.symbol);
      const m = members[it.symbol];
      const er = earnings[it.symbol];
      ctx.fillStyle = "#1e4d36"; ctx.font = font(700, 13.5); ctx.textAlign = "left";
      ctx.fillText(it.symbol, 36, y + 12);
      ctx.fillStyle = "#5d7263"; ctx.font = font(400, 11);
      const sub = notes[it.symbol] ? `“${notes[it.symbol].slice(0, 38)}”` : (c.name || it.name || "").slice(0, 34);
      ctx.fillText(sub, 36, y + 27);
      ctx.fillStyle = "#1f3328"; ctx.font = font(600, 13);
      ctx.fillText(price(c.price), 310, y + 16);
      const tTone = T ? T.ruleTone : "none";
      const cols = { up: ["#e3f2e8", "#165c37"], down: ["#fae8e6", "#992b22"], mixed: ["#fef3da", "#8a5a0a"], none: ["#f1f3f1", "#3d4f43"] }[tTone];
      rrect(395, y + 1, 122, 22, 11, cols[0]);
      ctx.fillStyle = cols[1]; ctx.font = font(600, 11); ctx.textAlign = "center";
      ctx.fillText(ruleBadge(T), 456, y + 16);
      ctx.textAlign = "left"; ctx.fillStyle = "#3c5446"; ctx.font = font(500, 11.5);
      const listStr = m ? [m.shortlist ? `SL #${m.shortlist}` : "", ...m.lists].filter(Boolean).slice(0, 2).join(" · ") : "Off list";
      ctx.fillText(listStr, 540, y + 16);
      ctx.fillStyle = "#5d7263"; ctx.font = font(400, 11.5);
      ctx.fillText(er && er.date ? shortDay(er.date) : "—", 700, y + 16);
    });
    ctx.fillStyle = "#7b8c81"; ctx.font = font(400, 10.5); ctx.textAlign = "left";
    const more = items.length > rows.length ? `Showing first ${rows.length} of ${items.length} · ` : "";
    ctx.fillText(`${more}temper-lab.com · Research facts with dates, not a buy or sell call.`, 36, H - 24);
    return true;
  }

  async function copyWatchlist(button) {
    const items = W.list();
    if (!items.length) return;
    const text = formatShareText(items);
    const navClip = globalThis.navigator && globalThis.navigator.clipboard;
    try {
      if (navClip && typeof globalThis.ClipboardItem === "function" && typeof document.createElement === "function") {
        const canvas = document.createElement("canvas");
        if (drawShareCard(canvas, items) && typeof canvas.toBlob === "function") {
          const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
          if (blob) {
            await navClip.write([new globalThis.ClipboardItem({
              "image/png": blob,
              "text/plain": new Blob([text], { type: "text/plain" }),
            })]);
            reportCopy(button, true, "Copied PNG + list");
            return;
          }
        }
      }
      if (navClip && typeof navClip.writeText === "function") {
        await navClip.writeText(text);
        reportCopy(button, true, "Copied list");
        return;
      }
      reportCopy(button, false);
    } catch {
      try {
        if (navClip && typeof navClip.writeText === "function") {
          await navClip.writeText(text);
          reportCopy(button, true, "Copied list");
          return;
        }
      } catch {}
      reportCopy(button, false);
    }
  }

  async function copyShareLink(button) {
    const items = W.list();
    if (!items.length) return;
    const url = `https://temper-lab.com/watchlist.html?w=${encodeURIComponent(items.map((i) => i.symbol).join(","))}`;
    const navClip = globalThis.navigator && globalThis.navigator.clipboard;
    try {
      if (navClip && typeof navClip.writeText === "function") {
        await navClip.writeText(url);
        reportCopy(button, true, "Link copied");
        return;
      }
      reportCopy(button, false);
    } catch {
      reportCopy(button, false);
    }
  }

  function openCardDialog() {
    const items = W.list();
    if (!items.length || !document.body) return;
    let dlg = $("wl-copy-dlg");
    if (!dlg) {
      dlg = el("dialog", "wl-copy-dlg");
      dlg.id = "wl-copy-dlg";
      dlg.addEventListener("click", (e) => {
        if (e.target === dlg && typeof dlg.close === "function") dlg.close();
      });
      document.body.append(dlg);
    }
    const head = el("div", "wl-dlg-head");
    head.append(el("strong", "", "Shareable Watchlist Card (PNG / PDF / Text)"));
    const closeBtn = el("button", "wl-dlg-close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close preview");
    closeBtn.addEventListener("click", () => { if (typeof dlg.close === "function") dlg.close(); });
    head.append(closeBtn);

    const canvas = el("canvas", "wl-dlg-canvas");
    drawShareCard(canvas, items);

    const actions = el("div", "wl-dlg-actions");
    const copyWrap = el("span", "wl-copy-wrap");
    const bCopy = el("button", "wl-btn-primary", "Copy PNG + list");
    bCopy.type = "button";
    bCopy.addEventListener("click", () => { void copyWatchlist(bCopy); });
    const tip1 = el("span", "wl-copy-tip", "");
    tip1.setAttribute("role", "status");
    copyWrap.append(bCopy, tip1);

    const bPng = el("button", "wl-btn-ghost", "Download PNG");
    bPng.type = "button";
    bPng.addEventListener("click", () => {
      const a = el("a");
      a.download = `temper-lab-watchlist-${deskAsOf || "snapshot"}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    });

    const bPdf = el("button", "wl-btn-ghost", "Print / Save PDF");
    bPdf.type = "button";
    bPdf.addEventListener("click", () => {
      if (typeof dlg.close === "function") dlg.close();
      if (typeof globalThis.print === "function") globalThis.print();
    });

    const linkWrap = el("span", "wl-copy-wrap");
    const bLink = el("button", "wl-btn-ghost", "Copy link");
    bLink.type = "button";
    bLink.addEventListener("click", () => { void copyShareLink(bLink); });
    const tip2 = el("span", "wl-copy-tip", "");
    tip2.setAttribute("role", "status");
    linkWrap.append(bLink, tip2);

    actions.append(copyWrap, bPng, bPdf, linkWrap);
    dlg.replaceChildren(head, canvas, actions);
    if (typeof dlg.showModal === "function") dlg.showModal();
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
  // grey = too little history for all three. The state at the last month-end close, read from
  // share/trend-rules.json - the file the Research page reads, built in Python - so both pages always
  // agree and nothing is computed here. A change between month-ends did not predict returns
  // (claude/platform-architecture-review-2026-10-20.md), so the month-end state is the signal shown.
  const RULE_NAMES = { A: "price above 200-day", B: "12–1 month return above zero", C: "50-day above 200-day" };
  function trendFor(symbol) {
    if (!trend || !timing || trend.desk_run_id !== timing.desk_run_id) return null;
    return rulesOf(symbol);
  }
  // The Saved tab needs no Timing file: the rules file must belong to this week's Research snapshot.
  const savedRules = (symbol) => (trend && deskRunId && trend.desk_run_id === deskRunId ? rulesOf(symbol) : null);
  function rulesOf(symbol) {
    const a = trend.rules[symbol];
    if (!Array.isArray(a) || a.length !== 3) return null;
    const rules = { A: a[0] === null ? null : a[0] === 1, B: a[1] === null ? null : a[1] === 1, C: a[2] === null ? null : a[2] === 1 };
    const known = a.filter((v) => v === 0 || v === 1);
    const rulesUp = known.filter((v) => v === 1).length;
    const m = trend.momentum_12_1 ? trend.momentum_12_1[symbol] : null;
    return { rules, rulesUp, ruleTone: known.length < 3 ? "none" : rulesUp === 3 ? "up" : rulesUp === 0 ? "down" : "mixed",
      mom121: Number.isFinite(m) ? m : null };
  }
  const ruleBadge = (T) => (!T ? "Not available" : T.ruleTone === "up" ? "Uptrend · 3 of 3" : T.ruleTone === "down" ? "Downtrend · 0 of 3"
    : T.ruleTone === "mixed" ? `Mixed · ${T.rulesUp} of 3` : "Not enough history");
  const ruleList = (T) => (!T ? "The trend file for this snapshot is not available" : `At the ${longDay(trend.signal_date)} month-end close: `
    + Object.entries(RULE_NAMES)
      .map(([k, name]) => `${T.rules[k] === null ? "–" : T.rules[k] ? "✓" : "✗"} ${name}${k === "B" && T.mom121 !== null ? ` (${signedPct(T.mom121, 0)})` : ""}`)
      .join(" · "));
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
      "aria-label": `${symbol}: daily close with 50-day and ${slowP}-day averages, RSI (14), MACD (12, 26, 9), ${longDay(ta.days[0])} to ${longDay(ta.days[n - 1])}`,
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
      svg("text", { x: lx + 25, y: ly + 3, fill: "#4a5d51", "font-size": "10.5" }, chart, item.label);
    };
    const panel = (title, items, height, yLabel) => {
      svg("text", { x: L, y: cursor + 13, fill: "#1f3328", "font-size": "13", "font-weight": "600" }, chart, title);
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
      svg("rect", { x: L, y: top, width: PW, height, fill: "#ffffff", stroke: "#dce3de", "stroke-width": "1" }, chart);
      const cy = (top + bottom) / 2;
      svg("text", { x: 12, y: cy, "text-anchor": "middle", fill: "#4a5d51", "font-size": "11", transform: `rotate(-90 12 ${cy})` }, chart, yLabel);
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
    const upMa = ta.events.ma.filter((e) => e.kind === "up");
    const downMa = ta.events.ma.filter((e) => e.kind === "down");
    const maCrossNote = ta.last.lastMa
      ? ` · 50-day crossed ${ta.last.lastMa.kind === "up" ? "above" : "below"} ${slowP}-day ${eventDay(ta.last.lastMa.date)}`
      : ta.last.trend ? ` · ${noCross(ta, slowP).replace(/^None/, `no 50/${slowP} cross`)}` : "";
    const priceItems = [
      { color: "#24342d", label: `${symbol} close` },
      { color: "#1e6547", label: "50-day average" },
      { color: "#b55d47", label: `${slowP}-day average` },
      ...(upMa.length ? [{ shape: "up", color: "#1e6547", label: `50-day crossed above ${slowP}-day (${upMa.map((e) => eventDay(e.date)).join(", ")})` }] : []),
      ...(downMa.length ? [{ shape: "down", color: "#b55d47", label: `50-day crossed below ${slowP}-day (${downMa.map((e) => eventDay(e.date)).join(", ")})` }] : []),
    ];
    const p1 = panel(narrow ? `${symbol} · adjusted close${maCrossNote}` : `${symbol} · daily close, adjusted for splits and dividends${maCrossNote}`, priceItems, narrow ? 190 : 225, "Price (USD)");
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
      svg("line", { x1: L, x2: L + PW, y1: yy, y2: yy, stroke: "#eef2ef", "stroke-width": "0.8" }, chart);
      svg("text", { x: L - 6, y: yy + 3.5, "text-anchor": "end", fill: "#4a5d51", "font-size": "10.5" }, chart, pStep < 1 ? tick.toFixed(2) : Math.round(tick).toString());
    }
    svg("path", { d: buildPath(ta.close, yPrice), fill: "none", stroke: "#24342d", "stroke-width": "1.7" }, chart);
    svg("path", { d: buildPath(ta.sma50, yPrice), fill: "none", stroke: "#1e6547", "stroke-width": "1.6" }, chart);
    svg("path", { d: buildPath(ta.slow, yPrice), fill: "none", stroke: "#b55d47", "stroke-width": "1.7" }, chart);
    for (const e of ta.events.ma) {
      vLine(p1.top, p1.bottom, e.index, e.kind === "up" ? "#1e6547" : "#b55d47");
      const cx = x(e.index);
      const maLevel = ta.sma50[e.index] !== null && ta.slow[e.index] !== null ? (ta.sma50[e.index] + ta.slow[e.index]) / 2 : e.price;
      const cy = yPrice(maLevel);
      const pts = e.kind === "up"
        ? `${cx.toFixed(1)},${(cy - 8).toFixed(1)} ${(cx - 6.5).toFixed(1)},${(cy + 5).toFixed(1)} ${(cx + 6.5).toFixed(1)},${(cy + 5).toFixed(1)}`
        : `${cx.toFixed(1)},${(cy + 8).toFixed(1)} ${(cx - 6.5).toFixed(1)},${(cy - 5).toFixed(1)} ${(cx + 6.5).toFixed(1)},${(cy - 5).toFixed(1)}`;
      svg("polygon", { points: pts, fill: e.kind === "up" ? "#1e6547" : "#b55d47", stroke: "#ffffff", "stroke-width": "1.2" }, chart);
    }

    // --- RSI panel (calm slate, never green/red) ---
    const p2 = panel(`${symbol} · RSI (14, Wilder)`, [
      { color: "#3d6385", label: "RSI (14)" },
      { color: "#8a9990", dash: "5,4", label: `${RSI_HIGH} and ${RSI_LOW} lines` },
      { shape: "dot", color: "#3d6385", label: `first day at ${RSI_HIGH}+ or at ${RSI_LOW} or below` },
    ], narrow ? 120 : 135, "RSI");
    const yRsi = (v) => p2.top + (1 - v / 100) * (p2.bottom - p2.top);
    svg("rect", { x: L + 0.5, y: yRsi(RSI_HIGH), width: PW - 1, height: yRsi(RSI_LOW) - yRsi(RSI_HIGH), fill: "#f2f6f4" }, chart);
    for (const tick of [0, 30, 50, 70, 100]) {
      const yy = yRsi(tick);
      svg("line", { x1: L, x2: L + PW, y1: yy, y2: yy, stroke: tick === 30 || tick === 70 ? "#8a9990" : "#eef2ef", "stroke-width": tick === 30 || tick === 70 ? "1.1" : "0.8", "stroke-dasharray": tick === 30 || tick === 70 ? "5,4" : undefined }, chart);
      svg("text", { x: L - 6, y: yy + 3.5, "text-anchor": "end", fill: "#4a5d51", "font-size": "10.5" }, chart, String(tick));
    }
    svg("path", { d: buildPath(ta.rsi14, yRsi), fill: "none", stroke: "#3d6385", "stroke-width": "1.6" }, chart);
    for (const e of ta.events.rsi) svg("circle", { cx: x(e.index).toFixed(1), cy: yRsi(e.value).toFixed(1), r: "3.6", fill: "#3d6385", stroke: "#ffffff", "stroke-width": "1" }, chart);

    // --- MACD panel (calm slate / warm ochre / mist, never green/red) ---
    const latest = ta.last.lastMacd;
    const crossNote = latest ? ` · crossed ${latest.kind === "up" ? "above" : "below"} signal ${eventDay(latest.date)}` : "";
    const p3 = panel(narrow ? `MACD (12, 26, 9)${crossNote.replace(" signal", "")}` : `${symbol} · MACD (12, 26, 9)${crossNote}`, [
      { color: "#3d6385", label: "MACD" },
      { color: "#b8843b", label: "Signal" },
      { shape: "bar", color: "#aebcb3", label: "Histogram" },
      { shape: "dot", color: "#4a5d51", label: "crossed above signal" },
      { shape: "ring", color: "#4a5d51", label: "crossed below signal" },
    ], narrow ? 140 : 158, "MACD ($)");
    const mVals = [...ta.macd, ...ta.signal, ...ta.hist].filter((v) => v !== null && Number.isFinite(v)).map(Math.abs);
    const mMax = (Math.max(0, ...mVals) || 1) * 1.15;
    const yMacd = (v) => p3.top + (1 - (v + mMax) / (2 * mMax)) * (p3.bottom - p3.top);
    const yZero = yMacd(0);
    for (const tick of [-mMax * 0.75, 0, mMax * 0.75]) {
      const yy = yMacd(tick);
      svg("line", { x1: L, x2: L + PW, y1: yy, y2: yy, stroke: tick === 0 ? "#b8c4bc" : "#eef2ef", "stroke-width": tick === 0 ? "1" : "0.8" }, chart);
      svg("text", { x: L - 6, y: yy + 3.5, "text-anchor": "end", fill: "#4a5d51", "font-size": "10.5" }, chart, tick === 0 ? "0" : axisNumber(tick));
    }
    const barW = Math.max(1, (PW / n) * 0.65);
    for (let i = 0; i < n; i++) {
      const h = ta.hist[i];
      if (h === null || !Number.isFinite(h)) continue;
      const yy = yMacd(h);
      svg("rect", { x: (x(i) - barW / 2).toFixed(1), y: Math.min(yZero, yy).toFixed(1), width: barW.toFixed(1), height: Math.max(0.6, Math.abs(yy - yZero)).toFixed(1), fill: h >= 0 ? "#aebcb3" : "#d5ddd8" }, chart);
    }
    svg("path", { d: buildPath(ta.macd, yMacd), fill: "none", stroke: "#3d6385", "stroke-width": "1.6" }, chart);
    svg("path", { d: buildPath(ta.signal, yMacd), fill: "none", stroke: "#b8843b", "stroke-width": "1.6" }, chart);
    for (const e of ta.events.macd) {
      svg("circle", { cx: x(e.index).toFixed(1), cy: yMacd(e.value).toFixed(1), r: "3.4", fill: e.kind === "up" ? "#4a5d51" : "#ffffff", stroke: e.kind === "up" ? "#ffffff" : "#4a5d51", "stroke-width": e.kind === "up" ? "1" : "1.5" }, chart);
    }

    // --- Shared month axis along the bottom panel ---
    const bottomY = p3.bottom;
    let lastLabelX = -100;
    for (let i = 1; i < n; i++) {
      const ym = ta.days[i].slice(0, 7);
      if (ym === ta.days[i - 1].slice(0, 7)) continue;
      const xx = x(i);
      if (xx - lastLabelX < (narrow ? 58 : 70) || xx > L + PW - 22) continue;
      for (const p of [p1, p2, p3]) svg("line", { x1: xx, x2: xx, y1: p.top, y2: p.bottom, stroke: "#eef2ef", "stroke-width": "0.8" }, chart);
      svg("text", { x: xx, y: bottomY + 15, "text-anchor": "middle", fill: "#4a5d51", "font-size": "10.5" }, chart, `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`);
      lastLabelX = xx;
    }
    for (const e of ta.events.ma) for (const p of [p2, p3]) vLine(p.top, p.bottom, e.index, e.kind === "up" ? "#1e6547" : "#b55d47");
    const H_SVG = bottomY + 24;
    chart.setAttribute("viewBox", `0 0 ${W_SVG} ${H_SVG}`);

    // Hover / keyboard readout: that day's numbers and events.
    const cross = svg("line", { y1: p1.top, y2: bottomY, stroke: "#5d7263", "stroke-width": "1", "stroke-dasharray": "3,3", visibility: "hidden" }, chart);
    const dot = svg("circle", { r: "4", fill: "#24342d", stroke: "#fff", "stroke-width": "1.2", visibility: "hidden" }, chart);
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

  // Multi-stock 1-year normalized % overlay on Timing tab (click any line or label to focus below).
  function drawRelativeOverlay(symbols) {
    const box = $("wl-timing-overlay-box");
    const host = $("wl-timing-overlay");
    if (!box || !host) return;
    if (!timing || !Array.isArray(timing.days) || !timing.closes) {
      box.hidden = true;
      host.replaceChildren();
      return;
    }
    const warmup = timing.warmup || 200;
    const days = timing.days.slice(warmup);
    const n = days.length;
    const pickList = activeSymbol && !symbols.slice(0, 6).includes(activeSymbol)
      ? [activeSymbol, ...symbols.filter((s) => s !== activeSymbol).slice(0, 5)]
      : symbols.slice(0, 6);
    const palette = ["#1e6547", "#3d6385", "#b55d47", "#b8843b", "#6f5b8f", "#2f7d78"];
    const series = pickList.map((sym, idx) => {
      const raw = Array.isArray(timing.closes[sym]) ? timing.closes[sym].slice(warmup) : [];
      const base = raw.find((v) => Number.isFinite(v) && v > 0);
      if (!base) return null;
      const rel = raw.map((v) => (Number.isFinite(v) && v > 0 ? (v / base - 1) * 100 : null));
      let last = null;
      for (let i = rel.length - 1; i >= 0; i--) {
        if (rel[i] !== null) { last = rel[i]; break; }
      }
      if (last === null) return null;
      return { sym, rel, last, color: palette[idx % palette.length] };
    }).filter(Boolean);
    if (series.length < 2 || n < 2) {
      box.hidden = true;
      host.replaceChildren();
      return;
    }
    box.hidden = false;
    const W_OV = host.clientWidth ? Math.max(350, Math.min(920, host.clientWidth - 16)) : 920;
    const H_OV = W_OV < 560 ? 170 : 186;
    const L = W_OV < 560 ? 44 : 52, R = W_OV < 560 ? 84 : 96, T = 14, B = 26;
    const PW = W_OV - L - R, PH = H_OV - T - B;
    const allV = series.flatMap((s) => s.rel.filter((v) => v !== null));
    const lo = Math.min(-10, ...allV) * 1.08;
    const hi = Math.max(10, ...allV) * 1.08;
    const x = (i) => L + (n > 1 ? (i / (n - 1)) * PW : PW / 2);
    const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * PH;
    const s = svg("svg", {
      class: "wl-ta-svg",
      viewBox: `0 0 ${W_OV} ${H_OV}`,
      role: "img",
      "aria-label": `1-year relative comparison for ${series.map((it) => it.sym).join(", ")}`,
    });
    svg("rect", { x: L, y: T, width: PW, height: PH, rx: "4", fill: "#ffffff", stroke: "#dce3de" }, s);
    const y0 = y(0);
    svg("line", { x1: L, x2: L + PW, y1: y0.toFixed(1), y2: y0.toFixed(1), stroke: "#9eb0a4", "stroke-dasharray": "4,3" }, s);
    for (const tv of [Math.round(lo), 0, Math.round(hi)]) {
      const yy = y(tv);
      svg("text", { x: L - 6, y: (yy + 3.5).toFixed(1), "text-anchor": "end", fill: "#5d7263", "font-size": "10" }, s, `${tv > 0 ? "+" : ""}${tv}%`);
    }
    // Draw inactive lines first, active stock on top
    const ordered = [...series.filter((it) => it.sym !== activeSymbol), ...series.filter((it) => it.sym === activeSymbol)];
    for (const item of ordered) {
      let d = "";
      for (let i = 0; i < item.rel.length; i++) {
        if (item.rel[i] !== null) d += `${d && item.rel[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(item.rel[i]).toFixed(1)}`;
      }
      const isAct = item.sym === activeSymbol;
      const p = svg("path", {
        d, fill: "none", stroke: item.color,
        "stroke-width": isAct ? "2.6" : "1.35",
        opacity: isAct ? "1" : "0.52",
        style: "cursor:pointer",
      }, s);
      p.addEventListener("click", () => { activeSymbol = item.sym; renderTiming(W.list()); });
    }
    // Anti-overlap right-hand end labels
    const placed = series.map((item) => ({ item, y: y(item.last) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i++) {
      if (placed[i].y - placed[i - 1].y < 13) placed[i].y = placed[i - 1].y + 13;
    }
    const maxY = T + PH - 3;
    if (placed.length && placed[placed.length - 1].y > maxY) {
      let shift = placed[placed.length - 1].y - maxY;
      for (let i = placed.length - 1; i >= 0; i--) {
        placed[i].y = Math.max(T + 9, placed[i].y - shift);
        if (i > 0 && placed[i].y - placed[i - 1].y < 13) shift = 13 - (placed[i].y - placed[i - 1].y);
        else shift = 0;
      }
    }
    for (const { item, y: ly } of placed) {
      const isAct = item.sym === activeSymbol;
      const lbl = svg("text", {
        x: L + PW + 6, y: (ly + 3.5).toFixed(1),
        fill: item.color, "font-size": "10.5", "font-weight": isAct ? "700" : "600",
        style: "cursor:pointer",
      }, s, `${item.sym} ${item.last >= 0 ? "+" : ""}${Math.round(item.last)}%`);
      lbl.addEventListener("click", () => { activeSymbol = item.sym; renderTiming(W.list()); });
    }
    svg("text", { x: L, y: H_OV - 6, fill: "#5d7263", "font-size": "10" }, s, longDay(days[0]));
    svg("text", { x: L + PW, y: H_OV - 6, "text-anchor": "end", fill: "#5d7263", "font-size": "10" }, s, longDay(days[n - 1]));
    host.replaceChildren(s);
  }

  function renderTiming(items) {
    const panelEl = $("wl-timing-panel");
    if (!panelEl) return;
    const slowP = 200;
    if ($("wl-timing-sub")) {
      const asOf = timing && timing.as_of;
      $("wl-timing-sub").textContent = `${asOf ? `Close on ${longDay(asOf)} (the weekly snapshot)` : "Weekly snapshot"}. `
        + `Colour shows three trend rules tested on Temper Lab data: price vs ${slowP}-day, 12–1 month return, 50-day vs ${slowP}-day, `
        + `at the last month-end close${trend ? ` (${longDay(trend.signal_date)})` : ""}, the signal that passed our test; a change between month-ends did not predict returns. `
        + `Charts and the other numbers are at the weekly close. `
        + `RSI (14, Wilder) and MACD (12, 26, 9) are context. Descriptions of past prices, not a buy or sell call.`;
    }
    if ($("wl-th-trend")) $("wl-th-trend").textContent = "Trend rules (tested)";
    if ($("wl-th-gap")) $("wl-th-gap").textContent = `Gap, 50 vs ${slowP}`;
    if ($("wl-th-cross")) $("wl-th-cross").textContent = `Last 50/${slowP} cross`;
    if ($("wl-timing-foot")) {
      $("wl-timing-foot").textContent = `Trend rules: in a Leg D test of US stocks with $1B+ market value and $10M+ daily trading, signals on month-end closes, entries Jul 2021 – Apr 2026, `
        + `stocks with each rule up beat those with it down by 3.0% to 3.6% over the next 6 months (size-neutral, before costs, survivors only, past results). `
        + `On weekly closes the result was the same, but a change between month-ends did not predict returns, so the colour is the month-end state. `
        + `Green = all three up, amber = they disagree, red = all three down, grey = too little history. `
        + `How these are made: prices are Yahoo adjusted closes (splits and dividends), four significant digits, so past levels can sit below the prices traded then. `
        + `Averages are simple moving averages; ▲/▼ mark the day the 50-day crossed the ${slowP}-day. RSI is Wilder's 14-day RSI; dots mark the first day at ${RSI_HIGH} or above or at ${RSI_LOW} or below. `
        + `MACD is 12/26/9 on exponential averages, in dollars, so it cannot be compared across stocks; every crossover of the signal line is drawn. `
        + `Up to 200 sessions before the chart are used to start the averages; a younger listing starts later. RSI and MACD have not been tested on Temper Lab data. None of this is a buy or sell call.`;
    }

    const starredSyms = items.map((x) => x.symbol);
    const symbols = starredSyms.length ? starredSyms : shortlistPicks.slice();
    if (!activeSymbol || (!symbols.includes(activeSymbol) && !shortlistPicks.includes(activeSymbol))) activeSymbol = symbols[0] || "";
    const tone = (sym) => (trendFor(sym) || {}).ruleTone || "";
    drawRelativeOverlay(symbols);

    const picksBar = $("wl-timing-picks");
    if (picksBar) {
      const pick = (sym, rank) => {
        const btn = el("button", `wl-pick-btn${sym === activeSymbol ? " on" : ""}`);
        btn.type = "button";
        btn.append(el("span", `wl-pick-dot ${tone(sym)}`));
        if (rank) btn.append(el("small", "wl-pick-rank", `#${rank}`));
        btn.append(el("span", "", sym));
        btn.addEventListener("click", () => {
          activeSymbol = sym;
          renderTiming(W.list());
        });
        return btn;
      };
      const makeRow = (labelText, buttons) => {
        const rowEl = el("div", "wl-timing-picks-row");
        const listEl = el("div", "wl-timing-picks-list");
        listEl.append(...buttons);
        rowEl.append(el("span", "wl-timing-picks-label", labelText), listEl);
        return rowEl;
      };
      const rows = [];
      if (starredSyms.length) {
        rows.push(makeRow("Your watchlist:", symbols.map((s) => pick(s))));
        const extra = shortlistPicks.filter((s) => !starredSyms.includes(s));
        if (extra.length) {
          rows.push(makeRow("Shortlist top 10 (not starred):", extra.map((s) => pick(s, shortlistRanks[s]))));
        }
      } else if (symbols.length) {
        rows.push(makeRow("Research Shortlist, first ten (star any ticker to add your own):", symbols.map((s) => pick(s, shortlistRanks[s]))));
      }
      picksBar.replaceChildren(...rows);
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
          card("Trend rules (tested)", ruleBadge(trendFor(activeSymbol)), `${ruleList(trendFor(activeSymbol))}.`, tone(activeSymbol) || "none"),
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
        const T = trendFor(sym);
        const badge = el("span", `wl-badge ${tone(sym) || "none"}`, ruleBadge(T));
        badge.title = ruleList(T);
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
    const today = marketToday();
    const sorted = sortRows(displayed, today);
    if (selectedSaved && !sorted.some((it) => it.symbol === selectedSaved)) {
      selectedSaved = "";
    }
    const allSelected = displayed.length > 0 && displayed.every((item) => W.has(item.symbol));
    $("wl-select-all").setAttribute("aria-pressed", allSelected ? "true" : "false");
    $("wl-select-all").setAttribute("aria-label", allSelected ? "Unselect all" : "Select all");
    $("wl-select-all").disabled = displayed.length === 0;
    $("wl-count").textContent = bulkRows.length ? `${items.length} of ${displayed.length} starred` : items.length ? `${items.length} ${items.length === 1 ? "company" : "companies"}` : "";
    $("wl-empty").hidden = displayed.length > 0;
    $("wl-table").hidden = displayed.length === 0;
    $("wl-export").disabled = items.length === 0;
    if ($("wl-card-btn")) $("wl-card-btn").disabled = items.length === 0;
    if ($("wl-link-btn")) $("wl-link-btn").disabled = items.length === 0;
    $("wl-storage").hidden = W.stored();
    noteSubs.clear();
    $("wl-rows").replaceChildren(...sorted.map((item) => row(item, today)));
    renderSummary(items, today);
    renderInspector(sorted, today);
    if (displayed.length === 0) renderStarterGrid();
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

  function parseSharedQuery() {
    const raw = (globalThis.location && globalThis.location.search) || "";
    if (!raw) return [];
    let param = "";
    try {
      if (typeof URLSearchParams === "function") param = new URLSearchParams(raw).get("w") || "";
      else {
        const m = raw.match(/[?&]w=([^&]+)/);
        param = m ? decodeURIComponent(m[1]) : "";
      }
    } catch { return []; }
    const seen = new Set();
    const out = [];
    for (const part of param.split(",")) {
      const sym = part.trim().toUpperCase();
      if (/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(sym) && !seen.has(sym)) {
        seen.add(sym);
        out.push(sym);
        if (out.length >= 50) break;
      }
    }
    return out;
  }

  let sharedSymbols = [];
  function renderSharedBanner() {
    const banner = $("wl-shared-banner");
    if (!banner) return;
    const missing = sharedSymbols.filter((s) => !W.has(s));
    if (!sharedSymbols.length || !missing.length) {
      banner.hidden = true;
      banner.replaceChildren();
      return;
    }
    banner.hidden = false;
    const preview = missing.slice(0, 8).join(", ") + (missing.length > 8 ? ` +${missing.length - 8} more` : "");
    const copy = el("span", "", `Shared watchlist link: ${missing.length} new ${missing.length === 1 ? "ticker" : "tickers"} (${preview}).`);
    const actions = el("div", "wl-shared-actions");
    const addBtn = el("button", "wl-btn-primary", `Add ${missing.length} to my watchlist`);
    addBtn.type = "button";
    addBtn.addEventListener("click", () => {
      const rows = missing.map((s) => ({ symbol: s, name: (desk[s] && desk[s].name) || "", page: "watchlist" }));
      if (W.setSelected) W.setSelected(rows, true);
      else for (const r of rows) W.toggle(r.symbol, r.name);
      selectedSaved = missing[0];
      sharedSymbols = [];
      banner.hidden = true;
      banner.replaceChildren();
      say(`Added ${rows.length} ${rows.length === 1 ? "company" : "companies"} from the shared link.`);
      try {
        if (globalThis.history && typeof globalThis.history.replaceState === "function" && globalThis.location) {
          globalThis.history.replaceState(null, "", globalThis.location.pathname + (globalThis.location.hash || ""));
        }
      } catch {}
    });
    const dismissBtn = el("button", "wl-btn-ghost", "Dismiss");
    dismissBtn.type = "button";
    dismissBtn.addEventListener("click", () => {
      sharedSymbols = [];
      banner.hidden = true;
      banner.replaceChildren();
    });
    actions.append(addBtn, dismissBtn);
    banner.replaceChildren(copy, actions);
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
      void copyWatchlist($("wl-export"));
    });
    if ($("wl-card-btn")) {
      $("wl-card-btn").addEventListener("click", () => openCardDialog());
    }
    if ($("wl-link-btn")) {
      $("wl-link-btn").addEventListener("click", () => {
        void copyShareLink($("wl-link-btn"));
      });
    }
    if ($("wl-add-form")) {
      $("wl-add-form").addEventListener("submit", (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        const input = $("wl-add-input");
        const raw = String((input && input.value) || "").trim();
        if (!raw) return;
        const tokens = raw.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
        const valid = [...new Set(tokens.filter((s) => /^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(s)))];
        if (!valid.length) {
          say("Enter a valid ticker symbol, e.g. MU or NVDA.");
          return;
        }
        const toAdd = valid.filter((s) => !W.has(s));
        if (!toAdd.length) {
          selectedSaved = valid[0];
          if (input) input.value = "";
          render(W.list());
          say(`${valid[0]} is already on your watchlist.`);
          return;
        }
        const rows = toAdd.map((s) => ({ symbol: s, name: (desk[s] && desk[s].name) || "", page: "watchlist" }));
        selectedSaved = toAdd[0];
        if (W.setSelected) W.setSelected(rows, true);
        else for (const r of rows) W.toggle(r.symbol, r.name);
        if (input) input.value = "";
        const outside = deskLoaded ? toAdd.filter((s) => !desk[s]) : [];
        const noteOut = outside.length ? ` (${outside.join(", ")} not in this week's universe)` : "";
        say(toAdd.length === 1 ? `Added ${toAdd[0]} to your watchlist.${noteOut}` : `Added ${toAdd.join(", ")} to your watchlist.${noteOut}`);
      });
    }
    if ($("wl-add-top5")) {
      $("wl-add-top5").addEventListener("click", () => {
        const top5 = shortlistPicks.slice(0, 5).map((s) => ({ symbol: s, name: (desk[s] && desk[s].name) || "", page: "watchlist" }));
        if (!top5.length) return;
        selectedSaved = top5[0].symbol;
        if (W.setSelected) W.setSelected(top5, true);
        else for (const r of top5) if (!W.has(r.symbol)) W.toggle(r.symbol, r.name);
        say(`Added Top ${top5.length} Shortlist companies to your watchlist.`);
      });
    }
    if ($("wl-go-timing")) {
      $("wl-go-timing").addEventListener("click", () => setTab("timing"));
    }
    if ($("wl-tab-saved") && $("wl-tab-timing")) {
      $("wl-tab-saved").addEventListener("click", () => setTab("saved"));
      $("wl-tab-timing").addEventListener("click", () => setTab("timing"));
    }
    sharedSymbols = parseSharedQuery();
    renderSharedBanner();
    if (globalThis.location && globalThis.location.hash === "#timing") {
      setTab("timing");
    }
    W.onChange(render);
    render(W.list());
    const get = (url) => fetch(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([
      get("./desk.json"),
      get("./earnings-calendar.json"),
      get("./trend-rules.json"),
      get("./ticker-sparks.json"),
      get("./watchlist-insiders.json"),
      get("./short-interest.json"),
    ]).then(([deskData, calendar, rules, lines, insData, siData]) => {
      desk = (deskData && deskData.companies) || {};
      deskLoaded = Boolean(deskData && deskData.companies);
      deskRunId = (deskData && deskData.run_id) || null;
      earnings = (calendar && calendar.companies) || {};
      if (!trend && rules && rules.schema === "trend-rules-2" && rules.signal_date && rules.rules) trend = rules;
      sparks = lines && lines.schema === "ticker-sparks-1" && lines.closes ? lines : null;
      insiders = insData && insData.schema === "watchlist-insiders-1" && insData.companies && (!deskRunId || insData.freeze_run_id === deskRunId)
        ? insData.companies : {};
      shortInterest = siData && siData.schema === "short-interest-1" && siData.rows ? siData.rows : {};
      shortInterestDate = (siData && siData.date) || "";
      members = {};
      const setups = (deskData && deskData.setups) || {};
      for (const [key, label] of [["strength", "Hot tape"], ["growth", "Growth"], ["undervalued", "Cheap"]]) {
        for (const r of (setups[key] && setups[key].results) || []) {
          if (!r || !r.symbol) continue;
          (members[r.symbol] = members[r.symbol] || { shortlist: null, lists: [] }).lists.push(label);
        }
      }
      for (const r of (setups.composite && setups.composite.results) || []) {
        if (r && r.symbol) (members[r.symbol] = members[r.symbol] || { shortlist: null, lists: [] }).shortlist = r.rank;
      }
      const shortlist = deskData && deskData.setups && deskData.setups.composite && deskData.setups.composite.results;
      shortlistAll = Array.isArray(shortlist) ? shortlist : [];
      const topTen = shortlistAll.slice(0, 10);
      shortlistPicks = topTen.map((row) => row.symbol).filter(Boolean);
      shortlistRanks = {};
      topTen.forEach((row, idx) => {
        if (row && row.symbol) shortlistRanks[row.symbol] = row.rank || idx + 1;
      });
      const asOf = Object.values(desk).find((c) => c && c.price_date);
      deskAsOf = (deskData && deskData.as_of) || (asOf && asOf.price_date) || null;
      if ($("wl-asof")) $("wl-asof").textContent = deskAsOf ? `Data as of ${longDay(deskAsOf)}` : "";
      const dl = $("wl-symbols");
      if (dl && typeof dl.replaceChildren === "function") {
        dl.replaceChildren(...Object.keys(desk).sort().map((sym) => {
          const opt = el("option");
          opt.value = sym;
          if (desk[sym] && desk[sym].name) opt.textContent = `${sym} — ${desk[sym].name}`;
          return opt;
        }));
      }
      const rulesOk = trend && deskRunId && trend.desk_run_id === deskRunId;
      if ($("wl-th-rules")) $("wl-th-rules").textContent = rulesOk ? `Trend · tested, ${shortDay(trend.signal_date)}` : "Trend · tested";
      $("wl-source").textContent = asOf
        ? `Lists, prices and 3- and 12-month returns: Research snapshot, close on ${longDay(asOf.price_date)}. `
          + `Trend: the three tested rules${rulesOk ? ` at the ${longDay(trend.signal_date)} month-end close` : ""} (price above 200-day, 12–1 month return above zero, 50-day above 200-day); the only per-stock signal that passed our test. `
          + "Revisions: 30-day EPS estimate changes, context only, not tested on our data."
        : "";
      renderSharedBanner();
      render(W.list());
    });
  }
  globalThis.TLWatchTiming = { computeIndicators };
  if (W && $("wl-rows")) setup();
})();
