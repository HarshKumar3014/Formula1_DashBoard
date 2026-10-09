"use client";
import { useApi } from "@/lib/api";
import { getTrack } from "@/components/TrackPath";
import { Skeleton } from "@/components/Section";

export type Team = { id: string; name: string; color: string };
export type Driver = { code: string; name: string; team: string; teamColor: string };
export type Track = { id: string; name: string; locality: string; country: string };
export type ProfileOptions = {
  teams: Team[];
  drivers: Driver[];
  tracks: Track[];
  limits: { favDrivers: number; favTeams: number };
};

export type Prefs = {
  newsTeams: string[];
  favDrivers: string[];
  favTeams: string[];
  favTrack: string | null;
};

export const EMPTY_PREFS: Prefs = { newsTeams: [], favDrivers: [], favTeams: [], favTrack: null };

export function useProfileOptions() {
  return useApi<ProfileOptions>("/api/profile/options");
}

/** Tap-to-toggle with a cap; tapping past the cap drops the oldest pick. */
function toggle(list: string[], id: string, max: number): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  const next = [...list, id];
  return next.length > max ? next.slice(next.length - max) : next;
}

function Heading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="display text-xl font-black uppercase">{title}</h3>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted">{hint}</span>
    </div>
  );
}

function Chip({
  on,
  color,
  onClick,
  children,
}: {
  on: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-center gap-2 border px-3 py-1.5 text-left text-sm font-bold transition-all ${
        on ? "border-ink bg-ink text-white shadow-[3px_3px_0_var(--red)]" : "border-line bg-card hover:border-ink"
      }`}
    >
      {color && <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

export function NewsPicker({
  options,
  value,
  onChange,
}: {
  options: ProfileOptions;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <section>
      <Heading title="Your news feed" hint="pick teams for their own columns — or keep it general" />
      <div className="flex flex-wrap gap-1.5">
        <Chip on={value.length === 0} onClick={() => onChange([])}>
          📰 General news only
        </Chip>
        {options.teams.map((t) => (
          <Chip
            key={t.id}
            on={value.includes(t.id)}
            color={t.color}
            onClick={() => onChange(toggle(value, t.id, options.teams.length))}
          >
            {t.name}
          </Chip>
        ))}
      </div>
    </section>
  );
}

export function FavouritesPicker({
  options,
  value,
  onChange,
}: {
  options: ProfileOptions;
  value: Prefs;
  onChange: (v: Prefs) => void;
}) {
  const { limits } = options;
  return (
    <div className="space-y-6">
      <section>
        <Heading title="Favourite drivers" hint={`up to ${limits.favDrivers}`} />
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {options.drivers.map((d) => {
            const at = value.favDrivers.indexOf(d.code);
            return (
              <Chip
                key={d.code}
                on={at !== -1}
                color={d.teamColor}
                onClick={() =>
                  onChange({ ...value, favDrivers: toggle(value.favDrivers, d.code, limits.favDrivers) })
                }
              >
                <span className="font-mono">{d.code}</span>
                <span className={`truncate text-xs font-medium ${at !== -1 ? "text-white/70" : "text-muted"}`}>
                  {d.name.split(" ").slice(1).join(" ") || d.name}
                </span>
              </Chip>
            );
          })}
        </div>
      </section>

      <section>
        <Heading title="Favourite teams" hint={`up to ${limits.favTeams}`} />
        <div className="flex flex-wrap gap-1.5">
          {options.teams.map((t) => (
            <Chip
              key={t.id}
              on={value.favTeams.includes(t.id)}
              color={t.color}
              onClick={() => onChange({ ...value, favTeams: toggle(value.favTeams, t.id, limits.favTeams) })}
            >
              {t.name}
            </Chip>
          ))}
        </div>
      </section>

      <section>
        <Heading title="Favourite track" hint="pick one" />
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
          {options.tracks.map((t) => {
            const on = value.favTrack === t.id;
            const path = getTrack(t.id);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...value, favTrack: on ? null : t.id })}
                className={`flex flex-col items-center gap-1 border p-2 transition-all ${
                  on ? "border-ink bg-ink text-white shadow-[3px_3px_0_var(--red)]" : "border-line bg-card hover:border-ink"
                }`}
              >
                {path ? (
                  <svg viewBox={`0 0 ${path.w} ${path.h}`} className="h-12 w-full" aria-hidden>
                    <path
                      d={path.d}
                      fill="none"
                      stroke={on ? "var(--red)" : "currentColor"}
                      strokeWidth={Math.max(path.w, path.h) / 40}
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span className="h-12" />
                )}
                <span className="w-full truncate text-center text-[11px] font-bold uppercase">
                  {t.locality}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function OptionsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}
