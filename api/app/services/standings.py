"""Driver/constructor standings and current grid, via fastf1's Jolpica interface."""
import logging

from fastf1.ergast import Ergast

from .. import jsoncache
from ..config import SEASON, STANDINGS_TTL, DRIVERS_TTL, team_color

log = logging.getLogger(__name__)


def _first(row: dict, *keys, default=None):
    for k in keys:
        v = row.get(k)
        if v is None:
            continue
        # flattened list columns like constructorNames come back as lists
        if isinstance(v, list):
            if not v:
                continue
            return v[0]
        return v
    return default


def build_standings(season: int = SEASON) -> dict:
    ergast = Ergast(result_type="pandas", auto_cast=True)

    ds = ergast.get_driver_standings(season=season)
    cs = ergast.get_constructor_standings(season=season)

    meta = ds.description.to_dict("records")[0] if len(ds.description) else {}
    drivers = []
    for row in ds.content[0].to_dict("records") if ds.content else []:
        cid = _first(row, "constructorIds")
        cname = _first(row, "constructorNames")
        drivers.append({
            "position": int(row.get("position", 0)),
            "points": float(row.get("points", 0)),
            "wins": int(row.get("wins", 0)),
            "driverId": row.get("driverId"),
            "code": row.get("driverCode"),
            "number": row.get("driverNumber"),
            "name": f"{row.get('givenName', '')} {row.get('familyName', '')}".strip(),
            "nationality": row.get("driverNationality"),
            "team": cname,
            "teamColor": team_color(cid, cname),
        })

    constructors = []
    for row in cs.content[0].to_dict("records") if cs.content else []:
        cid = row.get("constructorId")
        cname = row.get("constructorName")
        constructors.append({
            "position": int(row.get("position", 0)),
            "points": float(row.get("points", 0)),
            "wins": int(row.get("wins", 0)),
            "constructorId": cid,
            "name": cname,
            "nationality": row.get("constructorNationality"),
            "teamColor": team_color(cid, cname),
        })

    return {
        "season": int(meta.get("season", season)),
        "round": int(meta.get("round", 0)),
        "drivers": drivers,
        "constructors": constructors,
    }


def get_standings(season: int = SEASON) -> dict:
    return jsoncache.get_or_build(f"standings_{season}", STANDINGS_TTL,
                                  lambda: build_standings(season))


def build_grid(season: int = SEASON) -> dict:
    """Current grid grouped by constructor, derived from driver standings."""
    standings = get_standings(season)
    teams: dict[str, dict] = {}
    for d in standings["drivers"]:
        key = d["team"] or "Unknown"
        teams.setdefault(key, {
            "team": key,
            "teamColor": d["teamColor"],
            "drivers": [],
        })["drivers"].append(d)
    # order teams by constructor standings position
    order = {c["name"]: c["position"] for c in standings["constructors"]}
    grid = sorted(teams.values(), key=lambda t: order.get(t["team"], 99))
    for t in grid:
        t["points"] = sum(dr["points"] for dr in t["drivers"])
        t["drivers"].sort(key=lambda dr: dr["position"])
    return {"season": standings["season"], "round": standings["round"], "teams": grid}


def get_grid(season: int = SEASON) -> dict:
    return jsoncache.get_or_build(f"grid_{season}", DRIVERS_TTL,
                                  lambda: build_grid(season))


def refresh(season: int = SEASON) -> None:
    """Force-refresh caches (called by the scheduler after race weekends)."""
    jsoncache.set(f"standings_{season}", build_standings(season))
    jsoncache.set(f"grid_{season}", build_grid(season))
    log.info("standings + grid refreshed for %s", season)
