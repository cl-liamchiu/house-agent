"use client";
import { useEffect, useState } from "react";
import { DECOR, DEV, type DevId, H, MAP, W, cellArea, walkable, AREA_NAME } from "@/lib/house";
import { useStore } from "@/lib/store";
import type { Area } from "@/lib/types";

const C = 40;
const ROOM_FILL: Record<string, string> = {
  bedroom: "#1e1b4b", bathroom: "#083344", kitchen: "#422006", living: "#0f2a1f", entry: "#27272a",
};
const LABEL_POS: Record<string, [number, number]> = {
  bedroom: [1, 3.6], bathroom: [7.2, 3.6], kitchen: [11.1, 3.6], living: [5.2, 9.6], entry: [12.1, 9.6],
};

export default function House() {
  const sim = useStore((s) => s.sim);
  useStore((s) => s.frame);
  const [sel, setSel] = useState<DevId | null>(null);
  const e = sim.elder;
  const takeover = () => {
    if (sim.script) {
      sim.script = null;
      useStore.setState({ note: "You took over — the scenario script stopped." });
    }
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const d = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, number[]>)[ev.key];
      if (!d || (ev.target as HTMLElement)?.tagName === "INPUT") return;
      ev.preventDefault();
      const s = useStore.getState().sim;
      if (!s.home || s.elder.posture === "fallen") return;
      if (s.script) { s.script = null; useStore.setState({ note: "You took over — the scenario script stopped." }); }
      if (s.elder.posture === "lying") s.perform("bed", "getup");
      if (s.elder.posture === "sitting" || s.elder.posture === "dozing") s.elder.posture = "stand";
      const nx = s.elder.x + d[0], ny = s.elder.y + d[1];
      if (walkable(nx, ny)) {
        s.walk = null;
        s.elder.x = nx; s.elder.y = ny;
        s.pirTrigger(cellArea(nx, ny));
        s.version++;
        useStore.getState().bump();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clickCell = (x: number, y: number) => {
    setSel(null);
    if (!walkable(x, y)) return;
    takeover();
    sim.goTo([x, y]);
  };
  const ex = e.posture === "lying" ? 1.5 : e.x, ey = e.posture === "lying" ? 1.5 : e.y;
  const elderEmoji = { lying: "😴", stand: "👵", sitting: "👵", dozing: "😪", fallen: "🆘", away: "" }[e.posture];
  const here = (Object.keys(DEV) as DevId[]).filter((k) => DEV[k].spot[0] === e.x && DEV[k].spot[1] === e.y);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <svg viewBox={`0 0 ${W * C} ${H * C}`} className="w-full h-auto select-none rounded-lg bg-zinc-950">
          {MAP.map((row, y) =>
            [...row].map((ch, x) => {
              const a = cellArea(x, y);
              if (ch === "#") return <rect key={`${x}-${y}`} x={x * C} y={y * C} width={C} height={C} fill="#3f3f46" />;
              return (
                <rect key={`${x}-${y}`} x={x * C} y={y * C} width={C} height={C}
                  fill={ch === "d" ? "#78350f" : ROOM_FILL[a as string] ?? "#18181b"}
                  stroke="#ffffff08" onClick={() => clickCell(x, y)} className="cursor-pointer hover:brightness-150" />
              );
            }),
          )}
          {Object.entries(LABEL_POS).map(([a, [x, y]]) => (
            <text key={a} x={x * C} y={y * C} fill="#ffffff55" fontSize={13} fontWeight={600}>{AREA_NAME[a as Area]}</text>
          ))}
          {/* PIR sensors light up when ON */}
          {(Object.keys(LABEL_POS) as Area[]).map((a) => {
            const [x, y] = LABEL_POS[a];
            return <circle key={a} cx={x * C - 8} cy={y * C - 4} r={5} fill={sim.pir[a]?.on ? "#a78bfa" : "#3f3f46"} />;
          })}
          {DECOR.map(([x, y]) => <rect key={`d${x}`} x={x * C + 4} y={y * C + 4} width={C - 8} height={C - 8} rx={4} fill="#52525b" />)}
          {(Object.keys(DEV) as DevId[]).map((k) => {
            const d = DEV[k];
            const xs = d.cells.map((c) => c[0]), ys = d.cells.map((c) => c[1]);
            const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
            const active = (k === "stove" && sim.dev.stove.temp > 80) || (k === "rice" && sim.dev.rice.mode !== "off") ||
              (k === "tv" && sim.dev.tv.on) || (k === "ac" && sim.dev.ac.on) || (k === "fridge" && sim.dev.fridge.open) ||
              (k === "kettle" && sim.dev.kettle.w >= 500);
            return (
              <g key={k} className="cursor-pointer" onClick={(ev) => { ev.stopPropagation(); setSel(sel === k ? null : k); }}>
                <rect x={x0 * C + 2} y={y0 * C + 2} width={w * C - 4} height={h * C - 4} rx={6}
                  fill={active ? (k === "stove" || k === "kettle" ? "#7c2d12" : "#1e3a8a") : "#27272a"}
                  stroke={sel === k ? "#fbbf24" : active ? "#fb923c" : "#52525b"} strokeWidth={sel === k ? 3 : 1.5} />
                <text x={(x0 + w / 2) * C} y={(y0 + h / 2) * C + 7} textAnchor="middle" fontSize={20}>{d.icon}</text>
              </g>
            );
          })}
          {e.posture !== "away" && (
            <g style={{ transition: "transform 120ms linear" }} transform={`translate(${ex * C + C / 2} ${ey * C + C / 2})`}>
              <circle r={17} fill={e.posture === "fallen" ? "#dc2626" : "#f5f5f4"} stroke="#fbbf24" strokeWidth={2} />
              <text y={7} textAnchor="middle" fontSize={20}>{elderEmoji}</text>
            </g>
          )}
        </svg>
        {sel && (
          <div className="absolute left-2 top-2 z-10 w-56 rounded-lg border border-amber-400/60 bg-zinc-900/95 p-2 text-xs shadow-xl">
            <div className="mb-1 flex items-center justify-between font-semibold text-zinc-100">
              <span>{DEV[sel].icon} {DEV[sel].name}</span>
              <button className="text-zinc-400 hover:text-white" onClick={() => setSel(null)}>✕</button>
            </div>
            {DEV[sel].hw && <div className="mb-1.5 text-[10px] text-zinc-400">sensor: {DEV[sel].hw}</div>}
            <div className="flex flex-col gap-1">
              {sim.actionsFor(sel).map(([act, label]) => (
                <button key={act} className="rounded bg-zinc-800 px-2 py-1 text-left hover:bg-amber-500 hover:text-black"
                  onClick={() => { takeover(); sim.doAt(sel, act); setSel(null); }}>{label}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-zinc-400">
          {e.posture === "away" ? "Grandma is out" : `Grandma: ${e.posture}${sim.walk ? " (walking)" : ""}`}
        </span>
        {here.flatMap((k) => sim.actionsFor(k).map(([act, label]) => (
          <button key={k + act} className="rounded bg-zinc-800 px-2 py-0.5 hover:bg-amber-500 hover:text-black"
            onClick={() => { takeover(); sim.doAt(k, act); }}>{DEV[k].icon} {label}</button>
        )))}
        {e.posture === "away" && (
          <button className="rounded bg-zinc-800 px-2 py-0.5 hover:bg-amber-500 hover:text-black" onClick={() => { takeover(); sim.doAt("door", "in"); }}>🚪 Come home</button>
        )}
        {e.posture !== "away" && e.posture !== "fallen" && (
          <button className="ml-auto rounded bg-red-900/70 px-2 py-0.5 text-red-100 hover:bg-red-600" onClick={() => { takeover(); sim.perform("elder", "fall"); }}>Simulate fall</button>
        )}
        {e.posture === "fallen" && (
          <button className="ml-auto rounded bg-zinc-800 px-2 py-0.5 hover:bg-amber-500 hover:text-black" onClick={() => { takeover(); sim.perform("elder", "rise"); }}>Get back up</button>
        )}
      </div>
    </div>
  );
}
