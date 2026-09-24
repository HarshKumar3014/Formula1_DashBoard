"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

function parts(msLeft: number) {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

function Flip({ v, label }: { v: number; label: string }) {
  const str = String(v).padStart(2, "0");
  return (
    <div className="flex flex-col items-center">
      <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden border-2 border-ink bg-ink text-white sm:h-16 sm:w-16">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={str}
            className="display absolute text-3xl font-black sm:text-4xl"
            initial={{ y: "-100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {str}
          </motion.span>
        </AnimatePresence>
        {/* timing-board split line */}
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
      </div>
      <span className="mt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-muted">
        {label}
      </span>
    </div>
  );
}

export default function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { d, h, m, s } = parts(new Date(target).getTime() - now);
  return (
    <div className="flex gap-2">
      {d > 0 && <Flip v={d} label="days" />}
      <Flip v={h} label="hrs" />
      <Flip v={m} label="min" />
      <Flip v={s} label="sec" />
    </div>
  );
}
