"""Tiny JSON file cache with TTL. Keeps request paths off external APIs.

Immutable entries (ttl=None: session results, telemetry bundles, replays) have a second
tier: the public storage CDN that `app.publish` fills. A local miss checks the CDN's
manifest and downloads the published copy instead of rebuilding it from fastf1 — which
matters on hosts without a persistent disk.
"""
import json
import logging
import threading
import time
from typing import Any, Callable

import requests

from .config import DATA_PUBLIC_URL, JSON_CACHE_DIR

log = logging.getLogger(__name__)

MANIFEST_TTL = 600  # re-read the CDN manifest at most every 10 minutes
_manifest: dict = {"keys": frozenset(), "fetched": 0.0}
_manifest_lock = threading.Lock()


def _path(key: str):
    safe = key.replace("/", "_").replace(":", "_")
    return JSON_CACHE_DIR / f"{safe}.json"


def _remote_keys() -> frozenset[str]:
    with _manifest_lock:
        if time.time() - _manifest["fetched"] > MANIFEST_TTL:
            _manifest["fetched"] = time.time()
            try:
                r = requests.get(f"{DATA_PUBLIC_URL}/manifest.json", timeout=5)
                if r.ok:
                    _manifest["keys"] = frozenset(r.json().get("keys", []))  # NB: module-level set() is the cache setter
            except (requests.RequestException, ValueError) as exc:
                log.info("data CDN manifest unavailable: %s", exc)
        return _manifest["keys"]


def _get_remote(key: str) -> Any | None:
    if not DATA_PUBLIC_URL or key not in _remote_keys():
        return None
    try:
        r = requests.get(f"{DATA_PUBLIC_URL}/{key}.json", timeout=30)
        r.raise_for_status()
        value = r.json()
    except (requests.RequestException, ValueError) as exc:
        log.warning("data CDN fetch failed for %s: %s", key, exc)
        return None
    set(key, value)
    log.info("data CDN hit: %s", key)
    return value


def get(key: str, ttl: float | None = None) -> Any | None:
    """Return cached value, or None if missing/expired. ttl=None → never expires."""
    p = _path(key)
    if not p.exists():
        return _get_remote(key) if ttl is None else None
    try:
        with open(p) as f:
            wrapper = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    if ttl is not None and time.time() - wrapper["ts"] > ttl:
        return None
    return wrapper["value"]


def set(key: str, value: Any) -> None:
    p = _path(key)
    tmp = p.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump({"ts": time.time(), "value": value}, f)
    tmp.replace(p)


def get_or_build(key: str, ttl: float | None, builder: Callable[[], Any]) -> Any:
    """Serve from cache; on miss, build, store, serve. Stale value returned on build failure."""
    cached = get(key, ttl)
    if cached is not None:
        return cached
    try:
        value = builder()
    except Exception:
        stale = get(key, ttl=None)  # better stale than broken
        if stale is not None:
            return stale
        raise
    set(key, value)
    return value
