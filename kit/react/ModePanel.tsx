"use client";
// The mode picker every build shares: one card per mode the build offers (studio.config.ts → modes).
//   <ModeButton />  a pill for the app's header; opens the picker as a dialog.
//   <ModeGate>      wraps the app's main surface; shows the picker inline until a mode is ready.
//   <ModePanel />   the cards themselves, for a settings page.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PUBLIK_CHEAPER, type Mode, type ModeStatus } from "../ai/types";
import { useStudio } from "./studio";

const ICON: Record<Mode, ReactNode> = {
  local: <svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>,
  chatgpt: <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7v5l3 2" /></svg>,
  claude: <svg viewBox="0 0 24 24" aria-hidden><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l2 2M14 9l2 2" /></svg>,
  openai: <svg viewBox="0 0 24 24" aria-hidden><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l2 2M14 9l2 2" /><path d="M8 13.5v3M6.5 15h3" /></svg>,
  publik: <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>,
};

export function ModeButton({ className = "" }: { className?: string }) {
  const s = useStudio();
  const active = s.status?.modes.find((m) => m.id === s.status?.active);
  return (
    <>
      <button type="button" className={`sk-pill ${className}`} onClick={() => s.openPicker(null)} aria-haspopup="dialog">
        <span className={`sk-dot ${active ? "is-on" : ""}`} />
        {active ? <>{active.label}{active.id === "chatgpt" && <span className="sk-muted"> · Using ChatGPT plan</span>}</> : "Choose AI"}
      </button>
      <ModeDialog />
    </>
  );
}

function ModeDialog() {
  const s = useStudio();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (s.pickerOpen && !d.open) d.showModal();
    if (!s.pickerOpen && d.open) d.close();
  }, [s.pickerOpen]);
  return (
    <dialog ref={ref} className="sk-dialog" onClose={s.closePicker} onClick={(e) => { if (e.target === ref.current) s.closePicker(); }}>
      <div className="sk-dialog-head">
        <h2>Power {s.status?.app.name ?? "this app"} with…</h2>
        <button type="button" className="sk-icon-btn" aria-label="Close" onClick={s.closePicker}>×</button>
      </div>
      {s.pickerOpen && <ModePanel />}
    </dialog>
  );
}

/** Shows the picker in place of `children` until a mode is ready. */
export function ModeGate({ children, title }: { children: ReactNode; title?: string }) {
  const s = useStudio();
  if (s.loading) return <div className="sk-gate"><div className="sk-spinner" aria-label="Loading" /></div>;
  if (s.status?.active) return <>{children}</>;
  return (
    <div className="sk-gate">
      <div className="sk-gate-inner">
        <h2 className="sk-gate-title">{title ?? `How do you want to power ${s.status?.app.name ?? "this app"}?`}</h2>
        <p className="sk-muted">Pick one. You can switch any time from the button at the top.</p>
        <ModePanel />
      </div>
    </div>
  );
}

export function ModePanel() {
  const s = useStudio();
  if (!s.status) return s.issue ? <p className="sk-error" role="alert">{s.issue.message}</p> : <div className="sk-spinner" />;
  const { modes, active, hosted, runLocally } = s.status;
  const local = modes.filter((m) => !m.available);
  return (
    <div className="sk-panel">
      {s.issue && <Issue />}
      <div className="sk-cards">
        {modes.filter((m) => m.available).map((m) => <Card key={m.id} m={m} active={active === m.id} />)}
      </div>
      {hosted && local.length > 0 && (
        <div className="sk-local">
          <p><strong>{local.map((m) => m.label).join(" and ")}</strong> {local.length > 1 ? "need" : "needs"} the app running on your computer.</p>
          <Copy text={runLocally} />
        </div>
      )}
    </div>
  );
}

function Issue() {
  const { issue } = useStudio();
  if (!issue) return null;
  return (
    <p className="sk-error" role="alert">
      {issue.message}{issue.action && <> <a href={issue.action.url} target="_blank" rel="noopener noreferrer">{issue.action.label} ↗</a></>}
    </p>
  );
}

function Card({ m, active }: { m: ModeStatus; active: boolean }) {
  const s = useStudio();
  return (
    <section className={`sk-card ${active ? "is-active" : ""} ${m.ready ? "is-ready" : ""}`} aria-label={m.label}>
      <header className="sk-card-head">
        <span className="sk-card-icon">{ICON[m.id]}</span>
        <div>
          <h3>{m.label}</h3>
          <p className="sk-muted">{m.blurb}</p>
        </div>
        {active ? <span className="sk-tag">In use</span> : m.ready ? <button type="button" className="sk-btn sk-btn-quiet" onClick={() => s.setMode(m.id)}>Use</button> : null}
      </header>
      {m.detail && <p className="sk-detail">{m.detail}</p>}
      <div className="sk-card-body">
        {m.id === "claude" && <KeyBody m={m} placeholder="sk-ant-…" label="Anthropic API key" getKey="https://console.anthropic.com/settings/keys" save={s.saveClaudeKey} forget={s.forgetClaudeKey} />}
        {m.id === "openai" && <KeyBody m={m} placeholder="sk-…" label="OpenAI API key" getKey="https://platform.openai.com/api-keys" save={s.saveOpenAIKey} forget={s.forgetOpenAIKey} />}
        {m.id === "chatgpt" && <ChatGPTBody m={m} />}
        {m.id === "local" && <ModelSelect m={m} />}
        {m.id === "publik" && <PublikBody m={m} />}
      </div>
    </section>
  );
}

