from __future__ import annotations

import os
from pathlib import Path


CONFIG_FILE = Path(__file__).resolve()
SERVICE_ROOT = CONFIG_FILE.parents[1]
DEFAULT_WEB_DIST = Path("/app/web-dist")
DEFAULT_DB_PATH = Path("/app/data/aggdash.db")


def resolve_default_web_dist(config_file: Path) -> Path:
    default = Path("/app/web-dist")
    if len(config_file.parents) <= 3:
        return default
    repo_candidate = config_file.parents[3] / "apps" / "web" / "dist"
    return repo_candidate if repo_candidate.exists() else default


def resolve_default_db_path(config_file: Path) -> Path:
    default = Path("/app/data/aggdash.db")
    service_root = config_file.parents[1]
    local_db_candidate = service_root / "data" / "aggdash.db"
    if local_db_candidate.exists():
        return local_db_candidate
    return default


DEFAULT_WEB_DIST = resolve_default_web_dist(CONFIG_FILE)
DEFAULT_DB_PATH = resolve_default_db_path(CONFIG_FILE)

DB_PATH = Path(os.environ.get("BANANAS31_DB_PATH", str(DEFAULT_DB_PATH)))
WEB_DIST = Path(os.environ.get("BANANAS31_WEB_DIST", str(DEFAULT_WEB_DIST)))
