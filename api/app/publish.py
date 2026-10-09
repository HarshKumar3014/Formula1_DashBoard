"""Precompute everything the dashboard shows and upload it to the storage CDN.

    python -m app.publish                # refresh small data + build what's missing
    python -m app.publish --only results # one kind of session artifact
    python -m app.publish --rebuild 16/R # force a session's artifacts again

Runs on a schedule in GitHub Actions (.github/workflows/publish-data.yml). Session
artifacts — results, an all-driver telemetry bundle and a replay per completed session —
are immutable, so each is built once (skipped when already in the manifest). Small,
changing data (schedule, standings, news, …) is re-uploaded every run.

Needs SUPABASE_URL and SUPABASE_SECRET_KEY (the project's secret key — never ship it
to the browser).
"""
import argparse
import gc
import json
import logging
import sys
import time
from datetime import datetime, timezone

import fastf1
import requests

from . import config, jsoncache

log = logging.getLogger("publish")

SESSION_TTL = "public, max-age=86400"  # immutable per session; a day keeps fixes possible
SMALL_TTL = "public, max-age=300"
KINDS = ("results", "telemetry", "replay")


class Storage:
    def __init__(self, url: str, key: str, bucket: str):
        self.base = f"{url}/storage/v1"
        self.bucket = bucket
        self.http = requests.Session()
        self.http.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})

    def ensure_bucket(self) -> None:
        r = self.http.post(f"{self.base}/bucket",
                           json={"id": self.bucket, "name": self.bucket, "public": True})
        if r.ok:
            log.info("created public bucket %s", self.bucket)
        elif "already exists" not in r.text.lower() and r.status_code not in (400, 409):
            r.raise_for_status()

    def put(self, key: str, value, cache_control: str) -> int:
        body = json.dumps(value, separators=(",", ":")).encode()
        path = f"{config.DATA_PREFIX}/{key}.json"
        for attempt in range(3):
            r = self.http.post(f"{self.base}/object/{self.bucket}/{path}", data=body, headers={
                "Content-Type": "application/json", "x-upsert": "true",
                "cache-control": cache_control}, timeout=120)
            if r.ok:
                return len(body)
            log.warning("upload %s failed (%s): %s", key, r.status_code, r.text[:200])
            time.sleep(2 * (attempt + 1))
        r.raise_for_status()
        return 0

    def manifest(self) -> dict:
        r = requests.get(f"{config.DATA_PUBLIC_URL}/manifest.json",
                         params={"t": int(time.time())}, timeout=15)  # bust the CDN copy
        return r.json() if r.ok else {}


def small_data(season: int) -> dict:
    """Fresh copies of the frequently-changing, cheap data."""
    from .aggregation import backfill
    from .services import news, results, schedule, standings, telemetry

    out: dict = {}
    sched = schedule.build_schedule(season)
    jsoncache.set(f"schedule_{season}", sched)
    out[f"schedule_{season}"] = sched
    try:
        standings.refresh(season)
        out[f"standings_{season}"] = standings.get_standings(season)
        out[f"grid_{season}"] = standings.get_grid(season)
    except Exception:
        log.exception("standings refresh failed — keeping the published copy")
    try:
        out["news_v2"] = news.build_news()
    except Exception:
        log.exception("news refresh failed — keeping the published copy")
    out[f"season_{season}"] = results.get_season(season)
    out[f"telemetry_options_{season}"] = telemetry.get_options(season)
    for key, value in ((f"circuit_stats_{season}", backfill.get_circuit_stats(season)),
                       ("records", backfill.get_records())):
        if value is not None:
            out[key] = value
    return out


def session_jobs(season: int, only: set[str]) -> list[tuple[str, str, callable]]:
    """(key, label, builder) for every artifact of every completed session."""
    from .services import replay, results, telemetry

    jobs = []
    for ev in results.get_season(season)["events"]:
        for s in ev["sessions"]:
            if not s["complete"]:
                continue
            r, c = ev["round"], s["code"]
            label = f"R{r} {c}"
            if "results" in only:
                jobs.append((f"results_{season}_{r}_{c}", label,
                             lambda r=r, c=c: results.get_session_results(season, r, c)))
            if "telemetry" in only:
                jobs.append((f"telemetry_{season}_{r}_{c}", label,
                             lambda r=r, c=c: telemetry.get_session_bundle(season, r, c)))
            if "replay" in only:
                jobs.append((f"replay_{season}_{r}_{c}", label,
                             lambda r=r, c=c: replay.get_replay(season, r, c)))
    # cheap artifacts first so a timeout still leaves results + telemetry published
    order = {k: i for i, k in enumerate(KINDS)}
    return sorted(jobs, key=lambda j: order[j[0].split("_")[0]])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", action="append", choices=KINDS,
                    help="limit session artifacts to these kinds (repeatable)")
    ap.add_argument("--rebuild", action="append", default=[], metavar="ROUND/CODE",
                    help="force-rebuild a session, e.g. 16/R (repeatable)")
    ap.add_argument("--max-builds", type=int, default=0,
                    help="stop after this many new session artifacts (0 = no limit)")
    ap.add_argument("--skip-small", action="store_true", help="don't refresh small data")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    logging.getLogger("fastf1").setLevel(logging.WARNING)
    if not (config.SUPABASE_URL and config.SUPABASE_SECRET_KEY):
        log.error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set")
        return 2

    config.ensure_dirs()
    fastf1.Cache.enable_cache(str(config.FF1_CACHE_DIR))
    # the publisher is the source of the CDN copy, so it never reads back from it
    jsoncache.DATA_PUBLIC_URL = ""
    season = config.SEASON
    store = Storage(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, config.STORAGE_BUCKET)
    store.ensure_bucket()
    published = set(store.manifest().get("keys", []))
    rebuild = {f"{season}_{x.replace('/', '_').upper()}" for x in args.rebuild}

    def save_manifest():
        store.put("manifest", {"updated": datetime.now(timezone.utc).isoformat(),
                               "season": season, "keys": sorted(published)}, "no-cache")

    if not args.skip_small:
        for key, value in small_data(season).items():
            size = store.put(key, value, SMALL_TTL)
            published.add(key)
            log.info("small  %-28s %7.1f KB", key, size / 1024)
        save_manifest()

    built = failed = 0
    for key, label, builder in session_jobs(season, set(args.only or KINDS)):
        forced = any(key.endswith(r) for r in rebuild)
        if key in published and not forced:
            continue
        if args.max_builds and built >= args.max_builds:
            log.info("--max-builds reached; the next run continues")
            break
        t0 = time.time()
        try:
            if forced:
                jsoncache._path(key).unlink(missing_ok=True)
            value = builder()
            size = store.put(key, value, SESSION_TTL)
        except Exception as exc:
            failed += 1
            log.warning("skip   %-28s %s: %s", key, label, exc)
            continue
        finally:
            gc.collect()  # fastf1 sessions are big; don't let them pile up
        published.add(key)
        built += 1
        log.info("built  %-28s %7.1f KB  %5.1fs", key, size / 1024, time.time() - t0)
        if built % 5 == 0:
            save_manifest()  # progress survives a cancelled run
    save_manifest()
    log.info("done: %d built, %d skipped with errors, %d keys published",
             built, failed, len(published))
    return 0


if __name__ == "__main__":
    sys.exit(main())
