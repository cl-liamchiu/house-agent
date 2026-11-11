import { DEV, type DevId, cellArea, findPath } from "./house";
import type { Area, Category, LogEntry, SensorType } from "./types";

export type Posture = "lying" | "stand" | "sitting" | "dozing" | "fallen" | "away";
export type Step = [number, string, string | [number, number]]; // [sim seconds, device|'go'|'elder', action|target]

export interface Scenario {
  id: string;
  name: string;
  when: string;
  desc: string;
  start: number; // sim seconds
  speed: number;
  heat?: number;
  init?: (s: Sim) => void;
  steps: Step[];
}

const AREAS: Area[] = ["bedroom", "bathroom", "kitchen", "living", "entry"];
const PIR_P: Record<string, number> = {
  walk: 0.9,
  stand: 0.3,
  sitting: 0.028, // ~100 triggers/hour while watching TV (CASAS hh101)
  dozing: 0.002,
  lying: 0.0007, // turning over in bed
};
const MAX_LOGS = 20000;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export class Sim {
  t = 0;
  speed = 10;
  paused = false;
  heat = 0;
  rand = rng(42);
  elder = { x: 2, y: 2, posture: "lying" as Posture };
  walk: { path: [number, number][]; cb?: () => void } | null = null;
  dev = {
    bed: { occ: true },
    fridge: { open: false, closeAt: 0, cyc: 7, w: 110 },
    rice: { mode: "off" as "off" | "cook" | "warm", until: 0 },
    kettle: { water: 1600, boilUntil: 0, w: 4, highSince: 0 },
    stove: { on: false, temp: 27, lastLogged: 27, lastLogT: -9999 },
    ac: { on: false },
    tv: { on: false },
    pills: { g: 18.0 },
    keys: { onHook: true },
  };
  room = 27.5;
  pir: Record<string, { on: boolean; offAt: number }> = Object.fromEntries(AREAS.map((a) => [a, { on: false, offAt: 0 }]));
  logs: LogEntry[] = [];
  nextId = 1000;
  /** last raw entry per sensor — used to cite evidence */
  lastBy: Record<string, LogEntry> = {};
  /** ground truth: what the resident is actually doing */
  gtOverride: { cat: Category; until: number } | null = null;
  gtSeries: { t: number; cat: Category }[] = [];
  lastKitchenPresence = 0;
  script: { steps: Step[]; i: number } | null = null;
  instant = false;
  scenario: Scenario | null = null;
  version = 0;

  /* ---------- logging ---------- */
  log(sensor: string, area: Area, type: SensorType, value: string) {
    const e: LogEntry = { id: this.nextId++, t: this.t, sensor, area, type, value };
    this.logs.push(e);
    this.lastBy[sensor] = e;
    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
  }

  get home() {
    return this.elder.posture !== "away";
  }
  get area(): Area | null {
    if (!this.home) return null;
    return cellArea(this.elder.x, this.elder.y);
  }
  isNight(t = this.t) {
    const m = (t % 86400) / 60;
    return m >= 22 * 60 || m < 6 * 60;
  }

  pirTrigger(area: Area | null) {
    if (!area) return;
    const p = this.pir[area];
    if (!p) return;
    if (!p.on) {
      p.on = true;
      this.log(`${area}.pir`, area, "pir", "ON");
    }
    p.offAt = this.t + 4 + Math.floor(this.rand() * 5);
  }

  /* ---------- actions ---------- */
  actionsFor(dev: DevId): [string, string][] {
    const d = this.dev, p = this.elder.posture;
    switch (dev) {
      case "bed": return p === "lying" ? [["getup", "Get up"]] : [["lie", "Lie down to sleep"]];
      case "pills": return [["take", "Take morning pills"]];
      case "toilet": return [["flush", "Use toilet & flush"]];
      case "kettle": return [["drink", "Pour a cup (200 ml)"], ["refill", "Refill the pot"]];
      case "rice": return d.rice.mode === "cook" ? [["stop", "Unplug early"]] : [["cook", "Steam breakfast (15 min)"]];
      case "stove": return d.stove.on ? [["off", "Turn gas off"]] : [["on", "Turn gas on"]];
      case "fridge": return d.fridge.open ? [["close", "Close fridge"]] : [["peek", "Grab something (40 s)"], ["open", "Open fridge door"]];
      case "sofa":
        if (p === "dozing") return [["wake", "Wake up"]];
        if (p === "sitting") return [["doze", "Doze off"], ["stand", "Stand up"]];
        return [["sit", "Sit on sofa"]];
      case "tv": return d.tv.on ? [["off", "Turn TV off"]] : [["on", "Turn TV on"]];
      case "ac": return d.ac.on ? [["off", "Turn A/C off"]] : [["on", "Turn A/C on"]];
      case "table": return [["eat", "Eat a meal (15 min)"]];
      case "keys": return d.keys.onHook ? [["take", "Take keys"]] : [["hang", "Hang keys back"]];
      case "door": return [["out", d.keys.onHook ? "Go out (no keys!)" : "Go out with keys"]];
    }
  }

  setGt(cat: Category, secs: number) {
    this.gtOverride = { cat, until: this.t + secs };
  }

  perform(dev: string, act: string) {
    const d = this.dev, e = this.elder;
    if (dev !== "elder" && dev !== "door") this.pirTrigger(this.area);
    switch (`${dev}.${act}`) {
      case "bed.getup":
        e.posture = "stand";
        if (d.bed.occ) this.log("bedroom.bed.pressure", "bedroom", "pressure", "58.2 → 0.0 kg");
        d.bed.occ = false;
        [e.x, e.y] = DEV.bed.spot;
        this.pirTrigger("bedroom");
        break;
      case "bed.lie":
        e.posture = "lying";
        [e.x, e.y] = [2, 2];
        if (!d.bed.occ) this.log("bedroom.bed.pressure", "bedroom", "pressure", "0.0 → 57.9 kg");
        d.bed.occ = true;
        break;
      case "pills.take": {
        const before = d.pills.g;
        d.pills.g = Math.max(0, +(before - 0.4).toFixed(1));
        this.log("bedroom.pillbox.weight", "bedroom", "weight", `${before.toFixed(1)} → ${d.pills.g.toFixed(1)} g`);
        this.setGt("taking_meds", 90);
        break;
      }
      case "toilet.flush":
        this.log("bathroom.toilet.flush", "bathroom", "sound", `FLUSH  ${72 + Math.floor(this.rand() * 8)} dB, ${6 + Math.floor(this.rand() * 3)} s`);
        this.setGt("toileting", 150);
        break;
      case "kettle.drink": {
        const before = d.kettle.water;
        d.kettle.water = Math.max(0, before - 200);
        this.log("kitchen.kettle.weight", "kitchen", "weight", `${((1240 + before) / 1000).toFixed(2)} → ${((1240 + d.kettle.water) / 1000).toFixed(2)} kg`);
        this.setGt("moving_around", 60);
        break;
      }
      case "kettle.refill": {
        const before = d.kettle.water;
        d.kettle.water = 2000;
        d.kettle.boilUntil = this.t + 600;
        this.log("kitchen.kettle.weight", "kitchen", "weight", `${((1240 + before) / 1000).toFixed(2)} → ${((1240 + 2000) / 1000).toFixed(2)} kg`);
        this.setGt("moving_around", 60);
        break;
      }
      case "rice.cook":
        d.rice.mode = "cook";
        d.rice.until = this.t + 15 * 60;
        this.setGt("cooking", 240);
        break;
      case "rice.stop": d.rice.mode = "off"; break;
      case "stove.on": d.stove.on = true; this.setGt("cooking", 300); break;
      case "stove.off": d.stove.on = false; break;
      case "fridge.open":
        if (!d.fridge.open) this.log("kitchen.fridge.door", "kitchen", "door", "OPEN");
        d.fridge.open = true; d.fridge.closeAt = 0; break;
      case "fridge.peek":
        if (!d.fridge.open) this.log("kitchen.fridge.door", "kitchen", "door", "OPEN");
        d.fridge.open = true; d.fridge.closeAt = this.t + 30 + Math.floor(this.rand() * 20);
        this.setGt("cooking", 90);
        break;
      case "fridge.close":
        if (d.fridge.open) this.log("kitchen.fridge.door", "kitchen", "door", "CLOSED");
        d.fridge.open = false; break;
      case "sofa.sit": e.posture = "sitting"; [e.x, e.y] = DEV.sofa.spot; break;
      case "sofa.doze": e.posture = "dozing"; break;
      case "sofa.wake": e.posture = "sitting"; break;
      case "sofa.stand": e.posture = "stand"; break;
      case "tv.on": d.tv.on = true; break;
      case "tv.off": d.tv.on = false; break;
      case "ac.on": d.ac.on = true; break;
      case "ac.off": d.ac.on = false; break;
      case "table.eat": e.posture = "sitting"; [e.x, e.y] = DEV.table.spot; this.setGt("eating", 15 * 60); break;
      case "keys.take": d.keys.onHook = false; this.log("entry.key_hook.weight", "entry", "weight", "46 → 0 g"); break;
      case "keys.hang": d.keys.onHook = true; this.log("entry.key_hook.weight", "entry", "weight", "0 → 46 g"); break;
      case "door.out":
        this.pirTrigger("entry");
        this.log("entry.front_door", "entry", "door", "OPEN");
        e.posture = "away";
        this.walk = null;
        this.pendingDoorClose = this.t + 5;
        break;
      case "door.in":
        this.log("entry.front_door", "entry", "door", "OPEN");
        e.posture = "stand";
        [e.x, e.y] = DEV.door.spot;
        this.pirTrigger("entry");
        this.pendingDoorClose = this.t + 4;
        break;
      case "elder.fall": e.posture = "fallen"; this.walk = null; break;
      case "elder.rise": e.posture = "stand"; this.pirTrigger(this.area); break;
    }
    this.version++;
  }
  pendingDoorClose = 0;

  prep(dev: string, act: string) {
    const e = this.elder;
    if (e.posture === "lying" && !(dev === "bed" && act === "getup")) this.perform("bed", "getup");
    if ((e.posture === "sitting" || e.posture === "dozing") && !(dev === "sofa" || dev === "tv")) e.posture = "stand";
  }

  goTo(target: [number, number], cb?: () => void) {
    const e = this.elder;
    if (!this.home || e.posture === "fallen") return false;
    if (e.posture === "lying") this.perform("bed", "getup");
    if (e.posture === "sitting" || e.posture === "dozing") e.posture = "stand";
    const p = findPath([e.x, e.y], target);
    if (!p) return false;
    if (!p.length) { cb?.(); return true; }
    this.walk = { path: p, cb };
    this.version++;
    return true;
  }

  doAt(dev: DevId | "door", act: string, instant = false) {
    const e = this.elder;
    if (dev === "door" && act === "in") { this.perform("door", "in"); return; }
    if (!this.home || e.posture === "fallen") return;
    const sp = DEV[dev].spot;
    const there = e.x === sp[0] && e.y === sp[1] && e.posture !== "lying";
    const sofaish = (dev === "sofa" || dev === "tv") && (e.posture === "sitting" || e.posture === "dozing");
    if (instant || there || sofaish || (dev === "bed" && e.posture === "lying")) {
      this.prep(dev, act);
      if (this.home && e.posture !== "lying" && !sofaish) [e.x, e.y] = sp;
      this.perform(dev, act);
    } else {
      this.goTo(sp, () => { this.prep(dev, act); this.perform(dev, act); });
    }
  }

  stepWalk() {
    if (!this.walk) return;
    const nxt = this.walk.path.shift();
    if (nxt) {
      [this.elder.x, this.elder.y] = nxt;
      if (this.rand() < PIR_P.walk) this.pirTrigger(cellArea(nxt[0], nxt[1]));
    }
    if (!this.walk.path.length) {
      const cb = this.walk.cb;
      this.walk = null;
      cb?.();
    }
    this.version++;
  }

  /* ---------- physics ---------- */
  outdoor(t = this.t) {
    const m = (t % 86400) / 60;
    return 26.5 + this.heat + 4.5 * Math.cos(((m - 840) / 1440) * 2 * Math.PI);
  }
  watts() {
    const d = this.dev;
    const rice = d.rice.mode === "cook" ? 800 : d.rice.mode === "warm" ? 45 : 0;
    return { fridge: d.fridge.w, kettle: d.kettle.w, rice, tv: d.tv.on ? 112 : 0, ac: d.ac.on ? 950 : 0 };
  }

  private powerChange(sensor: string, area: Area, a: number, b: number) {
    if (a !== b) this.log(sensor, area, "power", `${a} → ${b} W`);
  }

  /** advance one simulated second */
  tick() {
    this.t++;
    const t = this.t, d = this.dev, e = this.elder;
    const before = this.watts();

    // walking happens in sim time too (≈1 m/s)
    if (this.walk) this.stepWalk();

    // PIR noise for the occupant
    if (this.home && e.posture !== "fallen") {
      const p = this.walk ? 0 : PIR_P[e.posture] ?? 0;
      if (p && this.rand() < p) this.pirTrigger(this.area);
    }
    for (const a of AREAS) {
      const p = this.pir[a];
      if (p.on && t >= p.offAt) { p.on = false; this.log(`${a}.pir`, a, "pir", "OFF"); }
    }
    if (this.pendingDoorClose && t >= this.pendingDoorClose) {
      this.pendingDoorClose = 0;
      this.log("entry.front_door", "entry", "door", "CLOSED");
    }
    if (d.fridge.open && d.fridge.closeAt && t >= d.fridge.closeAt) {
      d.fridge.open = false; d.fridge.closeAt = 0;
      this.log("kitchen.fridge.door", "kitchen", "door", "CLOSED");
    }
    if (this.area === "kitchen") this.lastKitchenPresence = t;

    // once per simulated minute
    if (t % 60 === 0) {
      d.fridge.cyc = (d.fridge.cyc + 1) % 45;
      d.fridge.w = d.fridge.open ? 138 : d.fridge.cyc < 18 ? 108 + Math.floor(this.rand() * 6) : 0;
      if (d.rice.mode === "cook" && t >= d.rice.until) { d.rice.mode = "warm"; d.rice.until = t + 45 * 60; }
      else if (d.rice.mode === "warm" && t >= d.rice.until) d.rice.mode = "off";
      const m = Math.floor(t / 60);
      d.kettle.w = d.kettle.water <= 0 || d.kettle.boilUntil > t ? 700 : m % 20 === 0 ? 600 : 4;
      if (d.kettle.w >= 500) { if (!d.kettle.highSince) d.kettle.highSince = t; } else d.kettle.highSince = 0;
      d.stove.temp += ((d.stove.on ? 240 : this.room) - d.stove.temp) * (d.stove.on ? 0.35 : 0.18);
      const tgt = d.ac.on ? 26 : this.outdoor() + 1 + (d.stove.on ? 1.5 : 0);
      this.room += (tgt - this.room) * (d.ac.on ? 0.1 : 0.03);
      // heat sensor reports on change ≥3°C, otherwise every 10 min
      if (Math.abs(d.stove.temp - d.stove.lastLogged) >= 3 || t - d.stove.lastLogT >= 600) {
        this.log("kitchen.stove.temp", "kitchen", "temp", `${d.stove.lastLogged.toFixed(0)} → ${d.stove.temp.toFixed(0)} °C`);
        d.stove.lastLogged = d.stove.temp;
        d.stove.lastLogT = t;
      }
      if (m % 10 === 0) this.log("living.temp", "living", "temp", `${this.room.toFixed(1)} °C  RH ${Math.round(62 - (this.room - 27) * 2)}%`);
      if (m % 5 === 0) {
        const w = this.watts();
        this.log("meter.snapshot", "house", "meter", `fridge=${w.fridge}W kettle=${w.kettle}W rice=${w.rice}W tv=${w.tv}W ac=${w.ac}W`);
      }
    }

    const after = this.watts();
    this.powerChange("kitchen.fridge.power", "kitchen", before.fridge, after.fridge);
    this.powerChange("kitchen.kettle.power", "kitchen", before.kettle, after.kettle);
    this.powerChange("kitchen.rice_cooker.power", "kitchen", before.rice, after.rice);
    this.powerChange("living.tv.power", "living", before.tv, after.tv);
    this.powerChange("living.ac.power", "living", before.ac, after.ac);

    if (t % 60 === 0) this.gtSeries.push({ t, cat: this.groundTruth() });
    if (this.gtSeries.length > 3000) this.gtSeries.shift();
    this.runScript();
  }

  /** what is actually happening (the simulator knows; the model does not) */
  groundTruth(): Category {
    const d = this.dev, e = this.elder, t = this.t;
    if (e.posture === "fallen") return "possible_fall";
    if (d.stove.on && t - this.lastKitchenPresence >= 300) return "safety_hazard";
    if (d.kettle.water <= 0 && d.kettle.highSince && t - d.kettle.highSince >= 600) return "safety_hazard";
    if (e.posture === "away") return "out_of_home";
    if (this.room >= 32.5 && !d.ac.on) return "safety_hazard";
    if (this.gtOverride && t < this.gtOverride.until) {
      if (this.gtOverride.cat !== "eating" || e.posture === "sitting") return this.gtOverride.cat;
    }
    if (e.posture === "lying") return "sleeping";
    if (e.posture === "dozing") return "resting";
    if (e.posture === "sitting") return d.tv.on ? "watching_tv" : "resting";
    if (this.area === "kitchen" && (d.stove.on || d.rice.mode === "cook")) return "cooking";
    if (this.area === "bathroom") return "toileting";
    return "moving_around";
  }

  runScript() {
    const sc = this.script;
    if (!sc || this.walk) return;
    const st = sc.steps[sc.i];
    if (!st) { this.script = null; return; }
    if (st[0] <= this.t) {
      sc.i++;
      this.execStep(st, this.instant);
    }
  }
  execStep(st: Step, instant: boolean) {
    const [, dev, act] = st;
    if (dev === "go") {
      const target = act as [number, number];
      if (instant) { [this.elder.x, this.elder.y] = target; this.pirTrigger(this.area); }
      else this.goTo(target);
    } else if (dev === "elder") this.perform("elder", act as string);
    else this.doAt(dev as DevId, act as string, instant);
  }
}

