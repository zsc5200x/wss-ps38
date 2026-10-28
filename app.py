import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from crown_runtime import (
    account_action,
    add_account,
    initialize as initialize_crown,
    lock as crown_runtime_lock,
    public_accounts,
    refresh_event_more,
    refresh_once,
    state as crown_state,
    submit_otp,
)

HOST = "127.0.0.1"
PORT = 8887
CROWN_REFRESH_SECONDS = 6
CROWN_FAILURE_BACKOFF_SECONDS = (10, 20, 40, 60)


def _crown_retry_delay(result):
    if result.get("ok"):
        return CROWN_REFRESH_SECONDS
    reason = str(result.get("reason") or "")
    if reason == "refresh_in_progress":
        return 2
    if reason == "no_session":
        return 5
    if reason == "runtime_unavailable":
        return 30
    with crown_runtime_lock:
        failures = int((crown_state.get("diagnostics") or {}).get("consecutive_failures") or 1)
    index = min(max(failures, 1) - 1, len(CROWN_FAILURE_BACKOFF_SECONDS) - 1)
    return CROWN_FAILURE_BACKOFF_SECONDS[index]


def crown_refresh_loop():
    while True:
        refresh_started = time.monotonic()
        try:
            result = refresh_once()
        except Exception:
            result = {"ok": False, "reason": "crown_unavailable"}
        delay = _crown_retry_delay(result)
        with crown_runtime_lock:
            diagnostics = dict(crown_state.get("diagnostics") or {})
            diagnostics["retry_in_ms"] = int(round(delay * 1000))
            crown_state["diagnostics"] = diagnostics
        remaining = delay - (time.monotonic() - refresh_started)
        if remaining > 0:
            time.sleep(remaining)


def _compact_market_items(items, *, include_extra_fields=False):
    keys = ["line", "a", "b", "gid", "gidm", "hgid", "market_id", "master"]
    if include_extra_fields:
        keys.extend((
            "raw_line", "market_type", "market_key", "home", "draw", "away",
            "over", "under",
        ))
    compact = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        compact.append({
            key: item.get(key)
            for key in keys
            if item.get(key) not in (None, "")
        })
    return compact


def _compact_extra_markets(event):
    extra = event.get("extra_markets") if isinstance(event, dict) else None
    if not isinstance(extra, dict):
        return {"status": "not_requested", "handicap": [], "total": [], "moneyline": []}
    result = {"status": str(extra.get("status") or "not_requested")}
    for market_type in ("handicap", "total", "moneyline"):
        result[market_type] = _compact_market_items(
            extra.get(market_type),
            include_extra_fields=True,
        )
    return result


def _compact_crown_event(event):
    if not isinstance(event, dict):
        return None
    markets = event.get("markets") if isinstance(event.get("markets"), dict) else {}
    result = {
        key: event.get(key)
        for key in (
            "id", "league_id", "league", "is_live", "home", "away",
            "start_label", "score", "minute", "period", "odds_format_label",
        )
    }
    result["markets"] = {
        "moneyline": list(markets.get("moneyline") or []),
        "handicap": _compact_market_items(markets.get("handicap")),
        "total": _compact_market_items(markets.get("total")),
    }
    result["extra_markets"] = _compact_extra_markets(event)
    return result


def _snapshot_crown(compact=False):
    with crown_runtime_lock:
        snapshot = {
            "events": list(crown_state.get("events") or []),
            "leagues": list(crown_state.get("leagues") or []),
            "updated_at": crown_state.get("updated_at"),
            "status": crown_state.get("status"),
            "error": crown_state.get("error"),
            "cached": bool(crown_state.get("cached")),
            "source": crown_state.get("source"),
            "diagnostics": dict(crown_state.get("diagnostics") or {}),
        }
    if compact:
        snapshot["events"] = [
            item for item in (
                _compact_crown_event(event) for event in snapshot["events"]
            ) if item is not None
        ]
    return snapshot


