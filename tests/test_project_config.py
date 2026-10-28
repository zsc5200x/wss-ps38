import unittest
from pathlib import Path

from project_config import PROJECT_DIR, get_path, load_config


class ProjectConfigTests(unittest.TestCase):
    def test_default_paths_are_inside_project(self):
        config = load_config()
        self.assertEqual(get_path(config, "capture_path"), PROJECT_DIR / "capture.jsonl")
        self.assertEqual(get_path(config, "events_file"), PROJECT_DIR / "events_list.csv")

    def test_relative_custom_path(self):
        config = {"capture_path": "data/raw.jsonl"}
        self.assertEqual(
            get_path(config, "capture_path"),
            PROJECT_DIR / "data/raw.jsonl",
        )


if __name__ == "__main__":
    unittest.main()
