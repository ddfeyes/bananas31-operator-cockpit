#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import time
from datetime import datetime, timezone
from typing import Iterable
from urllib.parse import urlencode
from urllib.request import Request, urlopen


SYMBOL = "BANANAS31USDT"
USER_AGENT = "bananas31-operator-cockpit-backfill/1.0"
INTERVAL_TO_MS = {
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}
BYBIT_INTERVAL = {
    "1h": "60",
    "4h": "240",
    "1d": "D",
}


def fetch_json(url: str, params: dict[str, object]) -> object:
    query = urlencode(params)
    request = Request(f"{url}?{query}", headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS price_feed (
            exchange_id TEXT NOT NULL,
            timestamp   REAL NOT NULL,
            open        REAL,
            high        REAL,
            low         REAL,
            close       REAL,
            volume      REAL,
            UNIQUE(exchange_id, timestamp)
        )
        """
    )
    connection.execute("CREATE INDEX IF NOT EXISTS idx_price_feed ON price_feed(exchange_id, timestamp)")
    connection.commit()


def insert_rows(connection: sqlite3.Connection, exchange_id: str, rows: Iterable[tuple[float, float, float, float, float, float]]) -> int:
    payload = [(exchange_id, *row) for row in rows]
    connection.executemany(
        "INSERT OR IGNORE INTO price_feed(exchange_id, timestamp, open, high, low, close, volume) VALUES(?,?,?,?,?,?,?)",
        payload,
    )
    connection.commit()
    return len(payload)


def backfill_binance(connection: sqlite3.Connection, exchange_id: str, url: str, interval: str, start_ms: int, end_ms: int) -> int:
    interval_ms = INTERVAL_TO_MS[interval]
    cursor_ms = start_ms
    inserted = 0

    while cursor_ms < end_ms:
        page_end_ms = min(cursor_ms + interval_ms * 1000, end_ms)
        rows = fetch_json(
            url,
            {
                "symbol": SYMBOL,
                "interval": interval,
                "startTime": cursor_ms,
                "endTime": page_end_ms,
                "limit": 1000,
            },
        )
        if not isinstance(rows, list) or not rows:
            cursor_ms = page_end_ms
            time.sleep(0.08)
            continue

        parsed = [
            (
                int(row[0]) / 1000,
                float(row[1]),
                float(row[2]),
                float(row[3]),
                float(row[4]),
                float(row[5]),
            )
            for row in rows
        ]
        inserted += insert_rows(connection, exchange_id, parsed)
        cursor_ms = int(rows[-1][0]) + interval_ms
        time.sleep(0.08)

    return inserted


def backfill_bybit(connection: sqlite3.Connection, interval: str, start_ms: int, end_ms: int) -> int:
    interval_ms = INTERVAL_TO_MS[interval]
    cursor_ms = start_ms
    inserted = 0

    while cursor_ms < end_ms:
        page_end_ms = min(cursor_ms + interval_ms * 1000, end_ms)
        data = fetch_json(
            "https://api.bybit.com/v5/market/kline",
            {
                "category": "linear",
                "symbol": SYMBOL,
                "interval": BYBIT_INTERVAL[interval],
                "start": cursor_ms,
                "end": page_end_ms,
                "limit": 1000,
            },
        )
        rows = data.get("result", {}).get("list", []) if isinstance(data, dict) else []
        if not rows:
            cursor_ms = page_end_ms
            time.sleep(0.35)
            continue

        rows = list(reversed(rows))
        parsed = [
            (
                int(row[0]) / 1000,
                float(row[1]),
                float(row[2]),
                float(row[3]),
                float(row[4]),
                float(row[5]),
            )
            for row in rows
        ]
        inserted += insert_rows(connection, "bybit-perp", parsed)
        cursor_ms = int(rows[-1][0]) + interval_ms
        time.sleep(0.35)

    return inserted


def summarize(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        """
        SELECT exchange_id, COUNT(*) AS count, MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts
        FROM price_feed
        GROUP BY exchange_id
        ORDER BY exchange_id
        """
    ).fetchall()
    for exchange_id, count, first_ts, last_ts in rows:
        first = datetime.fromtimestamp(first_ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
        last = datetime.fromtimestamp(last_ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
        print(f"{exchange_id}: {count} bars [{first} UTC -> {last} UTC]")


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill historical OHLCV for BANANAS31 cockpit")
    parser.add_argument("--db", required=True, help="SQLite database path")
    parser.add_argument("--days", type=int, default=180, help="Days of history to fetch")
    parser.add_argument("--interval", choices=sorted(INTERVAL_TO_MS), default="1h", help="Fetch interval")
    args = parser.parse_args()

    end_ms = int(time.time() * 1000)
    start_ms = end_ms - args.days * 86_400_000

    connection = sqlite3.connect(args.db)
    try:
      ensure_schema(connection)
      print(f"Backfilling {args.interval} klines for {args.days}d into {args.db}")
      print(f"Window: {datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)} -> {datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc)}")
      print(f"binance-spot inserted {backfill_binance(connection, 'binance-spot', 'https://api.binance.com/api/v3/klines', args.interval, start_ms, end_ms)} bars")
      print(f"binance-perp inserted {backfill_binance(connection, 'binance-perp', 'https://fapi.binance.com/fapi/v1/klines', args.interval, start_ms, end_ms)} bars")
      print(f"bybit-perp inserted {backfill_bybit(connection, args.interval, start_ms, end_ms)} bars")
      summarize(connection)
    finally:
      connection.close()


if __name__ == "__main__":
    main()
