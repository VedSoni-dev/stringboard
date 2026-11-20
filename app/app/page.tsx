"use client";
// The board app at /app. Graph in the middle; dossier / briefing on the right (a sheet on phones); timeline at the
// bottom; the ask bar floats above it. Files dropped anywhere land on the open board.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModeButton } from "@/kit/react/ModePanel";
import { useAI, useStudio } from "@/kit/react/studio";
import type { Entity, Evidence, Kind, Link as BLink } from "@/lib/types";
import { answerPath, boardContext } from "@/lib/context";
import { SAMPLE_ID } from "@/lib/samples/enron";
import { Graph, type GraphHandle } from "@/components/board/Graph";
import { Answer, Dossier, KindMark, Label, Legend, OpsLog, SourceViewer, Timeline, type Range, type Turn } from "@/components/board/Panels";
import { useBoard } from "@/components/board/useBoard";
import { Mark } from "@/components/Mark";

const SAMPLE_QS = ["Who warned Ken Lay, and when?", "How is Fastow tied to Raptor?", "What was Chewco hiding?"];
const OWN_QS = ["Who is at the centre of all this?", "Who owes money to whom?", "What changed, and when?"];

export default function AppPage() {
  const B = useBoard();
  const studio = useStudio();
  const ai = useAI("/api/ask");
  const graph = useRef<GraphHandle>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<Kind>>(new Set());
  const [range, setRange] = useState<Range | null>(null);
  const [playing, setPlaying] = useState(false);
  const [source, setSource] = useState<Evidence | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [panel, setPanel] = useState<"dossier" | "brief" | null>(null);
  const [q, setQ] = useState("");
  const [dropping, setDropping] = useState(false);
  const [paste, setPaste] = useState(false);
  const askRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const board = B.board;
  const [wide, setWide] = useState(true);
  const [innerH, setInnerH] = useState(800);
  useEffect(() => { const r = () => { setWide(innerWidth >= 1024); setInnerH(innerHeight); }; r(); addEventListener("resize", r); return () => removeEventListener("resize", r); }, []);

  // the first visit to /app?sample (from the landing) builds the sample in front of you
  useEffect(() => {
    if (!B.ready) return;
    const p = new URLSearchParams(location.search);
    if (p.has("sample") || p.get("board") === SAMPLE_ID) void B.replaySample();
  }, [B.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSelected(null); setTurns([]); setPanel(null); setRange(null); setHidden(new Set()); }, [board?.id]);
  useEffect(() => {
    if (!board) return;
    const u = new URL(location.href);
    u.searchParams.delete("sample"); u.searchParams.set("board", board.id);
    history.replaceState(null, "", u);
  }, [board?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the whole board in frame while it builds, and once more when it settles
  useEffect(() => {
    if (B.phase.kind === "idle") { const t = setTimeout(() => graph.current?.fit(700), 900), u = setTimeout(() => graph.current?.fit(900), 2600); return () => { clearTimeout(t); clearTimeout(u); }; }
    const t = setInterval(() => { if (!selected) graph.current?.fit(900); }, 1600);
    return () => clearInterval(t);
  }, [B.phase.kind, selected]);

  // ----- time -----
  const span = useMemo(() => {
    if (!board) return null;
    const ts = [...board.evidence.map((x) => x.date), ...board.events.map((v) => v.date), ...board.docs.flatMap((d) => (d.messages ?? []).map((m) => m.at))]
      .filter(Boolean).map((d) => new Date(d!).getTime()).filter((t) => !isNaN(t));
    return ts.length > 1 ? { min: Math.min(...ts), max: Math.max(...ts) } : null;
  }, [board, B.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useCallback((e: Entity) => {
    if (hidden.has(e.kind)) return false;
    if (!range) return true;
    const f = e.firstSeen ? new Date(e.firstSeen).getTime() : null;
    const l = e.lastSeen ? new Date(e.lastSeen).getTime() : f;
    if (f === null) return true;
    return f <= range.b && (l ?? f) >= range.a - 1;
  }, [hidden, range]);
  const linkVisible = useCallback((l: BLink) => !range || !l.date || new Date(l.date).getTime() <= range.b, [range]);
  const play = useCallback(() => {
    if (playing || !span) { setPlaying(false); return; }
    setPlaying(true); setSelected(null);
    const t0 = performance.now(), ms = 7000;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setRange({ a: span.min, b: span.min + (span.max - span.min) * p });
      if (p < 1 && playRef.current) requestAnimationFrame(tick); else { setPlaying(false); if (p >= 1) setRange(null); }
    };
    requestAnimationFrame(tick);
  }, [playing, span]);
  const playRef = useRef(false); playRef.current = playing;

  // ----- selection, asking -----
  const select = useCallback((id: string | null) => { setSelected(id); if (id) { setPanel("dossier"); graph.current?.focus(id); } else if (panel === "dossier") setPanel(turns.length ? "brief" : null); }, [panel, turns.length]);
  const cite = useCallback((id: string) => { const x = board?.evidence.find((e) => e.id === id); if (x) setSource(x); }, [board]);
  const ask = useCallback(async (question: string, focus?: Entity) => {
    if (!board || ai.busy || !question.trim()) return;
    const { board: ctx, evidence } = boardContext(board, question, focus ? [focus.id] : undefined, studio.status?.active === "local");
    const history = turns.slice(-3).flatMap((t) => [{ role: "user" as const, content: t.q }, { role: "assistant" as const, content: t.a }]);
    const turn: Turn = { q: question.trim(), a: "", focus: focus?.name };
    setTurns((t) => [...t, turn]); setPanel("brief"); setSelected(null); setQ("");
    const a = await ai.run({ question: turn.q, board: ctx, evidence, history, focus: focus ? `${focus.id} ${focus.name}` : undefined });
    setTurns((t) => t.map((x) => (x === turn ? { ...x, a } : x)));
    if (a) { const p = answerPath(a, board); if (p.nodes.length) setTimeout(() => graph.current?.fit(600), 50); }
  }, [ai, board, turns, studio.status?.active]);
  const lastAnswer = ai.busy ? ai.text : turns[turns.length - 1]?.a ?? "";
  const lit = useMemo(() => (board && panel === "brief" && lastAnswer ? answerPath(lastAnswer, board) : null), [board, panel, lastAnswer]);

  // ----- search suggestions in the ask bar -----
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!board || s.length < 2 || s.includes(" ") && s.split(" ").length > 3) return [];
    return board.entities.filter((e) => [e.name, ...e.aliases].some((n) => n.toLowerCase().includes(s))).slice(0, 5);
  }, [q, board]);

  // ----- keyboard + drop -----
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); askRef.current?.focus(); }
      if (e.key === "Escape" && !typing) { setSelected(null); setPanel(null); }
      if (e.key === "f" && !typing && !e.metaKey && !e.ctrlKey) graph.current?.fit();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDropping(false); const f = [...e.dataTransfer.files]; if (f.length) void B.ingest(f); };

  const stats = board ? { ents: board.entities.length, red: board.links.filter((l) => l.origin === "ai").length, files: board.docs.length } : null;
  const showPanel = panel === "dossier" && selected ? "dossier" : panel === "brief" && turns.length ? "brief" : null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }} onDragLeave={(e) => { if (e.relatedTarget === null) setDropping(false); }} onDrop={onDrop}>
      <header className="relative z-20 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg px-3 sm:px-4">
        <Link href="/" className="flex min-h-11 items-center gap-2 font-display text-[15px] font-semibold"><Mark /> <span className="hidden sm:inline">Stringboard</span></Link>
        {board && <>
          <span className="text-line">/</span>
          <BoardMenu name={board.name} sample={!!board.sample} boards={B.boards} onOpen={(id) => void B.openId(id)} onRename={B.rename} onNew={() => B.open(null)} />
          {stats && <p className="hidden font-mono text-[11px] text-muted lg:block">{stats.ents} entities · <span className="text-accent">{stats.red} red strings</span> · {stats.files} files{board.rejected ? ` · ${board.rejected} unsourced claims dropped` : " · 0 unsourced claims"}</p>}
        </>}
        <div className="ml-auto flex items-center gap-2">
          {board && <span className="hidden sm:contents"><button className="sk-btn sk-btn-quiet" onClick={() => fileRef.current?.click()}>Add files</button></span>}
          <ModeButton />
        </div>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void B.ingest(f); }} />
      </header>

      {!board ? (
        <Start ready={B.ready} boards={B.boards} onFiles={() => fileRef.current?.click()} onPaste={() => setPaste(true)} onSample={() => void B.replaySample()} onOpen={(id) => void B.openId(id)} onDelete={(id) => void B.remove(id)} />
      ) : (
        <>
          <main className="relative min-h-0 flex-1">
            <Graph board={board} version={B.version} visible={visible} linkVisible={linkVisible} selected={selected} lit={lit} onSelect={select} handle={graph} inset={{ right: showPanel && wide ? 400 : 0, bottom: showPanel && !wide ? Math.round(innerH * 0.6) : 110 }} />

            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3 sm:inset-x-4">
              <div className="pointer-events-auto min-w-0 max-w-[min(560px,calc(100vw-80px))] overflow-x-auto [scrollbar-width:none]"><Legend board={board} version={B.version} hidden={hidden} toggle={(k) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; })} /></div>
              <div className="pointer-events-auto flex gap-1.5">
                {board.sample && <span className="hidden md:contents"><button className="sk-btn sk-btn-quiet !min-h-9 !px-3 !text-[11px]" onClick={() => void B.rereadSample()} title="Read these 20 emails again with your own AI mode">Read it live with my AI</button></span>}
                <button className="sk-icon-btn border border-line bg-bg/80" onClick={() => graph.current?.fit()} aria-label="Fit the board to the screen" title="Fit (F)">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" /></svg>
                </button>
              </div>
            </div>

            {B.log.length > 0 && (
              <div className={`absolute bottom-[76px] left-3 z-10 max-h-[38%] w-[min(440px,calc(100%-24px))] sm:left-4 ${showPanel ? "max-lg:hidden" : "max-sm:hidden"}`}>
                <OpsLog log={B.log} phase={B.phase} onStop={B.cancel} />
              </div>
            )}

            {/* ask bar */}
            <div className={`absolute inset-x-3 bottom-3 z-10 sm:left-1/2 sm:right-auto sm:w-[min(620px,calc(100%-32px))] sm:-translate-x-1/2 ${showPanel ? "lg:left-[calc(50%-200px)]" : ""}`}>
              {matches.length > 0 && (
                <ul className="sk-rise mb-1.5 overflow-hidden rounded-[var(--radius-sm)] border border-line bg-card shadow-[var(--shadow-2)]">
                  {matches.map((e) => (
                    <li key={e.id}><button className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-bg-2" onClick={() => { setQ(""); select(e.id); }}>
                      <KindMark kind={e.kind} size={9} /> {e.name} <span className="ml-auto font-mono text-[10.5px] text-muted">open dossier</span>
                    </button></li>
                  ))}
                </ul>
              )}
              {turns.length === 0 && !q && B.phase.kind === "idle" && board.entities.length > 0 && (
                <div className="mb-1.5 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                  {(board.sample ? SAMPLE_QS : OWN_QS).map((s) => (
                    <button key={s} onClick={() => void ask(s)} className="shrink-0 rounded-full border border-line bg-bg/85 px-3 py-1.5 text-[12.5px] text-fg/85 backdrop-blur transition-colors duration-150 hover:border-accent hover:text-fg">{s}</button>
                  ))}
                </div>
              )}
              <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} className="flex items-center gap-2 rounded-[var(--radius)] border border-line bg-card/95 p-1.5 pl-3.5 shadow-[var(--shadow-3)] backdrop-blur-md focus-within:border-accent">
                <span className="font-mono text-xs text-accent">›</span>
                <input ref={askRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the board, or find a name…" aria-label="Ask the board a question"
                  className="min-h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
                <kbd className="hidden rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted sm:block">⌘K</kbd>
                {ai.busy ? <button type="button" className="sk-btn sk-btn-quiet" onClick={ai.stop}>Stop</button> : <button type="submit" className="sk-btn" disabled={!q.trim()}>Ask</button>}
              </form>
            </div>

            {/* dossier / briefing */}
            {showPanel && (
              <aside className="sk-rise absolute inset-x-0 bottom-0 z-30 flex max-h-[72dvh] flex-col rounded-t-[var(--radius)] border-t border-line bg-card shadow-[var(--shadow-3)] lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:max-h-none lg:w-[400px] lg:rounded-none lg:border-l lg:border-t-0">
                <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line lg:hidden" />
                <div className="overflow-y-auto overscroll-contain px-5 pb-6 pt-4">
                  {showPanel === "dossier" && selected
                    ? <Dossier board={board} version={B.version} id={selected} onSelect={select} onSource={setSource} onBrief={(e) => void ask(`Brief me on ${e.name}: who they are, who they're tied to, and what they knew when.`, e)} onClose={() => select(null)} />
                    : <Briefing turns={turns} live={ai.busy ? ai.text : null} error={ai.error?.message ?? null} board={board} onSelect={select} onCite={cite} onClose={() => setPanel(null)} />}
                </div>
              </aside>
            )}
          </main>
          <footer className="h-[72px] shrink-0 border-t border-line bg-bg">
            <Timeline board={board} version={B.version} range={range} setRange={(r) => { setPlaying(false); setRange(r); }} playing={playing} onPlay={play} />
          </footer>
        </>
      )}

      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="rounded-[var(--radius)] border-2 border-dashed border-accent px-10 py-8 text-center">
            <p className="font-display text-2xl font-semibold">Drop to pin it to the board</p>
            <p className="mt-2 font-mono text-xs text-muted">Read in this browser. Never uploaded to us.</p>
          </div>
        </div>
      )}
      {paste && <PasteDialog onClose={() => setPaste(false)} onSubmit={(text, name) => { setPaste(false); void B.ingest({ text, name }); }} />}
      {source && board && <SourceViewer board={board} x={source} onClose={() => setSource(null)} />}
      {studio.status && null}
    </div>
  );
}

