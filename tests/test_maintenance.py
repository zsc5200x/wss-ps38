import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

from dashboard_server import HistoryDatabase
from maintenance import backup_database, compress_capture_files


class MaintenanceTests(unittest.TestCase):
    def test_database_backup_is_consistent_and_retained(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            database_path = root / "history.sqlite3"
            database = HistoryDatabase(database_path)
            database.write_batch(
                [
                    {
                        "eventId": "100",
                        "name": "Home VS Away",
                        "league": "Test League",
                        "kickoff": "2026-10-29T20:00:00+08:00",
                        "metadataStatus": "complete",
                        "updatedAt": "2026-10-28T05:00:00+08:00",
                    }
                ],
                [],
            )
            config = {
                "dashboard_db_path": str(database_path),
                "backup_dir": str(root / "backups"),
                "backup_keep": 2,
            }

            for _ in range(3):
                backup_database(config)

            backups = sorted((root / "backups").glob("odds_history-*.sqlite3"))
            self.assertEqual(len(backups), 2)
            with sqlite3.connect(backups[-1]) as connection:
                self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                self.assertEqual(connection.execute("SELECT name FROM events").fetchone()[0], "Home VS Away")

    @unittest.skipUnless(shutil.which("zstd"), "需要 zstd")
    def test_rotated_capture_is_verified_before_compression(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            current = root / "capture.jsonl"
            rotated = root / "capture-20261028-010203.jsonl"
            content = '{"captured_at":"2026-10-28T01:02:03+08:00"}\n' * 5
            current.write_text(content, encoding="utf-8")
            rotated.write_text(content, encoding="utf-8")
            config = {
                "capture_path": str(current),
                "capture_compress_after_hours": 24,
                "capture_compress_min_mb": 0,
            }

            result = compress_capture_files(config, force=True)
            compressed = Path(str(rotated) + ".zst")

            self.assertEqual(result[0]["action"], "compressed")
            self.assertEqual(result[0]["lines"], 5)
            self.assertTrue(current.exists())
            self.assertFalse(rotated.exists())
            self.assertTrue(compressed.exists())
            decompressed = subprocess.run(
                ["zstd", "-dc", str(compressed)],
                check=True,
                capture_output=True,
                text=True,
            ).stdout
            self.assertEqual(decompressed, content)


if __name__ == "__main__":
    unittest.main()
