// Dated manual evidence + transparent scenarios. No mutation of automatic ranks.
(function () {
  "use strict";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const pc = (v) => finite(v) ? `${(v * 100).toFixed(1)}%` : "unavailable";
  const usd = (v) => finite(v) ? new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:1}).format(v) : "unavailable";
  const dollars = (v) => finite(v) ? `$${v.toFixed(2)}` : "unavailable";
  const safeUrl = (url) => typeof url === "string" && /^https:\/\/[a-z0-9.-]+(?::443)?\//i.test(url) ? url : null;
  const link = (url, title) => safeUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>` : esc(title);
  const addDays = (s, days) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10); };
  const dateLabel = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-GB", {day:"numeric",month:"short",timeZone:"UTC"});

  function compatible(review, desk, hash) {
    return !!(review && desk && review.schema === "risk-review-1" && review.as_of === desk.as_of &&
      review.desk_run_id === desk.run_id && (!hash || review.snapshot_sha256 === hash) &&
      Array.isArray(review.top) && review.top.join() === (desk.setups?.composite?.results || []).slice(0,10).map(r => r.symbol).join());
  }
  function sourceLink(review, id) {
    const s = review.sources?.[id];
    return s ? `${link(s.url, s.title)} <small>${esc(s.published || `checked ${s.checked}`)}</small>` : "Source not recorded";
  }
  function mergeCalendar(calendar, review, today) {
    if (!calendar || !review || today > review.review_due || today < review.reviewed_on) return calendar;
    const companies = {...calendar.companies};
    for (const [symbol, e] of Object.entries(review.events || {})) {
      const s = review.sources?.[e.source];
      if (e.status !== "issuer_confirmed" || !s || !safeUrl(s.url) || (s.published && s.published > review.reviewed_on)) continue;
      const old = companies[symbol];
      // Keep an actual newer issuer update; old review must not overwrite it.
      if (old?.confirmed_at && old.confirmed_at > review.reviewed_on) continue;
      companies[symbol] = {...old, date:e.date, timing:e.timing, unsure:false,
        confirmation:"issuer_confirmed", source_url:s.url, confirmed_at:review.reviewed_on,
        source_published:s.published, call_date:e.call_date, vendor_date:old?.date,
        vendor_unsure:old?.unsure || false};
    }
    return {...calendar, companies};
  }
  function eventFor(symbol, calendar, review) {
    const r = review.events?.[symbol];
    const v = calendar?.companies?.[symbol];
    if (r?.status === "issuer_confirmed" && review.sources?.[r.source] && safeUrl(review.sources[r.source].url)) return r;
    if (v?.date) return {...v, status:"vendor_estimate", source:null};
    return r || null;
  }
  function eventSummary(symbols, calendar, review, from, to) {
    const rows = [...new Set(symbols)].map(symbol => ({symbol, ...eventFor(symbol, calendar, review)}))
      .filter(r => r.date && r.date >= from && r.date <= to).sort((a,b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
    const unknown = [...new Set(symbols)].filter(s => !eventFor(s, calendar, review)?.date);
    return {rows, confirmed:rows.filter(r => r.status === "issuer_confirmed").length, unknown};
  }
  function reviewDecision(c, hurdle) {
    if (!c || !finite(hurdle) || hurdle <= 0 || hurdle > 100) return "Review unavailable";
    if (c.method === "book") return "Separate insurer review";
    if (c.valuation_blocker) return "Defer: ownership bridge";
    const central = c.scenarios.find(x => x.label === "Historical median");
    const stress = c.scenarios.find(x => x.label === "OI −25%");
    if (!finite(central?.yield) || !finite(stress?.yield)) return "Defer: missing evidence";
    if (central.yield < hurdle / 100) return "Below review hurdle";
    return stress.yield >= hurdle / 100 ? "Meets illustrative hurdle" : "Conditional: stress fails";
  }
  function exposures(review, weights, options, eventRows) {
    const all = review.top;
    const required = ["hurdle", "energy_limit", "memory_limit", "single_limit", "event_limit", "shock", "loss_limit"];
    if (all.some(s => !finite(weights[s]) || weights[s] < 0 || weights[s] > 100) ||
        required.some(k => !finite(options[k]) || options[k] < 0 || options[k] > 100) || !options.hurdle) return {error:"Enter valid numbers from 0 to 100; the valuation hurdle must be above zero."};
    const total = all.reduce((n,s) => n + weights[s],0);
    if (total > 100 + 1e-8) return {error:`Weights total ${total.toFixed(1)}%. Reduce them to 100% or less.`};
    const groups = review.exposure_groups.map(g => {
      const members = [...new Set(g.symbols)].filter(s => all.includes(s));
      const weight = members.reduce((n,s) => n + weights[s],0);
      return {...g, weight, limit:options[g.limit_key], loss:weight * options.shock / 100,
        breach:weight > options[g.limit_key], lossBreach:weight * options.shock / 100 > options.loss_limit};
    });
    const eventWeight = [...new Set(eventRows.map(r => r.symbol))].reduce((n,s) => n + (weights[s] || 0),0);
    return {groups,total,cash:100-total,eventWeight,eventBreach:eventWeight > options.event_limit,
      singleBreaches:all.filter(s => weights[s] > options.single_limit),
      unknown:all.filter(s => !review.companies[s]?.drivers?.length),
      unmappedWeight:all.filter(s => !review.companies[s]?.drivers?.length).reduce((n,s) => n+weights[s],0)};
  }
  function companyHtml(symbol, review, hurdle = 10) {
    const c = review?.companies?.[symbol];
    if (!c) return `<section class="rr-company"><h3>Risk review</h3><p>Not reviewed for this snapshot. Absence of flags does not mean absence of risk.</p></section>`;
    const status = reviewDecision(c,hurdle);
    let html = `<section class="rr-company"><h3>Risk review · ${esc(review.reviewed_on)}</h3><p><strong>${esc(status)}</strong>. Review outcome only; automatic rank is unchanged.</p>`;
    if (c.missing_score_pillars.length) html += `<p class="rr-warning">${3-c.missing_score_pillars.length}/3 measured score inputs. The automatic score includes ${c.missing_score_pillars.length} neutral 50 substitution(s). This review never treats that substitution as valuation evidence.</p>`;
    html += `<p><strong>Economic drivers:</strong> ${esc(c.drivers?.join(" · ") || "Not mapped; exposure unreviewed")}</p>`;
    if (c.claims.length) html += `<ul class="rr-claims">${c.claims.map(x => `<li><strong>${esc(x.title)}</strong> <span class="rr-status">${esc(x.status)}</span><p>${esc(x.text)}</p><small>${x.sources.map(id => sourceLink(review,id)).join(" · ")}</small></li>`).join("")}</ul>`;
    if (c.method === "book") {
      html += `<h4>Manual insurer valuation</h4><p>Book equity ${usd(c.book_equity)} at ${esc(c.manual.period_end)}; price/book <strong>${c.price_book?.toFixed(2) ?? "unavailable"}×</strong>. Q2 combined ratio ${pc(c.manual.combined_ratio)}.</p><p>Illustrative values at 1.5 / 2 / 2.5× book: <strong>${(c.book_prices_1_5_2_2_5x || []).map(dollars).join(" / ")}</strong> per current share; snapshot price ${dollars(c.price)}.</p><p>${esc(c.manual.note)} No OI/EV qualification is assigned. ${sourceLink(review,c.manual.source)}</p>`;
    } else {
      html += `<h4>Valuation sensitivity</h4><p>${esc(c.history_basis)}. Current revenue ${usd(c.ttm_revenue)}; operating income ${usd(c.ttm_operating_income)}; EV ${usd(c.enterprise_value)}. Review hurdle: ${hurdle.toFixed(1)}% OI/EV (illustrative).</p>`;
      if (c.manual) html += `<p>Manual reconstruction: cash ${usd(c.manual_cash)}, interest-bearing debt $0 at ${esc(c.manual.period_end)}. ${sourceLink(review,c.manual.source)}</p>`;
      html += `<div class="rr-scroll"><table><thead><tr><th>Scenario</th><th>Operating income</th><th>OI / EV</th><th>Equity/share at 6 / 8 / 10× OI</th></tr></thead><tbody>${c.scenarios.map(s => `<tr><th>${esc(s.label)}${finite(s.margin) ? `<small>margin ${pc(s.margin)}</small>` : ""}</th><td>${usd(s.operating_income)}</td><td>${pc(s.yield)}</td><td>${s.equity_prices_6_8_10x ? s.equity_prices_6_8_10x.map(dollars).join(" / ") : "Not meaningful / unavailable"}</td></tr>`).join("")}</tbody></table></div>`;
      html += `<p class="rr-note">Snapshot price ${dollars(c.price)}. ${esc(c.shares_basis)}. ${c.limits.map(esc).join(" ")}</p>`;
      if (c.history.length) html += `<details><summary>Audit historical inputs (${c.history.length} fiscal years)</summary><div class="rr-scroll"><table><thead><tr><th>Period end</th><th>Revenue</th><th>Operating income</th><th>Margin</th><th>Filing</th></tr></thead><tbody>${c.history.map(h => `<tr><td>${esc(h.end)}</td><td>${usd(h.revenue)}</td><td>${usd(h.operating_income)}</td><td>${pc(h.margin)}</td><td>${link(h.url,h.filed)}</td></tr>`).join("")}</tbody></table></div><p>Revenue and operating income paired within the same filing and annual period; no filings after ${esc(review.as_of)}. Revenue is reconstructed from the snapshot OI and operating margin. No cash-flow or capex forecast is implied.</p></details>`;
    }
    if (c.consensus?.estimates?.length) html += `<details><summary>Check the quoted earnings multiple</summary><p>${esc(c.consensus.basis)} Collected ${esc(c.consensus.retrieved_at)}.</p><p>${c.consensus.estimates.map(x => `${x.period === "0y" ? "Current FY" : "Next FY"}: EPS $${x.eps.toFixed(2)}, price/EPS ${x.price_eps.toFixed(2)}× (${x.analysts} analysts)`).join("; ")}. ${link(c.consensus.url,"Yahoo analysis")}</p><p>These arithmetic checks do not validate the forecast. A missing valuation pillar never proves overvaluation.</p></details>`;
    return html + "</section>";
  }
  function summaryHtml(review, calendar, weights, options) {
    const from = review.reviewed_on, to = addDays(from,14);
    const events = eventSummary(review.top,calendar,review,from,to);
    const exposure = exposures(review,weights,options,events.rows);
    const missing = review.top.filter(s => review.companies[s].missing_score_pillars.includes("undervalued"));
    let html = `<p><strong>${events.rows.length} of ${review.top.length}</strong> names have results ${dateLabel(from)}–${dateLabel(to)}: ${events.confirmed} issuer-confirmed, ${events.rows.length-events.confirmed} estimated. ${missing.length} automatic scores contain a missing valuation input (${missing.map(esc).join(", ") || "none"}).</p>`;
    if (exposure.error) return html + `<p class="rr-warning" role="alert">${esc(exposure.error)} Exposure conclusions are unavailable.</p>`;
    html += `<p class="rr-warning">Event cluster: ${exposure.eventWeight.toFixed(1)}% of illustrated capital reports in this window${exposure.eventBreach ? ` — exceeds the ${options.event_limit}% example budget` : ""}. Earnings gaps can exceed the assumed drawdown.</p>`;
    html += `<div class="rr-scroll"><table><thead><tr><th>Shared driver</th><th>Weight / budget</th><th>Loss at ${options.shock}% stock drawdown / budget</th></tr></thead><tbody>${exposure.groups.map(g => `<tr><th>${esc(g.label)}<small>${esc(g.symbols.join(", "))}</small></th><td>${g.weight.toFixed(1)}% / ${g.limit}% <strong>${g.breach ? "Over budget" : "Within example"}</strong></td><td>${g.loss.toFixed(1)}% / ${options.loss_limit}% <strong>${g.lossBreach ? "Over budget" : "Within example"}</strong></td></tr>`).join("")}</tbody></table></div><p class="rr-note">Illustrated holdings ${exposure.total.toFixed(1)}%; cash ${exposure.cash.toFixed(1)}%. Gross weights count each holding once within a group; groups overlap and must not be added. Shipping and production have distinct sensitivities; no hedge is assumed. Stock shocks are scenarios, not worst-case limits.</p>`;
    if (exposure.singleBreaches.length) html += `<p class="rr-warning">Above single-name budget ${options.single_limit}%: ${exposure.singleBreaches.map(esc).join(", ")}.</p>`;
    if (exposure.unknown.length) html += `<p class="rr-warning">Unmapped exposures: ${exposure.unknown.map(esc).join(", ")} (${exposure.unmappedWeight.toFixed(1)}%); no all-clear can be given.</p>`;
    html += `<details><summary>Dates and company confirmations</summary><ul>${events.rows.map(e => `<li><strong>${esc(e.symbol)}</strong> ${esc(e.date)} ${esc(e.timing || "time unverified")} · ${e.status === "issuer_confirmed" ? "Issuer-confirmed" : "Estimated"}${e.call_date && e.call_date !== e.date ? `; conference call ${esc(e.call_date)}` : ""}. ${e.source ? sourceLink(review,e.source) : esc(e.note || "Yahoo calendar")}</li>`).join("")}</ul><p>Outside this window: ${review.top.filter(s => !events.rows.some(e => e.symbol===s)).map(s => {const e=eventFor(s,calendar,review); return `${esc(s)} ${esc(e?.date || "no date found")} (${e?.status === "issuer_confirmed" ? "confirmed" : "unconfirmed"})`;}).join("; ")}. Missing dates do not establish that no event is coming.</p></details>`;
    html += `<details><summary>Decision review of all ten</summary><p>Outcomes compare historical-median and −25% operating-income scenarios with the illustrative hurdle. They do not certify investability; flags, cash flow and sector methods still need judgment.</p><div class="rr-scroll"><table><thead><tr><th>Company</th><th>Drivers</th><th>Review outcome</th></tr></thead><tbody>${review.top.map(s => `<tr><td><button type="button" data-review-company="${esc(s)}">${esc(s)}</button></td><td>${esc(review.companies[s].drivers?.join(" · ") || "Unmapped")}</td><td>${esc(reviewDecision(review.companies[s],options.hurdle))}</td></tr>`).join("")}</tbody></table></div></details>`;
    html += `<details><summary>Cheap sensitivity coverage — all ${review.cheap.length} names</summary><p>Historical margins and −25%/−50% OI tests are available in each company panel. Exposure mappings are reviewed for the top ten only; other names remain unmapped.</p><div class="rr-scroll"><table><thead><tr><th>Company</th><th>Trailing OI/EV</th><th>Historical median</th><th>OI −50%</th><th>Outcome</th></tr></thead><tbody>${review.cheap.map(s=>{const c=review.companies[s]; const val=l=>pc(c.scenarios.find(x=>x.label===l)?.yield); return `<tr><td><button type="button" data-review-company="${esc(s)}">${esc(s)}</button></td><td>${val("Trailing")}</td><td>${val("Historical median")}</td><td>${val("OI −50%")}</td><td>${esc(reviewDecision(c,options.hurdle))}</td></tr>`;}).join("")}</tbody></table></div></details>`;
    return html;
  }
  let mounted = null;
  let current = null;
  function mount(root, review, calendar, desk, openCompany, today) {
    if (!root) return;
    if (!compatible(review,desk)) {
      root.innerHTML = '<h2>Risk review</h2><p class="rr-warning">Review unavailable for this snapshot. No risk clearance is implied.</p>';
      return;
    }
    if (mounted !== review) {
      mounted = review;
      current = {weights:Object.fromEntries(review.top.map(s=>[s,100/review.top.length])),options:{...review.defaults}};
      const labels = {hurdle:"OI/EV hurdle %",energy_limit:"Energy/shipping weight limit %",memory_limit:"Memory weight limit %",single_limit:"Single-name weight limit %",event_limit:"Event-window weight limit %",shock:"Assumed stock drawdown %",loss_limit:"Driver portfolio-loss limit %"};
      root.innerHTML = `<h2>Before choosing from this list</h2><p class="rr-note">Review ${esc(review.reviewed_on)} · financial snapshot ${esc(review.as_of)}. Editable equal-weight illustration, not your portfolio. Example budgets and multiples are assumptions, not recommendations. Automatic ranks are unchanged.</p><p id="rr-stale" class="rr-warning" hidden></p><div id="rr-results"></div><details><summary>Edit illustrated weights and review thresholds</summary><p>Weights may total less than 100% (the rest is cash). Edits last for this page session.</p><div class="rr-inputs">${review.top.map(s=>`<label>${esc(s)} weight %<input type="number" min="0" max="100" step="0.1" data-weight="${esc(s)}" value="${current.weights[s]}"></label>`).join("")}</div><div class="rr-inputs">${Object.entries(labels).map(([k,label])=>`<label>${esc(label)}<input type="number" min="${k==='hurdle'?'0.1':'0'}" max="100" step="0.1" data-option="${k}" value="${current.options[k]}"></label>`).join("")}</div><button type="button" data-rr-reset>Reset illustration</button></details>`;
      root.onchange = e => {
        const t=e.target; const value=t.value.trim()==="" ? NaN : Number(t.value);
        if (t.dataset.weight) current.weights[t.dataset.weight]=value;
        if (t.dataset.option) current.options[t.dataset.option]=value;
        root.querySelector("#rr-results").innerHTML=summaryHtml(review,calendar,current.weights,current.options);
      };
      root.onclick = e => {
        const btn=e.target.closest("button[data-review-company]");
        if (btn) openCompany(btn.dataset.reviewCompany);
        if (e.target.closest("[data-rr-reset]")) {mounted=null;mount(root,review,calendar,desk,openCompany,today);}
      };
    }
    const stale=root.querySelector("#rr-stale");
    stale.hidden=today<=review.review_due;
    stale.textContent=`Review is overdue (due ${review.review_due}). Values below describe the dated review, not current clearance; refresh sources before a decision.`;
    root.querySelector("#rr-results").innerHTML=summaryHtml(review,calendar,current.weights,current.options);
  }
  globalThis.TLRisk={compatible,mergeCalendar,eventFor,eventSummary,reviewDecision,exposures,companyHtml,summaryHtml,mount,
    hurdle:()=>current?.options.hurdle ?? 10, safeUrl};
})();