function Briefing({ turns, live, error, board, onSelect, onCite, onClose }: { turns: Turn[]; live: string | null; error: string | null; board: NonNullable<ReturnType<typeof useBoard>["board"]>; onSelect: (id: string) => void; onCite: (id: string) => void; onClose: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  // scroll the panel (the nearest scroller), not the app shell
  useEffect(() => { const sc = end.current?.closest(".overflow-y-auto"); if (sc) sc.scrollTop = sc.scrollHeight; }, [turns.length, live]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Label>Briefing · {turns.length} question{turns.length > 1 ? "s" : ""}</Label>
        <button onClick={onClose} className="sk-icon-btn -mr-2 text-muted hover:text-fg" aria-label="Close briefing">✕</button>
      </div>
      {turns.map((t, i) => {
        const text = i === turns.length - 1 && live !== null ? live : t.a;
        return (
          <section key={i} className="sk-rise">
            <p className="font-display text-[17px] font-semibold leading-snug">{t.q}</p>
            <div className="mt-2.5">
              {text ? <Answer board={board} text={text} onSelect={onSelect} onCite={onCite} />
                : i === turns.length - 1 && error ? <p className="sk-error" role="alert">{error}</p>
                : <p className="flex items-center gap-2 font-mono text-xs text-muted"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Pulling the strings…</p>}
            </div>
          </section>
        );
      })}
      <div ref={end} />
    </div>
  );
}

function BoardMenu({ name, sample, boards, onOpen, onRename, onNew }: { name: string; sample: boolean; boards: { id: string; name: string; updatedAt: string }[]; onOpen: (id: string) => void; onRename: (n: string) => void; onNew: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; window.addEventListener("pointerdown", c); return () => window.removeEventListener("pointerdown", c); }, [open]);
  if (editing) return <input autoFocus defaultValue={name} aria-label="Board name" className="min-h-9 w-56 rounded-[3px] border border-accent bg-bg px-2 text-sm outline-none" onBlur={(e) => { onRename(e.target.value); setEditing(false); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }} />;
  return (
    <div ref={ref} className="relative min-w-0">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex min-h-11 min-w-0 max-w-[46vw] items-center gap-1.5 truncate text-sm sm:max-w-[320px]">
        <span className="truncate">{name}</span>{sample && <span className="rounded-[3px] border border-line px-1 font-mono text-[10px] text-muted">SAMPLE</span>}
        <svg width="9" height="9" viewBox="0 0 10 10" className="shrink-0 text-muted"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      {open && (
        <div role="menu" className="sk-rise absolute left-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-[var(--radius-sm)] border border-line bg-card shadow-[var(--shadow-3)]">
          {!sample && <button role="menuitem" className="flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-bg-2" onClick={() => { setOpen(false); setEditing(true); }}>Rename this board</button>}
          <button role="menuitem" className="flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-bg-2" onClick={() => { setOpen(false); onNew(); }}>New board</button>
          {boards.length > 0 && <p className="border-t border-line px-3 pb-1 pt-2.5 font-mono text-[10px] uppercase tracking-widest text-muted">On this browser</p>}
          {boards.slice(0, 8).map((b) => (
            <button key={b.id} role="menuitem" className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-bg-2" onClick={() => { setOpen(false); onOpen(b.id); }}>
              <span className="truncate">{b.name}</span><span className="shrink-0 font-mono text-[10px] text-muted">{new Date(b.updatedAt).toLocaleDateString()}</span>
            </button>
          ))}
          <button role="menuitem" className="flex min-h-11 w-full items-center border-t border-line px-3 text-left text-sm hover:bg-bg-2" onClick={() => { setOpen(false); onOpen(SAMPLE_ID); }}>Enron sample (20 emails)</button>
        </div>
      )}
    </div>
  );
}

