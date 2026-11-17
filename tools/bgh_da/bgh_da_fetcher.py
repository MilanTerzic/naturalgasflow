#!/usr/bin/env python3
"""
Balkan Gas Hub (BGH) Day-Ahead VWAP fetcher (EUR/MWh).

Verified against the live site on 2026-11-17:
  * https://www.balkangashub.bg/public has tabs Intraday / Day Ahead / Weeks / Months /
    Quarters (a[data-market-type] = WD / DA / WEEK / MONTH / QUARTER). DA is active on load.
  * There is NO zone / trading-point selector on the public page. It publishes a single
    DA table for the BGH exchange. "VTP Bulgaria" is therefore not a selectable label; the
    fetcher records market_zone = "BGH exchange (single public DA table, no zone selector)"
    and refuses to run if a zone selector ever appears and --zone was not matched.
  * The page fills its table with its own request:
        POST /ajax/spotMarketData   date_from, date_to, type=DA, currency=EUR, year
    using the page's CSRF token and session cookie. Intraday is the same URL with type=WD.
  * No-trade days come back with "-" in every field. reference_price is BGHSPOTIndex,
    a different number from the DA VWAP; it stays "-" while the next gas day is trading.

Modes
  --mode browser (default)  Playwright: opens the page, clicks/validates the Day Ahead tab,
                            captures the page's own DA response and cross-checks every
                            parsed row against the rendered table.
  --mode http               Standard library only: one GET of the page + the same POST the
                            page makes. No browser. Same validation of the response.

Nothing is bypassed: no login, no captcha handling, no IP rotation. BGH's website terms
restrict commercial reuse without written consent; get BGH's permission (or its public-data
API agreement) before production/commercial use.

Exit codes: 0 OK, 2 NO_TRADE (nothing traded in range), 1 SOURCE_ERROR.
Outputs: tools/data/bgh_da_latest.json and the shared tools/data/gas_da.sqlite; failures save debug/ artifacts.

Schedule (Windows Task Scheduler, once daily after BGH closes the DA session; the reference
price for the next gas day appeared on the page by the evening on observation day):
  schtasks /Create /SC DAILY /ST 19:30 /TN "BGH DA fetch" ^
    /TR "python C:\\path\\tools\\bgh_da\\bgh_da_fetcher.py --mode http"
(19:30 is Belgrade time = 20:30 Sofia; confirm the exact BGH publication time over a
few days via the provisional_days field before relying on it.)
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import logging
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

PAGE_URL = "https://www.balkangashub.bg/public"
DATA_URL = "https://www.balkangashub.bg/ajax/spotMarketData"
EXCHANGE = "BGH"
PRODUCT = "DA"
DEFAULT_ZONE = "BGH exchange (single public DA table, no zone selector)"
SOFIA = ZoneInfo("Europe/Sofia")
UA = "Mozilla/5.0 (compatible; SerbiaGasDashboard/1.0; daily BGH DA price check)"
ROOT = Path(__file__).resolve().parent
log = logging.getLogger("bgh_da")

sys.path.insert(0, str(ROOT.parent))
from gas_da_common import (  # noqa: E402  shared with tools/brm_da
    JSON_SCHEMA, STATUS_NO_TRADE, STATUS_OK, STATUS_SOURCE_ERROR, GasDayAheadPrice, upsert_sqlite)


class SourceError(RuntimeError):
    pass


# ── parsing ───────────────────────────────────────────────────────────────────────────
def _num(raw) -> float | None:
    """'-', '', None and non-numbers are None, never 0. Handles '42 461' and '79,99'."""
    if isinstance(raw, (int, float)):
        return float(raw)
    if raw is None:
        return None
    t = re.sub(r"[\s\u00a0]", "", str(raw))
    if not t or re.fullmatch(r"[-–—]+", t):
        return None
    if re.fullmatch(r"-?\d+,\d+", t):
        t = t.replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def parse_rows(rows, *, today: str, zone: str, extracted_at: str
               ) -> tuple[list[GasDayAheadPrice], list[str], list[str]]:
    """Returns (prices incl. NO_TRADE rows, provisional_days, rejected)."""
    if not isinstance(rows, list):
        raise SourceError("BGH response is not a list of rows")
    out, provisional, rejected = [], [], []
    for r in rows:
        day = str((r or {}).get("day", "")).strip()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            rejected.append(f"bad gas day {day!r}")
            continue
        if str(r.get("currency", "")).upper() != "EUR":
            rejected.append(f"{day}: currency {r.get('currency')!r}")
            continue
        vwap, vol, trades = _num(r.get("vwa_price")), _num(r.get("volume")), _num(r.get("trades_cnt"))
        ref = _num(r.get("reference_price"))
        base = dict(exchange=EXCHANGE, product=PRODUCT, market_zone=zone, delivery_date=day,
                    source_url=PAGE_URL, extracted_at_utc=extracted_at)
        if not trades or not vol or vwap is None:
            out.append(GasDayAheadPrice(**base, vwap_eur_mwh=None, volume_mwh=None, trades=None,
                                        status=STATUS_NO_TRADE))
            continue
        if day > today and ref is None:
            provisional.append(day)       # next gas day still trading: not a final price
            continue
        if not (0 < vwap < 1000):
            rejected.append(f"{day}: VWAP {vwap} outside sanity bounds")
            continue
        out.append(GasDayAheadPrice(**base, vwap_eur_mwh=vwap, volume_mwh=vol, trades=int(trades),
                                    status=STATUS_OK, reference_index_eur_mwh=ref))
    return out, provisional, rejected


def parse_page(html: str) -> dict:
    csrf = re.search(r'<meta\s+name=["\']csrf-token["\']\s+content=["\']([^"\']+)', html)
    tabs = re.findall(r'data-market-type=["\']([A-Z]+)["\']', html)
    active = re.search(r'<a[^>]*class=["\'][^"\']*\bactive\b[^"\']*["\'][^>]*data-market-type=["\']([A-Z]+)', html)
    url = re.search(r'reports\.url\s*=\s*["\']([^"\']*spotMarketData)["\']', html)
    selects = " ".join(re.findall(r"<select[\s\S]*?</select>", html, re.I))
    if not csrf:
        raise SourceError("page changed: no csrf-token meta tag")
    if "DA" not in tabs or "WD" not in tabs:
        raise SourceError(f"page changed: tabs {tabs}, expected DA and WD")
    if not url or not url.group(1).startswith("https://www.balkangashub.bg/"):
        raise SourceError("page changed: spotMarketData request not found")
    return {"csrf": csrf.group(1), "tabs": tabs, "active": active.group(1) if active else None,
            "data_url": url.group(1), "has_zone_selector": bool(re.search(r"zone|trading.?point|vtp", selects, re.I))}


def check_zone(requested: str | None, has_selector: bool) -> str:
    if has_selector:
        raise SourceError("BGH page now shows a zone selector; adapt the fetcher and pass the exact --zone")
    if requested and requested != DEFAULT_ZONE:
        raise SourceError(f"zone {requested!r} cannot be verified: the BGH public page has no zone selector")
    return DEFAULT_ZONE


# ── fetching ──────────────────────────────────────────────────────────────────────────
def _retry(fn, attempts=3, base=2.0):
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # network errors are retried; parse errors are not wrapped here
            if i == attempts - 1:
                raise SourceError(f"{type(e).__name__}: {e}") from e
            log.warning("attempt %d failed (%s); retrying", i + 1, e)
            time.sleep(base * 2 ** i)


def fetch_http(date_from: str, date_to: str, zone: str | None, debug: Path) -> tuple[list, str, dict]:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    html = _retry(lambda: opener.open(urllib.request.Request(
        PAGE_URL, headers={"User-Agent": UA, "Accept": "text/html"}), timeout=20).read().decode("utf-8", "replace"))
    try:
        page = parse_page(html)
    except SourceError:
        _save(debug, "page.html", html)
        raise
    zone_label = check_zone(zone, page["has_zone_selector"])
    xsrf = next((urllib.parse.unquote(c.value) for c in jar if c.name == "XSRF-TOKEN"), None)
    body = urllib.parse.urlencode({"date_from": date_from, "date_to": date_to, "type": PRODUCT,
                                   "currency": "EUR", "year": date_to[:4]}).encode()
    headers = {"User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "X-CSRF-TOKEN": page["csrf"],
               "Accept": "application/json", "Referer": PAGE_URL, "Origin": "https://www.balkangashub.bg",
               "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
    if xsrf:
        headers["X-XSRF-TOKEN"] = xsrf
    raw = _retry(lambda: opener.open(urllib.request.Request(page["data_url"], data=body, headers=headers),
                                     timeout=30).read().decode("utf-8", "replace"))
    try:
        return json.loads(raw), zone_label, {"active_tab": page["active"], "mode": "http"}
    except json.JSONDecodeError:
        _save(debug, "response.txt", raw)
        raise SourceError("BGH data response is not JSON")


def fetch_browser(date_from: str, date_to: str, zone: str | None, debug: Path, headed: bool
                  ) -> tuple[list, str, dict]:
    from playwright.sync_api import sync_playwright  # optional dependency for this mode

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        page = browser.new_page(user_agent=UA, locale="en-GB", timezone_id="Europe/Sofia")
        try:
            page.goto(PAGE_URL, wait_until="networkidle", timeout=45_000)
            selects = page.locator("select").all_inner_texts()
            zone_label = check_zone(zone, any(re.search(r"zone|trading.?point|vtp", s, re.I) for s in selects))
            da = page.locator('a[data-market-type="DA"]')
            if da.count() != 1 or da.inner_text().strip() != "Day Ahead":
                raise SourceError("Day Ahead tab not found exactly once")
            # Click DA and capture the page's own DA response for the visible range.
            with page.expect_response(lambda r: "spotMarketData" in r.url and r.request.method == "POST"
                                      and "type=DA" in (r.request.post_data or ""), timeout=30_000) as resp:
                da.click()
            if "active" not in (da.get_attribute("class") or ""):
                raise SourceError("Day Ahead tab did not become active")
            shown = resp.value.json()
            page.wait_for_function("document.querySelectorAll('#table-trade-data tbody tr').length > 0")
            table = page.eval_on_selector_all(
                "#table-trade-data tbody tr", "rs => rs.map(r => [...r.cells].map(c => c.innerText.trim()))")
            _cross_check(shown, table)
            # Requested range through the page's own request function (same CSRF/session).
            rows = page.evaluate(
                """([f, t]) => new Promise((ok, bad) => $.ajax({method: 'post', url: reports.url,
                    data: {date_from: f, date_to: t, type: 'DA', currency: 'EUR', year: t.slice(0, 4)},
                    success: ok, error: e => bad('HTTP ' + e.status)}))""", [date_from, date_to])
            return rows, zone_label, {"active_tab": "DA", "mode": "browser", "visible_rows_checked": len(table)}
        except Exception:
            debug.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(debug / "bgh_failure.png"), full_page=True)
            _save(debug, "page.html", page.content())
            raise
        finally:
            browser.close()


def _cross_check(json_rows: list, table: list[list[str]]) -> None:
    """Every visible table row must equal the captured DA response (date, VWAP, volume)."""
    by_day = {r.get("day"): r for r in json_rows}
    for cells in table:
        if len(cells) < 4 or cells[0] not in by_day:
            raise SourceError(f"visible row {cells} not in DA response")
        r = by_day[cells[0]]
        if _num(cells[3]) != _num(r.get("vwa_price")) or _num(cells[1]) != _num(r.get("volume")):
            raise SourceError(f"visible row {cells} differs from DA response {r}")


def _save(debug: Path, name: str, text: str) -> None:
    debug.mkdir(parents=True, exist_ok=True)
    (debug / name).write_text(text, encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--mode", choices=["browser", "http"], default="browser")
    ap.add_argument("--headed", action="store_true", help="show the browser (browser mode)")
    ap.add_argument("--zone", help=f"must equal {DEFAULT_ZONE!r} until BGH adds a zone selector")
    ap.add_argument("--days", type=int, default=35, help="history window ending at the next business day")
    ap.add_argument("--from", dest="date_from"), ap.add_argument("--to", dest="date_to")
    ap.add_argument("--out", type=Path, default=ROOT.parent / "data")
    ap.add_argument("--debug-dir", type=Path, default=ROOT / "debug")
    ap.add_argument("--stale-days", type=int, default=3, help="alert if newest price is older")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--schema", action="store_true", help="print the JSON schema and exit")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if a.schema:
        print(json.dumps(JSON_SCHEMA, indent=2))
        return 0

    today = datetime.now(SOFIA).date()
    d_to = a.date_to or (today + timedelta(days=7)).isoformat()
    d_from = a.date_from or (today - timedelta(days=a.days)).isoformat()
    extracted = datetime.now(timezone.utc).isoformat(timespec="seconds")
    a.out.mkdir(parents=True, exist_ok=True)
    latest_path = a.out / "bgh_da_latest.json"
    try:
        fetcher = fetch_http if a.mode == "http" else (
            lambda f, t, z, d: fetch_browser(f, t, z, d, a.headed))
        rows, zone, meta = fetcher(d_from, d_to, a.zone, a.debug_dir)
        prices, provisional, rejected = parse_rows(rows, today=today.isoformat(), zone=zone, extracted_at=extracted)
    except Exception as e:
        log.error("SOURCE_ERROR: %s", e)
        payload = {"status": STATUS_SOURCE_ERROR, "error": str(e), "extracted_at_utc": extracted,
                   "source_url": PAGE_URL, "latest": None}
        (a.out / "bgh_da_last_error.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return 1

    upsert_sqlite(a.out / "gas_da.sqlite", prices)
    ok = sorted((p for p in prices if p.status == STATUS_OK), key=lambda p: p.delivery_date)
    latest = ok[-1] if ok else None
    stale = latest is None or (today - date.fromisoformat(latest.delivery_date)).days > a.stale_days
    payload = {
        "status": STATUS_OK if latest else STATUS_NO_TRADE,
        "stale": stale,
        "latest": latest.to_json() if latest else None,
        "history": [p.to_json() for p in prices],
        "provisional_days": provisional,
        "rejected": rejected,
        "collection": {**meta, "requested_from": d_from, "requested_to": d_to, "extracted_at_utc": extracted},
    }
    latest_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    if stale:
        log.warning("STALE: newest DA VWAP is %s", latest.delivery_date if latest else "missing")
    if latest:
        log.info("BGH DA VWAP %s = %.2f EUR/MWh (%s MWh, %s trades)", latest.delivery_date,
                 latest.vwap_eur_mwh, f"{latest.volume_mwh:,.0f}", latest.trades)
        return 0
    log.warning("NO_TRADE: no traded DA rows between %s and %s", d_from, d_to)
    return 2


if __name__ == "__main__":
    sys.exit(main())
