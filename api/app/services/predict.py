"""Prediction game: pick the top 10 for every session of a weekend, scored once results land.

Sign-in is Supabase Auth (Google/GitHub); a player row links the Supabase user id to
the racing name shown on the leaderboard, chosen once on first sign-in.
"""
import logging
import re
import threading
from datetime import datetime, timezone

from sqlalchemy import and_, insert, select, update
from sqlalchemy.exc import IntegrityError

from .. import db
from ..config import SEASON
from . import results as res_svc

log = logging.getLogger(__name__)

PICKS = 10
# points per pick by distance from the actual finishing position
EXACT, OFF_BY_ONE, IN_TOP10 = 5, 3, 1
PODIUM_BONUS = 5      # P1–P3 all exact
PERFECT_BONUS = 25    # all ten exact
MAX_SESSION = PICKS * EXACT + PODIUM_BONUS + PERFECT_BONUS

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{1,18}[A-Za-z0-9]$")


class GameError(Exception):
    """User-facing validation error (→ HTTP 4xx)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------ players

def join(auth_id: str, name: str) -> dict:
    name = " ".join((name or "").split())
    if not NAME_RE.match(name):
        raise GameError("Name must be 3–20 characters: letters, numbers, space, _ . -")
    if player_for(auth_id):
        raise GameError("You already have a racing name.", 409)
    try:
        with db.engine.begin() as conn:
            pid = conn.execute(insert(db.players).values(
                name=name, name_key=name.lower(), auth_id=auth_id,
                created_at=_now())).inserted_primary_key[0]
    except IntegrityError:
        raise GameError(f"“{name}” is taken — pick another name.", 409)
    return {"id": pid, "name": name}


def player_for(auth_id: str | None) -> dict | None:
    if not auth_id:
        return None
    with db.engine.connect() as conn:
        row = conn.execute(select(db.players.c.id, db.players.c.name)
                           .where(db.players.c.auth_id == auth_id)).first()
    return {"id": row.id, "name": row.name} if row else None


# -------------------------------------------------------------------- event

def _drivers() -> list[dict]:
    """Current entry list: the last race's grid plus anyone in the latest session
    (FP1 rookies, mid-weekend substitutes)."""
    season = res_svc.get_season()
    found: dict[str, dict] = {}
    latest_seen = False
    for ev in reversed(season["events"]):
        for s in reversed(ev["sessions"]):
            cached = res_svc.cached_results(season["season"], ev["round"], s["code"])
            if not cached or (latest_seen and s["code"] != "R"):
                continue
            latest_seen = True
            for r in cached["rows"]:
                found.setdefault(r["code"], {k: r[k] for k in ("code", "name", "team",
                                                               "teamColor")})
            if s["code"] == "R":
                return sorted(found.values(), key=lambda d: (d["team"], d["code"]))
    if found:
        return sorted(found.values(), key=lambda d: (d["team"], d["code"]))
    from .standings import get_standings
    return [{"code": d["code"], "name": d["name"], "team": d["team"],
             "teamColor": d["teamColor"]} for d in get_standings()["drivers"]]


def _event(round_: int | None) -> dict:
    events = res_svc.get_season()["events"]
    if not events:
        raise GameError("No calendar published for this season yet.", 404)
    if round_ is None:
        # the first weekend whose race isn't over yet; after the finale, the last one
        ev = next((e for e in events if not all(s["complete"] for s in e["sessions"])),
                  events[-1])
    else:
        ev = next((e for e in events if e["round"] == round_), None)
        if ev is None:
            raise GameError(f"No round {round_} this season.", 404)
    return ev


def get_event(round_: int | None, player: dict | None) -> dict:
    score_pending()
    ev = _event(round_)
    now = _now()
    mine = {}
    if player:
        with db.engine.connect() as conn:
            for p in conn.execute(select(db.predictions).where(and_(
                    db.predictions.c.player_id == player["id"],
                    db.predictions.c.season == SEASON,
                    db.predictions.c.round == ev["round"]))):
                mine[p.session] = p
    sessions = []
    for s in ev["sessions"]:
        p = mine.get(s["code"])
        cached = res_svc.cached_results(SEASON, ev["round"], s["code"])
        sessions.append({
            **s,
            "locked": now >= datetime.fromisoformat(s["dateUtc"]),
            "picks": p.picks if p else None,
            "score": p.score if p else None,
            "detail": p.detail if p else None,
            "result": res_svc.top10(cached) if cached else None,
        })
    return {"season": SEASON, "round": ev["round"], "rounds": len(res_svc.get_season()["events"]),
            "name": ev["name"],
            "country": ev["country"], "location": ev["location"], "format": ev["format"],
            "sessions": sessions, "drivers": _drivers(),
            "scoring": {"exact": EXACT, "offByOne": OFF_BY_ONE, "inTop10": IN_TOP10,
                        "podiumBonus": PODIUM_BONUS, "perfectBonus": PERFECT_BONUS,
                        "max": MAX_SESSION}}


def save_picks(player: dict, round_: int, code: str, picks: list[str]) -> dict:
    ev = _event(round_)
    ses = next((s for s in ev["sessions"] if s["code"] == code), None)
    if ses is None:
        raise GameError(f"{ev['name']} has no {code} session.", 404)
    if _now() >= datetime.fromisoformat(ses["dateUtc"]):
        raise GameError(f"{ses['name']} has started — predictions are locked.", 423)
    picks = [str(c).upper() for c in picks]
    valid = {d["code"] for d in _drivers()}
    if len(picks) != PICKS or len(set(picks)) != PICKS:
        raise GameError(f"Pick exactly {PICKS} different drivers.")
    unknown = [c for c in picks if c not in valid]
    if unknown:
        raise GameError(f"Unknown driver(s): {', '.join(unknown)}")
    t = db.predictions.c
    key = and_(t.player_id == player["id"], t.season == SEASON,
               t.round == round_, t.session == code)
    with db.engine.begin() as conn:
        exists = conn.execute(select(t.id).where(key)).first()
        if exists:
            conn.execute(update(db.predictions).where(key)
                         .values(picks=picks, updated_at=_now()))
        else:
            conn.execute(insert(db.predictions).values(
                player_id=player["id"], season=SEASON, round=round_, session=code,
                picks=picks, updated_at=_now()))
    return {"round": round_, "session": code, "picks": picks}


# ------------------------------------------------------------------ scoring

def score(picks: list[str], actual: list[str]) -> tuple[int, list[dict]]:
    where = {c: i for i, c in enumerate(actual)}
    detail, total = [], 0
    for i, code in enumerate(picks):
        a = where.get(code)
        pts = 0 if a is None else EXACT if a == i else OFF_BY_ONE if abs(a - i) == 1 else IN_TOP10
        total += pts
        detail.append({"code": code, "predicted": i + 1,
                       "actual": None if a is None else a + 1, "points": pts})
    exact = [d["predicted"] == d["actual"] for d in detail]
    if all(exact[:3]):
        total += PODIUM_BONUS
    if len(actual) == PICKS and all(exact):
        total += PERFECT_BONUS
    return total, detail


_scoring_lock = threading.Lock()


def score_pending(build: bool = False) -> int:
    """Score every unscored prediction whose session results exist.

    With build=False only already-cached results are used (safe on the request
    path); missing ones are built in a background thread so the next request sees them.
    """
    t = db.predictions.c
    with db.engine.connect() as conn:
        pending = conn.execute(select(t.season, t.round, t.session)
                               .where(t.score.is_(None)).distinct()).all()
    if not pending:
        return 0
    dates = {(ev["round"], s["code"]): s["dateUtc"]
             for ev in res_svc.get_season()["events"] for s in ev["sessions"]}
    scored, missing = 0, False
    for season, round_, code in pending:
        date = dates.get((round_, code))
        if season != SEASON or not date or not res_svc.is_complete(code, date):
            continue
        results = res_svc.cached_results(season, round_, code)
        if results is None and build:
            try:
                results = res_svc.get_session_results(season, round_, code)
            except Exception as exc:
                log.info("results for R%s %s not ready: %s", round_, code, exc)
        if results is None:
            missing = True
            continue
        actual = res_svc.top10(results)
        key = and_(t.season == season, t.round == round_, t.session == code,
                   t.score.is_(None))
        with db.engine.begin() as conn:
            for p in conn.execute(select(db.predictions.c.id, t.picks).where(key)).all():
                pts, detail = score(p.picks, actual)
                conn.execute(update(db.predictions).where(db.predictions.c.id == p.id)
                             .values(score=pts, detail=detail))
                scored += 1
    if missing and not build and _scoring_lock.acquire(blocking=False):
        def run():
            try:
                score_pending(build=True)
            finally:
                _scoring_lock.release()
        threading.Thread(target=run, daemon=True, name="score-pending").start()
    if scored:
        log.info("scored %d predictions", scored)
    return scored


# -------------------------------------------------------------- leaderboard

def leaderboard(round_: int | None = None, player: dict | None = None) -> dict:
    score_pending()
    t = db.predictions.c
    q = (select(db.players.c.id, db.players.c.name, t.round, t.score, t.detail)
         .join(db.players, db.players.c.id == t.player_id)
         .where(t.season == SEASON))
    if round_ is not None:
        q = q.where(t.round == round_)
    board: dict[int, dict] = {}
    with db.engine.connect() as conn:
        for r in conn.execute(q):
            row = board.setdefault(r.id, {
                "id": r.id, "name": r.name, "points": 0, "played": 0, "pending": 0,
                "exact": 0, "winners": 0, "podiums": 0, "best": 0})
            if r.score is None:
                row["pending"] += 1
                continue
            row["played"] += 1
            row["points"] += r.score
            row["best"] = max(row["best"], r.score)
            detail = r.detail or []
            row["exact"] += sum(d["predicted"] == d["actual"] for d in detail)
            row["winners"] += bool(detail and detail[0]["predicted"] == detail[0]["actual"])
            row["podiums"] += all(d["predicted"] == d["actual"] for d in detail[:3])
    rows = sorted(board.values(), key=lambda r: (-r["points"], -r["exact"], r["name"].lower()))
    rank = 0
    for i, r in enumerate(rows):
        if i == 0 or (r["points"], r["exact"]) != (rows[i - 1]["points"], rows[i - 1]["exact"]):
            rank = i + 1
        r["rank"] = rank
        r["you"] = bool(player and player["id"] == r["id"])
        del r["id"]
    return {"season": SEASON, "round": round_, "rows": rows}
