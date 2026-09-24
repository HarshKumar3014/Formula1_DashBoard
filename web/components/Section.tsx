"use client";
import { motion } from "motion/react";

/** Signature section header: a pit-board slab with a red index tab. */
export default function Section({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="pit-board">
          <span className="bg-red px-2.5 py-1.5" aria-hidden />
          <h2 className="display px-4 py-1.5 text-xl font-black uppercase tracking-wide sm:text-2xl">
            {title}
          </h2>
        </div>
        {subtitle && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
            {subtitle}
          </span>
        )}
      </div>
      {children}
    </motion.section>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`race-card ${className}`}>{children}</div>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="border-l-4 border-red bg-card px-4 py-3 text-sm">
      {message}
    </div>
  );
}