CROWN_HTML = r"""
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#080d16">
<title>皇冠赛事 · Crown Odds Terminal</title>
<style>
:root{
  color-scheme:dark;
  --bg:#080d16;
  --bg-elevated:#0e1624;
  --panel:rgba(17,26,41,.92);
  --panel-solid:#111a29;
  --panel-raised:#152135;
  --panel-soft:#18263a;
  --border:rgba(148,163,184,.16);
  --border-strong:rgba(148,163,184,.28);
  --rule:rgba(148,163,184,.1);
  --text:#f3f7fb;
  --text-soft:#c4cedd;
  --muted:#8290a7;
  --muted-2:#5f708b;
  --accent:#42e6a4;
  --accent-strong:#24c98a;
  --accent-soft:rgba(66,230,164,.12);
  --danger:#ff647c;
  --danger-soft:rgba(255,100,124,.12);
  --warning:#f4bf5f;
  --warning-soft:rgba(244,191,95,.12);
  --blue:#6ea8ff;
  --blue-soft:rgba(110,168,255,.12);
  --shadow:0 20px 55px rgba(0,0,0,.28);
  --radius-lg:18px;
  --radius-md:12px;
  --radius-sm:8px;
  --font-sans:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Microsoft YaHei",sans-serif;
  --font-mono:"SFMono-Regular","Cascadia Code","Roboto Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html{min-width:320px;min-height:100%;background:var(--bg)}
body{
  min-height:100vh;margin:0;overflow-x:hidden;color:var(--text);
  background:radial-gradient(circle at 12% -15%,rgba(54,120,255,.15),transparent 34rem),radial-gradient(circle at 95% 4%,rgba(66,230,164,.09),transparent 30rem),linear-gradient(180deg,#0a111d 0%,var(--bg) 48%,#080c14 100%);
  font-family:var(--font-sans);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;
}
button,input,select{font:inherit}
button{color:inherit}
button,select{cursor:pointer}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button:disabled{cursor:wait;opacity:.55}
h1,h2,h3,p{margin:0}
.hidden{display:none!important}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.ambient{position:fixed;z-index:-1;width:34rem;height:34rem;border-radius:999px;filter:blur(70px);opacity:.3;pointer-events:none}
.ambient-a{top:-16rem;left:-10rem;background:rgba(46,104,230,.22)}
.ambient-b{top:24rem;right:-22rem;background:rgba(46,220,160,.13)}
.app-shell{width:min(1540px,calc(100% - 32px));min-height:100vh;margin:0 auto;padding:22px 0 18px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:68px;padding:0 4px 18px}
.brand{display:flex;min-width:0;align-items:center;gap:12px;color:var(--text);text-decoration:none}
.brand-mark{position:relative;display:grid;width:44px;height:44px;flex:0 0 44px;place-items:center;border:1px solid rgba(66,230,164,.28);border-radius:13px;background:linear-gradient(145deg,rgba(66,230,164,.16),rgba(11,18,30,.86));box-shadow:inset 0 1px rgba(255,255,255,.05),0 12px 28px rgba(0,0,0,.22);color:var(--accent);font-family:var(--font-mono);font-size:1rem;font-weight:800}
.brand-mark::after{content:"";position:absolute;width:7px;height:7px;right:5px;top:5px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px rgba(66,230,164,.8)}
.brand-copy{display:grid;min-width:0;gap:1px}
.eyebrow{color:var(--muted);font-family:var(--font-mono);font-size:.66rem;font-weight:600;letter-spacing:.13em;text-transform:uppercase}
.brand h1{font-size:clamp(1.25rem,2vw,1.55rem);font-weight:650;letter-spacing:-.03em;line-height:1.12}
.brand small{color:var(--muted-2);font-family:var(--font-mono);font-size:.62rem;letter-spacing:.04em}
.primary-nav{display:flex;align-items:center;gap:3px;padding:3px;border:1px solid var(--border);border-radius:10px;background:rgba(7,12,21,.58)}
.primary-nav a{display:inline-flex;min-height:34px;align-items:center;justify-content:center;padding:5px 15px;color:var(--muted);border-radius:7px;text-decoration:none;font-size:.72rem;font-weight:600;white-space:nowrap;transition:color 150ms ease,background 150ms ease,box-shadow 150ms ease}
.primary-nav a:hover{color:var(--text-soft);background:rgba(255,255,255,.035)}
.primary-nav a.active{color:#9df7ce;background:var(--accent-soft);box-shadow:inset 0 0 0 1px rgba(66,230,164,.13)}
.topbar-actions{display:flex;align-items:center;gap:8px}
.button,.icon-button{display:inline-flex;min-height:38px;align-items:center;justify-content:center;gap:7px;padding:8px 12px;border:1px solid transparent;border-radius:9px;background:transparent;font-size:.78rem;font-weight:600;text-decoration:none;transition:border-color 160ms ease,background 160ms ease,transform 160ms ease}
.button svg,.icon-button svg{width:16px;height:16px}
.button:hover,.icon-button:hover{transform:translateY(-1px)}
.button.ghost{color:var(--text-soft);border-color:var(--border);background:rgba(17,26,41,.66)}
.button.ghost:hover{border-color:var(--border-strong);background:var(--panel-raised)}
.button.primary{color:#06130e;background:var(--accent);box-shadow:0 8px 18px rgba(66,230,164,.13)}
.button.primary:hover{background:#66efb5}
.button[aria-pressed="true"]{color:#ffcf83;border-color:rgba(244,191,95,.24);background:var(--warning-soft)}
.icon-button{width:38px;padding:0;color:var(--text-soft);border-color:var(--border);background:rgba(17,26,41,.66)}
.icon-button:hover{border-color:var(--border-strong);background:var(--panel-raised)}
.topbar-telemetry{display:flex;min-height:46px;align-items:center;justify-content:space-between;gap:16px;margin:-3px 4px 14px;padding:6px 10px;border:1px solid rgba(148,163,184,.11);border-radius:11px;background:linear-gradient(90deg,rgba(12,20,33,.82),rgba(8,13,22,.54));box-shadow:inset 0 1px rgba(255,255,255,.018)}
.telemetry-status{display:flex;flex:0 0 auto;align-items:center}
.status-pill{display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:5px 11px;color:var(--text-soft);border:1px solid var(--border);border-radius:999px;background:rgba(15,24,38,.82);font-family:var(--font-mono);font-size:.69rem;font-weight:600;letter-spacing:.02em;white-space:nowrap}
.status-dot{display:inline-block;width:7px;height:7px;flex:0 0 7px;border-radius:999px;background:var(--muted);box-shadow:0 0 0 4px rgba(130,144,167,.08)}
.status-pill.live{color:#9df7ce;border-color:rgba(66,230,164,.24);background:var(--accent-soft)}
.status-pill.live .status-dot{background:var(--accent);box-shadow:0 0 0 4px rgba(66,230,164,.1),0 0 12px rgba(66,230,164,.8);animation:livePulse 2s ease-in-out infinite}
.status-pill.delayed{color:#ffd894;border-color:rgba(244,191,95,.24);background:var(--warning-soft)}
.status-pill.delayed .status-dot{background:var(--warning)}
.status-pill.stale,.status-pill.offline{color:#ff9cad;border-color:rgba(255,100,124,.24);background:var(--danger-soft)}
.status-pill.stale .status-dot,.status-pill.offline .status-dot{background:var(--danger)}
.telemetry-source{display:flex;min-width:0;align-items:baseline;gap:8px;padding-inline:12px;border-inline:1px solid rgba(148,163,184,.075)}
.telemetry-source .label,.last-capture .label{color:var(--muted-2);font-size:.56rem;font-weight:600;letter-spacing:.06em;white-space:nowrap}
.telemetry-source strong{overflow:hidden;color:var(--text-soft);font-family:var(--font-mono);font-size:.65rem;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.last-capture{display:flex;flex:0 0 auto;align-items:baseline;gap:8px}
.last-capture strong{color:var(--text-soft);font-family:var(--font-mono);font-size:.76rem;font-variant-numeric:tabular-nums;font-weight:500}
.metrics-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
.metric-card{min-width:0;padding:14px 16px 13px;border:1px solid var(--border);border-radius:var(--radius-md);background:linear-gradient(145deg,rgba(21,33,53,.82),rgba(12,20,33,.94));box-shadow:inset 0 1px rgba(255,255,255,.025)}
.metric-head,.metric-foot{display:flex;align-items:center;justify-content:space-between;gap:12px}
.metric-head{margin-bottom:9px;color:var(--muted);font-size:.68rem;font-weight:600;letter-spacing:.055em;text-transform:uppercase}
.metric-head svg{width:15px;height:15px;color:var(--muted-2)}
.metric-card>strong{display:block;overflow:hidden;color:var(--text);font-family:var(--font-mono);font-size:clamp(1.2rem,2vw,1.42rem);font-variant-numeric:tabular-nums;font-weight:550;letter-spacing:-.04em;line-height:1.18;text-overflow:ellipsis;white-space:nowrap}
.metric-foot{margin-top:8px;color:var(--muted-2);font-family:var(--font-mono);font-size:.64rem;font-variant-numeric:tabular-nums}
.micro-badge{display:inline-flex;min-height:20px;align-items:center;justify-content:center;padding:3px 7px;color:var(--muted);border:1px solid var(--border);border-radius:999px;background:rgba(8,13,22,.36);font-family:var(--font-mono);font-size:.63rem;font-weight:600;line-height:1;white-space:nowrap}
.micro-badge.live{color:#9df7ce;border-color:rgba(66,230,164,.2);background:var(--accent-soft)}
.micro-badge.stale,.micro-badge.offline{color:#ff9cad;border-color:rgba(255,100,124,.2);background:var(--danger-soft)}
.micro-badge.delayed{color:#ffd894;border-color:rgba(244,191,95,.2);background:var(--warning-soft)}
.workspace{display:grid;grid-template-columns:minmax(285px,330px) minmax(0,1fr);align-items:stretch;gap:12px;min-height:520px;height:calc(100vh - 282px)}
.panel{min-width:0;border:1px solid var(--border);border-radius:var(--radius-lg);background:linear-gradient(160deg,rgba(18,28,45,.94),rgba(11,18,30,.96));box-shadow:var(--shadow),inset 0 1px rgba(255,255,255,.025)}
.events-panel{display:flex;min-height:0;flex-direction:column;padding:17px 12px 10px}
.panel-title-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 5px 13px}
.panel-title-row h2{font-size:1rem;font-weight:650;letter-spacing:-.015em}
.panel-title-row p{margin-top:2px;color:var(--muted-2);font-size:.62rem}
.count-badge{display:inline-flex;min-width:32px;min-height:24px;align-items:center;justify-content:center;padding:4px 8px;color:var(--muted);border:1px solid var(--border);border-radius:999px;background:rgba(8,13,22,.36);font-family:var(--font-mono);font-size:.63rem;font-weight:600}
.event-controls{display:grid;gap:8px;margin:0 3px 10px}
.search-field{position:relative;display:flex;min-height:40px;align-items:center;gap:8px;padding:0 11px;color:var(--muted);border:1px solid var(--border);border-radius:9px;background:rgba(6,11,19,.55);transition:border-color 160ms ease,box-shadow 160ms ease}
.search-field:focus-within{border-color:rgba(66,230,164,.37);box-shadow:0 0 0 3px rgba(66,230,164,.07)}
.search-field svg{width:17px;height:17px;flex:none}
.search-field input{width:100%;min-width:0;padding:9px 0;color:var(--text);border:0;outline:0;background:transparent;font-size:.72rem}
.search-field input::placeholder{color:var(--muted-2)}
.compact-select{display:flex;min-height:38px;align-items:center;padding:0 10px;border:1px solid var(--border);border-radius:9px;background:rgba(6,11,19,.55)}
.compact-select select{width:100%;color:var(--text-soft);border:0;outline:0;background:transparent;font-size:.7rem}
.inline-alert{display:flex;align-items:flex-start;gap:8px;margin:0 3px 9px;padding:9px 10px;color:#ffb3bf;border:1px solid rgba(255,100,124,.18);border-radius:9px;background:var(--danger-soft);font-size:.64rem;line-height:1.55}
.inline-alert svg{width:15px;height:15px;flex:none;margin-top:1px}
.event-list{min-height:0;flex:1;overflow:auto;padding:0 3px 4px;scrollbar-width:thin;scrollbar-color:rgba(148,163,184,.24) transparent}
.event-list::-webkit-scrollbar{width:6px}
.event-list::-webkit-scrollbar-thumb{border-radius:99px;background:rgba(148,163,184,.24)}
.event-groups{display:grid;gap:11px}
.event-group{overflow:hidden;border:1px solid rgba(148,163,184,.1);border-radius:11px;background:rgba(6,11,19,.22)}
.event-group-head{display:flex;width:100%;min-height:38px;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;color:var(--text-soft);border:0;border-bottom:1px solid var(--rule);background:rgba(21,33,53,.48);font-size:.64rem;font-weight:650;text-align:left}
.event-group-head:hover{background:rgba(26,40,62,.72)}
.event-group-title{display:flex;align-items:center;gap:7px}
.event-group-title::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent)}
.event-group.live .event-group-title::before{background:var(--danger);box-shadow:0 0 8px rgba(255,100,124,.5)}
.event-group-count{color:var(--muted-2);font-family:var(--font-mono);font-size:.58rem;font-weight:500}
.event-group-toggle{color:var(--muted);font-size:1rem;transition:transform 150ms ease}
.event-group.collapsed .event-group-toggle{transform:rotate(-90deg)}
.event-group.collapsed .league-list{display:none}
.league-list{display:grid;gap:1px}
.league-label{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px 5px;color:var(--muted);font-size:.58rem;font-weight:650;letter-spacing:.03em}
.league-label strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.league-label span{flex:none;color:var(--muted-2);font-family:var(--font-mono);font-weight:500}
.event-item{display:grid;width:100%;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:10px;color:inherit;border:0;border-top:1px solid rgba(148,163,184,.07);background:transparent;text-align:left;transition:background 150ms ease,box-shadow 150ms ease}
.event-item:hover{background:rgba(255,255,255,.025)}
.event-item.selected{background:rgba(66,230,164,.055);box-shadow:inset 2px 0 var(--accent)}
.event-item-main{display:grid;min-width:0;gap:4px}
.event-item-top{display:flex;min-width:0;align-items:center;gap:6px}
.event-live-dot{width:5px;height:5px;flex:none;border-radius:50%;background:var(--danger)}
.event-time{color:var(--muted-2);font-family:var(--font-mono);font-size:.57rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.event-team-line{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:8px;color:var(--text-soft);font-size:.7rem;font-weight:550;line-height:1.35}
.event-team-line span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.event-team-line strong{flex:none;color:var(--muted);font-family:var(--font-mono);font-size:.6rem;font-weight:500}
.event-item.selected .event-team-line{color:var(--text)}
.event-item-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px;color:var(--muted-2);font-family:var(--font-mono);font-size:.55rem}
.event-item-foot span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.event-item-foot span:last-child{flex:none}
.event-item-side{display:flex;min-width:34px;flex-direction:column;align-items:flex-end;justify-content:center;gap:3px}
.event-item-side strong{color:var(--text);font-family:var(--font-mono);font-size:.7rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.event-item-side span{color:var(--muted-2);font-family:var(--font-mono);font-size:.52rem;white-space:nowrap}
.event-list-empty,.detail-empty{display:flex;min-height:240px;align-items:center;justify-content:center;flex-direction:column;gap:8px;padding:24px;color:var(--muted);border:1px dashed rgba(148,163,184,.15);border-radius:12px;background:rgba(5,9,16,.18);text-align:center}
.event-list-empty svg,.detail-empty svg{width:42px;height:42px;color:var(--muted-2)}
.event-list-empty strong,.detail-empty strong{color:var(--text-soft);font-size:.84rem}
.event-list-empty p,.detail-empty p{max-width:340px;color:var(--muted-2);font-size:.67rem;line-height:1.6}
.event-list-empty .button,.detail-empty .button{margin-top:3px}
.event-list-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 5px 1px;color:var(--muted-2);font-family:var(--font-mono);font-size:.56rem}
.details-panel{display:flex;min-height:0;flex-direction:column;overflow:hidden}
.detail-scroll{min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-color:rgba(148,163,184,.24) transparent}
.detail-scroll::-webkit-scrollbar{width:7px}
.detail-scroll::-webkit-scrollbar-thumb{border-radius:99px;background:rgba(148,163,184,.24)}
.detail-empty{height:100%;min-height:460px;border:0;border-radius:0;background:transparent}
.event-hero{position:relative;overflow:hidden;padding:22px 24px 19px;border-bottom:1px solid var(--border);background:radial-gradient(circle at 50% -40%,rgba(66,230,164,.11),transparent 55%),linear-gradient(145deg,rgba(21,33,53,.72),rgba(11,18,30,.48))}
.event-hero::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,transparent,rgba(255,255,255,.015),transparent)}
.event-hero-top{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:17px}
.event-league{display:flex;min-width:0;align-items:center;gap:8px;color:var(--muted);font-size:.64rem;font-weight:600}
.event-league::before{content:"";width:7px;height:7px;flex:none;border-radius:2px;background:var(--accent);transform:rotate(45deg)}
.event-league span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.event-hero-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}
.meta-pill{display:inline-flex;min-height:23px;align-items:center;padding:3px 8px;color:var(--muted);border:1px solid var(--border);border-radius:999px;background:rgba(8,13,22,.36);font-family:var(--font-mono);font-size:.58rem;white-space:nowrap}
.meta-pill.live{color:#ff9cad;border-color:rgba(255,100,124,.2);background:var(--danger-soft)}
.match-hero{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(124px,.55fr) minmax(0,1fr);align-items:center;gap:22px}
.match-team{min-width:0;color:var(--text);font-size:clamp(1rem,1.7vw,1.22rem);font-weight:650;letter-spacing:-.025em;line-height:1.3;overflow-wrap:anywhere}
.match-team.away{text-align:right}
.match-score{display:grid;justify-items:center;gap:5px;text-align:center}
.match-score strong{display:block;color:var(--text);font-family:var(--font-mono);font-size:clamp(1.5rem,3vw,2.05rem);font-variant-numeric:tabular-nums;font-weight:550;letter-spacing:-.06em;line-height:1}
.match-score span{color:var(--muted);font-family:var(--font-mono);font-size:.61rem;line-height:1.4}
.detail-summary-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin:0 18px;border-bottom:1px solid var(--border)}
.detail-summary-row div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 6px;border-right:1px solid var(--rule)}
.detail-summary-row div:last-child{border-right:0}
.detail-summary-row span{color:var(--muted-2);font-size:.58rem;font-weight:600}
.detail-summary-row strong{color:var(--text-soft);font-family:var(--font-mono);font-size:.65rem;font-weight:500;text-align:right}
.markets-layout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:14px}
.market-book{min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:11px;background:rgba(7,12,21,.36)}
.market-book.moneyline{grid-column:1/-1}
.market-book-head{display:flex;min-height:42px;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);background:rgba(21,33,53,.48)}
.market-book-head h3{display:flex;align-items:center;gap:8px;color:var(--text-soft);font-size:.7rem;font-weight:650}
.market-book-head h3::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--blue)}
.market-book-head small{color:var(--muted-2);font-family:var(--font-mono);font-size:.56rem;font-weight:500}
.market-line{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-bottom:1px solid var(--rule)}
.market-line:last-child{border-bottom:0}
.selection{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px;border-right:1px solid var(--rule)}
.selection:last-child{border-right:0}
.selection span{min-width:0;color:var(--muted);font-size:.62rem;line-height:1.4;overflow-wrap:anywhere}
.selection strong{flex:none;color:var(--text);font-family:var(--font-mono);font-size:.78rem;font-variant-numeric:tabular-nums;font-weight:550;white-space:nowrap}
.market-empty{display:flex;min-height:82px;align-items:center;justify-content:center;padding:16px;color:var(--muted-2);font-size:.64rem;text-align:center}
.market-note{padding:6px 11px;color:var(--muted-2);border-top:1px solid var(--rule);font-family:var(--font-mono);font-size:.53rem;text-align:right}
.moneyline-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.moneyline-cell{display:grid;min-width:0;gap:5px;padding:12px 10px;border-right:1px solid var(--rule);text-align:center}
.moneyline-cell:last-child{border-right:0}
.moneyline-cell span{color:var(--muted);font-size:.61rem;line-height:1.35;overflow-wrap:anywhere}
.moneyline-cell strong{color:var(--text);font-family:var(--font-mono);font-size:.86rem;font-variant-numeric:tabular-nums;font-weight:550}
.modal-backdrop,.settings-modal{position:fixed;inset:0;z-index:30;display:none;align-items:flex-start;justify-content:center;padding:62px 16px 24px;background:rgba(3,8,15,.76);backdrop-filter:blur(8px)}
.modal-backdrop.open,.settings-modal.open{display:flex}
.settings-panel,.login-panel{width:min(570px,100%);max-height:min(88vh,900px);overflow:auto;border:1px solid var(--border-strong);border-radius:var(--radius-lg);background:var(--panel-solid);box-shadow:0 28px 80px rgba(0,0,0,.55);scrollbar-width:thin;scrollbar-color:rgba(148,163,184,.24) transparent}
.settings-panel-head,.login-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 17px;border-bottom:1px solid var(--border);background:rgba(21,33,53,.5);font-size:.85rem;font-weight:650}
.settings-panel-body,.login-panel-body{display:grid;gap:12px;padding:15px}
.settings-source-card{display:grid;gap:10px;padding:13px;border:1px solid var(--border);border-radius:10px;background:rgba(7,12,21,.34)}
.settings-source-head{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--text);font-size:.72rem;font-weight:650}
.settings-source-head span:last-child{color:var(--muted-2);font-family:var(--font-mono);font-size:.56rem;font-weight:500}
.settings-source-copy,.login-help{color:var(--muted);font-size:.64rem;line-height:1.65}
.settings-source-actions,.login-actions,.account-form-actions,.account-row-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.settings-close,.close-button{display:inline-grid;width:30px;height:30px;place-items:center;padding:0;color:var(--muted);border:1px solid var(--border);border-radius:8px;background:transparent;font-size:1.15rem;line-height:1}
.settings-close:hover,.close-button:hover{color:var(--text);border-color:var(--border-strong);background:var(--panel-raised)}
.login-button,.action-button{display:inline-flex;min-height:34px;align-items:center;justify-content:center;gap:7px;padding:6px 11px;color:var(--text-soft);border:1px solid var(--border);border-radius:8px;background:rgba(21,33,53,.64);font-size:.66rem;font-weight:600;text-decoration:none;cursor:pointer}
.login-button:hover,.action-button:hover{border-color:var(--border-strong);background:var(--panel-raised)}
.action-button.primary,.login-button{border-color:rgba(66,230,164,.28);background:var(--accent-soft);color:#a9fbd8}
.action-button.primary:hover,.login-button:hover{border-color:rgba(66,230,164,.44);background:rgba(66,230,164,.17)}
.login-button .dot{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 7px rgba(66,230,164,.65)}
.login-status{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid var(--border);border-radius:10px;background:rgba(7,12,21,.34)}
.login-status-indicator{width:8px;height:8px;flex:none;margin-top:5px;border-radius:50%;background:var(--muted-2)}
.login-status-indicator.connected{background:var(--accent);box-shadow:0 0 9px rgba(66,230,164,.7)}
.login-status-indicator.error{background:var(--danger)}
.login-status-title{color:var(--text);font-size:.7rem;font-weight:650}
.login-status-copy{color:var(--muted);font-size:.61rem;line-height:1.6}
.account-form{display:grid;gap:10px;padding-top:13px;border-top:1px solid var(--border)}
.account-form label{display:grid;gap:5px;color:var(--muted);font-size:.61rem;font-weight:600}
.account-form input,.otp-form input{width:100%;min-height:38px;padding:8px 10px;color:var(--text);border:1px solid var(--border);border-radius:8px;outline:0;background:rgba(6,11,19,.55);font-size:.68rem}
.account-form input:focus,.otp-form input:focus{border-color:rgba(66,230,164,.42);box-shadow:0 0 0 3px rgba(66,230,164,.07)}
.account-form-status{color:var(--muted);font-size:.6rem;line-height:1.5}
.account-list{display:grid;gap:8px;padding-top:13px;border-top:1px solid var(--border)}
.account-list-title{color:var(--text-soft);font-size:.66rem;font-weight:650}
.account-row{display:grid;gap:9px;padding:11px;border:1px solid var(--border);border-radius:10px;background:rgba(7,12,21,.3)}
.account-row-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.account-row-name{color:var(--text);font-size:.68rem;font-weight:650;overflow-wrap:anywhere}
.account-row-meta,.account-row-status{color:var(--muted);font-size:.57rem;line-height:1.55;overflow-wrap:anywhere}
.account-row-status{flex:none;color:var(--text-soft);white-space:nowrap}
.account-row-actions .action-button{min-height:30px;padding:5px 8px;font-size:.58rem}
.otp-form{display:flex;align-items:center;gap:7px}
.otp-form input{flex:1;min-width:120px}
.account-empty{padding:12px;color:var(--muted);border:1px dashed var(--border);border-radius:9px;font-size:.61rem;text-align:center}
.app-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 4px 0;color:var(--muted-2);font-family:var(--font-mono);font-size:.55rem}
body.crown-embedded .ambient,body.crown-embedded .topbar{display:none}
body.crown-embedded .app-shell{width:100%;min-height:100vh;padding:10px 12px 12px}
body.crown-embedded .topbar-telemetry{margin-top:0}
@keyframes livePulse{0%,100%{opacity:1}50%{opacity:.55}}
@media(max-width:1080px){
  .app-shell{width:min(100% - 24px,980px)}
  .topbar{flex-wrap:wrap;gap:12px}
  .brand{flex:1}
  .primary-nav{order:3;width:100%;justify-content:center}
  .workspace{height:auto;grid-template-columns:280px minmax(0,1fr)}
  .events-panel{min-height:600px;max-height:calc(100vh - 295px)}
  .details-panel{min-height:600px;max-height:calc(100vh - 295px)}
}
@media(max-width:820px){
  .app-shell{width:calc(100% - 20px);padding-top:14px}
  .topbar{padding-bottom:13px}
  .topbar-actions{order:2}
  .topbar-actions .button span{display:none}
  .topbar-actions .button{width:38px;padding:0}
  .metrics-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .workspace{grid-template-columns:1fr;height:auto}
  .events-panel{min-height:0;max-height:none}
  .event-list{max-height:360px}
  .details-panel{min-height:0;max-height:none}
  .detail-empty{min-height:320px}
  .event-hero{padding:18px}
  .match-hero{gap:14px}
  .detail-summary-row{margin-inline:12px}
  .markets-layout{grid-template-columns:1fr;padding:11px}
  .market-book.moneyline{grid-column:auto}
}
@media(max-width:560px){
  .app-shell{width:calc(100% - 16px)}
  .topbar{align-items:flex-start}
  .brand-mark{width:40px;height:40px;flex-basis:40px}
  .brand small{display:none}
  .topbar-actions{gap:5px}
  .topbar-telemetry{flex-wrap:wrap;gap:8px;margin-inline:0;padding:8px}
  .telemetry-source{order:3;width:100%;padding:5px 0 0;border:0;border-top:1px solid var(--rule)}
  .last-capture{margin-left:auto}
  .metric-card{padding:12px}
  .metric-head{font-size:.6rem}
  .metric-foot{font-size:.57rem}
  .match-hero{grid-template-columns:1fr;gap:12px;text-align:center}
  .match-team.away{text-align:center}
  .event-hero-top{align-items:flex-start;flex-direction:column;gap:8px}
  .event-hero-meta{justify-content:flex-start}
  .detail-summary-row{grid-template-columns:1fr;margin:0 12px}
  .detail-summary-row div{padding:8px 4px;border-right:0;border-bottom:1px solid var(--rule)}
  .detail-summary-row div:last-child{border-bottom:0}
  .market-line{grid-template-columns:1fr}
  .selection{border-right:0;border-bottom:1px solid var(--rule)}
  .selection:last-child{border-bottom:0}
  .moneyline-grid{grid-template-columns:1fr}
  .moneyline-cell{border-right:0;border-bottom:1px solid var(--rule)}
  .moneyline-cell:last-child{border-bottom:0}
  .modal-backdrop,.settings-modal{align-items:flex-end;padding:10px}
  .settings-panel,.login-panel{max-height:90vh;border-radius:14px}
  .app-footer{align-items:flex-start;flex-direction:column;gap:3px}
}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}
}
</style>
</head>
<body>
<div class="ambient ambient-a" aria-hidden="true"></div>
<div class="ambient ambient-b" aria-hidden="true"></div>
<div class="app-shell">
  <header class="topbar">
    <a class="brand" href="/crown" aria-label="皇冠赛事首页">
      <span class="brand-mark" aria-hidden="true">C</span>
      <span class="brand-copy"><span class="eyebrow">CROWN ODDS TERMINAL</span><h1>皇冠赛事</h1><small>足球 · 实时盘口 · 本地只读会话</small></span>
    </a>
    <nav class="primary-nav" aria-label="主要页面">
      <a class="active" href="/crown" aria-current="page">皇冠数据</a>
    </nav>
    <div class="topbar-actions">
      <button class="button ghost" id="joinSessionButton" type="button" title="登录皇冠并检查会话">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/></svg>
        <span>连接会话</span>
      </button>
      <button class="button ghost" id="pauseRefresh" type="button" aria-pressed="false" title="暂停自动刷新">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>
        <span>暂停刷新</span>
      </button>
      <button class="button primary" id="refreshButton" type="button" title="立即刷新">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.2 9A7 7 0 0 0 6.1 6.8L4 9m16 6-2.1 2.2A7 7 0 0 1 5.8 15"/></svg>
        <span>立即刷新</span>
      </button>
      <button class="icon-button" id="settingsButton" type="button" aria-label="打开页面设置" title="页面设置">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>
      </button>
    </div>
  </header>

  <section class="topbar-telemetry" aria-label="皇冠数据接收状态">
    <div class="telemetry-status"><div id="crownConnectionPill" class="status-pill loading" aria-live="polite"><span class="status-dot"></span><span id="crownConnectionText">正在连接</span></div></div>
    <div class="telemetry-source"><span class="label">当前数据源</span><strong>当前项目 · CROWN ODDS</strong></div>
    <div class="last-capture"><span class="label">最后更新</span><strong id="crownUpdatedAt">--:--:--</strong></div>
  </section>

  <section class="metrics-grid" aria-label="皇冠实时指标">
    <article class="metric-card">
      <div class="metric-head"><span>滚球 + 今日比赛</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 5h14v14H5zM5 10h14M10 5v14"/></svg></div>
      <strong id="crownCount">—</strong>
      <div class="metric-foot"><span id="crownLiveCount">滚球 —</span><span id="crownTodayCount">今日 —</span></div>
    </article>
    <article class="metric-card">
      <div class="metric-head"><span>联赛数量</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="7" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="7" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="7" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg></div>
      <strong id="crownLeagueCount">—</strong>
      <div class="metric-foot"><span>独立联赛</span><span id="crownVisibleCount">显示 —</span></div>
    </article>
    <article class="metric-card">
      <div class="metric-head"><span>数据状态</span><span id="crownStateBadge" class="micro-badge">检查中</span></div>
      <strong id="crownStatus">—</strong>
      <div class="metric-foot"><span id="crownDataState">等待数据</span><span>只读</span></div>
    </article>
    <article class="metric-card">
      <div class="metric-head"><span>自动刷新</span><span class="micro-badge live">3 SEC</span></div>
      <strong>3 秒</strong>
      <div class="metric-foot"><span id="crownPollState">轮询运行中</span><span>HK</span></div>
    </article>
  </section>

  <main class="workspace">
    <aside class="events-panel panel" aria-labelledby="eventsTitle">
      <div class="panel-title-row"><div><div class="eyebrow">LIVE FIXTURES</div><h2 id="eventsTitle">皇冠赛事</h2><p id="crownSubStatus">正在读取皇冠赛事数据…</p></div><span class="count-badge" id="crownVisibleBadge">0</span></div>
      <div class="event-controls">
        <label class="search-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg><span class="sr-only">搜索皇冠联赛、球队或比赛 ID</span><input id="crownSearch" type="search" placeholder="搜索联赛、球队或比赛 ID" autocomplete="off"></label>
        <label class="compact-select"><span class="sr-only">筛选皇冠赛事范围</span><select id="crownFilter"><option value="">滚球 + 今日</option><option value="live">仅滚球</option><option value="prematch">仅今日待开</option></select></label>
      </div>
      <div class="inline-alert hidden" id="crownError" role="status"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></svg><span id="crownErrorText"></span></div>
      <div class="event-list" id="crownEvents"><div class="event-list-empty"><span class="eyebrow">LOADING FEED</span><strong>正在读取皇冠数据</strong><p>正在连接当前项目的皇冠只读会话…</p></div></div>
      <div class="event-list-footer"><span id="crownSourceLabel">CURRENT PROJECT · CROWN</span><span id="crownQuoteTotal">0 组报价</span></div>
    </aside>

    <section class="details-panel panel" aria-label="皇冠赛事盘口详情">
      <div class="detail-scroll" id="crownEventDetail"><div class="detail-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg><strong>选择一场皇冠赛事</strong><p>赛事列表加载后，这里会显示让球、大小球和全场胜平负盘口。</p><button class="button primary" type="button" data-open-login>连接皇冠会话</button></div></div>
    </section>
  </main>

  <footer class="app-footer"><span>当前项目独立皇冠运行时 · 凭据和会话仅保存在本机</span><span>港赔 HK · 3 秒轮询</span></footer>
</div>

<div class="settings-modal" id="settingsModal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
  <section class="settings-panel">
    <div class="settings-panel-head"><span id="settingsTitle">页面设置</span><button class="settings-close" id="settingsClose" type="button" aria-label="关闭设置">×</button></div>
    <div class="settings-panel-body">
      <section class="settings-source-card">
        <div class="settings-source-head"><span>皇冠数据连接</span><span>LOCAL SESSION</span></div>
        <div class="settings-source-copy">账号、加密凭据、浏览器会话和 OTP 都由当前项目独立管理，不会读取其他项目的账号库。</div>
        <div class="settings-source-actions"><button class="login-button" id="crownLoginButton" type="button"><span class="dot" aria-hidden="true"></span>皇冠登录</button></div>
      </section>
    </div>
  </section>
</div>

<div class="modal-backdrop" id="loginModal" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
  <section class="login-panel">
    <div class="login-panel-head"><strong id="loginTitle">皇冠登录</strong><button class="close-button" id="closeLogin" type="button" aria-label="关闭">×</button></div>
    <div class="login-panel-body">
      <div class="login-status"><span class="login-status-indicator" id="loginIndicator"></span><div><div class="login-status-title" id="loginStatusTitle">正在检查登录会话</div><div class="login-status-copy" id="loginStatusCopy">登录成功后，当前页面会自动轮询皇冠赛事和盘口数据。</div></div></div>
      <div class="login-actions"><button class="action-button primary" id="checkCrownSession" type="button">检查全部会话</button></div>
      <form class="account-form" id="crownAccountForm">
        <label>域名或登录地址<input id="crownLoginUrl" name="login_url" placeholder="例如 https://example.com" required autocomplete="url"></label>
        <label>登录账号<input id="crownUsername" name="username" required autocomplete="username"></label>
        <label>登录密码<input id="crownPassword" name="password" type="password" required autocomplete="current-password"></label>
        <label>TOTP 密钥（可选）<input id="crownTotp" name="totp_secret" autocomplete="off"></label>
        <div class="account-form-actions"><button class="action-button primary" type="submit">添加账号并登录</button><span class="account-form-status" id="crownAccountFormStatus"></span></div>
      </form>
      <div class="account-list"><div class="account-list-title">当前项目保存的皇冠账号</div><div id="crownAccounts"><div class="account-empty">正在读取账号…</div></div></div>
      <p class="login-help">账号配置、加密凭据和浏览器会话全部保存在当前项目的 data 目录及本机 Keychain 中。</p>
    </div>
  </section>
</div>

<script>
function installSourceRouter(){
  if(window.__sourceRouterInstalled)return;
  window.__sourceRouterInstalled=true;
  window.__sourceView=window.history.state?.sourceView||window.location.pathname+window.location.search;
  window.history.replaceState({...window.history.state,sourceView:window.__sourceView},"",window.location.href);
  document.addEventListener("click",event=>{
    const link=event.target.closest("a[href]");if(!link)return;
    const target=new URL(link.href,window.location.href);
    if(target.origin!==window.location.origin||!["/","/crown"].includes(target.pathname))return;
    event.preventDefault();window.location.assign(target.pathname+target.search);
  });
}
installSourceRouter();
function installSportsDialogA11y(){
  if(window.__sportsDialogA11y)return;
  window.__sportsDialogA11y=true;
  window.__openSportsDialog=(dialog,opener)=>{
    dialog.__returnFocus=opener||document.activeElement;
    dialog.classList.add("open");
    const target=dialog.querySelector("[data-dialog-autofocus],button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]")||dialog;
    requestAnimationFrame(()=>target.focus({preventScroll:true}));
  };
  window.__closeSportsDialog=dialog=>{
    dialog.classList.remove("open");
    const target=dialog.__returnFocus;
    if(target&&target.isConnected)target.focus({preventScroll:true});
  };
  document.addEventListener("keydown",event=>{
    const dialog=[...document.querySelectorAll('[role="dialog"].open')].at(-1);if(!dialog)return;
    if(event.key==="Escape"){event.preventDefault();window.__closeSportsDialog(dialog);return;}
    if(event.key!=="Tab")return;
    const items=[...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(item=>item.getClientRects().length);
    if(!items.length){event.preventDefault();dialog.focus();return;}
    const first=items[0],last=items[items.length-1];
    if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
  });
}
installSportsDialogA11y();

const crown$=id=>document.getElementById(id);
const crownEmbedded=new URLSearchParams(window.location.search).get("embed")==="1";
const crownCollapsedGroups=new Set();
let crownSelectedId="";
let crownLatestState={events:[],leagues:[],status:"检查中"};
let crownRenderedSignature="";
let crownRenderedAccountsSignature=null;
let crownUpdateInFlight=false;
let crownRefreshPaused=false;
let crownLastAccountsFetchAt=0;
const crownExtraAttempts=new Map();
const crownExtraLoading=new Set();

function crownPostEmbeddedState(){
  if(!crownEmbedded||window.parent===window)return;
  window.parent.postMessage({type:"crown:state",paused:crownRefreshPaused,status:crownLatestState.status||"检查中",cached:Boolean(crownLatestState.cached),error:crownLatestState.error||null,eventCount:Array.isArray(crownLatestState.events)?crownLatestState.events.length:0,updatedAt:crownLatestState.updated_at||null},window.location.origin);
}
function crownSetPaused(paused){
  crownRefreshPaused=Boolean(paused);
  const button=crown$("pauseRefresh");
  if(button){button.setAttribute("aria-pressed",String(crownRefreshPaused));const label=button.querySelector("span");if(label)label.textContent=crownRefreshPaused?"继续刷新":"暂停刷新";}
  const pollState=crown$("crownPollState");if(pollState)pollState.textContent=crownRefreshPaused?"轮询已暂停":"轮询运行中";
  crownPostEmbeddedState();
}

function crownEsc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function crownLive(event){return !!event.is_live;}
function crownFormatMatchPhase(period,minute,fallback){
  const rawPeriod=String(period??"").trim();
  const rawMinute=String(minute??"").trim();
  const labels={"1H":"上半场","1ST":"上半场","1":"上半场","2H":"下半场","2ND":"下半场","2":"下半场","HT":"中场","HALF_TIME":"中场","HALFTIME":"中场","FT":"已结束","FINISHED":"已结束","FINAL":"已结束","ET":"加时赛","EXTRA_TIME":"加时赛","EXTRATIME":"加时赛","P":"点球","PEN":"点球","PENALTIES":"点球","LIVE":"进行中"};
  const embedded=rawMinute.match(/^([A-Za-z0-9]+)\s*\^\s*(.+)$/);
  if(embedded){const embeddedLabel=labels[String(embedded[1]).toUpperCase()];if(embeddedLabel)return `${embeddedLabel} ${embedded[2].trim()}${["FT","FINISHED","FINAL"].includes(rawPeriod.toUpperCase())?" · 已结束":""}`;}
  const label=labels[rawPeriod.toUpperCase()];
  if(label&&["上半场","下半场","加时赛","进行中"].includes(label)&&rawMinute)return `${label} ${rawMinute}`;
  return label||rawMinute||fallback||"开赛时间未知";
}
function crownNormalizeLine(value){return String(value??"").trim().replace(/\s+/g,"").replace(/[–—−]/g,"-");}
function crownHandicapLine(line,side){
  const text=crownNormalizeLine(line);if(!text)return "盘口未知";
  if(text==="0"||text==="0.0")return "0";
  if(text.startsWith("-"))return side==="home"?text:`+${text.slice(1)}`;
  if(text.startsWith("+"))return side==="home"?text:`-${text.slice(1)}`;
  return side==="home"?`-${text}`:`+${text}`;
}
function crownTimeLabel(value){
  if(!value)return "—";
  const date=new Date(String(value).replace(" ","T"));
  if(Number.isNaN(date.getTime()))return String(value);
  return new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(date);
}
function crownStatusKind(state){
  const status=String(state.status||"");
  if(status==="已连接"&&!state.error)return "live";
  if(/需要重新登录|过期|未连接/.test(status))return "offline";
  if(status==="数据延迟"||status==="缓存数据"||state.cached)return "delayed";
  if(state.error||/不可用|失败/.test(status))return "offline";
  return "loading";
}
function crownLoadedExtra(event){const extra=event&&event.extra_markets;return extra&&extra.status==="loaded"?extra:null;}
function crownMarketItems(event,kind){
  const base=event&&event.markets&&Array.isArray(event.markets[kind])?event.markets[kind]:[];
  const extra=crownLoadedExtra(event);
  const items=extra&&Array.isArray(extra[kind])?extra[kind]:[];
  return items.length?items:base;
}
function crownMoneylineValues(event){
  const extra=crownLoadedExtra(event);
  if(extra&&Array.isArray(extra.moneyline)&&extra.moneyline.length){
    const values=[];
    extra.moneyline.forEach(item=>{
      if(item&&typeof item==="object"){
        if("home" in item||"draw" in item||"away" in item)values.push(item.home,item.draw,item.away);
        else values.push(item.a,item.b);
      }else values.push(item);
    });
    if(values.filter(value=>value!==undefined&&value!==null&&String(value)!=="").length>=3)return values.slice(0,3);
  }
  return Array.isArray(event&&event.markets&&event.markets.moneyline)?event.markets.moneyline:[];
}
function crownQuoteCount(event){
  return crownMarketItems(event,"handicap").length+crownMarketItems(event,"total").length+(crownMoneylineValues(event).length>=3?1:0);
}
function crownMarketStatusText(event,kind,count){
  const extra=event&&event.extra_markets;
  if(extra&&extra.status==="loaded"){
    const baseCount=event&&event.markets&&Array.isArray(event.markets[kind])?event.markets[kind].length:0;
    if(kind==="moneyline"&&Array.isArray(extra.moneyline)&&extra.moneyline.length)return "主盘 + 附加盘";
    if(kind!=="moneyline"&&count>baseCount)return `主盘 + ${count-baseCount} 组附加盘`;
    return `${count} 组盘口`;
  }
  if(extra&&extra.status==="unavailable")return `${count} 组盘口 · 附加盘暂不可用`;
  if(extra&&extra.status==="not_requested")return `${count} 组盘口 · 附加盘加载中`;
  return `${count} 组盘口`;
}
function crownGroupLabel(event){
  if(crownLive(event))return crownFormatMatchPhase(event.period,event.minute,event.start_label);
  return event.start_label||"开赛时间未知";
}
function crownMarketId(item){return item&&(item.gidm||item.market_id||item.gid||item.hgid)||"";}
function crownFilterEvents(events,query,filter){
  return events.filter(event=>{
    if(filter==="live"&&!crownLive(event))return false;
    if(filter==="prematch"&&crownLive(event))return false;
    return !query||[event.league,event.home,event.away,event.id].join(" ").toLowerCase().includes(query);
  });
}
function crownEventItem(event){
  const quoteCount=crownQuoteCount(event);
  const score=event.score||"VS";
  return `<button class="event-item${event.id===crownSelectedId?" selected":""}" type="button" data-event-id="${crownEsc(event.id)}" aria-pressed="${event.id===crownSelectedId}">
    <span class="event-item-main">
      <span class="event-item-top">${crownLive(event)?'<i class="event-live-dot" aria-hidden="true"></i>':""}<span class="event-time">${crownEsc(crownGroupLabel(event))}</span></span>
      <span class="event-team-line"><span>${crownEsc(event.home||"主队")}</span><strong>${crownEsc((score.split("-")[0]||"").trim())}</strong></span>
      <span class="event-team-line"><span>${crownEsc(event.away||"客队")}</span><strong>${crownEsc((score.split("-")[1]||"").trim())}</strong></span>
      <span class="event-item-foot"><span>${crownEsc(event.league||"未命名联赛")}</span><span>${quoteCount} 组报价</span></span>
    </span>
    <span class="event-item-side"><strong>${crownLive(event)?"LIVE":"TODAY"}</strong><span>#${crownEsc(event.id||"—")}</span></span>
  </button>`;
}
function crownEventGroup(key,title,items){
  if(!items.length)return "";
  const leagues=new Map();
  items.forEach(event=>{if(!leagues.has(event.league))leagues.set(event.league,[]);leagues.get(event.league).push(event);});
  const collapsed=crownCollapsedGroups.has(key);
  const leagueHtml=[...leagues.entries()].map(([name,events])=>`<div class="league-label"><strong>${crownEsc(name)}</strong><span>${events.length} 场</span></div>${events.map(crownEventItem).join("")}`).join("");
  return `<section class="event-group ${key}${collapsed?" collapsed":""}"><button class="event-group-head" type="button" data-group-toggle="${key}" aria-expanded="${!collapsed}"><span class="event-group-title">${title}</span><span class="event-group-count">${items.length} 场</span><span class="event-group-toggle" aria-hidden="true">⌄</span></button><div class="league-list">${leagueHtml}</div></section>`;
}
function crownMarketBook(title,items,kind,event){
  const list=Array.isArray(items)?items:[];
  const statusText=crownMarketStatusText(event,kind,list.length);
  if(!list.length)return `<article class="market-book"><header class="market-book-head"><h3>${title}</h3><small>${crownEsc(statusText)}</small></header><div class="market-empty">当前没有有效盘口</div></article>`;
  const rows=list.map(item=>{
    const line=item.raw_line||item.line||"盘口未知";
    const pair=kind==="handicap"
      ? [[`${event.home||"主队"} ${crownHandicapLine(line,"home")}`,item.a],[`${event.away||"客队"} ${crownHandicapLine(line,"away")}`,item.b]]
      : [[`大 ${crownNormalizeLine(line)}`,item.a],[`小 ${crownNormalizeLine(line)}`,item.b]];
    const marketId=crownMarketId(item);
    return `<div class="market-line">${pair.map(([label,price])=>`<div class="selection"><span>${crownEsc(label)}</span><strong>${crownEsc(price||"—")}</strong></div>`).join("")}</div>${marketId?`<div class="market-note">${item.master==="Y"||!item.gidm?"主盘":"附加盘"} · CROWN ${crownEsc(marketId)}</div>`:""}`;
  }).join("");
  return `<article class="market-book"><header class="market-book-head"><h3>${title}</h3><small>${crownEsc(statusText)}</small></header>${rows}</article>`;
}
function crownMoneyline(event){
  const values=crownMoneylineValues(event);
  const statusText=crownMarketStatusText(event,"moneyline",values.length>=3?1:0);
  if(values.length<3)return `<article class="market-book moneyline"><header class="market-book-head"><h3>全场胜平负</h3><small>${crownEsc(statusText)}</small></header><div class="market-empty">当前没有有效报价</div></article>`;
  const labels=[event.home||"主队","和局",event.away||"客队"];
  return `<article class="market-book moneyline"><header class="market-book-head"><h3>全场胜平负</h3><small>${crownEsc(statusText)}</small></header><div class="moneyline-grid">${labels.map((label,index)=>`<div class="moneyline-cell"><span>${crownEsc(label)}</span><strong>${crownEsc(values[index]||"—")}</strong></div>`).join("")}</div></article>`;
}
function crownEventDetail(event){
  if(!event)return `<div class="detail-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg><strong>等待皇冠赛事数据</strong><p>打开皇冠登录并完成会话验证后，赛事和盘口会自动显示在这里。</p><button class="button primary" type="button" data-open-login>连接皇冠会话</button></div>`;
  const markets=event.markets||{};
  const handicapItems=crownMarketItems(event,"handicap");
  const totalItems=crownMarketItems(event,"total");
  const score=event.score||"VS";
  const detail=crownFormatMatchPhase(event.period,event.minute,event.start_label);
  return `<article class="event-hero"><div class="event-hero-top"><div class="event-league"><span>${crownEsc(event.league||"未命名联赛")}</span></div><div class="event-hero-meta"><span class="meta-pill ${crownLive(event)?"live":""}">${crownLive(event)?"滚球":"今日待开"}</span><span class="meta-pill">${crownEsc(event.start_label||"时间未知")}</span><span class="meta-pill">皇冠 ID ${crownEsc(event.id||"—")}</span></div></div><div class="match-hero"><div class="match-team">${crownEsc(event.home||"主队")}</div><div class="match-score"><strong>${crownEsc(score)}</strong><span>${crownEsc(detail)}</span></div><div class="match-team away">${crownEsc(event.away||"客队")}</div></div></article><div class="detail-summary-row"><div><span>报价组数</span><strong>${crownQuoteCount(event)} 组</strong></div><div><span>盘口格式</span><strong>${crownEsc(event.odds_format_label||"皇冠港赔（HK）")}</strong></div><div><span>数据来源</span><strong>当前项目</strong></div></div><div class="markets-layout">${crownMoneyline(event)}${crownMarketBook("让球",handicapItems,"handicap",event)}${crownMarketBook("大小球",totalItems,"total",event)}</div>`;
}
function crownRender(state){
  crownLatestState=state;
  const events=Array.isArray(state.events)?state.events:[];
  const query=crown$("crownSearch").value.trim().toLowerCase();
  const filter=crown$("crownFilter").value;
  const visible=crownFilterEvents(events,query,filter);
  if(!visible.some(event=>event.id===crownSelectedId))crownSelectedId=visible[0]?.id||"";
  const selected=visible.find(event=>event.id===crownSelectedId)||null;
  if(selected)crownLoadExtra(selected);
  const liveCount=events.filter(crownLive).length;
  const todayCount=events.length-liveCount;
  const leagueCount=Array.isArray(state.leagues)?state.leagues.length:new Set(events.map(event=>event.league)).size;
  const quoteCount=events.reduce((total,event)=>total+crownQuoteCount(event),0);
  const kind=crownStatusKind(state);
  const status=state.status||"检查中";
  crown$("crownCount").textContent=events.length;
  crown$("crownLiveCount").textContent=`滚球 ${liveCount}`;
  crown$("crownTodayCount").textContent=`今日 ${todayCount}`;
  crown$("crownLeagueCount").textContent=leagueCount;
  crown$("crownVisibleCount").textContent=`显示 ${visible.length}`;
  crown$("crownVisibleBadge").textContent=visible.length;
  crown$("crownStatus").textContent=status;
  crown$("crownDataState").textContent=kind==="live"?"实时更新":state.cached?"缓存数据":kind==="delayed"?"数据延迟":kind==="offline"?"连接异常":"等待数据";
  crown$("crownStateBadge").textContent=kind==="live"?"在线":state.cached?"缓存":kind==="delayed"?"延迟":kind==="offline"?"异常":"检查中";
  crown$("crownStateBadge").className=`micro-badge ${kind==="live"?"live":kind==="offline"?"stale":"delayed"}`;
  crown$("crownConnectionPill").className=`status-pill ${kind==="live"?"live":kind==="offline"?"offline":kind==="delayed"?"delayed":"loading"}`;
  crown$("crownConnectionText").textContent=kind==="live"?"皇冠数据在线":state.cached?"展示最近成功缓存":kind==="delayed"?"上游延迟，保留最近数据":kind==="offline"?(state.error?"数据连接异常":"等待登录"):"正在连接";
  crown$("crownUpdatedAt").textContent=crownTimeLabel(state.updated_at);
  crown$("crownSubStatus").textContent=state.updated_at?`${state.cached?"缓存数据 · 上次更新":"最后更新"} ${crownTimeLabel(state.updated_at)} · 只读轮询`:"等待皇冠会话数据";
  crown$("crownQuoteTotal").textContent=`${quoteCount} 组报价`;
  const errorText={session_conflict:"皇冠提示重复登录。请先在皇冠站点退出其他设备上的会话，再打开登录面板重新登录。",session_expired:"皇冠会话已过期，请打开登录面板重新登录。",session_unverified:"皇冠会话需要重新验证，请打开登录面板完成验证。",upstream_unavailable:"皇冠上游暂时不可用，页面会保留最近数据并自动重试。",upstream_timeout:"皇冠上游响应超时，页面会保留最近数据并按退避间隔重试。",upstream_connection_failed:"无法连接皇冠上游，请检查网络和登录地址。",upstream_http_error:"皇冠上游返回异常状态，页面会自动退避重试。",upstream_response_invalid:"皇冠上游响应格式异常，页面会自动重试。",catalog_incomplete:"皇冠赛事目录暂未完整返回，页面会保留最近数据并重试。",catalog_changed:"皇冠赛事目录发生变化，等待下一次完整同步。"}[state.error]||"皇冠数据暂时不可用，请检查登录会话或稍后重试。";
  crown$("crownErrorText").textContent=state.cached&&state.updated_at?`${errorText} 当前展示 ${crownTimeLabel(state.updated_at)} 的最后成功缓存。`:errorText;
  crown$("crownError").classList.toggle("hidden",kind!=="offline"&&kind!=="delayed");
  const signature=JSON.stringify([visible,state.leagues||[],state.status,state.error,state.cached,state.updated_at,query,filter,selected?.id||"",[...crownCollapsedGroups].sort()]);
  if(signature===crownRenderedSignature)return;
  crownRenderedSignature=signature;
  const live=visible.filter(crownLive);
  const prematch=visible.filter(event=>!crownLive(event));
  const groupHtml=`${crownEventGroup("live","滚球比赛",live)}${crownEventGroup("prematch","今日比赛",prematch)}`;
  crown$("crownEvents").innerHTML=groupHtml||`<div class="event-list-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg><strong>暂无皇冠赛事</strong><p>${query?"没有匹配当前搜索条件的赛事。":"完成皇冠登录后，滚球和今日赛事会自动出现在这里。"}</p>${!query?'<button class="button primary" type="button" data-open-login>连接皇冠会话</button>':""}</div>`;
  crown$("crownEventDetail").innerHTML=crownEventDetail(selected);
}
async function crownLoadExtra(event){
  const gid=String(event&&event.id||"");
  const status=String(event&&event.extra_markets&&event.extra_markets.status||"");
  if(!gid||status==="loaded"||crownExtraLoading.has(gid))return;
  const lastAttempt=Number(crownExtraAttempts.get(gid)||0);
  if(Date.now()-lastAttempt<15000)return;
  crownExtraAttempts.set(gid,Date.now());
  crownExtraLoading.add(gid);
  try{
    const response=await fetch(`/api/crown/events/${encodeURIComponent(gid)}/details`,{method:"POST",cache:"no-store"});
    if(response.ok){crownRenderedSignature="";await crownUpdate(false);}
  }catch(error){
    // The regular polling loop retries after the cooldown.
  }finally{
    crownExtraLoading.delete(gid);
  }
}
function crownSessionView(state){
  const connected=state.status==="已连接";
  const delayed=state.status==="数据延迟"||state.status==="缓存数据"||state.cached;
  crown$("loginIndicator").className=`login-status-indicator ${connected?"connected":state.error?"error":""}`;
  crown$("loginStatusTitle").textContent=connected?"皇冠会话已连接":`皇冠会话${state.status?" · "+state.status:""}`;
  crown$("loginStatusCopy").textContent=connected?`只读赛事接口正常，最近更新：${state.updated_at||"刚刚"}`:delayed?`当前展示上次成功缓存，服务会自动恢复实时连接。最近更新：${state.updated_at||"未知"}`:"请在下面添加账号并完成本项目自己的皇冠登录。";
}
function crownAccountStatus(account){
  const labels={idle:"未登录",logging_in:"登录中",checking:"检查中",awaiting_otp:"等待动态码",awaiting_manual:"等待浏览器操作",session_received:"已保存会话",authenticated:"已验证",expired:"会话已过期",disabled:"已停用"};
  return labels[account.status]||account.status||"未知";
}
function crownRenderAccounts(accounts){
  const root=crown$("crownAccounts");
  if(!accounts.length){root.innerHTML='<div class="account-empty">当前项目还没有添加皇冠账号。</div>';return;}
  root.innerHTML=accounts.map(account=>{
    const session=account.has_session?"已保存会话":"未保存会话";
    const checked=account.last_checked?` · 最后检查 ${crownEsc(account.last_checked)}`:"";
    const otp=account.status==="awaiting_otp"?`<form class="otp-form" data-otp-account="${crownEsc(account.id)}"><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="动态验证码" required><button class="action-button primary" type="submit">提交验证码</button></form>`:"";
    return `<div class="account-row" data-account-id="${crownEsc(account.id)}"><div class="account-row-head"><div><div class="account-row-name">${crownEsc(account.username)}</div><div class="account-row-meta">${crownEsc(account.base_url)} · ${session}${checked}</div></div><div class="account-row-status">${crownEsc(crownAccountStatus(account))}</div></div>${otp}<div class="account-row-actions"><button class="action-button" data-account-action="login">登录</button><button class="action-button" data-account-action="check">检查会话</button><button class="action-button" data-account-action="relogin">重新登录</button><button class="action-button" data-account-action="cancel">取消</button><button class="action-button" data-account-action="clear">清除会话</button><button class="action-button" data-account-action="delete">删除</button></div></div>`;
  }).join("");
}
async function crownUpdate(forceAccounts=false){
  if(crownUpdateInFlight)return;
  crownUpdateInFlight=true;
  try{
    const loginDialogOpen=crown$("loginModal").classList.contains("open");
    const accountPollInterval=loginDialogOpen?4000:15000;
    const includeAccounts=forceAccounts||Date.now()-crownLastAccountsFetchAt>=accountPollInterval;
    const accountPromise=includeAccounts?fetch("/api/crown/accounts",{cache:"no-store"}).catch(()=>null):null;
    const eventResponse=await fetch("/api/crown/events?compact=1",{cache:"no-store"});
    if(!eventResponse.ok)throw new Error("HTTP error");
    const data=await eventResponse.json();
    crownRender(data);crownSessionView(data);
    if(accountPromise){
      const accountResponse=await accountPromise;
      crownLastAccountsFetchAt=Date.now();
      if(accountResponse&&accountResponse.ok){
        const accounts=await accountResponse.json();
        const accountList=Array.isArray(accounts.accounts)?accounts.accounts:[];
        const accountSignature=JSON.stringify(accountList);
        if(accountSignature!==crownRenderedAccountsSignature){crownRenderedAccountsSignature=accountSignature;crownRenderAccounts(accountList);}
      }
    }
  }catch(error){
    crown$("crownStatus").textContent="读取失败";
    crown$("crownConnectionPill").className="status-pill offline";
    crown$("crownConnectionText").textContent="页面连接失败";
    crown$("crownStateBadge").textContent="失败";
    crown$("crownStateBadge").className="micro-badge stale";
    crown$("crownErrorText").textContent="无法读取皇冠接口，请确认当前项目服务和后端仍然正常运行。";
    crown$("crownError").classList.remove("hidden");
  }finally{crownUpdateInFlight=false;}
}
async function crownCheck(){
  const button=crown$("checkCrownSession");button.disabled=true;button.textContent="检查中…";
  try{await fetch("/api/crown/session/check",{method:"POST",headers:{"Content-Type":"application/json"}});}finally{button.disabled=false;button.textContent="检查全部会话";await crownUpdate(true);}
}
async function crownAccountAction(id,action){
  const row=document.querySelector(`[data-account-id="${CSS.escape(id)}"]`);
  const button=row&&row.querySelector(`[data-account-action="${action}"]`);
  if(button){button.disabled=true;button.textContent="处理中…";}
  try{
    const response=await fetch(`/api/crown/accounts/${encodeURIComponent(id)}/${action}`,{method:"POST",headers:{"Content-Type":"application/json"}});
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||"操作失败");
  }catch(error){window.alert(error.message||"操作失败");}
  await crownUpdate(true);
}
function settingsOpen(){window.__openSportsDialog(crown$("settingsModal"),crown$("settingsButton"));}
function settingsClose(){window.__closeSportsDialog(crown$("settingsModal"));}
function loginOpen(){window.__openSportsDialog(crown$("loginModal"),crown$("joinSessionButton"));crownUpdate(true);}
crown$("crownAccountForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const status=crown$("crownAccountFormStatus");
  const button=event.currentTarget.querySelector("button[type=submit]");
  button.disabled=true;status.textContent="正在保存并启动登录…";
  const payload={login_url:crown$("crownLoginUrl").value.trim(),username:crown$("crownUsername").value.trim(),password:crown$("crownPassword").value,totp_secret:crown$("crownTotp").value.trim()};
  try{
    const response=await fetch("/api/crown/accounts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||"添加账号失败");
    crown$("crownPassword").value="";crown$("crownTotp").value="";status.textContent="账号已保存，登录任务已启动。";
    await crownUpdate(true);
  }catch(error){status.textContent=error.message||"添加账号失败";}
  finally{button.disabled=false;}
});
crown$("settingsButton").addEventListener("click",settingsOpen);
crown$("settingsClose").addEventListener("click",settingsClose);
crown$("settingsModal").addEventListener("click",event=>{if(event.target===crown$("settingsModal"))settingsClose();});
crown$("crownLoginButton").addEventListener("click",()=>{settingsClose();loginOpen();});
crown$("joinSessionButton").addEventListener("click",loginOpen);
crown$("closeLogin").addEventListener("click",()=>window.__closeSportsDialog(crown$("loginModal")));
crown$("loginModal").addEventListener("click",event=>{if(event.target===crown$("loginModal"))window.__closeSportsDialog(crown$("loginModal"));});
crown$("crownEvents").addEventListener("click",event=>{
  const loginButton=event.target.closest("[data-open-login]");if(loginButton){loginOpen();return;}
  const groupButton=event.target.closest("[data-group-toggle]");if(groupButton){const key=groupButton.dataset.groupToggle;if(crownCollapsedGroups.has(key))crownCollapsedGroups.delete(key);else crownCollapsedGroups.add(key);crownRender(crownLatestState);return;}
  const item=event.target.closest("[data-event-id]");if(!item)return;crownSelectedId=item.dataset.eventId;crownRender(crownLatestState);
});
crown$("crownEventDetail").addEventListener("click",event=>{if(event.target.closest("[data-open-login]"))loginOpen();});
crown$("checkCrownSession").addEventListener("click",crownCheck);
crown$("crownAccounts").addEventListener("click",event=>{const button=event.target.closest("[data-account-action]");if(!button)return;const row=button.closest("[data-account-id]");if(!row)return;const action=button.dataset.accountAction;if(action==="delete"&&!window.confirm("确认删除这个账号及其本地会话吗？"))return;crownAccountAction(row.dataset.accountId,action);});
crown$("crownAccounts").addEventListener("submit",async event=>{
  const form=event.target.closest("[data-otp-account]");if(!form)return;event.preventDefault();
  const button=form.querySelector("button[type=submit]");button.disabled=true;
  try{const response=await fetch(`/api/crown/accounts/${encodeURIComponent(form.dataset.otpAccount)}/otp`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:new FormData(form).get("code")})});const result=await response.json();if(!response.ok)throw new Error(result.error||"验证码提交失败");await crownUpdate(true);}catch(error){window.alert(error.message||"验证码提交失败");button.disabled=false;}
});
crown$("crownSearch").addEventListener("input",()=>crownRender(crownLatestState));
crown$("crownFilter").addEventListener("change",()=>crownRender(crownLatestState));
crown$("refreshButton").addEventListener("click",()=>crownUpdate(true));
crown$("pauseRefresh").addEventListener("click",()=>crownSetPaused(!crownRefreshPaused));
if(crownEmbedded){
  window.addEventListener("message",event=>{
    if(event.origin!==window.location.origin||event.source!==window.parent)return;
    const data=event.data||{};if(data.type!=="crown:command")return;
    if(data.command==="refresh")crownUpdate(true);
    else if(data.command==="set-paused")crownSetPaused(Boolean(data.paused));
  });
  crownPostEmbeddedState();
}
if(new URLSearchParams(window.location.search).get("openSettings")==="1")settingsOpen();
crownUpdate();
setInterval(()=>{if(!crownRefreshPaused)crownUpdate();},3000);
</script>
</body>
</html>

"""


