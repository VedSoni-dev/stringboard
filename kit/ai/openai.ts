// Mode "openai": the person's own OpenAI API key, kept in a sealed http-only cookie on their browser (same as "claude").
// Works on the hosted site, unlike "chatgpt": OpenAI keeps ChatGPT-plan use to open-source apps run locally and gives
// website sign-in only to select partners (developers.openai.com/siwc, checked 2026-11-13). The key goes to this server
// only to be forwarded to OpenAI, is never stored server-side, never logged. Responses API over fetch, no extra package.
import { createHash } from "node:crypto";
import type { AIRequest } from "./types";
import { cookieOpts, isHosted, seal, StudioError, unseal, YEAR, type Jar } from "./seal";
import { readSSE } from "./sse";

const COOKIE = "studio-openai";
const PURPOSE = "openai-key";
const API = "https://api.openai.com/v1";
const KEYS_URL = "https://platform.openai.com/api-keys";
const BILLING_URL = "https://platform.openai.com/settings/organization/billing";

const looksLikeKey = (k: string) => /^sk-[A-Za-z0-9_-]{20,}$/.test(k) && !k.startsWith("sk-ant-");

/** The key for this request: the browser's sealed cookie, else OPENAI_API_KEY when the app runs on the person's own machine. */
export function openaiKey(jar: Jar): string | null {
  const k = unseal<{ k: string }>(PURPOSE, jar.get(COOKIE)?.value)?.k;
  if (k) return k;
  if (!isHosted() && process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  return null;
}

// ---------- models: the account's own list, newest full model first ----------
const g = globalThis as unknown as { __studioOpenAIModels?: Map<string, { at: number; list: { id: string; label: string }[] }> };
const NOT_CHAT = /(audio|realtime|tts|transcribe|whisper|image|dall-e|embedding|moderation|search|instruct|codex|computer-use|davinci|babbage|-\d{4}-\d{2}-\d{2}$|-\d{4}$)/;
const VARIANT_RANK = (id: string) => (/-mini\b/.test(id) ? 1 : /-nano\b/.test(id) ? 2 : /-pro\b/.test(id) ? 3 : /-chat-latest$/.test(id) ? 4 : 0);
const VERSION = (id: string) => Number(id.match(/^gpt-(\d+(?:\.\d+)?)/)?.[1] ?? id.match(/^o(\d+)/)?.[1] ?? 0);

export async function openaiModels(key: string): Promise<{ id: string; label: string }[]> {
  const cache = (g.__studioOpenAIModels ??= new Map());
  const tag = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const hit = cache.get(tag);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.list;
  const res = await fetch(`${API}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok) throw await apiError(res);
  const body = (await res.json()) as { data?: { id: string }[] };
  const list = (body.data ?? []).map((m) => m.id)
    .filter((id) => /^(gpt-|o\d)/.test(id) && !NOT_CHAT.test(id))
    .sort((a, b) => VERSION(b) - VERSION(a) || VARIANT_RANK(a) - VARIANT_RANK(b) || a.localeCompare(b))
    .map((id) => ({ id, label: id }));
  cache.set(tag, { at: Date.now(), list });
  return list;
}

export async function openaiStatus(jar: Jar, chosen?: string) {
  const fromCookie = unseal<{ k: string }>(PURPOSE, jar.get(COOKIE)?.value)?.k;
  const k = openaiKey(jar);
  if (!k) return { ready: false };
  let models: { id: string; label: string }[] | undefined;
  try { models = await openaiModels(k); } catch { /* shown on the first call */ }
  return {
    ready: true,
    detail: fromCookie ? `Key ending …${fromCookie.slice(-4)}` : "Using OPENAI_API_KEY from this computer",
    models,
    model: models?.some((m) => m.id === chosen) ? chosen : models?.[0]?.id,
  };
}

/** Checks the key with one free call (list models) before saving it. */
export async function saveOpenAIKey(jar: Jar, req: Request, raw: string): Promise<void> {
  const key = raw.trim();
  if (key.startsWith("sk-ant-")) throw new StudioError(400, "That's an Anthropic key. Paste it under Claude API key instead.");
  if (!looksLikeKey(key)) throw new StudioError(400, "That doesn't look like an OpenAI key. It starts with sk-.");
  try {
    g.__studioOpenAIModels?.clear();
    await openaiModels(key);
  } catch (e) {
    if (e instanceof StudioError) throw e;
    // Offline: save anyway; the first real call will say if it's wrong.
  }
  jar.set(COOKIE, seal(PURPOSE, { k: key }), cookieOpts(req, YEAR));
}

export function forgetOpenAIKey(jar: Jar): void { jar.delete(COOKIE); }

async function apiError(res: Response): Promise<StudioError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; type?: string; message?: string } };
  return mapError(res.status, body.error?.code ?? body.error?.type, body.error?.message);
}
function mapError(status: number, code?: string, message?: string): StudioError {
  if (status === 401) return new StudioError(401, "OpenAI rejected your key. Copy it again from the OpenAI dashboard.", { label: "Open API keys", url: KEYS_URL });
  if (code === "insufficient_quota") return new StudioError(402, "Your OpenAI account is out of credits.", { label: "Add credits", url: BILLING_URL });
  if (status === 429) return new StudioError(429, "OpenAI is rate-limiting your key. Wait a moment and try again.");
  if (status === 403) return new StudioError(403, "Your OpenAI key can't use this model or project.");
  if (status === 404 || code === "model_not_found") return new StudioError(404, "That OpenAI model isn't available for your key. Pick another one.");
  return new StudioError(status && status < 500 ? status : 502, message ?? `OpenAI answered ${status}.`);
}

export async function* openaiStream(key: string, req: AIRequest, model?: string, signal?: AbortSignal): AsyncGenerator<string> {
  const chosen = model || (await openaiModels(key))[0]?.id;
  if (!chosen) throw new StudioError(409, "No OpenAI chat models are available for this key.");
  const instructions = [req.system, req.json ? "Answer with one JSON value only: no prose, no code fence." : ""].filter(Boolean).join("\n\n");
  let res: Response;
  try {
    res = await fetch(`${API}/responses`, {
      method: "POST", cache: "no-store", signal,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        model: chosen, store: false, stream: true,
        ...(instructions ? { instructions } : {}),
        input: req.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw e;
    throw new StudioError(502, "Couldn't reach OpenAI. Check your connection.");
  }
  if (!res.ok || !res.body) throw await apiError(res);
  let completed = false;
  for await (const ev of readSSE(res.body)) {
    let j: { type?: string; delta?: string; response?: { error?: { code?: string; message?: string } }; error?: { code?: string; message?: string }; code?: string; message?: string };
    try { j = JSON.parse(ev.data); } catch { continue; }
    const type = j.type ?? ev.event;
    if (type === "response.output_text.delta" && typeof j.delta === "string") yield j.delta;
    else if (type === "response.completed") completed = true;
    else if (type === "response.failed") throw mapError(502, j.response?.error?.code, j.response?.error?.message);
    else if (type === "response.incomplete") throw new StudioError(502, "OpenAI stopped before finishing. Try again.");
    else if (type === "error") throw mapError(502, j.error?.code ?? j.code, j.error?.message ?? j.message);
  }
  if (!completed) throw new StudioError(502, "The answer stopped before it finished. Try again.");
}
