"""F1 news via public RSS feeds. Keyword-filtered per-team columns, deduped, 15-min cache."""
import calendar
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import feedparser

from .. import jsoncache
from ..config import NEWS_FEEDS, NEWS_CACHE_TTL, TEAM_NEWS_KEYWORDS

log = logging.getLogger(__name__)


def _parse_feed(source: str, url: str) -> list[dict]:
    parsed = feedparser.parse(url)
    items = []
    for e in parsed.entries[:30]:
        published = None
        for attr in ("published_parsed", "updated_parsed"):
            t = getattr(e, attr, None)
            if t:
                published = calendar.timegm(t)
                break
        items.append({
            "title": (e.get("title") or "").strip(),
            "link": e.get("link"),
            "summary": (e.get("summary") or "")[:280],
            "source": source,
            "published": published,
        })
    return items


def build_news() -> dict:
    all_items: list[dict] = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(_parse_feed, name, url): name for name, url in NEWS_FEEDS}
        for fut in as_completed(futures):
            try:
                all_items.extend(fut.result())
            except Exception:
                log.exception("feed %s failed", futures[fut])

    # dedupe by normalised title / link
    seen: set[str] = set()
    deduped = []
    for item in all_items:
        key = (item["title"].lower(), item["link"])
        if not item["title"] or str(key) in seen:
            continue
        seen.add(str(key))
        deduped.append(item)
    deduped.sort(key=lambda i: i["published"] or 0, reverse=True)

    def team_filter(team: str) -> list[dict]:
        kws = TEAM_NEWS_KEYWORDS[team]
        return [i for i in deduped
                if any(kw in (i["title"] + " " + i["summary"]).lower() for kw in kws)][:8]

    return {
        "top": deduped[:6],
        "ferrari": team_filter("ferrari"),
        "mercedes": team_filter("mercedes"),
        "count": len(deduped),
    }


def get_news() -> dict:
    return jsoncache.get_or_build("news", NEWS_CACHE_TTL, build_news)
