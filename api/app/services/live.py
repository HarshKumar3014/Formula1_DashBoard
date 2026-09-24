"""Live timing via F1's SignalR stream (undocumented — treated as fragile).

A background thread runs a subclassed fastf1 SignalRClient that, in addition to
recording to file, folds messages into an in-memory state snapshot. WebSocket
clients receive the snapshot at ~2 Hz. Everything fails gracefully: if the
stream is unavailable the dashboard falls back to replay mode.
"""
import base64
import json
import logging
import threading
import time
import zlib
from datetime import datetime, timezone

from ..config import DATA_DIR

log = logging.getLogger(__name__)

INTERESTING = {"TimingData", "TrackStatus", "RaceControlMessages",
               "SessionInfo", "DriverList", "Position.z", "SessionData"}


def _decompress(data: str) -> dict:
    return json.loads(zlib.decompress(base64.b64decode(data), -zlib.MAX_WBITS))


def _deep_merge(dst: dict, src: dict) -> dict:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _deep_merge(dst[k], v)
        else:
            dst[k] = v
    return dst


class LiveState:
    """Thread-safe folded state of the live feed."""

    def __init__(self):
        self._lock = threading.Lock()
        self.timing: dict = {}          # driver number → timing line
        self.positions: dict = {}       # driver number → {X, Y, Status}
        self.drivers: dict = {}         # driver number → {Tla, TeamColour, FullName}
        self.track_status: dict = {}
        self.session_info: dict = {}
        self.messages: list[dict] = []  # race control messages
        self.last_update: float = 0

    def ingest(self, topic: str, data) -> None:
        with self._lock:
            self.last_update = time.time()
            if topic == "Position.z" and isinstance(data, str):
                try:
                    payload = _decompress(data)
                except Exception:
                    return
                for entry in payload.get("Position", []):
                    for num, p in entry.get("Entries", {}).items():
                        self.positions[num] = p
            elif topic == "TimingData" and isinstance(data, dict):
                for num, line in data.get("Lines", {}).items():
                    _deep_merge(self.timing.setdefault(num, {}), line)
            elif topic == "DriverList" and isinstance(data, dict):
                for num, d in data.items():
                    if isinstance(d, dict):
                        _deep_merge(self.drivers.setdefault(num, {}), d)
            elif topic == "TrackStatus" and isinstance(data, dict):
                self.track_status = data
            elif topic == "SessionInfo" and isinstance(data, dict):
                _deep_merge(self.session_info, data)
            elif topic == "RaceControlMessages" and isinstance(data, dict):
                msgs = data.get("Messages")
                items = msgs.values() if isinstance(msgs, dict) else (msgs or [])
                for m in items:
                    if isinstance(m, dict):
                        self.messages.append(m)
                self.messages = self.messages[-50:]

    def snapshot(self) -> dict:
        with self._lock:
            cars = {}
            for num, p in self.positions.items():
                d = self.drivers.get(num, {})
                t = self.timing.get(num, {})
                cars[num] = {
                    "code": d.get("Tla", num),
                    "color": f"#{d.get('TeamColour')}" if d.get("TeamColour") else "#9CA3AF",
                    "x": p.get("X"), "y": p.get("Y"), "status": p.get("Status"),
                    "pos": t.get("Position"),
                    "gap": t.get("GapToLeader")
                           or (t.get("IntervalToPositionAhead") or {}).get("Value"),
                    "lastLap": (t.get("LastLapTime") or {}).get("Value"),
                    "inPit": t.get("InPit"),
                    "retired": t.get("Retired") or t.get("Stopped"),
                }
            return {
                "type": "live",
                "cars": cars,
                "trackStatus": self.track_status,
                "sessionInfo": {
                    "meeting": (self.session_info.get("Meeting") or {}).get("Name"),
                    "session": self.session_info.get("Name"),
                },
                "messages": self.messages[-15:],
                "lastUpdate": self.last_update,
            }


def _has_auth_token() -> bool:
    """F1 live timing requires an F1TV subscription token (one-time browser auth
    via `python -m fastf1 auth`). Without it the client would block forever
    waiting for interactive authentication — so we check first."""
    try:
        from fastf1.internals.f1auth import AUTH_DATA_FILE
        return AUTH_DATA_FILE.exists() and AUTH_DATA_FILE.stat().st_size > 0
    except Exception:
        return False


class LiveManager:
    """Owns the SignalR client thread; started/stopped around live sessions."""

    def __init__(self):
        self.state = LiveState()
        self._thread: threading.Thread | None = None
        self._client = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    @property
    def receiving(self) -> bool:
        return self.running and (time.time() - self.state.last_update) < 60

    @property
    def auth_ok(self) -> bool:
        return _has_auth_token()

    def start(self) -> bool:
        if self.running:
            return True
        if not self.auth_ok:
            log.warning("live timing not started: no F1TV auth token "
                        "(run `python -m fastf1 auth` once to enable live mode)")
            return False
        try:
            from fastf1.livetiming.client import SignalRClient
        except Exception:
            log.exception("SignalR client unavailable")
            return False

        state = self.state
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        outfile = str(DATA_DIR / f"livetiming_{stamp}.txt")

        class StreamingClient(SignalRClient):
            def _on_message(self, msg):
                super()._on_message(msg)
                try:
                    if hasattr(msg, "result") and isinstance(msg.result, dict):
                        # CompletionMessage: initial snapshot {topic: data, ...}
                        for topic, data in msg.result.items():
                            if topic in INTERESTING:
                                state.ingest(topic, data)
                    elif isinstance(msg, (list, tuple)) and len(msg) >= 2:
                        # streamed update: [topic, data, timestamp]
                        if msg[0] in INTERESTING:
                            state.ingest(msg[0], msg[1])
                except Exception:
                    log.debug("live message parse failed", exc_info=True)

        def run():
            try:
                client = StreamingClient(outfile, filemode="w", timeout=300)
                self._client = client
                client.start()
            except Exception:
                log.exception("live timing client crashed")

        self._thread = threading.Thread(target=run, daemon=True, name="livetiming")
        self._thread.start()
        log.info("live timing client started → %s", outfile)
        return True

    def status(self) -> dict:
        return {"running": self.running, "receiving": self.receiving,
                "authRequired": not self.auth_ok,
                "lastUpdate": self.state.last_update}


manager = LiveManager()
