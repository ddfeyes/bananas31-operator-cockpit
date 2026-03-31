from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

for candidate in (Path(__file__).resolve().parents[2], Path(__file__).resolve().parents[1]):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from services.shared.projects import PROJECTS, PROJECT_MAP, ProjectConfig
from services.shared.schema import ensure_project_schema


ONE_HOUR = 3600
EIGHT_HOURS = 8 * ONE_HOUR
BINANCE_OI_LIMIT = 500
BINANCE_FUNDING_LIMIT = 1000
BYBIT_LIMIT = 200


def fetch_json(url: str, params: dict[str, object]) -> object:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{url}?{query}",
        headers={"User-Agent": "bananas31-operator-cockpit-backfill/2.0"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode())


def existing_start_ts(connection: sqlite3.Connection, table: str, project_id: str, exchange_id: str) -> float | None:
    row = connection.execute(
        f"SELECT MIN(timestamp) FROM {table} WHERE project_id=? AND exchange_id=?",
        (project_id, exchange_id),
    ).fetchone()
    return row[0] if row and row[0] is not None else None


def insert_oi_rows(connection: sqlite3.Connection, project_id: str, exchange_id: str, rows: list[tuple[float, float]]) -> None:
    connection.executemany(
        "INSERT OR REPLACE INTO oi(project_id, exchange_id, timestamp, open_interest) VALUES(?,?,?,?)",
        [(project_id, exchange_id, timestamp, open_interest) for timestamp, open_interest in rows],
    )
    connection.commit()


def insert_funding_rows(connection: sqlite3.Connection, project_id: str, exchange_id: str, rows: list[tuple[float, float, float]]) -> None:
    connection.executemany(
        "INSERT OR REPLACE INTO funding_rates(project_id, exchange_id, timestamp, rate_8h, rate_1h) VALUES(?,?,?,?,?)",
        [(project_id, exchange_id, timestamp, rate_8h, rate_1h) for timestamp, rate_8h, rate_1h in rows],
    )
    connection.commit()


def describe_range(target_start_ts: float, effective_end_ts: float) -> str:
    return (
        f"{datetime.fromtimestamp(target_start_ts, UTC)} to "
        f"{datetime.fromtimestamp(effective_end_ts, UTC)}"
    )


def backfill_binance_oi(connection: sqlite3.Connection, project: ProjectConfig, days: int) -> int:
    exchange_id = "binance-perp"
    now_ts = time.time()
    target_start_ts = now_ts - days * 86400
    current_start_ts = existing_start_ts(connection, "oi", project.id, exchange_id)
    effective_end_ts = (current_start_ts - ONE_HOUR) if current_start_ts else now_ts
    if effective_end_ts <= target_start_ts:
        print(f"{project.id}:{exchange_id} oi: already has >= {days}d history")
        return 0

    print(f"{project.id}:{exchange_id} oi: backfilling 1h from {describe_range(target_start_ts, effective_end_ts)}")
    total = 0
    cursor_ts = target_start_ts
    page_span_seconds = ONE_HOUR * BINANCE_OI_LIMIT
    while cursor_ts < effective_end_ts:
        page_end_ts = min(cursor_ts + page_span_seconds, effective_end_ts)
        try:
            payload = fetch_json(
                "https://fapi.binance.com/futures/data/openInterestHist",
                {
                    "symbol": project.symbol,
                    "period": "1h",
                    "startTime": int(cursor_ts * 1000),
                    "endTime": int(page_end_ts * 1000),
                    "limit": BINANCE_OI_LIMIT,
                },
            )
        except urllib.error.HTTPError as error:
            if error.code == 400:
                cursor_ts = page_end_ts + ONE_HOUR
                continue
            raise
        rows = [
            (int(item["timestamp"]) / 1000.0, float(item["sumOpenInterest"]))
            for item in payload
            if item.get("timestamp") is not None and item.get("sumOpenInterest") is not None
        ]
        rows = [row for row in rows if target_start_ts <= row[0] <= effective_end_ts]
        if rows:
            insert_oi_rows(connection, project.id, exchange_id, rows)
            total += len(rows)
            cursor_ts = rows[-1][0] + ONE_HOUR
        else:
            cursor_ts = page_end_ts + ONE_HOUR
        time.sleep(0.08)

    print(f"{project.id}:{exchange_id} oi: inserted {total} rows")
    return total


def backfill_binance_funding(connection: sqlite3.Connection, project: ProjectConfig, days: int) -> int:
    exchange_id = "binance-perp"
    now_ts = time.time()
    target_start_ts = now_ts - days * 86400
    current_start_ts = existing_start_ts(connection, "funding_rates", project.id, exchange_id)
    effective_end_ts = (current_start_ts - EIGHT_HOURS) if current_start_ts else now_ts
    if effective_end_ts <= target_start_ts:
        print(f"{project.id}:{exchange_id} funding: already has >= {days}d history")
        return 0

    print(f"{project.id}:{exchange_id} funding: backfilling 8h from {describe_range(target_start_ts, effective_end_ts)}")
    total = 0
    cursor_ts = target_start_ts
    page_span_seconds = EIGHT_HOURS * BINANCE_FUNDING_LIMIT
    while cursor_ts < effective_end_ts:
        page_end_ts = min(cursor_ts + page_span_seconds, effective_end_ts)
        try:
            payload = fetch_json(
                "https://fapi.binance.com/fapi/v1/fundingRate",
                {
                    "symbol": project.symbol,
                    "startTime": int(cursor_ts * 1000),
                    "endTime": int(page_end_ts * 1000),
                    "limit": BINANCE_FUNDING_LIMIT,
                },
            )
        except urllib.error.HTTPError as error:
            if error.code == 400:
                cursor_ts = page_end_ts + EIGHT_HOURS
                continue
            raise
        rows = []
        for item in payload:
            funding_time = item.get("fundingTime")
            funding_rate = item.get("fundingRate")
            if funding_time is None or funding_rate is None:
                continue
            rate_8h = float(funding_rate)
            rows.append((int(funding_time) / 1000.0, rate_8h, rate_8h / 8))
        rows = [row for row in rows if target_start_ts <= row[0] <= effective_end_ts]
        if rows:
            insert_funding_rows(connection, project.id, exchange_id, rows)
            total += len(rows)
            cursor_ts = rows[-1][0] + EIGHT_HOURS
        else:
            cursor_ts = page_end_ts + EIGHT_HOURS
        time.sleep(0.08)

    print(f"{project.id}:{exchange_id} funding: inserted {total} rows")
    return total


