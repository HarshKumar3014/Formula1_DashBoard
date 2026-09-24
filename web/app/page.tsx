"use client";
import { motion } from "motion/react";
import { useApi } from "@/lib/api";
import Countdown from "@/components/Countdown";
import Section, { Card, Skeleton, ErrorNote } from "@/components/Section";
import {
  DriverStandingsCard,
  ConstructorStandingsCard,
  type DriverStanding,
  type ConstructorStanding,
} from "@/components/Standings";
import { NewsList, NewsTicker, type NewsItem } from "@/components/News";
import TrackPath from "@/components/TrackPath";

type Standings = {
  season: number;
  round: number;
  drivers: DriverStanding[];
  constructors: ConstructorStanding[];
};
type Grid = {
  season: number;
  teams: { team: string; teamColor: string; points: number; drivers: DriverStanding[] }[];
};
type News = { top: NewsItem[]; ferrari: NewsItem[]; mercedes: NewsItem[] };
type NextSession = {
  next: {
    event: string;
    session: string;
    dateUtc: string;
    location: string;
    country: string;
    round: number;
  } | null;
  live: { event: string; session: string } | null;
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// Jolpica circuit id for the next event's track outline in the hero
const EVENT_CIRCUIT: Record<string, string> = {
  "British Grand Prix": "silverstone",
  "Belgian Grand Prix": "spa",
  "Hungarian Grand Prix": "hungaroring",
  "Dutch Grand Prix": "zandvoort",
  "Italian Grand Prix": "monza",
  "Madrid Grand Prix": "madring",
  "Azerbaijan Grand Prix": "baku",
  "Singapore Grand Prix": "marina_bay",
  "United States Grand Prix": "americas",
  "Mexico City Grand Prix": "rodriguez",
  "São Paulo Grand Prix": "interlagos",
  "Las Vegas Grand Prix": "vegas",
  "Qatar Grand Prix": "losail",
  "Abu Dhabi Grand Prix": "yas_marina",
  "Australian Grand Prix": "albert_park",
  "Chinese Grand Prix": "shanghai",
  "Japanese Grand Prix": "suzuka",
  "Bahrain Grand Prix": "bahrain",
  "Saudi Arabian Grand Prix": "jeddah",
  "Miami Grand Prix": "miami",
  "Canadian Grand Prix": "villeneuve",
  "Monaco Grand Prix": "monaco",
  "Spanish Grand Prix": "catalunya",
  "Austrian Grand Prix": "red_bull_ring",
};

export default function Home() {
  const { data: standings, error: stErr } = useApi<Standings>("/api/standings", 30 * 60_000);
  const { data: grid } = useApi<Grid>("/api/drivers", 60 * 60_000);
  const { data: news, error: newsErr } = useApi<News>("/api/news", 15 * 60_000);
  const { data: next } = useApi<NextSession>("/api/schedule/next", 5 * 60_000);

  const heroCircuit = next?.next ? EVENT_CIRCUIT[next.next.event] : undefined;

  return (
    <div className="space-y-14">
      {/* ============================================================ hero */}
      <section className="relative -mx-4 -mt-8 sm:-mx-6">
        <div className="speed-lines relative overflow-hidden border-b-2 border-ink bg-card">
          {/* giant faded track outline behind the headline */}
          {heroCircuit && (
            <div className="pointer-events-none absolute -right-10 top-1/2 hidden w-[420px] -translate-y-1/2 opacity-[0.5] lg:block">
              <TrackPath circuitId={heroCircuit} stroke="var(--red)" strokeWidth={9} />
            </div>
          )}
          <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-8 px-4 pb-10 pt-12 sm:px-6">
            <div>
              <motion.p
                className="font-mono text-[11px] font-semibold uppercase tracking-[0.35em] text-muted"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
              >
                {greeting()}, Harsh
              </motion.p>
              <motion.h1
                className="display mt-1 text-5xl font-black uppercase leading-[0.95] sm:text-7xl"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
              >
                Welcome to
                <br />
                <span className="text-red">the Pit Wall</span>
              </motion.h1>
              <motion.div
                className="mt-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
              >
                {next?.live ? (
                  <p className="flex items-center gap-2 text-lg font-bold text-red">
                    <span className="live-dot h-3 w-3 rounded-full bg-red" />
                    {next.live.session} live now — {next.live.event}
                  </p>
                ) : next?.next ? (
                  <p className="text-sm font-medium text-ink-soft">
                    Next:{" "}
                    <span className="font-bold uppercase">{next.next.session}</span> · Round{" "}
                    {next.next.round} — {next.next.event}, {next.next.location}
                  </p>
                ) : (
                  <p className="text-sm text-muted">Season complete — see you next year.</p>
                )}
              </motion.div>
            </div>
            {next?.next && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.5 }}
              >
                <Countdown target={next.next.dateUtc} />
              </motion.div>
            )}
          </div>
          <div className="checkers" />
        </div>
        {/* broadcast ticker */}
        <NewsTicker items={news?.top} />
      </section>

      {/* ====================================================== standings */}
      <Section
        title="Championship"
        subtitle={standings ? `${standings.season} · after round ${standings.round}` : undefined}
      >
        {stErr && <ErrorNote message={`Standings unavailable: ${stErr}`} />}
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
              Drivers
            </h3>
            <DriverStandingsCard drivers={standings?.drivers} />
          </div>
          <div>
            <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
              Constructors
            </h3>
            <ConstructorStandingsCard constructors={standings?.constructors} />
          </div>
        </div>
      </Section>

      {/* =========================================================== grid */}
      <Section title="The Grid" subtitle={grid ? `${grid.season} season` : undefined}>
        {!grid ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {grid.teams.map((t, i) => (
              <motion.div
                key={t.team}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: (i % 3) * 0.08, duration: 0.45 }}
              >
                <Card className="overflow-hidden">
                  <div
                    className="flex items-center justify-between border-b-2 px-4 py-2"
                    style={{ borderColor: t.teamColor }}
                  >
                    <span className="display text-lg font-black uppercase italic tracking-wide">
                      {t.team}
                    </span>
                    <span className="font-mono text-xs font-semibold text-muted">
                      {t.points} pts
                    </span>
                  </div>
                  <div className="divide-y divide-line">
                    {t.drivers.map((d) => (
                      <div key={d.name} className="flex items-center gap-3 px-4 py-2.5">
                        <span
                          className="display w-10 text-center text-2xl font-black italic leading-none"
                          style={{ color: t.teamColor }}
                        >
                          {d.number ?? ""}
                        </span>
                        <div className="flex-1">
                          <div className="text-sm font-bold uppercase leading-tight">{d.name}</div>
                          <div className="font-mono text-[10px] uppercase text-muted">
                            P{d.position} · {d.points} pts{d.wins ? ` · ${d.wins} wins` : ""}
                          </div>
                        </div>
                        <span className="font-mono text-xs font-semibold text-muted">{d.code}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </Section>

      {/* ==================================================== top stories */}
      <Section title="Paddock News" subtitle="refreshes every 15 minutes">
        {newsErr && <ErrorNote message={`News unavailable: ${newsErr}`} />}
        <NewsList items={news?.top.slice(0, 5)} />
      </Section>

      {/* ===================================================== team news */}
      <Section title="Team Radio" subtitle="Ferrari · Mercedes focus">
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3
              className="mb-2 inline-block px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-white"
              style={{ background: "#E10600" }}
            >
              Scuderia Ferrari
            </h3>
            <NewsList items={news?.ferrari} accent="#E10600" compact />
          </div>
          <div>
            <h3
              className="mb-2 inline-block px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink"
              style={{ background: "#27F4D2" }}
            >
              Mercedes-AMG
            </h3>
            <NewsList items={news?.mercedes} accent="#0FA894" compact />
          </div>
        </div>
      </Section>
    </div>
  );
}
