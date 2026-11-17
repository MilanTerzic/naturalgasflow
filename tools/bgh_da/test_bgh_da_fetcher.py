"""Tests for bgh_da_fetcher. Fixtures in ../../tests/fixtures/bgh-*.json|html are REAL:
captured from www.balkangashub.bg/public on 2026-11-17 15:58 CET (page + its own DA/WD responses).
Run: python -m unittest test_bgh_da_fetcher.py"""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import bgh_da_fetcher as f

FIX = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
load = lambda n: (FIX / n).read_text(encoding="utf-8")
CTX = dict(today="2026-11-17", zone=f.DEFAULT_ZONE, extracted_at="2026-11-17T14:58:00+00:00")

# Values as displayed in the BGH "Day Ahead" table on 2026-11-17 (date, VWAP, MWh, trades).
OBSERVED = [("2026-11-17", 79.99, 32586, 137), ("2026-11-16", 82.08, 59068, 209),
            ("2026-11-15", 80.90, 58249, 223), ("2026-11-14", 80.91, 58749, 224),
            ("2026-11-13", 80.43, 50744, 243), ("2026-11-12", 77.10, 53637, 222)]


class Parse(unittest.TestCase):
    def test_real_da_rows_match_official_table(self):
        prices, provisional, rejected = f.parse_rows(json.loads(load("bgh-da-20261117.json")), **CTX)
        got = [(p.delivery_date, p.vwap_eur_mwh, p.volume_mwh, p.trades) for p in prices]
        self.assertEqual(got, OBSERVED)
        self.assertEqual(provisional, ["2026-11-18"])   # still trading at capture time
        self.assertEqual(rejected, [])
        self.assertTrue(all(p.product == "DA" and p.exchange == "BGH" for p in prices))
        # BGHSPOTIndex kept apart from VWAP (15th: 80.93 vs 80.90)
        self.assertEqual(prices[2].reference_index_eur_mwh, 80.93)

    def test_no_trade_is_null_not_zero(self):
        prices, _, _ = f.parse_rows(json.loads(load("bgh-wd-20261117.json")), **CTX)
        nt = [p for p in prices if p.delivery_date == "2026-11-18"][0]
        self.assertEqual((nt.status, nt.vwap_eur_mwh, nt.volume_mwh), ("NO_TRADE", None, None))

    def test_bad_inputs(self):
        with self.assertRaises(f.SourceError):
            f.parse_rows({"error": 1}, **CTX)
        _, _, rej = f.parse_rows([{"day": "2026-11-10", "currency": "BGN", "vwa_price": "150",
                                   "volume": 1, "trades_cnt": 1}], **CTX)
        self.assertTrue(rej)


class Page(unittest.TestCase):
    def test_real_page(self):
        p = f.parse_page(load("bgh-public-page-20261117.html"))
        self.assertEqual((p["active"], p["csrf"]), ("DA", "TEST_CSRF_TOKEN"))
        self.assertFalse(p["has_zone_selector"])

    def test_page_change_and_zone(self):
        with self.assertRaises(f.SourceError):
            f.parse_page("<html>maintenance</html>")
        with self.assertRaises(f.SourceError):
            f.check_zone("VTP Bulgaria", False)          # cannot be verified on this page
        with self.assertRaises(f.SourceError):
            f.check_zone(None, True)                     # selector appeared: must adapt
        self.assertEqual(f.check_zone(None, False), f.DEFAULT_ZONE)

    def test_cross_check(self):
        rows = json.loads(load("bgh-da-20261117.json"))
        f._cross_check(rows, [["2026-11-17", "32 586", "137", "79.99", "-2.55", "79.98"]])
        with self.assertRaises(f.SourceError):
            f._cross_check(rows, [["2026-11-17", "32 586", "137", "79.00", "-", "-"]])


class Store(unittest.TestCase):
    def test_upsert_is_idempotent(self):
        prices, _, _ = f.parse_rows(json.loads(load("bgh-da-20261117.json")), **CTX)
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "x.sqlite"
            f.upsert_sqlite(db, prices)
            f.upsert_sqlite(db, prices)
            n = sqlite3.connect(db).execute("select count(*) from gas_da_price").fetchone()[0]
            self.assertEqual(n, len(prices))


if __name__ == "__main__":
    unittest.main()
