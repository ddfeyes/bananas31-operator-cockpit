from __future__ import annotations

from pathlib import Path

from app.config import resolve_default_db_path, resolve_default_web_dist


def test_resolve_default_db_path_prefers_repo_database(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    service_root = repo_root / "services" / "api"
    app_root = service_root / "app"
    data_root = service_root / "data"
    web_dist = repo_root / "apps" / "web" / "dist"
    app_root.mkdir(parents=True)
    data_root.mkdir(parents=True)
    web_dist.mkdir(parents=True)

    config_file = app_root / "config.py"
    config_file.write_text("# fixture\n")
    real_db = data_root / "aggdash.db"
    real_db.write_text("fixture\n")
    (data_root / "sample.db").write_text("sample\n")

    assert resolve_default_db_path(config_file) == real_db
    assert resolve_default_web_dist(config_file) == web_dist


def test_resolve_default_db_path_falls_back_to_runtime_mount(tmp_path: Path) -> None:
    service_root = tmp_path / "repo" / "services" / "api"
    app_root = service_root / "app"
    app_root.mkdir(parents=True)

    config_file = app_root / "config.py"
    config_file.write_text("# fixture\n")

    assert resolve_default_db_path(config_file) == Path("/app/data/aggdash.db")
