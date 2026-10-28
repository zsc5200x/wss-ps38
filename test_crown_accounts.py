import unittest
import os
from types import SimpleNamespace
from unittest.mock import patch

import crown_runtime
from crown_local.backend.auth import (
    AuthService,
    _allow_insecure_certificate,
    _crown_ip_redirect_origin,
)


class CrownAccountTests(unittest.TestCase):
    class FakeStore:
        def __init__(self, accounts):
            self._accounts = accounts
            self.saved = None
            self.cleared = None
            self.deleted = None

        def accounts(self):
            return self._accounts

        def get_account(self, account_id):
            return next(account for account in self._accounts if account["id"] == account_id)

        def save_account(self, payload, account_id=None):
            self.saved = (payload, account_id)
            return {"id": account_id or "new-account", **payload}

        def clear_session(self, account_id):
            self.cleared = account_id
            account = self.get_account(account_id)
            account["has_session"] = False
            account["status"] = "idle"

        def delete_account(self, account_id):
            self.deleted = account_id
            self._accounts = [account for account in self._accounts if account["id"] != account_id]

    class FakeAuth:
        def __init__(self):
            self.cancelled = None

        def cancel(self, account_id):
            self.cancelled = account_id

    def test_same_domain_and_username_updates_existing_account(self):
        fake = self.FakeStore([{
            "id": "existing-account",
            "kind": "crown_odds",
            "base_url": "https://m321.mos077.com",
            "username": "member",
        }])
        with patch.object(crown_runtime, "initialize"), \
                patch.object(crown_runtime, "store", fake):
            result = crown_runtime.add_account(
                "https://m321.mos077.com", "member", "new-password", "JBSWY3DPEHPK3PXP"
            )

        self.assertEqual(result["id"], "existing-account")
        payload, account_id = fake.saved
        self.assertEqual(account_id, "existing-account")
        self.assertEqual(payload["password"], "new-password")

    def test_new_domain_or_username_creates_a_new_account(self):
        fake = self.FakeStore([])
        with patch.object(crown_runtime, "initialize"), \
                patch.object(crown_runtime, "store", fake):
            result = crown_runtime.add_account(
                "https://example.com", "new-member", "new-password"
            )

        self.assertEqual(result["id"], "new-account")
        _payload, account_id = fake.saved
        self.assertIsNone(account_id)

    def test_clear_session_keeps_account_and_credentials(self):
        fake_store = self.FakeStore([{
            "id": "existing-account",
            "kind": "crown_odds",
            "username": "member",
            "status": "authenticated",
            "has_session": True,
            "has_password": True,
        }])
        fake_auth = self.FakeAuth()
        with patch.object(crown_runtime, "initialize"), \
                patch.object(crown_runtime, "store", fake_store), \
                patch.object(crown_runtime, "auth", fake_auth):
            result = crown_runtime.account_action("existing-account", "clear")

        self.assertEqual(fake_auth.cancelled, "existing-account")
        self.assertEqual(fake_store.cleared, "existing-account")
        self.assertFalse(result["has_session"])
        self.assertTrue(result["has_password"])
        self.assertEqual(len(fake_store.accounts()), 1)

    def test_delete_account_removes_saved_account(self):
        fake_store = self.FakeStore([{
            "id": "existing-account",
            "kind": "crown_odds",
            "username": "member",
            "has_session": True,
            "has_password": True,
        }])
        fake_auth = self.FakeAuth()
        with patch.object(crown_runtime, "initialize"), \
                patch.object(crown_runtime, "store", fake_store), \
                patch.object(crown_runtime, "auth", fake_auth):
            result = crown_runtime.account_action("existing-account", "delete")

        self.assertEqual(fake_auth.cancelled, "existing-account")
        self.assertEqual(fake_store.deleted, "existing-account")
        self.assertIsNone(result)
        self.assertEqual(fake_store.accounts(), [])

    def test_crown_ip_endpoint_allows_legacy_certificate(self):
        self.assertTrue(_allow_insecure_certificate({
            "kind": "crown_odds", "base_url": "https://64.188.47.32",
        }))

    def test_crown_domain_keeps_strict_certificate_validation(self):
        self.assertFalse(_allow_insecure_certificate({
            "kind": "crown_odds", "base_url": "https://example.com",
        }))

    def test_crown_private_ip_keeps_strict_certificate_validation(self):
        self.assertFalse(_allow_insecure_certificate({
            "kind": "crown_odds", "base_url": "https://127.0.0.1",
        }))

    def test_crown_public_ip_entry_can_adopt_public_ip_redirect(self):
        self.assertEqual(
            _crown_ip_redirect_origin(
                {"kind": "crown_odds", "base_url": "https://64.188.47.32"},
                "https://43.229.3.127/login?from=entry",
            ),
            "https://43.229.3.127",
        )

    def test_crown_redirect_does_not_adopt_private_or_domain_targets(self):
        account = {"kind": "crown_odds", "base_url": "https://64.188.47.32"}
        self.assertEqual(_crown_ip_redirect_origin(account, "https://127.0.0.1/"), "")
        self.assertEqual(_crown_ip_redirect_origin(account, "https://example.com/"), "")
        self.assertEqual(
            _crown_ip_redirect_origin(
                {"kind": "crown_odds", "base_url": "https://entry.example.com"},
                "https://43.229.3.127/",
            ),
            "",
        )

    def test_adopted_crown_ip_redirect_is_a_trusted_page_origin(self):
        job = SimpleNamespace(
            account={"kind": "crown_odds", "base_url": "https://64.188.47.32"},
            member_origin="https://43.229.3.127",
        )
        self.assertTrue(AuthService._trusted_page(job, "https://43.229.3.127/login"))

    def test_crown_launches_through_shared_cdp_browser(self):
        class FakeBrowser:
            def is_connected(self):
                return True

        class FakeChromium:
            def __init__(self):
                self.connect_urls = []
                self.launch_options = []

            def connect_over_cdp(self, url):
                self.connect_urls.append(url)
                return FakeBrowser()

            def launch(self, **options):
                self.launch_options.append(options)
                return FakeBrowser()

        chromium = FakeChromium()
        service = AuthService.__new__(AuthService)
        service._browser = None
        service._background_browser = None
        service._browser_shared = False
        service._playwright = SimpleNamespace(chromium=chromium)

        with patch.dict(os.environ, {"CROWN_CDP_URL": "http://127.0.0.1:9222"}):
            browser = service._launch()

        self.assertIsNotNone(browser)
        self.assertEqual(chromium.connect_urls, ["http://127.0.0.1:9222"])
        self.assertEqual(chromium.launch_options, [])
        self.assertTrue(service._browser_shared)


if __name__ == "__main__":
    unittest.main()
