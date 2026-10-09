"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useAuth } from "@/lib/auth";
import Avatar from "@/components/Avatar";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/results", label: "Results" },
  { href: "/predict", label: "Predict" },
  { href: "/replay", label: "Replay" },
  { href: "/telemetry", label: "Telemetry" },
  { href: "/circuits", label: "Circuits" },
  { href: "/records", label: "Records" },
];

export default function Nav() {
  const pathname = usePathname();
  const { player, profile } = useAuth();
  if (pathname === "/login") return null;

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
                className={`relative shrink-0 px-3 py-2 text-sm font-bold uppercase tracking-wide transition-colors ${
                  active ? "text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {l.label}
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
        {player && (
          <Link
            href="/profile"
            title="Your profile"
            className={`ml-2 flex shrink-0 items-center gap-2 border-2 px-1 py-1 transition-colors sm:pr-3 ${
              pathname === "/profile" ? "border-red" : "border-ink hover:border-red"
            }`}
          >
            <Avatar name={player.name} url={profile?.avatarUrl} size={26} />
            <span className="hidden font-mono text-xs font-bold uppercase sm:block">{player.name}</span>
          </Link>
        )}
      </nav>
    </header>
  );
}
