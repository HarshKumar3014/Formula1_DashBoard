"use client";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/api";
import type { Profile } from "@/lib/auth";
import { ErrorNote, Skeleton } from "@/components/Section";
import ProfileView from "@/components/ProfileView";
import { useProfileOptions } from "@/components/PrefsEditor";

export default function PublicProfilePage() {
  const { name } = useParams<{ name: string }>();
  const { data: profile, error } = useApi<Profile>(`/api/profile/${encodeURIComponent(decodeURIComponent(name))}`);
  const { data: options } = useProfileOptions();

  if (error) return <ErrorNote message={error} />;
  if (!profile) return <Skeleton className="h-96" />;
  return <ProfileView profile={profile} options={options} />;
}
