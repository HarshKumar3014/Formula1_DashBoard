"""Backfill + aggregate historical F1 data (1950–present) into SQLite.

Design: instead of crawling every race (~1100+ requests), we use Ergast-style
filtered endpoints so the full backfill costs ~50 paginated requests total:

  results/1        → every race win ever          (winners, per-circuit wins, last winner)
  results/2,3      → podium finishers             (podium counts)
  grid/1/results   → every start from grid P1     (pole proxy; qualifying data pre-1994 doesn't exist)
  fastest/1/results→ every fastest-lap award      (per-circuit fastest lap; reliable 2004+)
  driverstandings/1→ champion per season
  constructorstandings/1 → constructors' champion per season
  {season}/circuits→ current-season circuit list

Everything lands in SQLite; the API request path reads precomputed JSON only.
"""
import json
import logging
import sqlite3
import time
from datetime import date

from .. import jolpica, jsoncache
from ..config import DB_PATH, SEASON

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS race_rows (
    kind TEXT NOT NULL,            -- win | p2 | p3 | pole | fastlap
    season INTEGER, round INTEGER,
    race_name TEXT, race_date TEXT,
    circuit_id TEXT, circuit_name TEXT, locality TEXT, country TEXT,
    driver_id TEXT, driver_name TEXT, driver_code TEXT, driver_dob TEXT,
    constructor_id TEXT, constructor_name TEXT,
    lap_time TEXT,                 -- fastest lap time (fastlap rows)
    PRIMARY KEY (kind, season, round)
);
CREATE TABLE IF NOT EXISTS champions (
    kind TEXT NOT NULL,            -- driver | constructor
    season INTEGER,
    entity_id TEXT, entity_name TEXT, driver_dob TEXT,
    points REAL, wins INTEGER,
    PRIMARY KEY (kind, season)
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_rows_circuit ON race_rows (circuit_id, kind);
CREATE INDEX IF NOT EXISTS idx_rows_driver ON race_rows (driver_id, kind);
"""


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    return conn


def _driver_fields(d: dict) -> tuple:
    name = f"{d.get('givenName', '')} {d.get('familyName', '')}".strip()
    return (d.get("driverId"), name, d.get("code"), d.get("dateOfBirth"))


def _insert_result_rows(conn: sqlite3.Connection, kind: str, races: list[dict]) -> None:
    rows = []
    for race in races:
        results = race.get("Results") or race.get("QualifyingResults") or []
        if not results:
            continue
        res = results[0]
        circ = race.get("Circuit", {})
        loc = circ.get("Location", {})
        lap_time = (res.get("FastestLap", {}).get("Time", {}) or {}).get("time")
        rows.append((
            kind, int(race["season"]), int(race["round"]),
            race.get("raceName"), race.get("date"),
            circ.get("circuitId"), circ.get("circuitName"),
            loc.get("locality"), loc.get("country"),
            *_driver_fields(res.get("Driver", {})),
            res.get("Constructor", {}).get("constructorId"),
            res.get("Constructor", {}).get("name"),
            lap_time,
        ))
    conn.executemany(
        "INSERT OR REPLACE INTO race_rows VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    conn.commit()  # commit per dataset so a later failure can't roll this back
    log.info("stored %d %s rows", len(rows), kind)


def run_backfill() -> None:
    """Full (re-)build. ~50 requests; run rarely (initial + weekly after races)."""
    conn = _conn()
    try:
        for kind, path in [("win", "results/1"), ("p2", "results/2"), ("p3", "results/3"),
                           ("pole", "grid/1/results"), ("fastlap", "fastest/1/results")]:
            races = jolpica.fetch_all(path, "RaceTable", "Races")
            _insert_result_rows(conn, kind, races)

        backfill_champions(conn)

        circuits = jolpica.fetch_all(f"{SEASON}/circuits", "CircuitTable", "Circuits")
        conn.execute("INSERT OR REPLACE INTO kv VALUES (?,?)",
                     (f"circuits_{SEASON}", json.dumps(circuits)))
        conn.commit()
    finally:
        conn.close()

    compute_circuit_stats()
    compute_records()
    log.info("backfill complete")


def backfill_champions(conn: sqlite3.Connection) -> None:
    """Champion per completed season. Jolpica requires a season in the path,
    so this loops seasons — but incrementally: only seasons missing from the DB."""
    last_completed = SEASON - 1
    done = {r[0] for r in conn.execute(
        "SELECT season FROM champions WHERE kind='driver'").fetchall()}
    missing = [y for y in range(1950, last_completed + 1) if y not in done]
    log.info("champions: %d seasons to fetch", len(missing))
    for year in missing:
        for kind, path, entry_key in [
                ("driver", f"{year}/driverstandings/1", "DriverStandings"),
                ("constructor", f"{year}/constructorstandings/1", "ConstructorStandings")]:
            if kind == "constructor" and year < 1958:  # constructors' title started 1958
                continue
            try:
                sls = jolpica.fetch_all(path, "StandingsTable", "StandingsLists")
            except Exception:
                log.warning("champions fetch failed for %s", path, exc_info=True)
                continue
            if not sls or not sls[0].get(entry_key):
                continue
            e = sls[0][entry_key][0]
            if kind == "driver":
                did, name, _, dob = _driver_fields(e.get("Driver", {}))
                row = ("driver", year, did, name, dob,
                       float(e.get("points", 0)), int(e.get("wins", 0)))
            else:
                c = e.get("Constructor", {})
                row = ("constructor", year, c.get("constructorId"), c.get("name"), None,
                       float(e.get("points", 0)), int(e.get("wins", 0)))
            conn.execute("INSERT OR REPLACE INTO champions VALUES (?,?,?,?,?,?,?)", row)
        conn.commit()
        time.sleep(0.3)


# ---------------------------------------------------------------- aggregates

def _top(conn, sql, params=()) -> list[dict]:
    cur = conn.execute(sql, params)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def compute_circuit_stats(season: int = SEASON) -> dict:
    """Per-circuit stats for the current season's calendar → JSON cache."""
    conn = _conn()
    try:
        raw = conn.execute("SELECT value FROM kv WHERE key=?", (f"circuits_{season}",)).fetchone()
        circuits = json.loads(raw[0]) if raw else []
        out = []
        for c in circuits:
            cid = c["circuitId"]
            last_win = _top(conn, """SELECT season, race_name, race_date, driver_name, constructor_name
                FROM race_rows WHERE kind='win' AND circuit_id=? ORDER BY race_date DESC LIMIT 1""", (cid,))
            most_wins = _top(conn, """SELECT driver_name, COUNT(*) n FROM race_rows
                WHERE kind='win' AND circuit_id=? GROUP BY driver_id ORDER BY n DESC, MAX(race_date) DESC LIMIT 1""", (cid,))
            most_poles = _top(conn, """SELECT driver_name, COUNT(*) n FROM race_rows
                WHERE kind='pole' AND circuit_id=? GROUP BY driver_id ORDER BY n DESC, MAX(race_date) DESC LIMIT 1""", (cid,))
            # fastest race lap ever officially recorded at this circuit (2004+ reliable)
            fastest = _top(conn, """SELECT driver_name, lap_time, season FROM race_rows
                WHERE kind='fastlap' AND circuit_id=? AND lap_time IS NOT NULL
                ORDER BY (CAST(substr(lap_time,1,instr(lap_time,':')-1) AS REAL)*60
                        + CAST(substr(lap_time,instr(lap_time,':')+1) AS REAL)) ASC LIMIT 1""", (cid,))
            races_held = conn.execute(
                "SELECT COUNT(*) FROM race_rows WHERE kind='win' AND circuit_id=?", (cid,)).fetchone()[0]
            out.append({
                "circuitId": cid,
                "name": c["circuitName"],
                "locality": c.get("Location", {}).get("locality"),
                "country": c.get("Location", {}).get("country"),
                "lat": c.get("Location", {}).get("lat"),
                "lng": c.get("Location", {}).get("long"),
                "url": c.get("url"),
                "racesHeld": races_held,
                "lastWinner": last_win[0] if last_win else None,
                "mostWins": most_wins[0] if most_wins else None,
                "mostPoles": most_poles[0] if most_poles else None,
                "fastestLap": fastest[0] if fastest else None,
            })
        result = {"season": season, "circuits": out,
                  "caveats": {
                      "fastestLap": "Official fastest-lap data is only reliable from 2004 onwards.",
                      "poles": "Poles counted as grid P1 starts (sprint weekends: grid of the grand prix).",
                  }}
        jsoncache.set(f"circuit_stats_{season}", result)
        return result
    finally:
        conn.close()


def _age_at(dob: str, when: str) -> float | None:
    try:
        b, w = date.fromisoformat(dob), date.fromisoformat(when)
        return round((w - b).days / 365.2425, 2)
    except (ValueError, TypeError):
        return None


def compute_records() -> dict:
    """All-time records → JSON cache."""
    conn = _conn()
    try:
        def leaderboard(kind: str, n: int = 10) -> list[dict]:
            return _top(conn, """SELECT driver_name AS name, COUNT(*) AS n,
                    MIN(season) AS firstSeason, MAX(season) AS lastSeason
                FROM race_rows WHERE kind=? GROUP BY driver_id
                ORDER BY n DESC LIMIT ?""", (kind, n))

        podiums = _top(conn, """SELECT driver_name AS name, COUNT(*) AS n,
                MIN(season) AS firstSeason, MAX(season) AS lastSeason
            FROM race_rows WHERE kind IN ('win','p2','p3') GROUP BY driver_id
            ORDER BY n DESC LIMIT 10""")

        champs = _top(conn, """SELECT entity_name AS name, COUNT(*) AS n,
                MIN(season) AS firstSeason, MAX(season) AS lastSeason
            FROM champions WHERE kind='driver' GROUP BY entity_id ORDER BY n DESC LIMIT 10""")
        constructor_champs = _top(conn, """SELECT entity_name AS name, COUNT(*) AS n,
                MIN(season) AS firstSeason, MAX(season) AS lastSeason
            FROM champions WHERE kind='constructor' GROUP BY entity_id ORDER BY n DESC LIMIT 10""")

        # youngest / oldest race winners
        winners = _top(conn, """SELECT driver_name, driver_dob, race_name, race_date, season
            FROM race_rows WHERE kind='win' AND driver_dob IS NOT NULL AND race_date IS NOT NULL""")
        aged = [{**w, "age": _age_at(w["driver_dob"], w["race_date"])} for w in winners]
        aged = [w for w in aged if w["age"]]
        youngest = sorted(aged, key=lambda w: w["age"])[:5]
        oldest = sorted(aged, key=lambda w: -w["age"])[:5]

        result = {
            "mostWins": leaderboard("win"),
            "mostPoles": leaderboard("pole"),
            "mostFastestLaps": leaderboard("fastlap"),
            "mostPodiums": podiums,
            "mostChampionships": champs,
            "mostConstructorTitles": constructor_champs,
            "youngestWinners": youngest,
            "oldestWinners": oldest,
            "unavailable": ["Fastest pit stop (not in Jolpica data)",
                            "Most laps led (not aggregated)"],
            "caveats": {
                "mostFastestLaps": "Fastest-lap awards reliably recorded from 2004 onwards.",
                "mostPoles": "Counted as grid P1 starts (qualifying data pre-1994 is incomplete).",
            },
        }
        jsoncache.set("records", result)
        return result
    finally:
        conn.close()


def get_circuit_stats(season: int = SEASON) -> dict | None:
    return jsoncache.get(f"circuit_stats_{season}", ttl=None)


def get_records() -> dict | None:
    return jsoncache.get("records", ttl=None)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    from ..config import ensure_dirs
    ensure_dirs()
    run_backfill()
