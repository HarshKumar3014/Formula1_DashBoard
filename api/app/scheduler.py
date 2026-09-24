"""Background jobs: cache warming and refresh. Keeps external APIs off the request path."""
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler

log = logging.getLogger(__name__)


def _refresh_news():
    from . import jsoncache
    from .services import news
    jsoncache.set("news", news.build_news())
    log.info("news refreshed")


def _refresh_standings():
    from .services import standings
    standings.refresh()


def _refresh_schedule():
    from . import jsoncache
    from .config import SEASON
    from .services import schedule
    jsoncache.set(f"schedule_{SEASON}", schedule.build_schedule(SEASON))
    log.info("schedule refreshed")


def _weekly_backfill():
    from .aggregation import backfill
    backfill.run_backfill()


def _warm_replay():
    """Pre-build the replay bundle for the last completed session (slow first load)."""
    from .services import replay
    target = replay.find_last_completed()
    if target:
        replay.get_replay(target["year"], target["round"], target["session"])
        log.info("replay warmed: %s", target)


def _live_watchdog():
    """Start the live timing client shortly before/during a live session."""
    from .services import live, schedule
    info = schedule.get_next_session()
    now = datetime.now(timezone.utc)
    should_run = False
    if info.get("live"):
        should_run = True
    elif info.get("next"):
        start = datetime.fromisoformat(info["next"]["dateUtc"])
        # start recording 3 minutes before the session
        should_run = 0 < (start - now).total_seconds() < 180
    if should_run and not live.manager.running:
        live.manager.start()


def create_scheduler() -> BackgroundScheduler:
    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(_refresh_news, "interval", minutes=15, jitter=60)
    # standings: after race weekends + daily safety net (standings only change after races)
    sched.add_job(_refresh_standings, "cron", day_of_week="sun", hour=18)
    sched.add_job(_refresh_standings, "cron", day_of_week="mon", hour=6)
    sched.add_job(_refresh_schedule, "cron", hour=5)
    sched.add_job(_weekly_backfill, "cron", day_of_week="mon", hour=4)
    sched.add_job(_warm_replay, "cron", day_of_week="sun,mon", hour=22)
    sched.add_job(_live_watchdog, "interval", minutes=2)
    return sched
