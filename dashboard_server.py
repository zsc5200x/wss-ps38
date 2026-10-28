"""Local real-time dashboard for the PS3838 collector.

The server seeds its in-memory view from the latest CSV snapshot and then tails
capture.jsonl incrementally. It intentionally does not trigger a full replay on
startup, avoiding the current O(n*m) cost in live_snapshot.py.
"""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import os
import queue
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import webbrowser
from collections import Counter, deque
from contextlib import closing
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlsplit

from crown_proxy import is_crown_path, proxy_crown
from odds_utils import normalize_odds
from project_config import get_path, load_config


PROJECT_DIR = Path(__file__).resolve().parent
STATIC_DIR = PROJECT_DIR / "dashboard" / "static"
RECENT_BOOTSTRAP_BYTES = 8 * 1024 * 1024
MAX_JSON_BODY_BYTES = 4 * 1024 * 1024
HISTORY_LIMIT = 36
CHANGE_LIMIT = 180
HISTORY_QUERY_LIMIT = 5000
HISTORY_QUERY_LIMIT_MAX = 10000
HISTORY_QUERY_HOURS_MAX = 24 * 365
METADATA_STATUS_PATH = PROJECT_DIR / ".run" / "metadata_sync.status.json"
METADATA_LOG_PATH = PROJECT_DIR / "logs" / "metadata_sync.log"
FULL_TIME_STAGE = "0"
SUPPORTED_MARKETS = frozenset({"1", "2", "3"})
LIVE_EVENT_STALE_SECONDS = 90
LIVE_EVENT_LATE_MINUTE = 80
LIVE_EVENT_MAX_WALL_MINUTES = 120
FINISHED_MATCH_STATUSES = frozenset({"F", "FT", "FINISHED", "SETTLED"})
MARKET_ROW_MISSES = 4
MARKET_ROW_STALE_MISSES = 2
MARKET_ROW_STALE_AFTER_SECONDS = 20 * 60


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def as_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def is_full_time_market(stage: Any, market: Any) -> bool:
    """Return whether a row belongs to a supported full-time market."""
    return as_text(stage) == FULL_TIME_STAGE and as_text(market) in SUPPORTED_MARKETS


def metadata_status(name: str, league: str, kickoff: str) -> str:
    has_name = bool(name and not name.startswith("赛事 "))
    if has_name and league and kickoff:
        return "complete"
    if has_name or league or kickoff:
        return "partial"
    return "missing"


def parse_kickoff(value: str, now: Optional[datetime] = None) -> Optional[datetime]:
    """Parse PS3838 kickoff values into the dashboard's local timezone."""
    text = as_text(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    local_now = now or datetime.now().astimezone()
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=local_now.tzinfo)
    return parsed.astimezone(local_now.tzinfo)


def match_elapsed_minute(event: Dict[str, Any]) -> Optional[int]:
    """Return an approximate elapsed match minute for live-event staleness."""
    period = as_text(event.get("matchPeriod")).upper()
    if period.startswith("END"):
        return 999
    digits = "".join(
        character
        for character in as_text(event.get("matchMinute"))
        if character.isdigit()
    )
    if not digits:
        return None
    minute = int(digits)
    if period.startswith("2H"):
        minute += 45
    elif period.startswith("ET") or period.startswith("HT ET"):
        minute += 90
    return minute


def event_is_finished(event: Dict[str, Any]) -> bool:
    period = as_text(event.get("matchPeriod")).upper()
    status = as_text(event.get("matchStatus")).upper()
    return period.startswith("END") or status in FINISHED_MATCH_STATUSES


def live_event_is_stale(
    event: Dict[str, Any], now: Optional[datetime] = None
) -> bool:
    """Detect ended events that vanished without a final match-state message."""
    if not bool(event.get("isLive")) or event_is_finished(event):
        return False
    local_now = now or datetime.now().astimezone()
    last_captured = parse_kickoff(as_text(event.get("lastCapturedAt")), local_now)
    if last_captured is None:
        return False
    idle_seconds = (local_now - last_captured).total_seconds()
    if idle_seconds < LIVE_EVENT_STALE_SECONDS:
        return False
    elapsed_minute = match_elapsed_minute(event)
    if elapsed_minute is not None and elapsed_minute >= LIVE_EVENT_LATE_MINUTE:
        return True
    kickoff = parse_kickoff(as_text(event.get("kickoff")), local_now)
    return bool(
        kickoff
        and (local_now - kickoff).total_seconds()
        >= LIVE_EVENT_MAX_WALL_MINUTES * 60
    )


def event_scope(event: Dict[str, Any], now: Optional[datetime] = None) -> str:
    """Return the dashboard display scope for an event.

    Only live events and events that have not started today are shown. The
    categories are mutually exclusive so metric totals do not count an event
    twice.
    """
    local_now = now or datetime.now().astimezone()
    if event_is_finished(event) or live_event_is_stale(event, local_now):
        return ""
    if bool(event.get("isLive")):
        return "live"
    kickoff = parse_kickoff(as_text(event.get("kickoff")), local_now)
    if kickoff and kickoff.date() == local_now.date() and kickoff >= local_now:
        return "today"
    return ""


def event_is_visible_today_upcoming(
    event: Dict[str, Any], now: Optional[datetime] = None
) -> bool:
    """Return whether an event is currently shown as a today-upcoming event."""
    return event_scope(event, now) == "today"


def event_has_display_metadata(event: Dict[str, Any]) -> bool:
    """Return whether an event has enough identity to render without placeholders."""
    name = as_text(event.get("name"))
    league = as_text(event.get("league"))
    kickoff = parse_kickoff(as_text(event.get("kickoff")))
    return bool(
        name
        and not name.startswith("赛事 ")
        and league
        and league != "联赛未知"
        and kickoff
    )


def iter_messages(node: Any) -> Iterable[Dict[str, Any]]:
    if isinstance(node, dict):
        if node.get("type") == "UPDATE_ODDS":
            yield node
            return
        for value in node.values():
            yield from iter_messages(value)
    elif isinstance(node, list):
        for value in node:
            yield from iter_messages(value)


def iter_leaf_rows(node: Any) -> Iterable[list]:
    if isinstance(node, list):
        if len(node) >= 13 and all(
            not isinstance(value, (dict, list)) for value in node
        ):
            yield node
            return
        for value in node:
            yield from iter_leaf_rows(value)


def iter_event_records(container: Any) -> Iterable[Dict[str, str]]:
    """Yield full event metadata from PS3838 ``l`` / ``n`` containers."""
    if not isinstance(container, list):
        return
    for sport in container:
        if not isinstance(sport, list) or len(sport) < 3:
            continue
        sport_id = as_text(sport[0])
        leagues = sport[2]
        if not isinstance(leagues, list):
            continue
        for league in leagues:
            if not isinstance(league, list) or len(league) < 3:
                continue
            league_id = as_text(league[0])
            league_name = as_text(league[1])
            events = league[2]
            if not isinstance(events, list):
                continue
            for event in events:
                if not isinstance(event, list) or len(event) < 5:
                    continue
                event_id = as_text(event[0])
                if not event_id:
                    continue
                home = as_text(event[1])
                away = as_text(event[2])
                kickoff = ""
                try:
                    stamp = float(event[4])
                    if stamp > 100_000_000_000:
                        stamp /= 1000
                    if stamp > 0:
                        kickoff = datetime.fromtimestamp(
                            stamp
                        ).astimezone().strftime("%Y-%m-%d %H:%M:%S")
                except (ValueError, TypeError, OSError, OverflowError):
                    pass

                score_home = ""
                score_away = ""
                if len(event) > 9 and isinstance(event[9], list) and len(event[9]) >= 2:
                    score_home = as_text(event[9][0])
                    score_away = as_text(event[9][1])

                yield {
                    "eventId": event_id,
                    "home": home,
                    "away": away,
                    "sportId": sport_id,
                    "leagueId": league_id,
                    "league": league_name,
                    "kickoff": kickoff,
                    "scoreHome": score_home,
                    "scoreAway": score_away,
                    "matchMinute": as_text(event[15]) if len(event) > 15 else "",
                    "matchPeriod": as_text(event[16]) if len(event) > 16 else "",
                    "matchStatus": as_text(event[17]) if len(event) > 17 else "",
                }


