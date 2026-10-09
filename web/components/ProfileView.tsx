"use client";
import { motion } from "motion/react";
import type { Profile } from "@/lib/auth";
import { badgesFor, tierFor } from "@/lib/tiers";
import Avatar from "@/components/Avatar";
import { Card } from "@/components/Section";
import TrackPath from "@/components/TrackPath";
import type { ProfileOptions } from "@/components/PrefsEditor";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
      {children}
    </h3>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="border border-dashed border-line px-3 py-4 text-sm text-muted">{children}</p>;
}

/** Driver card / team card / track card + prediction stats. Shared by /profile and /u/[name]. */
export default function ProfileView({
  profile,
  options,
  actions,
}: {
  profile: Profile;
  options: ProfileOptions | null;
  actions?: React.ReactNode;
}) {
  const s = profile.stats;
  const tier = tierFor(s.points);
  const progress = tier.next ? (s.points - tier.min) / (tier.next.min - tier.min) : 1;
  const drivers = Object.fromEntries((options?.drivers ?? []).map((d) => [d.code, d]));
  const teams = Object.fromEntries((options?.teams ?? []).map((t) => [t.id, t]));
  const track = options?.tracks.find((t) => t.id === profile.favTrack);
  const maxRound = Math.max(1, ...s.rounds.map((r) => r.points));

  return (
    <div className="space-y-6">
      {/* header */}
      <Card className="overflow-hidden">
        <div className="relative bg-ink px-5 py-6 text-white sm:px-8">
          <div className="speed-lines pointer-events-none absolute inset-0" />
          <div className="relative flex flex-wrap items-center gap-5">
            <Avatar name={profile.name} url={profile.avatarUrl} size={88} className="border-4 border-red" />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-red">{tier.name}</p>
              <h1 className="display truncate text-4xl font-black uppercase sm:text-5xl">{profile.name}</h1>
              <p className="mt-1 font-mono text-xs text-white/60">
                {s.rank ? `P${s.rank} of ${s.players} on the season ladder` : "Not on the ladder yet"}
              </p>
            </div>
            <div className="text-right">
              <div className="display text-5xl font-black italic leading-none">{s.points}</div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/60">season pts</div>
            </div>
            {actions && <div className="w-full sm:w-auto">{actions}</div>}
          </div>
          <div className="mt-5 h-1.5 bg-white/15">
            <motion.div
              className="h-full bg-red"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, progress * 100)}%` }}
              transition={{ duration: 0.9, ease: "circOut" }}
            />
          </div>
          <p className="mt-1 font-mono text-[10px] text-white/50">
            {tier.next ? `${tier.next.min - s.points} pts to ${tier.next.name}` : "Top of the ladder"}
          </p>
        </div>
        <div className="grid grid-cols-2 divide-line border-t border-line sm:grid-cols-5 sm:divide-x">
          {[
            ["Sessions", s.played],
            ["Exact calls", s.exact],
            ["Winners called", s.winners],
            ["Perfect podiums", s.podiums],
            ["Best session", s.best],
          ].map(([k, v]) => (
            <div key={k} className="px-4 py-3 text-center">
              <div className="font-mono text-2xl font-semibold tabular-nums">{v}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{k}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-3">
          {badgesFor(s).map((b) => (
            <span
              key={b.name}
              title={b.hint}
              className={`border px-2 py-0.5 text-[11px] font-bold ${
                b.on ? "border-ink bg-paper" : "border-dashed border-line text-muted opacity-50"
              }`}
            >
              {b.icon} {b.name}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* favourite drivers */}
        <div className="lg:col-span-2">
          <Label>Favourite drivers</Label>
          {profile.favDrivers.length === 0 ? (
            <Empty>No favourite drivers picked yet.</Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {profile.favDrivers.map((code, i) => {
                const d = drivers[code];
                return (
                  <motion.div
                    key={code}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08 }}
                  >
                    <Card className="overflow-hidden">
                      <div className="h-1.5" style={{ background: d?.teamColor ?? "var(--line)" }} />
                      <div className="p-4">
                        <div
                          className="display text-4xl font-black italic leading-none"
                          style={{ color: d?.teamColor }}
                        >
                          {code}
                        </div>
                        <div className="mt-2 text-sm font-bold uppercase leading-tight">{d?.name ?? code}</div>
                        <div className="font-mono text-[10px] uppercase text-muted">{d?.team}</div>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* favourite track */}
        <div>
          <Label>Favourite track</Label>
          {profile.favTrack ? (
            <Card className="p-4">
              <TrackPath circuitId={profile.favTrack} stroke="var(--red)" strokeWidth={8} className="mx-auto h-36" />
              <p className="display mt-3 text-center text-xl font-black uppercase">
                {track?.locality ?? profile.favTrack}
              </p>
              <p className="text-center text-xs text-muted">{track?.name}</p>
            </Card>
          ) : (
            <Empty>No favourite track yet.</Empty>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* favourite teams */}
        <div>
          <Label>Favourite teams</Label>
          {profile.favTeams.length === 0 ? (
            <Empty>No favourite teams yet.</Empty>
          ) : (
            <div className="space-y-2">
              {profile.favTeams.map((id) => (
                <Card key={id} className="flex items-center gap-3 px-4 py-3">
                  <span className="h-8 w-2" style={{ background: teams[id]?.color }} />
                  <span className="display text-2xl font-black uppercase">{teams[id]?.name ?? id}</span>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* season history */}
        <div className="lg:col-span-2">
          <Label>Prediction history</Label>
          {s.rounds.length === 0 ? (
            <Empty>No predictions yet this season.</Empty>
          ) : (
            <Card className="divide-y divide-line">
              {s.rounds.map((r) => (
                <div key={r.round} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-9 font-mono text-xs text-muted">R{r.round}</span>
                  <span className="w-40 truncate font-semibold sm:w-56">{r.event ?? `Round ${r.round}`}</span>
                  <span className="relative h-2 flex-1 bg-paper">
                    <motion.span
                      className="absolute inset-y-0 left-0 bg-red"
                      initial={{ width: 0 }}
                      animate={{ width: `${(r.points / maxRound) * 100}%` }}
                      transition={{ duration: 0.7 }}
                    />
                  </span>
                  <span className="w-16 text-right font-mono text-xs text-muted">
                    {r.sessions} sess.
                  </span>
                  <span className="w-12 text-right font-mono font-semibold tabular-nums">{r.points}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
