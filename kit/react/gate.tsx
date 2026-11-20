"use client";
// usePublikGate(): Sign in with publik in front of a build's app, as a hook. The build draws its own screen (its own
// design); the hook runs the gate the way publik's reference module does:
//   GET  /api/studio/publik/gate        this browser's place in the gate (read only)
//   POST /api/studio/publik/provision   this browser's publik install, made when the person clicks Sign in with publik
//   POST /api/studio/publik/choice      the plan screen's answer: "publik" (connect the plan) or "own_key"
// While Sign in with publik shows it checks every 3 s for up to 10 minutes, and once more whenever the tab comes back.
// With free answers on (PUBLIK_SPONSOR_KEY), a signed-in person with no plan goes straight to "ready".
// "pending" (no publik listing yet) opens the app: that's the kit's rule. Once open, wrap the app in <StudioProvider>,
// which counts usage (app_opened, active_session) for the builds hub and publik.
//
//   const g = usePublikGate();
//   if (g.open) return <StudioProvider>{children}</StudioProvider>;
//   ...draw g.shown / g.needsInstall with g.provision() and g.act(action)...
import { useCallback, useEffect, useRef, useState } from "react";
import type { GateAction, GateScreen, GateStatus } from "../ai/publik"; // types only: no server code reaches the browser

export type GateShown = Extract<GateStatus, { screen: GateScreen }>;
type NoteKey = keyof GateShown["notes"];
type Poll = { until: number; done: (s: GateStatus) => boolean; timeout: NoteKey };

const NOTES: GateShown["notes"] = {
  signInWaiting: "Waiting for you to sign in in your browser.",
  signInTimeout: "No sign-in after 10 minutes. Click Sign in with publik to try again.",
  planWaiting: "Waiting for your plan. Finish in your browser.",
  planTimeout: "No plan after 10 minutes. Click Get a plan to try again.",
};
/** Only when this app's own server does not answer (the words of the kit's gateScreen("unreachable")). */
const SERVER_DOWN: GateShown = {
  state: "unreachable", claimUrl: null, topUpUrl: null, notes: NOTES, pollMs: 3_000, pollLimitMs: 600_000,
  screen: { id: "unreachable", title: "Sign in with publik", body: "publik is not reachable. Check your connection.", note: null, buttons: [{ action: "retry", label: "Retry" }] },
};

