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

Insights is a fourth page, `insights.html` (with `ownership.js` and
`ownership.css`). It reads only `ownership-signals.json` (Ownership Signals):
SEC Form 4 and Form 5 trades for every issuer in the security mapping over the
last 21 trading days by New York filing day, with "Eligible stocks only" on by
default, an "On my lists" filter, "New this week" and search. Five tabs — 5%+ stakes (Schedule 13D/13G: stake %, holder, new or amendment, 5%-or-less exits, the holder's stated purpose), All
(by signal type — buy clusters, single buys, sales without a plan, big holders,
then planned or routine sales — and newest filing within each), Buys (by evidence, then amount), Sells (sales without a
10b5-1 plan first, then by amount) and Big holders (10% owners and funds, by
amount). Each row has the ticker with its list rank, price and market cap; a
signal label (Executive buy cluster, Buy cluster, Executive or Director buy,
Discretionary sell, Planned / routine, Big holder buying or selling); a "why it
matters" line in the filings' terms (who, amount, days, median holding change,
plan status, plan adoption date when a footnote states it) with the evidence
labels; one comparable dollar amount with a short holding change; and the
filing date with NEW (hidden while "New this week" is on). Planned / routine
rows are lighter. Transfers,
private trades and awards, exercises, gifts or tax withholding sit in a "Not
counted" box with a link to see them. Evidence is how many of three facts hold
(several insiders within 10 sessions; CEO or CFO; a holding up 5%+ or new on
$50K+), not a score.

Clicking a row opens a panel (beside the list on screens 1,600px wide or more,
showing the first row on load; over the list below that) with Overview, Filings and Insiders
tabs: the signal card with tiles, why it is listed, a 3-month price line against
QQQ with the first filing and trade dates marked, the change since the first
filing (trading days that have passed only), the prices reported, who traded,
screener membership, what the filings cannot tell, "Open in Research" for
eligible stocks (Research reads `?q=TICKER`) and SEC links. Codes P and S do not
prove an open-market trade. Joint filers and restating amendments are counted
once; partial amendments, identical trades by unrelated filers, other share
classes and implausible prices stay out of totals until checked. Names appear as
filed. Values are set as text and links go only to sec.gov or this site. See
the product's `docs/ownership-signals-v1.md` for methodology and limits.

Jev reads is the fifth page, `jev-reads.html`, after Insights in the sidebar.
It shows one published week of earnings releases (SEC 8-K Item 2.02) from companies in the
screener universe, each read by Jev, an AI model, with a short verbatim quote, the SEC link, the
3-day reaction versus SPY and the Python floor. Smaller companies are read but only counted.
Data: `jev-reads.json` (index: weeks, late reactions, tracking, the 2023-25 test) and
`jev-reads/<Friday>.json` (one file per week, never rewritten), written by
`python -m jev.public_page` after the Saturday Jev run. The page does not call the model.

The Research table has an F-Score column on every view (`fscore.css`, data `fscore.json`, written by
`tools/build_fscore.py` in the weekly job): Piotroski's nine financial-health checks from the latest
10-K known on the snapshot date, on the standard 0-9 scale (a check that cannot be computed counts as
not passed and the score gets a *), with each check in the company panel. Context, not a signal (Leg D found no reliable return edge). The page ignores an
`fscore.json` whose date differs from `desk.json`.

