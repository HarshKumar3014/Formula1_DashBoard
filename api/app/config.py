"""Central configuration for the F1 dashboard API."""
import os
from pathlib import Path

# Data directory (mounted as a Docker volume in production)
DATA_DIR = Path(os.environ.get("F1_DATA_DIR", str(Path(__file__).resolve().parents[2] / "data")))
FF1_CACHE_DIR = DATA_DIR / "ff1cache"
JSON_CACHE_DIR = DATA_DIR / "jsoncache"
DB_PATH = DATA_DIR / "f1.db"

# Current season; override via env if needed
SEASON = int(os.environ.get("F1_SEASON", "2026"))

# Jolpica API (Ergast successor) — volunteer hosted, be gentle
JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1"
JOLPICA_PAGE_LIMIT = 100
JOLPICA_REQUEST_DELAY = 0.6  # seconds between paginated requests

# News feeds (no API key required)
NEWS_FEEDS = [
    ("Formula1.com", "https://www.formula1.com/en/latest/all.xml"),
    ("Motorsport.com", "https://www.motorsport.com/rss/f1/news/"),
    ("RacingNews365", "https://racingnews365.com/feed/news.xml"),
]
TEAM_NEWS_KEYWORDS = {
    "ferrari": ["ferrari", "leclerc", "hamilton", "scuderia"],
    "mercedes": ["mercedes", "russell", "antonelli", "toto wolff"],
}
NEWS_CACHE_TTL = 15 * 60  # 15 minutes

# Cache TTLs (seconds)
STANDINGS_TTL = 6 * 3600      # refreshed by scheduler after races; TTL is a safety net
SCHEDULE_TTL = 6 * 3600
DRIVERS_TTL = 24 * 3600

# Constructor colors keyed by Jolpica constructorId (fallbacks applied fuzzily)
TEAM_COLORS = {
    "mercedes": "#27F4D2",
    "ferrari": "#E8002D",
    "mclaren": "#FF8000",
    "red_bull": "#3671C6",
    "alpine": "#00A1E8",
    "aston_martin": "#229971",
    "williams": "#64C4FF",
    "rb": "#6692FF",
    "sauber": "#52E252",
    "audi": "#BB0A30",
    "haas": "#B6BABD",
    "cadillac": "#C5A254",
}
DEFAULT_TEAM_COLOR = "#9CA3AF"


def team_color(constructor_id: str | None, constructor_name: str | None = None) -> str:
    """Best-effort constructor color lookup by id, falling back to name matching."""
    if constructor_id and constructor_id in TEAM_COLORS:
        return TEAM_COLORS[constructor_id]
    hay = f"{constructor_id or ''} {constructor_name or ''}".lower()
    for key, color in TEAM_COLORS.items():
        if key.replace("_", " ") in hay or key in hay:
            return color
    return DEFAULT_TEAM_COLOR


def ensure_dirs() -> None:
    for d in (DATA_DIR, FF1_CACHE_DIR, JSON_CACHE_DIR):
        d.mkdir(parents=True, exist_ok=True)
