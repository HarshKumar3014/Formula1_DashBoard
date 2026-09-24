"use client";
import { motion } from "motion/react";
import { useApi } from "@/lib/api";
import Section, { Card, Skeleton, ErrorNote } from "@/components/Section";
import TrackPath from "@/components/TrackPath";

type Stat = { driver_name: string; n?: number; lap_time?: string; season?: number };
type LastWinner = {
  season: number;
  race_name: string;
  race_date: string;
  driver_name: string;
  constructor_name: string;
};
type Circuit = {
  circuitId: string;
  name: string;
  locality: string;
  country: string;
  racesHeld: number;
  lastWinner: LastWinner | null;
  mostWins: Stat | null;
  mostPoles: Stat | null;
  fastestLap: Stat | null;
};
type CircuitStats = {
  season: number;
  circuits: Circuit[];
  caveats: { fastestLap: string; poles: string };
};

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-1.5">
      <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-muted">
        {label}
      </span>
      <span className="truncate text-right text-[13px] font-bold">
        {value}
        {sub && <span className="ml-1.5 font-mono text-[11px] font-normal text-muted">{sub}</span>}
      </span>
    </div>
  );
}

export default function CircuitsPage() {
  const { data, error, loading } = useApi<CircuitStats>("/api/circuits");

  return (
    <div className="space-y-8">
      <Section
        title={`Circuits ${data ? `· ${data.season}` : ""}`}
        subtitle={data ? `${data.circuits.length} rounds · stats since 1950` : undefined}
      >
        {error && (
          <ErrorNote message={`${error} — circuit stats build via the weekly backfill job.`} />
        )}
        {loading && (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-80" />
            ))}
          </div>
        )}
        {data && (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {data.circuits.map((c, i) => (
              <motion.div
                key={c.circuitId}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: (i % 3) * 0.07, duration: 0.45 }}
              >
                <Card className="group overflow-hidden">
                  {/* header */}
                  <div className="flex items-start justify-between border-b border-line px-4 pb-2 pt-3">
                    <div>
                      <span className="display text-3xl font-black italic leading-none text-red">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <h3 className="mt-1 text-[15px] font-bold uppercase leading-tight">
                        {c.name}
                      </h3>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
                        {c.locality}, {c.country}
                      </p>
                    </div>
                    <span className="font-mono text-[10px] text-muted">{c.racesHeld} GPs</span>
                  </div>

                  {/* the circuit itself — draws in on scroll */}
                  <div className="relative bg-paper/60 px-6 py-4 transition-colors group-hover:bg-paper">
                    <TrackPath
                      circuitId={c.circuitId}
                      className="mx-auto h-40 w-auto max-w-full transition-transform duration-300 group-hover:scale-[1.04]"
                      stroke="var(--ink)"
                      strokeWidth={8}
                      delay={0.15}
                    />
                  </div>

                  <div className="divide-y divide-line border-t border-line py-1">
                    <StatRow
                      label="Last winner"
                      value={c.lastWinner ? c.lastWinner.driver_name : "—"}
                      sub={
                        c.lastWinner
                          ? `${c.lastWinner.season} · ${c.lastWinner.constructor_name}`
                          : undefined
                      }
                    />
                    <StatRow
                      label="Fastest lap"
                      value={c.fastestLap?.lap_time ?? "—"}
                      sub={
                        c.fastestLap
                          ? `${c.fastestLap.driver_name} · ${c.fastestLap.season}`
                          : "no data"
                      }
                    />
                    <StatRow
                      label="Most wins"
                      value={c.mostWins ? c.mostWins.driver_name : "—"}
                      sub={c.mostWins ? `×${c.mostWins.n}` : undefined}
                    />
                    <StatRow
                      label="Most poles"
                      value={c.mostPoles ? c.mostPoles.driver_name : "—"}
                      sub={c.mostPoles ? `×${c.mostPoles.n}` : undefined}
                    />
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </Section>
      {data && (
        <p className="max-w-3xl font-mono text-[11px] leading-relaxed text-muted">
          * {data.caveats.fastestLap} {data.caveats.poles} Stats cover every world championship
          race held at each circuit since 1950.
        </p>
      )}
    </div>
  );
}
