"""Local real-time dashboard for the PS3838 collector.

The server seeds its in-memory view from the latest CSV snapshot and then tails
capture.jsonl incrementally. It intentionally does not trigger a full replay on
startup, avoiding the current O(n*m) cost in live_snapshot.py.
"""

from __future__ import annotations

import argparse
import http.client
import json
import mimetypes
import os
import re
import signal
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, unquote, urlsplit

from crown_proxy import is_crown_path, proxy_crown
from fixture_merge import (
    FixtureMergeStore,
    build_alias_index,
    MappingConflict,
    prepare_crown_event,
    prepare_pinnacle_event,
    rank_candidates,
    rank_league_candidates,
    summarize_leagues,
)
from src.services.fixture_matching import AUTO_MAP_TIME_MINUTES, competition_conflict
from maintenance import backup_database, verify_database
import partner_orders
from project_config import DEFAULTS, config_path, get_path, load_config, service_url
from telegram_push import TelegramPusher, list_chats


# Compatibility exports: callers may keep importing the historical root module.
from src.core.constants import (
    CHANGE_LIMIT, FINISHED_MATCH_STATUSES, FULL_TIME_STAGE, HISTORY_LIMIT, LIVE_EVENT_LATE_MINUTE, LIVE_EVENT_MAX_WALL_MINUTES, LIVE_EVENT_STALE_SECONDS, MARKET_ROW_MISSES, MARKET_ROW_STALE_AFTER_SECONDS, MARKET_ROW_STALE_MISSES, RECENT_BOOTSTRAP_BYTES, SUPPORTED_MARKETS
)
from src.core.time import now_iso
from src.providers.pinnacle.parser import (as_text, float_or_none, iter_event_records, iter_events, iter_leaf_rows, iter_messages, metadata_status)
from src.services.event_visibility import (event_has_display_metadata, event_is_finished, event_is_visible_today_upcoming, event_scope, is_full_time_market, live_event_is_stale, match_elapsed_minute, parse_kickoff)
from src.services.arbitrage import find_opportunities
from src.services.odds_store import OddsStore
from src.storage.history import HistoryDatabase, HistoryWriter
from src.services.source_freshness import crown_freshness, pinnacle_freshness


PROJECT_DIR = Path(__file__).resolve().parent
STATIC_DIR = PROJECT_DIR / "dashboard" / "static"
MAX_JSON_BODY_BYTES = 4 * 1024 * 1024
HISTORY_QUERY_LIMIT = 5000
HISTORY_QUERY_LIMIT_MAX = 10000
HISTORY_QUERY_HOURS_MAX = 24 * 365

BEIJING = timezone(timedelta(hours=8))


def _parse_day(value: str, *, end: bool = False, tz_minutes: int = 480):
    """Parse a YYYY-MM-DD day boundary in the given UTC offset into epoch ms."""
    text = str(value or "").strip()
    if not text:
        return None
    zone = timezone(timedelta(minutes=tz_minutes))
    day = datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=zone)
    if end:
        return int((day + timedelta(days=1)).timestamp() * 1000) - 1
    return int(day.timestamp() * 1000)


def _day_utc_bounds(from_value: str, to_value: str, *, tz_minutes: int = 480):
    """Return the UTC [start, end] strings for a local day range."""
    zone = timezone(timedelta(minutes=tz_minutes))

    def bound(value: str, end: bool):
        text = str(value or "").strip()
        if not text:
            return None
        day = datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=zone)
        if end:
            day = day + timedelta(days=1) - timedelta(seconds=1)
        return day.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    return bound(from_value, False), bound(to_value, True)
AUTO_LEAGUE_SCORE_THRESHOLD = 85.0
AUTO_FIXTURE_SCORE_THRESHOLD = 85.0
# A fixture may auto-confirm below the legacy 85 score when the parent league is
# already mapped, the kickoff matches and the team names are at least loosely
# similar. This is what lets translated team names (山度士/桑托斯) through while
# a different match at the same league still fails the time gate.
AUTO_FIXTURE_TIME_MINUTES = AUTO_MAP_TIME_MINUTES
AUTO_FIXTURE_TEAM_FLOOR = 0.15
METADATA_STATUS_PATH = PROJECT_DIR / ".run" / "metadata_sync.status.json"
METADATA_LOG_PATH = PROJECT_DIR / "logs" / "metadata_sync.log"

SETTINGS_SCHEMA: Dict[str, Dict[str, Any]] = {
    "presence_interval_seconds": {
        "label": "赛事存在性检查间隔",
        "type": "number",
        "unit": "秒",
        "min": 5,
        "max": 60,
        "step": 1,
        "default": 5,
        "restartRequired": True,
        "service": "采集器",
    },
    "snapshot_interval_seconds": {
        "label": "实时快照处理间隔",
        "type": "number",
        "unit": "秒",
        "min": 0.1,
        "max": 10,
        "step": 0.1,
        "default": 2,
        "restartRequired": True,
        "service": "快照进程",
    },
    "capture_rotation_mb": {
        "label": "原始采集文件轮转大小",
        "type": "integer",
        "unit": "MB",
        "options": [0, 128, 256, 512, 1024],
        "default": 0,
        "restartRequired": True,
        "service": "采集器",
    },
    "capture_compress_after_hours": {
        "label": "旧采集文件压缩等待时间",
        "type": "number",
        "unit": "小时",
        "min": 0,
        "max": 720,
        "step": 1,
        "default": 24,
        "restartRequired": False,
        "service": "维护任务",
    },
    "capture_compress_min_mb": {
        "label": "触发压缩的最小文件",
        "type": "number",
        "unit": "MB",
        "min": 1,
        "max": 1024,
        "step": 1,
        "default": 16,
        "restartRequired": False,
        "service": "维护任务",
    },
    "backup_keep": {
        "label": "数据库备份保留数量",
        "type": "integer",
        "unit": "份",
        "min": 1,
        "max": 30,
        "step": 1,
        "default": 7,
        "restartRequired": False,
        "service": "维护任务",
    },
    "crown_extra_markets_enabled": {
        "label": "皇冠附加盘采集",
        "type": "boolean",
        "default": True,
        "restartRequired": False,
        "service": "皇冠服务",
    },
}
SETTINGS_EDITABLE_FIELDS = frozenset(SETTINGS_SCHEMA)
TELEGRAM_EDITABLE_FIELDS = frozenset(
    {"telegram_enabled", "telegram_bot_token", "telegram_chat_id", "telegram_proxy"}
)
SETTINGS_RESTART_FIELDS = frozenset(
    key for key, item in SETTINGS_SCHEMA.items() if item.get("restartRequired")
)


def _coerce_setting_value(key: str, value: Any) -> Any:
    """Validate and normalize one user-editable setting."""
    schema = SETTINGS_SCHEMA.get(key)
    if schema is None:
        raise ValueError(f"不允许修改配置项：{key}")
    if schema.get("type") == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"配置项 {key} 必须是布尔值")
        return value
    if isinstance(value, bool):
        raise ValueError(f"配置项 {key} 必须是数字")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"配置项 {key} 必须是数字") from exc
    if not number == number or number in (float("inf"), float("-inf")):
        raise ValueError(f"配置项 {key} 数值无效")

    options = schema.get("options")
    if options is not None:
        if not number.is_integer() or int(number) not in options:
            choices = "、".join(str(item) for item in options)
            raise ValueError(f"配置项 {key} 只能是：{choices}")
        return int(number)

    minimum = float(schema["min"])
    maximum = float(schema["max"])
    if number < minimum or number > maximum:
        raise ValueError(
            f"配置项 {key} 必须在 {schema['min']} 到 {schema['max']} 之间"
        )
    if schema.get("type") == "integer":
        if not number.is_integer():
            raise ValueError(f"配置项 {key} 必须是整数")
        return int(number)
    return int(number) if number.is_integer() else number


