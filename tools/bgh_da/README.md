# BGH Day-Ahead VWAP fetcher

Reads the Balkan Gas Hub **Day-Ahead VWAP (EUR/MWh)** from https://www.balkangashub.bg/public.

What was verified live (2026-11-17): the "Day Ahead" tab is active on load; the page has **no
zone selector** (one DA table for the BGH exchange, so "VTP Bulgaria" cannot be selected or
verified); the table comes from the page's own `POST /ajax/spotMarketData` with `type=DA`
(Intraday is `type=WD`). Six delivery days (12–17 Nov 2026) were checked against the table on screen and match
exactly. They are the fixtures in `tests/fixtures/bgh-*`.

```
python bgh_da_fetcher.py --mode http                 # stdlib only, for the daily job
pip install -r requirements.txt && python -m playwright install chromium
python bgh_da_fetcher.py --headed --verbose          # browser mode: clicks DA, cross-checks table
python bgh_da_fetcher.py --schema                    # JSON schema
python -m unittest test_bgh_da_fetcher.py
```

Outputs `tools/data/bgh_da_latest.json` and the shared `tools/data/gas_da.sqlite` (table `gas_da_price`, upsert keyed on exchange/product/zone/gas day; Romania writes to the same table).
Exit 0 = OK, 2 = NO_TRADE, 1 = SOURCE_ERROR (details in `data/bgh_da_last_error.json`,
screenshot/HTML in `debug/`). A gas day after today with no reference price yet is still trading
and is listed under `provisional_days`, never stored as a price.

The dashboard's Balkan map uses the same logic in `src/lib/prices/exchanges/bgh.ts`.

**Licence:** BGH's website terms restrict commercial reuse without written consent. Confirm
rights with BGH (or sign its public-data API agreement) before commercial/production use.
