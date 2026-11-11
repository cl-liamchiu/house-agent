"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { type SensorType, TYPE_COLOR, hms } from "@/lib/types";

const FILTERS: { key: SensorType[]; label: string }[] = [
  { key: ["pir"], label: "PIR" },
  { key: ["door"], label: "Door" },
  { key: ["power", "meter"], label: "Power" },
  { key: ["weight", "pressure"], label: "Weight" },
  { key: ["temp"], label: "Temp" },
  { key: ["sound"], label: "Sound" },
];
const SHOW = 500;

export default function LogPanel() {
  const sim = useStore((s) => s.sim);
  useStore((s) => s.frame);
  const highlight = useStore((s) => s.highlight);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const lastId = sim.logs.length ? sim.logs[sim.logs.length - 1].id : 0;

  const rows = useMemo(() => {
    const hl = highlight;
    const out = [];
    for (let i = sim.logs.length - 1; i >= 0 && out.length < SHOW; i--) {
      const l = sim.logs[i];
      if (off.has(l.type) && !hl.has(l.id)) continue;
      out.push(l);
    }
    return out.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, lastId, off, highlight]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (highlight.size) {
      const first = el.querySelector("[data-hl='1']");
      if (first) { first.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    }
    if (!hover) el.scrollTop = el.scrollHeight;
  }, [lastId, hover, highlight]);

  const toggle = (keys: SensorType[]) =>
    setOff((o) => { const n = new Set(o); const all = keys.every((k) => n.has(k)); keys.forEach((k) => (all ? n.delete(k) : n.add(k))); return n; });
  const missing = [...highlight].filter((id) => !rows.some((r) => r.id === id)).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => {
          const on = !f.key.every((k) => off.has(k));
          return (
            <button key={f.label} onClick={() => toggle(f.key)}
              className={`rounded px-1.5 py-0.5 text-[11px] font-mono border ${on ? "border-transparent text-black" : "border-zinc-700 text-zinc-500"}`}
              style={on ? { background: TYPE_COLOR[f.key[0]] } : undefined}>{f.label}</button>
          );
        })}
        <span className="ml-auto text-[11px] text-zinc-500">{hover ? "⏸ paused (hover)" : `${sim.logs.length} rows`}</span>
      </div>
      <div ref={box} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg bg-black/60 p-1.5 font-mono text-[11px] leading-[1.45]">
        {rows.map((l) => {
          const hl = highlight.has(l.id);
          return (
            <div key={l.id} data-hl={hl ? "1" : undefined}
              className={`log-row flex gap-2 whitespace-nowrap rounded px-1 ${hl ? "bg-amber-400/25 ring-1 ring-amber-400" : ""}`}>
              <span className="text-zinc-600">#{l.id}</span>
              <span className="text-zinc-400">{hms(l.t)}</span>
              <span className="w-[13.5rem] shrink-0 truncate" style={{ color: TYPE_COLOR[l.type] }}>{l.sensor}</span>
              <span className="truncate text-zinc-200">{l.value}</span>
            </div>
          );
        })}
        {missing > 0 && <div className="px-1 text-amber-400">+{missing} evidence rows scrolled out of view</div>}
      </div>
      <p className="mt-1 text-[10px] text-zinc-500">Raw readings only — no interpretation. Interpretation is the model&apos;s job →</p>
    </div>
  );
}