def _coerce_telegram_value(key: str, value: Any, config: Dict[str, Any]) -> Any:
    """Validate the write-only Telegram settings."""
    if key == "telegram_enabled":
        if not isinstance(value, bool):
            raise ValueError("推送开关必须是布尔值")
        return value
    if key == "telegram_bot_token":
        text = str(value or "").strip()
        if not text:
            return str(config.get("telegram_bot_token") or "")
        if not re.fullmatch(r"\d+:[A-Za-z0-9_-]{20,}", text):
            raise ValueError("机器人 Token 格式不正确")
        return text
    if key == "telegram_chat_id":
        text = str(value or "").strip()
        if text and not re.fullmatch(r"-?\d+|@[A-Za-z0-9_]{5,}", text):
            raise ValueError("请填写群 Chat ID 或公开群 @用户名")
        return text
    if key == "telegram_proxy":
        text = str(value or "").strip()
        if text and not re.fullmatch(r"https?://[^\s]+", text):
            raise ValueError("代理地址必须以 http:// 或 https:// 开头")
        return text
    raise ValueError(f"不允许修改配置项：{key}")


def _write_settings_file(updates: Dict[str, Any]) -> Dict[str, Any]:
    """Persist a small allow-listed config patch with an atomic replace."""
    active_path = config_path()
    active_path.parent.mkdir(parents=True, exist_ok=True)
    current: Dict[str, Any] = {}
    if active_path.exists():
        try:
            loaded = json.loads(active_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"无法读取现有配置：{exc}") from exc
        if not isinstance(loaded, dict):
            raise RuntimeError("现有配置文件顶层必须是 JSON 对象")
        current = loaded

    changed = {
        key: value for key, value in updates.items() if current.get(key) != value
    }
    if not changed:
        return {"changed": {}, "backupPath": None, "path": str(active_path)}

    backup_path: Optional[Path] = None
    if active_path.exists():
        backup_dir = PROJECT_DIR / ".run" / "config-backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S-%f")
        backup_path = backup_dir / f"config-{stamp}.json"
        backup_path.write_text(
            json.dumps(current, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        if current.get("telegram_bot_token"):
            os.chmod(backup_path, 0o600)

    merged = dict(current)
    merged.update(changed)
    temporary = active_path.with_name(
        f".{active_path.name}.{os.getpid()}.{threading.get_ident()}.tmp"
    )
    try:
        temporary.write_text(
            json.dumps(merged, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, active_path)
        if merged.get("telegram_bot_token"):
            # The bot token is a credential; keep the config file owner-only.
            os.chmod(active_path, 0o600)
    finally:
        temporary.unlink(missing_ok=True)
    return {
        "changed": changed,
        "backupPath": str(backup_path) if backup_path else None,
        "path": str(active_path),
    }


def _settings_payload(
    config: Dict[str, Any],
    store: "OddsStore",
    metadata_runner: "MetadataSyncRunner",
) -> Dict[str, Any]:
    snapshot = store.snapshot()
    source = snapshot.get("source") or {}
    database_path = get_path(config, "dashboard_db_path")
    capture_path = get_path(config, "capture_path")
    backup_dir = get_path(config, "backup_dir")
    try:
        backup_count = len(
            [path for path in backup_dir.glob("odds_history-*.sqlite3") if path.is_file()]
        )
    except OSError:
        backup_count = 0
    try:
        disk = shutil.disk_usage(PROJECT_DIR)
        disk_payload = {
            "totalBytes": disk.total,
            "freeBytes": disk.free,
            "usedBytes": disk.used,
        }
    except OSError:
        disk_payload = {"totalBytes": None, "freeBytes": None, "usedBytes": None}
    metadata_raw = metadata_runner.status()
    metadata = {
        key: metadata_raw.get(key)
        for key in (
            "running",
            "startedAt",
            "finishedAt",
            "processed",
            "resolved",
            "failed",
            "updated",
            "message",
            "logPath",
            "processExitCode",
            "apply",
            "current",
        )
        if key in metadata_raw
    }
    effective = {key: config.get(key, DEFAULTS.get(key)) for key in SETTINGS_SCHEMA}
    readonly = {
        "cdp_url": config.get("cdp_url"),
        "crown_service_url": service_url(config, "crown"),
        "chrome_binary": config.get("chrome_binary"),
        "chrome_profile_dir": config.get("chrome_profile_dir"),
        "start_url": config.get("start_url"),
        "target_hosts": config.get("target_hosts"),
        "capture_path": str(capture_path),
        "events_file": str(get_path(config, "events_file")),
        "live_snapshot_file": str(get_path(config, "live_snapshot_file")),
        "dashboard_db_path": str(database_path),
        "backup_dir": str(backup_dir),
        "partner_backend_url": config.get("partner_backend_url") or DEFAULTS.get("partner_backend_url"),
        "partner_orders_db_path": str(get_path(config, "partner_orders_db_path")),
        "partner_agents": config.get("partner_agents"),
    }
    telegram = {
        "enabled": bool(config.get("telegram_enabled", False)),
        "has_token": bool(str(config.get("telegram_bot_token") or "").strip()),
        "chat_id": str(config.get("telegram_chat_id") or ""),
        "proxy": str(config.get("telegram_proxy") or ""),
    }
    return {
        "ok": True,
        "configPath": str(config_path()),
        "effective": effective,
        "telegram": telegram,
        "defaults": {
            key: schema.get("default", DEFAULTS.get(key))
            for key, schema in SETTINGS_SCHEMA.items()
        },
        "schema": SETTINGS_SCHEMA,
        "restartRequired": sorted(SETTINGS_RESTART_FIELDS),
        "readonly": readonly,
        "status": {
            "freshness": snapshot.get("freshness"),
            "lagSeconds": snapshot.get("lagSeconds"),
            "serverTime": snapshot.get("serverTime"),
            "lastCapturedAt": source.get("lastCapturedAt"),
            "lastChangeAt": source.get("lastChangeAt"),
            "databaseBytes": source.get("databaseBytes"),
            "captureBytes": source.get("captureBytes"),
            "persistedPoints": source.get("persistedPoints"),
            "databaseQueued": source.get("databaseQueued"),
            "databaseDropped": source.get("databaseDropped"),
            "databaseErrors": source.get("databaseErrors"),
            "backupCount": backup_count,
            "metadata": metadata,
            "disk": disk_payload,
        },
    }


class CaptureTailer(threading.Thread):
    def __init__(self, store: OddsStore):
        super().__init__(name="capture-tailer", daemon=True)
        self.store = store
        self.stop_event = threading.Event()

    def stop(self) -> None:
        self.stop_event.set()

    def run(self) -> None:
        handle = None
        inode: Optional[int] = None
        while not self.stop_event.is_set():
            if handle is None:
                if not self.store.capture_path.exists():
                    self.stop_event.wait(0.5)
                    continue
                try:
                    handle = self.store.capture_path.open(
                        encoding="utf-8", errors="replace"
                    )
                    handle.seek(0, os.SEEK_END)
                    inode = self.store.capture_path.stat().st_ino
                except OSError:
                    handle = None
                    self.stop_event.wait(0.5)
                    continue
            line = handle.readline()
            if line:
                self.store.process_line(line, source="tail")
                continue
            try:
                current_inode = self.store.capture_path.stat().st_ino
            except OSError:
                current_inode = inode
            if inode is not None and current_inode != inode:
                handle.close()
                handle = None
                inode = None
                continue
            self.stop_event.wait(0.35)
        if handle is not None:
            handle.close()


class MetadataSyncRunner:
    """Run metadata repair in a single guarded background process."""

    def __init__(
        self,
        store: OddsStore,
        status_path: Path = METADATA_STATUS_PATH,
        log_path: Path = METADATA_LOG_PATH,
    ):
        self.store = store
        self.status_path = status_path
        self.log_path = log_path
        self._lock = threading.Lock()
        self._process: Optional[subprocess.Popen] = None
        self._exit_code: Optional[int] = None
        self._last_loaded_signature = ""
        self._monitor_thread: Optional[threading.Thread] = None
        self._closed = False

    def _read_status_file(self) -> Dict[str, Any]:
        if not self.status_path.exists():
            return {}
        try:
            payload = json.loads(self.status_path.read_text(encoding="utf-8"))
            return payload if isinstance(payload, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def start(self, apply: bool) -> Dict[str, Any]:
        with self._lock:
            if self._closed:
                return {"ok": False, "started": False, "running": False, "message": "服务正在停止"}
            if self._process is not None and self._process.poll() is None:
                return {
                    "ok": True,
                    "started": False,
                    "running": True,
                    "message": "元数据补全任务正在运行",
                    "status": self._status_locked(),
                }

            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            log_handle = self.log_path.open("a", encoding="utf-8")
            command = [
                sys.executable,
                "-u",
                str(PROJECT_DIR / "metadata_sync.py"),
                "--concurrency",
                "2",
            ]
            if apply:
                command.append("--apply")
            try:
                process = subprocess.Popen(
                    command,
                    cwd=str(PROJECT_DIR),
                    stdout=log_handle,
                    stderr=subprocess.STDOUT,
                    env=os.environ.copy(),
                    text=True,
                )
            except Exception:
                log_handle.close()
                raise
            self._process = process
            self._exit_code = None
            monitor = threading.Thread(
                target=self._monitor,
                args=(process, log_handle, apply),
                name="metadata-sync-monitor",
                daemon=True,
            )
            self._monitor_thread = monitor
            monitor.start()
            return {
                "ok": True,
                "started": True,
                "running": True,
                "apply": apply,
                "message": "已启动元数据补全任务" if apply else "已启动缺失检查",
            }

    def _monitor(self, process: subprocess.Popen, log_handle: Any, apply: bool) -> None:
        try:
            exit_code = process.wait()
        finally:
            log_handle.close()
        if apply and not self._closed:
            try:
                self.store.reload_metadata_from_db()
            except Exception as exc:
                print(f"[元数据重载失败] {exc}", flush=True)
        with self._lock:
            self._exit_code = exit_code
            if self._process is process:
                self._process = None

    def _status_locked(self) -> Dict[str, Any]:
        process_running = self._process is not None and self._process.poll() is None
        payload = self._read_status_file()
        signature = "|".join(
            str(payload.get(key, ""))
            for key in ("startedAt", "finishedAt", "updated")
        )
        if (
            not process_running
            and payload.get("apply")
            and int(payload.get("updated") or 0) > 0
            and signature != self._last_loaded_signature
        ):
            try:
                self.store.reload_metadata_from_db()
                self._last_loaded_signature = signature
            except Exception as exc:
                print(f"[元数据状态重载失败] {exc}", flush=True)
        payload["running"] = process_running
        payload["processExitCode"] = self._exit_code
        payload["logPath"] = str(self.log_path)
        with self.store.lock:
            events = len(self.store.events)
            missing = sum(
                1
                for event in self.store.events.values()
                if event.get("metadataStatus") != "complete"
            )
        payload["current"] = {"events": events, "missing": missing}
        if not process_running and self._exit_code not in (None, 0):
            payload["message"] = payload.get("message") or f"元数据任务退出码 {self._exit_code}"
        return payload

    def status(self) -> Dict[str, Any]:
        with self._lock:
            return self._status_locked()

    def close(self) -> None:
        with self._lock:
            self._closed = True
            process = self._process
            monitor = self._monitor_thread
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        if monitor is not None and monitor is not threading.current_thread():
            monitor.join()


class DashboardHandler(BaseHTTPRequestHandler):
    store: OddsStore
    metadata_runner: MetadataSyncRunner
    merge_store: FixtureMergeStore
    config: Dict[str, Any]
    config_lock = threading.RLock()

    def __init__(self, request, client_address, server):
        if hasattr(server, "odds_store"):
            self.store = server.odds_store
            self.metadata_runner = server.metadata_runner
            self.merge_store = server.merge_store
            self.config = server.dashboard_config
            self.config_lock = server.config_lock
            self.partner_orders_path = getattr(server, "partner_orders_path", None)
            self.telegram_runner = getattr(server, "telegram_runner", None)
        super().__init__(request, client_address, server)

    def _settings_response(self) -> Dict[str, Any]:
        with self.config_lock:
            return _settings_payload(self.config, self.store, self.metadata_runner)

    def _update_settings(self) -> None:
        try:
            payload = self.read_json_body()
        except ValueError as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=400)
            return
        unknown = sorted(set(payload) - SETTINGS_EDITABLE_FIELDS - TELEGRAM_EDITABLE_FIELDS)
        if unknown:
            self.send_json(
                {"ok": False, "error": f"不允许修改配置项：{'、'.join(unknown)}"},
                status=400,
            )
            return
        if not payload:
            self.send_json({"ok": False, "error": "请求中没有可保存的配置项"}, status=400)
            return
        try:
            updates = {}
            for key, value in payload.items():
                if key in TELEGRAM_EDITABLE_FIELDS:
                    updates[key] = _coerce_telegram_value(key, value, self.config)
                else:
                    updates[key] = _coerce_setting_value(key, value)
        except ValueError as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=400)
            return
        with self.config_lock:
            try:
                result = _write_settings_file(updates)
            except (OSError, RuntimeError) as exc:
                self.send_json({"ok": False, "error": f"配置保存失败：{exc}"}, status=500)
                return
            self.config.update(updates)
            if updates.get("telegram_enabled") is True:
                runner = getattr(self, "telegram_runner", None)
                if runner is not None:
                    runner.arm()
            response = self._settings_response()
        visible_changes = {
            key: value for key, value in result["changed"].items()
            if key != "telegram_bot_token"
        }
        response.update(
            {
                "changed": visible_changes,
                "backupPath": result["backupPath"],
                "restartRequired": sorted(
                    set(result["changed"]) & SETTINGS_RESTART_FIELDS
                ),
                "message": (
                    "配置已保存，部分设置需要重启对应服务"
                    if set(result["changed"]) & SETTINGS_RESTART_FIELDS
                    else "配置已保存"
                ),
            }
        )
        self.send_json(response)

    def _backup_database(self) -> None:
        with self.config_lock:
            try:
                result = backup_database(self.config)
            except (OSError, RuntimeError, sqlite3.Error, ValueError) as exc:
                self.send_json({"ok": False, "error": f"数据库备份失败：{exc}"}, status=500)
                return
        self.send_json({"ok": True, "message": "数据库备份完成", "backup": result})

    def _check_database_integrity(self) -> None:
        with self.config_lock:
            path = get_path(self.config, "dashboard_db_path")
        try:
            result = verify_database(path, immutable=False, quick=True)
        except (OSError, RuntimeError, sqlite3.Error) as exc:
            self.send_json(
                {"ok": False, "databasePath": str(path), "error": f"数据库检查失败：{exc}"},
                status=500,
            )
            return
        self.send_json(
            {"ok": True, "databasePath": str(path), "result": result, "message": "SQLite 完整性正常"}
        )

    def _crown_fixture_events(self) -> tuple[list[Dict[str, Any]], Optional[str]]:
        config = getattr(self, "config", {})
        connection = http.client.HTTPConnection(
            str(config.get("crown_host") or "127.0.0.1"),
            int(config.get("crown_port") or 9223), timeout=4,
        )
        error = "皇冠服务暂不可用；请确认皇冠数据已连接后重试。"
        self._crown_source = crown_freshness(error=error)
        try:
            connection.request("GET", "/api/crown/events?compact=1")
            response = connection.getresponse()
            body = response.read(4 * 1024 * 1024 + 1)
            if response.status != 200 or len(body) > 4 * 1024 * 1024:
                error = "皇冠赛事数据暂不可用，请检查皇冠服务。"
                self._crown_source = crown_freshness(error=error)
                return [], error
            payload = json.loads(body.decode("utf-8"))
            events = payload.get("events") if isinstance(payload, dict) else None
            if not isinstance(events, list):
                error = "皇冠赛事数据格式暂不可用。"
                self._crown_source = crown_freshness(error=error)
                return [], error
            self._crown_source = crown_freshness(payload)
            return events, self._crown_source["error"]
        except (OSError, http.client.HTTPException, UnicodeDecodeError, json.JSONDecodeError):
            return [], error
        finally:
            connection.close()

    def _merge_sources(self, snapshot: Dict[str, Any], crown_error: Optional[str]) -> Dict[str, Any]:
        return {
            "pinnacle": pinnacle_freshness(snapshot),
            "crown": getattr(self, "_crown_source", crown_freshness(error=crown_error)),
        }

    def _merge_event_lists(self) -> tuple[list[Dict[str, Any]], list[Dict[str, Any]], Optional[str]]:
        snapshot = self.store.snapshot()
        # Crown lists fixtures several days ahead; use the wider mapping pool so
        # an early-morning Pinnacle fixture is not replaced by a namesake
        # competition that happens to be inside the daily dashboard window.
        source_pinnacle = self.store.merge_events()
        source_crown, crown_error = self._crown_fixture_events()
        self._merge_source_status = self._merge_sources(snapshot, crown_error)
        pinnacle_events = [
            prepare_pinnacle_event(event)
            for event in source_pinnacle
            if isinstance(event, dict)
        ]
        crown_events = [
            prepare_crown_event(event)
            for event in source_crown
            if isinstance(event, dict)
        ]
        return pinnacle_events, crown_events, crown_error

    def _merge_aliases(self) -> Dict[str, Any]:
        """Exact name aliases learned from already-confirmed mappings."""
        league_pairs = [
            ((item.get("pinnacleSnapshot") or {}).get("name"),
             (item.get("crownSnapshot") or {}).get("name"))
            for item in self.merge_store.list_league_mappings()
        ]
        team_pairs = []
        for item in self.merge_store.list_mappings():
            pinnacle = item.get("pinnacleSnapshot") or {}
            crown = item.get("crownSnapshot") or {}
            team_pairs.append((pinnacle.get("home"), crown.get("home")))
            team_pairs.append((pinnacle.get("away"), crown.get("away")))
        return build_alias_index(league_pairs, team_pairs)

    def _merge_payload(self) -> Dict[str, Any]:
        pinnacle_events, crown_events, crown_error = self._merge_event_lists()
        mappings = self.merge_store.list_mappings()
        league_mappings = self.merge_store.list_league_mappings()
        mapped_pinnacle = {item.get("pinnacleId") for item in mappings}
        mapped_crown = {item.get("crownId") for item in mappings}
        league_mapping_by_crown = {
            str(item.get("crownId") or ""): str(item.get("pinnacleId") or "")
            for item in league_mappings
        }
        mapped_pinnacle_leagues = {
            str(item.get("pinnacleId") or "") for item in league_mappings
        }
        mapped_crown_leagues = set(league_mapping_by_crown)
        pinnacle_leagues = summarize_leagues(pinnacle_events)
        crown_leagues = summarize_leagues(crown_events)
        aliases = self._merge_aliases()
        league_suggestion_map = rank_league_candidates(
            pinnacle_events, crown_events, limit=5, aliases=aliases
        )
        league_suggestions = [
            candidate
            for crown_id, candidates in league_suggestion_map.items()
            if crown_id not in mapped_crown_leagues
            for candidate in candidates
            if candidate.get("pinnacleLeagueId") not in mapped_pinnacle_leagues
        ]
        pinnacle_by_id = {str(event.get("id") or ""): event for event in pinnacle_events}
        crown_by_id = {str(event.get("id") or ""): event for event in crown_events}
        suggestion_map = rank_candidates(
            pinnacle_events,
            crown_events,
            limit=5,
            aliases=aliases,
            league_mapping=league_mapping_by_crown,
        )
        suggestions = []
        for pinnacle_id, candidates in suggestion_map.items():
            if pinnacle_id in mapped_pinnacle:
                continue
            pinnacle_event = pinnacle_by_id.get(pinnacle_id) or {}
            for candidate in candidates:
                crown_id = str(candidate.get("crownId") or "")
                if crown_id in mapped_crown:
                    continue
                crown_event = crown_by_id.get(crown_id) or {}
                if league_mapping_by_crown.get(str(crown_event.get("leagueId") or "")) != str(
                    pinnacle_event.get("leagueId") or ""
                ):
                    continue
                suggestions.append({"pinnacleId": pinnacle_id, **candidate})
        generated_at = now_iso()
        return {
            "ok": True,
            "generatedAt": generated_at,
            "updatedAt": generated_at,
            "sources": self._merge_source_status,
            "pinnacleEvents": pinnacle_events,
            "crownEvents": crown_events,
            "pinnacleLeagues": pinnacle_leagues,
            "crownLeagues": crown_leagues,
            "leagueMappings": league_mappings,
            "leagueSuggestions": league_suggestions,
            "mappings": mappings,
            "suggestions": suggestions,
            "crownError": crown_error,
        }

    def _merge_confirmed_payload(self, query: Dict[str, list[str]]) -> Dict[str, Any]:
        """Build the homepage data for manually confirmed fixture links.

        Provider IDs are scoped to their own feed.  This endpoint therefore
        joins only through ``fixture_mappings`` and never attempts to infer a
        match from names or IDs.  Crown supplies the display name and markets;
        Pinnacle contributes its current full-time rows for the same confirmed
        fixture.
        """
        requested_crown = as_text((query.get("crownId") or [""])[0])
        requested_pinnacle = as_text((query.get("pinnacleId") or [""])[0])
        if len(requested_crown) > 128 or len(requested_pinnacle) > 128:
            return {"ok": False, "error": "赛事 ID 参数过长。"}

        pinnacle_snapshot = self.store.snapshot()
        crown_events, crown_error = self._crown_fixture_events()
        sources = self._merge_sources(pinnacle_snapshot, crown_error)
        crown_by_id = {
            as_text(item.get("id")): item
            for item in crown_events
            if isinstance(item, dict) and as_text(item.get("id"))
        }
        mappings = self.merge_store.list_mappings()
        items: list[Dict[str, Any]] = []
        for mapping in mappings:
            pinnacle_id = as_text(mapping.get("pinnacleId"))
            crown_id = as_text(mapping.get("crownId"))
            if requested_crown and crown_id != requested_crown:
                continue
            if requested_pinnacle and pinnacle_id != requested_pinnacle:
                continue

            raw_crown = crown_by_id.get(crown_id)
            crown_snapshot = mapping.get("crownSnapshot")
            if not isinstance(crown_snapshot, dict):
                crown_snapshot = {}
            if isinstance(raw_crown, dict):
                crown_event = {
                    **prepare_crown_event(raw_crown),
                    "markets": raw_crown.get("markets") or {},
                    "extra_markets": raw_crown.get("extra_markets") or {},
                    "oddsFormat": raw_crown.get("odds_format") or raw_crown.get("oddsFormat") or "HK",
                    "oddsFormatLabel": raw_crown.get("odds_format_label") or raw_crown.get("oddsFormatLabel") or "皇冠港赔（HK）",
                }
            else:
                # Keep the last confirmed snapshot available while Crown is
                # temporarily offline; current markets are simply empty.
                crown_event = {
                    **crown_snapshot,
                    "id": crown_id or as_text(crown_snapshot.get("id")),
                    "leagueId": as_text(crown_snapshot.get("leagueId") or crown_snapshot.get("league_id")),
                    "markets": {},
                    "extra_markets": {},
                }

            pinnacle_snapshot = mapping.get("pinnacleSnapshot")
            if not isinstance(pinnacle_snapshot, dict):
                pinnacle_snapshot = {}
            pinnacle_details = self.store.event_details(pinnacle_id, pinnacle_snapshot)
            if pinnacle_details is None:
                pinnacle_event = {
                    **pinnacle_snapshot,
                    "id": pinnacle_id or as_text(pinnacle_snapshot.get("id")),
                }
                pinnacle_odds: list[Dict[str, Any]] = []
            else:
                pinnacle_event = prepare_pinnacle_event(pinnacle_details["event"])
                pinnacle_odds = pinnacle_details["odds"]

            items.append({
                "confirmed": True,
                "pinnacleId": pinnacle_id,
                "crownId": crown_id,
                "updatedAt": mapping.get("updatedAt") or mapping.get("updated_at"),
                "pinnacle": {**pinnacle_event, "odds": pinnacle_odds},
                "crown": crown_event,
                "pinnacleEvent": {**pinnacle_event, "odds": pinnacle_odds},
                "crownEvent": crown_event,
            })

        generated_at = now_iso()
        return {
            "ok": True,
            "generatedAt": generated_at,
            "updatedAt": generated_at,
            "sources": sources,
            "items": items,
            "count": len(items),
            "crownError": crown_error,
        }

    def _scan_opportunities(self) -> Dict[str, Any]:
        """Scan every confirmed fixture for same-line cross-book pairs."""
        crown_events, crown_error = self._crown_fixture_events()
        sources = {
            "pinnacle": pinnacle_freshness(self.store.freshness_snapshot()),
            "crown": getattr(self, "_crown_source", crown_freshness(error=crown_error)),
        }
        crown_by_id = {
            str(item.get("id") or ""): item
            for item in crown_events
            if isinstance(item, dict) and str(item.get("id") or "")
        }
        mappings = self.merge_store.list_mappings()
        rows_by_crown: Dict[str, Dict[str, Any]] = {}
        for mapping in mappings:
            crown_id = str(mapping.get("crownId") or "")
            crown = crown_by_id.get(crown_id)
            if not isinstance(crown, dict):
                continue
            markets = crown.get("markets") if isinstance(crown.get("markets"), dict) else {}
            if not (markets.get("handicap") or markets.get("total")):
                continue
            details = self.store.event_rows(
                mapping.get("pinnacleId"), mapping.get("pinnacleSnapshot")
            )
            if details:
                # The live store keeps the provider kickoff string, while a
                # confirmed mapping stores the already-normalized instant.
                # Carry that snapshot metadata into the scanner so a UTC host
                # cannot reinterpret a local provider time and discard a valid
                # same-fixture pair.
                snapshot = mapping.get("pinnacleSnapshot")
                if isinstance(snapshot, dict):
                    event = details.get("event")
                    if isinstance(event, dict):
                        details["event"] = {
                            **event,
                            **{key: snapshot[key] for key in (
                                "normalizedKickoff", "normalizedTimezone",
                                "sourceTimezone",
                            ) if snapshot.get(key)},
                        }
                rows_by_crown[crown_id] = details
        result = find_opportunities(
            crown_events,
            rows_by_crown,
            mappings,
            crown_updated_at=sources["crown"].get("dataUpdatedAt")
            if isinstance(sources.get("crown"), dict) else None,
            min_edge=-0.05,
            limit=50,
        )
        return {
            "items": result["items"],
            "stats": result["stats"],
            "sources": sources,
            "crownError": crown_error,
        }

    def _merge_opportunities_payload(self, query: Dict[str, list[str]]) -> Dict[str, Any]:
        """Return the closest same-line arbitrage candidates across mappings.

        The scan is cached for two seconds because it reads every confirmed
        fixture; query parameters only filter the cached ranking.
        """
        try:
            limit = max(1, min(50, int((query.get("limit") or ["15"])[0])))
        except ValueError:
            limit = 15
        try:
            min_edge = float((query.get("minEdge") or ["-5"])[0]) / 100.0
        except ValueError:
            min_edge = -0.05
        live_only = str((query.get("liveOnly") or ["0"])[0]).lower() in {
            "1", "true", "yes", "on"
        }

        server = self.server
        with _OPPORTUNITY_CACHE_LOCK:
            cached = getattr(server, "opportunity_cache", None)
            now_mono = time.monotonic()
            if cached and now_mono - cached["at"] < 2.0:
                base = cached["value"]
            else:
                base = self._scan_opportunities()
                server.opportunity_cache = {"at": now_mono, "value": base}
        items = base["items"]
        if live_only:
            items = [item for item in items if item.get("isLive")]
        items = [
            item for item in items
            if float(item.get("edge") or 0.0) >= min_edge
        ][:limit]
        return {
            "ok": True,
            "generatedAt": now_iso(),
            "sources": base["sources"],
            "stats": base["stats"],
            "items": items,
            "count": len(items),
            "crownError": base.get("crownError"),
        }

    def _handle_merge_league_mapping(self) -> None:
        try:
            payload = self.read_json_body()
        except ValueError as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=400)
            return

        action = as_text(payload.get("action"))
        crown_id = as_text(payload.get("crownLeagueId"))
        if not crown_id or len(crown_id) > 128:
            self.send_json({"ok": False, "error": "皇冠联赛 ID 无效。"}, status=400)
            return
        if action == "unmap":
            try:
                self.merge_store.unmap_league(crown_id)
            except MappingConflict as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=409)
                return
            self.send_json({
                "ok": True,
                "leagueMappings": self.merge_store.list_league_mappings(),
            })
            return
        if action != "map":
            self.send_json({"ok": False, "error": "不支持的联赛关联操作。"}, status=400)
            return

        pinnacle_id = as_text(payload.get("pinnacleLeagueId"))
        if not pinnacle_id or len(pinnacle_id) > 128:
            self.send_json({"ok": False, "error": "平博联赛 ID 无效。"}, status=400)
            return
        pinnacle_events, crown_events, crown_error = self._merge_event_lists()
        if crown_error:
            self.send_json({"ok": False, "error": crown_error}, status=503)
            return
        pinnacle_league = next(
            (item for item in summarize_leagues(pinnacle_events)
             if item["id"] == pinnacle_id),
            None,
        )
        crown_league = next(
            (item for item in summarize_leagues(crown_events)
             if item["id"] == crown_id),
            None,
        )
        if pinnacle_league is None or crown_league is None:
            self.send_json(
                {"ok": False, "error": "联赛列表已更新，请刷新后重新选择。"},
                status=409,
            )
            return
        if competition_conflict(pinnacle_league.get("name"), crown_league.get("name")):
            self.send_json(
                {
                    "ok": False,
                    "error": (
                        "两个联赛的赛事类别不一致（青年/预备队/女子），"
                        "不能关联；请选择同一类别的联赛。"
                    ),
                },
                status=409,
            )
            return
        try:
            self.merge_store.map_leagues(pinnacle_league, crown_league)
        except MappingConflict as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=409)
            return
        self.send_json({
            "ok": True,
            "leagueMappings": self.merge_store.list_league_mappings(),
        })

    def _handle_merge_league_auto_mapping(self) -> None:
        """Confirm unambiguous high-scoring leagues and fixtures.

        This endpoint is intentionally POST-only so loading the merge page does
        not mutate mappings until the page explicitly asks for auto-confirm.
        Fixture candidates are considered only after their parent leagues are
        mapped, and both sides must have a unique high-scoring candidate.
        """
        pinnacle_events, crown_events, crown_error = self._merge_event_lists()
        if crown_error:
            self.send_json({"ok": False, "error": crown_error}, status=503)
            return

        league_mappings = self.merge_store.list_league_mappings()
        mapped_crown = {str(item.get("crownId") or "") for item in league_mappings}
        mapped_pinnacle = {str(item.get("pinnacleId") or "") for item in league_mappings}
        pinnacle_by_id = {
            str(item.get("id") or ""): item for item in summarize_leagues(pinnacle_events)
        }
        crown_by_id = {
            str(item.get("id") or ""): item for item in summarize_leagues(crown_events)
        }
        aliases = self._merge_aliases()
        ranked = rank_league_candidates(
            pinnacle_events, crown_events, limit=5, aliases=aliases
        )

        # A candidate is safe to auto-confirm only when it is the sole high
        # scoring option for its Crown league and no other Crown league points
        # to the same Pinnacle league above the threshold.
        candidates = []
        for crown_id, options in ranked.items():
            if crown_id in mapped_crown:
                continue
            crown_name = (crown_by_id.get(crown_id) or {}).get("name")
            high = [
                item for item in options
                # Country/event-count bonuses improve the human-facing ranking;
                # auto-confirm still needs the original name+fixture evidence
                # score above 85 and at least one matching fixture.
                if float(item.get("baseScore") or 0) > AUTO_LEAGUE_SCORE_THRESHOLD
                and int(item.get("evidenceCount") or 0) >= 1
                and not competition_conflict(
                    (pinnacle_by_id.get(str(item.get("pinnacleLeagueId") or "")) or {}).get("name"),
                    crown_name,
                )
            ]
            if len(high) != 1:
                continue
            candidate = high[0]
            pinnacle_id = str(candidate.get("pinnacleLeagueId") or "")
            if pinnacle_id in mapped_pinnacle:
                continue
            if crown_id not in crown_by_id or pinnacle_id not in pinnacle_by_id:
                continue
            candidates.append(candidate)

        by_pinnacle: dict[str, list[dict[str, Any]]] = {}
        for candidate in candidates:
            by_pinnacle.setdefault(str(candidate["pinnacleLeagueId"]), []).append(candidate)

        auto_candidates = [
            candidate
            for candidate in candidates
            if len(by_pinnacle.get(str(candidate["pinnacleLeagueId"]), [])) == 1
        ]
        auto_candidates.sort(
            key=lambda item: (-float(item.get("score") or 0), str(item.get("crownLeagueId") or ""))
        )

        mapped = []
        skipped = []
        for candidate in auto_candidates:
            crown_id = str(candidate["crownLeagueId"])
            pinnacle_id = str(candidate["pinnacleLeagueId"])
            if crown_id in mapped_crown or pinnacle_id in mapped_pinnacle:
                continue
            try:
                saved = self.merge_store.map_leagues(
                    pinnacle_by_id[pinnacle_id], crown_by_id[crown_id]
                )
            except MappingConflict as exc:
                skipped.append({
                    "crownLeagueId": crown_id,
                    "pinnacleLeagueId": pinnacle_id,
                    "score": candidate.get("score"),
                    "reason": str(exc),
                })
                continue
            mapped.append({**saved, "score": candidate.get("score")})
            mapped_crown.add(crown_id)
            mapped_pinnacle.add(pinnacle_id)

        league_mappings = self.merge_store.list_league_mappings()
        pinnacle_league_by_crown = {
            str(item.get("crownId") or ""): str(item.get("pinnacleId") or "")
            for item in league_mappings
        }
        existing_mappings = self.merge_store.list_mappings()
        mapped_pinnacle_events = {str(item.get("pinnacleId") or "") for item in existing_mappings}
        mapped_crown_events = {str(item.get("crownId") or "") for item in existing_mappings}
        pinnacle_event_by_id = {str(item.get("id") or ""): item for item in pinnacle_events}
        crown_event_by_id = {str(item.get("id") or ""): item for item in crown_events}

        ranked_fixtures = rank_candidates(
            pinnacle_events,
            crown_events,
            limit=5,
            aliases=aliases,
            league_mapping=pinnacle_league_by_crown,
        )
        fixture_candidates = []
        for pinnacle_id, options in ranked_fixtures.items():
            if not pinnacle_id or pinnacle_id in mapped_pinnacle_events:
                continue
            pinnacle_event = pinnacle_event_by_id.get(pinnacle_id)
            if not pinnacle_event:
                continue
            pinnacle_league_id = str(pinnacle_event.get("leagueId") or "")
            eligible = []
            for item in options:
                crown_id = str(item.get("crownId") or "")
                crown_event = crown_event_by_id.get(crown_id)
                if not crown_event or crown_id in mapped_crown_events:
                    continue
                crown_league_id = str(crown_event.get("leagueId") or "")
                if pinnacle_league_by_crown.get(crown_league_id) != pinnacle_league_id:
                    continue
                if item.get("reversedOrder"):
                    continue
                if competition_conflict(
                    pinnacle_event.get("league"), crown_event.get("league")
                ):
                    continue
                team_score = float(item.get("teamScore") or 0)
                try:
                    delta = (
                        float(item.get("kickoffDeltaMinutes"))
                        if item.get("kickoffDeltaMinutes") is not None
                        else None
                    )
                except (TypeError, ValueError):
                    delta = None
                team_ok = team_score >= AUTO_FIXTURE_TEAM_FLOOR
                high_score = float(item.get("score") or 0) > AUTO_FIXTURE_SCORE_THRESHOLD
                if delta is None:
                    # No usable kickoff on one side: only an overwhelmingly
                    # strong name+league score may still auto-confirm.
                    eligible_ok = high_score
                else:
                    # A known kickoff outside the window can never be rescued by
                    # a high name score: that is how the senior Crown fixture
                    # was once linked to the Pinnacle U19 fixture.
                    eligible_ok = delta <= AUTO_MAP_TIME_MINUTES and team_ok
                if not eligible_ok:
                    continue
                eligible.append(item)
            if len(eligible) == 1:
                fixture_candidates.append(eligible[0])

        by_crown_event: dict[str, list[dict[str, Any]]] = {}
        for candidate in fixture_candidates:
            by_crown_event.setdefault(str(candidate.get("crownId") or ""), []).append(candidate)

        mapped_fixtures = []
        skipped_fixtures = []
        fixture_order = sorted(
            fixture_candidates,
            key=lambda item: (-float(item.get("score") or 0), str(item.get("pinnacleId") or "")),
        )
        for candidate in fixture_order:
            pinnacle_id = str(candidate.get("pinnacleId") or "")
            crown_id = str(candidate.get("crownId") or "")
            if len(by_crown_event.get(crown_id, [])) != 1:
                continue
            if pinnacle_id in mapped_pinnacle_events or crown_id in mapped_crown_events:
                continue
            try:
                saved = self.merge_store.map_events(
                    pinnacle_event_by_id[pinnacle_id], crown_event_by_id[crown_id]
                )
            except MappingConflict as exc:
                skipped_fixtures.append({
                    "pinnacleId": pinnacle_id,
                    "crownId": crown_id,
                    "score": candidate.get("score"),
                    "reason": str(exc),
                })
                continue
            mapped_fixtures.append({**saved, "score": candidate.get("score")})
            mapped_pinnacle_events.add(pinnacle_id)
            mapped_crown_events.add(crown_id)

        self.send_json({
            "ok": True,
            "leagueThreshold": AUTO_LEAGUE_SCORE_THRESHOLD,
            "fixtureThreshold": AUTO_FIXTURE_SCORE_THRESHOLD,
            "fixtureTimeMinutes": AUTO_FIXTURE_TIME_MINUTES,
            "fixtureTeamFloor": AUTO_FIXTURE_TEAM_FLOOR,
            "mappedLeagues": mapped,
            "mappedFixtures": mapped_fixtures,
            "skipped": skipped,
            "skippedFixtures": skipped_fixtures,
            "leagueMappings": league_mappings,
            "mappings": self.merge_store.list_mappings(),
        })

    def _handle_merge_mapping(self) -> None:
        try:
            payload = self.read_json_body()
        except ValueError as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=400)
            return

        action = as_text(payload.get("action"))
        pinnacle_id = as_text(payload.get("pinnacleId"))
        if not pinnacle_id or len(pinnacle_id) > 128:
            self.send_json({"ok": False, "error": "平博赛事 ID 无效。"}, status=400)
            return
        if action == "unmap":
            self.merge_store.unmap(pinnacle_id)
            self.send_json({"ok": True, "mappings": self.merge_store.list_mappings()})
            return
        if action != "map":
            self.send_json({"ok": False, "error": "不支持的合并操作。"}, status=400)
            return

        crown_id = as_text(payload.get("crownId"))
        if not crown_id or len(crown_id) > 128:
            self.send_json({"ok": False, "error": "皇冠赛事 ID 无效。"}, status=400)
            return
        pinnacle_events, crown_events, crown_error = self._merge_event_lists()
        if crown_error:
            self.send_json({"ok": False, "error": crown_error}, status=503)
            return
        pinnacle_event = next((event for event in pinnacle_events if as_text(event.get("id")) == pinnacle_id), None)
        crown_event = next((event for event in crown_events if as_text(event.get("id")) == crown_id), None)
        if pinnacle_event is None or crown_event is None:
            self.send_json(
                {"ok": False, "error": "赛事列表已更新，请刷新后重新选择。"},
                status=409,
            )
            return
        if competition_conflict(pinnacle_event.get("league"), crown_event.get("league")):
            self.send_json(
                {
                    "ok": False,
                    "error": (
                        "两场赛事的联赛类别不一致（青年/预备队/女子），"
                        "不能关联；请确认选择的是同一场比赛。"
                    ),
                },
                status=409,
            )
            return
        try:
            self.merge_store.map_events(pinnacle_event, crown_event)
        except MappingConflict as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=409)
            return
        self.send_json({"ok": True, "mappings": self.merge_store.list_mappings()})

    def log_message(self, fmt: str, *args: Any) -> None:
        if args and str(args[1]).startswith("4"):
            super().log_message(fmt, *args)

    def _partner_connection(self):
        path = getattr(self, "partner_orders_path", None)
        if not path:
            return None
        path = Path(path)
        if not path.exists():
            return None
        try:
            connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
            connection.row_factory = sqlite3.Row
            return connection
        except sqlite3.Error:
            return None

    def _my_events(self, query) -> None:
        status = (query.get("status") or ["OPEN"])[0].strip().upper()
        if status not in {"OPEN", "SETTLED", "ALL"}:
            status = "OPEN"
        agent = (query.get("agent") or [""])[0].strip() or None
        search = (query.get("search") or [""])[0].strip()
        try:
            limit = max(1, min(200, int((query.get("limit") or ["50"])[0])))
            offset = max(0, int((query.get("offset") or ["0"])[0]))
        except ValueError:
            self.send_json({"ok": False, "error": "limit 或 offset 格式不正确"}, status=400)
            return
        basis = (query.get("basis") or ["created"])[0].strip().lower()
        if basis not in {"created", "settled"}:
            basis = "created"
        try:
            tz_minutes = int((query.get("tz") or ["480"])[0])
        except ValueError:
            tz_minutes = 480
        tz_minutes = max(-720, min(840, tz_minutes))
        try:
            from_value = (query.get("from") or [""])[0]
            to_value = (query.get("to") or [""])[0]
            from_ms = _parse_day(from_value, end=False, tz_minutes=tz_minutes)
            to_ms = _parse_day(to_value, end=True, tz_minutes=tz_minutes)
            from_utc, to_utc = _day_utc_bounds(from_value, to_value, tz_minutes=tz_minutes)
        except ValueError:
            self.send_json({"ok": False, "error": "日期格式必须是 YYYY-MM-DD"}, status=400)
            return
        connection = self._partner_connection()
        if connection is None:
            self.send_json({"ok": True, "ready": False, "total": 0, "rows": [],
                            "agents": [], "status": status})
            return
        try:
            payload = partner_orders.query_orders(
                connection, None if status == "ALL" else status, agent, search, limit, offset,
                from_ms, to_ms, basis=basis, from_utc=from_utc, to_utc=to_utc,
            )
            payload["agents"] = [dict(row) for row in connection.execute(
                "SELECT code, level, name FROM partner_agents ORDER BY code"
            )]
        except sqlite3.Error as exc:
            self.send_json({"ok": False, "error": f"订单库读取失败：{exc}"}, status=500)
            return
        finally:
            connection.close()
        payload.update({"ok": True, "ready": True, "status": status,
                        "basis": basis, "tz": tz_minutes})
        self.send_json(payload)

    def _my_events_events(self, query) -> None:
        raw = (query.get("cursor") or [""])[0].strip()
        if raw == "":
            cursor = None
        else:
            try:
                cursor = int(raw)
            except ValueError:
                self.send_json({"ok": False, "error": "cursor 格式不正确"}, status=400)
                return
            if cursor < 0:
                self.send_json({"ok": False, "error": "cursor 不能为负数"}, status=400)
                return
        connection = self._partner_connection()
        if connection is None:
            self.send_json({"ok": True, "ready": False, "cursor": 0,
                            "reset": False, "events": []})
            return
        try:
            payload = partner_orders.query_events(connection, cursor, 50)
        except sqlite3.Error as exc:
            self.send_json({"ok": False, "error": f"新单事件读取失败：{exc}"}, status=500)
            return
        finally:
            connection.close()
        payload.update({"ok": True, "ready": True})
        self.send_json(payload)

    def _my_events_summary(self, query) -> None:
        agent = (query.get("agent") or [""])[0].strip() or None
        basis = (query.get("basis") or ["created"])[0].strip().lower()
        if basis not in {"created", "settled"}:
            basis = "created"
        try:
            tz_minutes = int((query.get("tz") or ["480"])[0])
        except ValueError:
            tz_minutes = 480
        tz_minutes = max(-720, min(840, tz_minutes))
        try:
            from_value = (query.get("from") or [""])[0]
            to_value = (query.get("to") or [""])[0]
            from_ms = _parse_day(from_value, end=False, tz_minutes=tz_minutes)
            to_ms = _parse_day(to_value, end=True, tz_minutes=tz_minutes)
            from_utc, to_utc = _day_utc_bounds(from_value, to_value, tz_minutes=tz_minutes)
        except ValueError:
            self.send_json({"ok": False, "error": "日期格式必须是 YYYY-MM-DD"}, status=400)
            return
        connection = self._partner_connection()
        if connection is None:
            self.send_json({"ok": True, "ready": False, "open": 0,
                            "settled": 0, "states": []})
            return
        try:
            payload = partner_orders.query_summary(
                connection, agent, from_ms, to_ms,
                basis=basis, from_utc=from_utc, to_utc=to_utc,
            )
        except sqlite3.Error as exc:
            self.send_json({"ok": False, "error": f"订单汇总读取失败：{exc}"}, status=500)
            return
        finally:
            connection.close()
        payload.update({"ok": True, "ready": True, "basis": basis, "tz": tz_minutes})
        self.send_json(payload)

    def _telegram_status(self) -> None:
        runner = getattr(self, "telegram_runner", None)
        if runner is None:
            self.send_json({"ok": False, "error": "TG 推送服务未启动"}, status=503)
            return
        payload = runner.state()
        payload.update({"ok": True})
        self.send_json(payload)

    def _telegram_chats(self) -> None:
        try:
            config = load_config()
        except Exception as exc:  # noqa: BLE001 - settings read must not crash
            self.send_json({"ok": False, "error": f"读取配置失败：{exc}"}, status=500)
            return
        token = str(config.get("telegram_bot_token") or "").strip()
        if not token:
            self.send_json({"ok": False, "error": "请先保存机器人 Token"}, status=400)
            return
        try:
            result = list_chats({
                "token": token,
                "proxy": str(config.get("telegram_proxy") or ""),
            })
        except RuntimeError as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=502)
            return
        self.send_json({"ok": True, **result})

    def _telegram_test(self) -> None:
        runner = getattr(self, "telegram_runner", None)
        if runner is None:
            self.send_json({"ok": False, "error": "TG 推送服务未启动"}, status=503)
            return
        try:
            runner.test()
        except (ValueError, RuntimeError) as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=400)
            return
        payload = runner.state()
        payload.update({"ok": True, "message": "测试消息已发送，请查看群聊"})
        self.send_json(payload)

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if is_crown_path(parsed.path):
            proxy_crown(self, "GET")
            return
        query = parse_qs(parsed.query, keep_blank_values=True)
        if parsed.path == "/api/settings":
            try:
                self.send_json(self._settings_response())
            except Exception as exc:
                self.send_json({"ok": False, "error": f"无法读取系统设置：{exc}"}, status=500)
            return
        if parsed.path == "/api/my-events":
            self._my_events(query)
            return
        if parsed.path == "/api/my-events/events":
            self._my_events_events(query)
            return
        if parsed.path == "/api/my-events/summary":
            self._my_events_summary(query)
            return
        if parsed.path == "/api/telegram/status":
            self._telegram_status()
            return
        if parsed.path == "/api/telegram/chats":
            self._telegram_chats()
            return
        if parsed.path == "/api/merge":
            self.send_json(self._merge_payload())
            return
        if parsed.path == "/api/merge/confirmed":
            payload = self._merge_confirmed_payload(query)
            self.send_json(payload, status=400 if not payload.get("ok") else 200)
            return
        if parsed.path == "/api/merge/opportunities":
            self.send_json(self._merge_opportunities_payload(query))
            return
        if parsed.path == "/api/metadata/status":
            self.send_json(self.metadata_runner.status())
            return
        if parsed.path == "/api/snapshot":
            selected = (query.get("event_id") or [""])[0]
            self.send_json(self.store.snapshot(selected))
            return
        if parsed.path == "/api/history":
            event_id = (query.get("event_id") or [""])[0].strip()
            if not event_id:
                self.send_json(
                    {"ok": False, "error": "event_id 参数不能为空"}, status=400
                )
                return
            try:
                hours = float((query.get("hours") or ["24"])[0])
                limit = int((query.get("limit") or [str(HISTORY_QUERY_LIMIT)])[0])
            except ValueError:
                self.send_json(
                    {"ok": False, "error": "hours 或 limit 参数格式不正确"},
                    status=400,
                )
                return
            if hours <= 0 or limit <= 0:
                self.send_json(
                    {"ok": False, "error": "hours 和 limit 必须大于 0"},
                    status=400,
                )
                return
            hours = min(hours, HISTORY_QUERY_HOURS_MAX)
            limit = min(limit, HISTORY_QUERY_LIMIT_MAX)
            filters = {
                name: (query.get(name) or [""])[0]
                for name in ("stage", "market", "option", "line")
                if name in query
            }
            self.send_json(
                self.store.query_history(event_id, hours, limit, filters)
            )
            return
        if parsed.path == "/api/health":
            self.send_json(
                {
                    "ok": True,
                    "serverTime": now_iso(),
                    "historyPoints": self.store.history_writer.written_points,
                    "databaseErrors": self.store.history_writer.errors,
                }
            )
            return
        self.serve_static(parsed.path)

    def do_PUT(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == "/api/settings":
            self._update_settings()
            return
        self.send_json({"ok": False, "error": "接口不存在"}, status=404)

    def do_POST(self) -> None:
        parsed = urlsplit(self.path)
        if is_crown_path(parsed.path):
            proxy_crown(self, "POST")
            return
        if parsed.path == "/api/telegram/test":
            self._telegram_test()
            return
        if parsed.path == "/api/merge/mapping":
            self._handle_merge_mapping()
            return
        if parsed.path == "/api/merge/league-mapping":
            self._handle_merge_league_mapping()
            return
        if parsed.path in {"/api/merge/auto-map", "/api/merge/league-auto-map"}:
            self._handle_merge_league_auto_mapping()
            return
        if parsed.path == "/api/settings/backup":
            self._backup_database()
            return
        if parsed.path == "/api/settings/integrity":
            self._check_database_integrity()
            return
        if parsed.path == "/api/event-presence":
            try:
                payload = self.read_json_body()
            except ValueError as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=400)
                return
            event_ids = payload.get("eventIds")
            if not isinstance(event_ids, list) or any(
                not isinstance(event_id, (str, int)) for event_id in event_ids
            ):
                self.send_json(
                    {"ok": False, "error": "eventIds 必须是赛事 ID 数组"},
                    status=400,
                )
                return
            row_keys_by_event = payload.get("rowKeysByEvent") or {}
            if not isinstance(row_keys_by_event, dict):
                self.send_json(
                    {"ok": False, "error": "rowKeysByEvent 必须是对象"},
                    status=400,
                )
                return
            if any(
                not isinstance(event_id, str)
                or not isinstance(keys, list)
                or any(not isinstance(key, str) for key in keys)
                for event_id, keys in row_keys_by_event.items()
            ):
                self.send_json(
                    {
                        "ok": False,
                        "error": "rowKeysByEvent 必须是赛事 ID 到字符串数组的映射",
                    },
                    status=400,
                )
                return
            event_details_by_id = payload.get("eventDetailsById") or {}
            if not isinstance(event_details_by_id, dict) or any(
                not isinstance(event_id, str)
                or not isinstance(details, dict)
                for event_id, details in event_details_by_id.items()
            ):
                self.send_json(
                    {
                        "ok": False,
                        "error": "eventDetailsById 必须是赛事 ID 到对象的映射",
                    },
                    status=400,
                )
                return
            observed_at = as_text(payload.get("observedAt"))
            self.send_json(
                self.store.reconcile_event_presence(
                    event_ids,
                    observed_at,
                    row_keys_by_event,
                    event_details_by_id,
                )
            )
            return
        if parsed.path != "/api/metadata/sync":
            self.send_json({"ok": False, "error": "接口不存在"}, status=404)
            return
        try:
            payload = self.read_json_body()
        except ValueError as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=400)
            return
        apply = payload.get("apply", False)
        if not isinstance(apply, bool):
            self.send_json(
                {"ok": False, "error": "apply 必须是布尔值"}, status=400
            )
            return
        try:
            result = self.metadata_runner.start(apply=apply)
        except Exception as exc:
            self.send_json(
                {"ok": False, "error": f"无法启动元数据任务：{exc}"}, status=500
            )
            return
        self.send_json(result, status=202 if result.get("started") else 409)

    def do_DELETE(self) -> None:
        parsed = urlsplit(self.path)
        if is_crown_path(parsed.path):
            proxy_crown(self, "DELETE")
            return
        self.send_json({"ok": False, "error": "接口不存在"}, status=404)

    def read_json_body(self) -> Dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Content-Length 格式不正确") from exc
        if length <= 0 or length > MAX_JSON_BODY_BYTES:
            raise ValueError("请求体为空或过大")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("请求体不是有效的 JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("请求体必须是 JSON 对象")
        return payload

    def send_json(self, payload: Dict[str, Any], status: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def serve_static(self, path: str) -> None:
        decoded = unquote(path)
        if decoded == "/favicon.ico":
            self.send_response(204)
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            return
        if decoded.startswith("/static/"):
            relative = decoded[len("/static/"):]
        else:
            relative = decoded.lstrip("/") or "index.html"
        candidate = (STATIC_DIR / relative).resolve()
        try:
            candidate.relative_to(STATIC_DIR.resolve())
        except ValueError:
            self.send_error(404)
            return
        if not candidate.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        if candidate.suffix == ".js":
            content_type = "text/javascript; charset=utf-8"
        elif candidate.suffix in {".html", ".css"}:
            content_type = f"{content_type}; charset=utf-8"
        data = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        # Local UI assets must never survive a code change in the browser cache.
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.end_headers()
        self.wfile.write(data)


_OPPORTUNITY_CACHE_LOCK = threading.Lock()


class DashboardServer(ThreadingHTTPServer):
    """Own one dashboard's dependencies and close them in producer-first order."""

    def __init__(self, address, handler):
        self._services_closed = False
        super().__init__(address, handler)

    def server_close(self) -> None:
        super().server_close()
        if self._services_closed:
            return
        self._services_closed = True
        tailer = getattr(self, "capture_tailer", None)
        if tailer is not None:
            tailer.stop()
            if tailer.ident is not None:
                tailer.join()
        runner = getattr(self, "metadata_runner", None)
        if runner is not None:
            runner.close()
        telegram = getattr(self, "telegram_runner", None)
        if telegram is not None:
            telegram.stop()
        store = getattr(self, "odds_store", None)
        if store is not None:
            store.close()
        merge_store = getattr(self, "merge_store", None)
        if merge_store is not None:
            merge_store.close()


def build_server(host: str, port: int, config: Dict[str, Any]) -> ThreadingHTTPServer:
    # Reserve the port before starting writers or capture tailers.
    server = DashboardServer((host, port), DashboardHandler)
    server.dashboard_config = dict(config)
    server.config_lock = threading.RLock()
    server.partner_orders_path = get_path(config, "partner_orders_db_path")
    try:
        store = OddsStore(config)
        server.odds_store = store
        print("[dashboard] 读取最新 CSV 快照...", flush=True)
        store.load_seed()
        print(f"[dashboard] 已载入 {store.seeded_rows} 条快照，正在预载近期消息...", flush=True)
        store.bootstrap_recent()
        repaired = store.reload_metadata_from_db()
        if repaired:
            print(f"[dashboard] 已从 SQLite 合并 {repaired} 场赛事元数据", flush=True)
        server.metadata_runner = MetadataSyncRunner(
            store,
            status_path=get_path(config, "run_dir") / "metadata_sync.status.json",
            log_path=get_path(config, "log_dir") / "metadata_sync.log",
        )
        server.merge_store = FixtureMergeStore(get_path(config, "merge_db_path"))
        server.telegram_runner = TelegramPusher(
            Path(get_path(config, "partner_orders_db_path")).parent / "telegram_push.sqlite3"
        )
        server.telegram_runner.start()
        server.capture_tailer = CaptureTailer(store)
        server.capture_tailer.start()
    except BaseException:
        server.server_close()
        raise
    print(
        f"[dashboard] 已启动 http://{host}:{server.server_port} | "
        f"近期消息={store.recent_rows} | 赛事={len(store.events)} | "
        f"历史点={store.history_writer.written_points}",
        flush=True,
    )
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="PS3838 real-time odds dashboard")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--open", action="store_true", help="启动后打开浏览器")
    args = parser.parse_args()

    config = load_config()
    host = args.host or config["dashboard_host"]
    port = args.port if args.port is not None else config["dashboard_port"]
    server = build_server(host, port, config)

    def handle_sigterm(signum: int, frame: Any) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, handle_sigterm)
    url = f"http://{host}:{server.server_port}"
    if args.open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[dashboard] 已停止", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
