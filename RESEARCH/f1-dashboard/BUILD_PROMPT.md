# Build Prompt — Personal F1 Dashboard

You are building a beautiful, self-hosted personal Formula 1 dashboard for an F1 enthusiast. Build it end to end, working, from scratch. Do not stub features you can implement. Research facts you need are provided below — trust them, don't re-derive.

## Goal

A polished, aesthetic F1 web dashboard with a rich landing page plus dedicated pages for telemetry, live/replay session viewing, circuits, and all-time records. Data comes from the Fast-F1 Python library, the Jolpica-F1 API, and public RSS news feeds.

## Tech Stack (fixed — do not substitute)

- **Frontend:** Next.js (App Router, TypeScript) + Tailwind CSS + Recharts. Custom SVG for track maps.
- **Backend:** FastAPI (Python 3.11+) wrapping the `fastf1` library.
- **Data layer:** Fast-F1 disk cache + Jolpica-F1 API (`fastf1.ergast` module) + RSS via `feedparser`.
- **Realtime:** WebSocket from FastAPI to Next.js for live/replay session frames.
- **Storage:** SQLite for precomputed aggregates (circuits, records) + JSON caches.
- **Deploy:** Docker Compose (`web`, `api`), with the Fast-F1 cache and SQLite on persistent volumes. Cron/APScheduler jobs for scheduled refresh.

## Critical Data Facts (verified — use these exactly)

**Fast-F1 (telemetry + live):**
- Enable cache once at startup: `fastf1.Cache.enable_cache('/data/ff1cache')`.
- Session: `session = fastf1.get_session(year, gp, ident)` where `ident` ∈ `FP1,FP2,FP3,Q,S,R`; then `session.load()`.
- Laps: `session.laps`, `.pick_drivers(code)`, `.pick_fastest()`.
- Telemetry: `lap.get_telemetry()` → columns `Speed, RPM, nGear, Throttle, Brake, DRS, X, Y, Z, Distance, Time`.
- Track outline: fastest lap's position data (`get_pos_data()` / telemetry X/Y), rotated by the circuit's rotation from `session.get_circuit_info()`.
- **Telemetry data only exists for 2018 onward.**

**Live timing (undocumented SignalR — treat as fragile):**
- `from fastf1.livetiming.client import SignalRClient` → `SignalRClient(filename=..., filemode='w', timeout=0)` then `.start()`.
- Streams car Position (X/Y/Z per car) + Timing (gaps, sectors, tyres) + TrackStatus + RaceControlMessages.
- **Only works during a live session.** Load recorded data via `fastf1.livetiming.data.LiveTimingData`.

**Jolpica-F1 API (Ergast successor — historical + standings, 1950–present):**
- Ergast shut down early 2025; Jolpica is the drop-in replacement. Base URL: `https://api.jolpi.ca/ergast/f1/`.
- Prefer the `fastf1.ergast` wrapper: `from fastf1.ergast import Ergast; ergast = Ergast()`.
  - `ergast.get_driver_standings(season=YEAR)`, `ergast.get_constructor_standings(season=YEAR)`
  - `ergast.get_race_results(season=..., round=...)`, `ergast.get_qualifying_results(...)`
  - `ergast.get_circuits(season=...)`, `ergast.get_lap_times(...)`
  - Multi-responses expose `.description` (season/round meta) + `.content` (list of DataFrames).
- **It is volunteer-hosted (~$45/mo). Rate-limit yourself. Cache aggressively. Historical data never changes — never re-fetch it.**

**News (no key needed — RSS via `feedparser`):**
- General F1: `https://www.formula1.com/en/latest/all.xml`, `https://www.motorsport.com/rss/f1/news/`, `https://racingnews365.com/feed/news.xml`.
- Ferrari + Mercedes: keyword-filter the aggregator feeds (`Ferrari`/`Leclerc`/`Hamilton`; `Mercedes`/`Russell`/`Antonelli`). Dedupe by title+URL. Cache 15 min.

## Pages & Features

