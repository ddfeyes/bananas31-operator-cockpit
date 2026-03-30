from __future__ import annotations

import argparse
import json
import sqlite3
import time
import urllib.parse
import urllib.request
from contextlib import closing
from pathlib import Path


SYMBOL = "BANANAS31USDT"
USER_AGENT = "bananas31-operator-cockpit-minute-poller/1.0"

BINANCE_SPOT_KLINES = "https://api.binance.com/api/v3/klines"
BINANCE_PERP_KLINES = "https://fapi.binance.com/fapi/v1/klines"
BINANCE_OPEN_INTEREST = "https://fapi.binance.com/fapi/v1/openInterest"
BINANCE_PREMIUM_INDEX = "https://fapi.binance.com/fapi/v1/premiumIndex"
BYBIT_KLINES = "https://api.bybit.com/v5/market/kline"
BYBIT_TICKERS = "https://api.bybit.com/v5/market/tickers"

PANCAKE_POOL = "0x7f51bbf34156ba802deb0e38b7671dc4fa32041d"
DEXSCREENER_PAIR_URL = f"https://api.dexscreener.com/latest/dex/pairs/bsc/{PANCAKE_POOL}"
GECKOTERMINAL_POOL_URL = f"https://api.geckoterminal.com/api/v2/networks/bsc/pools/{PANCAKE_POOL}"


def fetch_json(url: str, params: dict[str, object] | None = None) -> object:
    query = urllib.parse.urlencode(params or {})
    request_url = f"{url}?{query}" if query else url
    request = urllib.request.Request(request_url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode())


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
        """
        CREATE TABLE IF NOT EXISTS oi (
            exchange_id TEXT NOT NULL,
            timestamp REAL NOT NULL,
            open_interest REAL,
            funding_rate REAL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS funding_rates (
            exchange_id TEXT NOT NULL,
            timestamp REAL NOT NULL,
            rate_8h REAL,
            rate_1h REAL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS dex_price (
            timestamp REAL NOT NULL,
            price REAL,
            liquidity REAL,
            deviation_pct REAL
        )
        """
    )
    connection.execute("CREATE INDEX IF NOT EXISTS idx_price_feed_exchange_ts ON price_feed(exchange_id, timestamp)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_oi_exchange_ts ON oi(exchange_id, timestamp)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_funding_exchange_ts ON funding_rates(exchange_id, timestamp)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_dex_price_ts ON dex_price(timestamp)")
    connection.commit()


