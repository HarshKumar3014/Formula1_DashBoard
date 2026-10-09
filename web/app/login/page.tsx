"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { apiFetch } from "@/lib/api";
import { authHeaders, useAuth, type Player, type Provider } from "@/lib/auth";
import TrackPath from "@/components/TrackPath";
import Avatar from "@/components/Avatar";
import {
  EMPTY_PREFS,
  FavouritesPicker,
  NewsPicker,
  OptionsSkeleton,
  useProfileOptions,
  type Prefs,
} from "@/components/PrefsEditor";

const PROVIDERS: { id: Provider; label: string; icon: React.ReactNode }[] = [
  {
    id: "google",
    label: "Google",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z" />
      </svg>
    ),
  },
  {
    id: "github",
    label: "GitHub",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
        <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z" />
      </svg>
    ),
  },
];

const STEPS = ["Racing name", "News feed", "Favourites"];

/* ------------------------------------------------------------ poster side */

function Poster() {
  return (
    <div className="relative flex min-h-[280px] flex-col justify-between overflow-hidden bg-ink p-8 text-white lg:min-h-[620px]">
      {/* .speed-lines sets the background shorthand, so it lives on its own layer */}
      <div className="speed-lines pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute -bottom-10 -right-16 w-[420px] opacity-40">
        <TrackPath circuitId="monaco" stroke="var(--red)" strokeWidth={9} />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-white/60">F1 Dashboard · 2026</p>
      <div className="relative">
        <h1 className="display text-6xl font-black uppercase leading-[0.9] sm:text-7xl">
          Pit
          <br />
          <span className="text-red">Wall</span>
        </h1>
        <ul className="mt-6 space-y-1.5 text-sm text-white/80">
          <li>🏁 Every result, every session</li>
          <li>🎯 Predict the top 10 · climb the ladder</li>
          <li>📰 News for the teams you follow</li>
          <li>📺 Replay any session on the track map</li>
        </ul>
      </div>
      <div className="checkers -mx-8 -mb-8 mt-8" />
    </div>
  );
}

/* ------------------------------------------------------------- onboarding */

