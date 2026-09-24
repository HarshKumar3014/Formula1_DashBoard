"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, WS_BASE, useApi } from "@/lib/api";
import Section, { Card, Skeleton, ErrorNote } from "@/components/Section";
import TrackMap, { type Track } from "@/components/TrackMap";

/* ------------------------------------------------------------------ types */

type LiveStatus = {
  mode: "live" | "replay";
  liveSession: { event: string; session: string } | null;
  lastCompleted: { event: string; session: string } | null;
};
type Replay = {
  meta: {
    event: string;
    session: string;
    year: number;
    drivers: { code: string; name: string; team: string; color: string }[];
  };
  track: Track;
  start: number;
  duration: number;
  frames: { t: number; cars: Record<string, [number, number]> }[];
  lapBoards: { lap: number; t: number; order: { code: string; pos: number; lapTime: string | null }[] }[];
  events: { t: number; type: string; text: string }[];
};
type LiveCar = {
  code: string;
  color: string;
  x: number | null;
  y: number | null;
  pos: string | null;
  gap: string | null;
  lastLap: string | null;
  inPit?: boolean;
  retired?: boolean;
};
type LiveSnapshot = {
  type: string;
  cars?: Record<string, LiveCar>;
  trackStatus?: { Status?: string; Message?: string };
  sessionInfo?: { meeting?: string; session?: string };
  messages?: { Utc?: string; Message?: string; Category?: string }[];
  detail?: string;
};

const EVENT_STYLE: Record<string, string> = {
  fastlap: "text-purple-700 font-semibold",
  overtake: "text-emerald-700 font-semibold",
  pit: "text-sky-700",
  yellow: "text-amber-600 font-semibold",
  red: "text-red font-bold",
  sc: "text-amber-600 font-bold",
  vsc: "text-amber-600",
  green: "text-emerald-700",
  rc: "text-muted",
};

/* ------------------------------------------------------------- components */

