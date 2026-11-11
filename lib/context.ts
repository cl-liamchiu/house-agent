// Builds what the model sees each round: compressed raw log + program-computed summary + retrieved memory.
import { BASE, HISTORY, PROFILE, dayText } from "./history";
import type { Sim } from "./sim";
import { type Area, CATEGORIES, type InferenceRecord, type LogEntry, hm, hms } from "./types";

export const WINDOW_SEC = 45 * 60;
const AREAS: Area[] = ["bedroom", "bathroom", "kitchen", "living", "entry"];

export interface Features {
  t: number;
  night: boolean;
  bedOcc: boolean;
  lastPir: Record<string, LogEntry | undefined>;
  lastPirAny?: LogEntry;
  sinceMotion: number; // seconds since any PIR ON
  motion5: Record<string, number>; // PIR ON count per area in last 5 min
  stoveTemp: number;
  stoveLog?: LogEntry;
  sinceKitchenMotion: number;
  kettleW: number;
  kettleHighSec: number;
  kettleLog?: LogEntry;
  kettleWeightLog?: LogEntry;
  riceW: number;
  riceLog?: LogEntry;
  tvOn: boolean;
  tvLog?: LogEntry;
  acOn: boolean;
  roomTemp: number;
  roomLog?: LogEntry;
  doorLog?: LogEntry;
  outNoMotion: boolean; // front door cycled and no indoor motion since
  flushLog?: LogEntry;
  pillLog?: LogEntry;
  fridgeLog?: LogEntry;
  bedLog?: LogEntry;
  today: TodaySummary;
}

export interface TodaySummary {
  wake: number | null;
  nightToilet: number;
  toiletToday: number;
  waterMl: number;
  medsAt: number | null;
  riceStarts: number[];
  fridgeOpens: number;
  tvMin: number;
  maxRoom: number;
  stillGaps15: number;
  longestStillMin: number;
}

function todaySummary(sim: Sim, logs: LogEntry[]): TodaySummary {
  const d0 = Math.floor(sim.t / 86400) * 86400;
  const today = logs.filter((l) => l.t >= d0);
  const at = (l: LogEntry) => l.t - d0;
  const wakeL = today.find((l) => l.sensor === "bedroom.bed.pressure" && /→ 0\.0/.test(l.value) && at(l) >= 5 * 3600);
  const flush = today.filter((l) => l.sensor === "bathroom.toilet.flush");
  let water = 0;
  for (const l of today.filter((x) => x.sensor === "kitchen.kettle.weight")) {
    const [a, b] = l.value.split("→").map((s) => parseFloat(s));
    if (b < a) water += Math.round((a - b) * 1000);
  }
  const pill = today.find((l) => l.sensor === "bedroom.pillbox.weight");
  const rice = today.filter((l) => l.sensor === "kitchen.rice_cooker.power" && /^0 → 800/.test(l.value));
  let tvMin = 0, tvOnAt: number | null = null;
  for (const l of today.filter((x) => x.sensor === "living.tv.power")) {
    if (/^0 →/.test(l.value)) tvOnAt = l.t;
    else if (tvOnAt != null) { tvMin += (l.t - tvOnAt) / 60; tvOnAt = null; }
  }
  if (tvOnAt != null) tvMin += (sim.t - tvOnAt) / 60;
  const temps = today.filter((l) => l.sensor === "living.temp").map((l) => parseFloat(l.value));
  // daytime still gaps (08–22h) between PIR triggers
  const pirTimes = today.filter((l) => l.type === "pir" && l.value === "ON").map((l) => l.t);
  pirTimes.push(sim.t);
  let gaps = 0, longest = 0;
  for (let i = 1; i < pirTimes.length; i++) {
    const g = pirTimes[i] - pirTimes[i - 1];
    const s = pirTimes[i - 1] - d0;
    if (s >= 8 * 3600 && s < 22 * 3600 && g >= 900) gaps++;
    if (s >= 8 * 3600) longest = Math.max(longest, g / 60);
  }
  return {
    wake: wakeL ? at(wakeL) : null,
    nightToilet: flush.filter((l) => at(l) < 6 * 3600).length,
    toiletToday: flush.length,
    waterMl: water,
    medsAt: pill ? at(pill) : null,
    riceStarts: rice.map(at),
    fridgeOpens: today.filter((l) => l.sensor === "kitchen.fridge.door" && l.value === "OPEN").length,
    tvMin: Math.round(tvMin),
    maxRoom: temps.length ? Math.max(...temps) : sim.room,
    stillGaps15: gaps,
    longestStillMin: Math.round(longest),
  };
}

