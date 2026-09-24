"use client";
import { useMemo } from "react";

export type Track = { x: number[]; y: number[]; speed?: number[]; distance?: number[] };

/** Map a 0-1 value onto a slow→fast color ramp (blue → red → white-hot). */
function speedColor(t: number): string {
  const stops: [number, number, number][] = [
    [37, 99, 235], // blue (slow)
    [232, 0, 45], // red
    [255, 200, 60], // yellow (fast)
  ];
  const f = Math.min(0.999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(f);
  const k = f - i;
  const [r1, g1, b1] = stops[i];
  const [r2, g2, b2] = stops[i + 1];
  return `rgb(${Math.round(r1 + (r2 - r1) * k)},${Math.round(g1 + (g2 - g1) * k)},${Math.round(
    b1 + (b2 - b1) * k,
  )})`;
}

export function useTrackTransform(track: Track | null | undefined, size = 420, pad = 24) {
  return useMemo(() => {
    if (!track || !track.x.length) return null;
    const minX = Math.min(...track.x);
    const maxX = Math.max(...track.x);
    const minY = Math.min(...track.y);
    const maxY = Math.max(...track.y);
    const scale = (size - 2 * pad) / Math.max(maxX - minX, maxY - minY);
    // center the shorter axis
    const w = (maxX - minX) * scale;
    const h = (maxY - minY) * scale;
    const ox = pad + (size - 2 * pad - w) / 2;
    const oy = pad + (size - 2 * pad - h) / 2;
    const tx = (x: number) => ox + (x - minX) * scale;
    // SVG y grows downward — flip
    const ty = (y: number) => size - (oy + (y - minY) * scale);
    return { tx, ty, size };
  }, [track, size, pad]);
}

/** Static track outline, optionally colored by speed. */
export default function TrackMap({
  track,
  size = 420,
  markerDistance = null,
  children,
}: {
  track: Track | null | undefined;
  size?: number;
  /** chart-hover position (lap distance in m) shown as a marker on the track */
  markerDistance?: number | null;
  children?: (t: NonNullable<ReturnType<typeof useTrackTransform>>) => React.ReactNode;
}) {
  const tf = useTrackTransform(track, size);
  if (!track || !tf) return null;

  let marker: { x: number; y: number } | null = null;
  if (markerDistance != null && track.distance?.length) {
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < track.distance.length; i++) {
      const diff = Math.abs(track.distance[i] - markerDistance);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    marker = { x: track.x[best], y: track.y[best] };
  }

  const maxSpeed = track.speed ? Math.max(...track.speed) : 0;
  const minSpeed = track.speed ? Math.min(...track.speed) : 0;

  const segments = [];
  for (let i = 0; i < track.x.length - 1; i++) {
    const color = track.speed
      ? speedColor((track.speed[i] - minSpeed) / Math.max(1, maxSpeed - minSpeed))
      : "#c9c0af";
    segments.push(
      <line
        key={i}
        x1={tf.tx(track.x[i])}
        y1={tf.ty(track.y[i])}
        x2={tf.tx(track.x[i + 1])}
        y2={tf.ty(track.y[i + 1])}
        stroke={color}
        strokeWidth={track.speed ? 4 : 6}
        strokeLinecap="round"
      />,
    );
  }

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full">
      {/* base outline underlay for contrast */}
      <polyline
        points={track.x.map((x, i) => `${tf.tx(x)},${tf.ty(track.y[i])}`).join(" ")}
        fill="none"
        stroke="#191511"
        strokeWidth={track.speed ? 7 : 9}
        strokeLinejoin="round"
        opacity={0.55}
      />
      {segments}
      {marker && (
        <g>
          <circle
            cx={tf.tx(marker.x)}
            cy={tf.ty(marker.y)}
            r={11}
            fill="none"
            stroke="#191511"
            strokeWidth={2}
            opacity={0.5}
          />
          <circle cx={tf.tx(marker.x)} cy={tf.ty(marker.y)} r={6} fill="#191511" stroke="#fffdf8" strokeWidth={2} />
        </g>
      )}
      {children?.(tf)}
    </svg>
  );
}

export function SpeedLegend() {
  return (
    <div className="flex items-center gap-2 text-[10px] text-muted">
      <span>slow</span>
      <div
        className="h-1.5 w-24 rounded-full"
        style={{
          background: "linear-gradient(90deg, rgb(59,130,246), rgb(232,0,45), rgb(255,200,60))",
        }}
      />
      <span>fast</span>
    </div>
  );
}
