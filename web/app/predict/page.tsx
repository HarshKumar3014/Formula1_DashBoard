"use client";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { apiFetch } from "@/lib/api";
import { authHeaders, useAuth, type Provider } from "@/lib/auth";
import Section, { Card, Skeleton, ErrorNote } from "@/components/Section";
import { SESSION_SHORT, sessionTime, type SessionCode } from "@/lib/sessions";

/* ------------------------------------------------------------------ types */

type Driver = { code: string; name: string; team: string; teamColor: string };
type Pick = { code: string; predicted: number; actual: number | null; points: number };
type GameSession = {
  code: SessionCode;
  name: string;
  dateUtc: string;
  complete: boolean;
  locked: boolean;
  picks: string[] | null;
  score: number | null;
  detail: Pick[] | null;
  result: string[] | null;
};
type GameEvent = {
  season: number;
  round: number;
  rounds: number;
  name: string;
  country: string;
  location: string;
  sessions: GameSession[];
  drivers: Driver[];
  scoring: {
    exact: number;
    offByOne: number;
    inTop10: number;
    podiumBonus: number;
    perfectBonus: number;
    max: number;
  };
};
type BoardRow = {
  rank: number;
  name: string;
  points: number;
  played: number;
  pending: number;
  exact: number;
  winners: number;
  podiums: number;
  best: number;
  you: boolean;
};
type Board = { rows: BoardRow[] };
type Player = { id: number; name: string };

const PICKS = 10;

/* ---------------------------------------------------------------- rewards */

// Fake career ladder — season points unlock a title.
const TIERS = [
  { min: 0, name: "Rookie" },
  { min: 40, name: "Midfielder" },
  { min: 120, name: "Points Finisher" },
  { min: 250, name: "Podium Regular" },
  { min: 450, name: "Race Winner" },
  { min: 750, name: "World Champion" },
];

function tierFor(points: number) {
  let i = 0;
  while (i + 1 < TIERS.length && points >= TIERS[i + 1].min) i++;
  return { ...TIERS[i], next: TIERS[i + 1] ?? null };
}

function badgesFor(r: BoardRow) {
  return [
    { on: r.winners > 0, icon: "🎯", name: "Bullseye", hint: "Called a session winner" },
    { on: r.podiums > 0, icon: "🔮", name: "Oracle", hint: "Perfect podium (P1–P3 exact)" },
    { on: r.exact >= 25, icon: "🏹", name: "Sharpshooter", hint: "25 exact positions" },
    { on: r.played >= 10, icon: "📅", name: "Ever-present", hint: "10 sessions predicted" },
    { on: r.best >= 40, icon: "🔥", name: "Hot Lap", hint: "40+ points in one session" },
  ];
}

/* ---------------------------------------------------------------- helpers */

function untilLabel(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function status(s: GameSession) {
  if (s.score !== null) return { label: `${s.score} pts`, cls: "bg-ink text-white" };
  if (s.locked && !s.picks) return { label: "no pick", cls: "bg-paper text-muted" };
  if (s.locked && s.complete) return { label: "scoring…", cls: "bg-paper text-muted" };
  if (s.locked) return { label: "locked", cls: "bg-paper text-muted" };
  if (s.picks) return { label: "saved ✓", cls: "bg-emerald-700 text-white" };
  return { label: "open", cls: "bg-red text-white" };
}

/* ------------------------------------------------------------ player card */

const PROVIDERS: { id: Provider; label: string; icon: React.ReactNode }[] = [
  {
    id: "google",
    label: "Google",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
        <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z" />
      </svg>
    ),
  },
  {
    id: "github",
    label: "GitHub",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
        <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z" />
      </svg>
    ),
  },
];

