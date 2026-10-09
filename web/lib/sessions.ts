/** Session codes used by the API (results, predictions, replay). */
export type SessionCode = "FP1" | "FP2" | "FP3" | "SQ" | "S" | "Q" | "R";

export const SESSION_SHORT: Record<SessionCode, string> = {
  FP1: "FP1",
  FP2: "FP2",
  FP3: "FP3",
  SQ: "Sprint Quali",
  S: "Sprint",
  Q: "Quali",
  R: "Race",
};

export type SeasonSession = {
  code: SessionCode;
  name: string;
  dateUtc: string;
  complete: boolean;
};

export type SeasonEvent = {
  round: number;
  name: string;
  country: string;
  location: string;
  format: string;
  dateUtc: string;
  sessions: SeasonSession[];
  podium: { code: string; name: string; teamColor: string }[] | null;
};

export type Season = { season: number; events: SeasonEvent[] };

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function sessionTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ScheduleSession = { name: string; dateUtc: string };
type ScheduleEvent = {
  round: number;
  name: string;
  country: string;
  location: string;
  sessions: ScheduleSession[];
};
export type Schedule = { season: number; events: ScheduleEvent[] };
export type SessionRef = {
  event: string;
  round: number;
  session: string;
  dateUtc: string;
  country: string;
  location: string;
};

/** Next upcoming session, plus one that is probably running now (started < 3h ago). */
export function nextSession(schedule: Schedule, now = Date.now()) {
  let next: SessionRef | null = null;
  let live: SessionRef | null = null;
  for (const ev of schedule.events) {
    for (const s of ev.sessions) {
      const start = new Date(s.dateUtc).getTime();
      const ref = {
        event: ev.name,
        round: ev.round,
        session: s.name,
        dateUtc: s.dateUtc,
        country: ev.country,
        location: ev.location,
      };
      if (start <= now && now - start < 3 * 3600_000) live = ref;
      if (start > now && !next) next = ref;
    }
    if (next) break;
  }
  return { next, live };
}
