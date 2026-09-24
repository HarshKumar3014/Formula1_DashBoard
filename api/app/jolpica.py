"""Minimal raw Jolpica (Ergast-compatible) HTTP client with polite pagination.

Used only by the offline backfill/aggregation jobs — never on the request path.
The volunteer-hosted API is rate limited; we sleep between pages and paginate
with the maximum page size to minimise request count.
"""
import time
import logging

import requests

from .config import JOLPICA_BASE, JOLPICA_PAGE_LIMIT, JOLPICA_REQUEST_DELAY

log = logging.getLogger(__name__)

_session = requests.Session()
_session.headers["User-Agent"] = "personal-f1-dashboard (self-hosted, cached)"


def fetch_all(path: str, table_key: str, list_key: str) -> list[dict]:
    """Fetch every page of an Ergast-style endpoint.

    path       e.g. "results/1"  (→ {base}/results/1.json)
    table_key  e.g. "RaceTable"
    list_key   e.g. "Races"
    """
    rows: list[dict] = []
    offset = 0
    while True:
        url = f"{JOLPICA_BASE}/{path}.json"
        resp = _session.get(
            url,
            params={"limit": JOLPICA_PAGE_LIMIT, "offset": offset},
            timeout=30,
        )
        if resp.status_code == 429:
            log.warning("Jolpica 429 — backing off 10s")
            time.sleep(10)
            continue
        resp.raise_for_status()
        data = resp.json()["MRData"]
        total = int(data["total"])
        batch = data[table_key].get(list_key, [])
        rows.extend(batch)
        offset += JOLPICA_PAGE_LIMIT
        log.info("jolpica %s: %d/%d", path, min(offset, total), total)
        if offset >= total or not batch:
            break
        time.sleep(JOLPICA_REQUEST_DELAY)
    return rows
