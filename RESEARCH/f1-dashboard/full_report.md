# F1 Personal Dashboard — Build Plan & Feasibility Report

**Date:** 2026-07-03
**Author:** Deep Research (Claude Code)
**For:** Personal F1 dashboard built on [Fast-F1](https://github.com/theOehrly/Fast-F1)

---

## 1. Executive Summary

The dashboard is **fully buildable**. Fast-F1 supplies everything data-side across three
capability tiers:

1. **Live + telemetry** — `fastf1.get_session()` + `fastf1.livetiming.SignalRClient`
   (real-time car/position data, telemetry, track maps).
2. **Standings / historical / circuits / records** — `fastf1.ergast` module, which now
   pulls from the **Jolpica-F1 API** (Ergast successor; Ergast shut down early 2025).
   Covers **1950–present**.
3. **News** — NOT in Fast-F1. Supplied via **free RSS** feeds, filtered per team.

**Chosen stack (confirmed with user):**
- Frontend: **Next.js + Tailwind + Recharts** (aesthetics + real-time)
- Backend: **FastAPI** wrapping Fast-F1 (Python)
- Data: Fast-F1 disk cache + Jolpica API + RSS
- Live: **WebSocket** push; both **real live timing** (during sessions) and **replay** fallback
- Deploy: **self-hosted (Docker)** + **cron** refresh jobs

**Single biggest risk:** live timing uses F1's *undocumented* SignalR feed — works only
during an actual live session and can break when F1 changes it. Everything else is stable.

---

## 2. Feature → Data Source Map

| Feature (page) | Data source | Fast-F1 / API call | Notes |
|---|---|---|---|
| Greeting | Local | — | Time-of-day + next-session countdown |
| News summary | RSS | `feedparser` on aggregator feeds | Cache + dedupe |
| Team news (Ferrari, Mercedes) | RSS | Team + keyword-filtered feeds | See §5 |
| Drivers + their teams | Jolpica | `ergast.get_driver_info(season)`, team colors from `fastf1.plotting` | Current season roster |
| Driver standings | Jolpica | `ergast.get_driver_standings(season)` | Live-ish, refresh after each race |
| Constructor standings | Jolpica | `ergast.get_constructor_standings(season)` | Same |
| Telemetry page | Fast-F1 session | `get_session(y,gp,ses).load()` → `laps.pick_drivers(d).get_telemetry()` | Speed/Throttle/Brake/Gear/RPM/DRS/X-Y |
| Live commentary + live circuit | Fast-F1 livetiming | `SignalRClient` → parse Position/Timing streams | Live only during session; replay otherwise |
| Circuits page | Jolpica | `ergast.get_circuits(season)` + aggregation | Per-circuit stats need aggregation, see §4 |
| Records page | Jolpica | Multiple historical queries, precomputed | 1950–present |

---

## 3. Architecture

```
                    ┌──────────────────────────────────────────┐
                    │  Next.js (App Router) + Tailwind          │
   Browser  <────>  │  - Landing (greeting, news, standings)    │
                    │  - /telemetry  /live  /circuits  /records │
                    │  - Recharts + custom SVG track maps       │
                    └───────────────┬──────────────────────────┘
                          REST + WebSocket (JSON)
                    ┌───────────────┴──────────────────────────┐
                    │  FastAPI (Python)                         │
                    │  /api/standings  /api/drivers             │
                    │  /api/circuits   /api/records  /api/news  │
                    │  /api/telemetry/{y}/{gp}/{ses}/{drv}      │
                    │  /ws/live  (WebSocket, live timing push)  │
                    └───┬───────────┬───────────┬───────────────┘
                        │           │           │
                 ┌──────┴───┐ ┌─────┴────┐ ┌────┴─────┐
                 │ Fast-F1  │ │ Jolpica  │ │  RSS     │
                 │ cache +  │ │ (Ergast  │ │ feedparse│
                 │ livetime │ │  compat) │ │          │
                 └──────────┘ └──────────┘ └──────────┘
                        │
                 ┌──────┴──────────────────────────┐
                 │ Precompute layer (cron jobs)     │
                 │ - refresh standings after races  │
                 │ - rebuild circuit + records aggs │
                 │ - poll RSS every 15 min          │
                 │ store as JSON / SQLite           │
                 └──────────────────────────────────┘
```

**Why a precompute layer:** circuit-history and records stats require *many* Jolpica calls
+ local aggregation (see §4). Doing that per page-load is slow and hammers a volunteer-run
API. Precompute nightly → serve static JSON. Fast, kind to Jolpica, resilient.

**Caching discipline (important):**
- Fast-F1 disk cache: `fastf1.Cache.enable_cache('/data/ff1cache')` — mount as Docker volume.
- Jolpica: respect rate limits (volunteer-hosted, ~$45/mo). Cache aggressively; historical
  data never changes, so records/circuit aggregates rebuild only when a new race completes.

---

## 4. The Hard Part: Circuits & Records Aggregation

Jolpica/Ergast has **no single "stats per circuit" endpoint**. Each stat = query + aggregate:

**Per-circuit (for the Circuits page):**
- *Last winner* — results for the most recent race at that circuit → P1.
- *Fastest lap ever recorded + who* — filter results/laptimes at that circuit for min lap time.
  (Note: reliable fastest-lap data is thin pre-2004; state the caveat in UI.)
- *Most wins at circuit + who* — aggregate all race winners at that circuit, count by driver.
- *Most poles at circuit + who* — aggregate qualifying (and pre-1994 grid) P1 by driver.

**Strategy:** one-time backfill script pulls all race + qualifying results per circuit,
stores aggregates in SQLite. Incremental update appends each new race. Circuits page then
reads instant JSON.

**Records page** (global, 1950–present): most wins, most poles, most championships, most
fastest laps, most podiums, youngest/oldest winner, etc. Same precompute pattern. Some
"records" (e.g. fastest pit stop) are not in Jolpica — scope those out or source separately.

**Data caveats to surface in UI:**
- Fastest-lap timing data unreliable before ~2004.
- Sprint weekends change what "pole" means (2021+) — decide convention and label it.
- Fast-F1 telemetry only exists **2018+**; historical stats via Jolpica go to 1950 but have
  no telemetry.

---

## 5. News (RSS) Detail

No API key needed. Candidate feeds:
- General F1: `https://www.formula1.com/en/latest/all.xml`, `https://www.motorsport.com/rss/f1/news/`,
  `https://racingnews365.com/feed/news.xml`, Autosport, PlanetF1.
- **Ferrari:** filter aggregator feeds by keyword `Ferrari`/`Leclerc`/`Hamilton`(2025+ Ferrari)
  + scrape/parse `ferrari.com/en-EN/formula1/news`.
- **Mercedes:** keyword `Mercedes`/`Russell`/`Antonelli` + `mercedesamgf1.com/news`.

**Note:** official team sites don't always expose clean RSS. Most robust = pull 2–3 reliable
aggregator RSS feeds, then **keyword-filter per team**. Dedupe by title/URL. Cache 15 min.

---

## 6. Live Timing & Track Map Detail

- **Record/stream:** `from fastf1.livetiming.client import SignalRClient`. Start 2–3 min
  before session. Streams Position (X/Y/Z per car) + Timing (gaps, sectors, tyres).
- **FastAPI** runs the client during sessions, pushes parsed frames over `/ws/live` WebSocket
  to Next.js.
- **Live track map:** plot car X/Y over the circuit outline. Circuit outline comes from a
  fast lap's position telemetry (`get_pos_data()`), rotated by Fast-F1's per-circuit rotation.
- **"Live commentary":** derive text events from the timing stream (overtakes = position
  swaps, pit stops, fastest lap, yellow/SC flags from TrackStatus). Optionally enrich with
  RaceControlMessages that Fast-F1 exposes.
- **Replay fallback:** when no session live, load the last completed session and animate
  laps frame-by-frame — same rendering path, so build replay first, wire live second.

**Reality check:** SignalR endpoint is undocumented and F1 can change it. Build the replay
path to be self-sufficient so the product is useful 90% of the year when nothing is live.

---

## 7. Phased Roadmap

**Phase 0 — Scaffold (foundation)**
- Docker Compose: `web` (Next.js), `api` (FastAPI), volume for Fast-F1 cache + SQLite.
- FastAPI skeleton, `fastf1.Cache` enabled, Jolpica client smoke test.

**Phase 1 — Landing page (highest daily value)**
- `/api/standings` (driver + constructor), `/api/drivers`, `/api/news`.
- Landing UI: greeting + next-session countdown, standings tables, driver/team cards,
  news + Ferrari/Mercedes columns. This alone is a usable product.

**Phase 2 — Circuits page**
- Backfill + aggregate script → SQLite. `/api/circuits` + `/api/circuits/{id}`.
- Calendar grid; per-circuit card: last winner, fastest lap+who, most wins+who, most poles+who.

**Phase 3 — Records page**
- Extend aggregation. `/api/records`. Records UI (sortable, filterable).

**Phase 4 — Telemetry page**
- `/api/telemetry/...` returns speed/throttle/brake/gear/DRS + X/Y.
- Recharts telemetry traces + driver-vs-driver compare + SVG track map colored by speed.

**Phase 5 — Live page**
- Replay mode first (animate last session). Then SignalR live + WebSocket + live commentary.

**Phase 6 — Polish**
- Team-colored theming, dark mode, animations, loading skeletons, error/empty states,
  responsive. Cron jobs for refresh. Deploy.

---

## 8. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| SignalR live feed breaks / only live during sessions | Replay mode is primary; live is a bonus. Isolate client. |
| Jolpica rate limits / volunteer uptime | Aggressive precompute + cache; historical never re-fetched. |
| Circuit/records aggregation slow & fiddly | Nightly precompute to SQLite; serve static JSON. |
| Fastest-lap data unreliable pre-2004 | Surface caveat in UI; gray out where missing. |
| Team RSS feeds messy/absent | Keyword-filter reliable aggregator feeds; dedupe. |
| Fast-F1 first-load per session is slow | Warm cache via cron before you browse; Docker volume persists it. |

---

## 9. Sources

- Fast-F1 docs — https://theoehrly-fast-f1.mintlify.app/ , https://docs.fastf1.dev/
- Fast-F1 live timing — https://docs.fastf1.dev/livetiming.html , https://theoehrly-fast-f1.mintlify.app/guides/live-timing
- Fast-F1 SignalR example — https://docs.fastf1.dev/gen_modules/examples_gallery/example_fastf1_signalrclient.html
- Fast-F1 Jolpica/Ergast interface — https://docs.fastf1.dev/api_reference/jolpica.html
- Jolpica-F1 API — https://github.com/jolpica/jolpica-f1 , http://api.jolpi.ca/ergast/f1/
- Ergast differences — https://github.com/jolpica/jolpica-f1/blob/main/docs/ergast_differences.md
- RSS feeds — formula1.com/en/latest/all.xml, motorsport.com/rss/f1/news/, racingnews365.com/feed/news.xml
