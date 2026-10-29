import tempfile
import unittest
from pathlib import Path

from fixture_merge import (
    FixtureMergeStore,
    MappingConflict,
    normalize_name,
    prepare_crown_event,
    prepare_pinnacle_event,
    rank_candidates,
    rank_league_candidates,
)


def pinnacle_event(
    event_id="p-100",
    home="十月九",
    away="昆卡青年队",
    league="厄瓜多尔 - 乙级联赛",
    league_id="197248",
    kickoff="2026-10-29 03:00:00",
    live=True,
):
    return {
        "id": event_id,
        "name": f"{home} VS {away}",
        "league": league,
        "sportId": "29",
        "leagueId": league_id,
        "kickoff": kickoff,
        "isLive": live,
    }


def crown_event(
    event_id="c-200",
    home="十月九",
    away="库恩卡青年",
    league="厄瓜多尔乙组联赛-附加赛",
    league_id="108994",
    start="10-28 03:00p",
    live=True,
):
    return {
        "id": event_id,
        "home": home,
        "away": away,
        "league": league,
        "leagueId": league_id,
        "startLabel": start,
        "isLive": live,
    }


class CandidateRankingTests(unittest.TestCase):
    def test_normalization_handles_accents_punctuation_and_club_suffixes(self):
        self.assertEqual(normalize_name(" Atlético FC."), "atletico")
        self.assertEqual(normalize_name("十月九足球俱乐部"), "十月九足球俱乐部")

    def test_candidate_uses_team_and_context_not_equal_provider_ids(self):
        results = rank_candidates(
            [pinnacle_event(event_id="p-100")],
            [crown_event(event_id="c-200")],
        )

        self.assertEqual(len(results["p-100"]), 1)
        candidate = results["p-100"][0]
        self.assertEqual(candidate["crownId"], "c-200")
        self.assertGreater(candidate["score"], 65)
        self.assertIn("球队名称较相似", candidate["reasons"])

    def test_equal_raw_ids_do_not_match_unrelated_fixtures(self):
        results = rank_candidates(
            [pinnacle_event(event_id="same-id", home="阿森纳", away="切尔西", league="英超")],
            [crown_event(event_id="same-id", home="巴塞罗那", away="皇家马德里", league="西甲")],
        )

        self.assertEqual(results["same-id"], [])

    def test_reversed_home_and_away_is_reported_for_review(self):
        results = rank_candidates(
            [pinnacle_event(home="阿森纳", away="切尔西", league="英超")],
            [crown_event(home="切尔西", away="阿森纳", league="Premier League")],
        )

        candidate = results["p-100"][0]
        self.assertTrue(candidate["reversedOrder"])
        self.assertIn("球队名称较接近，但主客顺序相反", candidate["reasons"])
        self.assertNotEqual(candidate["confidence"], "high")

    def test_crown_24_hour_start_label_is_normalized_to_the_same_timezone(self):
        results = rank_candidates(
            [pinnacle_event(kickoff="2026-10-28T20:10:00+08:00")],
            [crown_event(start="10-28 08:10")],
        )

        self.assertIn("开赛日期相同", results["p-100"][0]["reasons"])
        self.assertIn("统一时区后开赛时间吻合", results["p-100"][0]["reasons"])
        self.assertEqual(results["p-100"][0]["kickoffDeltaMinutes"], 0.0)

    def test_timezone_normalization_increases_time_evidence_score(self):
        exact = rank_candidates(
            [pinnacle_event(kickoff="2026-10-29 03:00:00")],
            [crown_event(start="10-28 03:00p")],
        )["p-100"][0]
        far = rank_candidates(
            [pinnacle_event(kickoff="2026-10-29 03:00:00")],
            [crown_event(start="10-28 09:00a")],
        )["p-100"][0]

        self.assertEqual(exact["kickoffDeltaMinutes"], 0.0)
        self.assertGreater(exact["score"], far["score"])

    def test_duplicate_candidates_are_both_returned_for_manual_disambiguation(self):
        results = rank_candidates(
            [pinnacle_event(home="阿森纳", away="切尔西", league="英超")],
            [
                crown_event(event_id="c-200", home="阿森纳", away="切尔西", league="英超"),
                crown_event(event_id="c-201", home="阿森纳", away="切尔西", league="英超"),
            ],
        )

        self.assertEqual([item["crownId"] for item in results["p-100"]], ["c-200", "c-201"])
        self.assertEqual(results["p-100"][0]["score"], results["p-100"][1]["score"])

    def test_prepare_functions_keep_source_ids_and_split_names(self):
        p = prepare_pinnacle_event(pinnacle_event())
        c = prepare_crown_event(crown_event())

        self.assertEqual((p["home"], p["away"]), ("十月九", "昆卡青年队"))
        self.assertEqual((p["id"], p["leagueId"]), ("p-100", "197248"))
        self.assertEqual((c["id"], c["leagueId"]), ("c-200", "108994"))
        self.assertEqual(p["normalizedKickoff"], "2026-10-29 03:00:00")
        self.assertEqual(c["normalizedKickoff"], "2026-10-29 03:00:00")

    def test_league_candidates_use_group_fixture_evidence(self):
        pinnacle = [
            pinnacle_event(
                event_id="p-1", home="阿森纳", away="切尔西",
                league="英格兰超级联赛", league_id="p-league-1",
            ),
            pinnacle_event(
                event_id="p-2", home="巴塞罗那", away="皇家马德里",
                league="西班牙甲级联赛", league_id="p-league-2",
            ),
        ]
        crown = [
            crown_event(
                event_id="c-1", home="阿森纳", away="切尔西",
                league="Premier League", league_id="c-league-1",
            ),
            crown_event(
                event_id="c-2", home="Barcelona", away="Real Madrid",
                league="西班牙甲级联赛", league_id="c-league-2",
            ),
        ]

        ranked = rank_league_candidates(pinnacle, crown)

        self.assertEqual(ranked["c-league-1"][0]["pinnacleLeagueId"], "p-league-1")
        self.assertEqual(ranked["c-league-2"][0]["pinnacleLeagueId"], "p-league-2")
        self.assertIn("组内有 1 场赛事候选吻合", ranked["c-league-1"][0]["reasons"])


class FixtureMergeStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = FixtureMergeStore(Path(self.temp.name) / "merge.sqlite3")

    def map_test_league(self, pinnacle_id="197248", crown_id="108994"):
        return self.store.map_leagues(
            {"id": pinnacle_id, "name": "厄瓜多尔 - 乙级联赛", "eventCount": 1},
            {"id": crown_id, "name": "厄瓜多尔乙组联赛-附加赛", "eventCount": 1},
        )

    def test_saves_source_scoped_ids_and_snapshots(self):
        self.map_test_league()
        saved = self.store.map_events(pinnacle_event(), crown_event())

        self.assertEqual(saved["pinnacleId"], "p-100")
        self.assertEqual(saved["crownId"], "c-200")
        mapping = self.store.list_mappings()[0]
        self.assertEqual(mapping["pinnacleSnapshot"]["leagueId"], "197248")
        self.assertEqual(mapping["crownSnapshot"]["leagueId"], "108994")
        self.assertEqual(mapping["pinnacleSnapshot"]["home"], "十月九")

    def test_same_numeric_id_is_allowed_across_provider_namespaces(self):
        self.map_test_league(pinnacle_id="42", crown_id="42")
        saved = self.store.map_events(
            pinnacle_event(event_id="42", home="阿森纳", away="切尔西", league_id="42"),
            crown_event(event_id="42", home="阿森纳", away="切尔西", league_id="42"),
        )

        self.assertEqual((saved["pinnacleId"], saved["crownId"]), ("42", "42"))

    def test_mapping_is_one_to_one_and_conflicts_are_clear(self):
        self.map_test_league()
        self.store.map_events(pinnacle_event(event_id="p-100"), crown_event(event_id="c-200"))

        self.store.map_events(
            pinnacle_event(event_id="p-100"), crown_event(event_id="c-201")
        )
        with self.assertRaisesRegex(MappingConflict, "皇冠赛事已关联"):
            self.store.map_events(pinnacle_event(event_id="p-101"), crown_event(event_id="c-201"))

        self.assertEqual(len(self.store.list_mappings()), 1)
        self.assertEqual(self.store.list_mappings()[0]["crownId"], "c-201")

    def test_unmap_removes_confirmed_pair(self):
        self.map_test_league()
        self.store.map_events(pinnacle_event(), crown_event())

        self.assertTrue(self.store.unmap("p-100"))
        self.assertFalse(self.store.unmap("p-100"))
        self.assertEqual(self.store.list_mappings(), [])

    def test_event_mapping_requires_explicit_matching_league_mapping(self):
        with self.assertRaisesRegex(MappingConflict, "请先确认"):
            self.store.map_events(pinnacle_event(), crown_event())

        self.map_test_league()
        self.store.map_events(pinnacle_event(), crown_event())
        with self.assertRaisesRegex(MappingConflict, "请先确认"):
            self.store.map_events(
                pinnacle_event(league_id="other-p-league"), crown_event()
            )

    def test_league_mapping_is_one_to_one_and_preserves_namespaced_ids(self):
        saved = self.map_test_league()
        self.assertEqual((saved["pinnacleId"], saved["crownId"]), ("197248", "108994"))
        with self.assertRaisesRegex(MappingConflict, "已关联其他皇冠联赛"):
            self.store.map_leagues(
                {"id": "197248", "name": "其他联赛"},
                {"id": "crown-other", "name": "其他皇冠联赛"},
            )
        self.assertEqual(len(self.store.list_league_mappings()), 1)

    def test_league_cannot_be_unmapped_while_child_fixture_is_linked(self):
        self.map_test_league()
        self.store.map_events(pinnacle_event(), crown_event())
        with self.assertRaisesRegex(MappingConflict, "先解除赛事关联"):
            self.store.unmap_league("108994")
        self.assertEqual(len(self.store.list_league_mappings()), 1)
        self.store.unmap("p-100")
        self.assertTrue(self.store.unmap_league("108994"))
        self.assertEqual(self.store.list_league_mappings(), [])


if __name__ == "__main__":
    unittest.main()
