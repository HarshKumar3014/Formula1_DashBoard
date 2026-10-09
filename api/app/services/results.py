"""Classified results for every session of a race weekend (FP1–3, SQ, Sprint, Q, Race).

Results are immutable once a session is over, so each table is built once from
fastf1 and cached to disk forever. Practice has no official classification in
the feed, so it is ordered by each driver's best (non-deleted) lap.
"""
import logging
from datetime import datetime, timedelta, timezone

import fastf1
import pandas as pd

from .. import jsoncache
from ..config import SEASON, team_color

log = logging.getLogger(__name__)

# schedule session name → short code used in URLs / cache keys / predictions
SESSION_CODES = {
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
    "Sprint Qualifying": "SQ",
    "Sprint": "S",
    "Qualifying": "Q",
    "Race": "R",
}
CODE_NAMES = {v: k for k, v in SESSION_CODES.items()}
KIND = {"FP1": "practice", "FP2": "practice", "FP3": "practice",
        "SQ": "quali", "Q": "quali", "S": "race", "R": "race"}
# scheduled length + margin before the timing archive is complete enough to cache
_DONE_AFTER = {"practice": timedelta(hours=1, minutes=45),
               "quali": timedelta(hours=1, minutes=45),
               "race": timedelta(hours=3)}


def is_complete(code: str, date_utc: str, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    return now >= datetime.fromisoformat(date_utc) + _DONE_AFTER[KIND[code]]


def _fmt_lap(td) -> str | None:
    if td is None or pd.isna(td):
        return None
    s = td.total_seconds()
    return f"{int(s // 60)}:{s % 60:06.3f}"


def _fmt_total(td) -> str:
    s = td.total_seconds()
    return f"{int(s // 3600)}:{int(s % 3600 // 60):02d}:{s % 60:06.3f}"


def _int(v) -> int | None:
    return None if v is None or pd.isna(v) else int(v)


def _driver(row) -> dict:
    return {
        "code": row["Abbreviation"],
        "number": str(row["DriverNumber"]),
        "name": row["FullName"],
        "team": row["TeamName"],
        "teamColor": f"#{row['TeamColor']}" if row.get("TeamColor")
                     else team_color(None, row.get("TeamName")),
    }


def _race_rows(session) -> tuple[list[dict], dict | None]:
    res = session.results.sort_values("Position", na_position="last")
    if not res["Position"].notna().any():
        raise ValueError("no classification published yet")
    rows = []
    for _, r in res.iterrows():
        time = r["Time"]
        status = str(r["Status"]) if pd.notna(r["Status"]) else ""
        if pd.isna(time):
            gap = status or None
        elif _int(r["Position"]) == 1:
            gap = _fmt_total(time)
        else:
            gap = f"+{time.total_seconds():.3f}s"
        rows.append({**_driver(r),
                     "pos": _int(r["Position"]),
                     "classified": str(r["ClassifiedPosition"]),
                     "grid": _int(r["GridPosition"]),
                     "laps": _int(r["Laps"]),
                     "gap": gap,
                     "status": status,
                     "points": None if pd.isna(r["Points"]) else float(r["Points"])})
    fastest = None
    try:
        fl = session.laps.pick_fastest()
        if fl is not None and pd.notna(fl["LapTime"]):
            fastest = {"code": fl["Driver"], "time": _fmt_lap(fl["LapTime"]),
                       "lap": _int(fl["LapNumber"])}
    except Exception:
        log.debug("no fastest lap for %s", session)
    return rows, fastest


def _segment_times_from_laps(session) -> pd.DataFrame:
    """Q1/Q2/Q3 bests + knockout order derived from laps (Jolpica has no sprint quali)."""
    laps = session.laps
    if not len(laps):
        raise ValueError("no lap data published yet")
    res = session.results.copy()
    parts = laps.split_qualifying_sessions()
    for name, part in zip(("Q1", "Q2", "Q3"), parts):
        if part is None or not len(part):
            continue
        if "Deleted" in part.columns:
            part = part[part["Deleted"] != True]  # noqa: E712
        best = part.groupby("Driver")["LapTime"].min()
        res[name] = res["Abbreviation"].map(best)
    # knockout order: Q3 runners by Q3 time, then Q2 eliminations, then Q1
    res["_seg"] = res["Q3"].notna() * 2 + res["Q2"].notna() * 1
    res["_t"] = res["Q3"].fillna(res["Q2"]).fillna(res["Q1"])
    res = res.sort_values(["_seg", "_t"], ascending=[False, True], na_position="last")
    res["Position"] = range(1, len(res) + 1)
    return res


def _quali_rows(session) -> list[dict]:
    res = session.results.sort_values("Position", na_position="last")
    if not res["Position"].notna().any():
        res = _segment_times_from_laps(session)
    # gap is measured within the last segment each driver reached, like the TV graphic
    seg_best = {q: res[q].min() for q in ("Q1", "Q2", "Q3")}
    rows = []
    for _, r in res.iterrows():
        seg = next((q for q in ("Q3", "Q2", "Q1") if pd.notna(r[q])), None)
        delta = (r[seg] - seg_best[seg]).total_seconds() if seg else None
        rows.append({**_driver(r),
                     "pos": _int(r["Position"]),
                     "q1": _fmt_lap(r["Q1"]), "q2": _fmt_lap(r["Q2"]), "q3": _fmt_lap(r["Q3"]),
                     "gap": f"+{delta:.3f}s" if delta else None})
    return rows


def _practice_rows(session) -> list[dict]:
    laps = session.laps
    if not len(laps):
        raise ValueError("no lap data published yet")
    if "Deleted" in laps.columns:
        laps = laps[laps["Deleted"] != True]  # noqa: E712 — column holds True/False/NaN
    best = laps.groupby("Driver")["LapTime"].min()
    counts = session.laps.groupby("Driver")["LapNumber"].count()
    by_code = {r["Abbreviation"]: r for _, r in session.results.iterrows()}
    timed = best.dropna().sort_values()
    order = list(timed.index) + [c for c in by_code if c not in timed.index]
    leader = timed.iloc[0] if len(timed) else None
    rows = []
    for i, code in enumerate(order):
        if code not in by_code:
            continue
        t = best.get(code)
        rows.append({**_driver(by_code[code]),
                     "pos": i + 1 if code in timed.index else None,
                     "best": _fmt_lap(t),
                     "gap": None if t is None or pd.isna(t) or t == leader
                            else f"+{(t - leader).total_seconds():.3f}s",
                     "laps": _int(counts.get(code))})
    return rows


def build_session_results(year: int, round_: int, code: str) -> dict:
    kind = KIND[code]
    session = fastf1.get_session(year, round_, CODE_NAMES[code])
    session.load(laps=True, telemetry=False, weather=False, messages=False)
    out = {"year": year, "round": round_, "session": code, "sessionName": CODE_NAMES[code],
           "kind": kind, "event": session.event["EventName"], "fastestLap": None}
    if kind == "race":
        out["rows"], out["fastestLap"] = _race_rows(session)
    elif kind == "quali":
        out["rows"] = _quali_rows(session)
    else:
        out["rows"] = _practice_rows(session)
    return out


def _cache_key(year: int, round_: int, code: str) -> str:
    return f"results_{year}_{round_}_{code}"


def cached_results(year: int, round_: int, code: str) -> dict | None:
    return jsoncache.get(_cache_key(year, round_, code))


def get_session_results(year: int, round_: int, code: str) -> dict:
    return jsoncache.get_or_build(_cache_key(year, round_, code), None,
                                  lambda: build_session_results(year, round_, code))


def top10(results: dict) -> list[str]:
    """Finishing order codes, top 10, as used for scoring predictions."""
    rows = [r for r in results["rows"] if r.get("pos")]
    return [r["code"] for r in sorted(rows, key=lambda r: r["pos"])[:10]]


def get_season(season: int = SEASON) -> dict:
    """Every round with its sessions' status + race podium where already cached."""
    from .schedule import get_schedule
    now = datetime.now(timezone.utc)
    events = []
    for ev in get_schedule(season)["events"]:
        sessions = []
        for s in ev["sessions"]:
            code = SESSION_CODES.get(s["name"])
            if not code:
                continue
            sessions.append({"code": code, "name": s["name"], "dateUtc": s["dateUtc"],
                             "complete": is_complete(code, s["dateUtc"], now)})
        podium = None
        race = cached_results(season, ev["round"], "R")
        if race:
            podium = [{k: r[k] for k in ("code", "name", "teamColor")}
                      for r in race["rows"][:3]]
        events.append({"round": ev["round"], "name": ev["name"], "country": ev["country"],
                       "location": ev["location"], "format": ev["format"],
                       "dateUtc": ev["dateUtc"], "sessions": sessions, "podium": podium})
    return {"season": season, "events": events}


def warm_completed(season: int = SEASON) -> int:
    """Build any missing results for completed sessions, one at a time (memory-light)."""
    built = 0
    for ev in get_season(season)["events"]:
        for s in ev["sessions"]:
            if not s["complete"] or cached_results(season, ev["round"], s["code"]):
                continue
            try:
                get_session_results(season, ev["round"], s["code"])
                built += 1
                log.info("results built: %s R%s %s", season, ev["round"], s["code"])
            except Exception as exc:
                log.warning("results R%s %s not available yet: %s", ev["round"], s["code"], exc)
    return built
