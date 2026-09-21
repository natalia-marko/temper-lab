# Temper Lab — Opportunities snapshot

Read-only weekly lists: Strength, Growth, Cheap on operating profit, and Conviction.

**Conviction** ranks the shared eligible universe with at least five analyst
ratings and usable inputs: 50% strong-buy-share percentile plus 50% current
fiscal-year (`0y`) EPS revision-breadth percentile. Breadth is `(up − down) /
(up + down)` over 30 days; no revisions is neutral zero, missing data is excluded.
It publishes the top 10%, with a 50-name floor and 150-name cap when available.
Average ranks handle ties, so even the highest composite score need not reach 100.
The raw counts matter: one upward revision and ten upward revisions both have
breadth 1. These are research signals, not probabilities or a history of upgrades.

Use Conviction to find analyst-supported candidates, then inspect Quality and
Valuation. Or keep the Growth/Cheap list and select **Analysts** to inspect its
sentiment without changing its original ranks. Collection dates are shown
separately from the price date: a Monday capture was not known at Friday's close.
Earlier weeks without saved analyst data stay empty. Conviction does not enter
the three-list Composite or the Analyst ratings page's overlap cohort.

The homepage also shows a separate experimental **12-month outlook** with
five quality-and-momentum candidates, model return ranges, conditional valuation
scenarios and disclosed validation results. The model is not promoted to the
selection rule and no win probability is claimed. `outlook.json` must identify
the same run and snapshot hash as `desk.json` and `release.json`; mismatches
hide the estimates. See `research_engine/docs/outlook-12m.md` in the factory
repository for methodology, limitations, dependencies and verification.

Analyst ratings is a third page, `analyst-ratings.html`, listed in the sidebar
after Market mood. It filters Yahoo's five current-month rating counts for the
names appearing on at least two published screens, so it is a cross-screen
shortlist, distinct from the Conviction rank across the liquid universe. Buy share is Strong Buy plus Buy over all five
categories, including Hold, Sell, and Strong Sell. Buy share Δ is this month’s
buy share minus the previous month’s, in percentage points; a missing month is
shown as n/a, not zero. Target median and implied upside use the freeze Friday
close, not Yahoo’s live price. Positive implied upside is the usual sell-side
stance, not a cheapness signal. Counts and targets are dated by retrieval
because Yahoo's summary carries no per-report publication dates, and a name
whose summary is missing is excluded rather than counted as zero votes. The view
refuses to render unless `market-mood.json`, `desk.json`, and `release.json`
agree on the same run, and unless its coverage reconciles with the cross-screen
count. The sortable dated Close column sits immediately before Target median
and displays the frozen reference close used in implied upside. Its date follows
the snapshot; unavailable closes display n/a and sort last in either direction.

Insights is a fourth page, `insights.html`, not a rank. It overlays parsed SEC
Form 4 / 13D / 13G events on this week’s published Strength, Growth, and Cheap
names. The table shows ticker, bought/sold, who (person vs institution, then
director or officer title from the Form 4), trade dollars, dollars as a fraction
of freeze Friday market cap (sells negative), and the 21-session freeze-Friday
return labeled as past-month tape. That month window is not Hot tape’s 63-session
leg. Open-market buys are Form 4 code P of at least $50,000 (dollars) and 13D
filings with an open-market cash price near the freeze close. Warrant conversions
and 13G 5% ownership levels are listed as other filings, not buys. Dates are SEC
acceptance times. Empty means no qualifying trade in the window after a fetch.
The page refuses to render unless `insights.json` matches `desk.json` and
`release.json` on the same freeze. Conviction is not this list.

The separate Market mood page uses the same frozen Friday. It shows Cboe VIX
closing implied volatility, SPY/QQQ adjusted-close returns, the share of liquid
names up over 63 QQQ sessions, and the ten highest 63-session stock
returns among names with a full price window. Hot Tape ranks both 63- and
252-session returns, so an extreme's Hot Tape rank is shown only when the stock
actually appears in the published Hot Tape slice. VIX is non-directional and
does not rank individual stocks.

The same page also shows the first ten ranks from Growth and Cheap on operating
profit. Growth displays ROE beside its rank after its revenue, profit, and base
revenue gates; Cheap displays TTM operating income / EV beside its own rank.
These are screen ranks, not the largest stock returns or comparable scores.

This is a static snapshot of the research desk. It does not run the Python factory, download prices, or save ideas.