def backfill_bybit_oi(connection: sqlite3.Connection, project: ProjectConfig, days: int) -> int:
    exchange_id = "bybit-perp"
    now_ts = time.time()
    target_start_ts = now_ts - days * 86400
    current_start_ts = existing_start_ts(connection, "oi", project.id, exchange_id)
    effective_end_ts = (current_start_ts - ONE_HOUR) if current_start_ts else now_ts
    if effective_end_ts <= target_start_ts:
        print(f"{project.id}:{exchange_id} oi: already has >= {days}d history")
        return 0

    print(f"{project.id}:{exchange_id} oi: backfilling 1h from {describe_range(target_start_ts, effective_end_ts)}")
    total = 0
    end_ts = effective_end_ts
    while end_ts > target_start_ts:
        payload = fetch_json(
            "https://api.bybit.com/v5/market/open-interest",
            {
                "category": "linear",
                "symbol": project.symbol,
                "intervalTime": "1h",
                "limit": BYBIT_LIMIT,
                "endTime": int(end_ts * 1000),
            },
        )
        items = payload.get("result", {}).get("list", [])
        rows = sorted(
            (
                int(item["timestamp"]) / 1000.0,
                float(item["openInterest"]),
            )
            for item in items
            if item.get("timestamp") is not None and item.get("openInterest") is not None
        )
        rows = [row for row in rows if target_start_ts <= row[0] <= effective_end_ts]
        if rows:
            insert_oi_rows(connection, project.id, exchange_id, rows)
            total += len(rows)
            end_ts = rows[0][0] - ONE_HOUR
        else:
            break
        time.sleep(0.2)

    print(f"{project.id}:{exchange_id} oi: inserted {total} rows")
    return total


def backfill_bybit_funding(connection: sqlite3.Connection, project: ProjectConfig, days: int) -> int:
    exchange_id = "bybit-perp"
    now_ts = time.time()
    target_start_ts = now_ts - days * 86400
    current_start_ts = existing_start_ts(connection, "funding_rates", project.id, exchange_id)
    effective_end_ts = (current_start_ts - EIGHT_HOURS) if current_start_ts else now_ts
    if effective_end_ts <= target_start_ts:
        print(f"{project.id}:{exchange_id} funding: already has >= {days}d history")
        return 0

    print(f"{project.id}:{exchange_id} funding: backfilling 8h from {describe_range(target_start_ts, effective_end_ts)}")
    total = 0
    end_ts = effective_end_ts
    while end_ts > target_start_ts:
        payload = fetch_json(
            "https://api.bybit.com/v5/market/funding/history",
            {
                "category": "linear",
                "symbol": project.symbol,
                "limit": BYBIT_LIMIT,
                "endTime": int(end_ts * 1000),
            },
        )
        items = payload.get("result", {}).get("list", [])
        rows = sorted(
            (
                int(item["fundingRateTimestamp"]) / 1000.0,
                float(item["fundingRate"]),
                float(item["fundingRate"]) / 8,
            )
            for item in items
            if item.get("fundingRateTimestamp") is not None and item.get("fundingRate") is not None
        )
        rows = [row for row in rows if target_start_ts <= row[0] <= effective_end_ts]
        if rows:
            insert_funding_rows(connection, project.id, exchange_id, rows)
            total += len(rows)
            end_ts = rows[0][0] - EIGHT_HOURS
        else:
            break
        time.sleep(0.2)

    print(f"{project.id}:{exchange_id} funding: inserted {total} rows")
    return total


def selected_projects(project_ids: list[str] | None) -> tuple[ProjectConfig, ...]:
    if not project_ids:
        return PROJECTS
    return tuple(PROJECT_MAP[project_id] for project_id in project_ids if project_id in PROJECT_MAP)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill historical OI and funding for configured projects.")
    parser.add_argument("--db", required=True, help="Path to SQLite DB")
    parser.add_argument("--days", type=int, default=365, help="Target lookback window in days")
    parser.add_argument("--project", action="append", dest="projects", choices=sorted(PROJECT_MAP), help="Project id to backfill; repeat for multiple")
    args = parser.parse_args()

    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    with closing(sqlite3.connect(db_path)) as connection:
        ensure_project_schema(connection)
        for project in selected_projects(args.projects):
            backfill_binance_oi(connection, project, args.days)
            backfill_bybit_oi(connection, project, args.days)
            backfill_binance_funding(connection, project, args.days)
            backfill_bybit_funding(connection, project, args.days)


if __name__ == "__main__":
    main()