/* ---------------- scenarios ---------------- */
const H = (h: number, m = 0) => (h * 60 + m) * 60;
const NIGHT: Step[] = [[H(3, 8), "bed", "getup"], [H(3, 10), "toilet", "flush"], [H(3, 14), "bed", "lie"]];
const MORNING: Step[] = [
  [H(6, 40), "bed", "getup"], [H(6, 44), "toilet", "flush"], [H(7, 5), "rice", "cook"], [H(7, 22), "fridge", "peek"],
  [H(7, 24), "table", "eat"], [H(7, 40), "kettle", "drink"], [H(7, 43), "pills", "take"], [H(7, 50), "sofa", "sit"],
  [H(7, 51), "tv", "on"], [H(9, 20), "tv", "off"], [H(9, 25), "kettle", "drink"], [H(10, 0), "toilet", "flush"],
];
const LUNCH: Step[] = [[H(10, 50), "fridge", "peek"], [H(11, 5), "rice", "cook"], [H(11, 22), "table", "eat"], [H(11, 40), "kettle", "drink"], [H(11, 50), "toilet", "flush"]];

export const SCENARIOS: Scenario[] = [
  {
    id: "normal", name: "Ordinary morning", when: "06:30 →",
    desc: "Wake up, toilet, rice cooker breakfast, pills, TV. Shows what 'normal' looks like.",
    start: H(6, 30), speed: 10, steps: [...NIGHT, ...MORNING],
  },
  {
    id: "stove", name: "Stove left on", when: "11:25 →",
    desc: "Turns the gas on for soup, grabs something from the fridge, then wanders off to watch TV.",
    start: H(11, 25), speed: 10, heat: -2,
    steps: [...NIGHT, ...MORNING, [H(10, 50), "fridge", "peek"], [H(11, 30), "stove", "on"], [H(11, 34), "fridge", "peek"], [H(11, 38), "sofa", "sit"], [H(11, 39), "tv", "on"]],
  },
  {
    id: "fall", name: "Night-time fall", when: "01:55 →",
    desc: "Gets up for the toilet at 2 am, walks into the living room, falls. After that: silence.",
    start: H(1, 55), speed: 10,
    steps: [[H(2, 0), "bed", "getup"], [H(2, 2), "toilet", "flush"], [H(2, 5), "go", [8, 7]], [H(2, 6), "elder", "fall"]],
  },
  {
    id: "nap", name: "Sofa nap (decoy)", when: "13:10 →",
    desc: "After lunch she dozes off in front of the TV. Long stillness — but it should NOT look like a fall.",
    start: H(13, 10), speed: 10,
    steps: [...NIGHT, ...MORNING, ...LUNCH, [H(13, 15), "sofa", "sit"], [H(13, 16), "tv", "on"], [H(13, 24), "sofa", "doze"], [H(14, 40), "sofa", "wake"]],
  },
  {
    id: "kettle", name: "Kettle boiling dry", when: "12:55 →",
    desc: "Water runs out and nobody refills — the pot switches from keep-warm pulses to constant 700 W.",
    start: H(12, 55), speed: 10, heat: -2,
    init: (s) => { s.dev.kettle.water = 1000; },
    steps: [...NIGHT, ...MORNING, ...LUNCH.filter((x) => x[1] !== "kettle"), [H(13, 0), "kettle", "drink"], [H(13, 6), "kettle", "drink"], [H(13, 12), "kettle", "drink"], [H(13, 18), "kettle", "drink"], [H(13, 22), "kettle", "drink"], [H(13, 26), "sofa", "sit"], [H(13, 27), "tv", "on"]],
  },
  {
    id: "heat", name: "Hot day, A/C off", when: "11:55 →",
    desc: "36°C outside. She switches the A/C off to save money and sits in front of the TV.",
    start: H(11, 55), speed: 10, heat: 5,
    steps: [...NIGHT, ...MORNING.filter((x) => x[0] < H(9, 20)), [H(6, 52), "ac", "on"], [H(9, 20), "tv", "off"], [H(10, 0), "toilet", "flush"], [H(12, 0), "ac", "off"], [H(12, 4), "sofa", "sit"], [H(12, 5), "tv", "on"]],
  },
  {
    id: "free", name: "Free play", when: "06:30 →",
    desc: "Grandma just woke up. Click the floor / appliances or use arrow keys to drive her day.",
    start: H(6, 30), speed: 10, steps: [...NIGHT],
  },
];

export function loadScenario(sc: Scenario): Sim {
  const s = new Sim();
  s.scenario = sc;
  s.heat = sc.heat ?? 0;
  sc.init?.(s);
  const steps = sc.steps.slice().sort((a, b) => a[0] - b[0]);
  s.instant = true;
  s.script = { steps, i: 0 };
  // pre-roll: run the day up to the scenario start instantly
  while (s.t < sc.start) s.tick();
  s.instant = false;
  s.walk = null;
  s.speed = sc.speed;
  return s;
}