function Onboarding({ next }: { next: string }) {
  const auth = useAuth();
  const router = useRouter();
  const { data: options } = useProfileOptions();
  const meta = auth.session?.user.user_metadata ?? {};
  const [step, setStep] = useState(auth.player ? 1 : 0);
  const [name, setName] = useState(
    String(meta.user_name ?? meta.preferred_username ?? meta.name ?? "")
      .replace(/[^A-Za-z0-9 _.-]/g, "")
      .slice(0, 20),
  );
  const [prefs, setPrefs] = useState<Prefs>(EMPTY_PREFS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const claimName = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const p = await apiFetch<Player>("/api/predict/join", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(auth.token) },
        body: JSON.stringify({ name }),
      });
      auth.setPlayer(p);
      setStep(1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/profile/me", {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders(auth.token) },
        body: JSON.stringify(prefs),
      });
      await auth.refreshProfile();
      router.replace(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* stepper */}
      <ol className="flex gap-1">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={`h-1.5 ${i <= step ? "bg-red" : "bg-line"}`} />
            <span
              className={`mt-1 block font-mono text-[10px] uppercase tracking-wider ${
                i === step ? "text-ink" : "text-muted"
              }`}
            >
              {i + 1}. {s}
            </span>
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22 }}
        >
          {step === 0 && (
            <form onSubmit={claimName} className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar name={name || "?"} url={meta.avatar_url ?? meta.picture} size={48} />
                <div>
                  <h2 className="display text-3xl font-black uppercase">Pick your racing name</h2>
                  <p className="text-sm text-muted">
                    It&apos;s what everyone sees on the leaderboard. You only choose it once.
                  </p>
                </div>
              </div>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                placeholder="e.g. BoxBoxBox"
                className="display w-full border-2 border-ink bg-card px-4 py-3 text-3xl font-black uppercase outline-none focus:border-red"
              />
              <p className="font-mono text-[11px] text-muted">
                3–20 characters · letters, numbers, space, _ . -
              </p>
              {err && <p className="text-sm font-semibold text-red">{err}</p>}
              <button
                disabled={busy || name.trim().length < 3}
                className="w-full bg-red py-3 text-sm font-bold uppercase tracking-wide text-white transition-transform enabled:hover:scale-[1.02] disabled:opacity-40"
              >
                {busy ? "Claiming…" : "Claim name →"}
              </button>
            </form>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="display text-3xl font-black uppercase">What news do you want?</h2>
                <p className="text-sm text-muted">
                  Every team you pick gets its own column on your home page. Change it any time in
                  your profile.
                </p>
              </div>
              {options ? (
                <NewsPicker
                  options={options}
                  value={prefs.newsTeams}
                  onChange={(newsTeams) => setPrefs({ ...prefs, newsTeams })}
                />
              ) : (
                <OptionsSkeleton />
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 bg-red py-3 text-sm font-bold uppercase tracking-wide text-white transition-transform hover:scale-[1.02]"
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="display text-3xl font-black uppercase">Your favourites</h2>
                <p className="text-sm text-muted">They show up on your profile. All optional.</p>
              </div>
              {options ? (
                <FavouritesPicker options={options} value={prefs} onChange={setPrefs} />
              ) : (
                <OptionsSkeleton />
              )}
              {err && <p className="text-sm font-semibold text-red">{err}</p>}
              <div className="sticky bottom-0 flex gap-2 bg-paper/95 py-3 backdrop-blur">
                <button
                  onClick={() => setStep(1)}
                  className="border border-line bg-card px-4 text-sm font-bold uppercase text-muted hover:text-ink"
                >
                  ← Back
                </button>
                <button
                  onClick={finish}
                  disabled={busy}
                  className="flex-1 bg-red py-3 text-sm font-bold uppercase tracking-wide text-white transition-transform enabled:hover:scale-[1.02] disabled:opacity-40"
                >
                  {busy ? "Saving…" : "Lights out — let's go 🏁"}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

function LoginInner() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("next") ?? "/";
  // only ever bounce to our own pages
  const next = raw.startsWith("/") && !raw.startsWith("//") && raw !== "/login" ? raw : "/";
  // a player who already existed when this page loaded goes straight through
  const [arrivedWithPlayer, setArrivedWithPlayer] = useState<boolean | null>(null);

  if (arrivedWithPlayer === null && auth.player !== undefined && auth.ready) {
    setArrivedWithPlayer(!!auth.player);
  }

  useEffect(() => {
    if (arrivedWithPlayer) router.replace(next);
  }, [arrivedWithPlayer, next, router]);

  const loading = !auth.ready || (auth.session && auth.player === undefined) || arrivedWithPlayer;

  return (
    <div className="mx-auto grid max-w-6xl overflow-hidden border-2 border-ink bg-paper shadow-[8px_8px_0_var(--red)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Poster />
      <div className="max-h-none p-6 sm:p-10">
        {!auth.configured ? (
          <p className="border-l-4 border-red bg-card px-4 py-3 text-sm">
            Sign-in isn&apos;t configured — set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>.
          </p>
        ) : loading ? (
          <div className="flex h-full min-h-60 items-center justify-center">
            <span className="display animate-pulse text-2xl font-black uppercase text-red">Pit Wall</span>
          </div>
        ) : !auth.session ? (
          <div className="flex h-full flex-col justify-center gap-6">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">Welcome</p>
              <h2 className="display text-4xl font-black uppercase sm:text-5xl">Get on the grid</h2>
              <p className="mt-2 max-w-md text-sm text-muted">
                Sign in to see results, replays and news tuned to your teams — and to play the
                prediction game against everyone else.
              </p>
            </div>
            <div className="grid max-w-sm gap-2.5">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => auth.signIn(p.id, next)}
                  className="flex items-center justify-center gap-3 border-2 border-ink bg-card py-3 text-sm font-bold transition-all hover:-translate-y-0.5 hover:bg-ink hover:text-white hover:shadow-[4px_4px_0_var(--red)]"
                >
                  {p.icon}
                  Continue with {p.label}
                </button>
              ))}
            </div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              We only read your name, email and avatar.
            </p>
          </div>
        ) : (
          <Onboarding next={next} />
        )}
        {auth.session && !loading && (
          <button
            onClick={auth.signOut}
            className="mt-6 text-[11px] font-bold uppercase tracking-wide text-muted hover:text-red"
          >
            Not you? Sign out
          </button>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
