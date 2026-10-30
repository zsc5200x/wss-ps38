"""Durable manual provider mappings; scoring lives in the services layer."""
from __future__ import annotations
import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any
from src.services.fixture_matching import MappingConflict, _snapshot

class FixtureMergeStore:
    """SQLite persistence for manually confirmed cross-provider fixture links."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # The mapping tables are tiny and read on every merge refresh; cache the
        # parsed rows and invalidate on any store write instead of re-reading
        # and JSON-decoding both tables several times per request.
        self._cache_lock = threading.Lock()
        self._cache: dict[str, list[dict[str, Any]]] = {}
        self._cache_generation = 0
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        # WAL already allows concurrent readers with one writer; NORMAL drops
        # the extra fsync per commit while keeping WAL crash safety.
        connection.execute("PRAGMA synchronous = NORMAL")
        connection.execute("PRAGMA temp_store = MEMORY")
        connection.execute("PRAGMA cache_size = -16000")
        try:
            connection.execute("PRAGMA mmap_size = 67108864")
        except sqlite3.DatabaseError:
            pass
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA wal_autocheckpoint = 1000")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS fixture_mappings (
                    pinnacle_event_id TEXT PRIMARY KEY,
                    crown_event_id TEXT NOT NULL UNIQUE,
                    pinnacle_snapshot TEXT NOT NULL,
                    crown_snapshot TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS league_mappings (
                    pinnacle_league_id TEXT PRIMARY KEY,
                    crown_league_id TEXT NOT NULL UNIQUE,
                    pinnacle_snapshot TEXT NOT NULL,
                    crown_snapshot TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute("PRAGMA optimize")
        with self._cache_lock:
            self._cache_generation += 1
            self._cache.clear()

    def _invalidate(self) -> None:
        with self._cache_lock:
            self._cache_generation += 1
            self._cache.clear()

    def _cached_list(self, key: str, loader) -> list[dict[str, Any]]:
        with self._cache_lock:
            cached = self._cache.get(key)
            if cached is not None:
                return cached
            generation = self._cache_generation
        value = loader()
        with self._cache_lock:
            if self._cache_generation == generation:
                self._cache[key] = value
        return value

    def close(self) -> None:
        """Keep the same lifecycle API as the other stores; connections are per-operation."""
        return None

    @staticmethod
    def _timestamp() -> str:
        return datetime.now().astimezone().isoformat(timespec="seconds")

    def list_mappings(self) -> list[dict[str, Any]]:
        return self._cached_list("fixtures", self._load_mappings)

    def _load_mappings(self) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT pinnacle_event_id, crown_event_id, pinnacle_snapshot,
                       crown_snapshot, created_at, updated_at
                FROM fixture_mappings
                ORDER BY pinnacle_event_id
                """
            ).fetchall()
        return [
            {
                "pinnacleId": row["pinnacle_event_id"],
                "crownId": row["crown_event_id"],
                "pinnacleSnapshot": json.loads(row["pinnacle_snapshot"]),
                "crownSnapshot": json.loads(row["crown_snapshot"]),
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ]

    def list_league_mappings(self) -> list[dict[str, Any]]:
        return self._cached_list("leagues", self._load_league_mappings)

    def _load_league_mappings(self) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT pinnacle_league_id, crown_league_id, pinnacle_snapshot,
                       crown_snapshot, created_at, updated_at
                FROM league_mappings
                ORDER BY crown_league_id
                """
            ).fetchall()
        return [
            {
                "pinnacleId": row["pinnacle_league_id"],
                "crownId": row["crown_league_id"],
                "pinnacleSnapshot": json.loads(row["pinnacle_snapshot"]),
                "crownSnapshot": json.loads(row["crown_snapshot"]),
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ]

    def league_mapping_for_crown(self, crown_league_id: str) -> dict[str, Any] | None:
        key = str(crown_league_id or "").strip()
        if not key:
            return None
        return next(
            (item for item in self.list_league_mappings() if item["crownId"] == key),
            None,
        )

    @staticmethod
    def _league_mapping_has_fixtures(
        connection: sqlite3.Connection, pinnacle_league_id: str, crown_league_id: str
    ) -> bool:
        rows = connection.execute(
            "SELECT pinnacle_snapshot, crown_snapshot FROM fixture_mappings"
        ).fetchall()
        for row in rows:
            pinnacle = json.loads(row["pinnacle_snapshot"])
            crown = json.loads(row["crown_snapshot"])
            if (
                str(pinnacle.get("leagueId") or "") == pinnacle_league_id
                or str(crown.get("leagueId") or "") == crown_league_id
            ):
                return True
        return False

    def map_leagues(
        self, pinnacle_league: dict[str, Any], crown_league: dict[str, Any]
    ) -> dict[str, Any]:
        pinnacle_id = str(pinnacle_league.get("id") or "").strip()
        crown_id = str(crown_league.get("id") or "").strip()
        if not pinnacle_id or not crown_id:
            raise ValueError("双方联赛 ID 均不能为空")
        pinnacle = {"id": pinnacle_id, "name": str(pinnacle_league.get("name") or ""),
                    "eventCount": int(pinnacle_league.get("eventCount") or 0)}
        crown = {"id": crown_id, "name": str(crown_league.get("name") or ""),
                 "eventCount": int(crown_league.get("eventCount") or 0)}
        now = self._timestamp()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing_crown = connection.execute(
                "SELECT pinnacle_league_id FROM league_mappings WHERE crown_league_id = ?",
                (crown_id,),
            ).fetchone()
            existing_pinnacle = connection.execute(
                "SELECT crown_league_id FROM league_mappings WHERE pinnacle_league_id = ?",
                (pinnacle_id,),
            ).fetchone()
            if existing_crown and existing_crown["pinnacle_league_id"] != pinnacle_id:
                if self._league_mapping_has_fixtures(
                    connection, existing_crown["pinnacle_league_id"], crown_id
                ):
                    raise MappingConflict("该皇冠联赛下已有赛事关联，请先解除这些赛事关联。")
            if existing_pinnacle and existing_pinnacle["crown_league_id"] != crown_id:
                raise MappingConflict("该平博联赛已关联其他皇冠联赛，请先解除原联赛关联。")
            connection.execute(
                """
                INSERT INTO league_mappings (
                    pinnacle_league_id, crown_league_id, pinnacle_snapshot,
                    crown_snapshot, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(crown_league_id) DO UPDATE SET
                    pinnacle_league_id = excluded.pinnacle_league_id,
                    pinnacle_snapshot = excluded.pinnacle_snapshot,
                    crown_snapshot = excluded.crown_snapshot,
                    updated_at = excluded.updated_at
                """,
                (
                    pinnacle_id,
                    crown_id,
                    json.dumps(pinnacle, ensure_ascii=False, sort_keys=True),
                    json.dumps(crown, ensure_ascii=False, sort_keys=True),
                    now,
                    now,
                ),
            )
        self._invalidate()
        return {"pinnacleId": pinnacle_id, "crownId": crown_id, "updatedAt": now}

    def unmap_league(self, crown_league_id: str) -> bool:
        key = str(crown_league_id or "").strip()
        if not key:
            raise ValueError("皇冠联赛 ID 不能为空")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT pinnacle_league_id FROM league_mappings WHERE crown_league_id = ?",
                (key,),
            ).fetchone()
            if row is None:
                return False
            if self._league_mapping_has_fixtures(connection, row["pinnacle_league_id"], key):
                raise MappingConflict("该联赛下已有赛事关联，请先解除赛事关联后再解除联赛关联。")
            cursor = connection.execute(
                "DELETE FROM league_mappings WHERE crown_league_id = ?", (key,)
            )
        self._invalidate()
        return cursor.rowcount > 0

    def map_events(
        self, pinnacle_event: dict[str, Any], crown_event: dict[str, Any]
    ) -> dict[str, Any]:
        pinnacle = _snapshot(pinnacle_event, "pinnacle")
        crown = _snapshot(crown_event, "crown")
        pinnacle_id, crown_id = pinnacle["id"], crown["id"]
        if not pinnacle_id or not crown_id:
            raise ValueError("双方赛事 ID 均不能为空")
        pinnacle_league_id = pinnacle["leagueId"]
        crown_league_id = crown["leagueId"]
        if not pinnacle_league_id or not crown_league_id:
            raise MappingConflict("赛事缺少联赛 ID，无法按联赛关系建立关联。")

        now = self._timestamp()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            league_mapping = connection.execute(
                """
                SELECT pinnacle_league_id FROM league_mappings
                WHERE crown_league_id = ?
                """,
                (crown_league_id,),
            ).fetchone()
            if not league_mapping or league_mapping["pinnacle_league_id"] != pinnacle_league_id:
                raise MappingConflict("请先确认这两场赛事所属皇冠联赛与平博联赛的对应关系。")
            existing_c = connection.execute(
                "SELECT pinnacle_event_id FROM fixture_mappings WHERE crown_event_id = ?",
                (crown_id,),
            ).fetchone()
            if existing_c and existing_c["pinnacle_event_id"] != pinnacle_id:
                raise MappingConflict("这场皇冠赛事已关联其他平博赛事，请先解除原关联。")

            connection.execute(
                """
                INSERT INTO fixture_mappings (
                    pinnacle_event_id, crown_event_id, pinnacle_snapshot,
                    crown_snapshot, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(pinnacle_event_id) DO UPDATE SET
                    crown_event_id = excluded.crown_event_id,
                    pinnacle_snapshot = excluded.pinnacle_snapshot,
                    crown_snapshot = excluded.crown_snapshot,
                    updated_at = excluded.updated_at
                """,
                (
                    pinnacle_id,
                    crown_id,
                    json.dumps(pinnacle, ensure_ascii=False, sort_keys=True),
                    json.dumps(crown, ensure_ascii=False, sort_keys=True),
                    now,
                    now,
                ),
            )
        self._invalidate()
        return {
            "pinnacleId": pinnacle_id,
            "crownId": crown_id,
            "updatedAt": now,
        }

    def unmap(self, pinnacle_id: str) -> bool:
        key = str(pinnacle_id or "").strip()
        if not key:
            raise ValueError("平博赛事 ID 不能为空")
        with self._connection() as connection:
            cursor = connection.execute(
                "DELETE FROM fixture_mappings WHERE pinnacle_event_id = ?", (key,)
            )
        self._invalidate()
        return cursor.rowcount > 0
