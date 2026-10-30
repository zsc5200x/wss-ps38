from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import capture


class CaptureMetricsTests(unittest.TestCase):
    def test_socket_status_does_not_expose_frame_payload(self):
        request_id = "metrics-test-socket"
        with patch.object(capture, "STATUS_PATH", Path(tempfile.mkdtemp()) / "capture.status.json"):
            capture.on_created({"requestId": request_id, "url": "wss://ps3838.com/odds"})
            status = capture.capture_status()
            self.assertTrue(status["connected"])
            self.assertEqual(status["activeSockets"], 1)
            self.assertIn("droppedFrames", status)
            self.assertNotIn("payload", status)
            capture.on_closed({"requestId": request_id})
            self.assertFalse(capture.capture_status()["connected"])
        capture.socket_urls.pop(request_id, None)
        capture.active_sockets.discard(request_id)

    def test_retention_removes_old_rotated_files_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            active = root / "capture.jsonl"
            old = root / "capture-20200101-000000.jsonl"
            recent = root / "capture-20260101-000000.jsonl"
            active.write_text("active", encoding="utf-8")
            old.write_text("old", encoding="utf-8")
            recent.write_text("recent", encoding="utf-8")
            old_timestamp = time.time() - 3 * 24 * 3600
            os.utime(old, (old_timestamp, old_timestamp))
            with patch.object(capture, "OUT", active), patch.object(
                capture, "RETENTION_HOURS", 24.0
            ), patch.object(capture, "MAX_CAPTURE_BYTES", 0):
                capture._prune_capture_files(force=True)
            self.assertTrue(active.exists())
            self.assertFalse(old.exists())
            self.assertTrue(recent.exists())


if __name__ == "__main__":
    unittest.main()
