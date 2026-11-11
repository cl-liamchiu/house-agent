export const CATEGORIES = [
  "sleeping",
  "resting",
  "toileting",
  "bathing",
  "cooking",
  "eating",
  "taking_meds",
  "watching_tv",
  "moving_around",
  "out_of_home",
  "visitor_present",
  "possible_fall",
  "safety_hazard",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const ALERT_LEVELS = ["normal", "watch", "notify_family", "urgent"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

export type Area = "bedroom" | "bathroom" | "kitchen" | "living" | "entry" | "house";
export type SensorType = "pir" | "door" | "power" | "weight" | "temp" | "pressure" | "sound" | "meter";

/** One raw sensor reading. No interpretation, ever. */
export interface LogEntry {
  id: number;
  t: number; // simulated seconds since day 0, 00:00:00
  sensor: string;
  area: Area;
  type: SensorType;
  value: string;
}

export interface Evidence {
  log_id: number;
  why: string;
}

export interface Hypothesis {
  label: string;
  category: Category;
  score: number;
  evidence: Evidence[];
}

export interface Inference {
  hypotheses: Hypothesis[];
  location: string;
  alert_level: AlertLevel;
  family_message: string;
  reasoning_summary: string;
}

export interface InferenceRecord extends Inference {
  n: number;
  t: number; // sim time the context was cut at
  source: "llm" | "fallback";
  model?: string;
  latencyMs: number;
  gt: Category;
  hit1: boolean;
  hit3: boolean;
  note?: string;
}

export const CAT_COLOR: Record<Category, string> = {
  sleeping: "#6366f1",
  resting: "#8b5cf6",
  toileting: "#0ea5e9",
  bathing: "#06b6d4",
  cooking: "#f59e0b",
  eating: "#eab308",
  taking_meds: "#10b981",
  watching_tv: "#3b82f6",
  moving_around: "#64748b",
  out_of_home: "#a3a3a3",
  visitor_present: "#ec4899",
  possible_fall: "#ef4444",
  safety_hazard: "#f97316",
  other: "#94a3b8",
};

export const TYPE_COLOR: Record<SensorType, string> = {
  pir: "#a78bfa",
  door: "#38bdf8",
  power: "#fbbf24",
  weight: "#34d399",
  temp: "#f87171",
  pressure: "#f472b6",
  sound: "#22d3ee",
  meter: "#94a3b8",
};

const pad = (n: number) => String(n).padStart(2, "0");
export const hms = (t: number) => {
  const s = ((Math.floor(t) % 86400) + 86400) % 86400;
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
export const hm = (t: number) => hms(t).slice(0, 5);
