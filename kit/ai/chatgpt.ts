// Mode "chatgpt": Sign in with ChatGPT, then answer with the person's ChatGPT plan.
//
// Written from OpenAI's public protocol docs (developers.openai.com/siwc, "ChatGPT plan usage"), not from the
// DevKit's code (its licence is noncommercial). OpenAI allows this for open-source tools and personal projects
// that RUN LOCALLY; a remotely hosted app needs OpenAI's approval first (waitlist). So the hosted copy of every
// build shows this mode as "run it on your computer", and this file only runs when the server is the person's machine.
//
// Flow: a stable host id per install -> browser authorization with PKCE on a 127.0.0.1 loopback callback
// (client_id=dynamic_agent_client the first time, the issued oaiapp_ id after) -> code exchange -> ID token
// verified against OpenAI's JWKS -> tokens in ~/.config/<slug>/chatgpt-auth.json (0600) -> Responses API with
// store:false, stream:true -> refresh near expiry, revoke on sign-out.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AIRequest } from "./types";
import { readSSE } from "./sse";
import { StudioError } from "./seal";

const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const USE_SCOPE = "chatgpt.tokens.use.direct";
const DYNAMIC = "dynamic_agent_client";
export const MANAGE_USAGE_URL = "https://chatgpt.com/settings/usage";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

interface Registration {
  client_id: string;
  email?: string;
  subject?: string;
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number; // ms
  scopes?: string[];
  saved_at?: string;
}
interface Pending {
  slug: string; server: Server; state: string; nonce: string; verifier: string; redirectUri: string;
  clientId: string; startedAt: number; error?: string; done?: boolean;
}
const g = globalThis as { __studioSiwc?: Pending; __studioSiwcRefresh?: Map<string, Promise<Registration>>; __studioSiwcModels?: Map<string, { at: number; list: { id: string; label: string }[] }> };

// ---------- local files (owner-only, atomic) ----------

const dir = (slug: string) => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), slug);
async function readJSON<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return null; }
}
async function writeJSON(file: string, value: unknown): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, file);
}
const regFile = (slug: string) => join(dir(slug), "chatgpt-auth.json");
const readReg = (slug: string) => readJSON<Registration>(regFile(slug));
const writeReg = (slug: string, r: Registration) => writeJSON(regFile(slug), r);

/** This install's host id (urn:uuid:…), created once and reused across sign-ins and accounts. */
async function hostId(slug: string): Promise<string> {
  const file = join(dir(slug), "chatgpt-host.json");
  const saved = await readJSON<{ ext_agent_host_id?: string }>(file);
  if (saved?.ext_agent_host_id) return saved.ext_agent_host_id;
  const id = `urn:uuid:${randomUUID()}`;
  await writeJSON(file, { ext_agent_host_id: id });
  return id;
}

// ---------- sign-in ----------