def minute_bucket(timestamp: float | None = None) -> int:
    numeric = time.time() if timestamp is None else timestamp
    return int(numeric // 60 * 60)


def upsert_price_row(
    connection: sqlite3.Connection,
    exchange_id: str,
    timestamp: int,
    open_: float,
    high: float,
    low: float,
    close: float,
    volume: float,
) -> None:
    existing = connection.execute(
        "SELECT rowid FROM price_feed WHERE exchange_id=? AND timestamp=? LIMIT 1",
        (exchange_id, timestamp),
    ).fetchone()
    if existing:
        connection.execute(
            """
            UPDATE price_feed
            SET open=?, high=?, low=?, close=?, volume=?
            WHERE rowid=?
            """,
            (open_, high, low, close, volume, existing[0]),
        )
        return
    connection.execute(
        """
        INSERT INTO price_feed(exchange_id, timestamp, open, high, low, close, volume)
        VALUES(?,?,?,?,?,?,?)
        """,
        (exchange_id, timestamp, open_, high, low, close, volume),
    )


def upsert_oi_row(connection: sqlite3.Connection, exchange_id: str, timestamp: int, open_interest: float) -> None:
    existing = connection.execute(
        "SELECT rowid FROM oi WHERE exchange_id=? AND timestamp=? LIMIT 1",
        (exchange_id, timestamp),
    ).fetchone()
    if existing:
        connection.execute("UPDATE oi SET open_interest=? WHERE rowid=?", (open_interest, existing[0]))
        return
    connection.execute(
        "INSERT INTO oi(exchange_id, timestamp, open_interest) VALUES(?,?,?)",
        (exchange_id, timestamp, open_interest),
    )


def upsert_funding_row(
    connection: sqlite3.Connection,
    exchange_id: str,
    timestamp: int,
    rate_8h: float,
    rate_1h: float,
) -> None:
    existing = connection.execute(
        "SELECT rowid FROM funding_rates WHERE exchange_id=? AND timestamp=? LIMIT 1",
        (exchange_id, timestamp),
    ).fetchone()
    if existing:
        connection.execute(
            "UPDATE funding_rates SET rate_8h=?, rate_1h=? WHERE rowid=?",
            (rate_8h, rate_1h, existing[0]),
        )
        return
    connection.execute(
        "INSERT INTO funding_rates(exchange_id, timestamp, rate_8h, rate_1h) VALUES(?,?,?,?)",
        (exchange_id, timestamp, rate_8h, rate_1h),
    )


def upsert_dex_row(
    connection: sqlite3.Connection,
    timestamp: int,
    price: float,
    liquidity: float | None,
    deviation_pct: float | None,
) -> None:
    existing = connection.execute(
        "SELECT rowid FROM dex_price WHERE timestamp=? LIMIT 1",
        (timestamp,),
    ).fetchone()
    if existing:
        connection.execute(
            "UPDATE dex_price SET price=?, liquidity=?, deviation_pct=? WHERE rowid=?",
            (price, liquidity, deviation_pct, existing[0]),
        )
        return
    connection.execute(
        "INSERT INTO dex_price(timestamp, price, liquidity, deviation_pct) VALUES(?,?,?,?)",
        (timestamp, price, liquidity, deviation_pct),
    )


def pick_closed_binance_kline(rows: list[list[object]], now_ts: float) -> tuple[int, float, float, float, float, float] | None:
    for row in reversed(rows):
        close_time = int(row[6]) / 1000.0
        if close_time <= now_ts:
            return (
                int(row[0]) / 1000,
                float(row[1]),
                float(row[2]),
                float(row[3]),
                float(row[4]),
                float(row[5]),
            )
    return None


def pick_closed_bybit_kline(rows: list[list[str]], now_ts: float) -> tuple[int, float, float, float, float, float] | None:
    for row in rows:
        start_time = int(row[0]) / 1000.0
        if start_time + 60 <= now_ts:
            return (
                int(row[0]) / 1000,
                float(row[1]),
                float(row[2]),
                float(row[3]),
                float(row[4]),
                float(row[5]),
            )
    return None


def fetch_latest_binance_kline(url: str, now_ts: float) -> tuple[int, float, float, float, float, float] | None:
    rows = fetch_json(url, {"symbol": SYMBOL, "interval": "1m", "limit": 3})
    if not isinstance(rows, list) or not rows:
        return None
    return pick_closed_binance_kline(rows, now_ts)


def fetch_latest_bybit_kline(now_ts: float) -> tuple[int, float, float, float, float, float] | None:
    payload = fetch_json(
        BYBIT_KLINES,
        {"category": "linear", "symbol": SYMBOL, "interval": "1", "limit": 3},
    )
    rows = payload.get("result", {}).get("list", []) if isinstance(payload, dict) else []
    if not rows:
        return None
    return pick_closed_bybit_kline(list(reversed(rows)), now_ts)


def fetch_latest_binance_oi() -> float | None:
    payload = fetch_json(BINANCE_OPEN_INTEREST, {"symbol": SYMBOL})
    value = payload.get("openInterest") if isinstance(payload, dict) else None
    return float(value) if value is not None else None


def fetch_latest_binance_funding() -> float | None:
    payload = fetch_json(BINANCE_PREMIUM_INDEX, {"symbol": SYMBOL})
    value = payload.get("lastFundingRate") if isinstance(payload, dict) else None
    return float(value) if value is not None else None


def fetch_latest_bybit_market_state() -> tuple[float | None, float | None]:
    payload = fetch_json(BYBIT_TICKERS, {"category": "linear", "symbol": SYMBOL})
    rows = payload.get("result", {}).get("list", []) if isinstance(payload, dict) else []
    if not rows:
        return None, None
    row = rows[0]
    oi = float(row["openInterest"]) if row.get("openInterest") is not None else None
    funding = float(row["fundingRate"]) if row.get("fundingRate") is not None else None
    return oi, funding


def fetch_dex_snapshot() -> tuple[float | None, float | None]:
    try:
        payload = fetch_json(DEXSCREENER_PAIR_URL)
        pairs = payload.get("pairs", []) if isinstance(payload, dict) else []
        if pairs:
            pair = pairs[0]
            price = pair.get("priceUsd")
            liquidity = pair.get("liquidity", {}).get("usd")
            if price is not None:
                return float(price), float(liquidity) if liquidity is not None else None
    except Exception:
        pass

    try:
        payload = fetch_json(GECKOTERMINAL_POOL_URL)
        attributes = payload.get("data", {}).get("attributes", {}) if isinstance(payload, dict) else {}
        price = attributes.get("base_token_price_usd")
        liquidity = attributes.get("reserve_in_usd") or attributes.get("market_cap_usd")
        if price is not None:
            return float(price), float(liquidity) if liquidity is not None else None
    except Exception:
        pass

    return None, None


def fetch_latest_prices(now_ts: float) -> dict[str, tuple[int, float, float, float, float, float] | None]:
    return {
        "binance-spot": fetch_latest_binance_kline(BINANCE_SPOT_KLINES, now_ts),
        "binance-perp": fetch_latest_binance_kline(BINANCE_PERP_KLINES, now_ts),
        "bybit-perp": fetch_latest_bybit_kline(now_ts),
    }


def compute_cex_spot_reference(connection: sqlite3.Connection) -> float | None:
    row = connection.execute(
        "SELECT close FROM price_feed WHERE exchange_id='binance-spot' ORDER BY timestamp DESC LIMIT 1"
    ).fetchone()
    return float(row[0]) if row and row[0] is not None else None


def collect_once(connection: sqlite3.Connection) -> dict[str, int]:
    now_ts = time.time()
    bucket = minute_bucket(now_ts)
    counts = {"prices": 0, "oi": 0, "funding": 0, "dex": 0}

    for exchange_id, kline in fetch_latest_prices(now_ts).items():
        if not kline:
            continue
        ts, open_, high, low, close, volume = kline
        upsert_price_row(connection, exchange_id, int(ts), open_, high, low, close, volume)
        counts["prices"] += 1

    binance_oi = fetch_latest_binance_oi()
    if binance_oi is not None:
        upsert_oi_row(connection, "binance-perp", bucket, binance_oi)
        counts["oi"] += 1

    bybit_oi, bybit_funding = fetch_latest_bybit_market_state()
    if bybit_oi is not None:
        upsert_oi_row(connection, "bybit-perp", bucket, bybit_oi)
        counts["oi"] += 1

    binance_funding = fetch_latest_binance_funding()
    if binance_funding is not None:
        upsert_funding_row(connection, "binance-perp", bucket, binance_funding, binance_funding / 8)
        counts["funding"] += 1
    if bybit_funding is not None:
        upsert_funding_row(connection, "bybit-perp", bucket, bybit_funding, bybit_funding / 8)
        counts["funding"] += 1

    dex_price, dex_liquidity = fetch_dex_snapshot()
    if dex_price is not None:
        cex_spot = compute_cex_spot_reference(connection)
        deviation_pct = ((dex_price - cex_spot) / cex_spot * 100) if cex_spot not in (None, 0) else None
        upsert_dex_row(connection, bucket, dex_price, dex_liquidity, deviation_pct)
        upsert_price_row(connection, "bsc-pancakeswap", bucket, dex_price, dex_price, dex_price, dex_price, 0.0)
        counts["dex"] += 1

    connection.commit()
    return counts


def run(db_path: Path, interval_seconds: int, once: bool) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(db_path)) as connection:
        ensure_schema(connection)
        while True:
            counts = collect_once(connection)
            print(
                f"minute-poller: prices={counts['prices']} oi={counts['oi']} "
                f"funding={counts['funding']} dex={counts['dex']}"
            )
            if once:
                return
            sleep_for = max(1, interval_seconds - (time.time() % interval_seconds))
            time.sleep(sleep_for)


def main() -> None:
    parser = argparse.ArgumentParser(description="Poll minute market data for BANANAS31.")
    parser.add_argument("--db", required=True, help="Path to SQLite DB")
    parser.add_argument("--interval-seconds", type=int, default=60, help="Polling cadence in seconds")
    parser.add_argument("--once", action="store_true", help="Poll once and exit")
    args = parser.parse_args()
    run(Path(args.db), args.interval_seconds, args.once)


if __name__ == "__main__":
    main()
