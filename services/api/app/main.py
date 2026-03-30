from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from .config import WEB_DIST
from .db import (
    Database,
    fetch_basis_series,
    fetch_funding_series,
    fetch_latest_snapshot,
    fetch_ohlcv_series,
    fetch_oi_series,
)


def mount_web_app(app: FastAPI, web_dist: Path) -> None:
    assets_dir = web_dist / "assets"
    index_file = web_dist / "index.html"

    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    if not index_file.exists():
        return

    @app.get("/", include_in_schema=False)
    def frontend_index() -> FileResponse:
        return FileResponse(index_file)

    @app.get("/{full_path:path}", include_in_schema=False)
    def frontend_routes(full_path: str) -> FileResponse:
        requested_file = web_dist / full_path
        if requested_file.exists() and requested_file.is_file():
            return FileResponse(requested_file)
        return FileResponse(index_file)


def create_app(database: Database | None = None) -> FastAPI:
    app = FastAPI(title="BANANAS31 Operator API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    db = database or Database()

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/snapshot")
    def snapshot() -> dict:
        return fetch_latest_snapshot(db)

    @app.get("/api/history/ohlcv")
    def history_ohlcv(
        exchange_id: str = Query(...),
        minutes: int = Query(43200, ge=60),
        interval: str = Query("4h"),
    ) -> dict:
        return fetch_ohlcv_series(db, exchange_id, minutes, interval)

    @app.get("/api/history/basis")
    def history_basis(
        window_secs: int = Query(86400 * 30, ge=3600),
        interval: str = Query("4h"),
    ) -> dict:
        return fetch_basis_series(db, window_secs, interval)

    @app.get("/api/history/oi")
    def history_oi(
        minutes: int = Query(43200, ge=60),
        interval: str = Query("4h"),
    ) -> dict:
        return fetch_oi_series(db, minutes, interval)

    @app.get("/api/history/funding")
    def history_funding(
        window_secs: int = Query(86400 * 30, ge=3600),
        interval_secs: int = Query(14400, ge=300),
    ) -> dict:
        return fetch_funding_series(db, window_secs, interval_secs)

    mount_web_app(app, WEB_DIST)
    return app


app = create_app()