const b64url = (b: Buffer) => b.toString("base64url");

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const a = server.address();
      resolve(typeof a === "object" && a ? a.port : port);
    });
  });
}

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:16px/1.5 system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0b0c;color:#f4f4f5">
<main style="max-width:28rem;padding:2rem;text-align:center"><h1 style="font-size:1.25rem;margin:0 0 .5rem">${title}</h1><p style="opacity:.7;margin:0">${body}</p></main></body>`;
}

/** Starts a sign-in and returns the URL to open in the person's browser. The app polls status until it's done. */
export async function startChatGPTSignIn(slug: string, agentName: string): Promise<string> {
  g.__studioSiwc?.server.close();
  const reg = await readReg(slug);
  const server = createServer();
  let port: number;
  try { port = await listen(server, 1455); } catch { port = await listen(server, 0); } // only the port may vary
  const verifier = b64url(randomBytes(32));
  const p: Pending = {
    slug, server, state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier,
    redirectUri: `http://127.0.0.1:${port}/auth/callback`, clientId: reg?.client_id ?? DYNAMIC, startedAt: Date.now(),
  };
  g.__studioSiwc = p;
  const timer = setTimeout(() => { if (g.__studioSiwc === p && !p.done) { p.error = "Sign-in timed out. Try again."; server.close(); } }, 10 * 60_000);
  timer.unref?.();

  server.on("request", async (req, res) => {
    const url = new URL(req.url ?? "/", p.redirectUri);
    if (url.pathname !== "/auth/callback") { res.writeHead(404).end(); return; }
    const reply = (status: number, title: string, body: string) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(page(title, body)); };
    try {
      if (url.searchParams.get("state") !== p.state) { reply(400, "Sign-in didn't match", "Start again from the app."); return; }
      const err = url.searchParams.get("error");
      if (err) {
        p.error = err === "access_denied" ? "ChatGPT plan use wasn't allowed. Continue with ChatGPT again and allow it." : (url.searchParams.get("error_description") ?? err);
        reply(200, "Not connected", p.error); return;
      }
      const code = url.searchParams.get("code");
      const returned = url.searchParams.get("client_id");
      let clientId = p.clientId;
      if (p.clientId === DYNAMIC) {
        if (!returned) throw new Error("ChatGPT didn't finish registering this app. Try again.");
        clientId = returned;
        await writeReg(slug, { ...(reg ?? {}), client_id: clientId }); // keep the issued id even if the exchange fails
      } else if (returned && returned !== p.clientId) {
        throw new Error("ChatGPT returned a different app registration. Sign in again.");
      }
      if (!code) throw new Error("ChatGPT didn't return a sign-in code. Try again.");

      const tok = await tokenRequest({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: p.verifier, redirect_uri: p.redirectUri, resource: RESOURCE });
      if (typeof tok.id_token !== "string") throw new Error("ChatGPT did not return a verifiable identity. Please try signing in again.");
      const { payload } = await jwtVerify(tok.id_token, JWKS, { issuer: ISSUER, audience: clientId });
      if (payload.nonce !== p.nonce) throw new Error("Sign-in check failed (nonce). Try again.");
      if (reg?.subject && reg.client_id === clientId && payload.sub !== reg.subject) throw new Error("That's a different ChatGPT account than this app's saved one.");
      const scopes = typeof tok.scope === "string" ? tok.scope.split(/\s+/).filter(Boolean) : [];
      await writeReg(slug, {
        client_id: clientId, email: typeof payload.email === "string" ? payload.email : undefined, subject: payload.sub,
        id_token: tok.id_token, access_token: String(tok.access_token ?? ""),
        refresh_token: typeof tok.refresh_token === "string" ? tok.refresh_token : undefined,
        expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000, scopes, saved_at: new Date().toISOString(),
      });
      g.__studioSiwcModels?.delete(slug);
      p.done = true;
      reply(200, scopes.includes(USE_SCOPE) ? "Connected to ChatGPT" : "Signed in, plan use not allowed",
        scopes.includes(USE_SCOPE) ? "You can close this tab and go back to the app." : "Go back to the app and continue with ChatGPT again to allow plan use.");
    } catch (e) {
      p.error = e instanceof Error ? e.message : String(e);
      reply(400, "Couldn't connect", p.error);
    } finally {
      setTimeout(() => server.close(), 500).unref?.();
    }
  });

  const q = new URLSearchParams({
    client_id: p.clientId, response_type: "code", redirect_uri: p.redirectUri, scope: SCOPES, resource: RESOURCE,
    state: p.state, nonce: p.nonce, code_challenge_method: "S256",
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    ext_agent_host_id: await hostId(slug),
  });
  if (p.clientId === DYNAMIC) q.set("agent_name_hint", agentName);
  if (reg?.id_token) q.set("id_token_hint", reg.id_token); // URL is never logged: it can carry this hint
  if (reg?.email) q.set("login_hint", reg.email);
  return `${AUTHORIZE_URL}?${q}`;
}

async function tokenRequest(form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form), signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = String(body.error ?? res.status);
    throw Object.assign(new Error(code === "invalid_grant" ? "The sign-in expired. Continue with ChatGPT again." : `ChatGPT sign-in failed (${code}).`), { code });
  }
  return body;
}

// ---------- tokens ----------

/** A fresh access token for this install, refreshed near expiry (one refresh at a time: refresh tokens rotate). */
async function accessToken(slug: string): Promise<string> {
  const reg = await readReg(slug);
  if (!reg?.access_token || !reg.refresh_token) throw new StudioError(401, "Continue with ChatGPT to use your plan.");
  if (!reg.scopes?.includes(USE_SCOPE)) throw new StudioError(403, "ChatGPT plan use isn't allowed for this app. Continue with ChatGPT again and allow it.");
  if ((reg.expires_at ?? 0) - 90_000 > Date.now()) return reg.access_token;
  const locks = (g.__studioSiwcRefresh ??= new Map());
  let job = locks.get(slug);
  if (!job) {
    job = (async () => {
      try {
        const tok = await tokenRequest({ grant_type: "refresh_token", client_id: reg.client_id, refresh_token: reg.refresh_token!, resource: RESOURCE });
        const next: Registration = {
          ...reg, access_token: String(tok.access_token), expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
          refresh_token: typeof tok.refresh_token === "string" ? tok.refresh_token : reg.refresh_token,
          id_token: typeof tok.id_token === "string" ? tok.id_token : reg.id_token,
          scopes: typeof tok.scope === "string" ? tok.scope.split(/\s+/).filter(Boolean) : reg.scopes, saved_at: new Date().toISOString(),
        };
        await writeReg(slug, next);
        return next;
      } catch (e) {
        if ((e as { code?: string }).code === "invalid_grant") {
          await writeReg(slug, { client_id: reg.client_id, email: reg.email, subject: reg.subject, id_token: reg.id_token });
          throw new StudioError(401, "Your ChatGPT sign-in ended. Continue with ChatGPT again.");
        }
        throw new StudioError(502, "Couldn't renew your ChatGPT sign-in. Check your connection.");
      } finally { locks.delete(slug); }
    })();
    locks.set(slug, job);
  }
  return (await job).access_token!;
}

