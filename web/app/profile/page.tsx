"use client";
import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { authHeaders, useAuth } from "@/lib/auth";
import Section, { Card, ErrorNote, Skeleton } from "@/components/Section";
import ProfileView from "@/components/ProfileView";
import {
  FavouritesPicker,
  NewsPicker,
  OptionsSkeleton,
  useProfileOptions,
  type Prefs,
} from "@/components/PrefsEditor";

export default function ProfilePage() {
  const auth = useAuth();
  const { profile } = auth;
  const { data: options } = useProfileOptions();
  const [draft, setDraft] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!auth.configured)
    return <ErrorNote message="Profiles need sign-in, which isn't configured on this server." />;
  if (!profile) return <Skeleton className="h-96" />;

  const startEdit = () =>
    setDraft({
      newsTeams: profile.newsTeams ?? [],
      favDrivers: profile.favDrivers,
      favTeams: profile.favTeams,
      favTrack: profile.favTrack,
    });

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/profile/me", {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders(auth.token) },
        body: JSON.stringify(draft),
      });
      await auth.refreshProfile();
      setDraft(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const newsNames = (profile.newsTeams ?? [])
    .map((id) => options?.teams.find((t) => t.id === id)?.name ?? id)
    .join(" · ");

  return (
    <div className="space-y-8">
      {draft ? (
        <Section title="Edit profile" subtitle="news feed + favourites">
          <div className="space-y-8">
            {options ? (
              <>
                <Card className="p-5">
                  <NewsPicker
                    options={options}
                    value={draft.newsTeams}
                    onChange={(newsTeams) => setDraft({ ...draft, newsTeams })}
                  />
                </Card>
                <Card className="p-5">
                  <FavouritesPicker options={options} value={draft} onChange={setDraft} />
                </Card>
              </>
            ) : (
              <OptionsSkeleton />
            )}
            {err && <ErrorNote message={err} />}
            <div className="sticky bottom-0 flex gap-2 bg-paper/95 py-3 backdrop-blur">
              <button
                onClick={() => setDraft(null)}
                className="border border-line bg-card px-5 text-sm font-bold uppercase text-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="flex-1 bg-red py-3 text-sm font-bold uppercase tracking-wide text-white disabled:opacity-40"
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </Section>
      ) : (
        <>
          <ProfileView
            profile={profile}
            options={options}
            actions={
              <div className="flex gap-2 sm:flex-col">
                <button
                  onClick={startEdit}
                  className="bg-red px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-red-deep"
                >
                  Edit profile
                </button>
                <button
                  onClick={auth.signOut}
                  className="border border-white/30 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white/70 hover:text-white"
                >
                  Sign out
                </button>
              </div>
            }
          />
          <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>
              <span className="mr-2 font-mono text-[11px] font-bold uppercase tracking-wider text-muted">
                News feed
              </span>
              {newsNames || "General news only"}
            </span>
            <span className="flex gap-3 text-xs font-bold uppercase">
              <Link href={`/u/${encodeURIComponent(profile.name)}`} className="text-muted hover:text-ink">
                View public profile ↗
              </Link>
              <span className="text-muted">{auth.session?.user.email}</span>
            </span>
          </Card>
        </>
      )}
    </div>
  );
}
