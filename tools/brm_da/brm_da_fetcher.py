#!/usr/bin/env python3
"""
BRM (Bursa Română de Mărfuri, Romania) gas Day-Ahead VWAP fetcher, RON/MWh → EUR/MWh.

Verified against the live sites on 2026-11-17:
  * BRM's official SPOT page https://brm.ro/PIATA-SPOT-GN/ (tab "Cotații") renders its
    quotes table from https://dayaheadgas.brm.ro/gassstats/quotes (brm.ro/ext/configs.js,
    urlGasSpotHost). Public GET, JSON, no login.
  * Rings are separate records. Only ringNameEn == "Ring Day Ahead" with
    activSupportNameEn == "Gas DAY product" is Day-Ahead. Within Day, Weekend, Monday and
    Balance-of-Month rings are ignored (never substituted for a missing DA day).
  * The gas day is in the product name exactly as BRM shows it: BRMGAS_DA18_M11_2026 →
    2026-11-18. quoteDate is the trading day.
  * "Preț mediu ponderat Lei/MWh" on the page = JSON `value`; "Preț Mediu Ponderat Global"
    = `globalAvgPrice` (blends Weekend/Monday contracts; stored as reference only).
  * A DA product with no trades: qtyEn 0, numarTranzactiiEn 0, value null.
  * EUR conversion: BNR EUR reference rate of the trading day, from curs.bnr.ro (BNR moved
    its XML there on 6 Aug 2026; www.bnr.ro/*.xml now redirects to the homepage). On a
    business day before BNR publishes, the price waits (pending_fx) — no older rate is used.
    Weekend/holiday trading days use the latest earlier fixing.

Market zone: BRM's DA ring is the Romanian virtual trading point; recorded as
"Romania VTP (BRM Ring Day Ahead)". There is no zone selector on BRM's page.

Licence: BRM's price list charges third parties for its "Public Market Data API – GAS"
(200 EUR/month at last check). Confirm with BRM before any use beyond internal viewing.

Exit codes: 0 OK, 2 NO_TRADE, 1 SOURCE_ERROR. Outputs data/brm_da_latest.json and the
shared data/gas_da.sqlite table (same schema as the BGH fetcher).

Schedule (Windows Task Scheduler; BRM DA trades close around midday and BNR publishes
~13:00 Bucharest, so an afternoon run catches both):
  schtasks /Create /SC DAILY /ST 15:15 /TN "BRM DA fetch" ^
    /TR "python C:\\path\\tools\\brm_da\\brm_da_fetcher.py"
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
from gas_da_common import (  # noqa: E402
    JSON_SCHEMA, STATUS_NO_TRADE, STATUS_OK, STATUS_SOURCE_ERROR, GasDayAheadPrice, upsert_sqlite)

PAGE_URL = "https://brm.ro/PIATA-SPOT-GN/"
QUOTES_URL = "https://dayaheadgas.brm.ro/gassstats/quotes?pageSize={n}&sortBy=quoteDate&sortDirection=desc"
BNR_RECENT = "https://curs.bnr.ro/nbrfxrates10days.xml"
BNR_YEAR = "https://curs.bnr.ro/files/xml/years/nbrfxrates{y}.xml"
EXCHANGE, PRODUCT = "BRM", "DA"
ZONE = "Romania VTP (BRM Ring Day Ahead)"
DA_RING, DA_PRODUCT = "Ring Day Ahead", "Gas DAY product"
BUCHAREST = ZoneInfo("Europe/Bucharest")
UA = "Mozilla/5.0 (compatible; SerbiaGasDashboard/1.0; daily BRM DA price check)"
log = logging.getLogger("brm_da")


class SourceError(RuntimeError):
    pass


# ── parsing ───────────────────────────────────────────────────────────────────────────
def delivery_from_name(name) -> str | None:
    m = re.fullmatch(r"BRMGAS_DA(\d{2})_M(\d{2})_(\d{4})", str(name or ""))
    if not m:
        return None
    try:
        return date(int(m[3]), int(m[2]), int(m[1])).isoformat()
    except ValueError:
        return None


def parse_bnr(xml: str) -> dict[str, float]:
    out = {}
    for d, body in re.findall(r'<Cube\s+date="(\d{4}-\d{2}-\d{2})"\s*>([\s\S]*?)</Cube>', xml):
        m = re.search(r'<Rate\s+currency="EUR"(?:\s+multiplier="(\d+)")?\s*>([\d.]+)</Rate>', body)
        if m:
            rate = float(m[2]) / float(m[1] or 1)
            if 3 < rate < 10:
                out[d] = rate
    return out


def rate_for(rates: dict[str, float], day: str) -> tuple[float, str] | None:
    if day in rates:
        return rates[day], day
    keys = sorted(rates)
    if not keys:
        return None
    if day > keys[-1] and date.fromisoformat(day).weekday() < 5:
        return None                                   # today's fixing not published yet
    prior = [k for k in keys if k < day]
    if not prior or (date.fromisoformat(day) - date.fromisoformat(prior[-1])).days > 5:
        return None
    return rates[prior[-1]], prior[-1]


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def parse_quotes(records, rates: dict[str, float], extracted_at: str):
    """Returns (prices incl. NO_TRADE rows, pending_fx_days, rejected, da_record_count)."""
    if not isinstance(records, list):
        raise SourceError("BRM quotes response is not a list")
    prices, pending, rejected, da = [], [], [], 0
    for r in records:
        if not isinstance(r, dict) or r.get("ringNameEn") != DA_RING or r.get("activSupportNameEn") != DA_PRODUCT:
            continue
        da += 1
        gas_day, trading = delivery_from_name(r.get("nameEn")), str(r.get("quoteDate") or "")[:10]
        if not gas_day or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", trading) or gas_day <= trading:
            rejected.append(f"unrecognised DA record {r.get('nameEn')!r} / {r.get('quoteDate')!r}")
            continue
        if r.get("currencyCode") != "RON" or r.get("unitCode") != "MWh":
            rejected.append(f"{r.get('nameEn')}: {r.get('currencyCode')}/{r.get('unitCode')}")
            continue
        ron, vol, trades = _num(r.get("value")), _num(r.get("qtyEn")), _num(r.get("numarTranzactiiEn"))
        base = dict(exchange=EXCHANGE, product=PRODUCT, market_zone=ZONE, delivery_date=gas_day,
                    source_url=QUOTES_URL.format(n=200), extracted_at_utc=extracted_at,
                    trading_date=trading, original_currency="RON")
        if not trades or not vol or ron is None:
            prices.append(GasDayAheadPrice(**base, vwap_eur_mwh=None, volume_mwh=None, trades=None,
                                           status=STATUS_NO_TRADE))
            continue
        fx = rate_for(rates, trading)
        if not fx:
            pending.append(gas_day)
            continue
        eur = round(ron / fx[0], 3)
        if not 0 < eur < 1000:
            rejected.append(f"{gas_day}: {eur} EUR/MWh outside sanity bounds")
            continue
        glob = _num(r.get("globalAvgPrice"))
        prices.append(GasDayAheadPrice(
            **base, vwap_eur_mwh=eur, volume_mwh=vol, trades=int(trades), status=STATUS_OK,
            reference_index_eur_mwh=round(glob / fx[0], 3) if glob else None,
            original_price=ron, fx_rate=fx[0], fx_date=fx[1]))
    return prices, pending, rejected, da


# ── fetching ──────────────────────────────────────────────────────────────────────────
def _get(url: str, timeout=25, attempts=3) -> str:
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", "replace")
        except Exception as e:
            if i == attempts - 1:
                raise SourceError(f"{url}: {type(e).__name__}: {e}") from e
            log.warning("attempt %d for %s failed (%s); retrying", i + 1, url, e)
            time.sleep(2 * 2 ** i)


def load_rates(year: int, january: bool) -> dict[str, float]:
    rates: dict[str, float] = {}
    for url in [BNR_RECENT] + [BNR_YEAR.format(y=y) for y in ([year - 1, year] if january else [year])]:
        try:
            got = parse_bnr(_get(url))
            if not got:
                log.warning("BNR %s returned no EUR rates (moved?)", url)
            rates.update(got)
        except SourceError as e:
            log.warning("BNR: %s", e)
    return rates


def verify_page(quotes: list, headed: bool) -> int:
    """Optional: open BRM's official page and check its visible DA rows equal the JSON."""
    from playwright.sync_api import sync_playwright

    by_name = {(r.get("quoteDate"), r.get("nameEn")): r for r in quotes}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        page = browser.new_page(user_agent=UA)
        try:
            page.goto(PAGE_URL, wait_until="networkidle", timeout=45_000)
            page.get_by_role("link", name="Cotații").first.click()
            page.wait_for_function("[...document.querySelectorAll('td')].some(td => /BRMGAS_DA/.test(td.innerText))")
            rows = page.eval_on_selector_all(
                "tr", "rs => rs.map(r => [...r.cells].map(c => c.innerText.trim())).filter(c => /BRMGAS_DA/.test(c[2] || ''))")
        finally:
            browser.close()
    checked = 0
    for cells in rows:
        r = by_name.get((cells[1], cells[2]))
        if r is None:
            raise SourceError(f"page row {cells[:5]} not in JSON")
        shown = _num(cells[4]) if cells[4] != "N/A" else None
        if shown != _num(r.get("value")) or _num(cells[3]) != _num(r.get("qtyEn")):
            raise SourceError(f"page row {cells[:5]} differs from JSON value {r.get('value')}")
        checked += 1
    if checked < 5:
        raise SourceError(f"only {checked} DA rows visible on the page to cross-check")
    return checked


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="BRM gas Day-Ahead VWAP (EUR/MWh)")
    ap.add_argument("--records", type=int, default=200, help="newest quote records to read (≈4 per trading day)")
    ap.add_argument("--out", type=Path, default=ROOT.parent / "data")
    ap.add_argument("--stale-days", type=int, default=3)
    ap.add_argument("--verify-page", action="store_true", help="cross-check BRM's on-screen table (Playwright)")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--schema", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if a.schema:
        print(json.dumps(JSON_SCHEMA, indent=2))
        return 0

    now = datetime.now(BUCHAREST)
    extracted = datetime.now(timezone.utc).isoformat(timespec="seconds")
    a.out.mkdir(parents=True, exist_ok=True)
    try:
        quotes = json.loads(_get(QUOTES_URL.format(n=a.records)))
        rates = load_rates(now.year, now.month == 1)
        prices, pending, rejected, da = parse_quotes(quotes, rates, extracted)
        if not da:
            raise SourceError(f'no "{DA_RING}" records in BRM response; rings renamed?')
        if pending and not rates:
            raise SourceError("BNR exchange rates unavailable; cannot convert RON prices")
        checked = verify_page(quotes, a.headed) if a.verify_page else None
    except Exception as e:
        log.error("SOURCE_ERROR: %s", e)
        (a.out / "brm_da_last_error.json").write_text(json.dumps(
            {"status": STATUS_SOURCE_ERROR, "error": str(e), "extracted_at_utc": extracted,
             "source_url": PAGE_URL}, indent=2), encoding="utf-8")
        return 1

    upsert_sqlite(a.out / "gas_da.sqlite", prices)
    ok = sorted((p for p in prices if p.status == STATUS_OK), key=lambda p: p.delivery_date)
    latest = ok[-1] if ok else None
    stale = latest is None or (now.date() - date.fromisoformat(latest.delivery_date)).days > a.stale_days
    (a.out / "brm_da_latest.json").write_text(json.dumps({
        "status": STATUS_OK if latest else STATUS_NO_TRADE, "stale": stale,
        "latest": latest.to_json() if latest else None,
        "history": [p.to_json() for p in prices], "pending_fx": pending, "rejected": rejected,
        "collection": {"extracted_at_utc": extracted, "da_records": da, "fx_fixings": len(rates),
                       "page_rows_cross_checked": checked},
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    if stale:
        log.warning("STALE: newest BRM DA VWAP is %s", latest.delivery_date if latest else "missing")
    if latest:
        log.info("BRM DA VWAP gas day %s = %.2f EUR/MWh (%.2f RON @ %.4f BNR %s; %s MWh, %s trades)",
                 latest.delivery_date, latest.vwap_eur_mwh, latest.original_price, latest.fx_rate,
                 latest.fx_date, f"{latest.volume_mwh:,.0f}", latest.trades)
        return 0
    log.warning("NO_TRADE: no traded BRM DA products in the last %d records", a.records)
    return 2


if __name__ == "__main__":
    sys.exit(main())
