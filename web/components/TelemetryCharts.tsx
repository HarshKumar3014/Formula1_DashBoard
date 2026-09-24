"use client";
import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

export type DriverTrace = {
  code: string;
  name: string;
  color: string;
  lapTime: string;
  compound?: string | null;
  distance: number[];
  time?: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  rpm: number[];
  drs: number[];
};

type ChannelKey = "speed" | "throttle" | "brake" | "gear" | "rpm" | "drs";

const CHANNELS: { key: ChannelKey; label: string; unit: string; height: number }[] = [
  { key: "speed", label: "Speed", unit: "km/h", height: 220 },
  { key: "throttle", label: "Throttle", unit: "%", height: 120 },
  { key: "brake", label: "Brake", unit: "", height: 90 },
  { key: "gear", label: "Gear", unit: "", height: 110 },
  { key: "rpm", label: "RPM", unit: "", height: 130 },
  { key: "drs", label: "DRS", unit: "", height: 80 },
];

/** Linear interpolation of ys over xs at x. */
function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const k = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + k * (ys[hi] - ys[lo]);
}

/** Merge per-driver traces onto a shared distance axis (nearest-sample join). */
function mergeTraces(drivers: DriverTrace[], key: ChannelKey) {
  if (!drivers.length) return [];
  const base = drivers[0];
  return base.distance.map((d, i) => {
    const row: Record<string, number> = { d: Math.round(d) };
    for (const drv of drivers) {
      const j = Math.min(
        drv.distance.length - 1,
        Math.round((i / base.distance.length) * drv.distance.length),
      );
      row[drv.code] = drv[key][j];
    }
    return row;
  });
}

/** Time delta vs the fastest driver, per distance point. Positive = losing time. */
function deltaData(drivers: DriverTrace[]) {
  const withTime = drivers.filter((d) => d.time?.length);
  if (withTime.length < 2) return null;
  const ref = withTime.reduce((a, b) =>
    (a.time![a.time!.length - 1] ?? 1e9) <= (b.time![b.time!.length - 1] ?? 1e9) ? a : b,
  );
  const rows = ref.distance.map((d, i) => {
    const row: Record<string, number> = { d: Math.round(d) };
    for (const drv of withTime) {
      if (drv.code === ref.code) {
        row[drv.code] = 0;
        continue;
      }
      row[drv.code] = +(interp(drv.distance, drv.time!, d) - ref.time![i]).toFixed(3);
    }
    return row;
  });
  return { rows, ref: ref.code };
}

const AXIS = { fill: "#86796a", fontSize: 10 };
const TOOLTIP_STYLE = {
  background: "#fffdf8",
  border: "1px solid #e3dbcd",
  borderRadius: 8,
  fontSize: 12,
};

function ChartFrame({
  label,
  unit,
  children,
}: {
  label: string;
  unit?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="race-card p-3">
      <div className="mb-1 flex items-baseline justify-between px-1">
        <span className="text-xs font-bold uppercase tracking-widest text-muted">{label}</span>
        {unit && <span className="text-[10px] text-muted">{unit}</span>}
      </div>
      {children}
    </div>
  );
}

export default function TelemetryCharts({
  drivers,
  onHoverDistance,
}: {
  drivers: DriverTrace[];
  onHoverDistance?: (d: number | null) => void;
}) {
  const delta = useMemo(() => deltaData(drivers), [drivers]);

  const hoverProps = {
    onMouseMove: (st: { activeLabel?: unknown }) => {
      const v = Number(st?.activeLabel);
      onHoverDistance?.(Number.isFinite(v) ? v : null);
    },
    onMouseLeave: () => onHoverDistance?.(null),
  };

  return (
    <div className="space-y-3">
      {delta && (
        <ChartFrame label={`Delta to ${delta.ref}`} unit="s — above 0 = losing time">
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={delta.rows} syncId="tel" margin={{ top: 4, right: 8, bottom: 0, left: -18 }} {...hoverProps}>
              <CartesianGrid stroke="#e3dbcd" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="d"
                type="number"
                domain={["dataMin", "dataMax"]}
                tick={AXIS}
                tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
                stroke="#e3dbcd"
              />
              <YAxis tick={AXIS} stroke="#e3dbcd" width={46} tickFormatter={(v) => (v > 0 ? `+${v}` : `${v}`)} />
              <ReferenceLine y={0} stroke="#191511" strokeWidth={1} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => `${v} m`}
                       formatter={(value) => [`${Number(value) >= 0 ? "+" : ""}${value}s`]} />
              {drivers
                .filter((d) => d.code !== delta.ref)
                .map((d) => (
                  <Line
                    key={d.code}
                    type="monotone"
                    dataKey={d.code}
                    stroke={d.color}
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      )}

      {CHANNELS.map((c) => (
        <ChartFrame key={c.key} label={c.label} unit={c.unit}>
          <ResponsiveContainer width="100%" height={c.height}>
            <LineChart
              data={mergeTraces(drivers, c.key)}
              syncId="tel"
              margin={{ top: 4, right: 8, bottom: 0, left: -18 }}
              {...hoverProps}
            >
              <CartesianGrid stroke="#e3dbcd" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="d"
                type="number"
                domain={["dataMin", "dataMax"]}
                tick={AXIS}
                tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
                stroke="#e3dbcd"
              />
              <YAxis tick={AXIS} stroke="#e3dbcd" width={46} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => `${v} m`} />
              {drivers.map((d) => (
                <Line
                  key={d.code}
                  type="monotone"
                  dataKey={d.code}
                  stroke={d.color}
                  dot={false}
                  strokeWidth={1.8}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      ))}
    </div>
  );
}
