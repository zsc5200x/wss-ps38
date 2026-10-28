import unittest
import os
import threading
import json
import sqlite3
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

import crown_runtime
from crown_local.backend.auth import (
    AuthService,
    _allow_insecure_certificate,
    _crown_ip_redirect_origin,
)
from crown_local.backend.storage import Store
from cryptography.fernet import Fernet


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
                "https://m321.mos077.com", "member"
            )

        self.assertEqual(result["id"], "existing-account")
        payload, account_id = fake.saved
        self.assertEqual(account_id, "existing-account")
        self.assertNotIn("password", payload)
        self.assertNotIn("totp_secret", payload)

    def test_new_domain_or_username_creates_a_new_account(self):
        fake = self.FakeStore([])
        with patch.object(crown_runtime, "initialize"), \
                patch.object(crown_runtime, "store", fake):
            result = crown_runtime.add_account(
                "https://example.com", "new-member"
            )

        self.assertEqual(result["id"], "new-account")
        _payload, account_id = fake.saved
        self.assertIsNone(account_id)

    def test_clear_session_keeps_account(self):
        fake_store = self.FakeStore([{
            "id": "existing-account",
            "kind": "crown_odds",
            "username": "member",
            "status": "authenticated",
            "has_session": True,
        }])
        fake_auth = self.FakeAuth()
        with patch.object(crown_runtime, "initialize"), \
                patch.object(crown_runtime, "store", fake_store), \
                patch.object(crown_runtime, "auth", fake_auth):
            result = crown_runtime.account_action("existing-account", "clear")

        self.assertEqual(fake_auth.cancelled, "existing-account")
        self.assertEqual(fake_store.cleared, "existing-account")
        self.assertFalse(result["has_session"])
        self.assertEqual(len(fake_store.accounts()), 1)

    def test_delete_account_removes_saved_account(self):
        fake_store = self.FakeStore([{
            "id": "existing-account",
            "kind": "crown_odds",
            "username": "member",
            "has_session": True,
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

    def test_shared_cdp_uses_default_context_without_creating_another(self):
        class FakeContext:
            pass

        class FakeBrowser:
            def __init__(self):
                self.contexts = [FakeContext()]

            def new_context(self, **_options):
                raise AssertionError("shared Chrome must not create a new context")

        service = AuthService.__new__(AuthService)
        service._browser_shared = True
        browser = FakeBrowser()

        context, owns_context = service._acquire_context(browser, {"kind": "crown_odds"}, None)

        self.assertIs(context, browser.contexts[0])
        self.assertFalse(owns_context)

    def test_saved_storage_state_excludes_pinnacle(self):
        class FakePage:
            url = "https://hga038.com/login"
            frames = []

        class FakeContext:
            def storage_state(self):
                return {
                    "cookies": [
                        {"name": "crown", "domain": ".hga038.com", "value": "c"},
                        {"name": "pinnacle", "domain": ".ps3838.com", "value": "p"},
                    ],
                    "origins": [
                        {"origin": "https://hga038.com", "localStorage": []},
                        {"origin": "https://www.ps3838.com", "localStorage": []},
                    ],
                }

        service = AuthService.__new__(AuthService)
        job = SimpleNamespace(
            account={"kind": "crown_odds", "base_url": "https://hga038.com"},
            member_origin="", resume_url="", page=FakePage(), context=FakeContext(),
        )

        state = service._scoped_storage_state(job)

        self.assertEqual([cookie["name"] for cookie in state["cookies"]], ["crown"])
        self.assertEqual([origin["origin"] for origin in state["origins"]], ["https://hga038.com"])

    def test_completed_login_keeps_visible_tab_until_disposed(self):
        class FakePage:
            def __init__(self):
                self.front_count = 0
                self.close_count = 0
                self.closed = False

            def bring_to_front(self):
                self.front_count += 1

            def is_closed(self):
                return self.closed

            def close(self):
                self.close_count += 1
                self.closed = True

        class FakeContext:
            def __init__(self):
                self.close_count = 0

            def close(self):
                self.close_count += 1

        context = FakeContext()
        page = FakePage()
        service = AuthService.__new__(AuthService)
        service._jobs = {"account": SimpleNamespace(context=context, page=page, owns_context=False)}
        service._screenshots = {}
        service._visible_pages = {}
        service._lock = threading.RLock()

        service._retain_visible("account")

        self.assertNotIn("account", service._jobs)
        self.assertIn("account", service._visible_pages)
        self.assertEqual(context.close_count, 0)
        self.assertEqual(page.front_count, 1)
        self.assertTrue(service.browser_open("account"))

        service._dispose("account")

        self.assertEqual(context.close_count, 0)
        self.assertEqual(page.close_count, 1)
        self.assertFalse(service.browser_open("account"))

    def test_background_check_does_not_replace_visible_tab(self):
        class FakeStore:
            def get_account(self, account_id):
                return {"id": account_id, "kind": "crown_odds", "enabled": True}

        retained = object()
        service = AuthService.__new__(AuthService)
        service.store = FakeStore()
        service._jobs = {}
        service._visible_pages = {"account": retained}

        service._begin("account", background=True)

        self.assertIs(service._visible_pages["account"], retained)
        self.assertEqual(service._jobs, {})

    def test_startup_replaces_legacy_credentials_with_empty_encrypted_object(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ, {"REPORT_MASTER_KEY": Fernet.generate_key().decode()}
        ):
            store = Store(directory)
            account = store.save_account({
                "kind": "crown_odds",
                "base_url": "https://hga038.com",
                "username": "member",
                "enabled": True,
                "interval": 30,
            })
            legacy = store.vault.encrypt({
                "password": "legacy-password",
                "safe_password": "legacy-safe-password",
                "totp_secret": "LEGACYSECRET",
            })
            with sqlite3.connect(os.path.join(directory, "crown.sqlite3")) as connection:
                connection.execute("UPDATE accounts SET credentials=? WHERE id=?", (legacy, account["id"]))

            restarted = Store(directory)
            with sqlite3.connect(os.path.join(directory, "crown.sqlite3")) as connection:
                stored = connection.execute(
                    "SELECT credentials FROM accounts WHERE id=?", (account["id"],)
                ).fetchone()[0]

            self.assertEqual(restarted.vault.decrypt(stored), {})
            self.assertNotIn("has_password", restarted.get_account(account["id"]))
            self.assertNotIn("has_totp_secret", restarted.get_account(account["id"]))


if __name__ == "__main__":
    unittest.main()
