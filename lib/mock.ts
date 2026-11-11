// Rule-based fallback: used when there is no API key or the LLM call fails.
// Uses ONLY sensor-derived features (never the simulator's ground truth).
import type { Features } from "./context";
import { normalize } from "./schema";
import type { AlertLevel, Category, Evidence, Hypothesis, Inference, LogEntry } from "./types";
import { hm } from "./types";

const ev = (l: LogEntry | undefined, why: string): Evidence[] => (l ? [{ log_id: l.id, why }] : []);
const mins = (s: number) => Math.round(s / 60);

export function mockInfer(f: Features, groups: Record<number, number[]>): Inference {
  const H: Hypothesis[] = [];
  const add = (category: Category, score: number, label: string, evidence: Evidence[]) => {
    if (score > 0) H.push({ category, score, label, evidence });
  };
  // PIR evidence must point at the first id of a compressed minute-group so the UI can highlight it
  const groupOf = (l?: LogEntry) => {
    if (!l) return undefined;
    for (const [k, ids] of Object.entries(groups)) if (ids.includes(l.id)) return { ...l, id: Number(k) };
    return l;
  };
  const lastArea = f.lastPirAny?.area;
  const lastPirEv = ev(groupOf(f.lastPirAny), `last motion anywhere: ${lastArea} PIR`);
  const still = f.sinceMotion;
  const stoveHot = f.stoveTemp > 80;
  const away = f.outNoMotion;

  // safety hazards
  if (stoveHot && (away || f.sinceKitchenMotion > 300)) {
    add("safety_hazard", 70 + Math.min(25, mins(f.sinceKitchenMotion)), away
      ? "Gas stove is still burning but Grandma has left home"
      : `Gas stove has been on with nobody in the kitchen for ${mins(f.sinceKitchenMotion)} min`,
      [...ev(f.stoveLog, `stove heat ${f.stoveTemp.toFixed(0)}°C`), ...ev(groupOf(f.lastPir.kitchen), "last kitchen motion"), ...ev(groupOf(f.lastPir.living), "motion is in the living room")]);
  }
  if (f.kettleHighSec >= 10 * 60) {
    add("safety_hazard", 60 + Math.min(30, mins(f.kettleHighSec) - 10), `Hot-water pot drawing 700 W non-stop for ${mins(f.kettleHighSec)} min — likely boiling dry`,
      [...ev(f.kettleLog, "pot stuck at high power"), ...ev(f.kettleWeightLog, "pot weight near empty")]);
  }
  // out of home
  if (away) add("out_of_home", stoveHot ? 40 : 85, "Grandma has gone out", [...ev(f.doorLog, "front door cycled"), ...lastPirEv]);
  // fall vs nap vs sleep
  if (!f.bedOcc && !away && still >= 240) {
    const nightBoost = f.night ? 45 : 8;
    const tvPenalty = f.tvOn ? -25 : 0;
    const bathroom = lastArea === "bathroom" ? 10 : 0;
    const s = 10 + nightBoost + tvPenalty + bathroom + Math.min(30, mins(still) / 2);
    add("possible_fall", Math.max(4, s),
      `No motion for ${mins(still)} min, bed is empty — Grandma may have fallen in the ${lastArea ?? "house"}`,
      [...lastPirEv, ...ev(f.bedLog, "bed pressure says not in bed")]);
  }
  if (f.bedOcc) {
    add("sleeping", f.night ? 80 : 45, f.night ? "Grandma is asleep in bed" : "Grandma is lying in bed",
      [...ev(f.bedLog, "mattress pressure occupied"), ...ev(groupOf(f.lastPir.bedroom), "only occasional bedroom motion")]);
  }
  if (!f.bedOcc && !away && f.lastPir.living && lastArea === "living") {
    const quiet = still > 120;
    if (f.tvOn) {
      add("watching_tv", quiet ? 30 : 55, "Grandma is watching TV in the living room", [...ev(f.tvLog, "TV circuit ~112 W"), ...lastPirEv]);
      add("resting", quiet ? 45 + Math.min(20, mins(still) / 3) : 20, quiet ? `Grandma has dozed off in front of the TV (still for ${mins(still)} min)` : "Grandma is sitting quietly in the living room",
        [...ev(f.tvLog, "TV still on"), ...lastPirEv]);
    } else {
      add("resting", 25, "Grandma is sitting quietly in the living room", lastPirEv);
    }
  }
  // kitchen activity
  if (f.riceW >= 800) add("cooking", 60, "Grandma is steaming food in the rice cooker", [...ev(f.riceLog, "rice cooker 800 W"), ...ev(groupOf(f.lastPir.kitchen), "kitchen motion")]);
  if (stoveHot && f.sinceKitchenMotion <= 300) add("cooking", 65, "Grandma is cooking on the gas stove", [...ev(f.stoveLog, `stove heat ${f.stoveTemp.toFixed(0)}°C`), ...ev(groupOf(f.lastPir.kitchen), "she is in the kitchen")]);
  if (f.riceW === 45 && (lastArea === "living" || lastArea === "kitchen") && still < 300) {
    add("eating", 40, "Grandma is eating what she cooked", [...ev(f.riceLog, "rice cooker switched to keep-warm"), ...lastPirEv]);
  }
  if (f.motion5.kitchen > 0 && f.riceW < 800 && !stoveHot) add("cooking", 15, "Grandma is getting food or water in the kitchen", [...ev(f.fridgeLog, "fridge door"), ...ev(groupOf(f.lastPir.kitchen), "kitchen motion")]);
  // toilet / meds
  if (f.flushLog && f.t - f.flushLog.t < 240) add("toileting", 60, "Grandma just used the toilet", [...ev(f.flushLog, "toilet flush"), ...ev(groupOf(f.lastPir.bathroom), "bathroom motion")]);
  else if (lastArea === "bathroom" && still < 600) add("toileting", 35, "Grandma is in the bathroom", lastPirEv);
  if (f.pillLog && f.t - f.pillLog.t < 240) add("taking_meds", 55, "Grandma just took her pills", ev(f.pillLog, "pill box weight dropped 0.4 g"));
  // movement
  const activeAreas = Object.values(f.motion5).filter((n) => n > 0).length;
  if (!away && still < 120) add("moving_around", activeAreas >= 2 ? 40 : 18, "Grandma is moving between rooms", lastPirEv);
  // heat
  if (f.roomTemp >= 32.5 && !f.acOn && !away) add("safety_hazard", 45 + Math.min(30, (f.roomTemp - 32.5) * 15), `Room is ${f.roomTemp.toFixed(1)}°C and the A/C is off — heat risk`, ev(f.roomLog, "room thermometer"));
  add("other", 3, "Something not covered by the other hypotheses", []);

  // keep the best hypothesis per category
  const best = new Map<Category, Hypothesis>();
  for (const h of H) if (!best.has(h.category) || best.get(h.category)!.score < h.score) best.set(h.category, h);
  const hyps = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 5);
  const top = hyps[0];

  let alert: AlertLevel = "normal";
  if (top.category === "safety_hazard" || top.category === "possible_fall") alert = top.score >= 50 ? "urgent" : "notify_family";
  else if (hyps.slice(0, 3).some((h) => h.category === "possible_fall" || h.category === "safety_hazard")) alert = "watch";

  const msg: Record<string, string> = {
    safety_hazard: `Heads-up: ${top.label.charAt(0).toLowerCase() + top.label.slice(1)}. Please call Mom now.`,
    possible_fall: `Mom's bed is empty and there has been no movement for ${mins(still)} min (last seen in the ${lastArea}). Please call her now.`,
    out_of_home: "Mom went out. Everything at home looks off and safe.",
    sleeping: "Mom is asleep. Nothing unusual.",
  };
  return normalize({
    hypotheses: hyps,
    location: away ? "outside" : f.bedOcc ? "bedroom" : lastArea ?? "unknown",
    alert_level: alert,
    family_message: msg[top.category] ?? `All normal: ${top.label.charAt(0).toLowerCase() + top.label.slice(1)}.`,
    reasoning_summary: `Rule-based fallback at ${hm(f.t)}: last motion ${mins(still)} min ago in ${lastArea ?? "?"}, bed ${f.bedOcc ? "occupied" : "empty"}, stove ${f.stoveTemp.toFixed(0)}°C, TV ${f.tvOn ? "on" : "off"}.`,
  });
}
