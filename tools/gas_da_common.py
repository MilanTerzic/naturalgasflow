"""Shared Day-Ahead price model and storage for the exchange fetchers in tools/*_da/.

Each exchange fetcher (BGH, BRM, later CEEGEX / HEnEx) returns GasDayAheadPrice rows and
stores them with upsert_sqlite(), so one table can hold every exchange.
"""
from __future__ import annotations

import dataclasses
import sqlite3
from pathlib import Path
from typing import Iterable

STATUS_OK, STATUS_NO_TRADE, STATUS_SOURCE_ERROR = "OK", "NO_TRADE", "SOURCE_ERROR"


@dataclasses.dataclass(frozen=True)
class GasDayAheadPrice:
    exchange: str
    product: str
    market_zone: str
    delivery_date: str            # gas day exactly as the exchange states it
    vwap_eur_mwh: float | None
    volume_mwh: float | None
    trades: int | None
    source_url: str
    extracted_at_utc: str
    status: str                   # OK | NO_TRADE
    reference_index_eur_mwh: float | None = None  # exchange index kept apart from VWAP
    trading_date: str | None = None               # when the exchange states it
    original_price: float | None = None           # in original_currency, before conversion
    original_currency: str = "EUR"
    fx_rate: float | None = None                  # original currency per 1 EUR
    fx_date: str | None = None

    def to_json(self) -> dict:
        return dataclasses.asdict(self)


JSON_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "GasDayAheadPrice",
    "type": "object",
    "required": ["exchange", "product", "market_zone", "delivery_date", "vwap_eur_mwh",
                 "volume_mwh", "trades", "source_url", "extracted_at_utc", "status"],
    "properties": {
        "exchange": {"type": "string"},
        "product": {"const": "DA"},
        "market_zone": {"type": "string"},
        "delivery_date": {"type": "string", "format": "date"},
        "vwap_eur_mwh": {"type": ["number", "null"]},
        "volume_mwh": {"type": ["number", "null"]},
        "trades": {"type": ["integer", "null"]},
        "source_url": {"type": "string", "format": "uri"},
        "extracted_at_utc": {"type": "string", "format": "date-time"},
        "status": {"enum": ["OK", "NO_TRADE", "SOURCE_ERROR"]},
        "reference_index_eur_mwh": {"type": ["number", "null"]},
        "trading_date": {"type": ["string", "null"], "format": "date"},
        "original_price": {"type": ["number", "null"]},
        "original_currency": {"type": "string"},
        "fx_rate": {"type": ["number", "null"]},
        "fx_date": {"type": ["string", "null"], "format": "date"},
    },
}

_COLS = [f.name for f in dataclasses.fields(GasDayAheadPrice)]
_KEY = ("exchange", "product", "market_zone", "delivery_date")


def upsert_sqlite(db: Path, prices: Iterable[GasDayAheadPrice]) -> int:
    """Idempotent: one row per exchange/product/zone/gas day; a newer fetch overwrites."""
    db.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db)
    con.execute(f"CREATE TABLE IF NOT EXISTS gas_da_price ({', '.join(_COLS)}, "
                f"PRIMARY KEY ({', '.join(_KEY)}))")
    have = {r[1] for r in con.execute("PRAGMA table_info(gas_da_price)")}
    for c in _COLS:                       # older databases: add new columns
        if c not in have:
            con.execute(f"ALTER TABLE gas_da_price ADD COLUMN {c}")
    upd = ", ".join(f"{c}=excluded.{c}" for c in _COLS if c not in _KEY)
    n = 0
    for p in prices:
        con.execute(f"INSERT INTO gas_da_price ({', '.join(_COLS)}) VALUES ({', '.join('?' * len(_COLS))}) "
                    f"ON CONFLICT({', '.join(_KEY)}) DO UPDATE SET {upd}",
                    [getattr(p, c) for c in _COLS])
        n += 1
    con.commit()
    con.close()
    return n
