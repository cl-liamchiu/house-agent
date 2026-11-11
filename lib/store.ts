"use client";
import { create } from "zustand";
import { buildContext } from "./context";
import { mockInfer } from "./mock";
import { SCENARIOS, type Scenario, Sim, loadScenario } from "./sim";
import type { InferenceRecord } from "./types";

export const INFER_EVERY_MS = 30000;

interface State {
  sim: Sim;
  frame: number; // bumps on every render-worthy change
  scenarioId: string;
  records: InferenceRecord[];
  inflight: boolean;
  nextAt: number;
  highlight: Set<number>;
  groups: Record<number, number[]>;
  lastPrompt: string;
  llmConfigured: boolean | null;
  note: string;
  setScenario: (sc: Scenario) => void;
  setSpeed: (v: number) => void;
  bump: () => void;
  setHighlight: (ids: number[]) => void;
  infer: () => Promise<void>;
}

export const useStore = create<State>((set, get) => ({
  sim: loadScenario(SCENARIOS[0]),
  frame: 0,
  scenarioId: SCENARIOS[0].id,
  records: [],
  inflight: false,
  nextAt: Date.now() + 4000,
  highlight: new Set(),
  groups: {},
  lastPrompt: "",
  llmConfigured: null,
  note: "",
  setScenario: (sc) =>
    set({ sim: loadScenario(sc), scenarioId: sc.id, records: [], highlight: new Set(), groups: {}, nextAt: Date.now() + 3000, note: "", inflight: false }),
  setSpeed: (v) => {
    const s = get().sim;
    if (v === 0) s.paused = !s.paused;
    else { s.paused = false; s.speed = v; }
    set((st) => ({ frame: st.frame + 1 }));
  },
  bump: () => set((st) => ({ frame: st.frame + 1 })),
  setHighlight: (ids) => {
    const g = get().groups;
    const out = new Set<number>();
    ids.forEach((id) => (g[id] ?? [id]).forEach((x) => out.add(x)));
    set({ highlight: out });
  },
  infer: async () => {
    const st = get();
    if (st.inflight) return; // never overlap requests
    const sim = st.sim;
    const ctx = buildContext(sim, st.records);
    const gt = sim.groundTruth();
    const t = sim.t;
    set({ inflight: true, lastPrompt: ctx.user, groups: { ...st.groups, ...ctx.groups } });
    const t0 = performance.now();
    let rec: Omit<InferenceRecord, "n" | "hit1" | "hit3"> | null = null;
    let note = "";
    if (st.llmConfigured !== false) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 22000);
        const r = await fetch("/api/infer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user: ctx.user, validIds: ctx.validIds }),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        const j = await r.json();
        if (r.ok && j.inference) {
          rec = { ...j.inference, t, gt, source: "llm", model: j.model, latencyMs: j.latencyMs ?? Math.round(performance.now() - t0) };
        } else {
          note = r.status === 503 ? "No API key — using rule-based fallback" : `LLM error: ${j.error ?? r.status} — fallback used`;
          if (r.status === 503) set({ llmConfigured: false });
        }
      } catch (e) {
        note = `LLM unreachable (${e instanceof Error ? e.name : "error"}) — fallback used`;
      }
    } else note = "No API key — using rule-based fallback";
    if (!rec) {
      const m = mockInfer(ctx.feats, ctx.groups);
      rec = { ...m, t, gt, source: "fallback", latencyMs: Math.round(performance.now() - t0) };
    }
    if (get().sim !== sim) { set({ inflight: false }); return; } // scenario changed meanwhile
    const cats = rec.hypotheses.map((h) => h.category);
    const full: InferenceRecord = { ...rec, n: get().records.length + 1, hit1: cats[0] === gt, hit3: cats.slice(0, 3).includes(gt), note };
    set((s) => ({ records: [...s.records, full], inflight: false, note, nextAt: Date.now() + INFER_EVERY_MS }));
  },
}));
