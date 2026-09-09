# Temper Lab — Opportunities snapshot

Read-only weekly lists: Strength, Growth, and Cheap on operating profit.

This is a static snapshot of the research desk. It does not run the Python factory, download prices, or save ideas.

Industry labels appear beneath company names. Filter by industry or search by
company, ticker or industry. These filters respect the selected screening scope;
rank and score remain those of the original screening universe. Industry option
counts reflect the current scope and search. Clear filters resets industry and
search together.

The exporter fills legacy missing labels from the latest saved Nasdaq listing
snapshot on or before the ranking date, preserving existing frozen labels.
Missing classifications stay visible as “industry unavailable”.

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
