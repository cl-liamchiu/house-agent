// 14 days of synthetic daily summaries + the resident profile (the "memory" the model retrieves from).
import { hm } from "./types";

export interface Day {
  k: number; // days ago
  wake: number; // minutes of day
  nightToilet: number;
  water: number;
  breakfast: number;
  meds: boolean;
  fridge: number;
  tv: number; // minutes
  maxTemp: number;
  stillGaps15: number; // daytime gaps ≥15 min with no motion anywhere
  note: string;
  flag: boolean;
  tags: string[];
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function makeHistory(): Day[] {
  const r = rng(7);
  const days: Day[] = [];
  for (let k = 14; k >= 1; k--) {
    const wake = Math.round(398 + r() * 30);
    days.push({
      k, wake, nightToilet: [0, 1, 1, 1, 2, 1][Math.floor(r() * 6)],
      water: Math.round((1250 + r() * 350) / 10) * 10,
      breakfast: wake + Math.round(22 + r() * 25), meds: r() < 0.93,
      fridge: Math.round(7 + r() * 5), tv: Math.round(140 + r() * 90),
      maxTemp: +(29 + r() * 2.4).toFixed(1), stillGaps15: 3 + Math.floor(r() * 6),
      note: "", flag: false, tags: [],
    });
  }
  const by = (k: number) => days.find((d) => d.k === k)!;
  Object.assign(by(10), { nightToilet: 4, water: 780, flag: true });
  Object.assign(by(9), { nightToilet: 5, water: 690, flag: true, note: "On the phone she told her daughter it stings when she pees." });
  Object.assign(by(8), { nightToilet: 4, water: 820, flag: true, note: "Clinic visit: urinary tract infection, 5 days of antibiotics; night toilet trips back to ~1 after." });
  Object.assign(by(6), { stillGaps15: 9, note: "Napped on the sofa 13:20–14:45 with the TV on (no motion for 70 min). Daughter called, she was fine." });
  Object.assign(by(5), { maxTemp: 33.4, note: "Afternoon room temp 33°C with A/C off (worried about the bill); turned it on after daughter called." });
  Object.assign(by(4), { fridge: 19, tv: 262, flag: true, note: "Sunday: grandson visited, many fridge openings, TV on longer." });
  Object.assign(by(3), { wake: 575, breakfast: 592, flag: true, note: "Watched TV until 01:00, got up 09:35, rice cooker at 09:52." });
  Object.assign(by(2), { note: "Left a pot of soup on the stove ~12 min while in the living room; came back on her own." });
  days.forEach((d) => {
    const tags: string[] = [];
    if (d.nightToilet >= 3) tags.push("night_toilet", "night");
    if (d.water < 1000) tags.push("low_water");
    if (d.wake > 480) tags.push("late_wake", "breakfast");
    if (d.fridge > 15) tags.push("visitor");
    if (d.maxTemp >= 32.5) tags.push("heat");
    if (!d.meds) tags.push("missed_meds");
    if (/clinic/i.test(d.note)) tags.push("clinic");
    if (/nap|sofa/i.test(d.note)) tags.push("stillness", "nap");
    if (/stove/i.test(d.note)) tags.push("stove");
    d.tags = tags;
  });
  return days;
}

export const PROFILE = [
  { id: "p1", text: "Grandma Chen, 78, lives alone in a 3rd-floor apartment in Taipei. Hypertension: one pill after breakfast (pill box on the bedside table).", tags: ["meds", "breakfast"] },
  { id: "p2", text: "Breakfast habit: steams buns or porridge in the rice cooker around 07:00–07:30, eats at the dining table.", tags: ["breakfast", "cooking"] },
  { id: "p3", text: "Daughter lives 40 min away, visits Sundays with grandson. Emergency contact: daughter, then the neighbourhood warden.", tags: ["contact", "fall", "stove", "kettle"] },
  { id: "p4", text: "Worries about the electricity bill, often leaves the A/C off. Drinks little water ('or I keep running to the toilet').", tags: ["heat", "low_water", "night_toilet"] },
  { id: "p5", text: "Mild knee osteoarthritis, slow to get up at night; slipped in the bathroom once last year.", tags: ["fall", "night"] },
  { id: "p6", text: "Often naps on the sofa after lunch with the TV on.", tags: ["nap", "stillness", "tv"] },
  { id: "p7", text: "Has become a bit forgetful in the past two months (forgot her keys once last month).", tags: ["keys", "stove", "kettle", "missed_meds"] },
];

export function baseline(days: Day[]) {
  const use = days.filter((d) => !d.flag);
  const stat = (f: (d: Day) => number, floor: number) => {
    const v = use.map(f);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length - 1));
    return { mean, sd: Math.max(sd, floor) };
  };
  return {
    nightToilet: stat((d) => d.nightToilet, 0.5),
    wake: stat((d) => d.wake, 10),
    breakfast: stat((d) => d.breakfast, 10),
    water: stat((d) => d.water, 120),
    fridge: stat((d) => d.fridge, 1.5),
    tv: stat((d) => d.tv, 20),
    stillGaps15: stat((d) => d.stillGaps15, 1),
    meds: use.filter((d) => d.meds).length / use.length,
  };
}
export type Baseline = ReturnType<typeof baseline>;

export const dayText = (d: Day) =>
  `${d.k}d ago: wake ${hm(d.wake * 60)}, night toilet ${d.nightToilet}, water ${d.water} ml, breakfast ${hm(d.breakfast * 60)} (rice cooker), meds ${d.meds ? "yes" : "NOT detected"}, fridge opens ${d.fridge}, TV ${(d.tv / 60).toFixed(1)} h, max room ${d.maxTemp}°C, daytime still gaps ≥15min: ${d.stillGaps15}.${d.note ? " NOTE: " + d.note : ""}`;

export const HISTORY = makeHistory();
export const BASE = baseline(HISTORY);