/** Features are derived only from what sensors report — never from ground truth. */
export function features(sim: Sim): Features {
  const logs = sim.logs, t = sim.t;
  const lastPir: Record<string, LogEntry | undefined> = {};
  let lastPirAny: LogEntry | undefined;
  const motion5: Record<string, number> = Object.fromEntries(AREAS.map((a) => [a, 0]));
  for (let i = logs.length - 1; i >= 0; i--) {
    const l = logs[i];
    if (l.type !== "pir" || l.value !== "ON") continue;
    if (!lastPir[l.area]) lastPir[l.area] = l;
    if (!lastPirAny) lastPirAny = l;
    if (t - l.t <= 300) motion5[l.area]++;
    if (t - l.t > 6 * 3600 && AREAS.every((a) => lastPir[a])) break;
  }
  const lb = sim.lastBy;
  const d = sim.dev;
  // how long the kettle has been drawing high power
  // how long the kettle circuit has stayed above 500 W (from the power log)
  let kettleHighSec = 0;
  const kl = lb["kitchen.kettle.power"];
  if (kl && d.kettle.w >= 500) {
    let start = kl.t;
    for (let i = logs.length - 1; i >= 0; i--) {
      const l = logs[i];
      if (l.sensor !== "kitchen.kettle.power") continue;
      const [a, b] = l.value.split("→").map((x) => parseFloat(x));
      if (b >= 500 && a < 500) { start = l.t; break; }
    }
    kettleHighSec = t - start;
  }
  const door = lb["entry.front_door"];
  const lastDoorOpen = [...logs].reverse().find((l) => l.sensor === "entry.front_door" && l.value === "OPEN");
  const outNoMotion = !!lastDoorOpen && (!lastPirAny || lastPirAny.t <= lastDoorOpen.t + 6) && !d.bed.occ;
  return {
    t,
    night: sim.isNight(),
    bedOcc: d.bed.occ,
    lastPir,
    lastPirAny,
    sinceMotion: lastPirAny ? t - lastPirAny.t : 99999,
    motion5,
    stoveTemp: d.stove.temp,
    stoveLog: lb["kitchen.stove.temp"],
    sinceKitchenMotion: lastPir.kitchen ? t - lastPir.kitchen.t : 99999,
    kettleW: d.kettle.w,
    kettleHighSec,
    kettleLog: kl,
    kettleWeightLog: lb["kitchen.kettle.weight"],
    riceW: sim.watts().rice,
    riceLog: lb["kitchen.rice_cooker.power"],
    tvOn: d.tv.on,
    tvLog: lb["living.tv.power"],
    acOn: d.ac.on,
    roomTemp: sim.room,
    roomLog: lb["living.temp"],
    doorLog: door,
    outNoMotion,
    flushLog: lb["bathroom.toilet.flush"],
    pillLog: lb["bedroom.pillbox.weight"],
    fridgeLog: lb["kitchen.fridge.door"],
    bedLog: lb["bedroom.bed.pressure"],
    today: todaySummary(sim, logs),
  };
}

const vs = (v: number, m: { mean: number; sd: number }, unit = "") =>
  `${v}${unit} (usual ${m.mean.toFixed(1)}±${m.sd.toFixed(1)}${unit}, z=${((v - m.mean) / m.sd).toFixed(1)})`;

