"""Shared project configuration and path resolution helpers."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict


PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = PROJECT_DIR / "config.json"

DEFAULTS: Dict[str, Any] = {
    "cdp_url": "http://127.0.0.1:9222",
    "chrome_binary": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "chrome_profile_dir": "~/.ps3838-wss-chrome-profile",
    "start_url": "https://www.ps3838.com/zh-cn/sports/soccer",
    "target_hosts": ["ps3838.com", "ps38ag.com"],
    "capture_path": "capture.jsonl",
    "events_file": "events_list.csv",
    "live_snapshot_file": "latest_odds_live.csv",
    "latest_output_file": "latest_odds_10_matches.csv",
    "normalized_output_file": "latest_odds_normalized.csv",
    "dashboard_db_path": "odds_history.sqlite3",
    "backup_dir": "backups",
    "backup_keep": 7,
    "capture_compress_after_hours": 24,
    "capture_compress_min_mb": 16,
    "snapshot_interval_seconds": 2,
    "capture_rotation_mb": 0,
}


def load_config() -> Dict[str, Any]:
    """Load config.json when present and merge it over project defaults."""
    config = dict(DEFAULTS)
    config_path = Path(
        os.environ.get("PS3838_CONFIG", str(DEFAULT_CONFIG_PATH))
    ).expanduser()

    if config_path.exists():
        try:
            with config_path.open(encoding="utf-8") as handle:
                loaded = json.load(handle)
            if not isinstance(loaded, dict):
                raise ValueError("顶层必须是 JSON 对象")
            config.update(loaded)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"无法读取配置文件 {config_path}: {exc}") from exc

    return config


def resolve_path(value: Any, fallback: str) -> Path:
    """Resolve a config path relative to the project directory when needed."""
    raw = value or fallback
    path = Path(str(raw)).expanduser()
    return path if path.is_absolute() else PROJECT_DIR / path


def get_path(config: Dict[str, Any], key: str) -> Path:
    aliases = {
        "events_file": ("events_file", "events_path"),
        "live_snapshot_file": ("live_snapshot_file", "output"),
        "latest_output_file": ("latest_output_file", "latest_output"),
        "normalized_output_file": (
            "normalized_output_file",
            "normalized_output",
        ),
    }
    fallback = DEFAULTS[key]
    for candidate in aliases.get(key, (key,)):
        if config.get(candidate):
            return resolve_path(config[candidate], str(fallback))
    return resolve_path(fallback, str(fallback))


def target_hosts(config: Dict[str, Any]):
    value = config.get("target_hosts", DEFAULTS["target_hosts"])
    if isinstance(value, str):
        value = value.split(",")
    if not isinstance(value, list):
        value = DEFAULTS["target_hosts"]
    return tuple(str(item).strip().lower().lstrip(".") for item in value if str(item).strip())
