# Temper Lab — Opportunities snapshot

Read-only weekly lists: Strength, Growth, and Cheap on operating profit.

Analyst ratings is a third page, `analyst-ratings.html`, listed in the sidebar
after Market mood. It filters Yahoo's five current-month rating counts for the
names appearing on at least two published screens, so it is a cross-screen
shortlist, not a fourth rank across the liquid universe. Buy share is Strong Buy plus Buy over all five
categories, including Hold, Sell, and Strong Sell. Counts are dated by retrieval
because Yahoo's summary carries no per-report publication dates, and a name
whose summary is missing is excluded rather than counted as zero votes. The view
refuses to render unless `market-mood.json`, `desk.json`, and `release.json`
agree on the same run, and unless its coverage reconciles with the cross-screen
count.

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
After a current screener passes, the release writes `market-mood.json` for the
same run. Cboe VIX history is fetched at export time; if it is unavailable, the
page leaves the VIX reading blank. If the mood export itself fails, the page
detects a stale run ID and waits for a matching refresh.
It stages and publishes the current screener only after its own checks pass.
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

## Custom domain later

1. Buy the domain.
2. In this repository, add a `CNAME` file whose only line is the domain (`desk.example.com`).
3. GitHub → Settings → Pages → Custom domain. GitHub will issue HTTPS.
4. At the registrar, add a CNAME record to `natalia-marko.github.io`.

Do not point the domain at a Cloudflare quick tunnel. This Pages site is the durable host.

## Update the snapshot

From the Temper Lab factory, after a weekly freeze, use the staged release
command so the prior public snapshot remains available if a current check
fails:

```bash
python tools/release_weekly.py
# then copy share/ into this repository and push with the public-site workflow
```

When changing `desk.js` or `desk.css`, update its `?v=` value in `index.html` to
the first 12 characters of the file's SHA-256 hash. GitHub Pages caches assets
separately; versioned URLs prevent new HTML from loading a cached, incompatible
script. The source tests enforce these versions.
The Market mood page uses the same 12-character hashes for `desk.css`,
`market-mood.css`, and `market-mood.js`; the Analyst ratings page does the same
for `desk.css`, `analyst-ratings.css`, and `analyst-ratings.js`.

Full startup and filter regression checks (from the factory repository):

```bash
npm install --prefix /tmp/temper-dom-check --no-audit --no-fund jsdom@27.0.1
NODE_PATH=/tmp/temper-dom-check/node_modules node --test tests/public_desk.test.cjs tests/public_desk_startup.test.cjs
```
