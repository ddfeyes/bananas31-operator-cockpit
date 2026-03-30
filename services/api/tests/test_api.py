from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.db import Database
from app.main import create_app


DDL = """
CREATE TABLE price_feed (
    exchange_id TEXT NOT NULL,
    timestamp REAL NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume REAL
);
CREATE TABLE oi (
    exchange_id TEXT NOT NULL,
    timestamp REAL NOT NULL,
    open_interest REAL,
    funding_rate REAL
);
CREATE TABLE funding_rates (
    exchange_id TEXT NOT NULL,
    timestamp REAL NOT NULL,
    rate_8h REAL,
    rate_1h REAL
);
CREATE TABLE dex_price (
    timestamp REAL NOT NULL,
    price REAL,
    liquidity REAL,
    deviation_pct REAL
);
"""


def seed_database(path: Path) -> None:
    now = int(time.time())
    first = now - 7200
    second = now - 3600
    third = now
    conn = sqlite3.connect(path)
    try:
        conn.executescript(DDL)
        rows = [
            ("binance-spot", first, 1.0, 1.2, 0.9, 1.1, 100.0),
            ("binance-spot", second, 1.1, 1.3, 1.0, 1.2, 120.0),
            ("binance-perp", first, 1.02, 1.21, 1.0, 1.12, 90.0),
            ("binance-perp", second, 1.12, 1.31, 1.02, 1.23, 95.0),
            ("bybit-perp", first, 1.01, 1.18, 0.98, 1.08, 80.0),
            ("bybit-perp", second, 1.08, 1.28, 1.01, 1.18, 84.0),
        ]
        conn.executemany(
            "INSERT INTO price_feed(exchange_id, timestamp, open, high, low, close, volume) VALUES(?,?,?,?,?,?,?)",
            rows,
        )
        conn.executemany(
            "INSERT INTO oi(exchange_id, timestamp, open_interest) VALUES(?,?,?)",
            [
                ("binance-perp", first, 1_000_000.0),
                ("binance-perp", second, 1_100_000.0),
                ("binance-perp", second + 60, 0.0),
                ("binance-perp", third, 1_200_000.0),
                ("bybit-perp", first, 600_000.0),
                ("bybit-perp", second, 610_000.0),
            ],
        )
        conn.executemany(
            "INSERT INTO funding_rates(exchange_id, timestamp, rate_8h, rate_1h) VALUES(?,?,?,?)",
            [
                ("binance-perp", first, 0.0005, 0.0000625),
                ("binance-perp", second + 120, 0.0004, 0.00005),
                ("bybit-perp", first, 0.0008, 0.0001),
            ],
        )
        conn.execute(
            "INSERT INTO dex_price(timestamp, price, liquidity, deviation_pct) VALUES(?,?,?,?)",
            (second, 1.19, 2500000, -0.12),
        )
        conn.commit()
    finally:
        conn.close()


def test_history_endpoints_return_expected_shapes(tmp_path: Path) -> None:
    db_path = tmp_path / "fixture.db"
    seed_database(db_path)

    client = TestClient(create_app(Database(str(db_path))))

    assert client.get("/health").json() == {"status": "ok"}

    snapshot = client.get("/api/snapshot").json()
    assert snapshot["prices"]["binance-spot"] == 1.2
    assert snapshot["prices"]["dex"] == 1.19
    assert snapshot["summary"]["oi_total"] == 1_810_000.0
    assert snapshot["summary"]["funding_avg_8h_pct"] == 0.06

    ohlcv = client.get("/api/history/ohlcv", params={"exchange_id": "binance-spot", "minutes": 10_000_000, "interval": "1h"}).json()
    assert ohlcv["count"] == 2
    assert len(ohlcv["bars"]) == 2

    basis = client.get("/api/history/basis", params={"window_secs": 10_000_000, "interval": "1h"}).json()
    assert len(basis["aggregated"]) == 2
    assert len(basis["per_exchange"]["binance"]) == 2

    oi = client.get("/api/history/oi", params={"minutes": 10_000_000, "interval": "1h"}).json()
    assert len(oi["aggregated"]) == 3
    assert len(oi["per_source"]["binance-perp"]) == 3
    assert oi["per_source"]["binance-perp"][-1]["value"] == 1_200_000.0
    assert oi["aggregated"][-1]["value"] == 1_810_000.0

    funding = client.get("/api/history/funding", params={"window_secs": 10_000_000, "interval_secs": 3600}).json()
    assert len(funding["per_source"]["binance-perp"]) == 2
    assert funding["per_source"]["binance-perp"][-1]["rate_8h"] == 0.0004
