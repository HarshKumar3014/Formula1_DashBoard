"""Replay builder: turn the last completed session into an animated timeline.

Produces a compact JSON bundle (track outline, 1 Hz car positions, per-lap
leaderboard, derived commentary events) that the frontend animates. Built once
per session and cached to disk — replay must always work, live is additive.
"""
import logging
import math

import fastf1
import numpy as np
import pandas as pd

from .. import jsoncache
from ..config import SEASON, team_color

log = logging.getLogger(__name__)

TRACK_STATUS_TEXT = {
    "1": ("green", "Track clear — green flag"),
    "2": ("yellow", "Yellow flag"),
    "4": ("sc", "Safety Car deployed"),
    "5": ("red", "RED FLAG — session stopped"),
    "6": ("vsc", "Virtual Safety Car deployed"),
    "7": ("vsc", "Virtual Safety Car ending"),
}


def _rotate(x, y, deg):
    rad = math.radians(deg)
    return (x * math.cos(rad) - y * math.sin(rad),
            x * math.sin(rad) + y * math.cos(rad))


def _fmt_laptime(td) -> str | None:
    if pd.isna(td):
        return None
    total = td.total_seconds()
    return f"{int(total // 60)}:{total % 60:06.3f}"


def _session_window(session, t0, t_start, t_end):
    """Green flag → chequered flag, falling back to the raw data window."""
    start, end = t_start, t_end
    try:
        status = session.session_status
        if status is not None and len(status):
            started = status[status["Status"] == "Started"]["Time"]
            if len(started):
                start = max(start, t0 + started.iloc[0] - pd.Timedelta(seconds=30))
            finished = status[status["Status"] == "Finished"]["Time"]
            if len(finished):
                end = min(end, t0 + finished.iloc[0] + pd.Timedelta(seconds=120))
    except Exception:
        log.debug("session status unavailable — using full position-data window")
    if end - start < pd.Timedelta(minutes=5):  # nonsense window → keep everything
        return t_start, t_end
    return start, end


def find_last_completed(season: int = SEASON) -> dict | None:
    """Most recent completed session, preferring the race of the latest past round."""
    from .schedule import get_next_session
    info = get_next_session(season)
    last = info.get("lastCompleted")
    if not last:
        return None
    return {"year": season, "round": last["round"], "session": last["session"],
            "event": last["event"]}


