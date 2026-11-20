// Mode "openrouter": the person's own OpenRouter key (sealed http-only cookie, like "claude" and "openai"), for the
// open-weight Chinese frontier models: DeepSeek, Qwen, Kimi, GLM, MiniMax, Tencent Hunyuan. Cheap (DeepSeek V4.1 Flash
// was $0.30 / M input tokens on 2026-11-20) and good at structured JSON. Works on the hosted site. The key goes to this
// server only to be forwarded to OpenRouter; never stored server-side, never logged. Chat Completions over fetch.
import config from "@/studio.config";
import type { AIRequest } from "./types";
import { cookieOpts, isHosted, seal, StudioError, unseal, YEAR, type Jar } from "./seal";
import { readSSE } from "./sse";

const COOKIE = "studio-openrouter";
const PURPOSE = "openrouter-key";
const API = "https://openrouter.ai/api/v1";
const KEYS_URL = "https://openrouter.ai/settings/keys";
const CREDITS_URL = "https://openrouter.ai/settings/credits";

const LABS: Record<string, string> = { deepseek: "DeepSeek", qwen: "Qwen", moonshotai: "Kimi", "z-ai": "GLM", minimax: "MiniMax", tencent: "Hunyuan" };
/** Not for chat: batch-only, vision/omni/translation/legal/preview variants and dated snapshots. */
const SKIP = /(:batch|:free|vision|omni|-mt\d|legal|preview|-exp\b|-\d{4}$|-\d{3,4}-\d{2}-\d{2}$)/;
const looksLikeKey = (k: string) => /^sk-or-[A-Za-z0-9_-]{20,}$/.test(k);

export function openrouterKey(jar: Jar): string | null {
  const k = unseal<{ k: string }>(PURPOSE, jar.get(COOKIE)?.value)?.k;
  if (k) return k;
  if (!isHosted() && process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  return null;
}

// ---------- models: OpenRouter's public list (no key needed), the Chinese labs only, newest first ----------
interface ORModel { id: string; name?: string; created?: number; pricing?: { prompt?: string } }
const g = globalThis as unknown as { __studioORModels?: { at: number; list: { id: string; label: string }[] } };

export async function openrouterModels(): Promise<{ id: string; label: string }[]> {
  if (g.__studioORModels && Date.now() - g.__studioORModels.at < 30 * 60_000) return g.__studioORModels.list;
  const res = await fetch(`${API}/models`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok) throw new StudioError(502, "Couldn't load OpenRouter's model list. Try again.");
  const data = ((await res.json()) as { data?: ORModel[] }).data ?? [];
  const list = data
    .filter((m) => LABS[m.id.split("/")[0]!] && !SKIP.test(m.id))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .slice(0, 30)
    .map((m) => {
      const per = Number(m.pricing?.prompt ?? NaN) * 1e6;
      return { id: m.id, label: `${LABS[m.id.split("/")[0]!]} · ${m.id.split("/")[1]}${isFinite(per) ? ` · $${per < 0.1 ? per.toFixed(3) : per.toFixed(2)}/M in` : ""}` };
    });
  // Default first: the newest DeepSeek Flash (fast, cheap, reliable JSON); the rest newest first.
  const best = list.findIndex((m) => /^deepseek\/deepseek-v[\d.]+-flash$/.test(m.id));
  if (best > 0) list.unshift(...list.splice(best, 1));
  g.__studioORModels = { at: Date.now(), list };
  return list;
}

export async function openrouterStatus(jar: Jar, chosen?: string) {
  const fromCookie = unseal<{ k: string }>(PURPOSE, jar.get(COOKIE)?.value)?.k;
  const k = openrouterKey(jar);
  if (!k) return { ready: false };
  let models: { id: string; label: string }[] | undefined;
  try { models = await openrouterModels(); } catch { /* shown on the first call */ }
  return {
    ready: true,
    detail: fromCookie ? `Key ending …${fromCookie.slice(-4)}` : "Using OPENROUTER_API_KEY from this computer",
    models,
    model: models?.some((m) => m.id === chosen) ? chosen : models?.[0]?.id,
  };
}

/** Checks the key with one free call (GET /key) before saving it. */
export async function saveOpenRouterKey(jar: Jar, req: Request, raw: string): Promise<void> {
  const key = raw.trim();
  if (key.startsWith("sk-ant-")) throw new StudioError(400, "That's an Anthropic key. Paste it under Claude API key instead.");
  if (!looksLikeKey(key)) throw new StudioError(400, "That doesn't look like an OpenRouter key. It starts with sk-or-.");
  let res: Response | null = null;
  try { res = await fetch(`${API}/key`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" }); }
  catch { /* offline: save anyway; the first real call will say if it's wrong */ }
  if (res && !res.ok) throw await apiError(res);
  jar.set(COOKIE, seal(PURPOSE, { k: key }), cookieOpts(req, YEAR));
}

export function forgetOpenRouterKey(jar: Jar): void { jar.delete(COOKIE); }

async function apiError(res: Response): Promise<StudioError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: number | string; message?: string } };
  return mapError(res.status, body.error?.message);
}
function mapError(status: number, message?: string): StudioError {
  if (status === 401) return new StudioError(401, "OpenRouter rejected your key. Copy it again from OpenRouter.", { label: "Open API keys", url: KEYS_URL });
  if (status === 402) return new StudioError(402, "Your OpenRouter account is out of credits.", { label: "Add credits", url: CREDITS_URL });
  if (status === 429) return new StudioError(429, "OpenRouter is rate-limiting this model. Wait a moment, or pick another model.");
  if (status === 403) return new StudioError(403, "OpenRouter blocked this request (moderation or a key limit).");
  if (status === 404) return new StudioError(404, "That model isn't on OpenRouter any more. Pick another one.");
  return new StudioError(status && status < 500 ? status : 502, message ?? `OpenRouter answered ${status}.`);
}

