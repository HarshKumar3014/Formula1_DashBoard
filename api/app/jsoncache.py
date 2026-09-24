"""Tiny JSON file cache with TTL. Keeps request paths off external APIs."""
import json
import time
from typing import Any, Callable

from .config import JSON_CACHE_DIR


def _path(key: str):
    safe = key.replace("/", "_").replace(":", "_")
    return JSON_CACHE_DIR / f"{safe}.json"


def get(key: str, ttl: float | None = None) -> Any | None:
    """Return cached value, or None if missing/expired. ttl=None → never expires."""
    p = _path(key)
    if not p.exists():
        return None
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
