from __future__ import annotations

import argparse
import json
from pathlib import Path


PROJECTS_CONFIG_PATH = (
    Path(__file__).resolve().parents[1] / "services" / "shared" / "projects.json"
)


def normalize_id(value: str) -> str:
    return value.strip().lower().replace("usdt", "").replace("_", "-")


def main() -> None:
    parser = argparse.ArgumentParser(description="Add a project pair to the operator cockpit registry.")
    parser.add_argument("--symbol", required=True, help="Trading symbol, e.g. DEXEUSDT")
    parser.add_argument("--label", help="Display label, defaults to symbol without quote asset")
    parser.add_argument("--id", dest="project_id", help="Project id, defaults to normalized label")
    parser.add_argument("--dex-network", help="DEX network id for DexScreener/GeckoTerminal")
    parser.add_argument("--dex-pool-address", help="DEX pool/pair address")
    parser.add_argument("--set-default", action="store_true", help="Set this project as default")
    args = parser.parse_args()

    payload = json.loads(PROJECTS_CONFIG_PATH.read_text())
    label = (args.label or args.symbol.replace("USDT", "")).upper()
    project_id = normalize_id(args.project_id or label)

    project = {
        "id": project_id,
        "label": label,
        "symbol": args.symbol.upper(),
        "dex_network": args.dex_network,
        "dex_pool_address": args.dex_pool_address,
    }

    projects = [entry for entry in payload["projects"] if entry["id"] != project_id]
    projects.append(project)
    projects.sort(key=lambda entry: entry["label"])
    payload["projects"] = projects
    if args.set_default:
        payload["default_project_id"] = project_id

    PROJECTS_CONFIG_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"added {project_id} -> {args.symbol.upper()}")


if __name__ == "__main__":
    main()
