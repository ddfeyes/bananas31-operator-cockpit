from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.db import Database
from app.main import create_app
from tests.test_api import seed_database


def test_replay_events_returns_ranked_operator_events(tmp_path: Path) -> None:
    db_path = tmp_path / "fixture.db"
    seed_database(db_path)

    client = TestClient(create_app(Database(str(db_path))))

    response = client.get("/api/replay/events", params={"window_secs": 10_000_000, "interval": "1h", "limit": 4})
    assert response.status_code == 200

    payload = response.json()
    assert payload["interval"] == "1h"
    assert payload["limit"] == 4
    assert payload["count"] >= 1

    first = payload["events"][0]
    assert first["title"]
    assert first["summary"]
    assert first["focus_mode"] in {"basis", "leverage", "funding"}
    assert first["window_from"] < first["time"] < first["window_to"]
    assert "basis_pct" in first["metrics"]
    assert "oi_change_pct" in first["metrics"]
    assert "funding_8h_pct" in first["metrics"]
