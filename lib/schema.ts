import { z } from "zod";
import { ALERT_LEVELS, CATEGORIES, type Category, type Inference } from "./types";

const Cat = z.string().transform((s) => {
  const c = s.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ((CATEGORIES as readonly string[]).includes(c) ? c : "other") as Category;
});

export const InferenceSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        label: z.string().min(1),
        category: Cat,
        score: z.coerce.number().catch(0),
        evidence: z
          .array(z.object({ log_id: z.coerce.number(), why: z.string().catch("") }))
          .catch([]),
      }),
    )
    .min(1),
  location: z.string().catch("unknown"),
  alert_level: z.string().transform((s) => {
    const a = s.trim().toLowerCase().replace(/[\s-]+/g, "_");
    return ((ALERT_LEVELS as readonly string[]).includes(a) ? a : "watch") as Inference["alert_level"];
  }),
  family_message: z.string().catch(""),
  reasoning_summary: z.string().catch(""),
});

const FILLER: Partial<Record<Category, string>> = {
  other: "Something not covered by the other hypotheses",
  moving_around: "Grandma is moving around the home",
  resting: "Grandma is resting quietly",
  sleeping: "Grandma is asleep",
  watching_tv: "Grandma is watching TV",
  out_of_home: "Grandma is out of the home",
};

/** exactly 5, distinct categories where possible, scores sum to 100, evidence restricted to known ids */
export function normalize(inf: Inference, validIds?: Set<number>): Inference {
  let hyps = inf.hypotheses.slice(0, 5).map((h) => ({
    ...h,
    score: Math.max(0, Number.isFinite(h.score) ? h.score : 0),
    evidence: (h.evidence || []).filter((e) => !validIds || validIds.has(e.log_id)).slice(0, 4),
  }));
  for (const c of Object.keys(FILLER) as Category[]) {
    if (hyps.length >= 5) break;
    if (!hyps.some((h) => h.category === c)) hyps.push({ label: FILLER[c]!, category: c, score: 1, evidence: [] });
  }
  const sum = hyps.reduce((a, h) => a + h.score, 0) || 1;
  hyps = hyps.map((h) => ({ ...h, score: Math.round((h.score / sum) * 100) }));
  hyps.sort((a, b) => b.score - a.score);
  const diff = 100 - hyps.reduce((a, h) => a + h.score, 0);
  hyps[0].score += diff;
  return { ...inf, hypotheses: hyps };
}

export function extractJson(text: string): unknown {
  const s = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no JSON object in model output");
  return JSON.parse(s.slice(a, b + 1));
}
