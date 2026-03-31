from services.shared.projects import DEFAULT_PROJECT_ID, PROJECT_MAP, list_projects


def test_projects_registry_loads_from_json() -> None:
    assert DEFAULT_PROJECT_ID == "bananas31"
    assert PROJECT_MAP["bananas31"].symbol == "BANANAS31USDT"
    assert PROJECT_MAP["dexe"].symbol == "DEXEUSDT"


def test_projects_registry_lists_dexe() -> None:
    payload = {project["id"]: project for project in list_projects()}
    assert payload["bananas31"]["label"] == "BANANAS31"
    assert payload["dexe"]["label"] == "DEXE"
    assert payload["dexe"]["has_dex"] is True
