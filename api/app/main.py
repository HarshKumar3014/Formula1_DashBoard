"""F1 Dashboard API — FastAPI app wrapping Fast-F1, Jolpica and RSS news, plus the prediction game."""
import logging
from contextlib import asynccontextmanager

import fastf1
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config, db
from .scheduler import create_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("f1api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    fastf1.Cache.enable_cache(str(config.FF1_CACHE_DIR))
    db.init()
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


@app.get("/api/telemetry/{year}/{round_}/{ses}/bundle")
async def telemetry_bundle(year: int, round_: int, ses: str):
    """Every driver's fastest-lap trace for a session (what the telemetry page loads)."""
    from .services import telemetry as svc
    try:
        return await run_in_threadpool(svc.get_session_bundle, year, round_, ses.upper())
    except Exception as exc:
        raise HTTPException(422, f"Could not load telemetry: {exc}")


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


# ------------------------------------------------------------------ results

@app.get("/api/results")
async def results_season():
    from .services import results as svc
    return await run_in_threadpool(svc.get_season)


@app.get("/api/results/{round_}/{ses}")
async def results_session(round_: int, ses: str):
    from .services import results as svc
    code = ses.upper()
    if code not in svc.KIND:
        raise HTTPException(404, f"Unknown session {ses!r} — use one of {', '.join(svc.KIND)}")
    try:
        return await run_in_threadpool(svc.get_session_results, config.SEASON, round_, code)
    except Exception as exc:
        raise HTTPException(422, f"Results not available yet: {exc}")


# ------------------------------------------------------------------- replay

@app.get("/api/replay")
async def replay_bundle(round_: int | None = Query(default=None, alias="round"),
                        session: str | None = None):
    """Animated replay of a completed session; defaults to the most recent one."""
    from .services import replay as svc, results as res_svc
    if round_ is None or session is None:
        target = await run_in_threadpool(svc.find_last_completed)
        if not target:
            raise HTTPException(404, "No completed session found for this season yet.")
        round_, code = target["round"], target["session"]
    else:
        code = session.upper()
        if code not in res_svc.KIND:  # accept full names too ("Race")
            code = res_svc.SESSION_CODES.get(session, code)
    try:
        return await run_in_threadpool(svc.get_replay, config.SEASON, round_, code)
    except Exception as exc:
        raise HTTPException(500, f"Replay build failed: {exc}")


# -------------------------------------------------------------- predictions

def _claims(authorization: str | None, required: bool = True) -> dict | None:
    """Verified Supabase token claims; None for anonymous requests."""
    from . import auth
    if not authorization or not authorization.lower().startswith("bearer "):
        if required:
            raise HTTPException(401, "Sign in to play.")
        return None
    try:
        return auth.verify(authorization[7:].strip())
    except auth.AuthError as exc:
        raise HTTPException(401, str(exc))


def _auth_id(authorization: str | None, required: bool = True) -> str | None:
    claims = _claims(authorization, required)
    return claims["sub"] if claims else None


async def _player(authorization: str | None, required: bool = True):
    from .services import predict
    auth_id = _auth_id(authorization, required)
    player = await run_in_threadpool(predict.player_for, auth_id)
    if required and player is None:
        raise HTTPException(403, "Pick a racing name first.")
    return player


async def _game(fn, *args):
    from .services import predict
    try:
        return await run_in_threadpool(fn, *args)
    except predict.GameError as exc:
        raise HTTPException(exc.status, str(exc))


class JoinBody(BaseModel):
    name: str


class PicksBody(BaseModel):
    picks: list[str]


class ProfileBody(BaseModel):
    newsTeams: list[str] = []
    favDrivers: list[str] = []
    favTeams: list[str] = []
    favTrack: str | None = None


@app.post("/api/predict/join")
async def predict_join(body: JoinBody, authorization: str | None = Header(default=None)):
    """Claim a racing name for the signed-in Supabase user (once)."""
    from .services import predict
    return await _game(predict.join, _auth_id(authorization), body.name)


@app.get("/api/predict/me")
async def predict_me(authorization: str | None = Header(default=None)):
    """The signed-in user's player, or {"player": null} until they pick a racing name."""
    from .services import predict
    return {"player": await run_in_threadpool(predict.player_for, _auth_id(authorization))}


@app.get("/api/predict/event")
async def predict_event(round_: int | None = Query(default=None, alias="round"),
                        authorization: str | None = Header(default=None)):
    from .services import predict
    player = await _player(authorization, required=False)
    return await _game(predict.get_event, round_, player)


@app.put("/api/predict/{round_}/{ses}")
async def predict_save(round_: int, ses: str, body: PicksBody,
                       authorization: str | None = Header(default=None)):
    from .services import predict
    player = await _player(authorization)
    return await _game(predict.save_picks, player, round_, ses.upper(), body.picks)


@app.get("/api/predict/leaderboard")
async def predict_leaderboard(round_: int | None = Query(default=None, alias="round"),
                              authorization: str | None = Header(default=None)):
    from .services import predict
    player = await _player(authorization, required=False)
    return await _game(predict.leaderboard, round_, player)


# ------------------------------------------------------------------ profiles

@app.get("/api/teams")
async def teams():
    from .services import profile
    return profile.teams()


@app.get("/api/profile/options")
async def profile_options():
    from .services import profile
    return await run_in_threadpool(profile.options)


@app.get("/api/profile/me")
async def profile_me(authorization: str | None = Header(default=None)):
    """Own profile incl. private settings (news teams); refreshes the provider avatar."""
    from .services import profile
    claims = _claims(authorization)
    player = await _player(authorization)
    await run_in_threadpool(profile.sync_avatar, player, claims)
    return await _game(profile.get_profile, player, True)


@app.put("/api/profile/me")
async def profile_update(body: ProfileBody, authorization: str | None = Header(default=None)):
    from .services import profile
    player = await _player(authorization)
    return await _game(profile.update_profile, player, body.newsTeams, body.favDrivers,
                       body.favTeams, body.favTrack)


@app.get("/api/profile/{name}")
async def profile_public(name: str):
    from .services import profile
    return await _game(profile.public_profile, name)
