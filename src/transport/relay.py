"""Authenticated WebSocket relay primitives.

The relay deliberately receives already-normalized messages.  It does not
forward browser cookies, authorization headers, or raw CDP traffic.  A client
must authenticate with a token before it can receive messages; each published
message has a monotonically increasing sequence number so consumers can
detect gaps after reconnecting.

The core hub is independent of the WebSocket implementation and is therefore
easy to test.  ``serve`` is an optional adapter for the ``websockets`` package
when an actual WSS listener is required.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import hmac
import json
import secrets
from typing import Any, Dict, Optional


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class RelayMessage:
    """A versioned message sent to relay subscribers."""

    sequence: int
    source: str
    payload: Any
    captured_at: str
    version: int = 1

    def as_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "type": "odds",
            "sequence": self.sequence,
            "source": self.source,
            "capturedAt": self.captured_at,
            "payload": self.payload,
        }


class RelayClient:
    """State for one authenticated subscriber."""

    def __init__(self, queue_size: int) -> None:
        self.queue: asyncio.Queue[Optional[RelayMessage]] = asyncio.Queue(maxsize=queue_size)
        self.dropped = 0
        self.last_sequence = 0
        self.authenticated = False
        self.connected_at = _now()


class RelayHub:
    """Token-authenticated fan-out hub with bounded subscriber queues."""

    def __init__(self, token: str, *, queue_size: int = 256, heartbeat_seconds: float = 30.0) -> None:
        if not isinstance(token, str) or not token:
            raise ValueError("relay token must be non-empty")
        if queue_size < 1:
            raise ValueError("queue_size must be positive")
        if heartbeat_seconds <= 0:
            raise ValueError("heartbeat_seconds must be positive")
        self._token = token
        self.queue_size = queue_size
        self.heartbeat_seconds = heartbeat_seconds
        self._sequence = 0
        self._clients: set[RelayClient] = set()
        self._lock = asyncio.Lock()
        self.published = 0
        self.dropped = 0

    @property
    def client_count(self) -> int:
        return len(self._clients)

    def new_client(self) -> RelayClient:
        client = RelayClient(self.queue_size)
        self._clients.add(client)
        return client

    async def close_client(self, client: RelayClient) -> None:
        self._clients.discard(client)
        try:
            client.queue.put_nowait(None)
        except asyncio.QueueFull:
            pass

    def authenticate(self, client: RelayClient, token: str) -> bool:
        """Authenticate once using a constant-time comparison."""
        if client not in self._clients or not isinstance(token, str):
            return False
        client.authenticated = hmac.compare_digest(self._token, token)
        return client.authenticated

    async def publish(self, payload: Any, *, source: str = "pinnacle", captured_at: Optional[str] = None) -> RelayMessage:
        """Publish one message without blocking on a slow consumer."""
        if not source or len(source) > 128:
            raise ValueError("source must be a short non-empty string")
        async with self._lock:
            self._sequence += 1
            message = RelayMessage(self._sequence, source, payload, captured_at or _now())
            self.published += 1
            for client in tuple(self._clients):
                if not client.authenticated:
                    continue
                try:
                    client.queue.put_nowait(message)
                except asyncio.QueueFull:
                    client.dropped += 1
                    self.dropped += 1
        return message

    async def next_message(self, client: RelayClient, *, timeout: Optional[float] = None) -> Optional[RelayMessage]:
        if client not in self._clients or not client.authenticated:
            raise PermissionError("client is not authenticated")
        if timeout is None:
            message = await client.queue.get()
        else:
            message = await asyncio.wait_for(client.queue.get(), timeout)
        if message is not None:
            client.last_sequence = message.sequence
        return message

    def stats(self) -> Dict[str, Any]:
        return {
            "clients": self.client_count,
            "published": self.published,
            "dropped": self.dropped,
            "nextSequence": self._sequence + 1,
            "queueSize": self.queue_size,
        }


def _hello_message() -> str:
    return json.dumps({"version": 1, "type": "hello", "status": "ok"}, separators=(",", ":"))


async def serve(hub: RelayHub, host: str, port: int, *, ssl: Any = None, path: str = "/relay") -> Any:
    """Run an authenticated WebSocket relay using ``websockets``.

    The caller owns the returned server and must close it.  TLS is supplied by
    the caller via an ``ssl.SSLContext``; plaintext is intended only for local
    development.  No token is included in error responses or logs.
    """
    try:
        from websockets.asyncio.server import serve as websocket_serve
    except ImportError as exc:  # pragma: no cover - depends on optional runtime
        raise RuntimeError("安装 websockets 才能启动 relay") from exc

    async def handler(websocket: Any) -> None:
        request = getattr(websocket, "request", None)
        request_path = getattr(request, "path", None)
        actual_path = getattr(websocket, "path", None) or request_path or path
        if actual_path != path:
            await websocket.close(code=1008, reason="invalid path")
            return
        client = hub.new_client()
        try:
            raw = await asyncio.wait_for(websocket.recv(), timeout=10)
            try:
                hello = json.loads(raw)
            except (TypeError, ValueError):
                hello = {}
            if not isinstance(hello, dict) or hello.get("type") != "auth" or not hub.authenticate(client, hello.get("token", "")):
                await websocket.close(code=1008, reason="authentication failed")
                return
            await websocket.send(_hello_message())

            async def receive_control() -> None:
                async for incoming in websocket:
                    try:
                        control = json.loads(incoming)
                    except (TypeError, ValueError):
                        continue
                    if isinstance(control, dict) and control.get("type") == "ping":
                        await websocket.send(json.dumps({"version": 1, "type": "pong", "at": _now()}, separators=(",", ":")))

            async def send_messages() -> None:
                while True:
                    message = await hub.next_message(client)
                    if message is None:
                        return
                    await websocket.send(json.dumps(message.as_dict(), ensure_ascii=False, separators=(",", ":")))

            await asyncio.gather(receive_control(), send_messages())
        except (asyncio.TimeoutError, asyncio.CancelledError):
            return
        finally:
            await hub.close_client(client)

    return await websocket_serve(handler, host, port, ssl=ssl, ping_interval=hub.heartbeat_seconds, ping_timeout=hub.heartbeat_seconds)
