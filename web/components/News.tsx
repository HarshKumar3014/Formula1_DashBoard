"use client";
import { motion } from "motion/react";
import { timeAgo } from "@/lib/api";
import { Card, Skeleton } from "./Section";

export type NewsItem = {
  title: string;
  link: string;
  source: string;
  published: number | null;
};

/** Editorial headline list — big index numerals, red hover slide. */
export function NewsList({
  items,
  accent = "#E10600",
  compact = false,
}: {
  items: NewsItem[] | undefined;
  accent?: string;
  compact?: boolean;
}) {
  if (!items) return <Skeleton className="h-64" />;
  if (!items.length)
    return <Card className="p-4 text-sm text-muted">No stories right now.</Card>;
  return (
    <Card className="divide-y divide-line overflow-hidden">
      {items.map((n, i) => (
        <motion.a
          key={n.link}
          href={n.link}
          target="_blank"
          rel="noreferrer"
          className="group flex gap-3 px-4 py-3"
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.05, duration: 0.35 }}
        >
          <span
            className="display w-8 shrink-0 text-right text-2xl font-black italic leading-none opacity-25 transition-opacity group-hover:opacity-100"
            style={{ color: accent }}
          >
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <div
              className={`font-bold leading-snug transition-colors group-hover:text-red ${
                compact ? "text-[13px]" : "text-[15px]"
              }`}
            >
              {n.title}
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
              {n.source}
              {n.published ? ` · ${timeAgo(n.published)}` : ""}
            </div>
          </div>
        </motion.a>
      ))}
    </Card>
  );
}

/** Broadcast-style scrolling headline ticker. */
export function NewsTicker({ items }: { items: NewsItem[] | undefined }) {
  if (!items?.length) return null;
  const doubled = [...items, ...items]; // seamless loop
  return (
    <div className="relative overflow-hidden border-y-2 border-ink bg-ink text-white">
      <div className="ticker-track items-center gap-0 py-1.5">
        {doubled.map((n, i) => (
          <a
            key={i}
            href={n.link}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-3 px-5 text-[13px] font-semibold hover:text-white/70"
          >
            <span className="h-1.5 w-1.5 rotate-45 bg-red" />
            {n.title}
          </a>
        ))}
      </div>
    </div>
  );
}
