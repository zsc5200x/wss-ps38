"""Candidate ranking and durable manual links for cross-provider fixtures.

Provider event IDs are opaque and scoped to their provider. Suggestions are
review aids only; this module never creates a mapping from a score.
"""

from __future__ import annotations

import os
import re
import unicodedata
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
from typing import Any, Iterable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


_TEAM_SUFFIXES = re.compile(
    r"\b(?:association football club|football club|soccer club|club|fc|sc|afc|cf)\b",
    re.IGNORECASE,
)
_MATCH_SPLIT = re.compile(r"\s+vs\.?\s+", re.IGNORECASE)
_CROWN_DATE = re.compile(
    r"(?P<month>\d{1,2})[-/](?P<day>\d{1,2})\s+"
    r"(?P<hour>\d{1,2}):(?P<minute>\d{2})"
    r"(?:\s*(?P<ampm>[ap])\.?m?\.?)?",
    re.IGNORECASE,
)


def _configured_timezone(env_name: str, default: str) -> ZoneInfo:
    """Load an IANA timezone while keeping the merge usable on minimal hosts."""
    name = os.environ.get(env_name, default).strip() or default
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        return ZoneInfo(default)


# The providers render local times without carrying the timezone in the
# payload. These defaults match the live feeds; environment overrides keep the
# parser usable if a provider account is configured for another display zone.
PINNACLE_TIMEZONE = _configured_timezone("PS3838_EVENT_TIMEZONE", "Asia/Shanghai")
CROWN_TIMEZONE = _configured_timezone("CROWN_EVENT_TIMEZONE", "America/New_York")
MERGE_DISPLAY_TIMEZONE = _configured_timezone("MERGE_DISPLAY_TIMEZONE", "Asia/Shanghai")


def _timezone_name(value: ZoneInfo) -> str:
    return str(getattr(value, "key", value))


class MappingConflict(ValueError):
    """A user-visible conflict when either source fixture is already linked."""


def normalize_name(value: Any) -> str:
    """Normalize a team or league label without translating its language."""
    text = unicodedata.normalize("NFKD", str(value or "")).casefold()
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = _TEAM_SUFFIXES.sub(" ", text)
    return "".join(character for character in text if character.isalnum())


def _similarity(left: Any, right: Any) -> float:
    a, b = normalize_name(left), normalize_name(right)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ratio = SequenceMatcher(None, a, b, autojunk=False).ratio()
    if a in b or b in a:
        ratio = max(ratio, min(len(a), len(b)) / max(len(a), len(b)) * 0.92)
    return ratio


def _teams(event: dict[str, Any], source: str) -> tuple[str, str]:
    home = str(event.get("home") or "").strip()
    away = str(event.get("away") or "").strip()
    if source == "pinnacle" and (not home or not away):
        match = _MATCH_SPLIT.split(str(event.get("name") or ""), maxsplit=1)
        if len(match) == 2:
            home, away = home or match[0].strip(), away or match[1].strip()
    return home, away


def prepare_pinnacle_event(event: dict[str, Any]) -> dict[str, Any]:
    """Normalize a dashboard Pinnacle event for the merge API."""
    home, away = _teams(event, "pinnacle")
    kickoff = str(event.get("kickoff") or "")
    normalized_kickoff = _format_display_datetime(_parse_pinnacle_datetime(kickoff))
    return {
        "id": str(event.get("id") or ""),
        "name": str(event.get("name") or ""),
        "home": home,
        "away": away,
        "league": str(event.get("league") or ""),
        "sportId": str(event.get("sportId") or ""),
        "leagueId": str(event.get("leagueId") or ""),
        "kickoff": kickoff,
        "normalizedKickoff": normalized_kickoff,
        "normalizedTimezone": _timezone_name(MERGE_DISPLAY_TIMEZONE),
        "isLive": bool(event.get("isLive")),
        "scoreHome": str(event.get("scoreHome") or ""),
        "scoreAway": str(event.get("scoreAway") or ""),
        "minute": str(event.get("matchMinute", event.get("minute")) or ""),
    }


