from __future__ import annotations

import sqlite3

from .projects import DEFAULT_PROJECT_ID


def table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    row = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    return row is not None


def table_columns(connection: sqlite3.Connection, table_name: str) -> set[str]:
    if not table_exists(connection, table_name):
        return set()
    rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


def index_exists(connection: sqlite3.Connection, index_name: str) -> bool:
    row = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
        (index_name,),
    ).fetchone()
    return row is not None


def dedupe_project_table(
    connection: sqlite3.Connection,
    table_name: str,
    create_sql: str,
    select_columns: tuple[str, ...],
    key_columns: tuple[str, ...],
) -> None:
    temp_table = f"{table_name}__dedup"
    connection.execute(f"DROP TABLE IF EXISTS {temp_table}")
    connection.execute(
        create_sql.replace(
            f"CREATE TABLE IF NOT EXISTS {table_name}",
            f"CREATE TABLE {temp_table}",
        )
    )
    selected = ", ".join(select_columns)
    partition = ", ".join(key_columns)
    connection.execute(
        f"""
        INSERT INTO {temp_table}({selected})
        SELECT {selected}
        FROM (
            SELECT
                {selected},
                ROW_NUMBER() OVER (PARTITION BY {partition} ORDER BY rowid DESC) AS row_number
            FROM {table_name}
        )
        WHERE row_number = 1
        """
    )
    connection.execute(f"DROP TABLE {table_name}")
    connection.execute(f"ALTER TABLE {temp_table} RENAME TO {table_name}")


def migrate_project_table(
    connection: sqlite3.Connection,
    table_name: str,
    create_sql: str,
    copy_columns: tuple[str, ...],
    key_columns: tuple[str, ...],
    unique_index_name: str,
    unique_index_sql: str,
    lookup_index_sql: str,
) -> None:
    legacy_table = f"{table_name}__legacy"
    columns = table_columns(connection, table_name)
    if not columns:
        connection.execute(create_sql)
        connection.execute(unique_index_sql)
        connection.execute(lookup_index_sql)
        columns = table_columns(connection, table_name)

    has_project_id = "project_id" in columns
    if not has_project_id:
        connection.execute(f"ALTER TABLE {table_name} RENAME TO {legacy_table}")
        connection.execute(create_sql)
        connection.execute(unique_index_sql)
        connection.execute(lookup_index_sql)
        source_columns = ", ".join(copy_columns)
        destination_columns = ", ".join(("project_id", *copy_columns))
        connection.execute(
            f"""
            INSERT OR REPLACE INTO {table_name}({destination_columns})
            SELECT ?, {source_columns}
            FROM {legacy_table}
            """,
            (DEFAULT_PROJECT_ID,),
        )
        connection.execute(f"DROP TABLE {legacy_table}")

    if not index_exists(connection, unique_index_name):
        dedupe_project_table(
            connection,
            table_name,
            create_sql,
            ("project_id", *copy_columns),
            ("project_id", *key_columns),
        )
    connection.execute(unique_index_sql)
    connection.execute(lookup_index_sql)
    if table_exists(connection, legacy_table):
        legacy_columns = table_columns(connection, legacy_table)
        source_columns = ", ".join(copy_columns)
        if "project_id" in legacy_columns:
            destination_columns = ", ".join(("project_id", *copy_columns))
            source_sql = f"SELECT project_id, {source_columns} FROM {legacy_table}"
        else:
            destination_columns = ", ".join(("project_id", *copy_columns))
            source_sql = f"SELECT ?, {source_columns} FROM {legacy_table}"
        if "project_id" in legacy_columns:
            connection.execute(
                f"INSERT OR REPLACE INTO {table_name}({destination_columns}) {source_sql}"
            )
        else:
            connection.execute(
                f"INSERT OR REPLACE INTO {table_name}({destination_columns}) {source_sql}",
                (DEFAULT_PROJECT_ID,),
            )
        connection.execute(f"DROP TABLE {legacy_table}")


def ensure_project_schema(connection: sqlite3.Connection) -> None:
    migrate_project_table(
        connection,
        "price_feed",
        """
        CREATE TABLE IF NOT EXISTS price_feed (
            project_id TEXT NOT NULL,
            exchange_id TEXT NOT NULL,
            timestamp REAL NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume REAL
        )
        """,
        ("exchange_id", "timestamp", "open", "high", "low", "close", "volume"),
        ("exchange_id", "timestamp"),
        "idx_price_feed_project_exchange_ts_unique",
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_price_feed_project_exchange_ts_unique
        ON price_feed(project_id, exchange_id, timestamp)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_price_feed_project_exchange_ts
        ON price_feed(project_id, exchange_id, timestamp)
        """,
    )
    migrate_project_table(
        connection,
        "oi",
        """
        CREATE TABLE IF NOT EXISTS oi (
            project_id TEXT NOT NULL,
            exchange_id TEXT NOT NULL,
            timestamp REAL NOT NULL,
            open_interest REAL,
            funding_rate REAL
        )
        """,
        ("exchange_id", "timestamp", "open_interest", "funding_rate"),
        ("exchange_id", "timestamp"),
        "idx_oi_project_exchange_ts_unique",
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_oi_project_exchange_ts_unique
        ON oi(project_id, exchange_id, timestamp)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_oi_project_exchange_ts
        ON oi(project_id, exchange_id, timestamp)
        """,
    )
    migrate_project_table(
        connection,
        "funding_rates",
        """
        CREATE TABLE IF NOT EXISTS funding_rates (
            project_id TEXT NOT NULL,
            exchange_id TEXT NOT NULL,
            timestamp REAL NOT NULL,
            rate_8h REAL,
            rate_1h REAL
        )
        """,
        ("exchange_id", "timestamp", "rate_8h", "rate_1h"),
        ("exchange_id", "timestamp"),
        "idx_funding_project_exchange_ts_unique",
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_project_exchange_ts_unique
        ON funding_rates(project_id, exchange_id, timestamp)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_funding_project_exchange_ts
        ON funding_rates(project_id, exchange_id, timestamp)
        """,
    )
    migrate_project_table(
        connection,
        "dex_price",
        """
        CREATE TABLE IF NOT EXISTS dex_price (
            project_id TEXT NOT NULL,
            timestamp REAL NOT NULL,
            price REAL,
            liquidity REAL,
            deviation_pct REAL
        )
        """,
        ("timestamp", "price", "liquidity", "deviation_pct"),
        ("timestamp",),
        "idx_dex_price_project_ts_unique",
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_dex_price_project_ts_unique
        ON dex_price(project_id, timestamp)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_dex_price_project_ts
        ON dex_price(project_id, timestamp)
        """,
    )
    connection.commit()
