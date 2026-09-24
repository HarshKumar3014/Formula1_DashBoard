"""Event schedule + next-session lookup via fastf1."""
import logging
from datetime import datetime, timezone

import fastf1
import pandas as pd

from .. import jsoncache
from ..config import SEASON, SCHEDULE_TTL

log = logging.getLogger(__name__)

_SESSION_SLOTS = [1, 2, 3, 4, 5]


def build_schedule(season: int = SEASON) -> dict:
    sched = fastf1.get_event_schedule(season, include_testing=False)
    events = []
    for _, ev in sched.iterrows():
        sessions = []
        for i in _SESSION_SLOTS:
            name = ev.get(f"Session{i}")
            date = ev.get(f"Session{i}DateUtc")
            if not name or pd.isna(date):
                continue
            sessions.append({
                "name": name,
                "dateUtc": pd.Timestamp(date).tz_localize("UTC").isoformat()
                if pd.Timestamp(date).tzinfo is None else pd.Timestamp(date).isoformat(),
            })
        events.append({
            "round": int(ev["RoundNumber"]),
            "name": ev["EventName"],
            "officialName": ev.get("OfficialEventName"),
            "country": ev["Country"],
            "location": ev["Location"],
            "format": ev.get("EventFormat"),
            "dateUtc": pd.Timestamp(ev["EventDate"]).isoformat(),
            "sessions": sessions,
        })
    return {"season": season, "events": events}


def get_schedule(season: int = SEASON) -> dict:
    return jsoncache.get_or_build(f"schedule_{season}", SCHEDULE_TTL,
                                  lambda: build_schedule(season))


def get_next_session(season: int = SEASON) -> dict:
    """Next upcoming session + its event; also whether a session is likely live now."""
    schedule = get_schedule(season)
    now = datetime.now(timezone.utc)
    upcoming = None
    live = None
    last_completed = None
    for ev in schedule["events"]:
        for s in ev["sessions"]:
            start = datetime.fromisoformat(s["dateUtc"])
            # generous 3h window ⇒ "session in progress"
            if start <= now and (now - start).total_seconds() < 3 * 3600:
                live = {"event": ev["name"], "round": ev["round"],
                        "session": s["name"], "dateUtc": s["dateUtc"],
                        "country": ev["country"], "location": ev["location"]}
            if start > now and upcoming is None:
                upcoming = {"event": ev["name"], "round": ev["round"],
                            "session": s["name"], "dateUtc": s["dateUtc"],
                            "country": ev["country"], "location": ev["location"]}
            if start <= now and (now - start).total_seconds() >= 3 * 3600:
                last_completed = {"event": ev["name"], "round": ev["round"],
                                  "session": s["name"], "dateUtc": s["dateUtc"],
                                  "country": ev["country"], "location": ev["location"]}
        if upcoming:
            break
    return {"now": now.isoformat(), "next": upcoming, "live": live,
            "lastCompleted": last_completed, "season": schedule["season"]}
