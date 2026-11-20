// Every auth/mode endpoint a build needs, in one file. The app mounts it once:
//   app/api/studio/[...path]/route.ts  ->  export { GET, POST, DELETE } from "@/kit/routes";
//
//   GET    /api/studio/status                 the picker's state for this browser
//   GET    /api/studio/publik/gate            this browser's place in Sign in with publik (kit/react/gate.tsx reads it)
//   POST   /api/studio/mode        {mode}     pick a mode (null: ask again)
//   POST   /api/studio/model       {mode, model}
//   POST   /api/studio/claude/key  {key}      check + save the Claude key (sealed cookie); DELETE forgets it
//   POST   /api/studio/openai/key  {key}      check + save the OpenAI key (sealed cookie); DELETE forgets it
//   POST   /api/studio/chatgpt/start          -> {url} to open; the app polls status until signed in
//   POST   /api/studio/chatgpt/signout
//   POST   /api/studio/publik/provision       publik install for this browser (DELETE: forget it)
//   POST   /api/studio/publik/choice {choice} "publik" | "own_key" | null
//   POST   /api/studio/publik/telemetry {event}
//   POST   /api/studio/ping {event}       "app_opened" | "active_session": the hub beacon + publik usage counting
import { cookies } from "next/headers";
import config from "@/studio.config";
import { errorResponse, studioStatus, writeMode, writeModel, enabledModes } from "./ai";
import { forgetClaudeKey, saveClaudeKey } from "./ai/claude";
import { forgetOpenAIKey, saveOpenAIKey } from "./ai/openai";
import { chatgptSignOut, startChatGPTSignIn } from "./ai/chatgpt";
import * as publik from "./ai/publik";
import { isHosted, StudioError } from "./ai/seal";
import { beacon } from "./ai/beacon";
import type { Mode } from "./ai/types";

// The route file sets runtime = "nodejs" and dynamic = "force-dynamic" itself (Next reads them statically).

type Ctx = { params: Promise<{ path?: string[] }> };
const route = async (ctx: Ctx) => ((await ctx.params).path ?? []).join("/");

/** State-changing calls must come from this app's own pages (JSON body + same origin). */
function sameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) throw new StudioError(403, "Cross-site request refused.");
  if (req.method === "POST" && !(req.headers.get("content-type") ?? "").includes("application/json")) throw new StudioError(415, "Send JSON.");
}
async function body<T>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const r = await route(ctx);
    if (r === "status") return Response.json(await studioStatus(req), { headers: { "cache-control": "no-store" } });
    if (r === "publik/gate") return Response.json(await publik.gateStatus(await cookies(), req, { provision: false }), { headers: { "cache-control": "no-store" } });
    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  try {
    sameOrigin(req);
    const r = await route(ctx);
    const jar = await cookies();
    switch (r) {
      case "mode": {
        const { mode } = await body<{ mode: Mode | null }>(req);
        writeMode(jar, req, mode ?? null);
        return Response.json(await studioStatus(req, jar));
      }
      case "model": {
        const { mode, model } = await body<{ mode: Mode; model: string | null }>(req);
        if (!enabledModes().includes(mode)) throw new StudioError(400, "Unknown mode.");
        writeModel(jar, req, mode, model);
        return Response.json(await studioStatus(req, jar));
      }
      case "claude/key": {
        const { key } = await body<{ key?: string }>(req);
        await saveClaudeKey(jar, req, key ?? "");
        writeMode(jar, req, "claude");
        return Response.json(await studioStatus(req, jar));
      }
      case "openai/key": {
        if (!enabledModes().includes("openai")) throw new StudioError(400, "This app doesn't offer OpenAI keys.");
        const { key } = await body<{ key?: string }>(req);
        await saveOpenAIKey(jar, req, key ?? "");
        writeMode(jar, req, "openai");
        return Response.json(await studioStatus(req, jar));
      }
      case "chatgpt/start": {
        if (isHosted()) throw new StudioError(409, "ChatGPT plan sign-in works when the app runs on your computer.");
        if (!enabledModes().includes("chatgpt")) throw new StudioError(400, "This app doesn't offer ChatGPT sign-in.");
        const url = await startChatGPTSignIn(config.app.slug, config.app.name);
        writeMode(jar, req, "chatgpt");
        return Response.json({ url }, { headers: { "cache-control": "no-store" } });
      }
      case "chatgpt/signout": return Response.json(await chatgptSignOut(config.app.slug));
      case "publik/provision": {
        const g = await publik.gateStatus(jar, req, { provision: true });
        return Response.json(g);
      }
      case "publik/choice": {
        const { choice } = await body<{ choice: publik.Choice | null }>(req);
        publik.setChoice(jar, req, choice === "publik" || choice === "own_key" ? choice : null);
        if (choice === "publik") writeMode(jar, req, "publik");
        return Response.json(await studioStatus(req, jar));
      }
      case "publik/telemetry": {
        const { event } = await body<{ event: publik.UsageEvent }>(req);
        return Response.json(await publik.sendUsage(jar, req, event));
      }
      case "ping": {
        const { event } = await body<{ event: "app_opened" | "active_session" }>(req);
        if (event !== "app_opened" && event !== "active_session") throw new StudioError(400, "Unknown event.");
        // "Signed in with publik" means the gate got past sign-in (claimed), not merely that an install exists.
        let signedIn = false;
        if (enabledModes().includes("publik") && publik.readCredential(jar)) {
          try { const g = await publik.gateStatus(jar, req, { provision: false }); signedIn = g.state === "ready" || g.state === "choose"; } catch { /* publik down: not counted as signed in */ }
        }
        beacon(jar, req, event, { publik: signedIn });
        const usage = signedIn ? await publik.sendUsage(jar, req, event) : { sent: false, reason: "no_install" };
        return Response.json({ ok: true, publik: usage });
      }
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) { return errorResponse(e); }
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  try {
    sameOrigin(req);
    const r = await route(ctx);
    const jar = await cookies();
    if (r === "claude/key") { forgetClaudeKey(jar); return Response.json(await studioStatus(req, jar)); }
    if (r === "openai/key") { forgetOpenAIKey(jar); return Response.json(await studioStatus(req, jar)); }
    if (r === "publik/provision") { publik.forget(jar); return Response.json(await studioStatus(req, jar)); }
    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) { return errorResponse(e); }
}
