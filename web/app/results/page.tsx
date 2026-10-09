"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useApi } from "@/lib/api";
import Section, { Card, Skeleton, ErrorNote } from "@/components/Section";
import {
  SESSION_SHORT,
  shortDate,
  type Season,
  type SeasonEvent,
  type SessionCode,
} from "@/lib/sessions";

type Driver = { code: string; number: string; name: string; team: string; teamColor: string };
type RaceRow = Driver & {
  pos: number | null;
  classified: string;
  grid: number | null;
  laps: number | null;
  gap: string | null;
  status: string;
  points: number | null;
};
type QualiRow = Driver & {
  pos: number | null;
  q1: string | null;
  q2: string | null;
  q3: string | null;
  gap: string | null;
};
type PracticeRow = Driver & {
  pos: number | null;
  best: string | null;
  gap: string | null;
  laps: number | null;
};
type SessionResults = {
  round: number;
  session: SessionCode;
  sessionName: string;
  kind: "race" | "quali" | "practice";
  event: string;
  fastestLap: { code: string; time: string; lap: number } | null;
  rows: (RaceRow | QualiRow | PracticeRow)[];
};

/* ------------------------------------------------------------ table bits */

function DriverCell({ d }: { d: Driver }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: d.teamColor }} />
      <span className="w-10 font-mono font-bold">{d.code}</span>
      <span className="min-w-0">
        <span className="block truncate font-semibold">{d.name}</span>
        <span className="block truncate text-[11px] text-muted">{d.team}</span>
      </span>
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

/** `classified` is the official mark — R(etired), D(isqualified), … — when not a number. */
function PosCell({ pos, classified }: { pos: number | null; classified?: string }) {
  const label = classified && !/^\d+$/.test(classified) ? classified : (pos ?? "—");
  const podium = typeof label === "number" && label <= 3;
  return (
    <td className="w-12 px-3 py-2">
      <span
        className={`display inline-block min-w-7 text-center text-lg font-black ${
          podium ? "bg-ink text-white" : "text-muted"
        }`}
      >
        {label}
      </span>
    </td>
  );
}

function GridDelta({ grid, pos }: { grid: number | null; pos: number | null }) {
  if (!grid || !pos) return <span className="text-muted">{grid || "PL"}</span>;
  const d = grid - pos;
  return (
    <span className="tabular-nums">
      {grid}
      {d !== 0 && (
        <span className={`ml-1.5 text-[11px] font-bold ${d > 0 ? "text-emerald-700" : "text-red"}`}>
          {d > 0 ? `▲${d}` : `▼${-d}`}
        </span>
      )}
    </span>
  );
}

