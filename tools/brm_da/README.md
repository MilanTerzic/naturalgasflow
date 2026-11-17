# BRM (Romania) Day-Ahead VWAP fetcher

Reads the **Bursa Română de Mărfuri gas Day-Ahead VWAP** (RON/MWh) and converts it to
**EUR/MWh** at the National Bank of Romania (BNR) EUR rate for the trading day.

Checked against the live sites on 2026-11-17:
- BRM's own SPOT page (https://brm.ro/PIATA-SPOT-GN/, tab "Cotații") loads its table from
  the public JSON at `dayaheadgas.brm.ro/gassstats/quotes`. No login.
- Only the **Ring Day Ahead / Gas DAY product** is used. Within-Day, Weekend, Monday and
  BOM contracts are separate rings and are never substituted for a missing DA day.
- Gas day comes from the product name (`BRMGAS_DA18_M11_2026` → 18 Nov 2026); the trading day is `quoteDate`.
- 6 delivery days (12–18 Nov 2026, excluding no-trade 14 Nov) match BRM's on-screen table
  exactly (date, product, RON VWAP, MWh, trades). They are the test fixtures.
- BNR moved its XML rates to `curs.bnr.ro` on 6 Aug 2026. If BNR hasn't published today's
  rate yet, the price waits (`pending_fx`) instead of using an older rate.

```
python brm_da_fetcher.py                      # stdlib only; daily job
python brm_da_fetcher.py --verify-page        # + cross-check BRM's on-screen table (needs Playwright)
python -m unittest test_brm_da_fetcher.py
```

Outputs `tools/data/brm_da_latest.json` and rows in the shared `tools/data/gas_da.sqlite`
(same `gas_da_price` table and `GasDayAheadPrice` model as the BGH fetcher, see
`tools/gas_da_common.py`). Exit 0 OK, 2 NO_TRADE, 1 SOURCE_ERROR.

**Licence:** BRM's price list charges third parties for its public market-data API for gas
(200 EUR/month at last check). Confirm with BRM before using beyond internal viewing.
