"""F1 Dashboard API — FastAPI app wrapping Fast-F1, Jolpica and RSS news."""
import asyncio
import logging
from contextlib import asynccontextmanager

import fastf1
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .scheduler import create_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("f1api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    fastf1.Cache.enable_cache(str(config.FF1_CACHE_DIR))
    scheduler = create_scheduler()
    scheduler.start()
    # first boot: build circuit/records aggregates in the background if missing
    from .aggregation import backfill
    if backfill.get_records() is None:
        import threading
        threading.Thread(target=backfill.run_backfill, daemon=True,
                         name="initial-backfill").start()
        log.info("no aggregates found — initial backfill started in background")
    log.info("F1 API up — season %s, data dir %s", config.SEASON, config.DATA_DIR)
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="F1 Dashboard API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # personal, self-hosted dashboard
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"ok": True, "season": config.SEASON}


# ------------------------------------------------------------------ landing

@app.get("/api/standings")
async def standings():
    from .services import standings as svc
    return await run_in_threadpool(svc.get_standings)


@app.get("/api/drivers")
async def drivers():
    from .services import standings as svc
    return await run_in_threadpool(svc.get_grid)


@app.get("/api/news")
async def news():
    from .services import news as svc
    return await run_in_threadpool(svc.get_news)


@app.get("/api/schedule")
async def schedule():
    from .services import schedule as svc
    return await run_in_threadpool(svc.get_schedule)


@app.get("/api/schedule/next")
async def schedule_next():
    from .services import schedule as svc
    return await run_in_threadpool(svc.get_next_session)


# --------------------------------------------------------- circuits/records

@app.get("/api/circuits")
async def circuits():
    from .aggregation import backfill
    stats = backfill.get_circuit_stats()
    if stats is None:
        raise HTTPException(503, "Circuit stats not built yet — run the backfill "
                                 "(python -m app.aggregation.backfill) or wait for the weekly job.")
    return stats


@app.get("/api/records")
async def records():
    from .aggregation import backfill
    recs = backfill.get_records()
    if recs is None:
        raise HTTPException(503, "Records not built yet — run the backfill "
                                 "(python -m app.aggregation.backfill) or wait for the weekly job.")
    return recs


# ---------------------------------------------------------------- telemetry

@app.get("/api/telemetry/options")
async def telemetry_options(year: int = Query(default=config.SEASON, ge=1950)):
    from .services import telemetry as svc
    return await run_in_threadpool(svc.get_options, year)


@app.get("/api/telemetry/{year}/{round_}/{ses}/drivers")
async def telemetry_drivers(year: int, round_: int, ses: str):
    from .services import telemetry as svc
    try:
        return await run_in_threadpool(svc.get_session_drivers, year, round_, ses)
    except Exception as exc:  # session not available yet / bad params
        raise HTTPException(422, f"Could not load session: {exc}")


@app.get("/api/telemetry/{year}/{round_}/{ses}")
async def telemetry(year: int, round_: int, ses: str,
                    drivers: str = Query(..., description="comma-separated codes, e.g. VER,LEC")):
    from .services import telemetry as svc
    codes = [c.strip().upper() for c in drivers.split(",") if c.strip()]
    if not codes:
        raise HTTPException(422, "No driver codes given")
    try:
        return await run_in_threadpool(svc.get_telemetry, year, round_, ses, codes)
    except Exception as exc:
        raise HTTPException(422, f"Could not load telemetry: {exc}")


# -------------------------------------------------------------- live/replay

@app.get("/api/live/status")
async def live_status():
    from .services import live, schedule as sched_svc
    info = await run_in_threadpool(sched_svc.get_next_session)
    return {
        "liveSession": info.get("live"),
        "next": info.get("next"),
        "lastCompleted": info.get("lastCompleted"),
        "client": live.manager.status(),
        "mode": "live" if (info.get("live") and live.manager.receiving) else "replay",
    }


@app.get("/api/replay")
async def replay_bundle():
    from .services import replay as svc
    target = await run_in_threadpool(svc.find_last_completed)
    if not target:
        raise HTTPException(404, "No completed session found for this season yet.")
    try:
        return await run_in_threadpool(
            svc.get_replay, target["year"], target["round"], target["session"])
    except Exception as exc:
        raise HTTPException(500, f"Replay build failed: {exc}")


@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    """Streams live snapshots at 2 Hz while a session is on; else tells client to use replay."""
    from .services import live
    await ws.accept()
    try:
        if not live.manager.auth_ok:
            await ws.send_json({
                "type": "no_live",
                "detail": "Live timing requires a one-time F1TV authentication: "
                          "run `python -m fastf1 auth` in the api environment, then retry. "
                          "Replay mode works without it.",
            })
            await ws.close()
            return
        if not live.manager.running:
            live.manager.start()
        # give the client a moment to connect before judging
        for _ in range(10):
            if live.manager.receiving:
                break
            await asyncio.sleep(1)
        if not live.manager.receiving:
            await ws.send_json({"type": "no_live",
                                "detail": "No live timing available — use replay mode."})
            await ws.close()
            return
        while True:
            await ws.send_json(live.manager.state.snapshot())
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("live websocket error")
        try:
            await ws.close()
        except Exception:
            pass