function ModelSelect({ m }: { m: ModeStatus }) {
  const s = useStudio();
  if (!m.models?.length) return m.id === "local" ? <p className="sk-muted">No local model running. Get <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">Ollama</a>, then run <code>ollama pull llama3.2</code>.</p> : null;
  return (
    <label className="sk-field">
      <span>Model</span>
      <select value={m.model ?? ""} onChange={(e) => s.setModel(m.id, e.target.value)}>
        {m.models.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
    </label>
  );
}

/** A bring-your-own-key mode (Claude, OpenAI): paste and check the key; once saved, a model choice (if any) and Remove. */
function KeyBody({ m, placeholder, label, getKey, save, forget }: { m: ModeStatus; placeholder: string; label: string; getKey: string; save: (key: string) => Promise<boolean>; forget: () => Promise<void> }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  if (m.ready) {
    return (
      <div className="sk-stack">
        {m.models && m.models.length > 1 && <ModelSelect m={m} />}
        {m.detail?.startsWith("Key ending") && <button type="button" className="sk-btn sk-btn-quiet" onClick={() => forget()}>Remove key</button>}
      </div>
    );
  }
  return (
    <form className="sk-row" onSubmit={async (e) => { e.preventDefault(); setBusy(true); if (await save(key)) setKey(""); setBusy(false); }}>
      <input type="password" autoComplete="off" spellCheck={false} placeholder={placeholder} value={key} onChange={(e) => setKey(e.target.value)} aria-label={label} />
      <button type="submit" className="sk-btn" disabled={busy || key.length < 10}>{busy ? "Checking…" : "Save"}</button>
      <a className="sk-link" href={getKey} target="_blank" rel="noopener noreferrer">Get a key ↗</a>
    </form>
  );
}

function ChatGPTBody({ m }: { m: ModeStatus }) {
  const s = useStudio();
  const x = (m.extra ?? {}) as { signingIn?: boolean; error?: string | null; signedIn?: boolean; sharing?: boolean; manageUsageUrl?: string };
  if (m.ready) {
    return (
      <div className="sk-stack">
        <ModelSelect m={m} />
        <div className="sk-row">
          <span className="sk-tag">Using ChatGPT plan</span>
          <a className="sk-link" href={x.manageUsageUrl} target="_blank" rel="noopener noreferrer">Manage usage ↗</a>
          <button type="button" className="sk-btn sk-btn-quiet" onClick={() => s.signOutChatGPT()}>Sign out</button>
        </div>
      </div>
    );
  }
  return (
    <div className="sk-stack">
      {x.error && <p className="sk-error">{x.error}</p>}
      <button type="button" className="sk-btn sk-btn-chatgpt" disabled={x.signingIn} onClick={() => s.signInChatGPT()}>
        {x.signingIn ? "Waiting for ChatGPT…" : "Continue with ChatGPT"}
      </button>
      {x.signedIn && !x.sharing && <p className="sk-muted">Signed in, but plan use isn't allowed yet. Continue again and allow it.</p>}
    </div>
  );
}

interface Gate { state: string; screen?: { title: string; body: string; note: string | null; buttons: { action: string; label: string }[] }; claimUrl?: string | null; topUpUrl?: string | null; choice?: string | null; until?: string | null; free?: { left: number; perDay: number; topUpUrl: string | null } | null }

function PublikBody({ m }: { m: ModeStatus }) {
  const s = useStudio();
  const g = (m.extra?.gate ?? { state: "needs_install" }) as Gate;
  if (g.state === "pending") return <p className="sk-muted">publik sign-in is coming to this app{g.until && g.until !== "soon" ? ` (from ${g.until})` : ""}. Pick another mode for now.</p>;
  // Free answers (the builder's grant): nothing to connect. The detail line counts what's left; a plan gets more.
  if (g.state === "ready" && g.choice === "publik" && g.free) {
    return g.free.topUpUrl ? <a className="sk-link" href={g.free.topUpUrl} target="_blank" rel="noopener noreferrer">Get a publik plan for more ↗</a> : null;
  }
  if (g.state === "ready") {
    return g.choice === "publik"
      ? <button type="button" className="sk-btn sk-btn-quiet" onClick={() => s.publikChoose(null)}>Change plan choice</button>
      : <button type="button" className="sk-btn" onClick={() => s.publikChoose("publik")}>Connect your plan</button>;
  }
  if (g.state === "needs_install" || (g.state === "sign_in" && !g.screen)) {
    return <button type="button" className="sk-btn" onClick={() => s.publikSignIn()}><PublikSignInLabel /></button>;
  }
  const screen = g.screen!;
  return (
    <div className="sk-stack">
      <p className="sk-muted">{screen.body}</p>
      {screen.note && <p className="sk-muted">{screen.note}</p>}
      <div className="sk-row">
        {screen.buttons.map((b) => (
          <button key={b.action} type="button" className={`sk-btn ${b.action === "own_key" ? "sk-btn-quiet" : ""}`} onClick={() => {
            if (b.action === "sign_in") { if (g.claimUrl) window.open(g.claimUrl, "_blank", "noopener"); void s.publikSignIn(); }
            else if (b.action === "retry") void s.refresh();
            else if (b.action === "get_plan") { if (g.topUpUrl) window.open(g.topUpUrl, "_blank", "noopener"); }
            else if (b.action === "connect") void s.publikChoose("publik");
            else if (b.action === "own_key") void s.publikChoose("own_key");
          }}>{b.action === "sign_in" ? <PublikSignInLabel /> : b.label}</button>
        ))}
      </div>
    </div>
  );
}

/** "Sign in with publik (20x cheaper than OpenAI and Anthropic)": the aside is lighter than the label. */
function PublikSignInLabel() {
  return <>Sign in with publik <span className="sk-btn-aside">({PUBLIK_CHEAPER})</span></>;
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="sk-copy">
      <code>{text}</code>
      <button type="button" className="sk-btn sk-btn-quiet" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