function TimingTower({
  rows,
  title,
}: {
  rows: { pos: number | string; code: string; detail?: string | null; color?: string }[];
  title: string;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-paper px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted">
        {title}
      </div>
      <div className="max-h-[440px] divide-y divide-line overflow-y-auto">
        {rows.map((r) => (
          <div key={r.code} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <span className="w-6 text-right font-black tabular-nums text-muted">{r.pos}</span>
            <span
              className="h-4 w-1 rounded-full"
              style={{ background: r.color ?? "#c9c0af" }}
            />
            <span className="w-12 font-mono font-bold">{r.code}</span>
            <span className="flex-1 truncate text-right font-mono text-xs text-muted">
              {r.detail ?? ""}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Commentary({ items }: { items: { t?: number; type: string; text: string }[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-paper px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted">
        Commentary
      </div>
      <div className="flex max-h-[300px] flex-col-reverse gap-0.5 overflow-y-auto px-3 py-2">
        {items
          .slice(-40)
          .reverse()
          .map((e, i) => (
            <p key={i} className={`py-0.5 text-sm leading-snug ${EVENT_STYLE[e.type] ?? ""}`}>
              {e.t !== undefined && (
                <span className="mr-2 font-mono text-[10px] text-muted">
                  {Math.floor(e.t / 60)}:{String(Math.floor(e.t % 60)).padStart(2, "0")}
                </span>
              )}
              {e.text}
            </p>
          ))}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- replay */

const EVENT_FILTERS: { key: string; label: string; types: string[] }[] = [
  { key: "all", label: "All", types: [] },
  { key: "overtake", label: "Overtakes", types: ["overtake"] },
  { key: "pit", label: "Pit stops", types: ["pit"] },
  { key: "fastlap", label: "Fastest laps", types: ["fastlap"] },
  { key: "flag", label: "Flags", types: ["green", "yellow", "red", "sc", "vsc"] },
  { key: "rc", label: "Race control", types: ["rc"] },
];

function ReplayView() {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  // fractional playhead → cars interpolate smoothly between 1 Hz frames
  const [pos, setPos] = useState(0);
  const [speed, setSpeed] = useState(10);
  const [playing, setPlaying] = useState(true);
  const [filter, setFilter] = useState("all");
  const raf = useRef<number>(0);
  const lastTick = useRef(0);

  useEffect(() => {
    fetch(`${API_BASE}/api/replay`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
        return r.json();
      })
      .then(setReplay)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    if (!replay || !playing) return;
    const maxPos = replay.frames.length - 1;
    const step = (ts: number) => {
      if (!lastTick.current) lastTick.current = ts;
      const dt = (ts - lastTick.current) / 1000;
      lastTick.current = ts;
      setPos((p) => Math.min(maxPos, p + dt * speed));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf.current);
      lastTick.current = 0;
    };
  }, [replay, playing, speed]);

  // lap navigation + keyboard transport
  const jumpLap = (dir: 1 | -1) => {
    setReplay((r) => {
      if (r) {
        setPos((p) => {
          const t = r.frames[Math.floor(p)]?.t ?? 0;
          const idx = r.lapBoards.findLastIndex((b) => b.t <= t);
          const target = r.lapBoards[Math.max(0, Math.min(r.lapBoards.length - 1, idx + dir))];
          return target ? Math.max(0, target.t - r.start) : p;
        });
      }
      return r;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.code === "ArrowRight") {
        setPos((p) => p + 30);
      } else if (e.code === "ArrowLeft") {
        setPos((p) => Math.max(0, p - 30));
      } else if (e.key === "n") {
        jumpLap(1);
      } else if (e.key === "p") {
        jumpLap(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error)
    return <ErrorNote message={`Replay unavailable: ${error}`} />;
  if (!replay)
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
        <p className="text-xs text-muted">
          Building replay of the last session — first build downloads full position data and can
          take a couple of minutes.
        </p>
      </div>
    );

  const idx = Math.min(Math.floor(pos), replay.frames.length - 1);
  const frac = Math.min(pos - idx, 1);
  const frame = replay.frames[idx];
  const nextFrame = replay.frames[idx + 1];
  const colors = Object.fromEntries(replay.meta.drivers.map((d) => [d.code, d.color]));
  const t = frame?.t ?? 0;
  const board =
    [...replay.lapBoards].reverse().find((b) => b.t <= t) ?? replay.lapBoards[0];
  const activeTypes = EVENT_FILTERS.find((f) => f.key === filter)?.types ?? [];
  const pastEvents = replay.events.filter(
    (e) => e.t <= t && (filter === "all" || activeTypes.includes(e.type)),
  );

  // interpolated car positions for buttery motion at any speed
  const cars: [string, [number, number]][] = frame
    ? Object.entries(frame.cars).map(([code, [x, y]]) => {
        const nxt = nextFrame?.cars[code];
        if (!nxt) return [code, [x, y]];
        return [code, [x + (nxt[0] - x) * frac, y + (nxt[1] - y) * frac]];
      })
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="display text-2xl font-black uppercase italic">
          Replay · {replay.meta.event} — {replay.meta.session}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => jumpLap(-1)}
            title="Previous lap (p)"
            className="border border-line bg-card px-2.5 py-1.5 text-xs font-bold text-muted hover:text-ink"
          >
            ‹ Lap
          </button>
          <button
            onClick={() => setPlaying((p) => !p)}
            title="Play/pause (space)"
            className="bg-red px-5 py-1.5 text-sm font-bold text-white transition-transform hover:scale-105"
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button
            onClick={() => jumpLap(1)}
            title="Next lap (n)"
            className="border border-line bg-card px-2.5 py-1.5 text-xs font-bold text-muted hover:text-ink"
          >
            Lap ›
          </button>
          <div className="mx-1 h-5 w-px bg-line" />
          {[1, 5, 10, 30, 60].map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2 py-1.5 font-mono text-xs font-bold ${
                speed === s ? "bg-ink text-white" : "text-muted hover:text-ink"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={replay.frames.length - 1}
        value={idx}
        onChange={(e) => setPos(+e.target.value)}
        className="w-full accent-[#e10600]"
      />
      <p className="-mt-2 font-mono text-[10px] uppercase tracking-wider text-muted">
        space = play/pause · ←/→ = ±30s · p/n = prev/next lap · drag slider to scrub
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-baseline gap-4">
              {board && (
                <span className="display text-3xl font-black italic leading-none">
                  LAP {board.lap}
                  <span className="text-lg text-muted">/{replay.lapBoards.at(-1)?.lap}</span>
                </span>
              )}
              <span className="font-mono text-sm tabular-nums text-muted">
                {(() => {
                  const rt = Math.max(0, t - (replay.lapBoards[0]?.t ?? 0));
                  const h = Math.floor(rt / 3600);
                  return `${h > 0 ? `${h}:` : ""}${String(Math.floor((rt % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(rt % 60)).padStart(2, "0")}`;
                })()}
              </span>
            </div>
            <span className="font-mono text-xs text-muted">{speed}× speed</span>
          </div>
          <TrackMap track={replay.track}>
            {(tf) => (
              <>
                {cars.map(([code, [x, y]]) => (
                    <g key={code}>
                      <circle
                        cx={tf.tx(x)}
                        cy={tf.ty(y)}
                        r={7}
                        fill={colors[code] ?? "#9CA3AF"}
                        stroke="#fffdf8"
                        strokeWidth={1.5}
                      />
                      <text
                        x={tf.tx(x) + 9}
                        y={tf.ty(y) + 3}
                        fontSize={9}
                        fontWeight={700}
                        fill="#191511"
                        stroke="#f6f2ea"
                        strokeWidth={2.5}
                        paintOrder="stroke"
                      >
                        {code}
                      </text>
                    </g>
                  ))}
              </>
            )}
          </TrackMap>
        </Card>
        <div className="space-y-4">
          {board && (
            <TimingTower
              title={`Lap ${board.lap}`}
              rows={board.order.map((o) => ({
                pos: o.pos,
                code: o.code,
                detail: o.lapTime,
                color: colors[o.code],
              }))}
            />
          )}
        </div>
      </div>
      <div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {EVENT_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                filter === f.key
                  ? "bg-ink text-white"
                  : "border border-line bg-card text-muted hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Commentary items={pastEvents} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ live */

function LiveView({ track }: { track: Track | null }) {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [closed, setClosed] = useState<string | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws/live`);
    ws.onmessage = (ev) => {
      const data: LiveSnapshot = JSON.parse(ev.data);
      if (data.type === "no_live") setClosed(data.detail ?? "No live session.");
      else setSnap(data);
    };
    ws.onerror = () => setClosed("Live connection failed.");
    return () => ws.close();
  }, []);

  if (closed) return <ErrorNote message={closed} />;
  if (!snap) return <Skeleton className="h-96" />;

  const cars = Object.values(snap.cars ?? {});
  const ordered = [...cars]
    .filter((c) => c.pos)
    .sort((a, b) => Number(a.pos) - Number(b.pos));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="live-dot h-3 w-3 rounded-full bg-red" />
        <h2 className="text-lg font-bold uppercase tracking-wide">
          {snap.sessionInfo?.meeting} — {snap.sessionInfo?.session}
        </h2>
        {snap.trackStatus?.Message && (
          <span className="rounded-full border border-line bg-paper px-3 py-1 text-xs font-bold">
            {snap.trackStatus.Message}
          </span>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          {track ? (
            <TrackMap track={track}>
              {(tf) => (
                <>
                  {cars
                    .filter((c) => c.x != null && c.y != null && !c.retired)
                    .map((c) => (
                      <g key={c.code}>
                        <circle
                          cx={tf.tx(c.x!)}
                          cy={tf.ty(c.y!)}
                          r={7}
                          fill={c.color}
                          stroke="#fffdf8"
                          strokeWidth={1.5}
                          opacity={c.inPit ? 0.4 : 1}
                        />
                        <text
                          x={tf.tx(c.x!) + 9}
                          y={tf.ty(c.y!) + 3}
                          fontSize={9}
                          fontWeight={700}
                          fill="#191511"
                          stroke="#f6f2ea"
                          strokeWidth={2.5}
                          paintOrder="stroke"
                        >
                          {c.code}
                        </text>
                      </g>
                    ))}
                </>
              )}
            </TrackMap>
          ) : (
            <p className="p-8 text-center text-sm text-muted">
              Track outline unavailable — positions listed in the tower.
            </p>
          )}
        </Card>
        <div className="space-y-4">
          <TimingTower
            title="Live timing"
            rows={ordered.map((c) => ({
              pos: c.pos!,
              code: c.code,
              detail: c.inPit ? "IN PIT" : c.gap || c.lastLap,
              color: c.color,
            }))}
          />
        </div>
      </div>
      <Commentary
        items={(snap.messages ?? []).map((m) => ({
          type: "rc",
          text: m.Message ?? "",
        }))}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function LivePage() {
  const { data: status } = useApi<LiveStatus>("/api/live/status", 60_000);
  const [mode, setMode] = useState<"auto" | "live" | "replay">("auto");
  // reuse replay track outline for the live map (same venue during a live weekend)
  const { data: replayForTrack } = useApi<Replay>(
    status?.mode === "live" ? "/api/replay" : null,
  );

  const effective = mode === "auto" ? status?.mode ?? "replay" : mode;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {status?.liveSession && (
          <div className="mr-auto flex items-center gap-2 text-sm font-bold text-red">
            <span className="live-dot h-2.5 w-2.5 rounded-full bg-red" />
            {status.liveSession.session} — {status.liveSession.event}
          </div>
        )}
        <div className="ml-auto flex gap-1.5">
          {(["auto", "live", "replay"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
                mode === m
                  ? "bg-red text-white"
                  : "border border-line text-muted hover:text-ink"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      {effective === "live" ? (
        <LiveView track={replayForTrack?.track ?? null} />
      ) : (
        <ReplayView />
      )}
    </div>
  );
}
