"""Tests for brm_da_fetcher. Fixtures in ../../tests/fixtures/ are REAL captures from
2026-11-17: brm-quotes-*.json (dayaheadgas.brm.ro/gassstats/quotes, page fields kept) and
bnr-10days-*.xml (curs.bnr.ro, EUR/USD/HUF kept). Expected values = BRM's on-screen table.
Run: python -m unittest test_brm_da_fetcher.py"""
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

import brm_da_fetcher as f

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gas_da_common import upsert_sqlite  # noqa: E402

FIX = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
quotes = lambda: json.loads((FIX / "brm-quotes-20261117.json").read_text(encoding="utf-8"))
rates = lambda: f.parse_bnr((FIX / "bnr-10days-20261117.xml").read_text(encoding="utf-8"))
TS = "2026-11-17T15:00:00+00:00"

# (trading day, gas day, RON VWAP, MWh, trades) as shown in BRM's "Cotații" table.
OBSERVED = [("2026-11-17", "2026-11-18", 417.219277, 62211, 160),
            ("2026-11-16", "2026-11-17", 427.743535, 59528, 158),
            ("2026-11-15", "2026-11-16", 444.188101, 16725, 26),
            ("2026-11-14", "2026-11-15", 447.159278, 97, 3),
            ("2026-11-12", "2026-11-13", 438.450136, 75863, 196),
            ("2026-11-11", "2026-11-12", 423.585339, 80518, 161)]


class Parse(unittest.TestCase):
    def test_matches_official_table(self):
        prices, pending, rejected, da = f.parse_quotes(quotes(), rates(), TS)
        ok = [p for p in prices if p.status == "OK"]
        self.assertEqual([(p.trading_date, p.delivery_date, p.original_price, p.volume_mwh, p.trades) for p in ok], OBSERVED)
        self.assertEqual((pending, rejected, da), ([], [], 7))
        self.assertEqual(ok[0].fx_rate, 5.3485)
        self.assertEqual(ok[0].vwap_eur_mwh, round(417.219277 / 5.3485, 3))
        self.assertEqual(ok[2].fx_date, "2026-11-13")          # Sunday trade → Friday fixing
        self.assertTrue(all(p.product == "DA" and p.market_zone == f.ZONE for p in prices))

    def test_no_trade_not_substituted(self):
        prices, *_ = f.parse_quotes(quotes(), rates(), TS)
        d14 = [p for p in prices if p.delivery_date == "2026-11-14"]
        self.assertEqual([(p.status, p.vwap_eur_mwh) for p in d14], [("NO_TRADE", None)])

    def test_fx_waits_for_bnr(self):
        _, pending, _, _ = f.parse_quotes(quotes(), {"2026-11-16": 5.3494}, TS)
        self.assertIn("2026-11-18", pending)
        self.assertIsNone(f.rate_for(rates(), "2026-11-18"))

    def test_names_and_bad_input(self):
        self.assertEqual(f.delivery_from_name("BRMGAS_DA18_M11_2026"), "2026-11-18")
        self.assertIsNone(f.delivery_from_name("BRMGAS_DA31_M02_2026"))
        self.assertIsNone(f.delivery_from_name("BRMWK_14-11-2026"))
        with self.assertRaises(f.SourceError):
            f.parse_quotes({"x": 1}, rates(), TS)


class Store(unittest.TestCase):
    def test_upsert_idempotent(self):
        prices, *_ = f.parse_quotes(quotes(), rates(), TS)
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "g.sqlite"
            upsert_sqlite(db, prices)
            upsert_sqlite(db, prices)
            self.assertEqual(sqlite3.connect(db).execute("select count(*) from gas_da_price").fetchone()[0], len(prices))


if __name__ == "__main__":
    unittest.main()
