# Pit Wall — Personal F1 Dashboard

A self-hosted Formula 1 dashboard built on [Fast-F1](https://github.com/theOehrly/Fast-F1),
the [Jolpica-F1 API](https://github.com/jolpica/jolpica-f1) (Ergast successor) and public RSS feeds.

![stack](https://img.shields.io/badge/stack-Next.js%20·%20FastAPI%20·%20Fast--F1-e8002d)

## Pages

| Page | What it shows |
|---|---|
| **Login** | Google/GitHub sign-in, then a 3-step setup: racing name → news teams → favourites. The whole app sits behind it when Supabase is configured |
| **Home** | Personal greeting + countdown to the next session, top F1 news, news columns for the teams you follow (or general only), current grid by team, driver + constructor standings |
| **Profile** | Your racing card: tier, points, rank, badges, favourite drivers/teams/track, prediction history; edit news + favourites. Public view at `/u/<name>` (linked from the leaderboard) |
| **Telemetry** | Fastest-lap comparison for up to 4 drivers (Speed / Throttle / Brake / Gear / RPM / DRS over distance) + speed-colored track map. Data from 2018 onwards |
| **Results** | Every round of the season, every session — FP1–3, Sprint Quali, Sprint, Qualifying, Race. Race/sprint: grid delta, laps, gaps, points, fastest lap. Quali: Q1/Q2/Q3. Practice: best lap, gap, laps |
| **Predict** | Prediction game: call the top 10 for each session of the next weekend, picks lock at the session start, auto-scored when results land, season + per-round leaderboard, career-tier ladder and badges |
| **Replay** | Animated simulation of any completed session (track map, timing tower, derived commentary: overtakes, pits, fastest laps, flags). Defaults to the latest session |
| **Circuits** | Every circuit of the current calendar with last winner, fastest lap ever + who, most wins + who, most poles + who (aggregated from 1950-present) |
| **Records** | All-time records: wins, poles, podiums, fastest laps, titles, constructor titles, youngest/oldest winners |

## Quick start (Docker)

```bash
docker compose up --build
```

- Web UI: http://localhost:3000
- API: http://localhost:8000 (docs at `/docs`)

First boot automatically backfills historical aggregates (~5 min, ~100 gentle requests to
Jolpica). Circuits/Records pages show a friendly notice until it finishes.

### Ports / env

| Variable | Default | Meaning |
|---|---|---|
| `WEB_PORT` | `3000` | Host port for the web UI |
| `API_PORT` | `8000` | Host port for the API |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | URL the **browser** uses to reach the API. Set to `http://<your-host>:8000` when accessing from other devices (build arg — rebuild web after changing) |
| `F1_SEASON` | `2026` | Current season |
| `DATABASE_URL` | SQLite in `data/predictions.db` | Prediction-game storage. Any Postgres URL works (`postgres://…`) |
| `SUPABASE_URL` | — | API: Supabase project URL, used to verify sign-in tokens |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | — | Web: Supabase project URL + publishable key for the sign-in buttons |

Example: `WEB_PORT=3100 API_PORT=8100 NEXT_PUBLIC_API_URL=http://localhost:8100 docker compose up --build`

## Local development (no Docker)

```bash
# API (Python 3.12)
cd api
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
F1_DATA_DIR=$(pwd)/../data .venv/bin/uvicorn app.main:app --port 8020

# Web
cd web
npm install
NEXT_PUBLIC_API_URL=http://localhost:8020 npm run dev -- --port 3020
```

Run the historical backfill manually (also runs automatically on first boot / weekly):

```bash
cd api && F1_DATA_DIR=$(pwd)/../data .venv/bin/python -m app.aggregation.backfill
```

## Prediction game

Sign-in is **Supabase Auth** (Google + GitHub). The browser gets a session from Supabase and
sends its access token to the API, which verifies the JWT against the project's public JWKS
(`SUPABASE_URL`) — the API holds no auth secrets. On first sign-in a player picks the racing name
shown on the leaderboard. Browsing results and leaderboards needs no account. Scoring per session: **+5** exact position, **+3** one place off, **+1** in the top 10,
**+5** perfect podium bonus, **+25** all ten exact (max 80). Practice is ranked by best lap,
qualifying by classification, sprint/race by finishing order. A scheduler job (every 20 min)
builds results for finished sessions and scores pending picks; the leaderboard also scores
lazily from cached results on each request.

## Data CDN (precomputed cache)

Everything heavy is built ahead of time and served from a public **Supabase Storage** bucket
(`pitwall/v1/<key>.json`, brotli-compressed by the CDN):

- **What:** results, an all-driver telemetry bundle and a replay for every completed session of the
  season, plus schedule, standings, grid, news, season index, circuits and records.
- **Who builds it:** `python -m app.publish` (in `api/`), run hourly by GitHub Actions
  (`.github/workflows/publish-data.yml`; repo secrets `SUPABASE_URL` + `SUPABASE_SECRET_KEY`).
  Session artifacts are built once; small data is refreshed every run. Run it by hand with
  `--rebuild 16/R` to redo a session.
- **Who reads it:** the web app fetches published data straight from the CDN (instant, works while
  the API sleeps) and falls back to the API. The API also pulls a published copy before ever
  rebuilding with fastf1, so a fresh Render container never does the heavy work.
- Older seasons' telemetry (2018–2025) still builds on demand through the API.

## Architecture

```
Next.js (Tailwind + Recharts + SVG track maps)
   │  REST
FastAPI
   ├─ fastf1            → session telemetry, schedule, replay position data (cached on disk)
   ├─ fastf1.ergast     → Jolpica: standings, grid (cached JSON, cron-refreshed after races)
   ├─ raw Jolpica       → historical backfill → SQLite aggregates (circuits, records)
   ├─ feedparser        → RSS news, 15-min cache, per-team keyword filters
   ├─ fastf1 sessions   → per-session results (cached JSON forever)
   └─ SQLAlchemy        → prediction game (SQLite locally, Postgres when hosted)
APScheduler: news 15min · standings post-race · schedule daily · backfill weekly ·
             replay warm post-race · results + prediction scoring every 20min
```

### Design rules

- **Nothing historical is fetched on the request path** — precomputed into SQLite/JSON by
  background jobs. Jolpica is volunteer-hosted; the full backfill costs ~100 requests total
  by using filtered endpoints (`results/1`, `grid/1/results`, `fastest/1/results`, …).
- **Replay only, no live timing**: F1's live stream needs a paid F1TV login, so sessions are
  shown as replays once they finish.
- **Missing data is surfaced, not crashed on**: telemetry pre-2018, fastest laps pre-2004,
  poles counted as grid P1 (pre-1994 qualifying data doesn't exist).

## Data caveats

- Fastest-lap records are only reliable from 2004 onwards (official F1 fastest-lap awards).
- "Poles" are counted as grid P1 starts — for sprint weekends this is the grand prix grid.
- Car telemetry exists from 2018 onwards.
- Standings update after race weekends (scheduled), not in real time during a race.
claude --resume 7a229b2b-49ae-4072-b254-c014e31a345a
## Free public hosting

Web on Vercel, API on Render — both free tiers, neither needs a credit card.

### 1. API → Render

The repo carries `render.yaml`, so Render configures itself:

1. [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** → connect this repo.
2. Apply. It builds `api/Dockerfile` with the repo root as context and deploys `pit-wall-api`.
3. Check it: `curl https://pit-wall-api.onrender.com/api/health`

Pushes to `main` redeploy automatically. Free plan = 512 MB RAM, 0.1 CPU, 750 instance-hours
per month, **no persistent disk**, and it **sleeps after 15 minutes idle** (next request cold-starts
it, ~1 minute). Consequences worth knowing:

- The image bakes in `data/jsoncache`, so a cold container serves standings, schedule, news,
  records, circuits and the stored replay/telemetry bundles immediately.
- The Fast-F1 cache starts empty each boot and refills from the network on demand. Parsing an
  uncached session is the one thing that can brush the 512 MB ceiling; if it does, Render
  restarts the service — nothing is lost but the cache.
- APScheduler jobs only run while the service is awake, so news/standings refresh on visits
  rather than on the clock.
- **The prediction game needs a real database here.** Without `DATABASE_URL` it falls back to
  SQLite on the container's disk, which is wiped on every sleep/redeploy. Set `DATABASE_URL` to the
  Supabase **Session pooler** connection string (Supabase → Connect) and `SUPABASE_URL` to the
  project URL on the Render service.
- Results for past sessions are baked in from `data/jsoncache`; replays of sessions that aren't
  baked in are built on demand and are the heaviest request (512 MB risk).

### 2. Web → Vercel

Import the repo at [vercel.com/new](https://vercel.com/new), then:

- **Root Directory**: `web`
- **Environment Variables**: `NEXT_PUBLIC_API_URL` = `https://pit-wall-api.onrender.com`,
  plus `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- In Supabase → Authentication → URL Configuration, add the Vercel URL as **Site URL** and
  `https://<your-app>.vercel.app/**` under **Redirect URLs**

The browser talks to the API directly (CORS is `*`), so that one
variable is all that ties the two halves together. Pushes to `main` redeploy automatically.
