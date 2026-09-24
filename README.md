# Pit Wall — Personal F1 Dashboard

A self-hosted Formula 1 dashboard built on [Fast-F1](https://github.com/theOehrly/Fast-F1),
the [Jolpica-F1 API](https://github.com/jolpica/jolpica-f1) (Ergast successor) and public RSS feeds.

![stack](https://img.shields.io/badge/stack-Next.js%20·%20FastAPI%20·%20Fast--F1-e8002d)

## Pages

| Page | What it shows |
|---|---|
| **Home** | Greeting + countdown to the next session, top F1 news, Ferrari & Mercedes news columns, current grid by team, driver + constructor standings |
| **Telemetry** | Fastest-lap comparison for up to 4 drivers (Speed / Throttle / Brake / Gear / RPM / DRS over distance) + speed-colored track map. Data from 2018 onwards |
| **Live** | Replay of the last completed session (animated track map, timing tower, derived commentary: overtakes, pits, fastest laps, flags). True live timing during sessions (requires F1TV auth, see below) |
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

## Live timing (optional, needs F1TV subscription)

F1's live timing stream requires authentication since 2025. One-time setup:

```bash
cd api && .venv/bin/python -m fastf1 auth
# opens a browser — log in with your Formula1/F1TV account
```

The token is stored in fastf1's user data dir (persisted in the `f1auth` Docker volume).
Without it, the Live page automatically falls back to replay mode — which always works.

## Architecture

```
Next.js (Tailwind + Recharts + SVG track maps)
   │  REST + WebSocket
FastAPI
   ├─ fastf1            → session telemetry, schedule, replay position data (cached on disk)
   ├─ fastf1.ergast     → Jolpica: standings, grid (cached JSON, cron-refreshed after races)
   ├─ raw Jolpica       → historical backfill → SQLite aggregates (circuits, records)
   ├─ feedparser        → RSS news, 15-min cache, per-team keyword filters
   └─ SignalRClient     → live timing → in-memory state → WS snapshots (2 Hz)
APScheduler: news 15min · standings post-race · schedule daily · backfill weekly ·
             replay warm post-race · live watchdog every 2min
```

### Design rules

- **Nothing historical is fetched on the request path** — precomputed into SQLite/JSON by
  background jobs. Jolpica is volunteer-hosted; the full backfill costs ~100 requests total
  by using filtered endpoints (`results/1`, `grid/1/results`, `fastest/1/results`, …).
- **Replay must always work; live is additive** and degrades gracefully (no auth / no
  session / stream break → replay).
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
- Live timing needs the one-time F1TV auth, which cannot persist here — it stays in replay mode.

### 2. Web → Vercel

Import the repo at [vercel.com/new](https://vercel.com/new), then:

- **Root Directory**: `web`
- **Environment Variable**: `NEXT_PUBLIC_API_URL` = `https://pit-wall-api.onrender.com`

The browser talks to the API directly (CORS is `*`, WebSocket upgrades to `wss://`), so that one
variable is all that ties the two halves together. Pushes to `main` redeploy automatically.
