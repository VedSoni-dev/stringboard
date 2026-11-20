// The studio kit's server entry. Every build calls AI through here, whichever mode the person picked:
//
//   import { streamText } from "@/kit/ai";
//   export async function POST(req: Request) {
//     const { messages } = await req.json();
//     return streamText(req, { system: "…", messages, tier: "balanced" });
//   }
//
// Server only: never import this from a "use client" file (the client half is kit/react).
import { cookies } from "next/headers";
import config from "@/studio.config";
import { ALL_MODES, MODE_COPY, PUBLIK_FREE_BLURB, type AIRequest, type Mode, type ModeStatus, type StudioErrorBody, type StudioStatus } from "./types";
import { cookieOpts, isHosted, StudioError, YEAR, type Jar } from "./seal";
import { claudeKey, claudeStatus, claudeStream } from "./claude";
import { openaiKey, openaiStatus, openaiStream } from "./openai";
import { chatgptModels, chatgptStatus, chatgptStream } from "./chatgpt";
import { localStatus, localStream } from "./local";
import * as publik from "./publik";
import { beacon } from "./beacon";

export type { AIRequest, Mode, StudioStatus } from "./types";
export { StudioError } from "./seal";

const MODE_COOKIE = "studio-mode";
const MODEL_COOKIE = (m: Mode) => `studio-${m}-model`;

export const enabledModes = (): Mode[] => config.modes.filter((m) => ALL_MODES.includes(m));
const LOCAL_ONLY: Mode[] = ["local", "chatgpt"];
// Vedant, 2026-11-13: "get rid of sign in with chatgpt if it doesnt work in domain". OpenAI keeps ChatGPT-plan use to
// open-source apps run locally (hosted apps: interest form; website sign-in: select partners only), so the hosted
// picker leaves it out entirely; the OpenAI API key mode covers OpenAI there. A local run still offers it.
const shownModes = (): Mode[] => enabledModes().filter((m) => !(isHosted() && m === "chatgpt"));

export function runLocallyCommand(): string {
  return `git clone ${config.app.repo}.git && cd ${config.app.slug} && npm install && npm run dev`;
}

export function readMode(jar: Jar): Mode | null {
  const v = jar.get(MODE_COOKIE)?.value as Mode | undefined;
  return v && enabledModes().includes(v) ? v : null;
}
export function writeMode(jar: Jar, req: Request, mode: Mode | null): void {
  if (mode && !enabledModes().includes(mode)) throw new StudioError(400, `This app doesn't offer ${mode}.`);
  if (mode && isHosted() && LOCAL_ONLY.includes(mode)) throw new StudioError(409, `${MODE_COPY[mode].label} works when the app runs on your computer.`);
  if (mode) jar.set(MODE_COOKIE, mode, cookieOpts(req, YEAR)); else jar.delete(MODE_COOKIE);
}
export const readModel = (jar: Jar, m: Mode) => jar.get(MODEL_COOKIE(m))?.value || undefined;
export function writeModel(jar: Jar, req: Request, m: Mode, model: string | null): void {
  if (model) jar.set(MODEL_COOKIE(m), model.slice(0, 200), cookieOpts(req, YEAR)); else jar.delete(MODEL_COOKIE(m));
}