function Start({ ready, boards, onFiles, onPaste, onSample, onOpen, onDelete }: { ready: boolean; boards: { id: string; name: string; updatedAt: string }[]; onFiles: () => void; onPaste: () => void; onSample: () => void; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <main className="relative flex flex-1 items-start justify-center overflow-y-auto px-4 py-10 sm:items-center">
      <div className="sk-stagger w-full max-w-2xl">
        <Label>New board</Label>
        <h1 className="mt-3 text-4xl font-semibold leading-[1.02] sm:text-5xl">Drop in anything.<br />Watch it connect.</h1>
        <p className="mt-4 max-w-lg text-muted">Group chats, inboxes, PDFs, bank statements. Stringboard pulls out every person, company, place and money amount, strings them together, and cites the line each string came from.</p>
        <button onClick={onFiles} className="group mt-8 flex w-full flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-dashed border-line bg-card/60 px-6 py-10 transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-accent">
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden><circle cx="7" cy="9" r="3.5" fill="#f2f2f0" /><rect x="23" y="4" width="7" height="7" fill="#5cb8ff" /><path d="M17 23l5 5-5 5-5-5z" fill="#ff7a3d" /><path d="M8.5 11.5Q14 24 15 26M10 9.5Q18 10 23 8M20 27Q26 22 26.5 11" stroke="#ff4d00" strokeWidth="1.3" /></svg>
          <span className="font-display text-lg font-semibold">Choose files or drop them anywhere</span>
          <span className="text-center font-mono text-[11px] leading-relaxed text-muted">WhatsApp export (.txt) · Telegram or Instagram (.json) · .eml / .mbox · PDF · CSV · text</span>
        </button>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button onClick={onSample} className="sk-btn">Open the Enron sample</button>
          <button onClick={onPaste} className="sk-btn sk-btn-quiet">Paste text instead</button>
        </div>
        <p className="mt-5 flex items-start gap-2 font-mono text-[11px] leading-relaxed text-muted"><span className="text-[var(--ok)]">●</span> Files are read in this browser and boards are saved in this browser. With a local model, nothing leaves your computer at all.</p>
        {ready && boards.length > 0 && (
          <div className="mt-10">
            <Label>Your boards</Label>
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {boards.map((b) => (
                <li key={b.id} className="flex items-center gap-2">
                  <button className="flex min-h-12 flex-1 items-center justify-between gap-3 text-left text-sm hover:underline hover:underline-offset-4" onClick={() => onOpen(b.id)}>
                    <span className="truncate">{b.name}</span><span className="font-mono text-[10.5px] text-muted">{new Date(b.updatedAt).toLocaleString()}</span>
                  </button>
                  <button className="sk-icon-btn text-muted hover:text-[var(--danger)]" aria-label={`Delete ${b.name}`} onClick={() => { if (confirm(`Delete "${b.name}" from this browser? This can't be undone.`)) onDelete(b.id); }}>✕</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

function PasteDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (text: string, name: string) => void }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-6" onClick={onClose} role="dialog" aria-modal aria-label="Paste text">
      <form className="sk-rise w-full max-w-2xl rounded-t-[var(--radius)] border border-line bg-card p-5 shadow-[var(--shadow-3)] sm:rounded-[var(--radius)]" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSubmit(text, name.trim() || "Pasted text"); }}>
        <Label>Paste text</Label>
        <label className="mt-3 block text-sm">Name it <input value={name} onChange={(e) => setName(e.target.value)} placeholder="The group chat, the lease, the thread…" className="mt-1 block min-h-11 w-full rounded-[3px] border border-line bg-bg px-3 outline-none focus:border-accent" /></label>
        <label className="mt-3 block text-sm">Text <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="Paste a chat, an email thread, notes, anything." className="mt-1 block w-full resize-y rounded-[3px] border border-line bg-bg p-3 font-mono text-[12.5px] outline-none focus:border-accent" /></label>
        <div className="mt-4 flex justify-end gap-2"><button type="button" className="sk-btn sk-btn-quiet" onClick={onClose}>Cancel</button><button className="sk-btn" disabled={!text.trim()}>Pin it to the board</button></div>
      </form>
    </div>
  );
}
