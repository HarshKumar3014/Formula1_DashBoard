"""Session telemetry: per-driver fastest-lap traces + speed-colored track map.

Session data is immutable once complete → cached to disk forever.
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


def get_telemetry(year: int, round_: int, ses: str, codes: list[str]) -> dict:
    if year < TELEMETRY_MIN_YEAR:
        return {"error": f"Telemetry only exists from {TELEMETRY_MIN_YEAR} onwards.",
                "year": year}
    codes = sorted(set(codes))[:4]

    def build():
        session = fastf1.get_session(year, round_, ses)
        session.load(telemetry=True, weather=False, messages=False)
        drivers_meta = {d["code"]: d for d in
                        get_session_drivers(year, round_, ses)["drivers"]}
        out_drivers = []
        fastest_overall = None
        for code in codes:
            laps = session.laps.pick_drivers(code)
            if not len(laps):
                continue
            lap = laps.pick_fastest()
            if lap is None or pd.isna(lap["LapTime"]):
                continue
            tel = _downsample(lap.get_telemetry())
            meta = drivers_meta.get(code, {})
            out_drivers.append({
                "code": code,
                "name": meta.get("name", code),
                "team": meta.get("team"),
                "color": meta.get("teamColor", "#9CA3AF"),
                "lapTime": f"{int(lap['LapTime'].total_seconds() // 60)}:"
                           f"{lap['LapTime'].total_seconds() % 60:06.3f}",
                "lapNumber": int(lap["LapNumber"]),
                "compound": lap.get("Compound"),
                "distance": [round(v, 1) for v in tel["Distance"].tolist()],
                # seconds since lap start — enables client-side delta computation
                "time": [round(v, 3) for v in
                         (tel["Time"].dt.total_seconds() - tel["Time"].dt.total_seconds().iloc[0]).tolist()],
                "speed": tel["Speed"].fillna(0).astype(int).tolist(),
                "throttle": tel["Throttle"].fillna(0).astype(int).tolist(),
                "brake": tel["Brake"].astype(int).tolist(),
                "gear": tel["nGear"].fillna(0).astype(int).tolist(),
                "rpm": tel["RPM"].fillna(0).astype(int).tolist(),
                "drs": [1 if v in (10, 12, 14) else 0 for v in tel["DRS"].fillna(0)],
            })
            if fastest_overall is None or lap["LapTime"] < fastest_overall["LapTime"]:
                fastest_overall = lap

        track = None
        if fastest_overall is not None:
            tel = _downsample(fastest_overall.get_telemetry(), 800)
            rotation = session.get_circuit_info().rotation
            x, y = _rotate(tel["X"].to_numpy(), tel["Y"].to_numpy(), rotation)
            track = {"x": [round(v, 0) for v in x.tolist()],
                     "y": [round(v, 0) for v in y.tolist()],
                     "distance": [round(v, 1) for v in tel["Distance"].tolist()],
                     "speed": tel["Speed"].fillna(0).astype(int).tolist()}

        return {"year": year, "round": round_, "session": ses,
                "event": session.event["EventName"],
                "drivers": out_drivers, "track": track}

    key = f"telemetry_{year}_{round_}_{ses}_{'-'.join(codes)}"
    return jsoncache.get_or_build(key, None, build)
