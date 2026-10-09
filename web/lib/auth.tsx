"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import { apiFetch } from "@/lib/api";

// Publishable (anon) key — safe in the browser; the API verifies the resulting JWTs.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase =
  URL && KEY
    ? createClient(URL, KEY, {
        auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
      })
    : null;

export type Provider = "google" | "github";
export type Player = { id: number; name: string };

export type Stats = {
  rank: number | null;
  players: number;
  points: number;
  played: number;
  exact: number;
  winners: number;
  podiums: number;
  best: number;
  rounds: { round: number; event: string | null; sessions: number; points: number }[];
};

export type Profile = {
  name: string;
  avatarUrl: string | null;
  favDrivers: string[];
  favTeams: string[];
  favTrack: string | null;
  stats: Stats;
  newsTeams?: string[]; // only on your own profile
};

export function authHeaders(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type AuthState = {
  configured: boolean;
  /** stored session has been read */
  ready: boolean;
  session: Session | null;
  token: string | null;
  /** undefined = still looking up; null = signed in but no racing name yet */
  player: Player | null | undefined;
  profile: Profile | null;
  setPlayer: (p: Player) => void;
  refreshProfile: () => Promise<void>;
  signIn: (provider: Provider, next?: string) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);
  // lookups are tagged with the user they were made for, so a sign-out or account
  // switch never shows the previous user's data
  const [known, setKnown] = useState<{ user: string; player: Player | null } | null>(null);
  const [profile, setProfile] = useState<{ user: string; profile: Profile } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const token = session?.access_token ?? null;
  // supabase refreshes the access token hourly; key lookups on the user, not the token
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<{ player: Player | null }>("/api/predict/me", { headers: authHeaders(token) })
      .then((r) => !cancelled && setKnown({ user: userId!, player: r.player }))
      .catch(() => !cancelled && setKnown({ user: userId!, player: null }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch per user, not per token refresh
  }, [userId]);

  const player = !token ? null : known?.user === userId ? known.player : undefined;

  const refreshProfile = useCallback(async () => {
    if (!token || !userId) return;
    const p = await apiFetch<Profile>("/api/profile/me", { headers: authHeaders(token) });
    setProfile({ user: userId, profile: p });
  }, [token, userId]);

  const playerId = player?.id;
  useEffect(() => {
    if (!playerId || !token || !userId) return;
    let cancelled = false;
    apiFetch<Profile>("/api/profile/me", { headers: authHeaders(token) })
      .then((p) => !cancelled && setProfile({ user: userId, profile: p }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per player, not per token refresh
  }, [playerId]);

  const value: AuthState = {
    configured: !!supabase,
    ready,
    session,
    token,
    player,
    profile: player && profile?.user === userId ? profile.profile : null,
    setPlayer: (p) => userId && setKnown({ user: userId, player: p }),
    refreshProfile,
    signIn: (provider, next = "/") => {
      supabase?.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/login?next=${encodeURIComponent(next)}`,
        },
      });
    },
    signOut: () => {
      supabase?.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
