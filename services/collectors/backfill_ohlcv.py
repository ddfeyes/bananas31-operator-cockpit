from __future__ import annotations

import argparse
import json
import sqlite3
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


INTERVAL_TO_SECONDS = {
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
}

BINANCE_LIMIT = 1000
BYBIT_LIMIT = 200


@dataclass(frozen=True)
class Source:
    exchange_id: str
    url: str
    client: str


SOURCES = (
    Source("binance-spot", "https://api.binance.com/api/v3/klines", "binance"),
    Source("binance-perp", "https://fapi.binance.com/fapi/v1/klines", "binance"),
    Source("bybit-perp", "https://api.bybit.com/v5/market/kline", "bybit"),
)


def fetch_json(url: str, params: dict[str, object]) -> object:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{url}?{query}",
        headers={"User-Agent": "bananas31-operator-cockpit-backfill/1.0"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode())


def fetch_binance_page(source: Source, interval: str, start_ms: int, end_ms: int) -> list[tuple[float, float, float, float, float, float]]:
    payload = fetch_json(
        source.url,
        {
            "symbol": "BANANAS31USDT",
            "interval": interval,
            "startTime": start_ms,
            "endTime": end_ms,
            "limit": BINANCE_LIMIT,
        },
    )
    return [
        (int(row[0]) / 1000.0, float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5]))
        for row in payload
    ]


def fetch_bybit_page(interval: str, start_ms: int, end_ms: int) -> list[tuple[float, float, float, float, float, float]]:
    interval_label = {"1h": "60", "4h": "240", "1d": "D"}[interval]
    payload = fetch_json(
        "https://api.bybit.com/v5/market/kline",
        {
            "category": "linear",
            "symbol": "BANANAS31USDT",
            "interval": interval_label,
            "start": start_ms,
            "end": end_ms,
            "limit": BYBIT_LIMIT,
        },
    )
    rows = list(reversed(payload.get("result", {}).get("list", [])))
    return [
        (int(row[0]) / 1000.0, float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5]))
        for row in rows
    ]


def existing_start_ts(connection: sqlite3.Connection, exchange_id: str) -> float | None:
    row = connection.execute(
        "SELECT MIN(timestamp) FROM price_feed WHERE exchange_id=?",
        (exchange_id,),
    ).fetchone()
    return row[0] if row and row[0] is not None else None


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS price_feed (
            exchange_id TEXT NOT NULL,
            timestamp REAL NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume REAL
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_price_feed_exchange_ts ON price_feed(exchange_id, timestamp)"
    )
    connection.commit()


def insert_rows(connection: sqlite3.Connection, exchange_id: str, rows: list[tuple[float, float, float, float, float, float]]) -> None:
    connection.executemany(
        "INSERT INTO price_feed(exchange_id, timestamp, open, high, low, close, volume) VALUES(?,?,?,?,?,?,?)",
        [(exchange_id, ts, op, hi, lo, cl, vol) for ts, op, hi, lo, cl, vol in rows],
    )
    connection.commit()


def backfill_source(connection: sqlite3.Connection, source: Source, days: int, interval: str) -> int:
    interval_seconds = INTERVAL_TO_SECONDS[interval]
    now_ts = time.time()
    target_start_ts = now_ts - days * 86400
    current_start_ts = existing_start_ts(connection, source.exchange_id)
    effective_end_ts = (current_start_ts - interval_seconds) if current_start_ts else now_ts

    if effective_end_ts <= target_start_ts:
        print(f"{source.exchange_id}: already has >= {days}d history")
        return 0

    total = 0
    cursor_ts = target_start_ts
    page_limit = BINANCE_LIMIT if source.client == "binance" else BYBIT_LIMIT
    page_span_seconds = interval_seconds * page_limit

    print(
        f"{source.exchange_id}: backfilling {interval} from "
        f"{datetime.fromtimestamp(target_start_ts, UTC)} to {datetime.fromtimestamp(effective_end_ts, UTC)}"
    )

    while cursor_ts < effective_end_ts:
        page_end_ts = min(cursor_ts + page_span_seconds, effective_end_ts)
        start_ms = int(cursor_ts * 1000)
        end_ms = int(page_end_ts * 1000)
        rows = (
            fetch_binance_page(source, interval, start_ms, end_ms)
            if source.client == "binance"
            else fetch_bybit_page(interval, start_ms, end_ms)
        )
        if rows:
            insert_rows(connection, source.exchange_id, rows)
            total += len(rows)
            cursor_ts = rows[-1][0] + interval_seconds
        else:
            cursor_ts = page_end_ts + interval_seconds
        time.sleep(0.08 if source.client == "binance" else 0.35)

    print(f"{source.exchange_id}: inserted {total} bars")
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill older OHLCV history for BANANAS31.")
    parser.add_argument("--db", required=True, help="Path to SQLite DB")
    parser.add_argument("--days", type=int, default=365, help="Target lookback window in days")
    parser.add_argument("--interval", choices=sorted(INTERVAL_TO_SECONDS), default="1h", help="Backfill interval")
    args = parser.parse_args()

    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(db_path) as connection:
        ensure_schema(connection)
        for source in SOURCES:
            backfill_source(connection, source, args.days, args.interval)


if __name__ == "__main__":
    main()