async function statusOf(m: Mode, jar: Jar, req: Request): Promise<ModeStatus> {
  const base = { id: m, ...MODE_COPY[m] };
  if (isHosted() && LOCAL_ONLY.includes(m)) {
    return { ...base, available: false, ready: false,
      reason: m === "chatgpt" ? "ChatGPT plan sign-in works when the app runs on your computer." : "Local models run on your own computer. Run the app locally to use one." };
  }
  try {
    switch (m) {
      case "claude": return { ...base, available: true, ...claudeStatus(jar) };
      case "openai": return { ...base, available: true, ...(await openaiStatus(jar, readModel(jar, "openai") ?? config.openai?.model)) };
      case "local": {
        const s = await localStatus(readModel(jar, "local") ?? config.local?.model);
        return { ...base, available: true, ready: s.ready, detail: s.detail, models: s.models, model: s.model };
      }
      case "chatgpt": {
        const s = await chatgptStatus(config.app.slug);
        let models: { id: string; label: string }[] | undefined;
        if (s.ready) { try { models = await chatgptModels(config.app.slug); } catch { /* shown on first call */ } }
        const chosen = readModel(jar, "chatgpt") ?? config.chatgpt?.model;
        return { ...base, available: true, ready: s.ready, detail: s.detail, extra: s.extra, models,
          model: models?.some((x) => x.id === chosen) ? chosen : models?.[0]?.id };
      }
      case "publik": {
        const g = await publik.gateStatus(jar, req, { provision: false });
        const ready = g.state === "ready" && g.choice === "publik";
        const who = g.state === "ready" ? (g.handle ? `Signed in as @${g.handle}` : "Signed in to publik") : null;
        const free = g.state === "ready" ? g.free : null;
        return { ...base, available: true, ready,
          ...(publik.freeOn() ? { blurb: PUBLIK_FREE_BLURB } : {}),
          detail: who ? (free ? `${who} · ${free.left} of ${free.perDay} free answers left today` : who) : g.state === "pending" ? "Coming soon to publik" : undefined,
          extra: { gate: g } };
      }
    }
  } catch (e) {
    return { ...base, available: true, ready: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Everything the mode picker needs for this browser. */
export async function studioStatus(req: Request, jar?: Jar): Promise<StudioStatus> {
  const j = jar ?? (await cookies());
  const modes = await Promise.all(shownModes().map((m) => statusOf(m, j, req)));
  const mode = readMode(j);
  const active = pickActive(mode, modes);
  return { app: config.app, hosted: isHosted(), mode, active, modes, runLocally: runLocallyCommand() };
}

function pickActive(mode: Mode | null, modes: ModeStatus[]): Mode | null {
  const usable = (m?: Mode | null) => (m ? modes.find((x) => x.id === m && x.available && x.ready)?.id ?? null : null);
  return usable(mode) ?? (mode ? null : usable(config.defaultMode) ?? modes.find((x) => x.available && x.ready)?.id ?? null);
}

/** Text chunks from whichever mode this browser is using. Throws StudioError with a message the UI can show. */
export async function* generate(req: Request, ai: AIRequest, jar?: Jar): AsyncGenerator<string> {
  const j = jar ?? (await cookies());
  const signal = req.signal;
  // Same answer as the pill: the picked mode, else the one status calls active (the default only when it's ready),
  // else the default so its own "add your key" message shows.
  const mode = readMode(j) ?? (await studioStatus(req, j)).active ?? config.defaultMode ?? null;
  if (!mode) throw new StudioError(401, "Pick how to power the AI first.", undefined);
  if (isHosted() && LOCAL_ONLY.includes(mode)) throw new StudioError(409, `${MODE_COPY[mode].label} works when the app runs on your computer.`);
  // Count the answer with the hub only once it actually starts (a missing key or a 402 isn't an answer).
  let counted = false;
  for await (const chunk of answer(mode, j, req, ai, signal)) {
    if (!counted) { counted = true; beacon(j, req, "ai_call", { mode, publik: mode === "publik" }); }
    yield chunk;
  }
}

async function* answer(mode: Mode, j: Jar, req: Request, ai: AIRequest, signal: AbortSignal): AsyncGenerator<string> {
  switch (mode) {
    case "claude": {
      const key = claudeKey(j);
      if (!key) throw new StudioError(401, "Add your Claude API key first.");
      yield* claudeStream(key, ai, config.claude?.model, signal);
      return;
    }
    case "openai": {
      const key = openaiKey(j);
      if (!key) throw new StudioError(401, "Add your OpenAI API key first.");
      yield* openaiStream(key, ai, readModel(j, "openai") ?? config.openai?.model, signal);
      return;
    }
    case "chatgpt": yield* chatgptStream(config.app.slug, ai, readModel(j, "chatgpt") ?? config.chatgpt?.model, signal); return;
    case "local": yield* localStream(ai, readModel(j, "local") ?? config.local?.model, signal); return;
    // Free answers (the builder's grant) when PUBLIK_SPONSOR_KEY is set; else this browser's own publik plan.
    case "publik": yield* publik.publikAnswer(j, req, ai, signal); return;
  }
}

/** The whole answer as one string. */
export async function generateText(req: Request, ai: AIRequest, jar?: Jar): Promise<string> {
  let out = "";
  for await (const chunk of generate(req, ai, jar)) out += chunk;
  return out;
}

/** First JSON value in a model's answer (tolerates code fences and a sentence around it). */
export function parseJSON<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const start = fenced.search(/[[{]/);
  if (start === -1) throw new Error("The model didn't return JSON.");
  const open = fenced[start]!, close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < fenced.length; i++) {
    const c = fenced[i]!;
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(fenced.slice(start, i + 1)) as T;
  }
  throw new Error("The model's JSON was cut off.");
}

export function errorResponse(e: unknown): Response {
  if (e instanceof StudioError) {
    const body: StudioErrorBody = { error: e.message, ...(e.action ? { action: e.action } : {}) };
    return Response.json(body, { status: e.status });
  }
  if ((e as { name?: string })?.name === "AbortError") return new Response(null, { status: 499 });
  process.stderr.write(`studio: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  return Response.json({ error: "Something went wrong. Try again." } satisfies StudioErrorBody, { status: 500 });
}

/**
 * A streaming text response. Errors before the first chunk become a JSON error with the right status (so the UI can
 * show "add your key" or "top up"); errors after it end the stream with a line starting "\n\n⚠ ".
 */
export async function streamText(req: Request, ai: AIRequest): Promise<Response> {
  const jar = await cookies();
  const it = generate(req, ai, jar);
  let first: IteratorResult<string>;
  try { first = await it.next(); } catch (e) { return errorResponse(e); }
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) { if (!first.done && first.value) controller.enqueue(enc.encode(first.value)); if (first.done) controller.close(); },
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close(); else controller.enqueue(enc.encode(value));
      } catch (e) {
        controller.enqueue(enc.encode(`\n\n⚠ ${e instanceof Error ? e.message : "The answer stopped."}`));
        controller.close();
      }
    },
    cancel() { void it.return?.(undefined); },
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-studio-stream": "1" } });
}
