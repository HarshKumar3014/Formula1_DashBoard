"""Session telemetry: per-driver fastest-lap traces + speed-colored track map.

Session data is immutable once complete → one all-drivers bundle per session, cached
forever (and published to the storage CDN by app.publish).
Telemetry only exists from 2018 onwards (surfaced to the UI via /options).
"""
import logging
import math

import fastf1
import numpy as np
import pandas as pd

from .. import jsoncache
from ..config import SEASON, team_color

log = logging.getLogger(__name__)

TELEMETRY_MIN_YEAR = 2018
SESSION_IDS = ["FP1", "FP2", "FP3", "Q", "S", "R"]


def _rotate(x: np.ndarray, y: np.ndarray, deg: float) -> tuple[np.ndarray, np.ndarray]:
    rad = math.radians(deg)
    return (x * math.cos(rad) - y * math.sin(rad),
            x * math.sin(rad) + y * math.cos(rad))


def _downsample(df: pd.DataFrame, n: int = 600) -> pd.DataFrame:
    if len(df) <= n:
        return df
    idx = np.linspace(0, len(df) - 1, n).astype(int)
    return df.iloc[idx]


def fastest_with_telemetry(laps, tries: int = 5):
    """(lap, telemetry) for the quickest lap whose car data actually loads.

    fastf1 occasionally can't slice telemetry for a lap (gaps in the feed → "None of
    ['Date'] are in the columns"), so fall back to the next-quickest laps.
    """
    timed = laps[laps["LapTime"].notna()].sort_values("LapTime")
    for i in range(min(tries, len(timed))):
        lap = timed.iloc[i]  # .iloc keeps fastf1's Lap type (iterrows would drop the session)
        try:
            return lap, lap.get_telemetry()
        except (KeyError, ValueError):
            continue
    return None, None


def car_data_only(laps):
    """(lap, car data + distance) for the fastest lap when position data is missing
    (e.g. 2026 Monaco race) — every channel but the X/Y car path."""
    timed = laps[laps["LapTime"].notna()].sort_values("LapTime")
    if not len(timed):
        return None, None
    lap = timed.iloc[0]
    try:
        tel = lap.get_car_data().add_distance()
    except (KeyError, ValueError):
        return None, None
    return (lap, tel) if len(tel) else (None, None)


def get_options(season: int = SEASON) -> dict:
    """Events available for telemetry (past events of the season)."""
    from .schedule import get_schedule
    from datetime import datetime, timezone
    schedule = get_schedule(season)
    now = datetime.now(timezone.utc)
    events = []
    for ev in schedule["events"]:
        past_sessions = [s["name"] for s in ev["sessions"]
                         if datetime.fromisoformat(s["dateUtc"]) < now]
        if past_sessions:
            events.append({"round": ev["round"], "name": ev["name"],
                           "country": ev["country"], "sessions": past_sessions})
    return {"season": season, "minYear": TELEMETRY_MIN_YEAR, "maxYear": SEASON,
            "events": events}


def get_session_drivers(year: int, round_: int, ses: str) -> dict:
    def build():
        session = fastf1.get_session(year, round_, ses)
        session.load(telemetry=False, weather=False, messages=False)
        drivers = []
        for _, row in session.results.iterrows():
            drivers.append({
                "code": row.get("Abbreviation"),
                "number": str(row.get("DriverNumber")),
                "name": row.get("FullName"),
                "team": row.get("TeamName"),
                "teamColor": f"#{row.get('TeamColor')}" if row.get("TeamColor")
                              else team_color(None, row.get("TeamName")),
                "position": None if pd.isna(row.get("Position")) else int(row.get("Position")),
            })
        return {"year": year, "round": round_, "session": ses,
                "event": session.event["EventName"], "drivers": drivers}
    return jsoncache.get_or_build(f"drivers_{year}_{round_}_{ses}", None, build)


