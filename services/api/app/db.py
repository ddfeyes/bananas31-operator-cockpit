from __future__ import annotations

import sqlite3
import time
from collections import defaultdict
from contextlib import closing
from dataclasses import dataclass
from typing import Any

from .config import DB_PATH


INTERVAL_TO_SECONDS = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
    "1w": 604800,
}


@dataclass
class Database:
    path: str = str(DB_PATH)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        return connection


def bucket_timestamp(timestamp: float, interval: str) -> int:
    interval_secs = INTERVAL_TO_SECONDS.get(interval, 14400)
    return int(timestamp // interval_secs * interval_secs)


def resample_ohlcv(rows: list[sqlite3.Row], interval: str) -> list[dict[str, Any]]:
    buckets: dict[int, dict[str, Any]] = {}
    for row in rows:
        bucket = bucket_timestamp(row["timestamp"], interval)
        current = buckets.get(bucket)
        if current is None:
            buckets[bucket] = {
                "time": bucket,
                "open": row["open"],
                "high": row["high"],
                "low": row["low"],
                "close": row["close"],
                "volume": row["volume"] or 0,
            }
            continue
        current["high"] = max(current["high"], row["high"])
        current["low"] = min(current["low"], row["low"])
        current["close"] = row["close"]
        current["volume"] += row["volume"] or 0
    return [buckets[key] for key in sorted(buckets)]


def resample_last_value(
    rows: list[sqlite3.Row],
    interval: str,
    value_key: str,
    *,
    skip_non_positive: bool = False,
) -> list[dict[str, Any]]:
    buckets: dict[int, dict[str, Any]] = {}
    for row in rows:
        value = row[value_key]
        if value is None:
            continue
        if skip_non_positive and value <= 0:
            continue
        bucket = bucket_timestamp(row["timestamp"], interval)
        buckets[bucket] = {
            "time": bucket,
            "value": value,
        }
    return [buckets[key] for key in sorted(buckets)]


def resample_funding(rows: list[sqlite3.Row], interval_secs: int) -> list[dict[str, Any]]:
    buckets: dict[int, dict[str, Any]] = {}
    for row in rows:
        bucket = int(row["timestamp"] // interval_secs * interval_secs)
        buckets[bucket] = {
            "time": bucket,
            "rate_8h": row["rate_8h"],
            "rate_1h": row["rate_1h"],
        }
    return [buckets[key] for key in sorted(buckets)]


def fetch_latest_snapshot(database: Database) -> dict[str, Any]:
    with closing(database.connect()) as connection:
        now = time.time()
        prices = {}
        for source in ("binance-spot", "binance-perp", "bybit-perp"):
            row = connection.execute(
                "SELECT close FROM price_feed WHERE exchange_id=? ORDER BY timestamp DESC LIMIT 1",
                (source,),
            ).fetchone()
            prices[source] = row["close"] if row else None

        dex_row = connection.execute(
            "SELECT price FROM dex_price ORDER BY timestamp DESC LIMIT 1"
        ).fetchone()
        prices["dex"] = dex_row["price"] if dex_row else None

        high_low = connection.execute(
            "SELECT MAX(high) AS high_24h, MIN(low) AS low_24h FROM price_feed WHERE exchange_id='binance-spot' AND timestamp >= ?",
            (now - 86400,),
        ).fetchone()
        funding_rows = connection.execute(
            """
            SELECT ranked.exchange_id, ranked.rate_8h
            FROM (
                SELECT
                    exchange_id,
                    rate_8h,
                    ROW_NUMBER() OVER (PARTITION BY exchange_id ORDER BY timestamp DESC) AS row_number
                FROM funding_rates
                WHERE rate_8h IS NOT NULL
            ) ranked
            WHERE ranked.row_number = 1
            """
        ).fetchall()
        oi_rows = connection.execute(
            """
            SELECT ranked.exchange_id, ranked.open_interest
            FROM (
                SELECT
                    exchange_id,
                    open_interest,
                    ROW_NUMBER() OVER (PARTITION BY exchange_id ORDER BY timestamp DESC) AS row_number
                FROM oi
                WHERE open_interest IS NOT NULL AND open_interest > 0
            ) ranked
            WHERE ranked.row_number = 1
            """
        ).fetchall()

        basis = fetch_basis_series(database, 86400 * 2, "4h")
        agg_basis = basis["aggregated"][-1]["value"] if basis["aggregated"] else None
        avg_funding = None
        if funding_rows:
            values = [row["rate_8h"] * 100 for row in funding_rows]
            avg_funding = sum(values) / len(values)

        return {
            "prices": prices,
            "summary": {
                "basis_agg_pct": agg_basis,
                "funding_avg_8h_pct": avg_funding,
                "oi_total": sum(row["open_interest"] for row in oi_rows if row["open_interest"] is not None),
                "high_24h": high_low["high_24h"] if high_low else None,
                "low_24h": high_low["low_24h"] if high_low else None,
            },
        }


def fetch_ohlcv_series(database: Database, exchange_id: str, minutes: int, interval: str) -> dict[str, Any]:
    start_ts = time.time() - minutes * 60
    with closing(database.connect()) as connection:
        rows = connection.execute(
            "SELECT timestamp, open, high, low, close, volume FROM price_feed WHERE exchange_id=? AND timestamp >= ? ORDER BY timestamp ASC",
            (exchange_id, start_ts),
        ).fetchall()
    bars = resample_ohlcv(rows, interval)
    return {
        "exchange_id": exchange_id,
        "interval": interval,
        "count": len(bars),
        "bars": bars,
    }


def fetch_basis_series(database: Database, window_secs: int, interval: str) -> dict[str, Any]:
    start_ts = time.time() - window_secs
    with closing(database.connect()) as connection:
        sources = {
            "spot": connection.execute(
                "SELECT timestamp, close FROM price_feed WHERE exchange_id='binance-spot' AND timestamp >= ? ORDER BY timestamp ASC",
                (start_ts,),
            ).fetchall(),
            "binance": connection.execute(
                "SELECT timestamp, close FROM price_feed WHERE exchange_id='binance-perp' AND timestamp >= ? ORDER BY timestamp ASC",
                (start_ts,),
            ).fetchall(),
            "bybit": connection.execute(
                "SELECT timestamp, close FROM price_feed WHERE exchange_id='bybit-perp' AND timestamp >= ? ORDER BY timestamp ASC",
                (start_ts,),
            ).fetchall(),
        }

    spot = {bucket_timestamp(row["timestamp"], interval): row["close"] for row in sources["spot"]}
    per_exchange = {}
    aggregated_map: dict[int, list[float]] = defaultdict(list)

    for name in ("binance", "bybit"):
        series = []
        for row in sources[name]:
            bucket = bucket_timestamp(row["timestamp"], interval)
            spot_price = spot.get(bucket)
            perp_price = row["close"]
            if spot_price in (None, 0) or perp_price is None:
                continue
            value = ((perp_price / spot_price) - 1) * 100
            point = {"time": bucket, "value": value}
            if not series or series[-1]["time"] != bucket:
                series.append(point)
                aggregated_map[bucket].append(value)
        per_exchange[name] = series

    aggregated = [{"time": key, "value": sum(values) / len(values)} for key, values in sorted(aggregated_map.items())]
    return {
        "window_secs": window_secs,
        "interval_secs": INTERVAL_TO_SECONDS.get(interval, 14400),
        "per_exchange": per_exchange,
        "aggregated": aggregated,
    }


def fetch_oi_series(database: Database, minutes: int, interval: str) -> dict[str, Any]:
    start_ts = time.time() - minutes * 60
    with closing(database.connect()) as connection:
        rows = connection.execute(
            "SELECT exchange_id, timestamp, open_interest FROM oi WHERE timestamp >= ? ORDER BY timestamp ASC",
            (start_ts,),
        ).fetchall()

    grouped: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for row in rows:
        grouped[row["exchange_id"]].append(row)

    per_source = {
        exchange_id: resample_last_value(
            source_rows,
            interval,
            "open_interest",
            skip_non_positive=True,
        )
        for exchange_id, source_rows in grouped.items()
    }

    bucket_times = sorted(
        {
            point["time"]
            for series in per_source.values()
            for point in series
        }
    )
    latest_values: dict[str, float | None] = {source: None for source in per_source}
    series_indices: dict[str, int] = {source: 0 for source in per_source}
    aggregated: list[dict[str, Any]] = []

    for bucket in bucket_times:
        total = 0.0
        has_value = False
        for source, series in per_source.items():
            index = series_indices[source]
            while index < len(series) and series[index]["time"] <= bucket:
                latest_values[source] = series[index]["value"]
                index += 1
            series_indices[source] = index
            latest_value = latest_values[source]
            if latest_value is None or latest_value <= 0:
                continue
            total += latest_value
            has_value = True

        if has_value:
            aggregated.append({"time": bucket, "value": total})

    return {
        "per_source": per_source,
        "aggregated": aggregated,
    }


def fetch_funding_series(database: Database, window_secs: int, interval_secs: int) -> dict[str, Any]:
    start_ts = time.time() - window_secs
    with closing(database.connect()) as connection:
        rows = connection.execute(
            "SELECT exchange_id, timestamp, rate_8h, rate_1h FROM funding_rates WHERE timestamp >= ? ORDER BY timestamp ASC",
            (start_ts,),
        ).fetchall()

    grouped: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for row in rows:
        grouped[row["exchange_id"]].append(row)

    return {
        "window_secs": window_secs,
        "interval_secs": interval_secs,
        "per_source": {
            exchange_id: resample_funding(source_rows, interval_secs)
            for exchange_id, source_rows in grouped.items()
        },
    }


def fetch_replay_events(database: Database, window_secs: int, interval: str, limit: int = 6) -> dict[str, Any]:
    interval_secs = INTERVAL_TO_SECONDS.get(interval, 14400)
    basis = fetch_basis_series(database, window_secs, interval)
    oi = fetch_oi_series(database, max(60, window_secs // 60), interval)
    funding = fetch_funding_series(database, window_secs, interval_secs)

    oi_points = oi["aggregated"]
    oi_map = {point["time"]: point["value"] for point in oi_points}
    oi_delta_map: dict[int, float] = {}
    previous_oi = None
    for point in oi_points:
        value = point["value"]
        if previous_oi not in (None, 0):
            oi_delta_map[point["time"]] = ((value - previous_oi) / previous_oi) * 100
        else:
            oi_delta_map[point["time"]] = 0.0
        previous_oi = value

    funding_points = sorted(
        (
            {"time": point["time"], "value": point["rate_8h"] * 100}
            for series in funding["per_source"].values()
            for point in series
        ),
        key=lambda point: point["time"],
    )

    def nearest_funding_value(timestamp: int) -> float:
        nearest = 0.0
        for point in funding_points:
            if point["time"] > timestamp:
                break
            nearest = point["value"]
        return nearest

    events = []
    for point in basis["aggregated"]:
        timestamp = point["time"]
        basis_pct = point["value"]
        oi_total = oi_map.get(timestamp)
        oi_change_pct = oi_delta_map.get(timestamp, 0.0)
        funding_8h_pct = nearest_funding_value(timestamp)

        score = abs(basis_pct) * 1.8 + abs(oi_change_pct) * 1.1 + abs(funding_8h_pct) * 5.5
        if score < 0.35:
            continue

        if abs(basis_pct) >= max(abs(oi_change_pct), abs(funding_8h_pct) * 1.5):
            focus_mode = "basis"
            title = "Carry Expansion" if basis_pct > 0 else "Basis Compression"
        elif abs(oi_change_pct) >= abs(funding_8h_pct) * 1.2:
            focus_mode = "leverage"
            title = "Leverage Build" if oi_change_pct > 0 else "Leverage Flush"
        else:
            focus_mode = "funding"
            title = "Funding Heat" if funding_8h_pct > 0 else "Funding Relief"

        summary = (
            f"Basis {basis_pct:+.4f}% · "
            f"OI Δ {oi_change_pct:+.2f}% · "
            f"Funding {funding_8h_pct:+.4f}%"
        )
        events.append(
            {
                "id": f"{focus_mode}-{timestamp}",
                "time": timestamp,
                "title": title,
                "summary": summary,
                "focus_mode": focus_mode,
                "score": round(score, 4),
                "window_from": timestamp - interval_secs * 6,
                "window_to": timestamp + interval_secs * 2,
                "metrics": {
                    "basis_pct": round(basis_pct, 6),
                    "oi_total": oi_total,
                    "oi_change_pct": round(oi_change_pct, 6),
                    "funding_8h_pct": round(funding_8h_pct, 6),
                },
            }
        )

    ranked = sorted(events, key=lambda event: (event["score"], event["time"]), reverse=True)[:limit]
    ranked.sort(key=lambda event: event["time"], reverse=True)

    return {
        "window_secs": window_secs,
        "interval": interval,
        "interval_secs": interval_secs,
        "limit": limit,
        "count": len(ranked),
        "events": ranked,
    }
