import unittest
from types import SimpleNamespace
from unittest.mock import patch

from dashboard_server import DashboardHandler, build_server


class _Headers(dict):
    def get(self, name, default=None):
        return super().get(name, default)


class DashboardAuthTests(unittest.TestCase):
    def _handler(self, headers=None, token="secret", enabled=True):
        handler = object.__new__(DashboardHandler)
        handler.server = SimpleNamespace(
            dashboard_auth_enabled=enabled,
            dashboard_api_token=token,
        )
        handler.headers = _Headers(headers or {})
        handler.responses = []
        handler.send_json = lambda payload, status=200, **kwargs: handler.responses.append(
            (payload, status, kwargs)
        )
        return handler

    def test_bearer_and_header_tokens_are_accepted(self):
        for headers in ({"X-API-Token": "secret"}, {"Authorization": "Bearer secret"}):
            handler = self._handler(headers)
            self.assertTrue(handler._authorized())
            self.assertEqual(handler.responses, [])

    def test_missing_or_wrong_token_is_rejected(self):
        for headers in ({}, {"X-API-Token": "wrong"}):
            handler = self._handler(headers)
            self.assertFalse(handler._authorized())
            self.assertEqual(handler.responses[0][1], 401)

    def test_remote_bind_without_token_is_refused_before_startup(self):
        with self.assertRaisesRegex(RuntimeError, "DASHBOARD_API_TOKEN"):
            build_server("0.0.0.0", 0, {})


if __name__ == "__main__":
    unittest.main()