### Landing page (`/`)
- **Greeting**: time-of-day aware ("Good evening") + a live countdown to the next F1 session (derive from `fastf1.get_event_schedule(year)`).
- **News summary**: top ~6 general F1 headlines with source + timestamp.
- **Team news columns**: two columns, Ferrari and Mercedes, keyword-filtered.
- **Drivers & teams**: cards for the current season grid, grouped by constructor, team-colored (use `fastf1.plotting` team colors).
- **Driver standings**: full table, position/driver/team/points, team-colored rows.
- **Constructor standings**: full table.
- Refresh standings after each race (cron), not per request.

### Telemetry page (`/telemetry`)
- Selectors: year → event → session → driver(s).
- Charts (Recharts): Speed, Throttle, Brake, Gear, RPM, DRS over Distance.
- Driver-vs-driver overlay compare.
- SVG track map colored by speed (fastest lap).

### Live page (`/live`)
- **Replay mode (build this first, must always work):** load the last completed session, animate cars lap-by-lap on the track map; derive commentary events (overtakes = position swaps, pit stops, fastest lap, flags from TrackStatus).
- **Live mode:** when a session is live, run `SignalRClient` in the backend, push parsed frames over WebSocket; render live positions, timing tower (gaps/sectors/tyres), and a live commentary feed from RaceControlMessages + derived events.
- Same rendering path for both modes.

### Circuits page (`/circuits`)
- Calendar grid of the current year's circuits (`ergast.get_circuits(season)` + schedule).
- Each circuit card shows: **last winner**, **fastest lap ever recorded + who**, **most wins at this circuit + who**, **most poles at this circuit + who**.
- These require aggregation (no single endpoint). Precompute into SQLite via a backfill script (all race + qualifying results per circuit, counted by driver), incrementally updated after each new race. Page reads instant JSON.
- Surface data caveats in the UI: fastest-lap timing unreliable pre-2004; label the "pole" convention for sprint weekends (2021+).

### Records page (`/records`)
- All-time records from Jolpica (1950–present): most wins, most poles, most championships, most podiums, most fastest laps, youngest/oldest winner, etc. Sortable/filterable.
- Same precompute-to-SQLite pattern. Scope out records not in Jolpica (e.g. fastest pit stop) or label them as unavailable.

## Aesthetic Direction

Beautiful and intentional — not a template. Dark, race-inspired theme; team colors as accents; clean typography; smooth micro-animations; loading skeletons; graceful empty/error states; fully responsive. The landing page is the daily-driver — make it feel alive (countdown ticking, live-ish standings, fresh news).

## Build Order (ship each phase working)

1. **P0 Scaffold:** Docker Compose, FastAPI skeleton with `fastf1.Cache` enabled, Jolpica smoke test, Next.js app shell + theme.
2. **P1 Landing:** `/api/standings`, `/api/drivers`, `/api/news` + full landing UI. (Usable product on its own.)
3. **P2 Circuits:** backfill/aggregate script → SQLite, `/api/circuits`, `/api/circuits/{id}`, circuits UI.
4. **P3 Records:** extend aggregation, `/api/records`, records UI.
5. **P4 Telemetry:** `/api/telemetry/{year}/{gp}/{ses}/{drivers}`, telemetry charts + track map.
6. **P5 Live:** replay mode first, then SignalR live + WebSocket + commentary.
7. **P6 Polish + deploy:** theming, animations, cron refresh jobs, Docker deploy.

## Constraints & Non-Negotiables

- Never fetch historical Jolpica data on the request path — precompute + cache. Respect the API's limited capacity.
- Mount Fast-F1 cache + SQLite on Docker volumes so they persist.
- Warm the Fast-F1 cache via a scheduled job before browsing (first session load is slow).
- Replay mode must be fully functional without any live session. Live mode is additive and must fail gracefully when the SignalR feed is unavailable.
- Handle missing data explicitly (pre-2004 fastest laps, pre-2018 telemetry) — gray out, don't crash.
- Provide a `README.md` with setup, env vars, and `docker compose up` instructions.

## Definition of Done

- `docker compose up` brings up a working dashboard.
- Landing page renders greeting, live news, both standings, driver/team cards, Ferrari + Mercedes news.
- Telemetry page plots a real session and compares two drivers.
- Circuits page shows all current-year circuits with the four required per-circuit stats.
- Records page lists all-time records.
- Live page runs replay of the last session; live mode connects when a session is on.
- README documents how to run it.