export const SYSTEM_PROMPT = `You are the reasoning engine of a passive home-sensing service for an older adult who lives alone.
Rules:
- The home has ONLY passive sensors (PIR motion, door contacts, mattress pressure, circuit power meters, a heat sensor above the gas stove, room thermometer, load cells, an acoustic toilet-flush sensor). No cameras, no wearables. You never see the person.
- PIR only detects movement. A still person (sleeping, sitting, dozing, or lying on the floor after a fall) produces few or no triggers. PIR is noisy: it toggles ON/OFF many times while someone is in a room.
- Stillness alone is NOT an emergency. In real data from a senior living alone (CASAS hh101), daytime gaps of ≥15 min with no motion anywhere occur ~5.8 times/day while the person is fine. Use context: time of day, TV on, bed pressure, where the last motion was, the person's own history.
- Typical PIR trigger rates for one person: walking = near-continuous; sitting awake (e.g. watching TV) ≈ 100 ON/hour; dozing in a chair ≈ 5–10/hour; asleep in bed ≈ 2–3/hour; lying still on the floor ≈ 0. Compare the observed rate in the room of last motion with these.
- Risk asymmetry: a missed fall is far worse than one unnecessary check-in call. Getting out of bed at night and then near-total silence away from the bed (bed still empty) for 10+ minutes is the classic night-fall pattern for older adults; rank possible_fall high in that situation unless other signals (TV on, regular motion, return to bed) explain it. A daytime nap in front of a running TV is usually just resting.
- Corroborate with multiple signals. Cite log ids as evidence (only ids that appear in the log).
- Do not make medical diagnoses. Be calm and specific in the family message.
Output: ONLY a JSON object, no markdown.`;

export interface BuiltContext {
  user: string;
  groups: Record<number, number[]>;
  validIds: number[];
  feats: Features;
}

