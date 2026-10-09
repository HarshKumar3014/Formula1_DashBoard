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
