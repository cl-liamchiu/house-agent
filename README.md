# House Agent — passive home sensing that *explains*

> **Existing products detect. We explain.**
> Built at cOmpiled-18 (YC Startup School Hackathon, Taipei) for YC RFS *AI for the Aging Population*. LLM inference on **GMI Cloud**.

## Problem

Taiwan is a super-aged society and more elders live alone. Cameras feel like surveillance; wearables get left on the nightstand.
Yet the home already knows what is going on: the rice cooker, the hot-water pot, the fridge door, the mattress.
Rule-based "no motion for 15 min → alarm" systems drown families in false alarms: in real data from a senior living alone
(CASAS hh101, 60 days) there are on average **5.8 daytime gaps ≥15 min with no motion per day** while the person is fine.

## What the demo shows

| ① Simulated home | ② Raw sensor log | ③ LLM inference |
|---|---|---|
| Drive Grandma around (click floor / appliances, arrow keys) or play a scenario | Every raw reading streams in, with a stable `#id`. No interpretation. | Every 30 s the model reads the log + today's summary + 14-day personal baseline + memory and returns **5 ranked hypotheses with scores and cited evidence** |

- Hover a hypothesis → the log rows it cites light up (explainability).
- Alert level + the push message the daughter would get.
- History timeline + **top-1 / top-3 accuracy vs. the simulator's ground truth** (the model never sees ground truth).
- Scenarios: ordinary morning, stove left on, night-time fall, sofa nap (decoy: long stillness that is *not* a fall), kettle boiling dry, hot day with A/C off, free play.
- Badge shows **LLM** vs **Fallback (rules)** honestly. Without a key / network the rule-based fallback keeps the demo running.

## Architecture

```
Browser (Next.js client)                                   Server (Next.js route)
┌───────────────────────────────┐                         ┌────────────────────────────┐
│ Sim (1 tick = 1 sim second)   │                         │ POST /api/infer            │
│  elder + appliances + physics │──raw LogEntry──┐        │  openai SDK → GMI Cloud    │
│  noisy PIR ON/OFF             │                ▼        │  (OpenAI-compatible)       │
│ Log panel ◄── zustand store ──┤ buildContext():         │  zod-validate JSON         │
│ Inference panel               │  • last 45 min of log   │  retry once, normalize     │
└───────────────────────────────┘    (PIR → 1 line/min)   │  5 hyps, scores sum 100    │
                                   • today summary vs.    └─────────────┬──────────────┘
                                     14-day baseline (computed by code) │ fail / no key
                                   • tag-retrieved past days + profile  ▼
                                   • earlier inferences   rule-based fallback (client)
```

Stack: Next.js (App Router) + TypeScript, Tailwind, `motion`, `zustand`, `openai` SDK (base URL → GMI Cloud), `zod`.

## Run

```bash
npm install
cp .env.example .env.local   # fill LLM_API_KEY and LLM_MODEL (GMI Cloud); leave empty for fallback mode
npm run dev                  # http://localhost:3000
```

| Env | Meaning |
|---|---|
| `LLM_BASE_URL` | GMI Cloud OpenAI-compatible endpoint (default `https://api.gmi-serving.com/v1`) |
| `LLM_API_KEY` | GMI Cloud API key (server-side only) |
| `LLM_MODEL` | model id on GMI Cloud — we use `google/gemini-3.8-flash` (~6–8 s per round) |
| `LLM_REASONING_EFFORT` | `low` (default). Full thinking takes 12–18 s on every model we tried; `off` for models that reject the parameter |

## Sensor assumptions (and the hardware each needs)

| Signal | Hardware |
|---|---|
| `<room>.pir` ON/OFF | PIR motion sensor per room (movement only; a still person is invisible) |
| `kitchen.fridge.door`, `entry.front_door` | door contact sensors |
| `bedroom.bed.pressure` | mattress pressure pad |
| `*.power` (fridge, kettle, rice cooker, TV, A/C), `meter.snapshot` | circuit-level power metering / smart plugs |
| `kitchen.stove.temp` | heat sensor above the gas stove (gas has no power signal) |
| `living.temp` | room thermometer |
| `kitchen.kettle.weight`, `bedroom.pillbox.weight`, `entry.key_hook.weight` | load cells / smart scale base (quantities need this hardware) |
| `bathroom.toilet.flush` | acoustic flush sensor |

PIR noise follows real data: ~100 triggers/hour while sitting watching TV, occasional triggers while asleep, none while lying still after a fall.

## Data sources / references

- **CASAS hh101** (WSU, Zenodo record 15708568): a senior living alone, 60 days, ~3,700 PIR/door events per day. Used for the noise model and the false-alarm base rate (5.8 / 2.4 / 1.0 daytime no-motion gaps per day of ≥15 / 30 / 60 min).
- **UCI "ADLs Recognition Using Binary Sensors"** (Ordóñez): binary sensors incl. flush, mattress pressure, fridge door. Non-commercial license; used only for design reference.
- The 14-day history and the resident profile are **synthetic**.

## Honest limitations

- Everything runs on a simulator; no real hardware is connected in this demo.
- Accuracy shown is against the simulator's ground truth for the scenarios played, not a clinical validation.
- No medical diagnosis; the model is instructed not to make one.
