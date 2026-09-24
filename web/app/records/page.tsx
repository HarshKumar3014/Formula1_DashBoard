"use client";
import { useState } from "react";
import { motion } from "motion/react";
import { useApi } from "@/lib/api";
import Section, { Card, Skeleton, ErrorNote } from "@/components/Section";

type Leader = { name: string; n: number; firstSeason: number; lastSeason: number };
type Winner = { driver_name: string; age: number; race_name: string; season: number };
type Records = {
  mostWins: Leader[];
  mostPoles: Leader[];
  mostFastestLaps: Leader[];
  mostPodiums: Leader[];
  mostChampionships: Leader[];
  mostConstructorTitles: Leader[];
  youngestWinners: Winner[];
  oldestWinners: Winner[];
  unavailable: string[];
  caveats: Record<string, string>;
};

const TABS: { key: keyof Records; label: string; unit: string }[] = [
  { key: "mostWins", label: "Wins", unit: "wins" },
  { key: "mostPoles", label: "Poles", unit: "poles" },
  { key: "mostPodiums", label: "Podiums", unit: "podiums" },
  { key: "mostFastestLaps", label: "Fastest Laps", unit: "FLs" },
  { key: "mostChampionships", label: "Titles", unit: "titles" },
  { key: "mostConstructorTitles", label: "Constructor Titles", unit: "titles" },
];

function Leaderboard({ rows, unit }: { rows: Leader[]; unit: string }) {
  const max = rows[0]?.n ?? 1;
  return (
    <Card className="divide-y divide-line overflow-hidden">
      {rows.map((r, i) => (
        <motion.div
          key={r.name}
          className="relative flex items-center gap-4 px-4 py-2.5"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.04, duration: 0.35 }}
        >
          <motion.div
            className="absolute inset-y-[3px] left-0 bg-red"
            style={{ opacity: 0.08 }}
            initial={{ width: 0 }}
            animate={{ width: `${(r.n / max) * 100}%` }}
            transition={{ delay: 0.1 + i * 0.04, duration: 0.6, ease: "circOut" }}
          />
          <span
            className={`display w-8 text-right text-2xl font-black italic ${
              i === 0 ? "text-red" : "text-ink/40"
            }`}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold uppercase">{r.name}</div>
            <div className="font-mono text-[10px] text-muted">
              {r.firstSeason}–{r.lastSeason}
            </div>
          </div>
          <span className="font-mono text-lg font-semibold tabular-nums">
            {r.n} <span className="text-[10px] font-normal text-muted">{unit}</span>
          </span>
        </motion.div>
      ))}
    </Card>
  );
}

function AgeList({ rows, title }: { rows: Winner[]; title: string }) {
  return (
    <div>
      <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
        {title}
      </h3>
      <Card className="divide-y divide-line overflow-hidden">
        {rows.map((w) => (
          <div
            key={`${w.driver_name}-${w.season}-${w.race_name}`}
            className="flex items-center gap-4 px-4 py-2.5"
          >
            <span className="display w-16 shrink-0 text-2xl font-black italic text-red">
              {w.age.toFixed(1)}
              <span className="text-sm">y</span>
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold uppercase">{w.driver_name}</div>
              <div className="font-mono text-[10px] text-muted">
                {w.race_name} · {w.season}
              </div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

export default function RecordsPage() {
  const { data, error, loading } = useApi<Records>("/api/records");
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);
  const rows = data ? (data[tab.key] as Leader[]) : null;

  return (
    <div className="space-y-10">
      <Section title="All-Time Records" subtitle="World Championship · 1950 – today">
        {error && <ErrorNote message={`${error} — records build via the weekly backfill job.`} />}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition-all ${
                tab.key === t.key
                  ? "pit-board text-white"
                  : "border border-line bg-card text-muted hover:text-ink"
              }`}
            >
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        {loading && <Skeleton className="h-96" />}
        {rows && <Leaderboard key={tab.key} rows={rows} unit={tab.unit} />}
        {data?.caveats[tab.key] && (
          <p className="mt-2 font-mono text-[11px] text-muted">* {data.caveats[tab.key]}</p>
        )}
      </Section>

      {data && (
        <Section title="Age Records">
          <div className="grid gap-5 lg:grid-cols-2">
            <AgeList rows={data.youngestWinners} title="Youngest race winners" />
            <AgeList rows={data.oldestWinners} title="Oldest race winners" />
          </div>
        </Section>
      )}

      {data && data.unavailable.length > 0 && (
        <p className="font-mono text-[11px] text-muted">
          Not tracked here: {data.unavailable.join(" · ")}
        </p>
      )}
    </div>
  );
}