export function buildContext(sim: Sim, earlier: InferenceRecord[]): BuiltContext {
  const t = sim.t;
  const f = features(sim);
  const win = sim.logs.filter((l) => l.t > t - WINDOW_SEC);
  const groups: Record<number, number[]> = {};
  type Line = { t: number; id: number; text: string };
  const lines: Line[] = [];
  const pirBuckets = new Map<string, LogEntry[]>();
  for (const l of win) {
    if (l.type === "pir") {
      const k = `${Math.floor(l.t / 60)}|${l.area}`;
      if (!pirBuckets.has(k)) pirBuckets.set(k, []);
      pirBuckets.get(k)!.push(l);
    } else {
      lines.push({ t: l.t, id: l.id, text: `#${l.id}  ${hms(l.t)}  ${l.sensor.padEnd(26)} ${l.value}` });
    }
  }
  for (const [, arr] of pirBuckets) {
    const ons = arr.filter((x) => x.value === "ON").length;
    const first = arr[0];
    groups[first.id] = arr.map((x) => x.id);
    lines.push({ t: first.t, id: first.id, text: `#${first.id}  ${hm(first.t)}:xx  ${first.area + ".pir"}`.padEnd(42) + ` motion this minute (${ons} ON, ${arr.length - ons} OFF)` });
  }
  lines.sort((a, b) => a.t - b.t || a.id - b.id);
  const kept = lines.slice(-260);
  const validIds = Object.keys(groups).map(Number).concat(win.filter((l) => l.type !== "pir").map((l) => l.id));

  const s = f.today;
  const tags = new Set<string>();
  if (f.night) tags.add("night");
  if (f.stoveTemp > 60) tags.add("stove");
  if (f.kettleHighSec > 600) tags.add("kettle");
  if (f.roomTemp >= 32) tags.add("heat");
  if (f.sinceMotion > 600) { tags.add("stillness"); tags.add("fall"); }
  if (f.tvOn) tags.add("tv");
  if (s.nightToilet >= 3) tags.add("night_toilet");
  const mem = HISTORY.filter((d) => d.k <= 2 || d.tags.some((x) => tags.has(x)));
  const prof = PROFILE.filter((p, i) => i === 0 || p.tags.some((x) => tags.has(x)));

  const cur = [
    `bed pressure: ${f.bedOcc ? "occupied (~58 kg)" : "empty"}`,
    `power now: ${Object.entries(sim.watts()).map(([k, v]) => `${k}=${v}W`).join(" ")}`,
    `stove heat sensor: ${f.stoveTemp.toFixed(0)}°C`,
    `room: ${f.roomTemp.toFixed(1)}°C (outdoor forecast ${sim.outdoor().toFixed(0)}°C)`,
    `kettle scale: ${((1240 + sim.dev.kettle.water) / 1000).toFixed(2)} kg (empty pot = 1.24 kg)`,
    `fridge door: ${sim.dev.fridge.open ? "OPEN" : "closed"}; key hook: ${sim.dev.keys.onHook ? "46 g" : "0 g"}`,
    `last PIR per area: ${AREAS.map((a) => `${a} ${f.lastPir[a] ? hms(f.lastPir[a]!.t) : "—"}`).join(", ")}`,
    `seconds since ANY motion: ${f.sinceMotion}`,
  ];

  const B = BASE;
  const summary = [
    `wake (bed empty after 05:00): ${s.wake != null ? hm(s.wake) + ` (usual ${hm(B.wake.mean * 60)}±${B.wake.sd.toFixed(0)}min)` : "not yet"}`,
    `night toilet flushes 00–06: ${vs(s.nightToilet, B.nightToilet)}`,
    `toilet flushes today: ${s.toiletToday}`,
    `water dispensed from pot today: ${s.waterMl} ml (usual full day ${B.water.mean.toFixed(0)} ml)`,
    `pill box weight drop: ${s.medsAt != null ? "at " + hm(s.medsAt) : "none yet"} (takes meds on ${(B.meds * 100).toFixed(0)}% of days)`,
    `rice cooker starts: ${s.riceStarts.map(hm).join(", ") || "none"}`,
    `fridge opens: ${s.fridgeOpens}; TV on: ${s.tvMin} min; max room temp ${s.maxRoom.toFixed(1)}°C`,
    `daytime no-motion gaps ≥15 min so far: ${s.stillGaps15} (usual ${B.stillGaps15.mean.toFixed(1)}/day); longest today ${s.longestStillMin} min`,
  ];

  const prev = earlier.slice(-6).map((r) => `${hm(r.t)}  #1 ${r.hypotheses[0]?.category} — ${r.hypotheses[0]?.label} [alert ${r.alert_level}]`);

  const user = `NOW: ${hms(t)} (day ${Math.floor(t / 86400) + 1}, ${f.night ? "night" : "day"})

RESIDENT PROFILE (retrieved):
${prof.map((p) => "- " + p.text).join("\n")}

CURRENT SENSOR READINGS:
${cur.map((x) => "- " + x).join("\n")}

TODAY SO FAR (computed by program, compared with 14-day personal baseline):
${summary.map((x) => "- " + x).join("\n")}

PAST DAYS (retrieved by tags: ${[...tags].join(", ") || "recent"}):
${mem.map((d) => "- " + dayText(d)).join("\n")}

YOUR EARLIER INFERENCES TODAY:
${prev.length ? prev.join("\n") : "(none yet)"}

RAW SENSOR LOG, last ${WINDOW_SEC / 60} min (PIR compressed to one line per minute per area; other sensors verbatim):
${kept.map((l) => l.text).join("\n") || "(no events)"}

TASK: What is happening in this home RIGHT NOW? Give exactly 5 distinct hypotheses, most likely first.
Return JSON:
{"hypotheses":[{"label":"plain-English sentence about Grandma","category":one of ${JSON.stringify(CATEGORIES)},"score":0-100,"evidence":[{"log_id":number,"why":"short"}]}],
 "location":"bedroom|bathroom|kitchen|living|entry|outside|unknown","alert_level":"normal|watch|notify_family|urgent",
 "family_message":"one or two sentences to her daughter","reasoning_summary":"one or two sentences"}`;
  return { user, groups, validIds, feats: f };
}
