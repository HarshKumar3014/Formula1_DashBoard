"use client";
import { motion } from "motion/react";
import trackPaths from "@/lib/trackPaths.json";

/** Jolpica circuitId → julesr0y/f1-circuits-svg id */
const ID_MAP: Record<string, string> = {
  albert_park: "melbourne",
  americas: "austin",
  red_bull_ring: "spielberg",
  rodriguez: "mexico-city",
  spa: "spa-francorchamps",
  vegas: "las-vegas",
  villeneuve: "montreal",
  marina_bay: "marina-bay",
  yas_marina: "yas-marina",
  losail: "lusail",
};

type TrackEntry = { d: string; w: number; h: number };
const PATHS = trackPaths as Record<string, TrackEntry>;

export function getTrack(circuitId: string): TrackEntry | null {
  return PATHS[ID_MAP[circuitId] ?? circuitId] ?? null;
}

/** Circuit outline that draws itself in when scrolled into view. */
export default function TrackPath({
  circuitId,
  className = "",
  stroke = "var(--ink)",
  strokeWidth = 7,
  draw = true,
  delay = 0,
}: {
  circuitId: string;
  className?: string;
  stroke?: string;
  strokeWidth?: number;
  draw?: boolean;
  delay?: number;
}) {
  const track = getTrack(circuitId);
  if (!track) return null;
  return (
    <svg viewBox={`0 0 ${track.w} ${track.h}`} className={className} aria-hidden>
      {/* ghost of the full track while drawing */}
      <path
        d={track.d}
        fill="none"
        stroke={stroke}
        strokeOpacity={0.12}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <motion.path
        d={track.d}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={draw ? { pathLength: 0 } : false}
        whileInView={draw ? { pathLength: 1 } : undefined}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 1.8, delay, ease: [0.3, 0, 0.2, 1] }}
      />
    </svg>
  );
}