def build_replay(year: int, round_: int, ses: str) -> dict:
    session = fastf1.get_session(year, round_, ses)
    session.load(telemetry=True, weather=False, messages=True)
    t0 = session.t0_date  # absolute datetime for session t=0

    # driver meta (number → code/color)
    meta = {}
    for _, row in session.results.iterrows():
        num = str(row["DriverNumber"])
        meta[num] = {
            "code": row["Abbreviation"],
            "name": row["FullName"],
            "team": row["TeamName"],
            "color": f"#{row['TeamColor']}" if row.get("TeamColor")
                     else team_color(None, row.get("TeamName")),
        }

    # track outline + rotation from the session's fastest lap.
    # Circuit maps come from the MultiViewer API, which has no data for some
    # newer venues (e.g. Madring 2026) — fastf1 then raises instead of
    # returning None, so fall back to an unrotated map.
    try:
        circuit_info = session.get_circuit_info()
        rotation = circuit_info.rotation if circuit_info else 0.0
    except (AttributeError, ValueError):
        log.warning("no circuit info for %s — track map not rotated", session.event["EventName"])
        rotation = 0.0
    fl = session.laps.pick_fastest()
    tel = fl.get_telemetry()
    if len(tel) > 700:
        tel = tel.iloc[np.linspace(0, len(tel) - 1, 700).astype(int)]
    tx, ty = _rotate(tel["X"].to_numpy(), tel["Y"].to_numpy(), rotation)
    track = {"x": [round(v) for v in tx.tolist()], "y": [round(v) for v in ty.tolist()]}

    # 1 Hz car positions
    pos = session.pos_data  # dict: driver number → DataFrame(Date, X, Y, Status)
    starts, ends = [], []
    for df in pos.values():
        if len(df):
            starts.append(df["Date"].iloc[0])
            ends.append(df["Date"].iloc[-1])
    t_start, t_end = max(min(starts), t0), max(ends)

    # The position feed starts up to an hour before the session does; those
    # samples are cars in the garage (often literal 0/0 placeholders). Clip the
    # replay to the green flag → chequered flag window.
    t_start, t_end = _session_window(session, t0, t_start, t_end)
    seconds = pd.date_range(t_start, t_end, freq="1s")

    per_driver: dict[str, np.ndarray] = {}
    for num, df in pos.items():
        if num not in meta or not len(df):
            continue
        df = df.drop_duplicates(subset="Date").set_index("Date")
        # 0/0 means "position unknown" in the feed, not a point on the track
        df = df[(df["X"] != 0) | (df["Y"] != 0)]
        if not len(df):
            continue
        xi = np.interp(seconds.view("int64"), df.index.view("int64"), df["X"].to_numpy())
        yi = np.interp(seconds.view("int64"), df.index.view("int64"), df["Y"].to_numpy())
        rx, ry = _rotate(xi, yi, rotation)
        per_driver[meta[num]["code"]] = np.column_stack([rx, ry]).round(0)

    base_t = (t_start - t0).total_seconds()
    frames = []
    for i in range(len(seconds)):
        frames.append({
            "t": round(base_t + i, 1),
            "cars": {code: [int(arr[i][0]), int(arr[i][1])] for code, arr in per_driver.items()},
        })

    # per-lap leaderboard (race/sprint have Position; quali/practice → best-time order)
    laps = session.laps
    lap_boards = []
    if "Position" in laps.columns and laps["Position"].notna().any():
        for lap_n in sorted(laps["LapNumber"].dropna().unique()):
            ll = laps[laps["LapNumber"] == lap_n]
            board = []
            for _, lp in ll.iterrows():
                if pd.isna(lp["Position"]):
                    continue
                board.append({"code": lp["Driver"], "pos": int(lp["Position"]),
                              "lapTime": _fmt_laptime(lp["LapTime"])})
            board.sort(key=lambda b: b["pos"])
            t_lead = ll["Time"].min()
            if pd.isna(t_lead) or not board:
                continue
            lap_boards.append({"lap": int(lap_n), "t": round(t_lead.total_seconds(), 1),
                               "order": board})

    # ---- derived commentary events ----
    events = []

    # flags / SC / VSC from track status
    ts = session.track_status
    if ts is not None and len(ts):
        for _, row in ts.iterrows():
            status = str(row["Status"])
            if status in TRACK_STATUS_TEXT:
                kind, text = TRACK_STATUS_TEXT[status]
                events.append({"t": round(row["Time"].total_seconds(), 1),
                               "type": kind, "text": text})

    # pit stops
    for _, lp in laps.iterrows():
        if pd.notna(lp["PitInTime"]):
            events.append({"t": round(lp["PitInTime"].total_seconds(), 1), "type": "pit",
                           "text": f"{lp['Driver']} pits at the end of lap {int(lp['LapNumber'])}"})

    # fastest lap progression
    best = None
    for _, lp in laps.sort_values("Time").iterrows():
        if pd.isna(lp["LapTime"]) or pd.isna(lp["Time"]):
            continue
        if best is None or lp["LapTime"] < best:
            best = lp["LapTime"]
            events.append({"t": round(lp["Time"].total_seconds(), 1), "type": "fastlap",
                           "text": f"FASTEST LAP: {lp['Driver']} — {_fmt_laptime(lp['LapTime'])}"})

    # overtakes: position changes between consecutive laps
    if lap_boards:
        prev = {}
        for board in lap_boards:
            cur = {b["code"]: b["pos"] for b in board["order"]}
            for code, p in cur.items():
                if code in prev and p < prev[code]:
                    passed = [c for c, q in prev.items()
                              if q == p and c != code and cur.get(c, 99) > p]
                    if passed:
                        events.append({"t": board["t"], "type": "overtake",
                                       "text": f"{code} takes P{p} from {passed[0]} on lap {board['lap']}"})
            prev = cur

    events.sort(key=lambda e: e["t"])

    # race-control messages as commentary garnish
    try:
        rcm = session.race_control_messages
        if rcm is not None and len(rcm):
            for _, row in rcm.iterrows():
                if pd.isna(row.get("Time")):
                    continue
                t = (pd.Timestamp(row["Time"]) - t0).total_seconds()
                if 0 < t < base_t + len(frames):
                    events.append({"t": round(t, 1), "type": "rc",
                                   "text": str(row["Message"])[:160]})
    except Exception:
        log.debug("race control messages unavailable")
    events = [e for e in events if e["t"] >= base_t - 60]
    events.sort(key=lambda e: e["t"])

    return {
        "meta": {"year": year, "round": round_, "session": ses,
                 "event": session.event["EventName"],
                 "drivers": list(meta.values())},
        "track": track,
        "start": round(base_t, 1),
        "duration": len(frames),
        "frames": frames,
        "lapBoards": lap_boards,
        "events": events,
    }


def get_replay(year: int, round_: int, ses: str) -> dict:
    key = f"replay_{year}_{round_}_{ses}"
    return jsoncache.get_or_build(key, None, lambda: build_replay(year, round_, ses))
