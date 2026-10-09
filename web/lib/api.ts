"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Trailing slashes would produce `//api/...`, which FastAPI 404s on.
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8020"
).replace(/\/+$/, "");

export const WS_BASE = API_BASE.replace(/^http/, "ws");

export const SEASON = Number(process.env.NEXT_PUBLIC_F1_SEASON ?? 2026);

/**
 * Precomputed data on the Supabase Storage CDN (filled by the API's `app.publish` job).
 * Reads go there first: instant, and independent of the API host being awake.
 */
export const DATA_BASE =
  process.env.NEXT_PUBLIC_DATA_URL?.replace(/\/+$/, "") ||
  (process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/pitwall/v1`
    : null);

/** API GET path → CDN key, for everything the publisher uploads. */
function cdnKey(path: string): string | null {
  const [p, qs = ""] = path.split("?");
  const q = new URLSearchParams(qs);
  const fixed: Record<string, string> = {
    "/api/standings": `standings_${SEASON}`,
    "/api/drivers": `grid_${SEASON}`,
    "/api/news": "news_v2",
    "/api/schedule": `schedule_${SEASON}`,
    "/api/circuits": `circuit_stats_${SEASON}`,
    "/api/records": "records",
    "/api/results": `season_${SEASON}`,
  };
  if (fixed[p] && !qs) return fixed[p];
  let m = p.match(/^\/api\/results\/(\d+)\/(\w+)$/);
  if (m) return `results_${SEASON}_${m[1]}_${m[2].toUpperCase()}`;
  m = p.match(/^\/api\/telemetry\/(\d+)\/(\d+)\/(\w+)\/bundle$/);
  if (m) return `telemetry_${m[1]}_${m[2]}_${m[3].toUpperCase()}`;
  if (p === "/api/telemetry/options" && Number(q.get("year") ?? SEASON) === SEASON)
    return `telemetry_options_${SEASON}`;
  if (p === "/api/replay" && q.get("round") && q.get("session"))
    return `replay_${SEASON}_${q.get("round")}_${q.get("session")!.toUpperCase()}`;
  return null;
}

async function fromCdn<T>(path: string): Promise<T | null> {
  const key = DATA_BASE && cdnKey(path);
  if (!key) return null;
  try {
    const res = await fetch(`${DATA_BASE}/${key}.json`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null; // fall back to the API
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // plain GETs of published data come from the CDN; anything personal goes to the API
  if (!init) {
    const cached = await fromCdn<T>(path);
    if (cached !== null) return cached;
  }
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not json */
    }
    throw new Error(detail);
  }
  return res.json();
}

/** Client-side fetch hook with optional refresh interval (ms). */
export function useApi<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await apiFetch<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (pathRef.current === p) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (pathRef.current === p) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(!!path);
    if (!path) return;
    load();
    if (refreshMs) {
      const id = setInterval(load, refreshMs);
      return () => clearInterval(id);
    }
  }, [path, refreshMs, load]);

  return { data, error, loading, reload: load };
}

export function timeAgo(epoch: number | null): string {
  if (!epoch) return "";
  const s = Math.floor(Date.now() / 1000 - epoch);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
