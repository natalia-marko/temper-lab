# Temper Lab — Opportunities snapshot

Read-only weekly lists: Strength, Growth, and Cheap on operating profit.

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
It builds the weekly freeze but does not export or publish this website. After
a successful run, export the snapshot and publish the changed `share/desk.json`.
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

From the Temper Lab factory, after a weekly freeze:

```bash
python tools/export_public_desk.py
# then copy share/ into this repository and push
```

When changing `desk.js` or `desk.css`, update its `?v=` value in `index.html` to
the first 12 characters of the file's SHA-256 hash. GitHub Pages caches assets
separately; versioned URLs prevent new HTML from loading a cached, incompatible
script. The source tests enforce these versions.

Full startup and filter regression checks (from the factory repository):

```bash
npm install --prefix /tmp/temper-dom-check --no-audit --no-fund jsdom@27.0.1
NODE_PATH=/tmp/temper-dom-check/node_modules node --test tests/public_desk.test.cjs tests/public_desk_startup.test.cjs
```