def iter_events(container: Any) -> Iterable[Tuple[str, str, str, str, str]]:
    for record in iter_event_records(container):
        yield (
            record["eventId"],
            record["home"],
            record["away"],
            record["league"],
            record["kickoff"],
        )


def float_or_none(value: str) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number


class HistoryDatabase:
    """SQLite storage for event metadata and price-change points."""

    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=5000")
        return connection

    def initialize(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=NORMAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL DEFAULT '',
                    league TEXT NOT NULL DEFAULT '',
                    sport_id TEXT NOT NULL DEFAULT '',
                    league_id TEXT NOT NULL DEFAULT '',
                    kickoff TEXT NOT NULL DEFAULT '',
                    metadata_status TEXT NOT NULL DEFAULT 'missing',
                    is_live INTEGER NOT NULL DEFAULT 0,
                    score_home TEXT NOT NULL DEFAULT '',
                    score_away TEXT NOT NULL DEFAULT '',
                    match_minute TEXT NOT NULL DEFAULT '',
                    match_period TEXT NOT NULL DEFAULT '',
                    match_status TEXT NOT NULL DEFAULT '',
                    last_captured_at TEXT NOT NULL DEFAULT '',
                    last_changed_at TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS odds_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    market TEXT NOT NULL,
                    option TEXT NOT NULL,
                    line TEXT NOT NULL,
                    captured_at TEXT NOT NULL,
                    decimal REAL NOT NULL,
                    hong_kong REAL,
                    quoted INTEGER NOT NULL DEFAULT 1,
                    direction TEXT NOT NULL DEFAULT 'flat',
                    delta REAL,
                    source TEXT NOT NULL DEFAULT 'tail',
                    created_at TEXT NOT NULL,
                    UNIQUE (
                        event_id, stage, market, option, line,
                        captured_at, decimal
                    )
                );

                CREATE INDEX IF NOT EXISTS idx_history_event_time
                    ON odds_history(event_id, captured_at DESC);
                CREATE INDEX IF NOT EXISTS idx_history_row_time
                    ON odds_history(
                        event_id, stage, market, option, line,
                        captured_at DESC
                    );
                CREATE INDEX IF NOT EXISTS idx_history_time
                    ON odds_history(captured_at DESC);
                """
            )
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(events)").fetchall()
            }
            additions = {
                "sport_id": "TEXT NOT NULL DEFAULT ''",
                "league_id": "TEXT NOT NULL DEFAULT ''",
                "is_live": "INTEGER NOT NULL DEFAULT 0",
                "score_home": "TEXT NOT NULL DEFAULT ''",
                "score_away": "TEXT NOT NULL DEFAULT ''",
                "match_minute": "TEXT NOT NULL DEFAULT ''",
                "match_period": "TEXT NOT NULL DEFAULT ''",
                "match_status": "TEXT NOT NULL DEFAULT ''",
            }
            for column, declaration in additions.items():
                if column not in columns:
                    connection.execute(
                        f"ALTER TABLE events ADD COLUMN {column} {declaration}"
                    )
            connection.commit()

    def write_batch(
        self,
        events: list[Dict[str, Any]],
        points: list[Dict[str, Any]],
    ) -> int:
        if not events and not points:
            return 0
        with closing(self._connect()) as connection:
            connection.execute("PRAGMA synchronous=NORMAL")
            if events:
                connection.executemany(
                    """
                    INSERT INTO events (
                        event_id, name, league, sport_id, league_id, kickoff,
                        metadata_status, is_live, score_home, score_away,
                        match_minute, match_period, match_status,
                        last_captured_at, last_changed_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(event_id) DO UPDATE SET
                        name = CASE
                            WHEN excluded.name <> ''
                                 AND excluded.name <> ('赛事 ' || excluded.event_id)
                            THEN excluded.name
                            ELSE events.name
                        END,
                        league = CASE
                            WHEN excluded.league <> '' THEN excluded.league
                            ELSE events.league
                        END,
                        sport_id = CASE
                            WHEN excluded.sport_id <> '' THEN excluded.sport_id
                            ELSE events.sport_id
                        END,
                        league_id = CASE
                            WHEN excluded.league_id <> '' THEN excluded.league_id
                            ELSE events.league_id
                        END,
                        kickoff = CASE
                            WHEN excluded.kickoff <> '' THEN excluded.kickoff
                            ELSE events.kickoff
                        END,
                        metadata_status = CASE
                            WHEN excluded.metadata_status = 'complete' THEN 'complete'
                            WHEN events.metadata_status = 'complete' THEN 'complete'
                            WHEN excluded.metadata_status = 'partial' THEN 'partial'
                            WHEN events.metadata_status = 'partial' THEN 'partial'
                            ELSE 'missing'
                        END,
                        is_live = excluded.is_live,
                        score_home = CASE
                            WHEN excluded.score_home <> '' THEN excluded.score_home
                            ELSE events.score_home
                        END,
                        score_away = CASE
                            WHEN excluded.score_away <> '' THEN excluded.score_away
                            ELSE events.score_away
                        END,
                        match_minute = CASE
                            WHEN excluded.match_minute <> '' THEN excluded.match_minute
                            ELSE events.match_minute
                        END,
                        match_period = CASE
                            WHEN excluded.match_period <> '' THEN excluded.match_period
                            ELSE events.match_period
                        END,
                        match_status = CASE
                            WHEN excluded.match_status <> '' THEN excluded.match_status
                            ELSE events.match_status
                        END,
                        last_captured_at = CASE
                            WHEN excluded.last_captured_at >= events.last_captured_at
                            THEN excluded.last_captured_at
                            ELSE events.last_captured_at
                        END,
                        last_changed_at = CASE
                            WHEN excluded.last_changed_at >= events.last_changed_at
                            THEN excluded.last_changed_at
                            ELSE events.last_changed_at
                        END,
                        updated_at = excluded.updated_at
                    WHERE excluded.updated_at >= events.updated_at
                    """,
                    [
                        (
                            item["eventId"],
                            item.get("name", ""),
                            item.get("league", ""),
                            item.get("sportId", ""),
                            item.get("leagueId", ""),
                            item.get("kickoff", ""),
                            item.get("metadataStatus", "missing"),
                            1 if item.get("isLive") else 0,
                            item.get("scoreHome", ""),
                            item.get("scoreAway", ""),
                            item.get("matchMinute", ""),
                            item.get("matchPeriod", ""),
                            item.get("matchStatus", ""),
                            item.get("lastCapturedAt", ""),
                            item.get("lastChangedAt", ""),
                            item.get("updatedAt", now_iso()),
                        )
                        for item in events
                    ],
                )
            before_points = connection.total_changes
            if points:
                created_at = now_iso()
                connection.executemany(
                    """
                    INSERT OR IGNORE INTO odds_history (
                        event_id, stage, market, option, line,
                        captured_at, decimal, hong_kong, quoted,
                        direction, delta, source, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            item["eventId"],
                            item.get("stage", ""),
                            item.get("market", ""),
                            item.get("option", ""),
                            item.get("line", ""),
                            item["capturedAt"],
                            item["decimal"],
                            item.get("hongKong"),
                            1 if item.get("quoted") else 0,
                            item.get("direction", "flat"),
                            item.get("delta"),
                            item.get("source", "tail"),
                            created_at,
                        )
                        for item in points
                    ],
                )
            inserted_points = connection.total_changes - before_points
            connection.commit()
            return inserted_points

    def point_count(self) -> int:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM odds_history"
            ).fetchone()
        return int(row["count"]) if row else 0

    def get_event(self, event_id: str) -> Optional[Dict[str, Any]]:
        with closing(self._connect()) as connection:
            row = connection.execute(
                """
                SELECT event_id, name, league, sport_id, league_id, kickoff,
                       metadata_status, is_live, score_home, score_away,
                       match_minute, match_period, match_status,
                       last_captured_at, last_changed_at
                FROM events WHERE event_id = ?
                """,
                (event_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "id": row["event_id"],
            "name": row["name"],
            "league": row["league"],
            "sportId": row["sport_id"],
            "leagueId": row["league_id"],
            "kickoff": row["kickoff"],
            "metadataStatus": row["metadata_status"],
            "isLive": bool(row["is_live"]),
            "scoreHome": row["score_home"],
            "scoreAway": row["score_away"],
            "matchMinute": row["match_minute"],
            "matchPeriod": row["match_period"],
            "matchStatus": row["match_status"],
            "lastCapturedAt": row["last_captured_at"],
            "lastChangedAt": row["last_changed_at"],
        }

    def list_events(self) -> list[Dict[str, Any]]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """
                SELECT event_id, name, league, sport_id, league_id, kickoff,
                       metadata_status, is_live, score_home, score_away,
                       match_minute, match_period, match_status,
                       last_captured_at, last_changed_at
                FROM events
                ORDER BY event_id
                """
            ).fetchall()
        return [
            {
                "id": row["event_id"],
                "name": row["name"],
                "league": row["league"],
                "sportId": row["sport_id"],
                "leagueId": row["league_id"],
                "kickoff": row["kickoff"],
                "metadataStatus": row["metadata_status"],
                "isLive": bool(row["is_live"]),
                "scoreHome": row["score_home"],
                "scoreAway": row["score_away"],
                "matchMinute": row["match_minute"],
                "matchPeriod": row["match_period"],
                "matchStatus": row["match_status"],
                "lastCapturedAt": row["last_captured_at"],
                "lastChangedAt": row["last_changed_at"],
            }
            for row in rows
        ]

    def query_points(
        self,
        event_id: str,
        since: str,
        until: str,
        limit: int,
        filters: Dict[str, str],
    ) -> Tuple[list[Dict[str, Any]], bool]:
        clauses = [
            "event_id = ?",
            "captured_at >= ?",
            "captured_at <= ?",
        ]
        params: list[Any] = [event_id, since, until]
        for column in ("stage", "market", "option", "line"):
            value = filters.get(column)
            if value is not None:
                clauses.append(f"{column} = ?")
                params.append(value)
        query = f"""
            SELECT event_id, stage, market, option, line, captured_at,
                   decimal, hong_kong, quoted, direction, delta, source
            FROM odds_history
            WHERE {' AND '.join(clauses)}
            ORDER BY captured_at DESC, id DESC
            LIMIT ?
        """
        params.append(limit + 1)
        with closing(self._connect()) as connection:
            rows = connection.execute(query, params).fetchall()
        truncated = len(rows) > limit
        rows = rows[:limit]
        points = [
            {
                "eventId": row["event_id"],
                "stage": row["stage"],
                "market": row["market"],
                "option": row["option"],
                "line": row["line"],
                "capturedAt": row["captured_at"],
                "decimal": row["decimal"],
                "hongKong": row["hong_kong"],
                "quoted": bool(row["quoted"]),
                "direction": row["direction"],
                "delta": row["delta"],
                "source": row["source"],
            }
            for row in reversed(rows)
        ]
        return points, truncated

    def disk_bytes(self) -> int:
        total = 0
        for suffix in ("", "-wal", "-shm"):
            candidate = Path(str(self.path) + suffix)
            try:
                total += candidate.stat().st_size
            except OSError:
                pass
        return total