function SignInCard({
  configured,
  onSignIn,
}: {
  configured: boolean;
  onSignIn: (p: Provider) => void;
}) {
  return (
    <Card className="p-4">
      <p className="display text-xl font-black uppercase">Join the grid</p>
      <p className="mt-1 text-xs text-muted">
        Sign in to save predictions and climb the leaderboard. Anyone can browse without an account.
      </p>
      {configured ? (
        <div className="mt-3 grid gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => onSignIn(p.id)}
              className="flex items-center justify-center gap-2.5 border border-ink bg-card py-2 text-sm font-bold transition-colors hover:bg-ink hover:text-white"
            >
              {p.icon}
              Continue with {p.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 border-l-4 border-red bg-paper px-3 py-2 text-xs">
          Sign-in isn&apos;t configured yet — set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>.
        </p>
      )}
    </Card>
  );
}

function NameCard({
  token,
  email,
  onJoined,
  onSignOut,
}: {
  token: string;
  email: string | undefined;
  onJoined: (p: Player) => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onJoined(
        await apiFetch<Player>("/api/predict/join", {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders(token) },
          body: JSON.stringify({ name }),
        }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <p className="display text-xl font-black uppercase">Pick your racing name</p>
      <p className="mt-1 text-xs text-muted">
        Shown on the leaderboard instead of {email ?? "your account"}. You choose it once.
      </p>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="e.g. BoxBoxBox"
          className="min-w-0 flex-1 border border-line bg-paper px-2.5 py-2 text-sm outline-none focus:border-ink"
        />
        <button
          disabled={busy || name.trim().length < 3}
          className="bg-red px-4 text-sm font-bold uppercase text-white disabled:opacity-40"
        >
          {busy ? "…" : "Go"}
        </button>
      </form>
      {err && <p className="mt-2 text-xs font-semibold text-red">{err}</p>}
      <button
        onClick={onSignOut}
        className="mt-3 text-[11px] font-bold uppercase tracking-wide text-muted hover:text-red"
      >
        Sign out
      </button>
    </Card>
  );
}

function PlayerCard({
  player,
  email,
  row,
  onSignOut,
}: {
  player: Player;
  email: string | undefined;
  row: BoardRow | null;
  onSignOut: () => void;
}) {
  const points = row?.points ?? 0;
  const tier = tierFor(points);
  const progress = tier.next ? (points - tier.min) / (tier.next.min - tier.min) : 1;

  return (
    <Card className="overflow-hidden">
      <div className="bg-ink px-4 py-3 text-white">
        <div className="flex items-baseline justify-between gap-2">
          <span className="display truncate text-2xl font-black uppercase">{player.name}</span>
          <span className="font-mono text-xs text-white/60">{row ? `P${row.rank}` : "unranked"}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-red">{tier.name}</span>
          <span className="font-mono text-lg font-semibold tabular-nums">{points} pts</span>
        </div>
        <div className="mt-2 h-1.5 bg-white/15">
          <motion.div
            className="h-full bg-red"
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, progress * 100)}%` }}
            transition={{ duration: 0.8, ease: "circOut" }}
          />
        </div>
        <p className="mt-1 font-mono text-[10px] text-white/50">
          {tier.next ? `${tier.next.min - points} pts to ${tier.next.name}` : "Top of the ladder"}
        </p>
      </div>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Sessions", row?.played ?? 0],
            ["Exact", row?.exact ?? 0],
            ["Best", row?.best ?? 0],
          ].map(([k, v]) => (
            <div key={k} className="border border-line py-1.5">
              <div className="font-mono text-lg font-semibold tabular-nums">{v}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{k}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {row &&
            badgesFor(row).map((b) => (
              <span
                key={b.name}
                title={b.hint}
                className={`border px-2 py-0.5 text-[11px] font-bold ${
                  b.on ? "border-ink bg-paper" : "border-dashed border-line text-line grayscale"
                }`}
              >
                {b.icon} {b.name}
              </span>
            ))}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3 text-xs">
          <span className="truncate text-muted">{email}</span>
          <button
            onClick={onSignOut}
            className="shrink-0 font-bold uppercase tracking-wide text-muted hover:text-red"
          >
            Sign out
          </button>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------- picker */

function DriverChip({ d, small }: { d: Driver; small?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className={`${small ? "h-4" : "h-5"} w-1 shrink-0 rounded-full`}
        style={{ background: d.teamColor }}
      />
      <span className="font-mono font-bold">{d.code}</span>
      {!small && <span className="truncate text-xs text-muted">{d.name.split(" ").at(-1)}</span>}
    </span>
  );
}

function Picker({
  event,
  session,
  token,
  onSaved,
  needJoin,
}: {
  event: GameEvent;
  session: GameSession;
  token: string | null; // null until signed in with a racing name
  onSaved: () => void;
  needJoin: () => void;
}) {
  const byCode = useMemo(
    () => Object.fromEntries(event.drivers.map((d) => [d.code, d])),
    [event.drivers],
  );
  const [slots, setSlots] = useState<(string | null)[]>(
    () => session.picks ?? Array(PICKS).fill(null),
  );
  const [active, setActive] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = JSON.stringify(slots) !== JSON.stringify(session.picks ?? Array(PICKS).fill(null));
  const filled = slots.filter(Boolean).length;
  const others = event.sessions.filter((s) => s.code !== session.code && s.picks);

  const place = (code: string) => {
    setMsg(null);
    setSlots((cur) => {
      const next = [...cur];
      const existing = next.indexOf(code);
      // no slot chosen + driver already placed → tap again to take them out
      if (active === null && existing !== -1) {
        next[existing] = null;
        return next;
      }
      const target = active ?? next.indexOf(null);
      if (target === -1) return cur;
      if (existing !== -1) next[existing] = next[target]; // swap into the old slot
      next[target] = code;
      return next;
    });
    setActive(null);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= PICKS) return;
    setSlots((cur) => {
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setMsg(null);
  };

  const save = async () => {
    if (!token) return needJoin();
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/api/predict/${event.round}/${session.code}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ picks: slots }),
      });
      setMsg({ ok: true, text: "Picks saved — you can change them until the session starts." });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      {/* slots */}
      <div className="space-y-1">
        {slots.map((code, i) => (
          <div
            key={i}
            onClick={() => setActive(active === i ? null : i)}
            className={`flex h-10 cursor-pointer items-center gap-2 border px-2 transition-colors ${
              active === i
                ? "border-red bg-red/5"
                : code
                  ? "border-line bg-card hover:border-ink"
                  : "border-dashed border-line hover:border-ink"
            }`}
          >
            <span
              className={`display w-8 shrink-0 text-center text-lg font-black ${
                i < 3 ? "bg-ink text-white" : "text-muted"
              }`}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              {code && byCode[code] ? (
                <DriverChip d={byCode[code]} />
              ) : (
                <span className="text-xs text-muted">
                  {active === i ? "pick a driver →" : "empty"}
                </span>
              )}
            </span>
            {code && (
              <span className="flex shrink-0 items-center text-muted">
                <button
                  aria-label="Move up"
                  onClick={(e) => {
                    e.stopPropagation();
                    move(i, -1);
                  }}
                  className="px-1 hover:text-ink"
                >
                  ▲
                </button>
                <button
                  aria-label="Move down"
                  onClick={(e) => {
                    e.stopPropagation();
                    move(i, 1);
                  }}
                  className="px-1 hover:text-ink"
                >
                  ▼
                </button>
                <button
                  aria-label="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSlots((cur) => cur.map((c, k) => (k === i ? null : c)));
                    setMsg(null);
                  }}
                  className="px-1 hover:text-red"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      {/* driver pool + actions */}
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Tap a driver to fill the next empty slot (tap again to remove), or tap a slot first to choose who goes there.
        </p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {event.drivers.map((d) => {
            const at = slots.indexOf(d.code);
            return (
              <button
                key={d.code}
                onClick={() => place(d.code)}
                className={`flex items-center justify-between border px-2 py-1.5 text-left text-sm transition-all ${
                  at !== -1
                    ? "border-line bg-paper opacity-45"
                    : "border-line bg-card hover:-translate-y-0.5 hover:border-ink"
                }`}
              >
                <DriverChip d={d} />
                {at !== -1 && <span className="font-mono text-[10px] text-muted">P{at + 1}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={save}
            disabled={busy || filled < PICKS || !dirty}
            className="bg-red px-5 py-2 text-sm font-bold uppercase text-white transition-transform enabled:hover:scale-105 disabled:opacity-40"
          >
            {busy ? "Saving…" : token ? "Save picks" : "Sign in to save"}
          </button>
          <span className="font-mono text-xs text-muted">
            {filled}/{PICKS}
            {dirty && filled === PICKS && " · unsaved"}
          </span>
          <span className="ml-auto flex flex-wrap gap-1.5">
            {others.map((s) => (
              <button
                key={s.code}
                onClick={() => {
                  setSlots(s.picks!);
                  setMsg(null);
                }}
                className="border border-line px-2 py-1 text-[11px] font-bold uppercase text-muted hover:text-ink"
              >
                Copy {SESSION_SHORT[s.code]}
              </button>
            ))}
            <button
              onClick={() => {
                setSlots(Array(PICKS).fill(null));
                setMsg(null);
              }}
              className="border border-line px-2 py-1 text-[11px] font-bold uppercase text-muted hover:text-red"
            >
              Clear
            </button>
          </span>
        </div>
        {msg && (
          <p className={`text-xs font-semibold ${msg.ok ? "text-emerald-700" : "text-red"}`}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- scored / locked */

function Scorecard({ event, session }: { event: GameEvent; session: GameSession }) {
  const byCode = Object.fromEntries(event.drivers.map((d) => [d.code, d]));
  const chip = (code: string | null | undefined) =>
    code ? (
      byCode[code] ? (
        <DriverChip d={byCode[code]} small />
      ) : (
        <span className="font-mono font-bold">{code}</span>
      )
    ) : (
      <span className="text-muted">—</span>
    );

  if (!session.picks) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">You didn&apos;t predict this session.</p>
        {session.result && (
          <ol className="grid grid-cols-2 gap-1 sm:grid-cols-5">
            {session.result.map((c, i) => (
              <li key={c} className="flex items-center gap-2 border border-line px-2 py-1 text-sm">
                <span className="font-mono text-xs text-muted">P{i + 1}</span>
                {chip(c)}
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  const detail = session.detail;
  const total = session.score;
  const base = detail?.reduce((a, d) => a + d.points, 0) ?? 0;
  return (
    <div className="space-y-3">
      {!detail && (
        <p className="text-sm text-muted">
          {session.complete
            ? "Session over — scoring as soon as the official classification is in."
            : "Locked in. Scores land after the session."}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-widest text-muted">
              <th className="px-2 py-1 text-left">Pos</th>
              <th className="px-2 py-1 text-left">Your pick</th>
              <th className="px-2 py-1 text-left">Actual</th>
              <th className="px-2 py-1 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {session.picks.map((code, i) => {
              const d = detail?.[i];
              const pts = d?.points;
              return (
                <tr key={code} className="border-t border-line">
                  <td className="px-2 py-1.5 font-mono text-muted">P{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <span className="flex items-center gap-2">
                      {chip(code)}
                      {d && (
                        <span className="font-mono text-[10px] text-muted">
                          {d.actual ? `→ P${d.actual}` : "→ out"}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">{chip(session.result?.[i])}</td>
                  <td className="px-2 py-1.5 text-right">
                    {pts !== undefined && (
                      <span
                        className={`inline-block min-w-7 px-1 text-center font-mono text-xs font-bold ${
                          pts === event.scoring.exact
                            ? "bg-emerald-700 text-white"
                            : pts === event.scoring.offByOne
                              ? "bg-amber-400 text-ink"
                              : pts > 0
                                ? "bg-paper text-ink"
                                : "text-line"
                        }`}
                      >
                        {pts > 0 ? `+${pts}` : "0"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total !== null && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t-2 border-ink pt-2">
          <span className="text-xs text-muted">
            {total > base ? `incl. ${total - base} bonus pts` : ""}
          </span>
          <span className="display text-3xl font-black italic">
            {total}
            <span className="text-base text-muted"> / {event.scoring.max}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ leaderboard */

function Leaderboard({
  token,
  round,
  refreshKey,
}: {
  token: string | null;
  round: number;
  refreshKey: number;
}) {
  const [scope, setScope] = useState<"season" | "round">("season");
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = scope === "round" ? `?round=${round}` : "";
    apiFetch<Board>(`/api/predict/leaderboard${q}`, { headers: authHeaders(token) })
      .then((b) => !cancelled && (setBoard(b), setErr(null)))
      .catch((e) => !cancelled && setErr(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [scope, round, token, refreshKey]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line bg-paper px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-widest text-muted">Leaderboard</span>
        <span className="flex gap-1">
          {(["season", "round"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`px-2 py-0.5 text-[10px] font-bold uppercase ${
                scope === s ? "bg-ink text-white" : "text-muted hover:text-ink"
              }`}
            >
              {s === "season" ? "Season" : `R${round}`}
            </button>
          ))}
        </span>
      </div>
      {err && <p className="p-3 text-xs text-red">{err}</p>}
      {!board && !err && <Skeleton className="m-3 h-32" />}
      {board && board.rows.length === 0 && (
        <p className="p-4 text-sm text-muted">No players yet — be the first on the grid.</p>
      )}
      <div className="max-h-[480px] divide-y divide-line overflow-y-auto">
        {board?.rows.map((r) => (
          <div
            key={r.name}
            className={`flex items-center gap-2 px-3 py-2 text-sm ${r.you ? "bg-red/5" : ""}`}
          >
            <span
              className={`display w-7 shrink-0 text-center text-lg font-black ${
                r.rank <= 3 ? "bg-ink text-white" : "text-muted"
              }`}
            >
              {r.rank}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {r.name}
                {r.you && <span className="ml-1.5 text-[10px] font-bold uppercase text-red">you</span>}
              </span>
              <span className="block text-[10px] uppercase tracking-wider text-muted">
                {tierFor(r.points).name} · {r.exact} exact
                {r.pending > 0 && ` · ${r.pending} pending`}
              </span>
            </span>
            <span className="font-mono font-semibold tabular-nums">{r.points}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ page */

export default function PredictPage() {
  const auth = useAuth();
  const { token } = auth;
  // player lookups are tagged with the token they were made for, so a sign-out or account
  // switch never shows the previous user's player
  const [known, setKnown] = useState<{ token: string; player: Player | null } | null>(null);
  const playerKnown = !!token && known?.token === token;
  const player = playerKnown ? known!.player : null;
  const gameToken = player ? token : null;
  const [round, setRound] = useState<number | null>(null);
  const [event, setEvent] = useState<GameEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<SessionCode | null>(null);
  const [myRow, setMyRow] = useState<BoardRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [joinNudge, setJoinNudge] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<{ player: Player | null }>("/api/predict/me", { headers: authHeaders(token) })
      .then((r) => !cancelled && setKnown({ token, player: r.player }))
      .catch(() => !cancelled && setKnown({ token, player: null }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!auth.ready) return;
    let cancelled = false;
    const q = round ? `?round=${round}` : "";
    Promise.all([
      apiFetch<GameEvent>(`/api/predict/event${q}`, { headers: authHeaders(gameToken) }),
      gameToken
        ? apiFetch<Board>("/api/predict/leaderboard", { headers: authHeaders(gameToken) })
        : null,
    ])
      .then(([ev, b]) => {
        if (cancelled) return;
        setEvent(ev);
        setError(null);
        setMyRow(b?.rows.find((r) => r.you) ?? null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [auth.ready, round, gameToken, refreshKey]);

  const session =
    event?.sessions.find((s) => s.code === code) ??
    event?.sessions.find((s) => !s.locked) ??
    event?.sessions.at(-1) ??
    null;

  const email = auth.session?.user.email;

  return (
    <div className="space-y-6">
      <Section title="Predict the Grid" subtitle="call the top 10 · every session · season-long ladder">
        {error && <ErrorNote message={error} />}
        {!event && !error && <Skeleton className="h-64" />}
        {event && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-4">
              {/* event header */}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
                    Round {event.round} · {event.location}, {event.country}
                  </p>
                  <h2 className="display text-3xl font-black uppercase sm:text-4xl">{event.name}</h2>
                </div>
                <div className="flex gap-1.5">
                  <button
                    disabled={event.round <= 1}
                    onClick={() => {
                      setRound(event.round - 1);
                      setCode(null);
                    }}
                    className="border border-line bg-card px-2.5 py-1 text-xs font-bold text-muted hover:text-ink disabled:opacity-30"
                  >
                    ‹ R{event.round - 1}
                  </button>
                  {round !== null && (
                    <button
                      onClick={() => {
                        setRound(null);
                        setCode(null);
                      }}
                      className="bg-ink px-2.5 py-1 text-xs font-bold uppercase text-white"
                    >
                      Next race
                    </button>
                  )}
                  <button
                    disabled={event.round >= event.rounds}
                    onClick={() => {
                      setRound(event.round + 1);
                      setCode(null);
                    }}
                    className="border border-line bg-card px-2.5 py-1 text-xs font-bold text-muted hover:text-ink disabled:opacity-30"
                  >
                    R{event.round + 1} ›
                  </button>
                </div>
              </div>

              {/* session tabs */}
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                {event.sessions.map((s) => {
                  const st = status(s);
                  const on = session?.code === s.code;
                  return (
                    <button
                      key={s.code}
                      onClick={() => setCode(s.code)}
                      className={`border px-3 py-2 text-left transition-all ${
                        on ? "border-ink bg-card shadow-[4px_4px_0_var(--red)]" : "border-line bg-card/60 hover:border-ink"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-1">
                        <span className="display text-lg font-black uppercase">{SESSION_SHORT[s.code]}</span>
                        <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase ${st.cls}`}>
                          {st.label}
                        </span>
                      </span>
                      <span className="block font-mono text-[10px] text-muted">
                        {s.locked ? sessionTime(s.dateUtc) : `locks in ${untilLabel(s.dateUtc, now)}`}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* active session */}
              {session && (
                  <motion.div
                    key={`${event.round}-${session.code}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Card className="p-4">
                      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="display text-2xl font-black uppercase">{session.name}</h3>
                        <span className="font-mono text-xs text-muted">{sessionTime(session.dateUtc)}</span>
                      </div>
                      {session.locked ? (
                        <Scorecard event={event} session={session} />
                      ) : (
                        <Picker
                          key={`${session.code}-${JSON.stringify(session.picks)}`}
                          event={event}
                          session={session}
                          token={gameToken}
                          onSaved={() => setRefreshKey((k) => k + 1)}
                          needJoin={() => setJoinNudge(true)}
                        />
                      )}
                    </Card>
                  </motion.div>
                )}

              {/* rules */}
              <Card className="p-4 text-sm">
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">How scoring works</p>
                <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  <li><b className="font-mono">+{event.scoring.exact}</b> exact position</li>
                  <li><b className="font-mono">+{event.scoring.offByOne}</b> one place off</li>
                  <li><b className="font-mono">+{event.scoring.inTop10}</b> in the top 10, wrong spot</li>
                  <li><b className="font-mono">+{event.scoring.podiumBonus}</b> bonus: perfect podium</li>
                  <li><b className="font-mono">+{event.scoring.perfectBonus}</b> bonus: all ten exact</li>
                  <li className="text-muted">Picks lock when the session goes green.</li>
                </ul>
                <p className="mt-2 text-xs text-muted">
                  Practice is ranked by fastest lap, qualifying by classification, sprint and race by
                  finishing order. Points are just for bragging rights.
                </p>
              </Card>
            </div>

            {/* sidebar */}
            <div className="space-y-4">
              <div className={joinNudge && !player ? "ring-2 ring-red ring-offset-2 ring-offset-paper" : ""}>
                {!auth.ready || (token && !playerKnown) ? (
                  <Skeleton className="h-40" />
                ) : !token ? (
                  <SignInCard configured={auth.configured} onSignIn={auth.signIn} />
                ) : player ? (
                  <PlayerCard player={player} email={email} row={myRow} onSignOut={auth.signOut} />
                ) : (
                  <NameCard
                    token={token}
                    email={email}
                    onJoined={(p) => {
                      setKnown({ token, player: p });
                      setJoinNudge(false);
                    }}
                    onSignOut={auth.signOut}
                  />
                )}
              </div>
                            <Leaderboard token={gameToken} round={event.round} refreshKey={refreshKey} />
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
