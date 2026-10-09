"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

/**
 * Sends signed-out users (and signed-in users without a racing name yet) to /login.
 * With no Supabase config the app stays open, so local dev without auth still works.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === "/login";
  const needsLogin =
    auth.configured && auth.ready && !onLogin && (!auth.session || auth.player === null);

  useEffect(() => {
    if (needsLogin) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [needsLogin, pathname, router]);

  if (!auth.configured || onLogin) return children;
  if (!auth.ready || needsLogin || auth.player === undefined)
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="display animate-pulse text-3xl font-black uppercase text-red">Pit Wall</span>
      </div>
    );
  return children;
}
