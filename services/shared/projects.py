from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ProjectConfig:
    id: str
    label: str
    symbol: str
    dex_network: str | None = None
    dex_pool_address: str | None = None

    @property
    def has_dex(self) -> bool:
        return bool(self.dex_network and self.dex_pool_address)

    @property
    def dex_exchange_id(self) -> str:
        return "bsc-pancakeswap"

    @property
    def dexscreener_pair_url(self) -> str | None:
        if not self.has_dex:
            return None
        return f"https://api.dexscreener.com/latest/dex/pairs/{self.dex_network}/{self.dex_pool_address}"

    @property
    def geckoterminal_pool_url(self) -> str | None:
        if not self.has_dex:
            return None
        return (
            f"https://api.geckoterminal.com/api/v2/networks/"
            f"{self.dex_network}/pools/{self.dex_pool_address}"
        )


PROJECTS_CONFIG_PATH = Path(__file__).with_name("projects.json")


def load_projects_config() -> tuple[str, tuple[ProjectConfig, ...]]:
    payload = json.loads(PROJECTS_CONFIG_PATH.read_text())
    projects = tuple(ProjectConfig(**project) for project in payload["projects"])
    default_project_id = payload.get("default_project_id") or (projects[0].id if projects else "")
    return default_project_id, projects


DEFAULT_PROJECT_ID, PROJECTS = load_projects_config()

PROJECT_MAP = {project.id: project for project in PROJECTS}


def get_project(project_id: str | None = None) -> ProjectConfig:
    if project_id and project_id in PROJECT_MAP:
        return PROJECT_MAP[project_id]
    return PROJECT_MAP[DEFAULT_PROJECT_ID]


def list_projects() -> list[dict[str, object]]:
    return [
        {
            "id": project.id,
            "label": project.label,
            "symbol": project.symbol,
            "has_dex": project.has_dex,
        }
        for project in PROJECTS
    ]
