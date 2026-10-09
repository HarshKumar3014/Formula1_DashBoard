"use client";
import { useEffect, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

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

/** Current Supabase session; `ready` flips once the stored session has been read. */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);

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

  return {
    configured: !!supabase,
    ready,
    session,
    token: session?.access_token ?? null,
    signIn: (provider: Provider) =>
      supabase?.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.href.split("#")[0].split("?")[0] },
      }),
    signOut: () => supabase?.auth.signOut(),
  };
}

export function authHeaders(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
