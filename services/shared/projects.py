from __future__ import annotations

from dataclasses import dataclass


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


DEFAULT_PROJECT_ID = "bananas31"

PROJECTS: tuple[ProjectConfig, ...] = (
    ProjectConfig(
        id="bananas31",
        label="BANANAS31",
        symbol="BANANAS31USDT",
        dex_network="bsc",
        dex_pool_address="0x7f51bbf34156ba802deb0e38b7671dc4fa32041d",
    ),
    ProjectConfig(
        id="dexe",
        label="DEXE",
        symbol="DEXEUSDT",
        dex_network="bsc",
        dex_pool_address="0x23ab35fac8a7ff11f0fe197df68e8ee52e415f2a",
    ),
)

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
