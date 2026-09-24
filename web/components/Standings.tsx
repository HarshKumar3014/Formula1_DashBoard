"use client";
import { motion, useMotionValue, useTransform, animate, useInView } from "motion/react";
import { useEffect, useRef } from "react";
import { Card, Skeleton } from "./Section";

export type DriverStanding = {
  position: number;
  points: number;
  wins: number;
  code: string | null;
  number?: number | string | null;
  name: string;
  team: string | null;
  teamColor: string;
};
export type ConstructorStanding = {
  position: number;
  points: number;
  wins: number;
  name: string;
  teamColor: string;
};

function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v));
  useEffect(() => {
    if (inView) {
      const controls = animate(mv, value, { duration: 1.1, ease: "circOut" });
      return controls.stop;
    }
  }, [inView, value, mv]);
  return (
    <motion.span ref={ref} className="font-mono text-base font-semibold tabular-nums">
      {rounded}
    </motion.span>
  );
}

function Row({
  pos,
  color,
  primary,
  secondary,
  points,
  max,
  index,
}: {
  pos: number;
  color: string;
  primary: string;
  secondary?: string | null;
  points: number;
  max: number;
  index: number;
}) {
  return (
    <motion.div
      className="relative flex items-center gap-3 px-4 py-2"
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.035, duration: 0.4, ease: "easeOut" }}
    >
      {/* points bar */}
      <motion.div
        className="absolute inset-y-[3px] left-0"
        style={{ background: color, opacity: 0.13 }}
        initial={{ width: 0 }}
        animate={{ width: `${(points / Math.max(max, 1)) * 100}%` }}
        transition={{ delay: 0.15 + index * 0.035, duration: 0.7, ease: "circOut" }}
      />
      <span className="display w-7 text-right text-lg font-black italic text-ink/70">{pos}</span>
      <span className="h-6 w-1.5" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold uppercase leading-tight">{primary}</div>
        {secondary && (
          <div className="truncate text-[11px] font-medium text-muted">{secondary}</div>
        )}
      </div>
      <CountUp value={points} />
    </motion.div>
  );
}

export function DriverStandingsCard({ drivers }: { drivers: DriverStanding[] | undefined }) {
  if (!drivers) return <Skeleton className="h-96" />;
  const max = drivers[0]?.points ?? 1;
  return (
    <Card className="divide-y divide-line overflow-hidden">
      {drivers.map((d, i) => (
        <Row
          key={d.name}
          index={i}
          pos={d.position}
          color={d.teamColor}
          primary={d.name}
          secondary={d.team}
          points={d.points}
          max={max}
        />
      ))}
    </Card>
  );
}

export function ConstructorStandingsCard({
  constructors,
}: {
  constructors: ConstructorStanding[] | undefined;
}) {
  if (!constructors) return <Skeleton className="h-96" />;
  const max = constructors[0]?.points ?? 1;
  return (
    <Card className="divide-y divide-line overflow-hidden">
      {constructors.map((c, i) => (
        <Row
          key={c.name}
          index={i}
          pos={c.position}
          color={c.teamColor}
          primary={c.name}
          secondary={c.wins ? `${c.wins} win${c.wins > 1 ? "s" : ""}` : undefined}
          points={c.points}
          max={max}
        />
      ))}
    </Card>
  );
}