export async function* openrouterStream(key: string, req: AIRequest, model?: string, signal?: AbortSignal): AsyncGenerator<string> {
  const chosen = model || (await openrouterModels())[0]?.id;
  if (!chosen) throw new StudioError(409, "No OpenRouter models are available right now.");
  const system = [req.system, req.json ? "Answer with one JSON value only: no prose, no code fence." : ""].filter(Boolean).join("\n\n");
  let res: Response;
  try {
    res = await fetch(`${API}/chat/completions`, {
      method: "POST", cache: "no-store", signal,
      headers: {
        authorization: `Bearer ${key}`, "content-type": "application/json", accept: "text/event-stream",
        // OpenRouter's app attribution: the app's public name and URL, nothing about the person
        "HTTP-Referer": config.app.url, "X-Title": config.app.name,
      },
      body: JSON.stringify({
        model: chosen, stream: true,
        messages: [...(system ? [{ role: "system", content: system }] : []), ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
        reasoning: { effort: req.tier === "smart" ? "high" : req.tier === "fast" ? "low" : "medium", exclude: true },
      }),
    });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw e;
    throw new StudioError(502, "Couldn't reach OpenRouter. Check your connection.");
  }
  if (!res.ok || !res.body) throw await apiError(res);
  let done = false;
  for await (const ev of readSSE(res.body)) {
    if (ev.data === "[DONE]") { done = true; break; }
    let j: { choices?: { delta?: { content?: string }; finish_reason?: string | null }[]; error?: { code?: number; message?: string } };
    try { j = JSON.parse(ev.data); } catch { continue; } // ": OPENROUTER PROCESSING" keep-alives
    if (j.error) throw mapError(Number(j.error.code) || 502, j.error.message);
    const c = j.choices?.[0];
    if (typeof c?.delta?.content === "string" && c.delta.content) yield c.delta.content;
    if (c?.finish_reason) done = true;
  }
  if (!done) throw new StudioError(502, "The answer stopped before it finished. Try again.");
}
