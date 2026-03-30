from __future__ import annotations

import os
from pathlib import Path


CONFIG_FILE = Path(__file__).resolve()
SERVICE_ROOT = CONFIG_FILE.parents[1]
DEFAULT_WEB_DIST = Path("/app/web-dist")

if len(CONFIG_FILE.parents) > 3:
    repo_candidate = CONFIG_FILE.parents[3] / "apps" / "web" / "dist"
    if repo_candidate.exists():
        DEFAULT_WEB_DIST = repo_candidate

DEFAULT_DB_PATH = os.environ.get("BANANAS31_DB_PATH", "/app/data/aggdash.db")
WEB_DIST = Path(os.environ.get("BANANAS31_WEB_DIST", str(DEFAULT_WEB_DIST)))
