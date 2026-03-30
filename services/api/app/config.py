from __future__ import annotations

import os
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_WEB_DIST = REPO_ROOT / "apps" / "web" / "dist"
DEFAULT_DB_PATH = os.environ.get("BANANAS31_DB_PATH", "/app/data/aggdash.db")
WEB_DIST = Path(os.environ.get("BANANAS31_WEB_DIST", str(DEFAULT_WEB_DIST)))
