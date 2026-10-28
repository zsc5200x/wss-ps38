import unittest
from unittest.mock import patch

import crown_runtime


class CrownAccountTests(unittest.TestCase):
    class FakeStore:
        def __init__(self, accounts):
            self._accounts = accounts
            self.saved = None

        def accounts(self):
            return self._accounts

        def save_account(self, payload, account_id=None):
            self.saved = (payload, account_id)
            return {"id": account_id or "new-account", **payload}

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


if __name__ == "__main__":
    unittest.main()
