import json
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

from dashboard_server import DashboardHandler, OddsStore, now_iso
from fixture_merge import FixtureMergeStore, prepare_crown_event, prepare_pinnacle_event


class FixtureMergeApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.odds_store = OddsStore({
            "capture_path": str(root / "capture.jsonl"),
            "live_snapshot_file": str(root / "latest.csv"),
            "dashboard_db_path": str(root / "history.sqlite3"),
        })
        self.merge_store = FixtureMergeStore(root / "fixture_merge.sqlite3")
        self.addCleanup(self.odds_store.close)
        self.addCleanup(self.merge_store.close)

        kickoff_ms = int((datetime.now().astimezone() + timedelta(minutes=20)).timestamp() * 1000)
        odds_payload = {
            "type": "UPDATE_ODDS",
            "odds": {
                "live": False,
                "l": [[29, "Soccer", [[197248, "厄瓜多尔 - 乙级联赛", [[100, "十月九", "昆卡青年队", 0, kickoff_ms]]]]]],
                "u": [],
            },
        }
        self.odds_store.process_line(json.dumps({
            "captured_at": datetime.now().astimezone().isoformat(),
            "opcode": 1,
            "payload": json.dumps(odds_payload),
        }))

        self.old_handler_values = (
            getattr(DashboardHandler, "store", None),
            getattr(DashboardHandler, "merge_store", None),
        )
        DashboardHandler.store = self.odds_store
        DashboardHandler.merge_store = self.merge_store
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), DashboardHandler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.addCleanup(self._close_server)

    def _close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(timeout=2)
        DashboardHandler.store, DashboardHandler.merge_store = self.old_handler_values

    def _request(self, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"http://127.0.0.1:{self.server.server_port}{path}",
            data=data,
            headers={"Content-Type": "application/json"} if data else {},
        )
        opener = build_opener(ProxyHandler({}))
        try:
            with opener.open(request, timeout=3) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except HTTPError as response:
            return response.code, json.loads(response.read().decode("utf-8"))

    def test_candidate_is_suggestion_until_user_confirms_mapping(self):
        crown_events = [{
            "id": "200",
            "home": "十月九",
            "away": "库恩卡青年",
            "league": "厄瓜多尔乙组联赛-附加赛",
            "league_id": "108994",
            "start_label": datetime.now().strftime("%m-%d 01:00p"),
            "is_live": False,
        }]
        with patch.object(DashboardHandler, "_crown_fixture_events", return_value=(crown_events, None)):
            status, payload = self._request("/api/merge")
            self.assertEqual(status, 200)
            self.assertEqual(payload["mappings"], [])
            self.assertEqual(payload["pinnacleEvents"][0]["id"], "100")
            self.assertEqual(payload["pinnacleEvents"][0]["leagueId"], "197248")
            self.assertEqual(payload["crownEvents"][0]["leagueId"], "108994")
            self.assertEqual(payload["pinnacleLeagues"][0]["id"], "197248")
            self.assertEqual(payload["crownLeagues"][0]["id"], "108994")
            self.assertEqual(payload["leagueMappings"], [])
            self.assertEqual(payload["suggestions"], [])
            league_candidate = payload["leagueSuggestions"][0]
            self.assertEqual(league_candidate["pinnacleLeagueId"], "197248")
            self.assertEqual(league_candidate["crownLeagueId"], "108994")
            self.assertGreater(league_candidate["score"], 60)

            status, rejected = self._request("/api/merge/mapping", {
                "action": "map", "pinnacleId": "100", "crownId": "200",
            })
            self.assertEqual(status, 409)
            self.assertIn("请先确认", rejected["error"])

            status, league_saved = self._request("/api/merge/league-mapping", {
                "action": "map", "pinnacleLeagueId": "197248", "crownLeagueId": "108994",
            })
            self.assertEqual(status, 200)
            self.assertEqual(league_saved["leagueMappings"][0]["pinnacleId"], "197248")

            _status, payload = self._request("/api/merge")
            self.assertEqual(payload["suggestions"][0]["crownId"], "200")

            status, saved = self._request("/api/merge/mapping", {
                "action": "map", "pinnacleId": "100", "crownId": "200",
            })
            self.assertEqual(status, 200)
            self.assertEqual(saved["mappings"][0]["pinnacleId"], "100")
            self.assertEqual(saved["mappings"][0]["crownId"], "200")

            status, blocked = self._request("/api/merge/league-mapping", {
                "action": "unmap", "crownLeagueId": "108994",
            })
            self.assertEqual(status, 409)
            self.assertIn("先解除赛事关联", blocked["error"])

            status, removed = self._request("/api/merge/mapping", {
                "action": "unmap", "pinnacleId": "100",
            })
            self.assertEqual(status, 200)
            self.assertEqual(removed["mappings"], [])

            status, league_removed = self._request("/api/merge/league-mapping", {
                "action": "unmap", "crownLeagueId": "108994",
            })
            self.assertEqual(status, 200)
            self.assertEqual(league_removed["leagueMappings"], [])

    def test_confirmed_endpoint_returns_crown_display_and_pinnacle_odds(self):
        crown_event = {
            "id": "200",
            "home": "十月九",
            "away": "库恩卡青年",
            "league": "厄瓜多尔乙组联赛-附加赛",
            "league_id": "108994",
            "start_label": datetime.now().strftime("%m-%d 01:00p"),
            "is_live": False,
            "markets": {
                "handicap": [{"line": "0", "a": "0.91", "b": "0.93"}],
                "total": [],
                "moneyline": ["1.20", "3.40", "5.80"],
            },
        }
        pinnacle_event = self.odds_store.events["100"]
        self.merge_store.map_leagues(
            {"id": "197248", "name": pinnacle_event["league"], "eventCount": 1},
            {"id": "108994", "name": crown_event["league"], "eventCount": 1},
        )
        self.merge_store.map_events(
            prepare_pinnacle_event(pinnacle_event),
            prepare_crown_event(crown_event),
        )
        with self.odds_store.lock:
            self.odds_store._add_row(
                "100", "0", "1", "1", "0", "", "", now_iso(),
                1.91, 0.91, True, "new", None, None, 1,
            )
        with patch.object(DashboardHandler, "_crown_fixture_events", return_value=([crown_event], None)):
            status, payload = self._request("/api/merge/confirmed?crownId=200")
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 1)
        item = payload["items"][0]
        self.assertEqual(item["crown"]["id"], "200")
        self.assertEqual(item["crown"]["home"], "十月九")
        self.assertEqual(item["crown"]["markets"]["handicap"][0]["a"], "0.91")
        self.assertEqual(item["pinnacle"]["id"], "100")
        self.assertEqual(item["pinnacle"]["odds"][0]["hongKong"], 0.91)

        with patch.object(DashboardHandler, "_crown_fixture_events", return_value=([crown_event], None)):
            status, payload = self._request("/api/merge/confirmed?crownId=missing")
        self.assertEqual(status, 200)
        self.assertEqual(payload["items"], [])


if __name__ == "__main__":
    unittest.main()
