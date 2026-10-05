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

The homepage opens on **Screener**. **Experiment** holds the 12-month outlook and
Potential research, which are not ranks. The outlook shows
five quality-and-momentum candidates, model return ranges, conditional valuation
scenarios and disclosed validation results. The model is not promoted to the
selection rule and no win probability is claimed. `outlook.json` must identify
the same run and snapshot hash as `desk.json` and `release.json`; mismatches
hide the estimates. See `pipeline/docs/outlook-12m.md` in the product
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

Insights is a fourth page, `insights.html`, showing a company research queue
across the full frozen eligible universe. It reads `insights-research.json`.
It has three tabs — All activity, Buying (default) and Selling — each one
compact table with one row per company and only the columns that fit it,
including Who: each insider's highest role (CEO or CFO, other officer, 10%
owner, director), with joint filers counted once. A row of filter chips with
counts is grouped under Role, Participation, and On screener.
The overview shows buying versus selling as shares of included dollar totals
across the whole eligible universe and trade window, independent of filters.
Its other cards open companies with several insiders buying, CEO/CFO purchases,
or unresolved records. Counts are companies, not filings. Unresolved amounts
are excluded; zero total activity has no percentage. Buying and Selling also
show up to three companies with the largest dollar totals in the current filters,
each opening the underlying filings. These are descriptive totals, not signal
rankings or claims of discretionary/open-market activity.
Clicking a company opens its filings
grouped by insider. Filing dates are New York time. One caveat line sits under
the title; the rest is in the "How to read this" footer. Small purchases are
retained; no $50,000 minimum applies. Code P/S does not establish open-market
execution. Whether activity is unusual for an insider is not computed in v1; no
return score or probability is implied. Ambiguous amendments and overlapping
ownership reports stay out of totals, tagged Partial; a link beside the company
count opens the Needs review list.

The page covers 21 exchange sessions through the completed UTC filing cutoff.
Trade dates, public acceptance times and research build time remain separate.
The browser and publishing gate reject incomplete or mismatched research data.
The older `insights.json` remains the legacy email digest with its existing
screen-list scope and minimum. See the product's
`docs/design/ownership-insights-v1.md` for methodology and limits.

Jev reads is the fifth page, `jev-reads.html`, last in the sidebar after Insights.
It shows one published week of earnings releases (SEC 8-K Item 2.02) from companies in the
screener universe, each read by Jev, an AI model, with a short verbatim quote, the SEC link, the
3-day reaction versus SPY and the Python floor. Smaller companies are read but only counted.
Data: `jev-reads.json` (index: weeks, late reactions, tracking, the 2023-25 test) and
`jev-reads/<Friday>.json` (one file per week, never rewritten), written by
`python -m jev.public_page` after the Saturday Jev run. The page does not call the model.

The separate Market mood page uses the same frozen Friday. **Tape** shows Cboe VIX,
the share of liquid names up over 63 sessions against the 252-session share, and
SPY versus QQQ. VIX is non-directional and does not rank individual stocks.

**Lists** shows who sits on more than one of Hot Tape, Growth, and Cheap versus
the prior Friday, then Conviction’s first ten. That score is not a probability
and does not enter the overlap. Growth and Cheap ranks stay on the Screener.

This is a static snapshot of the research desk. It does not run the Python product, download prices, or save ideas.

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
Friday at 08:00, refreshing the full-universe research queue and the legacy
email digest against that freeze. SMTP for
that mail lives in the product file `config/digest.local.env`, not in `.zshrc`.
After a current screener passes, the release writes `market-mood.json` for the
same run. Cboe VIX history is fetched at export time; if it is unavailable, the
page leaves the VIX reading blank. If the mood export itself fails, the page
detects a stale run ID and waits for a matching refresh.
It stages and publishes the current screener only after its own checks pass.
Here, release promotion means writing the validated files to the product's
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

The old ten-stock SQLite refresh job has been retired. The full-universe
Saturday job is the active data refresh; it needs the logged-in machine and
connectivity, while GitHub Pages only serves the published snapshot.

## Address

https://temper-lab.com

## Hosting

The public address is `https://temper-lab.com`, recorded in `CNAME`. GitHub
Pages serves the separately published site. Keep this file when publishing.
Preview these files locally with `./run_site_preview.sh` in the product repo.

## Update the snapshot

From the Temper Lab product, after a weekly freeze, use the staged release
command so the prior public snapshot remains available if a current check
fails:

```bash
python tools/release_weekly.py
# then copy share/ into this repository and push with the public-site workflow
```

After an interrupted weekly run, rerun `./run_weekly.sh` in the product on the
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

Public-page logic and markup regression checks (from the product repository):

```bash
node --test tools/tests/public_desk.test.cjs tools/tests/analyst_ratings.test.cjs tools/tests/market_mood.test.cjs tools/tests/outlook.test.cjs tools/tests/insights.test.cjs tools/tests/jev_reads.test.cjs
```

These use Node's built-in test runner; no extra DOM package is needed. They
do not replace browser layout testing. The product's `short_commands.md`
contains the complete release gate and publication commands.

## Potential research

Choose **Experiment → Potential research** to review the liquid universe without
a Potential score. Select a company
for revenue history, funding, share growth, review sources and milestones. Search
also accepts researched tags such as `quantum`. Inactive names stay visible.

The four screeners retain their logic. The two-report Growth confirmation is a
research graduation flag; it does not replace Growth membership. Reviews may be
newer than Friday prices and show their own recording time. Statuses are
experimental and have no demonstrated predictive value. Older freezes that lack
this evidence display no invented status.
