from __future__ import annotations

import sqlite3
import time
from pathlib import Path


DDL = """
CREATE TABLE IF NOT EXISTS price_feed (
    exchange_id TEXT NOT NULL,
    timestamp REAL NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume REAL
);
CREATE TABLE IF NOT EXISTS oi (
    exchange_id TEXT NOT NULL,
    timestamp REAL NOT NULL,
    open_interest REAL,
    funding_rate REAL
);
CREATE TABLE IF NOT EXISTS funding_rates (
    exchange_id TEXT NOT NULL,
    timestamp REAL NOT NULL,
    rate_8h REAL,
    rate_1h REAL
);
CREATE TABLE IF NOT EXISTS dex_price (
    timestamp REAL NOT NULL,
    price REAL,
    liquidity REAL,
    deviation_pct REAL
);
"""


def main() -> None:
    target = Path(__file__).resolve().parents[1] / "data" / "demo.db"
    target.parent.mkdir(parents=True, exist_ok=True)

    now = int(time.time() // 3600 * 3600)
    rows = []
    oi_rows = []
    funding_rows = []
    dex_rows = []

    for step in range(30 * 24):
        timestamp = now - (30 * 24 - step) * 3600
        spot_close = 0.0132 + step * 0.000002 + ((step % 12) - 6) * 0.00001
        perp_close = spot_close * (1 + 0.0015 - (step % 9) * 0.00008)
        bybit_close = spot_close * (1 + 0.0009 - (step % 7) * 0.00006)

        rows.extend(
            [
                ("binance-spot", timestamp, spot_close * 0.995, spot_close * 1.01, spot_close * 0.99, spot_close, 120_000 + step * 250),
                ("binance-perp", timestamp, perp_close * 0.996, perp_close * 1.011, perp_close * 0.991, perp_close, 98_000 + step * 230),
                ("bybit-perp", timestamp, bybit_close * 0.996, bybit_close * 1.01, bybit_close * 0.992, bybit_close, 84_000 + step * 180),
            ]
        )
        oi_rows.extend(
            [
                ("binance-perp", timestamp, 3_200_000_000 + step * 1_800_000, None),
                ("bybit-perp", timestamp, 2_400_000_000 + step * 1_250_000, None),
            ]
        )
        if step % 8 == 0:
            funding_rows.extend(
                [
                    ("binance-perp", timestamp, 0.00045 + ((step % 5) - 2) * 0.00003, 0.000056),
                    ("bybit-perp", timestamp, 0.00062 + ((step % 4) - 1.5) * 0.00004, 0.000078),
                ]
            )

        dex_rows.append((timestamp, spot_close * 0.9985, 4_200_000 + step * 5000, -0.14 + (step % 6) * 0.01))

    with sqlite3.connect(target) as connection:
        connection.executescript(DDL)
        for table in ("price_feed", "oi", "funding_rates", "dex_price"):
            connection.execute(f"DELETE FROM {table}")
        connection.executemany(
            "INSERT INTO price_feed(exchange_id, timestamp, open, high, low, close, volume) VALUES(?,?,?,?,?,?,?)",
            rows,
        )
        connection.executemany(
            "INSERT INTO oi(exchange_id, timestamp, open_interest, funding_rate) VALUES(?,?,?,?)",
            oi_rows,
        )
        connection.executemany(
            "INSERT INTO funding_rates(exchange_id, timestamp, rate_8h, rate_1h) VALUES(?,?,?,?)",
            funding_rows,
        )
        connection.executemany(
            "INSERT INTO dex_price(timestamp, price, liquidity, deviation_pct) VALUES(?,?,?,?)",
            dex_rows,
        )
        connection.commit()

    print(target)


if __name__ == "__main__":
    main()
