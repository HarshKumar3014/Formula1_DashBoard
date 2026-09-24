"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Trailing slashes would produce `//api/...`, which FastAPI 404s on.
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8020"
).replace(/\/+$/, "");

export const WS_BASE = API_BASE.replace(/^http/, "ws");

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
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
