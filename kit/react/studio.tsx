"use client";
// Client half of the studio kit: the mode state for this browser, the actions, and useAI() for streaming answers.
//   <StudioProvider> once around the app (app/app/layout.tsx), then useStudio() / useAI() anywhere below it.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Mode, StudioErrorBody, StudioStatus } from "../ai/types";

export type { Mode, StudioStatus } from "../ai/types";
type Action = StudioErrorBody["action"];
export interface StudioIssue { message: string; action?: Action }

interface Ctx {
  status: StudioStatus | null;
  loading: boolean;
  issue: StudioIssue | null;
  pickerOpen: boolean;
  openPicker: (reason?: StudioIssue | null) => void;
  closePicker: () => void;
  refresh: () => Promise<StudioStatus | null>;
  setMode: (m: Mode | null) => Promise<void>;
  setModel: (m: Mode, model: string) => Promise<void>;
  saveClaudeKey: (key: string) => Promise<boolean>;
  forgetClaudeKey: () => Promise<void>;
  saveOpenAIKey: (key: string) => Promise<boolean>;
  forgetOpenAIKey: () => Promise<void>;
  signInChatGPT: () => Promise<void>;
  signOutChatGPT: () => Promise<void>;
  publikSignIn: () => Promise<void>;
  publikChoose: (choice: "publik" | "own_key" | null) => Promise<void>;
}
const StudioContext = createContext<Ctx | null>(null);

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/studio/${path}`, {
    method, cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & Partial<StudioErrorBody>;
  if (!res.ok) throw Object.assign(new Error(json.error ?? `Request failed (${res.status})`), { action: json.action });
  return json;
}
const issueOf = (e: unknown): StudioIssue => ({ message: e instanceof Error ? e.message : String(e), action: (e as { action?: Action }).action });

export function StudioProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<StudioIssue | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [polling, setPolling] = useState<null | "chatgpt" | "publik">(null);
  const pollStarted = useRef(0);

  const refresh = useCallback(async () => {
    try { const s = await call<StudioStatus>("GET", "status"); setStatus(s); return s; }
    catch (e) { setIssue(issueOf(e)); return null; }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (fn: () => Promise<StudioStatus | unknown>) => {
    setIssue(null);
    try { const r = await fn(); if (r && typeof r === "object" && "modes" in (r as object)) setStatus(r as StudioStatus); else await refresh(); }
    catch (e) { setIssue(issueOf(e)); }
  }, [refresh]);

  // Poll while a browser sign-in is in progress (ChatGPT: up to 10 min; publik: every 3 s for 10 min, like its module).
  useEffect(() => {
    if (!polling) return;
    pollStarted.current = Date.now();
    const t = setInterval(async () => {
      const s = await refresh();
      const m = s?.modes.find((x) => x.id === polling);
      const gate = (m?.extra?.gate ?? null) as { state?: string } | null;
      const doneChatGPT = polling === "chatgpt" && (m?.ready || (m?.extra && !m.extra.signingIn));
      const donePublik = polling === "publik" && gate && gate.state !== "sign_in" && gate.state !== "needs_install";
      if (doneChatGPT || donePublik || Date.now() - pollStarted.current > 10 * 60_000) setPolling(null);
    }, polling === "chatgpt" ? 2000 : 3000);
    return () => clearInterval(t);
  }, [polling, refresh]);

  // Usage pings: app_opened once per browser session, then active_session every 30 minutes while a tab is open.
  // The server forwards them to the builds hub (which build) and, when signed in, to publik's usage counting.
  const publikGate = status?.modes.find((m) => m.id === "publik")?.extra?.gate as { state?: string; telemetrySeconds?: number } | undefined;
  const pingSeconds = publikGate?.telemetrySeconds ?? 1800;
  useEffect(() => {
    const ping = (event: string) => fetch("/api/studio/ping", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event }) }).catch(() => {});
    let first = true;
    try { first = !sessionStorage.getItem("studio-opened"); sessionStorage.setItem("studio-opened", "1"); } catch { /* storage blocked: count anyway */ }
    if (first) void ping("app_opened");
    const t = setInterval(() => void ping("active_session"), pingSeconds * 1000);
    return () => clearInterval(t);
  }, [pingSeconds]);

  const value = useMemo<Ctx>(() => ({
    status, loading, issue, pickerOpen,
    openPicker: (reason) => { if (reason !== undefined) setIssue(reason); setPickerOpen(true); },
    closePicker: () => { setPickerOpen(false); setIssue(null); },
    refresh,
    setMode: (m) => run(() => call("POST", "mode", { mode: m })),
    setModel: (m, model) => run(() => call("POST", "model", { mode: m, model })),
    saveClaudeKey: async (key) => {
      setIssue(null);
      try { setStatus(await call<StudioStatus>("POST", "claude/key", { key })); return true; }
      catch (e) { setIssue(issueOf(e)); return false; }
    },
    forgetClaudeKey: () => run(() => call("DELETE", "claude/key")),
    saveOpenAIKey: async (key) => {
      setIssue(null);
      try { setStatus(await call<StudioStatus>("POST", "openai/key", { key })); return true; }
      catch (e) { setIssue(issueOf(e)); return false; }
    },
    forgetOpenAIKey: () => run(() => call("DELETE", "openai/key")),
    signInChatGPT: async () => {
      setIssue(null);
      const w = window.open("about:blank", "_blank"); // open now, inside the click, so pop-up blockers allow it
      try {
        const { url } = await call<{ url: string }>("POST", "chatgpt/start", {});
        if (w) w.location.href = url; else window.location.href = url;
        setPolling("chatgpt");
      } catch (e) { w?.close(); setIssue(issueOf(e)); }
    },
    signOutChatGPT: () => run(() => call("POST", "chatgpt/signout", {})),
    publikSignIn: async () => {
      setIssue(null);
      const w = window.open("about:blank", "_blank");
      try {
        const g = await call<{ state: string; claimUrl?: string | null; screen?: { body: string } }>("POST", "publik/provision", {});
        if (g.state === "sign_in" && g.claimUrl) { if (w) w.location.href = g.claimUrl; setPolling("publik"); }
        else { w?.close(); if (g.state === "unreachable") setIssue({ message: g.screen?.body ?? "publik is not reachable." }); }
        await refresh();
      } catch (e) { w?.close(); setIssue(issueOf(e)); }
    },
    publikChoose: (choice) => run(() => call("POST", "publik/choice", { choice })),
  }), [status, loading, issue, pickerOpen, refresh, run]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): Ctx {
  const c = useContext(StudioContext);
  if (!c) throw new Error("useStudio() needs <StudioProvider> above it.");
  return c;
}

/**
 * Streams an answer from the app's own AI route (default /api/ai, which calls streamText()).
 *   const ai = useAI();  await ai.run({ messages });  ai.text, ai.busy, ai.error
 * When no mode is ready, it opens the mode picker with the reason instead of failing quietly.
 */
export function useAI(endpoint = "/api/ai") {
  const studio = useContext(StudioContext);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StudioIssue | null>(null);
  const abort = useRef<AbortController | null>(null);

  const stop = useCallback(() => abort.current?.abort(), []);
  const run = useCallback(async (body: unknown, onChunk?: (chunk: string, all: string) => void): Promise<string> => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true); setError(null); setText("");
    let all = "";
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as Partial<StudioErrorBody>;
        const iss = { message: j.error ?? `Request failed (${res.status})`, action: j.action };
        setError(iss);
        if ((res.status === 401 || res.status === 409) && studio) studio.openPicker(iss);
        return "";
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        all += chunk;
        setText(all);
        onChunk?.(chunk, all);
      }
      const warn = all.lastIndexOf("\n\n⚠ ");
      if (warn !== -1) { setError({ message: all.slice(warn + 4) }); all = all.slice(0, warn); setText(all); }
      return all;
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(issueOf(e));
      return all;
    } finally {
      if (abort.current === ac) { abort.current = null; setBusy(false); }
    }
  }, [endpoint, studio]);

  return { text, busy, error, run, stop, setText };
}
