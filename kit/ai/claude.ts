// Mode "claude": the person's own Anthropic API key, kept in a sealed http-only cookie on their browser.
// The key goes to this server only to be forwarded to Anthropic, is never stored server-side, never logged.
import Anthropic from "@anthropic-ai/sdk";
import type { AIRequest, Tier } from "./types";
import { cookieOpts, seal, StudioError, unseal, YEAR, type Jar } from "./seal";

const COOKIE = "studio-claude";
const PURPOSE = "claude-key";
/** Anthropic's default model. Tiers change effort, not the model (cheaper per finished task than switching models). */
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";
const EFFORT: Record<Tier, "low" | "medium" | "high"> = { fast: "low", balanced: "medium", smart: "high" };

const looksLikeKey = (k: string) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k);

/** The key for this request: the browser's sealed cookie, else ANTHROPIC_API_KEY when the app runs on the person's own machine. */
export function claudeKey(jar: Jar): string | null {
  const k = unseal<{ k: string }>(PURPOSE, jar.get(COOKIE)?.value)?.k;
  if (k) return k;
  if (!process.env.VERCEL && process.env.STUDIO_HOSTED !== "1" && process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  return null;
}

export function claudeStatus(jar: Jar) {
  const fromCookie = unseal<{ k: string }>(PURPOSE, jar.get(COOKIE)?.value)?.k;
  const k = claudeKey(jar);
  return {
    ready: !!k,
    detail: fromCookie ? `Key ending …${fromCookie.slice(-4)}` : k ? "Using ANTHROPIC_API_KEY from this computer" : undefined,
  };
}

/** Checks the key with one free call (list models) before saving it. */
export async function saveClaudeKey(jar: Jar, req: Request, raw: string): Promise<void> {
  const key = raw.trim();
  if (!looksLikeKey(key)) throw new StudioError(400, "That doesn't look like an Anthropic key. It starts with sk-ant-.");
  try {
    await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15_000 }).models.list({ limit: 1 });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new StudioError(401, "Anthropic rejected that key. Copy it again from the Console.", { label: "Open Anthropic Console", url: "https://console.anthropic.com/settings/keys" });
    if (e instanceof Anthropic.PermissionDeniedError) throw new StudioError(403, "That key can't use the API. Check its workspace permissions.");
    if (!(e instanceof Anthropic.APIConnectionError)) throw e;
    // Offline: save anyway; the first real call will say if it's wrong.
  }
  jar.set(COOKIE, seal(PURPOSE, { k: key }), cookieOpts(req, YEAR));
}

export function forgetClaudeKey(jar: Jar): void { jar.delete(COOKIE); }

function jsonNote(req: AIRequest) {
  return req.json ? "\n\nAnswer with one JSON value only: no prose, no code fence." : "";
}

export async function* claudeStream(apiKey: string, req: AIRequest, model = DEFAULT_CLAUDE_MODEL, signal?: AbortSignal): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const params = {
    model,
    max_tokens: 64_000,
    // A policy decline is re-run on a fallback model inside the same call, so the person still gets an answer.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: EFFORT[req.tier ?? "balanced"] },
    ...(req.system || req.json ? { system: (req.system ?? "") + jsonNote(req) } : {}),
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  let stream;
  try {
    // `fallbacks: "default"` is newer than some SDK typings; the request shape is per the API docs.
    stream = client.beta.messages.stream(params as unknown as Parameters<typeof client.beta.messages.stream>[0], { signal });
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") throw new StudioError(422, "Claude declined this request. Try rephrasing it.");
  } catch (e) {
    throw mapClaudeError(e);
  }
}

function mapClaudeError(e: unknown): unknown {
  if (e instanceof StudioError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new StudioError(401, "Your Claude key was rejected. Paste it again in settings.");
  if (e instanceof Anthropic.PermissionDeniedError) return new StudioError(403, "Your Claude key can't use this model.");
  if (e instanceof Anthropic.RateLimitError) return new StudioError(429, "Claude is rate-limiting your key. Wait a moment and try again.");
  if (e instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(e.message))
    return new StudioError(402, "Your Anthropic account is out of credits.", { label: "Add credits", url: "https://console.anthropic.com/settings/billing" });
  if (e instanceof Anthropic.APIConnectionError) return new StudioError(502, "Couldn't reach Anthropic. Check your connection.");
  if (e instanceof Anthropic.APIError) return new StudioError(e.status && e.status < 500 ? e.status : 502, e.message);
  return e;
}
