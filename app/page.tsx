"use client";
import { useEffect } from "react";
import House from "@/components/House";
import InferencePanel from "@/components/InferencePanel";
import LogPanel from "@/components/LogPanel";
import { SCENARIOS } from "@/lib/sim";
import { useStore } from "@/lib/store";
import { hms } from "@/lib/types";

const WALK_MS = 140;

function useLoop() {
  useEffect(() => {
    let raf = 0, last = performance.now(), acc = 0, walkAcc = 0, lastPaint = 0;
    fetch("/api/infer").then((r) => r.json()).then((j) => useStore.setState({ llmConfigured: !!j.configured })).catch(() => useStore.setState({ llmConfigured: false }));
    const frame = (now: number) => {
      const st = useStore.getState();
      const sim = st.sim;
      const dt = Math.min(250, now - last);
      last = now;
      if (!sim.paused) {
        acc += (dt / 1000) * sim.speed;
        let n = 0;
        while (acc >= 1 && n < 120) { acc -= 1; sim.tick(); n++; }
        // at low speeds, also walk in real time so manual control feels responsive
        walkAcc += dt;
        while (walkAcc >= WALK_MS) { walkAcc -= WALK_MS; if (sim.walk && sim.speed < 10) sim.stepWalk(); }
        if (Date.now() >= st.nextAt && !st.inflight) st.infer();
      }
      if (now - lastPaint > 66) { lastPaint = now; st.bump(); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
}

export default function Page() {
  useLoop();
  const sim = useStore((s) => s.sim);
  useStore((s) => s.frame);
  const scenarioId = useStore((s) => s.scenarioId);
  const setScenario = useStore((s) => s.setScenario);
  const setSpeed = useStore((s) => s.setSpeed);
  const note = useStore((s) => s.note);
  const llm = useStore((s) => s.llmConfigured);
  const sc = SCENARIOS.find((s) => s.id === scenarioId)!;

  return (
    <main className="flex min-h-screen flex-col gap-2 p-2 lg:h-screen lg:overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <h1 className="text-lg font-bold leading-tight">House Agent <span className="text-zinc-500 font-normal text-sm">— Existing products detect. We explain.</span></h1>
          <p className="text-[11px] text-zinc-400">No cameras, no wearables: an LLM reads the home&apos;s passive signals and tells the family what is happening.</p>
        </div>
        <div className="flex items-center gap-2 font-mono">
          <span className="text-2xl tabular-nums">{hms(sim.t)}</span>
          <div className="flex overflow-hidden rounded border border-zinc-700 text-xs">
            {[0, 1, 10, 60].map((v) => {
              const on = v === 0 ? sim.paused : !sim.paused && sim.speed === v;
              return (
                <button key={v} onClick={() => setSpeed(v)} className={`px-2 py-1 ${on ? "bg-amber-500 text-black" : "hover:bg-zinc-800"}`}>
                  {v === 0 ? (sim.paused ? "▶" : "⏸") : `${v}×`}
                </button>
              );
            })}
          </div>
        </div>
        <span className={`rounded px-2 py-0.5 text-[11px] ${llm ? "bg-sky-700" : "bg-zinc-700"}`}>
          {llm == null ? "…" : llm ? "LLM: GMI Cloud" : "LLM: not configured → Fallback"}
        </span>
      </header>

      <nav className="flex flex-wrap gap-1">
        {SCENARIOS.map((s) => (
          <button key={s.id} onClick={() => setScenario(s)} title={s.desc}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${s.id === scenarioId ? "border-amber-400 bg-amber-400 text-black" : "border-zinc-700 hover:border-zinc-400"}`}>
            {s.name} <span className="opacity-60">{s.when}</span>
          </button>
        ))}
      </nav>
      <p className="text-[11px] text-zinc-400">{note || sc.desc}</p>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <section className="panel">
          <h2 className="panel-title">① Simulated home <span>click floor / appliances · arrow keys</span></h2>
          <House />
        </section>
        <section className="panel h-[60vh] lg:h-auto">
          <h2 className="panel-title">② Raw sensor log <span>streaming</span></h2>
          <LogPanel />
        </section>
        <section className="panel lg:overflow-y-auto">
          <h2 className="panel-title">③ LLM inference <span>every 30 s · top 5</span></h2>
          <InferencePanel />
        </section>
      </div>
    </main>
  );
}
