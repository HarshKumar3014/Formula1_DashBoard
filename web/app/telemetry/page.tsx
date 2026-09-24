"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/api";
import Section, { Card, Skeleton, ErrorNote } from "@/components/Section";
import TelemetryCharts, { type DriverTrace } from "@/components/TelemetryCharts";
import TrackMap, { SpeedLegend, type Track } from "@/components/TrackMap";

type Options = {
  season: number;
  minYear: number;
  maxYear: number;
  events: { round: number; name: string; country: string; sessions: string[] }[];
};
type SessionDrivers = {
  event: string;
  drivers: { code: string; name: string; team: string; teamColor: string; position: number | null }[];
};
type TelemetryData = {
  event: string;
  drivers: DriverTrace[];
  track: Track | null;
  error?: string;
};

const SESSION_LABELS: Record<string, string> = {
  "Practice 1": "FP1",
  "Practice 2": "FP2",
  "Practice 3": "FP3",
  Qualifying: "Q",
  "Sprint Qualifying": "SQ",
  Sprint: "S",
  Race: "R",
};

export default function TelemetryPage() {
  const currentYear = 2026;
  const [year, setYear] = useState(currentYear);
  const [round, setRound] = useState<number | null>(null);
  const [ses, setSes] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loadRequested, setLoadRequested] = useState(false);
  const [hoverDistance, setHoverDistance] = useState<number | null>(null);
  const [quickPick, setQuickPick] = useState(false);

  const { data: options } = useApi<Options>(`/api/telemetry/options?year=${year}`);
  const event = options?.events.find((e) => e.round === round) ?? null;

  const { data: sessionDrivers, error: drvErr, loading: drvLoading } = useApi<SessionDrivers>(
    round && ses ? `/api/telemetry/${year}/${round}/${ses}/drivers` : null,
  );

  const telemetryPath = useMemo(() => {
    if (!loadRequested || !round || !ses || selected.length === 0) return null;
    return `/api/telemetry/${year}/${round}/${ses}?drivers=${selected.join(",")}`;
  }, [loadRequested, year, round, ses, selected]);
  const { data: tel, error: telErr, loading: telLoading } = useApi<TelemetryData>(telemetryPath);

  useEffect(() => {
    if (quickPick && sessionDrivers) {
      const ordered = [...sessionDrivers.drivers]
        .filter((d) => d.position != null)
        .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
      setSelected(ordered.slice(0, 2).map((d) => d.code));
      setLoadRequested(true);
      setQuickPick(false);
    }
  }, [quickPick, sessionDrivers]);

  const years = [];
  for (let y = currentYear; y >= 2018; y--) years.push(y);

  const toggleDriver = (code: string) => {
    setLoadRequested(false);
    setSelected((s) =>
      s.includes(code) ? s.filter((c) => c !== code) : s.length < 4 ? [...s, code] : s,
    );
  };

  return (
    <div className="space-y-6">
      <Section title="Telemetry" subtitle="fastest-lap comparison · data from 2018 onwards">
        {/* ------------------------------------------------ selectors */}
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                const last = options?.events.filter((e) => e.sessions.includes("Race")).at(-1);
                if (!last) return;
                setRound(last.round);
                setSes("R");
                setSelected([]);
                setLoadRequested(false);
                setQuickPick(true);
              }}
              className="pit-board px-3 py-1.5 text-xs font-bold uppercase text-white transition-transform hover:scale-105"
            >
              <span>&#9889; Latest race — top 2</span>
            </button>
            <label className="flex items-center gap-2 text-sm">
              <span className="font-bold uppercase text-xs tracking-wider text-muted">Year</span>
              <select
                value={year}
                onChange={(e) => {
                  setYear(+e.target.value);
                  setRound(null);
                  setSes(null);
                  setSelected([]);
                  setLoadRequested(false);
                }}
                className="rounded-md border border-line bg-paper px-2 py-1.5"
              >
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="font-bold uppercase text-xs tracking-wider text-muted">Event</span>
              <select
                value={round ?? ""}
                onChange={(e) => {
                  setRound(+e.target.value || null);
                  setSes(null);
                  setSelected([]);
                  setLoadRequested(false);
                }}
                className="max-w-56 rounded-md border border-line bg-paper px-2 py-1.5"
              >
                <option value="">— select —</option>
                {options?.events.map((e) => (
                  <option key={e.round} value={e.round}>
                    R{e.round} · {e.name}
                  </option>
                ))}
              </select>
            </label>
            {event && (
              <div className="flex items-center gap-1.5">
                {event.sessions.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setSes(SESSION_LABELS[s] ?? s);
                      setSelected([]);
                      setLoadRequested(false);
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                      ses === (SESSION_LABELS[s] ?? s)
                        ? "bg-red text-white"
                        : "border border-line bg-paper text-muted hover:text-ink"
                    }`}
                  >
                    {SESSION_LABELS[s] ?? s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ------------------------------------------------ drivers */}
          {drvLoading && <Skeleton className="h-16" />}
          {drvErr && <ErrorNote message={drvErr} />}
          {sessionDrivers && (
            <div>
              <p className="mb-2 text-xs text-muted">
                Pick up to 4 drivers to compare — fastest lap of each:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sessionDrivers.drivers.map((d) => {
                  const on = selected.includes(d.code);
                  return (
                    <button
                      key={d.code}
                      onClick={() => toggleDriver(d.code)}
                      className={`rounded-md border px-2.5 py-1 font-mono text-sm font-bold transition-all ${
                        on ? "text-white" : "text-muted hover:text-ink"
                      }`}
                      style={{
                        borderColor: d.teamColor,
                        background: on ? d.teamColor : "transparent",
                      }}
                      title={d.name}
                    >
                      {d.code}
                    </button>
                  );
                })}
              </div>
              <button
                disabled={selected.length === 0 || telLoading}
                onClick={() => setLoadRequested(true)}
                className="mt-3 rounded-md bg-red px-4 py-2 text-sm font-bold text-white transition-opacity disabled:opacity-40"
              >
                {telLoading ? "Loading telemetry…" : "Load telemetry"}
              </button>
              {telLoading && (
                <p className="mt-2 text-xs text-muted">
                  First load of a session downloads full car data — can take a minute. Cached after.
                </p>
              )}
            </div>
          )}
        </Card>
      </Section>

      {telErr && <ErrorNote message={telErr} />}
      {tel?.error && <ErrorNote message={tel.error} />}

      {tel && tel.drivers.length > 0 && (
        <div className="fade-up grid gap-4 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-2 lg:sticky lg:top-20 lg:self-start">
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
                  {tel.event} — track dominance by speed
                </h3>
                <SpeedLegend />
              </div>
              <TrackMap track={tel.track} markerDistance={hoverDistance} />
            </Card>
            <Card className="divide-y divide-line">
              {tel.drivers.map((d) => (
                <div key={d.code} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="h-6 w-1.5 rounded-full" style={{ background: d.color }} />
                  <div className="flex-1">
                    <div className="font-semibold">{d.name}</div>
                    <div className="text-xs text-muted">
                      lap {"lapNumber" in d ? (d as DriverTrace & { lapNumber?: number }).lapNumber : ""}
                      {d.compound ? ` · ${d.compound}` : ""}
                    </div>
                  </div>
                  <span className="font-mono font-bold">{d.lapTime}</span>
                </div>
              ))}
            </Card>
          </div>
          <div className="lg:col-span-3">
            <TelemetryCharts drivers={tel.drivers} onHoverDistance={setHoverDistance} />
          </div>
        </div>
      )}
    </div>
  );
}
