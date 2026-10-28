import unittest
from unittest.mock import patch

import crown_runtime


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


if __name__ == "__main__":
    unittest.main()