def build_session_bundle(year: int, round_: int, ses: str) -> dict:
    """Fastest-lap traces for every driver in a session, so any comparison is instant."""
    session = fastf1.get_session(year, round_, ses)
    session.load(telemetry=True, weather=False, messages=False)
    try:
        rotation = session.get_circuit_info().rotation
    except (AttributeError, ValueError, KeyError):  # no MultiViewer map / unusable fastest lap
        rotation = 0.0
    drivers, traces = [], []
    for _, row in session.results.iterrows():
        code = row.get("Abbreviation")
        color = (f"#{row.get('TeamColor')}" if row.get("TeamColor")
                 else team_color(None, row.get("TeamName")))
        drivers.append({
            "code": code, "number": str(row.get("DriverNumber")), "name": row.get("FullName"),
            "team": row.get("TeamName"), "teamColor": color,
            "position": None if pd.isna(row.get("Position")) else int(row.get("Position")),
        })
        driver_laps = session.laps.pick_drivers(code)
        lap, tel = fastest_with_telemetry(driver_laps)
        if lap is None:
            lap, tel = car_data_only(driver_laps)
        if lap is None:
            continue
        tel = _downsample(tel)
        if "X" in tel.columns:
            x, y = _rotate(tel["X"].to_numpy(), tel["Y"].to_numpy(), rotation)
        else:
            x, y = np.array([]), np.array([])
        secs = tel["Time"].dt.total_seconds()
        traces.append({
            "code": code, "name": row.get("FullName"), "team": row.get("TeamName"),
            "color": color,
            "lapTime": f"{int(lap['LapTime'].total_seconds() // 60)}:"
                       f"{lap['LapTime'].total_seconds() % 60:06.3f}",
            "lapSeconds": round(lap["LapTime"].total_seconds(), 3),
            "lapNumber": int(lap["LapNumber"]),
            "compound": lap.get("Compound"),
            "distance": [round(v, 1) for v in tel["Distance"].tolist()],
            # seconds since lap start — enables client-side delta computation
            "time": [round(v, 3) for v in (secs - secs.iloc[0]).tolist()],
            "speed": tel["Speed"].fillna(0).astype(int).tolist(),
            "throttle": tel["Throttle"].fillna(0).astype(int).tolist(),
            "brake": tel["Brake"].astype(int).tolist(),
            "gear": tel["nGear"].fillna(0).astype(int).tolist(),
            "rpm": tel["RPM"].fillna(0).astype(int).tolist(),
            "drs": [1 if v in (10, 12, 14) else 0 for v in tel["DRS"].fillna(0)],
            # rotated car path, so the speed map can be drawn from any driver's lap
            "x": [round(v) for v in x.tolist()],
            "y": [round(v) for v in y.tolist()],
        })
    return {"year": year, "round": round_, "session": ses,
            "event": session.event["EventName"], "drivers": drivers, "traces": traces}


def get_session_bundle(year: int, round_: int, ses: str) -> dict:
    if year < TELEMETRY_MIN_YEAR:
        raise ValueError(f"Telemetry only exists from {TELEMETRY_MIN_YEAR} onwards.")
    return jsoncache.get_or_build(f"telemetry_{year}_{round_}_{ses}", None,
                                  lambda: build_session_bundle(year, round_, ses))


def get_telemetry(year: int, round_: int, ses: str, codes: list[str]) -> dict:
    """Comparison for up to 4 drivers, cut from the session bundle."""
    if year < TELEMETRY_MIN_YEAR:
        return {"error": f"Telemetry only exists from {TELEMETRY_MIN_YEAR} onwards.",
                "year": year}
    codes = sorted(set(codes))[:4]
    bundle = get_session_bundle(year, round_, ses)
    picked = [t for t in bundle["traces"] if t["code"] in codes]
    fastest = min(picked, key=lambda t: t["lapSeconds"], default=None)
    track = ({"x": fastest["x"], "y": fastest["y"], "distance": fastest["distance"],
              "speed": fastest["speed"]} if fastest else None)
    return {"year": year, "round": round_, "session": ses, "event": bundle["event"],
            "drivers": [{k: v for k, v in t.items() if k not in ("x", "y")} for t in picked],
            "track": track}
