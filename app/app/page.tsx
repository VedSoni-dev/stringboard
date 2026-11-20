"use client";
// The app at "/app". Starter: a streaming chat over the kit. Replace the body with the build; keep the header
// (name left, mode pill right: Jakob's law) and <ModeGate> (nobody hits a dead AI call without a mode).
import Link from "next/link";
import { useRef, useState } from "react";
import { ModeButton, ModeGate } from "@/kit/react/ModePanel";
import { useAI } from "@/kit/react/studio";
import type { ChatMessage } from "@/kit/ai/types";

export default function AppPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-2 sm:px-6">
        <Link href="/" className="flex min-h-11 items-center font-display font-semibold">Stringboard</Link>
        <ModeButton />
      </header>
      <main className="flex flex-1 flex-col">
        <ModeGate><Chat /></ModeGate>
      </main>
    </div>
  );
}

function Chat() {
  const ai = useAI();
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function send() {
    const text = input.trim(); // Postel: accept messy input, send it clean
    if (!text || ai.busy) return;
    const next: ChatMessage[] = [...history, { role: "user", content: text }];
    setHistory(next);
    setInput("");
    const answer = await ai.run({ messages: next });
    if (answer) setHistory([...next, { role: "assistant", content: answer }]);
    inputRef.current?.focus();
  }

  const shown = ai.busy ? [...history, { role: "assistant" as const, content: ai.text }] : history;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
      <div className="flex-1 space-y-4 py-6">
        {shown.length === 0 && <p className="text-muted">Ask anything to try it.</p>}
        {shown.map((m, i) => (
          <div key={i} className={`sk-rise max-w-[85%] whitespace-pre-wrap rounded-[var(--radius)] px-4 py-3 ${m.role === "user" ? "ml-auto bg-fg text-bg" : "border border-line bg-card"}`}>
            {m.content || <span className="text-muted">Thinking…</span>}
          </div>
        ))}
        {ai.error && (
          <p className="sk-error" role="alert">{ai.error.message}{ai.error.action && <> <a href={ai.error.action.url} target="_blank" rel="noopener noreferrer">{ai.error.action.label} ↗</a></>}</p>
        )}
      </div>
      <form className="sticky bottom-0 flex items-end gap-2 bg-bg pb-4 pt-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder="Message Stringboard…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          className="min-h-11 flex-1 resize-none rounded-[var(--radius-sm)] border border-line bg-card px-4 py-3 outline-none focus:border-accent focus:shadow-[var(--focus)]" />
        {ai.busy ? <button type="button" className="sk-btn sk-btn-quiet" onClick={ai.stop}>Stop</button> : <button type="submit" className="sk-btn" disabled={!input.trim()}>Send</button>}
      </form>
    </div>
  );
}
