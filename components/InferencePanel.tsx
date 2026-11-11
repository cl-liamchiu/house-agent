"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { MODELS, findModel } from "@/lib/models";
import { useStore } from "@/lib/store";
import { CAT_COLOR, type AlertLevel, hm } from "@/lib/types";

const ALERT_STYLE: Record<AlertLevel, string> = {
  normal: "bg-emerald-900/60 text-emerald-200 border-emerald-700",
  watch: "bg-yellow-900/60 text-yellow-200 border-yellow-700",
  notify_family: "bg-orange-900/70 text-orange-100 border-orange-600",
  urgent: "bg-red-700 text-white border-red-400 animate-pulse",
};

export default function InferencePanel() {
  const records = useStore((s) => s.records);
  const inflight = useStore((s) => s.inflight);
  const nextAt = useStore((s) => s.nextAt);
  const note = useStore((s) => s.note);
  const infer = useStore((s) => s.infer);
  const setHighlight = useStore((s) => s.setHighlight);
  const lastPrompt = useStore((s) => s.lastPrompt);
  const model = useStore((s) => s.model);
  const effort = useStore((s) => s.effort);
  const setModel = useStore((s) => s.setModel);
  const setEffort = useStore((s) => s.setEffort);
  const llm = useStore((s) => s.llmConfigured);
  const [now, setNow] = useState(() => Date.now());
  const [showPrompt, setShowPrompt] = useState(false);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(i); }, []);

  const cur = records[records.length - 1];
  const n = records.length;
  const top1 = records.filter((r) => r.hit1).length, top3 = records.filter((r) => r.hit3).length;
  const byModel = new Map<string, { n: number; h1: number; ms: number }>();
  for (const r of records) {
    const k = r.source === "llm" ? r.model ?? "llm" : "fallback (rules)";
    const v = byModel.get(k) ?? { n: 0, h1: 0, ms: 0 };
    v.n++; v.h1 += r.hit1 ? 1 : 0; v.ms += r.latencyMs;
    byModel.set(k, v);
  }
  const secs = Math.max(0, Math.ceil((nextAt - now) / 1000));

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button onClick={() => infer()} disabled={inflight}
          className="rounded bg-amber-500 px-2.5 py-1 font-semibold text-black hover:bg-amber-400 disabled:opacity-50">
          {inflight ? "Inferring…" : "Infer now"}
        </button>
        <span className="text-zinc-400">{inflight ? "waiting for model" : `next in ${secs}s`}</span>
        {cur && (
          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${cur.source === "llm" ? "bg-sky-600 text-white" : "bg-zinc-700 text-zinc-200"}`}>
            {cur.source === "llm" ? `LLM · ${cur.model} · ${(cur.latencyMs / 1000).toFixed(1)}s` : "Fallback (rules)"}
          </span>
        )}
        {n > 0 && (
          <span className="ml-auto font-mono text-[11px] text-zinc-300" title="vs. simulator ground truth">
            top-1 {Math.round((top1 / n) * 100)}% · top-3 {Math.round((top3 / n) * 100)}% <span className="text-zinc-500">(n={n})</span>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-zinc-500">Model on GMI Cloud</span>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={llm === false}
          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-zinc-100 disabled:opacity-50">
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.note}</option>)}
        </select>
        <span className="text-zinc-500">reasoning</span>
        <select value={effort} onChange={(e) => setEffort(e.target.value)} disabled={llm === false}
          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-zinc-100 disabled:opacity-50">
          {(findModel(model)?.efforts ?? []).map((x) => <option key={x} value={x}>{x === "default" ? "model default" : x}</option>)}
        </select>
      </div>
      {note && <div className="text-[10px] text-zinc-500">{note}</div>}

      {cur ? (
        <>
          <div className={`rounded-lg border px-3 py-2 text-sm ${ALERT_STYLE[cur.alert_level]}`}>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider opacity-80">
              <span>📱 Push to daughter · {cur.alert_level.replace("_", " ")}</span>
              <span>{hm(cur.t)} · in {cur.location}</span>
            </div>
            <div className="mt-0.5 font-medium">{cur.family_message}</div>
          </div>
          <div className="text-[10px] text-zinc-500">What is happening right now? (hover to see evidence in the log)</div>
          <div className="flex flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {cur.hypotheses.map((h, i) => {
                const key = h.category + "|" + cur.hypotheses.slice(0, i).filter((x) => x.category === h.category).length;
                const isGt = h.category === cur.gt;
                return (
                  <motion.div key={key} layout transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                    onMouseEnter={() => setHighlight(h.evidence.map((e) => e.log_id))}
                    onMouseLeave={() => setHighlight([])}
                    className="group cursor-default rounded-lg border border-zinc-800 bg-zinc-900/80 p-2 hover:border-amber-400">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 font-mono text-xs text-zinc-500">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded px-1 text-[10px] font-mono text-black" style={{ background: CAT_COLOR[h.category] }}>{h.category}</span>
                          {isGt && (
                            <span className="text-[10px] font-semibold text-emerald-400" title="matches simulator ground truth">
                              ✓ {i === 0 ? "top-1 hit" : i < 3 ? "top-3 hit" : "truth"}
                            </span>
                          )}
                          <span className="ml-auto font-mono text-sm font-bold text-zinc-100">{h.score}</span>
                        </div>
                        <div className="mt-0.5 text-[13px] leading-snug text-zinc-100">{h.label}</div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-zinc-800">
                          <motion.div className="h-full rounded" style={{ background: CAT_COLOR[h.category] }}
                            initial={{ width: 0 }} animate={{ width: `${h.score}%` }} transition={{ duration: 0.6 }} />
                        </div>
                        {h.evidence.length > 0 && (
                          <div className="mt-1 hidden text-[10px] leading-tight text-zinc-400 group-hover:block">
                            {h.evidence.map((e) => <div key={e.log_id}><span className="font-mono text-amber-300">#{e.log_id}</span> {e.why}</div>)}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
          {cur.reasoning_summary && <div className="text-[11px] italic text-zinc-400">{cur.reasoning_summary}</div>}
          <div className="text-[10px] text-zinc-500">
            Ground truth now (simulator only, hidden from model): <span style={{ color: CAT_COLOR[cur.gt] }}>{cur.gt}</span>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-700 p-6 text-center text-sm text-zinc-500">
          First inference in {secs}s…
        </div>
      )}

      <div className="mt-auto">
        <div className="mb-1 text-[10px] text-zinc-500">Inference history (#1 every 30 s · ✓ = matched ground truth)</div>
        <div className="flex flex-wrap gap-0.5">
          {records.map((r) => (
            <div key={r.n} title={`${hm(r.t)} [${r.source === "llm" ? r.model : "fallback"}] ${r.hypotheses[0].category}: ${r.hypotheses[0].label} (truth: ${r.gt})`}
              className="flex h-5 w-5 items-center justify-center rounded-sm text-[9px] font-bold text-black"
              style={{ background: CAT_COLOR[r.hypotheses[0].category], outline: r.alert_level === "urgent" ? "2px solid #ef4444" : undefined }}>
              {r.hit1 ? "✓" : r.hit3 ? "·" : ""}
            </div>
          ))}
        </div>
        {byModel.size > 1 && (
          <table className="mt-1.5 w-full font-mono text-[10px] text-zinc-400">
            <tbody>
              {[...byModel].map(([k, v]) => (
                <tr key={k}><td className="truncate pr-2">{k.replace(/^.*\//, "")}</td><td>n={v.n}</td><td>top-1 {Math.round((v.h1 / v.n) * 100)}%</td><td>{(v.ms / v.n / 1000).toFixed(1)}s</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {lastPrompt && (
          <button className="mt-1 text-[10px] text-zinc-500 underline hover:text-zinc-300" onClick={() => setShowPrompt((v) => !v)}>
            {showPrompt ? "hide" : "show"} the exact prompt sent to the model
          </button>
        )}
        {showPrompt && (
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-black/70 p-2 text-[10px] text-zinc-300">{lastPrompt}</pre>
        )}
      </div>
    </div>
  );
}