def render_crown_html(*, embedded=False):
    if not embedded:
        return CROWN_HTML
    return CROWN_HTML.replace("<body>", '<body class="crown-embedded">', 1)


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("请求格式不正确") from None
        if length < 0 or length > 128 * 1024:
            raise ValueError("请求体过大")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("请求格式不正确") from None
        if not isinstance(payload, dict):
            raise ValueError("请求必须是 JSON 对象")
        return payload

    def _crown_state(self, compact=False):
        return _snapshot_crown(compact=compact)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path == "/api/crown/events":
            compact = str((query.get("compact") or ["0"])[0]).lower() in {"1", "true", "yes"}
            self._send_json(self._crown_state(compact=compact))
            return
        if path == "/api/crown/accounts":
            try:
                self._send_json({"accounts": public_accounts()})
            except Exception:
                self._send_json({"error": "账号存储暂不可用"}, status=500)
            return
        if path == "/api/crown/session":
            payload = self._crown_state()
            payload.pop("events", None)
            payload.pop("leagues", None)
            self._send_json(payload)
            return
        if path == "/crown":
            embedded = str((query.get("embed") or ["0"])[0]).lower() in {"1", "true", "yes"}
            body = render_crown_html(embedded=embedded).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/crown")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/crown/session/check":
            refresh_once()
            payload = self._crown_state()
            payload.pop("events", None)
            payload.pop("leagues", None)
            self._send_json(payload)
            return
        parts = [part for part in path.split("/") if part]
        if len(parts) == 5 and parts[:3] == ["api", "crown", "events"] and parts[4] == "details":
            try:
                result = refresh_event_more(parts[3])
            except KeyError as exc:
                self._send_json({"error": str(exc)}, status=404)
                return
            except Exception:
                self._send_json({"error": "附加盘加载失败"}, status=500)
                return
            status = 200 if result.get("status") == "loaded" else 202 if result.get("status") == "loading" else 502
            self._send_json(result, status=status)
            return
        if path == "/api/crown/accounts":
            try:
                payload = self._read_json()
                required = ("login_url", "username", "password")
                if any(not isinstance(payload.get(key), str) or not payload.get(key, "").strip() for key in required):
                    raise ValueError("登录地址、账号和密码不能为空")
                account = add_account(
                    payload["login_url"], payload["username"], payload["password"],
                    payload.get("totp_secret", "") if isinstance(payload.get("totp_secret", ""), str) else "",
                )
                account = account_action(account["id"], "login") or account
                self._send_json({"account": account}, status=201)
            except ValueError as exc:
                self._send_json({"error": str(exc)}, status=400)
            except Exception:
                self._send_json({"error": "账号保存失败"}, status=500)
            return
        parts = [part for part in path.split("/") if part]
        if len(parts) == 5 and parts[:3] == ["api", "crown", "accounts"]:
            account_id, action = parts[3], parts[4]
            if action == "otp":
                try:
                    payload = self._read_json()
                    code = payload.get("code")
                    if not isinstance(code, str):
                        raise ValueError("动态验证码格式不正确")
                    account = submit_otp(account_id, code)
                    self._send_json({"account": account, "accounts": public_accounts()})
                except (KeyError, ValueError) as exc:
                    self._send_json({"error": str(exc)}, status=400)
                except Exception:
                    self._send_json({"error": "验证码提交失败"}, status=500)
                return
            if action not in {"login", "check", "relogin", "cancel", "clear", "delete"}:
                self._send_json({"error": "不支持的账号操作"}, status=404)
                return
            try:
                account = account_action(account_id, action)
                self._send_json({"account": account, "accounts": public_accounts()})
            except (KeyError, ValueError) as exc:
                self._send_json({"error": str(exc)}, status=400)
            except Exception:
                self._send_json({"error": "账号操作失败"}, status=500)
            return
        self.send_error(404)

    def do_DELETE(self):
        path = self.path.split("?", 1)[0]
        parts = [part for part in path.split("/") if part]
        if len(parts) == 4 and parts[:3] == ["api", "crown", "accounts"]:
            try:
                account = account_action(parts[3], "delete")
                self._send_json({"account": account, "accounts": public_accounts()})
            except (KeyError, ValueError) as exc:
                self._send_json({"error": str(exc)}, status=400)
            except Exception:
                self._send_json({"error": "删除账号失败"}, status=500)
            return
        self.send_error(404)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

if __name__ == "__main__":
    initialize_crown()
    threading.Thread(target=crown_refresh_loop, daemon=True).start()
    print("皇冠赛事网页已启动")
    print("本机访问：http://127.0.0.1:8887")
    print("停止服务：按 Control + C")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