Industry has its own column beside Company in every screener view. Use the
dropdown in its heading to filter, or choose All industries to reset it. Search
also accepts company, ticker or industry. Both respect the selected screening
scope; rank and score remain those of the original screening universe. Industry
option counts reflect the current scope and search.

The exporter fills legacy missing labels from the latest saved Nasdaq listing
snapshot on or before the ranking date, preserving existing frozen labels.
Missing classifications stay visible as “industry unavailable”.

## Data dates and refresh schedule

The header shows **Data as of** from the weekly freeze's `as_of`, separately from
**Snapshot built** from its `recorded_at`. A rebuild or publication does not
advance the underlying ranking date. Fundamentals retain their own filing periods.

The full research job is installed as `com.temperlab.weekly`: Saturday at 08:00
in the Mac's local timezone (currently Copenhagen), running `run_weekly.sh`.
Ownership insights is a separate `com.temperlab.ownership` job, Tuesday and
Friday at 08:00, overlaying parsed Form 4 / 13D trades on that freeze. SMTP for
that mail lives in the factory file `config/digest.local.env`, not in `.zshrc`.
After a current screener passes, the release writes `market-mood.json` for the
same run. Cboe VIX history is fetched at export time; if it is unavailable, the
page leaves the VIX reading blank. If the mood export itself fails, the page
detects a stale run ID and waits for a matching refresh.
It stages and publishes the current screener only after its own checks pass.
Here, release promotion means writing the validated files to the factory's
local `share/` folder. Updating this website still requires the separate
`tools/publish_public_site.sh` upload; a successful local job is not a deployment.
The weekly and release gates require QQQ, SPY, market features, growth rankings,
and the research panel to agree on the latest stock session in the latest
completed calendar week. A wholly stale lake fails; a Friday holiday can use
Thursday's session. Fundamentals keep their independent filing dates.
Historical comparison runs afterward as a separate validation phase. A failed
comparison leaves the current screener published and records a failed
validation status in `release.json`.
For this weekly screener, one successful refresh and publication each week is
the intended routine; a midweek rebuild still uses the latest completed week.

The separate `com.temperlab.refresh` job checks every 15 minutes for a due
Tuesday–Saturday 06:30 Copenhagen refresh. That job covers the ten-stock trial,
not this full-universe website. These are Mac jobs, so they need the logged-in
machine and connectivity; GitHub Pages only serves the published snapshot.

## Address

https://temper-lab.com

## Hosting

The public address is `https://temper-lab.com`, recorded in `CNAME`. GitHub
Pages serves the separately published site. Keep this file when publishing;
the local dashboard and temporary preview tunnels are separate from that host.

## Update the snapshot

From the Temper Lab factory, after a weekly freeze, use the staged release
command so the prior public snapshot remains available if a current check
fails:

```bash
python tools/release_weekly.py
# then copy share/ into this repository and push with the public-site workflow
```

After an interrupted weekly run, rerun `./run_weekly.sh` in the factory on the
same day. Completed stock and SEC batches are reused. Benchmark `--resume`
reuses an identical completed request and replaces the yearly benchmark files
when a new week must be saved, including recovery from a partially saved run.

When changing `desk.js` or `desk.css`, update its `?v=` value in `index.html` to
the first 12 characters of the file's SHA-256 hash. GitHub Pages caches assets
separately; versioned URLs prevent new HTML from loading a cached, incompatible
script. The source tests enforce these versions.
The Market mood page uses the same 12-character hashes for `desk.css`,
`market-mood.css`, and `market-mood.js`; the Analyst ratings page does the same
for `desk.css`, `analyst-ratings.css`, and `analyst-ratings.js`.

Public-page logic and markup regression checks (from the factory repository):

```bash
node --test tools/tests/public_desk.test.cjs tools/tests/analyst_ratings.test.cjs tools/tests/market_mood.test.cjs tools/tests/outlook.test.cjs
```

These use Node's built-in test runner; no extra DOM package is needed. They
do not replace browser layout testing. The factory's `short_commands.md`
contains the complete release gate and publication commands.

## Potential research

Choose **Inspect → Potential research** or the **Potential research** status
filter to review the liquid universe without a Potential score. Select a company
for revenue history, funding, share growth, review sources and milestones. Search
also accepts researched tags such as `quantum`. Inactive names stay visible.

The four screeners retain their logic. The two-report Growth confirmation is a
research graduation flag; it does not replace Growth membership. Reviews may be
newer than Friday prices and show their own recording time. Statuses are
experimental and have no demonstrated predictive value. Older freezes that lack
this evidence display no invented status.
