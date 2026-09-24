"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useApi } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/telemetry", label: "Telemetry" },
  { href: "/live", label: "Live" },
  { href: "/circuits", label: "Circuits" },
  { href: "/records", label: "Records" },
];

type LiveStatus = { mode: string; liveSession: { session: string; event: string } | null };

export default function Nav() {
  const pathname = usePathname();
  const { data: status } = useApi<LiveStatus>("/api/live/status", 60_000);
  const live = status?.liveSession;

  return (
    <header className="sticky top-0 z-30 border-b-2 border-ink bg-paper/90 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="mr-5 flex items-baseline gap-2">
          <span className="display text-2xl font-black uppercase text-red">Pit Wall</span>
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.25em] text-muted sm:block">
            F1 Dashboard
          </span>
        </Link>
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`relative px-3 py-2 text-sm font-bold uppercase tracking-wide transition-colors ${
                  active ? "text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {l.label}
                {l.href === "/live" && live && (
                  <span className="live-dot ml-1.5 inline-block h-2 w-2 rounded-full bg-red align-middle" />
                )}
                {active && (
                  <motion.span
                    layoutId="nav-underline"
                    className="absolute inset-x-2 bottom-0 h-[3px] bg-red"
                  />
                )}
              </Link>
            );
          })}
        </div>
        {live && (
          <Link
            href="/live"
            className="hidden items-center gap-2 bg-ink px-3 py-1.5 font-mono text-[11px] font-bold uppercase text-white md:flex"
          >
            <span className="live-dot h-2 w-2 rounded-full bg-red" />
            Live · {live.session}
          </Link>
        )}
      </nav>
    </header>
  );
}