Ticker is a page of its own, `ticker.html?t=UBER` (`ticker.js`, `ticker.css`), right after Research in the
sidebar: one company with every saved fact and its date. It only reads files other pages already publish —
`desk.json` (price, lists, analysts, Research figures; Research stocks only), `fscore.json` (hidden when its
date differs from `desk.json`), `earnings-calendar.json`, `ownership-signals.json` (Form 4 trades with plan
status, 13D/13G stakes, FINRA short interest for every issuer) — plus `ticker-volume.json`, written by
`tools/build_ticker_volume.py` in the weekly job: last week's and last month's average volume against the
63 sessions before the last 21, and the share of volume traded on up days (above 50% = OBV rose), cut at the
freeze Friday because a later bar can be a partial day. The same file carries the 3-month price chart: QQQ's
last 64 sessions to the freeze Friday as the date axis, QQQ's and each stock's adjusted closes on it (Insights
rules: four significant digits; no line with fewer than half the days or a one-day move beyond 3x). The page
reads top-down: header (next results date, list ranks against last week), a summary strip with one dated line
per section, then price and trading, the business (Research stocks only; price / earnings and EV / operating
income are the only ratios worked out on the page, from one Research record, and not shown for a loss), and
who owns and trades it; method notes sit in "About the data". Fund holdings come from `ticker-funds.json`, written
by hand each quarter with `tools/build_ticker_funds.py` once SEC posts a new 13F data set: per stock, the
13F managers that filed for both of the last two quarters — how many hold it, shares and value, how many
are new, added, cut or sold out, and the five largest increases and decreases by shares. Same CUSIP links
as the 13F Gate 2 research; the latest restatement in each data set; managers whose table in SEC's data
set is incomplete (fewer rows than 90% of the entries the filing declares) are not compared; positions
whose reported value does not match their shares, or whose shares were restated for a split after the
quarter, are left out and counted. Facts, not a buy or sell call (Gate 2 found no return edge in holder counts). Insights rows and
Watchlist names link to the page.

Watchlist is the sixth page, `watchlist.html`, last in the sidebar. `watchlist.js` (loaded first on
every page) puts a star next to each ticker; starred names are kept in the browser's localStorage
(key `temperlab.watchlist.v1`), so each browser and site address has its own list and nothing is
sent anywhere. `watchlist-page.js` lists them with the Research snapshot price and the next results
date, and exports or imports a JSON copy.
Watchlist edits re-read the saved list before changing it, so an older tab keeps
names added in another tab. Saves are checked by reading them back. If storage
fails, the current list stays available in the page and a warning offers an
immediate export; unreadable saved data is not replaced. Clearing site data
still removes browser-local lists, so keep an exported copy as a backup.

The Market desk panel "Results in the next 4 weeks" (`earnings-ahead.js`) reads
`earnings-calendar.json`, written by `tools/build_earnings_calendar.py` in the Tue/Fri job: Yahoo's
earnings calendar, company-page dates for the gaps; dates where the two differ are marked with ~.
For planning, not a signal (Leg D found no drift after results).

The separate Market mood page uses the same frozen Friday. **Market desk** shows
SPY/QQQ adjusted-return paths, positive-return participation, return bands and
sector medians. The 63/252-session controls update every chart together. The
date slider and pointer inspection show saved index observations. Stock returns
come from frozen company factors; index paths come from the saved benchmark
prices. Sector medians use individual stock returns and the same `sectors.js`
industry map as Research and Analyst ratings. Missing daily prices remain gaps;
missing observations are never filled. Cboe VIX and cross-screen changes sit
in a compact summary below the page heading, visible in both Market desk and
Lists. This weekly context stays above the return-window controls. VIX is
non-directional and does not rank individual stocks.

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
Insights is a separate `com.temperlab.ownership` job, Tuesday and Friday at
08:00, refreshing `ownership-signals.json` and emailing the new filings; the
Saturday release rebuilds it from saved SEC files on the new freeze. SMTP for
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
`market-mood.css`, `sectors.js`, and `market-mood.js`; the Analyst ratings page does the same
for `desk.css`, `analyst-ratings.css`, and `analyst-ratings.js`.

Public-page logic and markup regression checks (from the product repository):

```bash
node --test tools/tests/public_desk.test.cjs tools/tests/analyst_ratings.test.cjs tools/tests/market_mood.test.cjs tools/tests/outlook.test.cjs tools/tests/ownership.test.cjs tools/tests/jev_reads.test.cjs
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
