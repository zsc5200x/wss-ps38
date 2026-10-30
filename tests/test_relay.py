import asyncio
import unittest

from src.transport.relay import RelayHub


class RelayTests(unittest.TestCase):
    def test_requires_token_and_assigns_sequences(self):
        async def scenario():
            hub = RelayHub("secret", queue_size=2)
            client = hub.new_client()
            self.assertFalse(hub.authenticate(client, "wrong"))
            self.assertTrue(hub.authenticate(client, "secret"))
            first = await hub.publish({"odds": 1})
            second = await hub.publish({"odds": 2})
            self.assertEqual((first.sequence, second.sequence), (1, 2))
            self.assertEqual((await hub.next_message(client)).sequence, 1)
            self.assertEqual((await hub.next_message(client)).sequence, 2)
        asyncio.run(scenario())

    def test_slow_client_is_dropped_without_blocking_publisher(self):
        async def scenario():
            hub = RelayHub("secret", queue_size=1)
            client = hub.new_client()
            hub.authenticate(client, "secret")
            await hub.publish({"n": 1})
            await hub.publish({"n": 2})
            self.assertEqual(client.dropped, 1)
            self.assertEqual(hub.dropped, 1)
            self.assertEqual((await hub.next_message(client)).payload, {"n": 1})
        asyncio.run(scenario())

    def test_unauthenticated_client_cannot_read(self):
        async def scenario():
            hub = RelayHub("secret")
            client = hub.new_client()
            with self.assertRaises(PermissionError):
                await hub.next_message(client, timeout=0.01)
        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
