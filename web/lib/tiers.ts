/** Prediction-game rewards: a fake career ladder by season points, plus badges. */

export const TIERS = [
  { min: 0, name: "Rookie" },
  { min: 40, name: "Midfielder" },
  { min: 120, name: "Points Finisher" },
  { min: 250, name: "Podium Regular" },
  { min: 450, name: "Race Winner" },
  { min: 750, name: "World Champion" },
];

export function tierFor(points: number) {
  let i = 0;
  while (i + 1 < TIERS.length && points >= TIERS[i + 1].min) i++;
  return { ...TIERS[i], next: TIERS[i + 1] ?? null };
}

type BadgeStats = { winners: number; podiums: number; exact: number; played: number; best: number };

export function badgesFor(r: BadgeStats) {
  return [
    { on: r.winners > 0, icon: "🎯", name: "Bullseye", hint: "Called a session winner" },
    { on: r.podiums > 0, icon: "🔮", name: "Oracle", hint: "Perfect podium (P1–P3 exact)" },
    { on: r.exact >= 25, icon: "🏹", name: "Sharpshooter", hint: "25 exact positions" },
    { on: r.played >= 10, icon: "📅", name: "Ever-present", hint: "10 sessions predicted" },
    { on: r.best >= 40, icon: "🔥", name: "Hot Lap", hint: "40+ points in one session" },
  ];
}
