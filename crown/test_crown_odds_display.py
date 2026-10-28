import unittest

from crown_runtime import _normalize_event, _normalize_more_markets


class CrownOddsDisplayTests(unittest.TestCase):
    def test_crown_paired_ior_is_converted_using_both_prices(self):
        event = _normalize_event({
            "GID": "1", "TEAM_H": "主队", "TEAM_C": "客队",
            "RATIO_R": "0.5", "IOR_RH": "0.750", "IOR_RC": "1.000",
        }, "today")
        quote = event["markets"]["handicap"][0]
        self.assertEqual((quote["a_hk"], quote["b_hk"]), ("0.75", "1.00"))
        self.assertEqual(quote["odds_format"], "CROWN_HK")

    def test_crown_total_is_exported_as_over_then_under(self):
        event = _normalize_event({
            "GID": "1", "TEAM_H": "主队", "TEAM_C": "客队",
            "RATIO_OUO": "2.5", "IOR_OUH": "0.820", "IOR_OUC": "1.020",
        }, "today")
        quote = event["markets"]["total"][0]
        self.assertEqual((quote["a_hk"], quote["b_hk"]), ("1.02", "0.82"))

    def test_game_more_keeps_full_time_master_and_alternate_lines(self):
        rows = [
            {
                "GID": "100", "GIDM": "200", "HGID": "101", "MASTER": "Y",
                "MODE": "FT", "PTYPE": "", "RATIO": "0", "RATIO_O": "2.5",
                "RATIO_OUCO": "0.5", "RATIO_OUCU": "0.5",
                "IOR_RH": "0.75", "IOR_RC": "1.05",
                "IOR_OUC": "0.95", "IOR_OUH": "0.85",
                "IOR_OUCO": "1.20", "IOR_OUCU": "0.80",
                "IOR_MH": "1.20", "IOR_MN": "3.40", "IOR_MC": "5.60",
            },
            {
                "GID": "102", "GIDM": "200", "HGID": "103", "MASTER": "N",
                "MODE": "FT", "PTYPE": "", "RATIO": "0.5 / 1", "RATIO_O": "3",
                "RATIO_OUCO": "0.5", "RATIO_OUCU": "0.5",
                "IOR_RH": "1.12", "IOR_RC": "0.77",
                "IOR_OUC": "1.19", "IOR_OUH": "0.69",
                "IOR_OUCO": "1.20", "IOR_OUCU": "0.80",
                "IOR_MH": "0", "IOR_MN": "0", "IOR_MC": "0",
            },
        ]
        result = _normalize_more_markets(rows, "CROWN_HK")
        self.assertEqual([item["gid"] for item in result["handicap"]], ["100", "102"])
        self.assertEqual([item["line"] for item in result["handicap"]], ["0", "0.75"])
        self.assertEqual([item["line"] for item in result["total"]], ["2.5", "3"])
        self.assertTrue(all(item["market_type"] in {"handicap", "total"} for item in result["handicap"] + result["total"]))
        self.assertEqual(result["moneyline"][0]["gid"], "100")

    def test_game_more_master_ids_are_attached_to_base_markets(self):
        more = {
            "status": "loaded",
            "handicap": [{"gid": "100", "gidm": "200", "hgid": "101", "market_id": "200", "master": "Y", "line": "0.75"}],
            "total": [{"gid": "110", "gidm": "210", "hgid": "111", "market_id": "210", "master": "Y", "line": "2.5"}],
            "moneyline": [], "rows": [],
        }
        event = _normalize_event({
            "GID": "100", "TEAM_H": "主队", "TEAM_C": "客队",
            "RATIO_R": "0.5 / 1", "IOR_RH": "1.12", "IOR_RC": "0.77",
            "RATIO_OUO": "2.5", "IOR_OUC": "1.19", "IOR_OUH": "0.69",
        }, "today", more_markets=more)
        self.assertEqual(event["markets"]["handicap"][0]["gid"], "100")
        self.assertEqual(event["markets"]["handicap"][0]["market_id"], "200")
        self.assertEqual(event["markets"]["total"][0]["gid"], "110")

    def test_game_more_live_total_uses_rouo_ratio(self):
        result = _normalize_more_markets([{
            "GID": "500", "GIDM": "600", "HGID": "501", "MASTER": "N",
            "MODE": "FT", "PTYPE": "", "RATIO_RE": "0.5",
            "RATIO_ROUO": "2.5", "RATIO_ROUU": "2.5",
            "IOR_REH": "0.80", "IOR_REC": "1.00",
            "IOR_ROUC": "0.90", "IOR_ROUH": "0.80",
        }], "CROWN_HK")
        self.assertEqual(result["total"][0]["line"], "2.5")



if __name__ == "__main__":
    unittest.main()