def prepare_crown_event(event: dict[str, Any]) -> dict[str, Any]:
    """Normalize a Crown event for the merge API while retaining its IDs."""
    home, away = _teams(event, "crown")
    start_label = str(event.get("startLabel", event.get("start_label")) or "")
    normalized_kickoff = _format_display_datetime(_parse_crown_datetime(start_label))
    return {
        "id": str(event.get("id") or ""),
        "name": str(event.get("name") or ""),
        "home": home,
        "away": away,
        "league": str(event.get("league") or ""),
        "leagueId": str(event.get("leagueId", event.get("league_id")) or ""),
        "startLabel": start_label,
        "normalizedKickoff": normalized_kickoff,
        "normalizedTimezone": _timezone_name(MERGE_DISPLAY_TIMEZONE),
        "isLive": bool(event.get("isLive", event.get("is_live"))),
        "score": str(event.get("score") or ""),
        "minute": str(event.get("minute") or ""),
    }


def _parse_pinnacle_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=PINNACLE_TIMEZONE)
    return parsed.astimezone(timezone.utc)


def _parse_crown_datetime(value: Any, reference: datetime | None = None) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        parsed = None
    if parsed is not None:
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=CROWN_TIMEZONE)
        return parsed.astimezone(timezone.utc)

    match = _CROWN_DATE.search(text)
    if not match:
        return None
    month, day = int(match.group("month")), int(match.group("day"))
    hour, minute = int(match.group("hour")), int(match.group("minute"))
    ampm = (match.group("ampm") or "").lower().replace(".", "")
    if ampm:
        if not 1 <= hour <= 12:
            return None
        if ampm == "a" and hour == 12:
            hour = 0
        elif ampm == "p" and hour != 12:
            hour += 12
    elif not 0 <= hour <= 23:
        return None

    reference_local = (reference or datetime.now(timezone.utc)).astimezone(CROWN_TIMEZONE)
    options: list[datetime] = []
    for year in (reference_local.year - 1, reference_local.year, reference_local.year + 1):
        try:
            options.append(datetime(year, month, day, hour, minute, tzinfo=CROWN_TIMEZONE))
        except ValueError:
            continue
    if not options:
        return None
    selected = min(options, key=lambda item: abs((item - reference_local).total_seconds()))
    return selected.astimezone(timezone.utc)


