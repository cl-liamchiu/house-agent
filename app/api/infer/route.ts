import OpenAI from "openai";
import { SYSTEM_PROMPT } from "@/lib/context";
import { DEFAULT_MODEL, findModel } from "@/lib/models";
import { InferenceSchema, extractJson, normalize } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // LLM call + one retry can exceed short serverless defaults

const BASE_URL = process.env.LLM_BASE_URL || "https://api.gmi-serving.com/v1";
const API_KEY = process.env.LLM_API_KEY || "";

export async function GET() {
  return Response.json({ configured: !!API_KEY });
}

export async function POST(req: Request) {
  if (!API_KEY) return Response.json({ error: "LLM not configured" }, { status: 503 });
  const body = (await req.json()) as { user: string; validIds: number[]; model?: string; effort?: string };
  if (typeof body?.user !== "string" || body.user.length > 60000) return Response.json({ error: "bad request" }, { status: 400 });
  // only allow-listed models, so a public deployment can't be used to run arbitrary (expensive) models on our key
  const opt = findModel(body.model ?? DEFAULT_MODEL);
  if (!opt) return Response.json({ error: "model not allowed" }, { status: 400 });
  const MODEL = opt.id;
  let EFFORT = body.effort && opt.efforts.includes(body.effort) ? body.effort : opt.efforts[0];
  const valid = new Set(body.validIds ?? []);
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY, timeout: 26000, maxRetries: 0 });
  const t0 = Date.now();
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 2500,
        ...(EFFORT !== "default" ? { reasoning_effort: EFFORT as "low" } : {}),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: body.user + (attempt ? "\n\nYour previous answer was not valid JSON. Reply with ONLY the JSON object." : "") },
        ],
      });
      const text = res.choices[0]?.message?.content ?? "";
      const parsed = InferenceSchema.parse(extractJson(text));
      return Response.json({ inference: normalize(parsed, valid), model: MODEL, effort: EFFORT, latencyMs: Date.now() - t0 });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      // some backends reject the reasoning_effort value: retry without it
      if (/reasoning|thinking/i.test(lastErr) && EFFORT !== "default") EFFORT = "default";
      if (Date.now() - t0 > 12000) break;
    }
  }
  return Response.json({ error: lastErr.slice(0, 300) }, { status: 502 });
}