function ResultsTable({ data }: { data: SessionResults }) {
  const rowCls = "border-t border-line text-sm hover:bg-paper/70";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px]">
        <thead className="bg-paper">
          {data.kind === "race" && (
            <tr>
              <Th>Pos</Th>
              <Th>Driver</Th>
              <Th right>Grid</Th>
              <Th right>Laps</Th>
              <Th right>Time / Gap</Th>
              <Th right>Pts</Th>
            </tr>
          )}
          {data.kind === "quali" && (
            <tr>
              <Th>Pos</Th>
              <Th>Driver</Th>
              <Th right>{data.session === "SQ" ? "SQ1" : "Q1"}</Th>
              <Th right>{data.session === "SQ" ? "SQ2" : "Q2"}</Th>
              <Th right>{data.session === "SQ" ? "SQ3" : "Q3"}</Th>
              <Th right>Gap</Th>
            </tr>
          )}
          {data.kind === "practice" && (
            <tr>
              <Th>Pos</Th>
              <Th>Driver</Th>
              <Th right>Best lap</Th>
              <Th right>Gap</Th>
              <Th right>Laps</Th>
            </tr>
          )}
        </thead>
        <tbody className="font-mono">
          {data.rows.map((r, i) => (
            <motion.tr
              key={r.code}
              className={rowCls}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.4) }}
            >
              {data.kind === "race" &&
                (() => {
                  const row = r as RaceRow;
                  const fl = data.fastestLap?.code === row.code;
                  return (
                    <>
                      <PosCell pos={row.pos} classified={row.classified} />
                      <td className="px-3 py-2 font-sans">
                        <DriverCell d={row} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <GridDelta grid={row.grid} pos={/^\d+$/.test(row.classified) ? row.pos : null} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{row.laps ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.gap ?? "—"}
                        {fl && (
                          <span
                            title={`Fastest lap ${data.fastestLap!.time} (lap ${data.fastestLap!.lap})`}
                            className="ml-2 bg-purple-700 px-1.5 py-0.5 text-[10px] font-bold text-white"
                          >
                            FL {data.fastestLap!.time}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">
                        {row.points ? row.points : ""}
                      </td>
                    </>
                  );
                })()}
              {data.kind === "quali" &&
                (() => {
                  const row = r as QualiRow;
                  return (
                    <>
                      <PosCell pos={row.pos} />
                      <td className="px-3 py-2 font-sans">
                        <DriverCell d={row} />
                      </td>
                      {[row.q1, row.q2, row.q3].map((q, k) => (
                        <td
                          key={k}
                          className={`px-3 py-2 text-right tabular-nums ${q ? "" : "text-line"}`}
                        >
                          {q ?? "—"}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{row.gap ?? ""}</td>
                    </>
                  );
                })()}
              {data.kind === "practice" &&
                (() => {
                  const row = r as PracticeRow;
                  return (
                    <>
                      <PosCell pos={row.pos} />
                      <td className="px-3 py-2 font-sans">
                        <DriverCell d={row} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.best ?? "no time"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{row.gap ?? ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{row.laps ?? "—"}</td>
                    </>
                  );
                })()}
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------- round strip */

function RoundCard({
  ev,
  active,
  onClick,
}: {
  ev: SeasonEvent;
  active: boolean;
  onClick: () => void;
}) {
  const started = ev.sessions.some((s) => s.complete);
  const winner = ev.podium?.[0];
  return (
    <button
      onClick={onClick}
      disabled={!started}
      data-active={active}
      className={`flex w-40 shrink-0 flex-col gap-1 border px-3 py-2.5 text-left transition-all ${
        active
          ? "border-ink bg-ink text-white shadow-[4px_4px_0_var(--red)]"
          : started
            ? "border-line bg-card hover:border-ink"
            : "cursor-not-allowed border-dashed border-line bg-transparent opacity-50"
      }`}
    >
      <span className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-wider">
        <span className={active ? "text-white/70" : "text-muted"}>R{ev.round}</span>
        <span className={active ? "text-white/70" : "text-muted"}>{shortDate(ev.dateUtc)}</span>
      </span>
      <span className="display truncate text-lg font-black uppercase leading-tight">
        {ev.name.replace(" Grand Prix", "")}
      </span>
      <span className="flex h-4 items-center gap-1.5 text-[11px] font-bold">
        {winner ? (
          <>
            <span className="h-3 w-1 rounded-full" style={{ background: winner.teamColor }} />
            <span className="font-mono">{winner.code}</span>
            <span className={active ? "text-white/60" : "text-muted"}>wins</span>
          </>
        ) : started ? (
          <span className="text-red">in progress</span>
        ) : (
          <span className={active ? "text-white/60" : "text-muted"}>upcoming</span>
        )}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ page */

export default function ResultsPage() {
  const { data: season, error } = useApi<Season>("/api/results", 10 * 60_000);
  const [round, setRound] = useState<number | null>(null);
  const [ses, setSes] = useState<SessionCode | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  const played = season?.events.filter((e) => e.sessions.some((s) => s.complete)) ?? [];
  const event = season?.events.find((e) => e.round === round) ?? played.at(-1) ?? null;
  const done = event?.sessions.filter((s) => s.complete) ?? [];
  const code = ses && done.some((s) => s.code === ses) ? ses : (done.at(-1)?.code ?? null);

  const { data: results, error: resErr, loading } = useApi<SessionResults>(
    event && code ? `/api/results/${event.round}/${code}` : null,
  );

  // bring the selected round into view on first load
  useEffect(() => {
    strip.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [event?.round]);

  return (
    <div className="space-y-6">
      <Section title="Results" subtitle={`${season?.season ?? ""} season · every session`}>
        {error && <ErrorNote message={error} />}
        {!season && !error && <Skeleton className="h-24" />}
        {season && (
          <div ref={strip} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6">
            {season.events.map((ev) => (
              <RoundCard
                key={ev.round}
                ev={ev}
                active={ev.round === event?.round}
                onClick={() => {
                  setRound(ev.round);
                  setSes(null);
                }}
              />
            ))}
          </div>
        )}
      </Section>

      {event && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
                Round {event.round} · {event.location}, {event.country}
              </p>
              <h2 className="display text-3xl font-black uppercase sm:text-4xl">{event.name}</h2>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {event.sessions.map((s) => (
                <button
                  key={s.code}
                  disabled={!s.complete}
                  onClick={() => setSes(s.code)}
                  title={s.complete ? s.name : `${s.name} — not run yet`}
                  className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                    code === s.code
                      ? "bg-red text-white"
                      : s.complete
                        ? "border border-line bg-card text-muted hover:text-ink"
                        : "cursor-not-allowed border border-dashed border-line text-line"
                  }`}
                >
                  {SESSION_SHORT[s.code]}
                </button>
              ))}
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="text-xs font-bold uppercase tracking-widest text-muted">
                {results?.sessionName ?? "Loading…"}
              </span>
              {code && (
                <Link
                  href={`/replay?round=${event.round}&session=${code}`}
                  className="bg-ink px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-red"
                >
                  ▶ Replay this session
                </Link>
              )}
            </div>
            {loading && (
              <div className="space-y-2 p-4">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <p className="text-xs text-muted">
                  First load of a session pulls timing data from F1 — can take ~30s.
                </p>
              </div>
            )}
            {resErr && !loading && (
              <div className="p-4">
                <ErrorNote message={resErr} />
              </div>
            )}
            {results && !loading && <ResultsTable data={results} />}
          </Card>
        </div>
      )}
    </div>
  );
}