def _format_display_datetime(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.astimezone(MERGE_DISPLAY_TIMEZONE).strftime("%Y-%m-%d %H:%M:%S")


def _pinnacle_date(value: Any) -> date | None:
    parsed = _parse_pinnacle_datetime(value)
    return parsed.date() if parsed else None


def _crown_date_near(value: Any, reference: date | None) -> date | None:
    if reference is not None:
        reference_datetime = datetime.combine(reference, datetime.min.time(), tzinfo=timezone.utc)
        parsed = _parse_crown_datetime(value, reference_datetime)
        if parsed is not None:
            return parsed.date()
    text = str(value or "").strip()
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    match = _CROWN_DATE.search(text)
    if not match:
        return None
    month, day = int(match.group("month")), int(match.group("day"))
    if not reference:
        return None
    options: list[date] = []
    for year in (reference.year - 1, reference.year, reference.year + 1):
        try:
            options.append(date(year, month, day))
        except ValueError:
            continue
    if not options:
        return None
    return min(options, key=lambda item: abs((item - reference).days))


def _fixture_features(
    pinnacle: dict[str, Any], crown: dict[str, Any]
) -> tuple[float, float, int | None, bool, float, float, float | None]:
    p_home, p_away = _teams(pinnacle, "pinnacle")
    c_home, c_away = _teams(crown, "crown")
    direct_home = _similarity(p_home, c_home)
    direct_away = _similarity(p_away, c_away)
    reverse_home = _similarity(p_home, c_away)
    reverse_away = _similarity(p_away, c_home)
    direct = (direct_home + direct_away) / 2
    reverse = (reverse_home + reverse_away) / 2
    reversed_order = reverse > direct
    team_score = max(direct, reverse)

    p_datetime = _parse_pinnacle_datetime(pinnacle.get("kickoff"))
    c_datetime = _parse_crown_datetime(
        crown.get("startLabel", crown.get("start_label")), p_datetime
    )
    p_date = p_datetime.date() if p_datetime else _pinnacle_date(pinnacle.get("kickoff"))
    c_date = c_datetime.date() if c_datetime else _crown_date_near(
        crown.get("startLabel", crown.get("start_label")), p_date
    )
    day_delta = abs((c_date - p_date).days) if p_date and c_date else None
    kickoff_delta_minutes = (
        round(abs((c_datetime - p_datetime).total_seconds()) / 60.0, 1)
        if p_datetime and c_datetime
        else None
    )
    league_score = _similarity(
        pinnacle.get("league"), crown.get("league")
    )
    same_live_state = bool(pinnacle.get("isLive")) == bool(
        crown.get("isLive", crown.get("is_live"))
    )
    return (
        team_score,
        league_score,
        day_delta,
        reversed_order,
        min(direct_home, direct_away),
        min(reverse_home, reverse_away),
        kickoff_delta_minutes,
    )


def _time_score(kickoff_delta_minutes: float | None) -> float | None:
    """Convert normalized kickoff distance into a bounded evidence score."""
    if kickoff_delta_minutes is None:
        return None
    if kickoff_delta_minutes <= 10:
        return 1.0
    if kickoff_delta_minutes <= 60:
        return 0.75
    if kickoff_delta_minutes <= 180:
        return 0.40
    if kickoff_delta_minutes <= 720:
        return 0.15
    return 0.0


def _candidate(
    pinnacle: dict[str, Any], crown: dict[str, Any]
) -> dict[str, Any] | None:
    (
        team_score,
        league_score,
        day_delta,
        reversed_order,
        direct_floor,
        _reverse_floor,
        kickoff_delta_minutes,
    ) = _fixture_features(pinnacle, crown)
    p_home, p_away = _teams(pinnacle, "pinnacle")
    c_home, c_away = _teams(crown, "crown")
    if not all((p_home, p_away, c_home, c_away)):
        return None

    # Crown and Pinnacle render local times in different zones. When both
    # values parse, the normalized time is stronger evidence than local dates;
    # the date score remains a fallback for incomplete feeds.
    date_score = 1.0 if day_delta == 0 else 0.55 if day_delta == 1 else 0.0
    time_score = _time_score(kickoff_delta_minutes)
    temporal_score = time_score if time_score is not None else date_score
    same_live_state = bool(pinnacle.get("isLive")) == bool(
        crown.get("isLive", crown.get("is_live"))
    )
    score = (
        team_score * 0.76
        + league_score * 0.10
        + temporal_score * 0.10
        + (0.04 if same_live_state else 0.0)
    )

    # Keep an alternate only when team text or league/date evidence gives the
    # operator something to inspect. The page can still offer full manual search.
    if team_score < 0.34 and not (league_score >= 0.70 and date_score >= 0.55):
        return None

    reasons: list[str] = []
    if reversed_order:
        reasons.append("球队名称较接近，但主客顺序相反")
    elif direct_floor >= 0.82:
        reasons.append("主客队名称高度相似")
    elif team_score >= 0.5:
        reasons.append("球队名称较相似")
    if league_score >= 0.65:
        reasons.append("联赛名称相似")
    if day_delta == 0:
        reasons.append("开赛日期相同")
    elif day_delta == 1:
        reasons.append("开赛日期相差一天")
    if kickoff_delta_minutes is not None:
        if kickoff_delta_minutes <= 10:
            reasons.append("统一时区后开赛时间吻合")
        else:
            reasons.append(f"统一时区后开赛时间相差 {kickoff_delta_minutes:g} 分钟")
    if same_live_state:
        reasons.append("双方比赛状态一致")

    confidence = (
        "high"
        if team_score >= 0.86 and direct_floor >= 0.82 and not reversed_order
        else "medium"
        if team_score >= 0.60
        else "low"
    )
    return {
        "pinnacleId": str(pinnacle.get("id") or ""),
        "crownId": str(crown.get("id") or ""),
        "score": round(score * 100, 1),
        "confidence": confidence,
        "reasons": reasons,
        "reversedOrder": reversed_order,
        "kickoffDeltaMinutes": kickoff_delta_minutes,
    }


def rank_candidates(
    pinnacle_events: Iterable[dict[str, Any]],
    crown_events: Iterable[dict[str, Any]],
    limit: int = 5,
) -> dict[str, list[dict[str, Any]]]:
    """Return advisory Crown candidates grouped by Pinnacle event ID.

    Cross-provider IDs are intentionally never compared. Each Pinnacle event
    receives up to ``limit`` scored candidates, ordered best first; no mapping
    is written or inferred automatically.
    """
    max_candidates = max(1, min(20, int(limit)))
    crowns = [event for event in crown_events if str(event.get("id") or "")]
    result: dict[str, list[dict[str, Any]]] = {}
    for pinnacle in pinnacle_events:
        pinnacle_id = str(pinnacle.get("id") or "")
        if not pinnacle_id:
            continue
        ranked = [
            item
            for crown in crowns
            if (item := _candidate(pinnacle, crown)) is not None
        ]
        ranked.sort(key=lambda item: (-item["score"], item["crownId"]))
        result[pinnacle_id] = ranked[:max_candidates]
    return result


def summarize_leagues(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group current provider events by that provider's league ID."""
    groups: dict[str, dict[str, Any]] = {}
    for event in events:
        league_id = str(event.get("leagueId") or event.get("league_id") or "")
        league_name = str(event.get("league") or "未命名联赛")
        if league_id not in groups:
            groups[league_id] = {"id": league_id, "name": league_name, "eventCount": 0}
        elif groups[league_id]["name"] in ("", "未命名联赛") and league_name:
            groups[league_id]["name"] = league_name
        groups[league_id]["eventCount"] += 1
    return sorted(
        groups.values(),
        key=lambda item: (normalize_name(item["name"]), item["id"]),
    )


def rank_league_candidates(
    pinnacle_events: Iterable[dict[str, Any]],
    crown_events: Iterable[dict[str, Any]],
    limit: int = 5,
) -> dict[str, list[dict[str, Any]]]:
    """Rank Pinnacle leagues for each Crown league as human-reviewed suggestions.

    League labels provide the baseline. Strong fixture candidates inside each
    pair of leagues contribute supporting evidence, but never create a mapping.
    """
    pinnacle = list(pinnacle_events)
    crown = list(crown_events)
    pinnacle_leagues = summarize_leagues(pinnacle)
    crown_leagues = summarize_leagues(crown)
    max_candidates = max(1, min(20, int(limit)))

    event_evidence: dict[tuple[str, str], list[float]] = {}
    for p_event in pinnacle:
        p_league_id = str(p_event.get("leagueId") or "")
        if not p_league_id:
            continue
        for c_event in crown:
            c_league_id = str(c_event.get("leagueId") or c_event.get("league_id") or "")
            if not c_league_id:
                continue
            candidate = _candidate(p_event, c_event)
            if candidate and candidate["score"] >= 65:
                event_evidence.setdefault((c_league_id, p_league_id), []).append(
                    float(candidate["score"])
                )

    result: dict[str, list[dict[str, Any]]] = {}
    for crown_league in crown_leagues:
        crown_id = str(crown_league["id"])
        if not crown_id:
            continue
        ranked: list[dict[str, Any]] = []
        for pinnacle_league in pinnacle_leagues:
            pinnacle_id = str(pinnacle_league["id"])
            if not pinnacle_id:
                continue
            name_score = _similarity(crown_league["name"], pinnacle_league["name"])
            evidence = sorted(
                event_evidence.get((crown_id, pinnacle_id), []), reverse=True
            )
            event_score = sum(evidence[:3]) / min(len(evidence), 3) if evidence else 0.0
            score = (name_score * 100.0) if not evidence else (
                name_score * 45.0 + event_score * 0.55
            )
            reasons: list[str] = []
            if name_score >= 0.65:
                reasons.append("联赛名称相似")
            elif name_score >= 0.35:
                reasons.append("联赛名称部分相似")
            if len(evidence) >= 2:
                reasons.append(f"组内有 {len(evidence)} 场赛事候选吻合")
            elif evidence:
                reasons.append("组内有 1 场赛事候选吻合")
            ranked.append({
                "crownLeagueId": crown_id,
                "pinnacleLeagueId": pinnacle_id,
                "score": round(score, 1),
                "reasons": reasons or ["可人工核对联赛和组内赛事"],
            })
        ranked.sort(key=lambda item: (-item["score"], item["pinnacleLeagueId"]))
        result[crown_id] = ranked[:max_candidates]
    return result


def _snapshot(event: dict[str, Any], source: str) -> dict[str, Any]:
    if source == "pinnacle":
        return prepare_pinnacle_event(event)
    return prepare_crown_event(event)


