"""Telegram delivery for newly observed partner orders.

The pusher reads the new-order event table produced by the order poller,
formats a short Chinese message and delivers it to the configured group.
Deliveries are recorded locally so a restart never double-sends, and a failed
send is retried with backoff instead of blocking later events.
"""

from __future__ import annotations

import html
import json
import re
import sqlite3
import threading
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

import project_config

BEIJING = timezone(timedelta(hours=8))


def _now_iso() -> str:
    return datetime.now(BEIJING).isoformat(timespec="seconds")


def _display_time(value: Any) -> str:
    try:
        return datetime.fromisoformat(str(value)).strftime("%Y/%m/%d %H:%M:%S")
    except (TypeError, ValueError):
        return str(value or "—")


def _fmt(value: Any, digits: Optional[int] = None) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "—"
    return f"{number:,.0f}" if digits is None else f"{number:,.{digits}f}"


def line_text(value: Any) -> str:
    """Render 0.25 / 0.75 as the adjacent half-goal pair, e.g. 3.25 -> 3/3.5."""
    try:
        number = abs(float(value))
    except (TypeError, ValueError):
        return ""
    whole = int(number)
    fraction = round(number - whole, 2)
    if fraction == 0:
        return str(whole)
    if fraction == 0.5:
        return f"{whole}.5"
    if fraction == 0.25:
        return f"{whole}/{whole}.5"
    if fraction == 0.75:
        return f"{whole}.5/{whole + 1}"
    return str(number)


