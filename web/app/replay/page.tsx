"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, useApi } from "@/lib/api";
import { SESSION_SHORT, type Season, type SessionCode } from "@/lib/sessions";
import { Card, Skeleton, ErrorNote } from "@/components/Section";
import TrackMap, { type Track } from "@/components/TrackMap";

/* ------------------------------------------------------------------ types */

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

function ReplayView({ query }: { query: string }) {
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
    apiFetch<Replay>(`/api/replay${query}`)
      .then(setReplay)
      .catch((e) => setError(String(e.message ?? e)));
  }, [query]);

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
          Building the replay — first build of a session downloads full position data and can
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

/* ---------------------------------------------------------------- picker */

function SessionPicker({ round, ses }: { round: number | null; ses: SessionCode | null }) {
  const router = useRouter();
  const { data: season } = useApi<Season>("/api/results");
  const played = season?.events.filter((e) => e.sessions.some((s) => s.complete)) ?? [];
  const event = played.find((e) => e.round === round) ?? null;

  const go = (r: number, code: SessionCode) => router.push(`/replay?round=${r}&session=${code}`);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={round ?? ""}
        onChange={(e) => {
          const ev = played.find((x) => x.round === +e.target.value);
          const last = ev?.sessions.filter((s) => s.complete).at(-1);
          if (ev && last) go(ev.round, last.code);
          else router.push("/replay");
        }}
        className="max-w-64 border border-line bg-card px-2 py-1.5 text-sm"
      >
        <option value="">Latest session</option>
        {played.map((e) => (
          <option key={e.round} value={e.round}>
            R{e.round} · {e.name}
          </option>
        ))}
      </select>
      {event?.sessions
        .filter((s) => s.complete)
        .map((s) => (
          <button
            key={s.code}
            onClick={() => go(event.round, s.code)}
            className={`px-2.5 py-1.5 text-xs font-bold uppercase ${
              ses === s.code ? "bg-red text-white" : "border border-line bg-card text-muted hover:text-ink"
            }`}
          >
            {SESSION_SHORT[s.code]}
          </button>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ page */

function ReplayPageInner() {
  const params = useSearchParams();
  const round = Number(params.get("round")) || null;
  const ses = (params.get("session")?.toUpperCase() as SessionCode | undefined) ?? null;
  // no session picked → the latest completed one, resolved from the (CDN) season index
  const { data: season, error } = useApi<Season>(round && ses ? null : "/api/results");
  const latest = season?.events
    .flatMap((e) => e.sessions.filter((s) => s.complete).map((s) => ({ round: e.round, code: s.code })))
    .at(-1);
  const query =
    round && ses
      ? `?round=${round}&session=${ses}`
      : latest
        ? `?round=${latest.round}&session=${latest.code}`
        : season || error
          ? "" // nothing indexed → let the API pick
          : null;

  return (
    <div className="space-y-4">
      <SessionPicker round={round ?? latest?.round ?? null} ses={ses ?? latest?.code ?? null} />
      {query === null ? <Skeleton className="h-96" /> : <ReplayView key={query} query={query} />}
    </div>
  );
}

export default function ReplayPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ReplayPageInner />
    </Suspense>
  );
}
