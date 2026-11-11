import OpenAI from "openai";
import { SYSTEM_PROMPT } from "@/lib/context";
import { InferenceSchema, extractJson, normalize } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL = process.env.LLM_BASE_URL || "https://api.gmi-serving.com/v1";
const API_KEY = process.env.LLM_API_KEY || "";
const MODEL = process.env.LLM_MODEL || "";

export async function GET() {
  return Response.json({ configured: !!(API_KEY && MODEL), model: MODEL || null });
}

export async function POST(req: Request) {
  if (!API_KEY || !MODEL) return Response.json({ error: "LLM not configured" }, { status: 503 });
  const body = (await req.json()) as { user: string; validIds: number[] };
  if (typeof body?.user !== "string" || body.user.length > 60000) return Response.json({ error: "bad request" }, { status: 400 });
  const valid = new Set(body.validIds ?? []);
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY, timeout: 20000, maxRetries: 0 });
  const t0 = Date.now();
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 1400,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: body.user + (attempt ? "\n\nYour previous answer was not valid JSON. Reply with ONLY the JSON object." : "") },
        ],
      });
      const text = res.choices[0]?.message?.content ?? "";
      const parsed = InferenceSchema.parse(extractJson(text));
      return Response.json({ inference: normalize(parsed, valid), model: MODEL, latencyMs: Date.now() - t0 });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (Date.now() - t0 > 15000) break;
    }
  }
  return Response.json({ error: lastErr.slice(0, 300) }, { status: 502 });
}