class HistoryWriter(threading.Thread):
    """Batch SQLite writes on a background thread."""

    def __init__(self, database: HistoryDatabase):
        super().__init__(name="history-writer", daemon=True)
        self.database = database
        self.tasks: queue.Queue = queue.Queue(maxsize=50_000)
        self.stop_event = threading.Event()
        self.written_points = database.point_count()
        self.written_events = 0
        self.dropped = 0
        self.errors = 0

    def enqueue_event(self, event: Dict[str, Any]) -> None:
        self._put(("event", event))

    def enqueue_point(self, point: Dict[str, Any]) -> None:
        self._put(("point", point))

    def _put(self, item: Tuple[str, Dict[str, Any]]) -> None:
        if self.stop_event.is_set():
            return
        try:
            self.tasks.put(item, timeout=0.5)
        except queue.Full:
            self.dropped += 1

    def stop(self) -> None:
        if self.stop_event.is_set():
            return
        self.stop_event.set()
        try:
            self.tasks.put(None, timeout=1)
        except queue.Full:
            pass
        self.join(timeout=8)

    def flush(self) -> None:
        """Wait until all queued database writes have completed."""
        self.tasks.join()

    def _flush_batch(self, batch: list[Tuple[str, Dict[str, Any]]]) -> None:
        events = [item[1] for item in batch if item[0] == "event"]
        points = [item[1] for item in batch if item[0] == "point"]
        try:
            inserted_points = self.database.write_batch(events, points)
            self.written_points += max(0, inserted_points)
            self.written_events += len(events)
        except Exception as exc:
            self.errors += 1
            print(f"[历史数据库写入失败] {exc}", flush=True)

    def run(self) -> None:
        batch: list[Tuple[str, Dict[str, Any]]] = []
        deadline = time.monotonic() + 0.6
        while True:
            timeout = max(0.0, deadline - time.monotonic())
            try:
                item = self.tasks.get(timeout=timeout or 0.01)
            except queue.Empty:
                if batch:
                    self._flush_batch(batch)
                    for _ in batch:
                        self.tasks.task_done()
                    batch = []
                if self.stop_event.is_set() and self.tasks.empty():
                    break
                deadline = time.monotonic() + 0.6
                continue

            if item is None:
                self.tasks.task_done()
                if batch:
                    self._flush_batch(batch)
                    for _ in batch:
                        self.tasks.task_done()
                    batch = []
                break

            batch.append(item)
            if len(batch) >= 500 or time.monotonic() >= deadline:
                self._flush_batch(batch)
                for _ in batch:
                    self.tasks.task_done()
                batch = []
                deadline = time.monotonic() + 0.6

        while True:
            try:
                item = self.tasks.get_nowait()
            except queue.Empty:
                break
            if item is not None:
                batch.append(item)
            self.tasks.task_done()
        if batch:
            self._flush_batch(batch)