export async function chatgptStatus(slug: string) {
  const reg = await readReg(slug);
  const p = g.__studioSiwc?.slug === slug ? g.__studioSiwc : undefined;
  const sharing = !!reg?.access_token && !!reg.scopes?.includes(USE_SCOPE);
  return {
    ready: sharing,
    detail: reg?.email && reg.access_token ? `Signed in as ${reg.email}` : undefined,
    extra: { signingIn: !!p && !p.done && !p.error, error: p?.error ?? null, signedIn: !!reg?.access_token, sharing, manageUsageUrl: MANAGE_USAGE_URL },
  };
}

export async function chatgptModels(slug: string): Promise<{ id: string; label: string }[]> {
  const cache = (g.__studioSiwcModels ??= new Map());
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.list;
  const res = await fetch(`${RESOURCE}/models`, { headers: { authorization: `Bearer ${await accessToken(slug)}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok) throw await responsesError(res);
  const body = (await res.json()) as { models?: { slug: string; display_name?: string; visibility?: string }[] };
  const list = (body.models ?? []).filter((m) => m.visibility === "list").map((m) => ({ id: m.slug, label: m.display_name ?? m.slug }));
  cache.set(slug, { at: Date.now(), list });
  return list;
}

async function responsesError(res: Response): Promise<StudioError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  return usageError(body.error?.code, body.error?.message, res.status);
}
function usageError(code: string | undefined, message: string | undefined, status = 502): StudioError {
  if (code === "subscription_sharing_usage_limit_exceeded" || code === "subscription_sharing_usage_unavailable")
    return new StudioError(429, "You've hit your ChatGPT plan's limit for apps like this one.", { label: "Manage usage", url: MANAGE_USAGE_URL });
  if (status === 401) return new StudioError(401, "Your ChatGPT sign-in ended. Continue with ChatGPT again.");
  return new StudioError(status >= 500 ? 502 : status, message ?? `ChatGPT answered ${status}.`);
}

export async function* chatgptStream(slug: string, req: AIRequest, model?: string, signal?: AbortSignal): AsyncGenerator<string> {
  const token = await accessToken(slug);
  const chosen = model || (await chatgptModels(slug))[0]?.id;
  if (!chosen) throw new StudioError(409, "No ChatGPT models are available for this account.");
  const instructions = [req.system, req.json ? "Answer with one JSON value only: no prose, no code fence." : ""].filter(Boolean).join("\n\n");
  const res = await fetch(`${RESOURCE}/responses`, {
    method: "POST", cache: "no-store", signal,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({
      model: chosen, store: false, stream: true,
      ...(instructions ? { instructions } : {}),
      input: req.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok || !res.body) throw await responsesError(res);
  let completed = false;
  for await (const ev of readSSE(res.body)) {
    let j: { type?: string; delta?: string; response?: { error?: { code?: string; message?: string } }; error?: { code?: string; message?: string }; code?: string; message?: string };
    try { j = JSON.parse(ev.data); } catch { continue; }
    const type = j.type ?? ev.event;
    if (type === "response.output_text.delta" && typeof j.delta === "string") yield j.delta;
    else if (type === "response.completed") completed = true;
    else if (type === "response.failed") throw usageError(j.response?.error?.code, j.response?.error?.message);
    else if (type === "response.incomplete") throw new StudioError(502, "ChatGPT stopped before finishing. Try again.");
    else if (type === "error") throw usageError(j.error?.code ?? j.code, j.error?.message ?? j.message);
  }
  if (!completed) throw new StudioError(502, "The answer stopped before it finished. Try again.");
}

/** Revokes the renewable session (best effort, retried), then clears tokens. Keeps the registration and host id. */
export async function chatgptSignOut(slug: string): Promise<{ revoked: boolean }> {
  const reg = await readReg(slug);
  if (!reg) return { revoked: true };
  let revoked = !reg.refresh_token;
  if (reg.refresh_token) {
    for (let i = 0; i < 3 && !revoked; i++) {
      try {
        const conf = (await (await fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) })).json()) as { revocation_endpoint?: string };
        if (!conf.revocation_endpoint) break;
        const r = await fetch(conf.revocation_endpoint, {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000),
          body: new URLSearchParams({ token: reg.refresh_token, token_type_hint: "refresh_token", client_id: reg.client_id }),
        });
        if (r.ok) revoked = true;
        else if (r.status < 500) break;
      } catch { /* network: retry */ }
      if (!revoked) await new Promise((ok) => setTimeout(ok, 500 * 2 ** i));
    }
  }
  await writeReg(slug, { client_id: reg.client_id, email: reg.email, subject: reg.subject });
  g.__studioSiwcModels?.delete(slug);
  return { revoked };
}
