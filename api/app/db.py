"""Prediction-game storage (SQLAlchemy Core): SQLite locally, Postgres when hosted."""
from sqlalchemy import (JSON, Column, DateTime, ForeignKey, Integer, MetaData, String, Table,
                        UniqueConstraint, create_engine)

from .config import DATABASE_URL

metadata = MetaData()

players = Table(
    "players", metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(24), nullable=False),
    Column("name_key", String(24), nullable=False, unique=True),  # lower-cased for uniqueness
    Column("auth_id", String(64), nullable=False, unique=True),   # Supabase user id (JWT sub)
    Column("created_at", DateTime(timezone=True), nullable=False),
)

predictions = Table(
    "predictions", metadata,
    Column("id", Integer, primary_key=True),
    Column("player_id", Integer, ForeignKey("players.id", ondelete="CASCADE"), nullable=False),
    Column("season", Integer, nullable=False),
    Column("round", Integer, nullable=False),
    Column("session", String(4), nullable=False),
    Column("picks", JSON, nullable=False),          # 10 driver codes, P1 first
    Column("score", Integer),                       # null until the session is scored
    Column("detail", JSON),                         # per-pick breakdown once scored
    Column("updated_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("player_id", "season", "round", "session", name="uq_prediction"),
)


def _normalise(url: str) -> str:
    # Neon/Supabase/Render hand out postgres:// URLs; SQLAlchemy needs the driver named
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


_url = _normalise(DATABASE_URL)
engine = create_engine(
    _url,
    pool_pre_ping=True,  # serverless Postgres drops idle connections
    connect_args={"check_same_thread": False} if _url.startswith("sqlite") else {},
)


def init() -> None:
    metadata.create_all(engine)
