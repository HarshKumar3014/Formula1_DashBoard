"""Player profiles: favourites, news preferences and prediction stats."""
from datetime import datetime, timezone

from sqlalchemy import func, insert, select, update

from .. import db
from ..config import SEASON, TEAMS, team_color
from . import predict

MAX_FAV_DRIVERS = 3
MAX_FAV_TEAMS = 2
TEAM_IDS = [tid for tid, _, _ in TEAMS]


def teams() -> list[dict]:
    return [{"id": tid, "name": name, "color": team_color(tid)} for tid, name, _ in TEAMS]


def options() -> dict:
    """Everything the profile editor can offer — the same sets update_profile accepts."""
    from ..aggregation import backfill
    circuits = (backfill.get_circuit_stats() or {}).get("circuits", [])
    return {
        "teams": teams(),
        "drivers": predict._drivers(),
        "tracks": [{"id": c["circuitId"], "name": c["name"], "locality": c["locality"],
                    "country": c["country"]} for c in circuits],
        "limits": {"favDrivers": MAX_FAV_DRIVERS, "favTeams": MAX_FAV_TEAMS},
    }


def _row(player_id: int):
    with db.engine.connect() as conn:
        return conn.execute(select(db.profiles)
                            .where(db.profiles.c.player_id == player_id)).first()


def _upsert(player_id: int, **values) -> None:
    values["updated_at"] = datetime.now(timezone.utc)
    with db.engine.begin() as conn:
        exists = conn.execute(select(db.profiles.c.player_id)
                              .where(db.profiles.c.player_id == player_id)).first()
        if exists:
            conn.execute(update(db.profiles)
                         .where(db.profiles.c.player_id == player_id).values(**values))
        else:
            conn.execute(insert(db.profiles).values(
                player_id=player_id,
                **{"news_teams": [], "fav_drivers": [], "fav_teams": [], **values}))


def sync_avatar(player: dict, claims: dict) -> None:
    """Keep the provider avatar (Google/GitHub) current so public profiles can show it."""
    meta = claims.get("user_metadata") or {}
    url = meta.get("avatar_url") or meta.get("picture")
    if not url:
        return
    row = _row(player["id"])
    if row is None or row.avatar_url != url:
        _upsert(player["id"], avatar_url=str(url)[:512])


def _stats(player_id: int) -> dict:
    board = predict.leaderboard()
    # leaderboard rows don't carry ids; match by name, which is unique
    with db.engine.connect() as conn:
        name = conn.execute(select(db.players.c.name)
                            .where(db.players.c.id == player_id)).scalar_one()
        t = db.predictions.c
        rounds = conn.execute(
            select(t.round, func.count(), func.sum(t.score))
            .where(t.player_id == player_id, t.season == SEASON)
            .group_by(t.round).order_by(t.round)).all()
    row = next((r for r in board["rows"] if r["name"] == name), None)
    names = {e["round"]: e["name"] for e in predict.res_svc.get_season()["events"]}
    return {
        "rank": row["rank"] if row else None,
        "players": len(board["rows"]),
        "points": row["points"] if row else 0,
        "played": row["played"] if row else 0,
        "exact": row["exact"] if row else 0,
        "winners": row["winners"] if row else 0,
        "podiums": row["podiums"] if row else 0,
        "best": row["best"] if row else 0,
        "rounds": [{"round": r, "event": names.get(r), "sessions": n, "points": pts or 0}
                   for r, n, pts in rounds],
    }


def get_profile(player: dict, private: bool = False) -> dict:
    row = _row(player["id"])
    out = {
        "name": player["name"],
        "avatarUrl": row.avatar_url if row else None,
        "favDrivers": row.fav_drivers if row else [],
        "favTeams": row.fav_teams if row else [],
        "favTrack": row.fav_track if row else None,
        "stats": _stats(player["id"]),
    }
    if private:
        out["newsTeams"] = row.news_teams if row else []
    return out


def public_profile(name: str) -> dict:
    with db.engine.connect() as conn:
        row = conn.execute(select(db.players.c.id, db.players.c.name)
                           .where(db.players.c.name_key == name.strip().lower())).first()
    if row is None:
        raise predict.GameError(f"No player called “{name}”.", 404)
    return get_profile({"id": row.id, "name": row.name})


def update_profile(player: dict, news_teams: list[str], fav_drivers: list[str],
                   fav_teams: list[str], fav_track: str | None) -> dict:
    def clean(values: list[str], valid: set[str], limit: int, what: str) -> list[str]:
        out = list(dict.fromkeys(values))  # dedupe, keep order
        bad = [v for v in out if v not in valid]
        if bad:
            raise predict.GameError(f"Unknown {what}: {', '.join(bad)}")
        if len(out) > limit:
            raise predict.GameError(f"Pick at most {limit} {what}.")
        return out

    team_ids = set(TEAM_IDS)
    drivers = {d["code"] for d in predict._drivers()}
    news_teams = clean(news_teams, team_ids, len(team_ids), "teams")
    fav_teams = clean(fav_teams, team_ids, MAX_FAV_TEAMS, "teams")
    fav_drivers = clean([c.upper() for c in fav_drivers], drivers, MAX_FAV_DRIVERS, "drivers")
    if fav_track:
        from ..aggregation import backfill
        circuits = {c["circuitId"] for c in (backfill.get_circuit_stats() or {}).get("circuits", [])}
        if circuits and fav_track not in circuits:
            raise predict.GameError(f"Unknown track: {fav_track}")
    _upsert(player["id"], news_teams=news_teams, fav_drivers=fav_drivers,
            fav_teams=fav_teams, fav_track=fav_track or None)
    return get_profile(player, private=True)