async function readStatus(res: Response): Promise<GateStatus> {
  const s = (await res.json()) as GateStatus;
  if (!s || typeof s.state !== "string") throw new Error("bad gate status");
  return s;
}
let loading: Promise<GateStatus> | null = null; // one read at a time
const loadStatus = () => (loading ??= fetch("/api/studio/publik/gate", { cache: "no-store" }).then(readStatus).finally(() => { loading = null; }));
const post = (path: string, body: unknown) =>
  fetch(`/api/studio/${path}`, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const signedIn = (s: GateStatus) => s.state === "choose" || s.state === "ready";
const signInPoll = (limitMs: number): Poll => ({ until: Date.now() + limitMs, done: signedIn, timeout: "signInTimeout" });
const planPoll = (limitMs: number): Poll => ({
  until: Date.now() + limitMs,
  done: (s) => s.state === "ready" || (s.state === "choose" && s.screen.buttons.some((b) => b.action === "connect")),
  timeout: "planTimeout",
});

export interface PublikGate {
  /** The gate's answer for this browser (null until the first read). */
  status: GateStatus | null;
  /** Show the app. */
  open: boolean;
  /** The screen to draw when not open: sign in, choose how to pay, or unreachable (null on a first visit or while loading). */
  shown: GateShown | null;
  /** First visit on this browser: draw Sign in with publik as a button that calls provision(). */
  needsInstall: boolean;
  /** needsInstall, or the sign-in screen: say what signing in is for. */
  signingIn: boolean;
  /** The first read hasn't answered yet. */
  loading: boolean;
  /** Free answers a day once signed in (the builder's grant), or null: say it on the sign-in screen when there are some. */
  freePerDay: number | null;
  busy: boolean;
  /** A note to show under the screen ("Waiting for you to sign in…"), and whether it's still waiting (show a spinner). */
  note: string | null;
  waiting: boolean;
  /** Makes this browser's install and opens publik's sign-in in a new tab. Call it from the click itself. */
  provision: () => Promise<void>;
  /** A screen button. For sign_in and get_plan, draw a link to hrefFor(action) and call act() on its click. */
  act: (a: GateAction) => Promise<void>;
  hrefFor: (a: GateAction) => string | null;
}

/** usesAi false: signed in is enough (no "how to pay for AI" step). */
export function usePublikGate({ usesAi = true }: { usesAi?: boolean } = {}): PublikGate {
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [down, setDown] = useState(false);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<NoteKey | null>(null);
  const [poll, setPoll] = useState<Poll | null>(null);
  const last = useRef<GateShown | null>(null); // the server's poll timing, read in effects and handlers

  const accept = useCallback((s: GateStatus) => {
    if ("screen" in s) last.current = s;
    setDown(false);
    setStatus(s);
  }, []);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { accept(await loadStatus()); } catch { setDown(true); } finally { setBusy(false); }
  }, [accept]);
  useEffect(() => {
    loadStatus().then(accept, () => setDown(true)).finally(() => setBusy(false));
  }, [accept]);

  const limitMs = () => last.current?.pollLimitMs ?? 600_000;
  const open = !!status && !down && (status.state === "ready" || status.state === "pending" || (status.state === "choose" && !usesAi));

  const state = down ? "down" : status?.state;
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setNote(null);
    setPoll(state === "sign_in" ? signInPoll(last.current?.pollLimitMs ?? 600_000) : null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [state]);

  useEffect(() => {
    if (!poll) return;
    let alive = true, inflight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const every = last.current?.pollMs ?? 3_000;
    const tick = async () => {
      if (!alive || inflight) return;
      if (Date.now() >= poll.until) { setNote(poll.timeout); setPoll(null); return; }
      inflight = true;
      const s = await loadStatus().catch(() => null);
      inflight = false;
      if (!alive) return;
      if (s && poll.done(s)) { setPoll(null); setNote(null); accept(s); return; }
      timer = setTimeout(tick, every);
    };
    const now = () => { clearTimeout(timer); void tick(); }; // back from the sign-in tab: check at once
    timer = setTimeout(tick, every);
    window.addEventListener("focus", now);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener("focus", now); };
  }, [poll, accept]);

  // Signed in some other way (another tab) or came back after a timeout: one check when the tab shows.
  const title = status && "screen" in status ? status.screen.title : null;
  useEffect(() => {
    if (open || poll || (state !== "sign_in" && state !== "choose" && state !== "needs_install")) return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void loadStatus().then((s) => {
        if (s.state === state && (!("screen" in s) || s.screen.title === title)) return;
        setNote(null);
        accept(s);
      }, () => {});
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [open, poll, state, title, accept]);

  const provision = useCallback(async () => {
    const w = window.open("about:blank", "_blank"); // inside the click, so the new tab isn't blocked
    if (w) w.opener = null;
    setBusy(true);
    try {
      const s = await readStatus(await post("publik/provision", {}));
      if (s.state === "sign_in" && s.claimUrl && w) { w.location.href = s.claimUrl; accept(s); setNote("signInWaiting"); return; }
      w?.close();
      accept(s); // a blocked tab: the screen now shows Sign in with publik as a link to the claim page
    } catch {
      w?.close();
      setDown(true);
    } finally {
      setBusy(false);
    }
  }, [accept]);

  const act = useCallback(async (a: GateAction) => {
    if (a === "retry") return void refresh();
    if (a === "sign_in") {
      if (status?.state !== "sign_in" || !status.claimUrl) return void refresh();
      setNote("signInWaiting"); // the link itself opened claim_url in a new tab
      setPoll(signInPoll(limitMs()));
      return;
    }
    if (a === "get_plan") { setNote("planWaiting"); setPoll(planPoll(limitMs())); return; }
    setPoll(null);
    setNote(null);
    setBusy(true);
    try { await post("publik/choice", { choice: a === "connect" ? "publik" : "own_key" }); } catch { /* the next status shows the plan screen again */ }
    await refresh();
  }, [refresh, status]);

  const shown: GateShown | null = down ? SERVER_DOWN : status && "screen" in status ? status : null;
  const needsInstall = !down && status?.state === "needs_install";
  return {
    status, open, shown, needsInstall,
    signingIn: needsInstall || shown?.screen.id === "sign_in",
    loading: !status && !down,
    freePerDay: status && "freePerDay" in status ? status.freePerDay ?? null : null,
    busy,
    note: note ? NOTES[note] : shown?.screen.note ?? null,
    waiting: !!poll && (note === "signInWaiting" || note === "planWaiting"),
    provision, act,
    hrefFor: (a) => (a === "sign_in" ? shown?.claimUrl ?? null : a === "get_plan" ? shown?.topUpUrl ?? null : null),
  };
}