class OddsStore:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.capture_path = get_path(config, "capture_path")
        self.seed_path = get_path(config, "live_snapshot_file")
        self.database_path = get_path(config, "dashboard_db_path")
        self.history_db = HistoryDatabase(self.database_path)
        self.history_writer = HistoryWriter(self.history_db)
        self.history_writer.start()
        self.lock = threading.RLock()
        self.events: Dict[str, Dict[str, Any]] = {}
        self.odds_by_event: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self.history: Dict[str, Dict[str, list]] = {}
        self.changes: deque = deque(maxlen=CHANGE_LIMIT)
        self.revision = 0
        self.change_serial = 0
        self.last_captured_at = ""
        self.last_change_at = ""
        self.seeded_rows = 0
        self.recent_rows = 0
        self.message_count = 0
        self.parse_errors = 0
        self.presence_misses: Dict[str, int] = {}
        self.row_presence_misses: Dict[tuple[str, str], int] = {}
        self.started_at = now_iso()

    def close(self) -> None:
        self.history_writer.stop()

    def flush_history(self) -> None:
        self.history_writer.flush()

    def _persist_event(self, event_id: str) -> None:
        event = self.events.get(event_id)
        if event is None:
            return
        self.history_writer.enqueue_event(
            {
                **event,
                "eventId": event_id,
                "updatedAt": now_iso(),
            }
        )

    def _resolve_market_event_id(
        self,
        source_event_id: str,
        details: Any,
        local_now: datetime,
    ) -> str:
        """Match compact-feed IDs to WebSocket event IDs when they differ."""
        if source_event_id in self.events:
            return source_event_id
        if not isinstance(details, dict):
            return ""

        name = as_text(details.get("name"))
        if not name:
            return ""
        candidates = [
            (event_id, event)
            for event_id, event in self.events.items()
            if as_text(event.get("name")) == name
        ]
        if not candidates:
            return ""

        try:
            kickoff_ms = float(details.get("kickoff"))
        except (TypeError, ValueError):
            kickoff_ms = 0.0
        if kickoff_ms > 0:
            timed_candidates = []
            for event_id, event in candidates:
                kickoff = parse_kickoff(as_text(event.get("kickoff")))
                if not kickoff:
                    continue
                target = datetime.fromtimestamp(
                    kickoff_ms / 1000, tz=kickoff.tzinfo
                )
                if abs((kickoff - target).total_seconds()) <= 600:
                    timed_candidates.append(event_id)
            if timed_candidates:
                live_candidates = [
                    event_id
                    for event_id in timed_candidates
                    if bool(self.events[event_id].get("isLive"))
                ]
                if len(live_candidates) == 1:
                    return live_candidates[0]
                # PS3838 can reuse the same teams and kickoff for an old feed
                # event and a current live event. Prefer the instance that is
                # still receiving updates instead of abandoning the match.
                return max(
                    timed_candidates,
                    key=lambda event_id: as_text(
                        self.events[event_id].get("lastCapturedAt")
                    ),
                )

        return candidates[0][0] if len(candidates) == 1 else ""

    def _apply_event_details(
        self,
        event_id: str,
        details: Any,
        local_now: datetime,
    ) -> bool:
        """Merge metadata from the compact snapshot or rendered event row."""
        if not isinstance(details, dict):
            return False
        name = as_text(details.get("name"))
        home = as_text(details.get("home"))
        away = as_text(details.get("away"))
        if (not home or not away) and " VS " in name:
            parts = name.split(" VS ", 1)
            home = home or parts[0].strip()
            away = away or parts[1].strip()

        kickoff_value = details.get("kickoff")
        kickoff = ""
        kickoff_ms = 0.0
        try:
            kickoff_ms = float(kickoff_value)
        except (TypeError, ValueError):
            kickoff = as_text(kickoff_value)
        if kickoff_ms > 100_000_000_000:
            kickoff = datetime.fromtimestamp(
                kickoff_ms / 1000, tz=local_now.tzinfo
            ).strftime("%Y-%m-%d %H:%M:%S")
        elif kickoff_ms > 0:
            kickoff = datetime.fromtimestamp(
                kickoff_ms, tz=local_now.tzinfo
            ).strftime("%Y-%m-%d %H:%M:%S")

        return self.register_event(
            event_id,
            home,
            away,
            as_text(details.get("league")),
            kickoff,
            as_text(details.get("scoreHome")),
            as_text(details.get("scoreAway")),
            as_text(details.get("matchMinute")),
            as_text(details.get("matchPeriod")),
            as_text(details.get("matchStatus")),
            as_text(details.get("sportId")),
            as_text(details.get("leagueId")),
        )

    def reconcile_event_presence(
        self,
        event_ids: Iterable[Any],
        observed_at: str = "",
        row_keys_by_event: Optional[Dict[str, Iterable[Any]]] = None,
        event_details_by_id: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Remove stale events and market rows after two absent presences.

        PS3838 exposes only the currently rendered event list. The dashboard
        otherwise retains every event it has seen, so finished or removed
        upcoming events can remain visible indefinitely. Live events are
        intentionally excluded here because their own staleness/finish guards
        are authoritative and event IDs can change across feed variants.

        The compact event snapshot also contains the currently offered
        full-time market rows. They are reconciled separately because odds
        updates are incremental and never announce withdrawn lines.
        """
        visible_ids = {
            as_text(event_id) for event_id in event_ids if as_text(event_id)
        }
        local_now = parse_kickoff(observed_at) or datetime.now().astimezone()
        removed: list[str] = []
        removed_rows: list[Dict[str, str]] = []
        unresolved_market_ids: list[str] = []
        resolved_keys: Dict[str, set[str]] = {}

        with self.lock:
            for event_id, event in list(self.events.items()):
                if event_id in visible_ids:
                    self.presence_misses.pop(event_id, None)
                    continue
                if bool(event.get("isLive")):
                    self.presence_misses.pop(event_id, None)
                    continue
                if not event_is_visible_today_upcoming(event, local_now):
                    self.presence_misses.pop(event_id, None)
                    continue

                misses = self.presence_misses.get(event_id, 0) + 1
                if misses < 2:
                    self.presence_misses[event_id] = misses
                    continue

                self.presence_misses.pop(event_id, None)
                self.events.pop(event_id, None)
                self.odds_by_event.pop(event_id, None)
                self.history.pop(event_id, None)
                for miss_key in list(self.row_presence_misses):
                    if miss_key[0] == event_id:
                        self.row_presence_misses.pop(miss_key, None)
                removed.append(event_id)

            for event_id in visible_ids:
                self.presence_misses.pop(event_id, None)

            if isinstance(row_keys_by_event, dict):
                details_by_id = (
                    event_details_by_id
                    if isinstance(event_details_by_id, dict)
                    else {}
                )
                for raw_event_id, details in details_by_id.items():
                    source_event_id = as_text(raw_event_id)
                    event_id = self._resolve_market_event_id(
                        source_event_id,
                        details,
                        local_now,
                    )
                    if event_id:
                        self._apply_event_details(
                            event_id,
                            details,
                            local_now,
                        )
                for raw_event_id, raw_keys in row_keys_by_event.items():
                    source_event_id = as_text(raw_event_id)
                    if not isinstance(raw_keys, list):
                        continue
                    event_id = self._resolve_market_event_id(
                        source_event_id,
                        details_by_id.get(source_event_id),
                        local_now,
                    )
                    if not event_id:
                        unresolved_market_ids.append(source_event_id)
                        continue
                    current_keys = {
                        as_text(key) for key in raw_keys if as_text(key)
                    }
                    # An empty list is treated as an invalid/partial snapshot;
                    # event-level reconciliation handles fully removed events.
                    if current_keys:
                        resolved_keys.setdefault(event_id, set()).update(current_keys)

                for event_id, current_keys in resolved_keys.items():
                    rows = self.odds_by_event.get(event_id, {})
                    event = self.events[event_id]
                    for key, row in list(rows.items()):
                        if key in current_keys:
                            self.row_presence_misses.pop((event_id, key), None)
                            continue
                        miss_key = (event_id, key)
                        misses = self.row_presence_misses.get(miss_key, 0) + 1
                        captured_at = parse_kickoff(row.get("capturedAt"), local_now)
                        recently_updated = bool(
                            captured_at
                            and (
                                local_now - captured_at
                            ).total_seconds()
                            < MARKET_ROW_STALE_AFTER_SECONDS
                        )
                        required_misses = (
                            MARKET_ROW_MISSES
                            if recently_updated
                            else MARKET_ROW_STALE_MISSES
                        )
                        if misses < required_misses:
                            self.row_presence_misses[miss_key] = misses
                            continue

                        self.row_presence_misses.pop(miss_key, None)
                        rows.pop(key, None)
                        self.history.get(event_id, {}).pop(key, None)
                        event["rowCount"] = max(0, int(event["rowCount"]) - 1)
                        if row.get("quoted"):
                            event["quoteCount"] = max(
                                0, int(event["quoteCount"]) - 1
                            )
                        removed_rows.append({"eventId": event_id, "key": key})

            if removed or removed_rows:
                self.revision += 1

        return {
            "ok": True,
            "observedAt": local_now.isoformat(timespec="milliseconds"),
            "present": len(visible_ids),
            "removed": len(removed),
            "removedEventIds": removed,
            "removedRows": len(removed_rows),
            "removedRowKeys": removed_rows,
            "matchedMarketEventIds": sorted(resolved_keys),
            "unmatchedMarketEventIds": sorted(unresolved_market_ids),
        }

    def _persist_point(
        self,
        event_id: str,
        stage: str,
        market: str,
        option: str,
        line: str,
        captured_at: str,
        decimal: Optional[float],
        hong_kong: Optional[float],
        quoted: bool,
        direction: str,
        delta: Optional[float],
        source: str,
    ) -> None:
        if decimal is None:
            return
        self.history_writer.enqueue_point(
            {
                "eventId": event_id,
                "stage": stage,
                "market": market,
                "option": option,
                "line": line,
                "capturedAt": captured_at,
                "decimal": decimal,
                "hongKong": hong_kong,
                "quoted": quoted,
                "direction": direction,
                "delta": delta,
                "source": source,
            }
        )

    def _ensure_event(self, event_id: str) -> Dict[str, Any]:
        event = self.events.get(event_id)
        if event is None:
            name = f"赛事 {event_id}"
            event = {
                "id": event_id,
                "name": name,
                "league": "",
                "sportId": "",
                "leagueId": "",
                "kickoff": "",
                "metadataStatus": "missing",
                "isLive": False,
                "scoreHome": "",
                "scoreAway": "",
                "matchMinute": "",
                "matchPeriod": "",
                "matchStatus": "",
                "rowCount": 0,
                "quoteCount": 0,
                "lastCapturedAt": "",
                "lastChangedAt": "",
            }
            self.events[event_id] = event
            self.odds_by_event[event_id] = {}
            self.history[event_id] = {}
            self._persist_event(event_id)
        return event

    def _set_event_live(self, event_id: str, is_live: bool) -> bool:
        event = self._ensure_event(event_id)
        if event.get("isLive") == bool(is_live):
            return False
        event["isLive"] = bool(is_live)
        self._persist_event(event_id)
        return True

    def _sync_event_rows(self, event_id: str) -> None:
        event = self._ensure_event(event_id)
        ev = self.events[event_id]
        for row in self.odds_by_event.get(event_id, {}).values():
            row["eventName"] = ev["name"]
            row["league"] = ev["league"]
            row["sportId"] = ev.get("sportId", "")
            row["leagueId"] = ev.get("leagueId", "")
            row["kickoff"] = ev["kickoff"]
            row["metadataStatus"] = ev["metadataStatus"]
            row["isLive"] = ev["isLive"]
            row["scoreHome"] = ev.get("scoreHome", "")
            row["scoreAway"] = ev.get("scoreAway", "")
            row["matchMinute"] = ev.get("matchMinute", "")
            row["matchPeriod"] = ev.get("matchPeriod", "")
            row["matchStatus"] = ev.get("matchStatus", "")

    def register_event(
        self,
        event_id: str,
        home: str,
        away: str,
        league: str,
        kickoff: str,
        score_home: str = "",
        score_away: str = "",
        match_minute: str = "",
        match_period: str = "",
        match_status: str = "",
        sport_id: str = "",
        league_id: str = "",
    ) -> bool:
        event_id = as_text(event_id)
        if not event_id:
            return False
        event = self._ensure_event(event_id)
        old = dict(event)
        home = as_text(home)
        away = as_text(away)
        name = f"{home} VS {away}" if home and away else event["name"]
        league = as_text(league) or event["league"]
        sport_id = as_text(sport_id) or event.get("sportId", "")
        league_id = as_text(league_id) or event.get("leagueId", "")
        kickoff = as_text(kickoff) or event["kickoff"]
        event.update(
            {
                "name": name,
                "league": league,
                "sportId": sport_id,
                "leagueId": league_id,
                "kickoff": kickoff,
                "metadataStatus": metadata_status(name, league, kickoff),
                "scoreHome": as_text(score_home) or event.get("scoreHome", ""),
                "scoreAway": as_text(score_away) or event.get("scoreAway", ""),
                "matchMinute": as_text(match_minute) or event.get("matchMinute", ""),
                "matchPeriod": as_text(match_period) or event.get("matchPeriod", ""),
                "matchStatus": as_text(match_status) or event.get("matchStatus", ""),
            }
        )
        changed = any(event[key] != old[key] for key in (
            "name", "league", "sportId", "leagueId", "kickoff", "metadataStatus",
            "scoreHome", "scoreAway", "matchMinute", "matchPeriod",
            "matchStatus",
        ))
        if changed:
            self._sync_event_rows(event_id)
            self._persist_event(event_id)
            self.revision += 1
        return changed

    def reload_metadata_from_db(self) -> int:
        """Merge metadata repaired outside this process into the live store."""
        changed_events = 0
        with self.lock:
            for stored in self.history_db.list_events():
                event_id = stored["id"]
                event = self._ensure_event(event_id)
                old = {
                    key: event.get(key)
                    for key in (
                        "name", "league", "sportId", "leagueId", "kickoff",
                        "metadataStatus",
                    )
                }
                stored_status = as_text(stored.get("metadataStatus")) or "missing"
                current_status = as_text(event.get("metadataStatus")) or "missing"
                if stored_status == "complete" or current_status != "complete":
                    event["name"] = as_text(stored.get("name")) or event["name"]
                    event["league"] = as_text(stored.get("league")) or event["league"]
                    event["kickoff"] = as_text(stored.get("kickoff")) or event["kickoff"]
                    event["metadataStatus"] = stored_status
                event["sportId"] = as_text(stored.get("sportId")) or event.get("sportId", "")
                event["leagueId"] = as_text(stored.get("leagueId")) or event.get("leagueId", "")
                event["lastCapturedAt"] = max(
                    as_text(event.get("lastCapturedAt")),
                    as_text(stored.get("lastCapturedAt")),
                )
                event["lastChangedAt"] = max(
                    as_text(event.get("lastChangedAt")),
                    as_text(stored.get("lastChangedAt")),
                )
                if any(event.get(key) != value for key, value in old.items()):
                    self._sync_event_rows(event_id)
                    changed_events += 1
            if changed_events:
                self.revision += 1
        return changed_events

    def load_seed(self) -> None:
        if not self.seed_path.exists():
            return
        persisted_events: set[str] = set()
        try:
            with self.seed_path.open(encoding="utf-8-sig", newline="") as handle:
                for raw in csv.DictReader(handle):
                    event_id = as_text(raw.get("event_id"))
                    if not event_id:
                        continue
                    name = as_text(raw.get("比赛")) or f"赛事 {event_id}"
                    league = as_text(raw.get("联赛"))
                    sport_id = as_text(raw.get("sport_id"))
                    league_id = as_text(raw.get("league_id"))
                    kickoff = as_text(raw.get("开赛时间"))
                    status = as_text(raw.get("元数据状态")) or metadata_status(
                        name, league, kickoff
                    )
                    event = self._ensure_event(event_id)
                    event.update(
                        {
                            "name": name,
                            "league": league,
                            "sportId": sport_id,
                            "leagueId": league_id,
                            "kickoff": kickoff,
                            "metadataStatus": status,
                        }
                    )
                    if event_id not in persisted_events:
                        self._persist_event(event_id)
                        persisted_events.add(event_id)
                    stage = as_text(raw.get("阶段代码"))
                    market = as_text(raw.get("盘口代码"))
                    if not is_full_time_market(stage, market):
                        continue
                    option = as_text(raw.get("选项代码"))
                    line = as_text(raw.get("盘口线"))
                    captured_at = as_text(raw.get("采集时间"))
                    decimal = float_or_none(as_text(raw.get("decimal_odds")))
                    hong_kong = float_or_none(
                        as_text(raw.get("hong_kong_odds"))
                    )
                    quote_status = as_text(raw.get("报价状态"))
                    quoted = quote_status == "有报价" and decimal is not None
                    key = self._row_key(stage, market, option, line)
                    rows = self.odds_by_event[event_id]
                    if key in rows:
                        rows[key].update(
                            {
                                "eventName": name,
                                "league": league,
                                "sportId": sport_id,
                                "leagueId": league_id,
                                "kickoff": kickoff,
                                "metadataStatus": status,
                                "capturedAt": captured_at,
                                "decimal": decimal,
                                "hongKong": hong_kong,
                                "quoted": quoted,
                            }
                        )
                        continue
                    self._add_row(
                        event_id=event_id,
                        stage=stage,
                        market=market,
                        option=option,
                        line=line,
                        american=as_text(raw.get("美式赔率")),
                        raw=as_text(raw.get("原始赔率值")),
                        captured_at=captured_at,
                        decimal=decimal,
                        hong_kong=hong_kong,
                        quoted=quoted,
                        direction="flat",
                        previous_decimal=decimal,
                        delta=0.0,
                        serial=0,
                        history_seed=True,
                    )
                    self._persist_point(
                        event_id=event_id,
                        stage=stage,
                        market=market,
                        option=option,
                        line=line,
                        captured_at=captured_at,
                        decimal=decimal,
                        hong_kong=hong_kong,
                        quoted=quoted,
                        direction="seed",
                        delta=None,
                        source="seed",
                    )
                    self.seeded_rows += 1
                    if captured_at > self.last_captured_at:
                        self.last_captured_at = captured_at
            self.revision += 1
        except (OSError, csv.Error) as exc:
            print(f"[快照种子读取失败] {self.seed_path}: {exc}", flush=True)

    def _row_key(self, stage: str, market: str, option: str, line: str) -> str:
        return f"{stage}|{market}|{option}|{line}"

    def _add_row(
        self,
        event_id: str,
        stage: str,
        market: str,
        option: str,
        line: str,
        american: str,
        raw: str,
        captured_at: str,
        decimal: Optional[float],
        hong_kong: Optional[float],
        quoted: bool,
        direction: str,
        previous_decimal: Optional[float],
        delta: Optional[float],
        serial: int,
        history_seed: bool = False,
    ) -> Dict[str, Any]:
        event = self._ensure_event(event_id)
        key = self._row_key(stage, market, option, line)
        row = {
            "key": key,
            "eventId": event_id,
            "eventName": event["name"],
            "league": event["league"],
            "sportId": event.get("sportId", ""),
            "leagueId": event.get("leagueId", ""),
            "kickoff": event["kickoff"],
            "metadataStatus": event["metadataStatus"],
            "isLive": event["isLive"],
            "stage": stage,
            "market": market,
            "option": option,
            "line": line,
            "american": american,
            "raw": raw,
            "capturedAt": captured_at,
            "decimal": decimal,
            "hongKong": hong_kong,
            "quoted": quoted,
            "direction": direction,
            "previousDecimal": previous_decimal,
            "delta": delta,
            "serial": serial,
        }
        self.odds_by_event[event_id][key] = row
        event["rowCount"] += 1
        if quoted:
            event["quoteCount"] += 1
        if captured_at > event["lastCapturedAt"]:
            event["lastCapturedAt"] = captured_at
        hist = self.history[event_id].setdefault(key, [])
        if history_seed and decimal is not None:
            hist.append({"t": captured_at, "v": decimal})
        return row

    def _update_row(
        self,
        event_id: str,
        stage: str,
        market: str,
        option: str,
        line: str,
        american: str,
        raw: str,
        captured_at: str,
        decimal: Optional[float],
        hong_kong: Optional[float],
        quoted: bool,
        change_source: str,
    ) -> None:
        self._ensure_event(event_id)
        rows = self.odds_by_event[event_id]
        key = self._row_key(stage, market, option, line)
        old = rows.get(key)
        if old and captured_at and old["capturedAt"] and captured_at < old["capturedAt"]:
            return
        if old is None:
            self._add_row(
                event_id, stage, market, option, line, american, raw,
                captured_at, decimal, hong_kong, quoted, "new",
                None, None, 0,
            )
            event = self.events[event_id]
            event["lastCapturedAt"] = max(event["lastCapturedAt"], captured_at)
            self._append_history(event_id, key, captured_at, decimal)
            self._record_change(
                event_id, stage, market, option, line, None, decimal,
                "new", None, captured_at, change_source,
            )
            self._persist_point(
                event_id, stage, market, option, line, captured_at,
                decimal, hong_kong, quoted, "new", None, change_source,
            )
            self.revision += 1
            return

        old_quoted = bool(old["quoted"])
        previous_decimal = old["decimal"]
        direction = "flat"
        delta: Optional[float] = None
        if previous_decimal is None and decimal is not None:
            direction = "new"
        elif previous_decimal is not None and decimal is None:
            direction = "down"
        elif previous_decimal is not None and decimal is not None:
            delta = round(decimal - previous_decimal, 4)
            if delta > 0.00005:
                direction = "up"
            elif delta < -0.00005:
                direction = "down"
        serial = old.get("serial", 0)
        if direction in {"up", "down", "new"}:
            self.change_serial += 1
            serial = self.change_serial
        old.update(
            {
                "eventName": self.events[event_id]["name"],
                "league": self.events[event_id]["league"],
                "sportId": self.events[event_id].get("sportId", ""),
                "leagueId": self.events[event_id].get("leagueId", ""),
                "kickoff": self.events[event_id]["kickoff"],
                "metadataStatus": self.events[event_id]["metadataStatus"],
                "isLive": self.events[event_id]["isLive"],
                "stage": stage,
                "market": market,
                "option": option,
                "line": line,
                "american": american,
                "raw": raw,
                "capturedAt": captured_at,
                "decimal": decimal,
                "hongKong": hong_kong,
                "quoted": quoted,
                "direction": direction,
                "previousDecimal": previous_decimal,
                "delta": delta,
                "serial": serial,
            }
        )
        event = self.events[event_id]
        if quoted != old_quoted:
            event["quoteCount"] += 1 if quoted else -1
        event["lastCapturedAt"] = max(event["lastCapturedAt"], captured_at)
        self._append_history(event_id, key, captured_at, decimal)
        if direction in {"up", "down", "new"}:
            event["lastChangedAt"] = captured_at
            self.last_change_at = max(self.last_change_at, captured_at)
            self._record_change(
                event_id, stage, market, option, line, previous_decimal,
                decimal, direction, delta, captured_at, change_source,
            )
            self._persist_point(
                event_id, stage, market, option, line, captured_at,
                decimal, hong_kong, quoted, direction, delta, change_source,
            )
        self.revision += 1

    def _append_history(
        self, event_id: str, key: str, captured_at: str, decimal: Optional[float]
    ) -> None:
        if decimal is None:
            return
        hist = self.history[event_id].setdefault(key, [])
        if hist and hist[-1]["t"] == captured_at and hist[-1]["v"] == decimal:
            return
        hist.append({"t": captured_at, "v": decimal})
        if len(hist) > HISTORY_LIMIT:
            del hist[:-HISTORY_LIMIT]

    def _record_change(
        self,
        event_id: str,
        stage: str,
        market: str,
        option: str,
        line: str,
        old: Optional[float],
        new: Optional[float],
        direction: str,
        delta: Optional[float],
        captured_at: str,
        source: str,
    ) -> None:
        self.change_serial += 1
        self.changes.append(
            {
                "serial": self.change_serial,
                "eventId": event_id,
                "stage": stage,
                "market": market,
                "option": option,
                "line": line,
                "old": old,
                "new": new,
                "direction": direction,
                "delta": delta,
                "capturedAt": captured_at,
                "source": source,
            }
        )

    def process_line(self, line: str, source: str = "tail") -> bool:
        line = line.strip()
        if not line:
            return False
        try:
            record = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            with self.lock:
                self.parse_errors += 1
            return False
        if not isinstance(record, dict):
            return False
        opcode = record.get("opcode")
        if opcode not in (None, 1):
            return False
        payload = record.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except (json.JSONDecodeError, TypeError):
                return False
        if not isinstance(payload, (dict, list)):
            return False
        captured_at = as_text(record.get("captured_at")) or now_iso()
        messages = list(iter_messages(payload))
        if not messages:
            return False
        with self.lock:
            self.message_count += 1
            self.last_captured_at = max(self.last_captured_at, captured_at)
            for message in messages:
                odds = message.get("odds") or {}
                if not isinstance(odds, dict):
                    continue
                event_ids = set()
                for event_meta in iter_event_records(odds.get("l") or []):
                    self.register_event(
                        event_meta["eventId"],
                        event_meta["home"],
                        event_meta["away"],
                        event_meta["league"],
                        event_meta["kickoff"],
                        event_meta["scoreHome"],
                        event_meta["scoreAway"],
                        event_meta["matchMinute"],
                        event_meta["matchPeriod"],
                        event_meta["matchStatus"],
                        event_meta["sportId"],
                        event_meta["leagueId"],
                    )
                    event_ids.add(event_meta["eventId"])
                for event_meta in iter_event_records(odds.get("n") or []):
                    self.register_event(
                        event_meta["eventId"],
                        event_meta["home"],
                        event_meta["away"],
                        event_meta["league"],
                        event_meta["kickoff"],
                        event_meta["scoreHome"],
                        event_meta["scoreAway"],
                        event_meta["matchMinute"],
                        event_meta["matchPeriod"],
                        event_meta["matchStatus"],
                        event_meta["sportId"],
                        event_meta["leagueId"],
                    )
                    event_ids.add(event_meta["eventId"])
                rows = list(iter_leaf_rows(odds.get("u") or []))
                for row in rows:
                    event_id = as_text(row[12])
                    if not event_id:
                        continue
                    event_ids.add(event_id)
                live_value = odds.get("live")
                if isinstance(live_value, bool):
                    for event_id in event_ids:
                        if event_id:
                            self._set_event_live(event_id, live_value)
                for row in rows:
                    event_id = as_text(row[12])
                    if not event_id:
                        continue
                    stage = as_text(row[0])
                    market = as_text(row[1])
                    if not is_full_time_market(stage, market):
                        continue
                    option = as_text(row[2])
                    line_value = row[3]
                    if line_value is None:
                        line_value = ""
                    else:
                        try:
                            line_value = format(float(line_value), ".8g")
                        except (ValueError, TypeError):
                            line_value = as_text(line_value)
                    raw = as_text(row[5])
                    american = as_text(row[4])
                    normalized = normalize_odds(market, raw)
                    quoted = normalized["报价状态"] == "有报价"
                    decimal = float_or_none(normalized["decimal_odds"])
                    hong_kong = float_or_none(normalized["hong_kong_odds"])
                    self._update_row(
                        event_id=event_id,
                        stage=stage,
                        market=market,
                        option=option,
                        line=line_value,
                        american=american,
                        raw=raw,
                        captured_at=captured_at,
                        decimal=decimal,
                        hong_kong=hong_kong,
                        quoted=quoted,
                        change_source=source,
                    )
        return True

    def bootstrap_recent(self) -> None:
        if not self.capture_path.exists():
            return
        try:
            size = self.capture_path.stat().st_size
            if size <= 0:
                return
            start = max(0, size - RECENT_BOOTSTRAP_BYTES)
            with self.capture_path.open("rb") as handle:
                handle.seek(start)
                if start > 0:
                    handle.readline()
                data = handle.read()
            for raw_line in data.splitlines():
                try:
                    line = raw_line.decode("utf-8")
                except UnicodeDecodeError:
                    continue
                if self.process_line(line, source="recent"):
                    self.recent_rows += 1
        except OSError as exc:
            print(f"[近期数据预载失败] {self.capture_path}: {exc}", flush=True)

    def serialize_row(self, event_id: str, row: Dict[str, Any]) -> Dict[str, Any]:
        hist = self.history.get(event_id, {}).get(row["key"], [])
        return {
            **row,
            "decimalLabel": "" if row["decimal"] is None else f'{row["decimal"]:.4f}',
            "hongKongLabel": "" if row["hongKong"] is None else f'{row["hongKong"]:.4f}',
            "history": hist[-HISTORY_LIMIT:],
        }

    def query_history(
        self,
        event_id: str,
        hours: float,
        limit: int,
        filters: Dict[str, str],
    ) -> Dict[str, Any]:
        now = datetime.now().astimezone()
        since = now - timedelta(hours=hours)
        points, truncated = self.history_db.query_points(
            event_id=event_id,
            since=since.isoformat(timespec="milliseconds"),
            until=now.isoformat(timespec="milliseconds"),
            limit=limit,
            filters=filters,
        )
        event = self.events.get(event_id) or self.history_db.get_event(event_id)
        values = [
            float(point["decimal"])
            for point in points
            if point.get("decimal") is not None
        ]
        summary = {
            "count": len(points),
            "changes": sum(
                1 for point in points if point.get("direction") in {"up", "down", "new"}
            ),
            "first": values[0] if values else None,
            "last": values[-1] if values else None,
            "high": max(values) if values else None,
            "low": min(values) if values else None,
            "move": round(values[-1] - values[0], 4) if len(values) > 1 else 0.0,
        }
        return {
            "generatedAt": now_iso(),
            "eventId": event_id,
            "event": event,
            "filters": filters,
            "range": {
                "hours": hours,
                "from": since.isoformat(timespec="milliseconds"),
                "to": now.isoformat(timespec="milliseconds"),
            },
            "summary": summary,
            "truncated": truncated,
            "points": points,
            "database": {
                "path": str(self.database_path),
                "bytes": self.history_db.disk_bytes(),
                "points": self.history_writer.written_points,
                "queued": self.history_writer.tasks.qsize(),
                "dropped": self.history_writer.dropped,
                "errors": self.history_writer.errors,
            },
        }

    def snapshot(self, selected_event_id: str = "") -> Dict[str, Any]:
        with self.lock:
            now = datetime.now().astimezone()
            events = []
            visible_ids = set()
            for event in self.events.values():
                scope = event_scope(event, now)
                if not scope or not event_has_display_metadata(event):
                    continue
                visible_ids.add(event["id"])
                events.append({**event, "scope": scope})
            events.sort(
                key=lambda event: (
                    event.get("lastCapturedAt") or "",
                    event.get("quoteCount") or 0,
                ),
                reverse=True,
            )
            if not selected_event_id or selected_event_id not in visible_ids:
                selected_event_id = events[0]["id"] if events else ""
            rows = sorted(
                (
                    row
                    for row in self.odds_by_event.get(selected_event_id, {}).values()
                    if is_full_time_market(row.get("stage"), row.get("market"))
                ),
                key=lambda row: (
                    row["market"], row["stage"], row["option"],
                    row["line"]
                ),
            )
            changes = []
            change_count = 0
            for item in reversed(self.changes):
                if item["eventId"] not in visible_ids:
                    continue
                if not is_full_time_market(item.get("stage"), item.get("market")):
                    continue
                change_count += 1
                event = self.events.get(item["eventId"], {})
                if len(changes) < 24:
                    changes.append(
                        {
                            **item,
                            "eventName": event.get("name", f'赛事 {item["eventId"]}'),
                        }
                    )
            quote_count = sum(event["quoteCount"] for event in events)
            row_count = sum(event["rowCount"] for event in events)
            status_counts = Counter(event["metadataStatus"] for event in events)
            scope_counts = Counter(event["scope"] for event in events)
            try:
                capture_bytes = self.capture_path.stat().st_size
            except OSError:
                capture_bytes = 0
            lag_seconds = None
            if self.last_captured_at:
                try:
                    captured = datetime.fromisoformat(self.last_captured_at)
                    lag_seconds = max(
                        0, int((datetime.now().astimezone() - captured).total_seconds())
                    )
                except ValueError:
                    pass
            if lag_seconds is None:
                freshness = "no-data"
            elif lag_seconds <= 30:
                freshness = "live"
            elif lag_seconds <= 120:
                freshness = "delayed"
            else:
                freshness = "stale"
            return {
                "serverTime": now_iso(),
                "revision": self.revision,
                "freshness": freshness,
                "lagSeconds": lag_seconds,
                "stats": {
                    "events": len(events),
                    "live": scope_counts.get("live", 0),
                    "todayUpcoming": scope_counts.get("today", 0),
                    "rows": row_count,
                    "quotes": quote_count,
                    "complete": status_counts.get("complete", 0),
                    "partial": status_counts.get("partial", 0),
                    "missing": status_counts.get("missing", 0),
                    "changes": change_count,
                    "messages": self.message_count,
                    "parseErrors": self.parse_errors,
                },
                "source": {
                    "capturePath": str(self.capture_path),
                    "seedPath": str(self.seed_path),
                    "databasePath": str(self.database_path),
                    "databaseBytes": self.history_db.disk_bytes(),
                    "persistedPoints": self.history_writer.written_points,
                    "databaseQueued": self.history_writer.tasks.qsize(),
                    "databaseDropped": self.history_writer.dropped,
                    "databaseErrors": self.history_writer.errors,
                    "captureBytes": capture_bytes,
                    "lastCapturedAt": self.last_captured_at,
                    "lastChangeAt": self.last_change_at,
                    "seededRows": self.seeded_rows,
                    "recentMessages": self.recent_rows,
                    "startedAt": self.started_at,
                },
                "selectedEventId": selected_event_id,
                "events": events,
                "odds": [
                    self.serialize_row(selected_event_id, row) for row in rows
                ],
                "changes": changes,
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
        if apply:
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
            process = self._process
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


class DashboardHandler(BaseHTTPRequestHandler):
    store: OddsStore
    metadata_runner: MetadataSyncRunner

    def log_message(self, fmt: str, *args: Any) -> None:
        if args and str(args[1]).startswith("4"):
            super().log_message(fmt, *args)

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if is_crown_path(parsed.path):
            proxy_crown(self, "GET")
            return
        query = parse_qs(parsed.query, keep_blank_values=True)
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

    def do_POST(self) -> None:
        parsed = urlsplit(self.path)
        if is_crown_path(parsed.path):
            proxy_crown(self, "POST")
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


def build_server(host: str, port: int, config: Dict[str, Any]) -> ThreadingHTTPServer:
    store = OddsStore(config)
    print("[dashboard] 读取最新 CSV 快照...", flush=True)
    store.load_seed()
    print(
        f"[dashboard] 已载入 {store.seeded_rows} 条快照，正在预载近期消息...",
        flush=True,
    )
    store.bootstrap_recent()
    repaired = store.reload_metadata_from_db()
    if repaired:
        print(f"[dashboard] 已从 SQLite 合并 {repaired} 场赛事元数据", flush=True)
    tailer = CaptureTailer(store)
    tailer.start()
    metadata_runner = MetadataSyncRunner(store)
    DashboardHandler.store = store
    DashboardHandler.metadata_runner = metadata_runner
    server = ThreadingHTTPServer((host, port), DashboardHandler)
    server.daemon_threads = True
    server.odds_store = store  # type: ignore[attr-defined]
    server.metadata_runner = metadata_runner  # type: ignore[attr-defined]
    print(
        f"[dashboard] 已启动 http://{host}:{port} | "
        f"近期消息={store.recent_rows} | 赛事={len(store.events)} | "
        f"历史点={store.history_writer.written_points}",
        flush=True,
    )
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="PS3838 real-time odds dashboard")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--open", action="store_true", help="启动后打开浏览器")
    args = parser.parse_args()

    config = load_config()
    server = build_server(args.host, args.port, config)

    def handle_sigterm(signum: int, frame: Any) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, handle_sigterm)
    url = f"http://{args.host}:{args.port}"
    if args.open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[dashboard] 已停止", flush=True)
    finally:
        server.server_close()
        server.metadata_runner.close()  # type: ignore[attr-defined]
        server.odds_store.close()  # type: ignore[attr-defined]


if __name__ == "__main__":
    main()