def signed_line(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    text = line_text(number)
    if number > 0:
        return f"+{text}"
    if number < 0:
        return f"-{text}"
    return "0"


def split_teams(value: Any) -> tuple:
    text = str(value or "")
    parts = re.split(r"\s*-\s*vs\s*-\s*", text, flags=re.I)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return text.strip(), ""


def format_pick(row: Dict[str, Any]) -> str:
    """Mirror the dashboard's Chinese market notation for the push message."""
    market = str(row.get("market") or "").strip()
    lower = market.lower()
    selection = str(row.get("selection") or "").strip()
    if lower.startswith("ou") or market.startswith("大小"):
        prefix = "小" if selection in ("小", "UNDER") else "大"
        return f"{prefix}{line_text(row.get('handicap'))}"
    if lower.startswith("hdp") or market.startswith("让球"):
        home, away = split_teams(row.get("teams"))
        is_home = selection in ("主", "HOME")
        team = home if is_home else away
        return f"{team or ('主队' if is_home else '客队')}{signed_line(row.get('handicap'))}"
    if lower.startswith("1x2") or market.startswith("独赢"):
        return selection or "独赢"
    if lower.startswith("or"):
        return selection or market or "—"
    label = re.sub(r"\s*0(?:\.0+)?$", "", market).strip()
    return " ".join(part for part in (label, selection) if part) or "—"


def _escape(value: Any) -> str:
    return html.escape(str(value if value not in (None, "") else "—"), quote=False)


def format_message(row: Dict[str, Any]) -> str:
    home, away = split_teams(row.get("teams"))
    teams = f"{home} vs {away}" if away else (home or "—")
    member_code = str(row.get("member_user_code") or "—")
    member_name = str(row.get("member_name") or "")
    member = f"{member_code} · {member_name}" if member_name else member_code
    return "\n".join([
        "🆕 <b>平博新单</b>",
        "━━━━━━━━━━━━━━",
        f"🏆 <b>联赛</b>：{_escape(row.get('league'))}",
        f"⚽ <b>比赛</b>：{_escape(teams)}",
        f"🎯 <b>盘口</b>：{_escape(format_pick(row))}",
        f"💧 <b>水位</b>：{_fmt(row.get('odds'), 2)}",
        f"💰 <b>金额</b>：{_fmt(row.get('stake'))}",
        f"👤 <b>会员</b>：{_escape(member)}",
        f"🏷️ <b>代理</b>：{_escape(row.get('agent_code'))}",
        f"🧾 <b>单号</b>：{_escape(row.get('order_id'))}",
        f"🕒 <b>时间</b>：{_escape(_display_time(row.get('created_at')))}",
    ])


_CHAT_HINTS = {
    "chat not found": "Telegram 找不到这个 Chat ID：先把机器人拉进群并在群里发一条消息，或私聊机器人点 Start 后再试；群 ID 通常是 -100 开头的负数。",
    "bot was blocked by the user": "该账号把机器人拉黑了，请先解除拉黑。",
    "bot is not a member of the chat": "机器人不在该群里，请先把机器人拉进群。",
    "not enough rights to send text messages to the chat": "机器人在该群没有发言权限。",
    "user not found": "Telegram 找不到该用户，请确认账号。",
}


def _hint_for(description: str) -> str:
    text = str(description or "").lower()
    for needle, hint in _CHAT_HINTS.items():
        if needle in text:
            return hint
    return ""


def _describe(result: Dict[str, Any], fallback: str) -> str:
    description = str(result.get("description") or "").strip() or fallback
    hint = _hint_for(description)
    return f"{description}（{hint}）" if hint else description


def _telegram_request(
    config: Dict[str, Any],
    method: str,
    payload: Optional[Dict[str, Any]] = None,
    timeout: float = 10.0,
) -> Dict[str, Any]:
    """Call one Bot API method and surface Telegram's own error text."""
    token = str(config.get("token") or "").strip()
    if not token:
        raise RuntimeError("请先填写机器人 Token")
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=data,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    proxy = str(config.get("proxy") or "").strip()
    opener = build_opener(ProxyHandler({"http": proxy, "https": proxy})) if proxy else build_opener()
    try:
        with opener.open(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8", "replace"))
    except HTTPError as exc:
        description = ""
        try:
            body = json.loads(exc.read().decode("utf-8", "replace"))
            description = str(body.get("description") or "")
        except (ValueError, OSError):
            description = ""
        if description:
            hint = _hint_for(description)
            raise RuntimeError(f"{description}（{hint}）" if hint else description) from None
        raise RuntimeError(f"HTTP {exc.code}：Telegram 返回异常状态") from None
    except URLError as exc:
        reason = str(getattr(exc, "reason", exc) or exc)
        hint = "；请检查代理地址或本机网络" if proxy else "；请检查本机网络"
        raise RuntimeError(f"无法连接 Telegram：{reason}{hint}") from None
    except OSError as exc:
        raise RuntimeError(f"无法连接 Telegram：{exc}") from None


def list_chats(config: Dict[str, Any]) -> Dict[str, Any]:
    """Return chats the bot can already see, so the UI can fill the Chat ID.

    ``getUpdates`` only reports chats where the bot has received a message
    (or was added to a group), which is exactly the set that can be pushed to.
    """
    result = _telegram_request(
        config,
        "getUpdates",
        {"limit": 100, "allowed_updates": ["message", "channel_post", "my_chat_member"]},
    )
    if result.get("ok") is not True:
        raise RuntimeError(_describe(result, "读取 Telegram 会话失败"))
    chats: Dict[str, Dict[str, Any]] = {}
    for update in result.get("result") or []:
        if not isinstance(update, dict):
            continue
        for key in ("message", "edited_message", "channel_post", "my_chat_member", "chat_member"):
            entry = update.get(key)
            if not isinstance(entry, dict):
                continue
            chat = entry.get("chat")
            if not isinstance(chat, dict) and isinstance(entry.get("from"), dict):
                chat = entry.get("from")
            if not isinstance(chat, dict) or chat.get("id") is None:
                continue
            chat_id = str(chat.get("id"))
            title = (
                str(chat.get("title") or "")
                or str(chat.get("username") or "")
                or " ".join(
                    part for part in (chat.get("first_name"), chat.get("last_name")) if part
                )
                or chat_id
            )
            chats[chat_id] = {
                "id": chat_id,
                "type": str(chat.get("type") or ""),
                "title": title,
            }
    items = sorted(chats.values(), key=lambda item: (item["type"] != "group", item["title"]))
    hint = ""
    if not items:
        hint = "没有发现可用的会话：先把机器人拉进群并在群里发一条消息，或私聊机器人发送 /start 后再点一次。"
    return {"chats": items, "hint": hint}


class TelegramPusher(threading.Thread):
    def __init__(self, db_path: Path, interval: float = 3.0):
        super().__init__(name="telegram-push", daemon=True)
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.interval = max(2.0, float(interval))
        self._stop_event = threading.Event()
        self._lock = threading.RLock()
        self._db = sqlite3.connect(
            str(self.db_path), timeout=10, isolation_level=None, check_same_thread=False
        )
        self._db.row_factory = sqlite3.Row
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS state (
                key TEXT PRIMARY KEY, value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS deliveries (
                event_id INTEGER PRIMARY KEY, status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0, next_try REAL NOT NULL DEFAULT 0,
                message TEXT, created_at TEXT NOT NULL
            );
        """)
        self._cursor = self._load_cursor()
        self._was_enabled = False
        self._last_poll_at = 0.0

    # -- persistence -----------------------------------------------------
    def _load_cursor(self) -> int:
        row = self._db.execute("SELECT value FROM state WHERE key='last_event_id'").fetchone()
        try:
            return int(row["value"]) if row else 0
        except (TypeError, ValueError):
            return 0

    def _save_cursor(self, value: int) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO state VALUES('last_event_id', ?)", (str(int(value)),)
        )

    def _record(self, event_id: int, status: str, attempts: int, next_try: float,
                message: str) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO deliveries VALUES(?,?,?,?,?,?)",
            (event_id, status, attempts, next_try, message, _now_iso()),
        )
        self._db.execute(
            "DELETE FROM deliveries WHERE event_id <= "
            "(SELECT event_id FROM deliveries ORDER BY event_id DESC LIMIT 1 OFFSET 200)"
        )

    # -- config ----------------------------------------------------------
    def _config(self) -> Dict[str, Any]:
        config = project_config.load_config()
        return {
            "enabled": bool(config.get("telegram_enabled")),
            "token": str(config.get("telegram_bot_token") or "").strip(),
            "chat_id": str(config.get("telegram_chat_id") or "").strip(),
            "proxy": str(config.get("telegram_proxy") or "").strip(),
            "partner_db": project_config.get_path(config, "partner_orders_db_path"),
        }

    def state(self) -> Dict[str, Any]:
        # Use a separate read-only connection so a slow Telegram send in the
        # worker thread can never block the settings page.
        try:
            config = self._config()
        except Exception:  # noqa: BLE001 - settings read must not crash the UI
            config = {"enabled": False, "token": "", "chat_id": "", "proxy": ""}
        records: List[Dict[str, Any]] = []
        try:
            with closing(sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, timeout=5)) as connection:
                connection.row_factory = sqlite3.Row
                records = [dict(row) for row in connection.execute(
                    "SELECT event_id, status, attempts, message, created_at "
                    "FROM deliveries ORDER BY event_id DESC LIMIT 10"
                )]
        except sqlite3.Error:
            records = []
        pending: Optional[int] = None
        partner_db = str(config.get("partner_db") or "")
        if partner_db:
            max_event_id = self._max_event_id(Path(partner_db))
            if max_event_id is not None:
                pending = max(0, max_event_id - self._cursor)
        last_poll = (
            datetime.fromtimestamp(self._last_poll_at, BEIJING).isoformat(timespec="seconds")
            if self._last_poll_at else None
        )
        return {
            "enabled": bool(config["enabled"]),
            "has_token": bool(config["token"]),
            "chat_id": config["chat_id"],
            "proxy": config.get("proxy", ""),
            "records": records,
            "worker_alive": self.is_alive(),
            "last_poll_at": last_poll,
            "pending": pending,
            "cursor": self._cursor,
        }

    # -- partner database ------------------------------------------------
    @staticmethod
    def _connect(path: Path) -> sqlite3.Connection:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    def _max_event_id(self, path: Path) -> Optional[int]:
        try:
            with closing(self._connect(path)) as connection:
                row = connection.execute(
                    "SELECT COALESCE(MAX(event_id),0) FROM partner_order_events"
                ).fetchone()
                return int(row[0])
        except (sqlite3.Error, OSError):
            return None

    def _advance_cursor(self, path: Path) -> None:
        max_id = self._max_event_id(path)
        if max_id is not None and max_id > self._cursor:
            self._cursor = max_id
            self._save_cursor(max_id)

    _EVENT_QUERY = """
        SELECT e.event_id, e.agent_code, e.observed_at,
               o.member_user_code, o.member_name, o.league, o.teams, o.market,
               o.selection, o.handicap, o.odds, o.stake, o.currency,
               o.created_at, o.order_id, o.status
          FROM partner_order_events e
          LEFT JOIN partner_orders o
            ON o.source=e.source AND o.member_identity=e.member_identity
           AND o.order_id=e.order_id
         WHERE {where}
         ORDER BY e.event_id {order} LIMIT ?
    """

    def _fetch_events(self, path: Path, after: int, limit: int = 50) -> List[sqlite3.Row]:
        with closing(self._connect(path)) as connection:
            return connection.execute(
                self._EVENT_QUERY.format(where="e.event_id > ?", order="ASC"),
                (after, limit),
            ).fetchall()

    def _fetch_event(self, path: Path, event_id: int) -> Optional[sqlite3.Row]:
        with closing(self._connect(path)) as connection:
            return connection.execute(
                self._EVENT_QUERY.format(where="e.event_id = ?", order="ASC"),
                (event_id, 1),
            ).fetchone()

    # -- delivery --------------------------------------------------------
    @staticmethod
    def _send(config: Dict[str, Any], text: str) -> None:
        result = _telegram_request(
            config,
            "sendMessage",
            {
                "chat_id": config["chat_id"],
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
        )
        if result.get("ok") is not True:
            raise RuntimeError(_describe(result, "Telegram 拒绝发送"))

    def _deliver(self, row: sqlite3.Row, config: Dict[str, Any]) -> None:
        event_id = int(row["event_id"])
        old = self._db.execute(
            "SELECT status, attempts, next_try FROM deliveries WHERE event_id=?", (event_id,)
        ).fetchone()
        if old and (old["status"] == "sent" or old["attempts"] >= 5
                    or old["next_try"] > time.time()):
            return
        attempts = (int(old["attempts"]) if old else 0) + 1
        try:
            self._send(config, format_message(dict(row)))
            self._record(event_id, "sent", attempts, 0, "推送成功")
        except Exception as exc:  # noqa: BLE001 - retry with backoff
            delay = min(300, 15 * (2 ** attempts))
            self._record(event_id, "failed", attempts, time.time() + delay, str(exc)[:200])

    def _poll(self) -> None:
        self._last_poll_at = time.time()
        try:
            config = self._config()
        except Exception:  # noqa: BLE001 - ignore a transient bad config file
            return
        path = Path(config["partner_db"])
        if not config["enabled"] or not config["token"] or not config["chat_id"]:
            self._advance_cursor(path)
            self._was_enabled = False
            return
        if not self._was_enabled:
            # Opening the switch must not dump the existing backlog into the group.
            self._advance_cursor(path)
            self._was_enabled = True
        for row in self._fetch_events(path, self._cursor):
            self._deliver(row, config)
            if int(row["event_id"]) > self._cursor:
                self._cursor = int(row["event_id"])
                self._save_cursor(self._cursor)
        retries = self._db.execute(
            "SELECT event_id FROM deliveries WHERE status='failed' AND attempts<5 "
            "AND next_try<=? ORDER BY event_id LIMIT 10", (time.time(),)
        ).fetchall()
        for item in retries:
            row = self._fetch_event(path, int(item["event_id"]))
            if row is not None:
                self._deliver(row, config)

    def arm(self) -> None:
        """Called when the switch turns on so the very next event is delivered."""
        self._was_enabled = True

    def run(self) -> None:
        while not self._stop_event.wait(self.interval):
            try:
                self._poll()
            except Exception:  # noqa: BLE001 - the thread must survive
                pass

    def stop(self) -> None:
        self._stop_event.set()
        self.join(timeout=5)
        self._db.close()

    # -- settings actions ------------------------------------------------
    def test(self) -> Dict[str, Any]:
        config = self._config()
        if not config["token"]:
            raise ValueError("请先填写机器人 Token")
        if not config["chat_id"]:
            raise ValueError("请先填写群 Chat ID")
        self._send(config, "🆕 平博订单看板：Telegram 测试推送成功。")
        return {"ok": True}
