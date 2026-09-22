"use strict";

function outlookEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function outlookPercent(value, points = false) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(100 * value).toFixed(1)}${points ? " pp" : "%"}` : "Unavailable";
}
function outlookValidity(report, desk, release) {
  if (report?.schema !== "outlook-12m-v1" || report.horizon_sessions !== 252) return "The outlook format needs updating.";
  if (report.run_id !== desk.run_id || report.as_of !== desk.as_of || release.run_id !== desk.run_id || report.snapshot_sha256 !== release.snapshot_sha256) return "The outlook is waiting for the current snapshot. Older estimates are hidden.";
  if (!Array.isArray(report.candidates) || report.candidates.length > 5) return "The outlook did not pass its checks.";
  if (report.candidates.some(r => ![r.total_low, r.total_median, r.total_high].every(Number.isFinite) || r.total_low < -1 || r.total_low > r.total_median || r.total_median > r.total_high || r.probability_beat_qqq !== null)) return "The outlook estimates did not pass their checks.";
  return null;
}
function outlookScenarios(row) {
  return `<div class="outlook-table"><table><caption>Conditional valuation scenarios · price return</caption><thead><tr><th>Case</th><th>Operating profit</th><th>EV multiple</th><th>Price return</th></tr></thead><tbody>${row.scenarios.map(s => `<tr><td>${outlookEscape(s.label)}</td><td>${outlookPercent(s.operating_profit_growth)}</td><td>${outlookPercent(s.ev_multiple_change)}</td><td>${outlookPercent(s.price_return)}</td></tr>`).join("")}</tbody></table></div><p>These are assumptions, not predicted business growth. Net debt and share count stay fixed; dividends are excluded. Missing debt or enterprise value leaves the scenario unavailable.</p>`;
}
function outlookCard(row) {
  const f = row.inputs;
  return `<article class="outlook-card">
    <div class="outlook-card-top"><span class="outlook-rank">${row.rank}</span><strong>${outlookEscape(row.symbol)}</strong><span>${outlookEscape(row.sector.replaceAll("_", " "))}</span></div>
    <h3>${outlookEscape(row.name)}</h3>
    <div class="outlook-estimate ${row.total_median < 0 ? "outlook-negative" : ""}">${outlookPercent(row.total_median)}</div>
    <p class="outlook-label">12-month return, model midpoint</p>
    <div class="outlook-range"><span>Low <b>${outlookPercent(row.total_low)}</b></span><span>High <b>${outlookPercent(row.total_high)}</b></span></div>
    <p class="outlook-label">Model low / high. The real result can be worse than low.</p>
    <p class="outlook-relative">Model vs QQQ: <strong>${outlookPercent(row.excess_median, true)}</strong></p>
    <dl class="outlook-facts"><div><dt>Revenue growth</dt><dd>${outlookPercent(f.revenue_yoy)}</dd></div><div><dt>Return on equity</dt><dd>${outlookPercent(f.return_on_equity)}</dd></div><div><dt>Cash / profit</dt><dd>${f.cash_conversion.toFixed(2)}×</dd></div></dl>
    <details><summary>Evidence, scenarios & risks</summary>
      <p>The rank is strength and ROE. The return model did not pick these names.</p>
      <p>Reference close: $${row.reference_price.toFixed(2)} on ${outlookEscape(row.price_date)}. Estimates use next-session entry; they are total returns, not share-price targets.</p>
      <p>Revenue quarter: ${outlookEscape(row.evidence.revenue_period_end)} · filed ${outlookEscape(row.evidence.revenue_filed)}. Quality filing: ${outlookEscape(row.evidence.quality_filed)}.</p>
      <p>Trailing earnings yield ${outlookPercent(f.earnings_yield)} · annualised volatility ${outlookPercent(f.volatility_252)} · liabilities/assets ${outlookPercent(f.leverage)}.</p>
      ${outlookScenarios(row)}
      <ul>${row.risks.map(r => `<li>${outlookEscape(r)}</li>`).join("")}</ul>
    </details>
  </article>`;
}
function outlookEvidence(report) {
  const summary = report.validation.summary;
  const rows = [["composite_60_40", "60/40 shortlist (default)"], ["momentum", "Momentum baseline"], ["quantile_trees", "Experimental AI"]];
  return `<details class="outlook-method"><summary>How it works & how it performed</summary>
    <p>${outlookEscape(report.selection)}</p><p>${outlookEscape(report.universe)}</p>
    <div class="outlook-table"><table><caption>Reconstructed 12-month, five-stock cohorts · same constraints · 0.20% assumed round-trip cost</caption><thead><tr><th>Method</th><th>Cohorts</th><th>Mean excess vs QQQ</th><th>Median excess vs QQQ</th><th>Worst holding drawdown</th></tr></thead><tbody>${rows.map(([key, label]) => { const r = summary[key]; return `<tr><td>${label}</td><td>${r.cohorts}</td><td>${outlookPercent(r.mean_excess_qqq_net, true)}</td><td>${outlookPercent(r.median_excess_qqq_net, true)}</td><td>${outlookPercent(r.worst_holding_drawdown)}</td></tr>`; }).join("")}</tbody></table></div>
    <p>For the default shortlist, the model's nominal 70% interval covered ${Number.isFinite(summary.composite_60_40.selected_range_coverage) ? (100 * summary.composite_60_40.selected_range_coverage).toFixed(0) + "%" : "an unavailable fraction"} of selected historical outcomes. Mean absolute central-estimate error: ${outlookPercent(summary.composite_60_40.selected_mean_absolute_error, true)}. Probabilities of beating QQQ are withheld.</p>
    <p>These monthly cohorts overlap for most of their holding periods. Returns are cohort averages, not an annualised portfolio return. Drawdown follows equal entry allocations held without rebalancing. No confidence or significance claim is made.</p>
    <p>Training: ${report.training_months} matured monthly cohorts, ${report.training_rows.toLocaleString()} company observations. Latest training exit: ${outlookEscape(report.latest_training_exit)}. All training outcomes precede their historical forecast dates.</p>
    <p>Total and excess returns are modelled separately; their medians do not add together as a forecast for QQQ. Values are before taxes and forecast costs; validation subtracts the displayed cost assumption.</p>
    <ul>${report.limitations.map(x => `<li>${outlookEscape(x)}</li>`).join("")}</ul>
    <p>Forecast ${outlookEscape(report.forecast_id)} · generated ${outlookEscape(report.generated_at.slice(0, 10))}. ${report.record_type === "retrospective_reconstruction" ? "Reconstructed after its signal date; excluded from any live track record." : "Recorded before the following Monday session."}</p>
    <a href="./outlook.json" download>Download this forecast and validation record</a>
  </details>`;
}
function renderOutlook(report, now = new Date()) {
  const age = Math.floor((now - new Date(`${report.as_of}T00:00:00Z`)) / 86400000);
  const caution = report.validation.model_beats_both_baselines
    ? "Experimental estimates. Historical coverage is incomplete, and no forecast probability is validated."
    : "Picked for strength and profitability, max two per sector. The return model is extra; it has not beaten those simple lists.";
  return `<div class="outlook-heading"><div><div class="eyebrow">RESEARCH SHORTLIST · 252 TRADING SESSIONS</div><h2>Five names, next 12 months</h2><p>Ranked by recent strength and profitability. The bands are a model, not a claim they beat QQQ.</p></div><span class="badge">Experimental</span></div>
    <p class="outlook-notice">${caution}</p>
    <p class="outlook-date">As of ${outlookEscape(report.as_of)} · ${report.candidate_count} passed the quality screen · max two per sector.${age > 7 ? " Over a week old." : ""}</p>
    ${report.record_type === "retrospective_reconstruction" ? '<p class="outlook-date">Filled in later from that Friday’s files, not issued that day.</p>' : ""}
    <div class="outlook-grid">${report.candidates.length ? report.candidates.map(outlookCard).join("") : '<p>No candidates passed the evidence and diversification checks.</p>'}</div>
    ${report.candidates.length < 5 ? '<p class="outlook-date">Fewer than five passed all selection constraints. The rules have not been relaxed.</p>' : ""}
    ${outlookEvidence(report)}`;
}
async function loadOutlook() {
  const root = document.getElementById("outlook");
  try {
    const [report, desk, release] = await Promise.all(["outlook.json", "desk.json", "release.json"].map(async file => {
      const response = await fetch(`./${file}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Outlook data unavailable.");
      return response.json();
    }));
    const invalid = outlookValidity(report, desk, release);
    if (invalid) throw new Error(invalid);
    root.innerHTML = renderOutlook(report);
  } catch (error) {
    root.textContent = `12-month outlook: ${error.message} Open Screener for the weekly lists.`;
  }
}
void loadOutlook();
