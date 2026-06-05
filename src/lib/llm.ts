/**
 * Minimal OpenAI-compatible chat client — the only LLM dependency in yt-briefing.
 *
 * Provider-agnostic: point LLM_BASE_URL at any OpenAI-compatible endpoint —
 * OpenRouter (default, "any model, one key"), Google Gemini's OpenAI-compat
 * endpoint, OpenAI itself, a local Ollama, etc. The tool depends only on an API key
 * here — not on any specific vendor and not on a coding agent being installed.
 *
 * One model does both stages (title classification + summaries). Gemini 2.5 Flash is
 * the default — cheap and fast enough for the batch title filter, capable enough for
 * the summaries.
 *
 * Env (see .env.example):
 *   LLM_BASE_URL   default https://openrouter.ai/api/v1
 *   LLM_API_KEY    required
 *   LLM_MODEL      default google/gemini-2.5-flash
 */

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

export function getModel(): string {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

export interface ChatOptions {
  model?: string;       // overrides LLM_MODEL
  system?: string;      // optional system prompt
  temperature?: number; // default 0.3
}

export async function chat(prompt: string, opts: ChatOptions = {}): Promise<string> {
  const baseUrl = (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY not set (see .env.example)");
  const model = opts.model || getModel();

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-Title": "yt-briefing",
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error(`LLM: no content in response: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return text.trim();
}
