"use client";
// Everything around the graph: the dossier, the source viewer, the timeline scrubber, the ask panel and the ops log.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Board, Entity, Evidence, Kind } from "@/lib/types";
import { KIND_LABEL, KINDS } from "@/lib/types";
import { activity, degree } from "@/lib/board";
import { parseAnswer } from "@/lib/context";
import { KIND_COLOR } from "./Graph";
import type { LogLine, Phase } from "./useBoard";

const fmt = (iso?: string, long = false) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-GB", long ? { day: "numeric", month: "short", year: "numeric" } : { month: "short", year: "numeric" });
};

export function KindMark({ kind, size = 10 }: { kind: Kind; size?: number }) {
  const c = KIND_COLOR[kind];
  const s = size;
  const path = {
    person: <circle cx={s / 2} cy={s / 2} r={s / 2 - 0.5} fill={c} />,
    org: <rect x={0.5} y={0.5} width={s - 1} height={s - 1} fill={c} />,
    thing: <path d={`M${s / 2} 0 L${s} ${s / 2} L${s / 2} ${s} L0 ${s / 2}Z`} fill={c} />,
    place: <path d={`M${s / 2} 0 L${s} ${s} L0 ${s}Z`} fill={c} />,
    money: <path d={`M${s * 0.25} 0.5 L${s * 0.75} 0.5 L${s} ${s / 2} L${s * 0.75} ${s - 0.5} L${s * 0.25} ${s - 0.5} L0 ${s / 2}Z`} fill={c} />,
    account: <rect x={0.5} y={s * 0.2} width={s - 1} height={s * 0.6} fill={c} />,
  }[kind];
  return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden className="inline-block shrink-0">{path}</svg>;
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted ${className}`}>{children}</p>;
}

// ---------------------------------------------------------------- legend / filters
export function Legend({ board, version, hidden, toggle }: { board: Board; version: number; hidden: Set<Kind>; toggle: (k: Kind) => void }) {
  const counts = useMemo(() => {
    const c = new Map<Kind, number>();
    for (const e of board.entities) c.set(e.kind, (c.get(e.kind) ?? 0) + 1);
    return c;
  }, [board, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex gap-1.5 sm:flex-wrap">
      {KINDS.filter((k) => counts.get(k)).map((k) => (
        <button key={k} onClick={() => toggle(k)} aria-pressed={!hidden.has(k)}
          className={`flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-2 font-mono text-[11px] transition-[opacity,border-color] duration-150 ${hidden.has(k) ? "border-line opacity-40" : "border-line bg-bg/80 hover:border-muted"}`}>
          <KindMark kind={k} size={8} /> {KIND_LABEL[k]} <span className="text-muted">{counts.get(k)}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- dossier
export function Dossier({ board, version, id, onSelect, onSource, onBrief, onClose }: {
  board: Board; version: number; id: string; onSelect: (id: string) => void; onSource: (x: Evidence) => void; onBrief: (e: Entity) => void; onClose: () => void;
}) {
  const e = board.entities.find((x) => x.id === id);
  const data = useMemo(() => {
    if (!e) return null;
    const name = new Map(board.entities.map((x) => [x.id, x]));
    const ev = new Map(board.evidence.map((x) => [x.id, x]));
    const conns = board.links.filter((l) => l.a === e.id || l.b === e.id).map((l) => {
      const other = name.get(l.a === e.id ? l.b : l.a)!;
      return { l, other, out: l.a === e.id };
    }).filter((c) => c.other).sort((a, b) => (a.l.origin === "ai" ? -1 : 1) - (b.l.origin === "ai" ? -1 : 1) || b.l.count - a.l.count);
    const events = board.events.filter((v) => v.who.includes(e.id)).sort((a, b) => a.date.localeCompare(b.date));
    const quotes = e.evidence.map((x) => ev.get(x)).filter((x): x is Evidence => !!x && !/^Subject: /.test(x.quote)).slice(0, 30);
    const docs = new Set(e.evidence.map((x) => ev.get(x)?.doc).filter(Boolean));
    const grid = activity(board, e);
    const rank = [...degree(board).entries()].sort((a, b) => b[1] - a[1]).findIndex(([k]) => k === e.id) + 1;
    return { conns, events, quotes, docs: docs.size, grid, rank, ev };
  }, [board, version, e]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!e || !data) return null;
  const docName = (d: string) => board.docs.find((x) => x.id === d)?.name ?? "file";

  return (
    <div key={e.id} className="sk-stagger flex flex-col gap-5">
      <div>
        <div className="flex items-center justify-between gap-3">
          <Label className="flex items-center gap-2"><KindMark kind={e.kind} size={9} /> {KIND_LABEL[e.kind]} · dossier</Label>
          <button onClick={onClose} className="sk-icon-btn -mr-2 text-muted hover:text-fg" aria-label="Close dossier">✕</button>
        </div>
        <h2 className="mt-1 text-2xl font-semibold leading-tight">{e.name}</h2>
        {e.note && <p className="mt-1.5 text-sm text-muted">{e.note}</p>}
        <dl className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-sm)] border border-line bg-line font-mono text-xs">
          {[["Strings", data.conns.length], ["Files", data.docs], ["Rank", data.rank ? `#${data.rank}` : "-"]].map(([k, v]) => (
            <div key={k} className="bg-card px-3 py-2"><dt className="text-[10px] uppercase tracking-widest text-muted">{k}</dt><dd className="mt-0.5 text-base text-fg">{v}</dd></div>
          ))}
        </dl>
        {(e.firstSeen || e.lastSeen) && <p className="mt-2 font-mono text-[11px] text-muted">Seen {fmt(e.firstSeen, true)}{e.lastSeen && e.lastSeen.slice(0, 10) !== e.firstSeen?.slice(0, 10) ? ` → ${fmt(e.lastSeen, true)}` : ""}</p>}
        {e.aliases.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            <span className="mr-1 self-center font-mono text-[10.5px] uppercase tracking-widest text-muted">Also seen as</span>
            {e.aliases.slice(0, 8).map((a) => <span key={a} className="rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[11px] text-fg/80">{a}</span>)}
          </div>
        )}
        <button onClick={() => onBrief(e)} className="sk-btn mt-4 w-full">Brief me on {e.name.split(" ")[0]}</button>
      </div>

      {data.grid && <PatternOfLife grid={data.grid} />}

      {data.conns.length > 0 && (
        <section>
          <Label>Connections</Label>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {data.conns.slice(0, 40).map(({ l, other, out }) => (
              <li key={l.id}>
                <button onClick={() => onSelect(other.id)} className="group flex min-h-11 w-full items-center gap-2.5 py-2 text-left">
                  <KindMark kind={other.kind} size={8} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-mono text-[11px] ${l.origin === "ai" ? "text-accent" : "text-muted"}`}>
                      {l.origin === "ai" ? (out ? `${l.label} →` : `← ${l.label}`) : l.label === "email domain" ? "domain" : `${l.label} ×${l.count}`}
                    </span>
                    <span className="block truncate text-sm group-hover:underline group-hover:underline-offset-4">{other.name}</span>
                  </span>
                  {l.evidence.length > 0 && <span className="font-mono text-[10px] text-muted">{l.evidence.length} src</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.events.length > 0 && (
        <section>
          <Label>Timeline</Label>
          <ol className="mt-2 space-y-2 border-l border-line pl-3">
            {data.events.map((v) => (
              <li key={v.id} className="relative">
                <span className="absolute -left-[16.5px] top-1.5 h-2 w-2 rotate-45 bg-accent" />
                <p className="font-mono text-[11px] text-muted">{fmt(v.date, true)}</p>
                <button className="text-left text-sm hover:underline hover:underline-offset-4" onClick={() => { const x = data.ev.get(v.evidence[0]!); if (x) onSource(x); }}>{v.title}</button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.quotes.length > 0 && (
        <section>
          <Label>In their own words · {data.quotes.length} sources</Label>
          <div className="mt-2 space-y-2">
            {data.quotes.map((x) => (
              <button key={x.id} onClick={() => onSource(x)} className="block w-full rounded-[var(--radius-sm)] border border-line bg-bg-2/60 px-3 py-2.5 text-left transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-muted">
                <span className="block text-[13px] leading-snug">“{x.quote.replace(/\s+/g, " ")}”</span>
                <span className="mt-1.5 block truncate font-mono text-[10.5px] text-muted">{docName(x.doc)}{x.date ? ` · ${fmt(x.date, true)}` : ""}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PatternOfLife({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  const days = ["S", "M", "T", "W", "T", "F", "S"];
  const total = grid.flat().reduce((a, b) => a + b, 0);
  const peak = grid.flatMap((row, d) => row.map((v, h) => ({ v, d, h }))).sort((a, b) => b.v - a.v)[0]!;
  return (
    <section>
      <Label>Pattern of life · {total} messages</Label>
      <div className="mt-2 grid gap-[2px]" style={{ gridTemplateColumns: "14px repeat(24, 1fr)" }}>
        {grid.map((row, d) => [
          <span key={`l${d}`} className="font-mono text-[9px] leading-[10px] text-muted">{days[d]}</span>,
          ...row.map((v, h) => <span key={`${d}-${h}`} title={`${days[d]} ${h}:00 · ${v}`} className="h-[10px] rounded-[1px]" style={{ background: v ? `rgba(255,77,0,${0.18 + 0.82 * (v / max)})` : "rgba(255,255,255,0.04)" }} />),
        ])}
      </div>
      <p className="mt-1.5 font-mono text-[10.5px] text-muted">Most active {["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][peak.d]} around {peak.h}:00 (your time zone)</p>
    </section>
  );
}

// ---------------------------------------------------------------- source viewer
export function SourceViewer({ board, x, onClose }: { board: Board; x: Evidence; onClose: () => void }) {
  const doc = board.docs.find((d) => d.id === x.doc);
  const mark = useRef<HTMLElement>(null);
  useEffect(() => { const m = mark.current, pre = m?.closest("pre"); if (m && pre) pre.scrollTop = Math.max(0, m.offsetTop - pre.clientHeight / 2); }, [x]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  if (!doc) return null;
  // find the quote in the original text, tolerant of line breaks
  const pattern = x.quote.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const m = new RegExp(pattern, "i").exec(doc.text);
  const text = doc.text.slice(0, 60_000);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onClick={onClose} role="dialog" aria-modal aria-label={`Source: ${doc.name}`}>
      <div className="sk-rise flex max-h-[86dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[var(--radius)] border border-line bg-card shadow-[var(--shadow-3)] sm:rounded-[var(--radius)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <Label>Source · {doc.type}{doc.sample ? " · sample" : ""}</Label>
            <p className="mt-0.5 truncate font-semibold">{doc.name}</p>
          </div>
          <button onClick={onClose} className="sk-icon-btn -mr-2 text-muted hover:text-fg" aria-label="Close source">✕</button>
        </div>
        <pre className="relative flex-1 overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-[12.5px] leading-relaxed text-fg/85">
          {m ? <>{text.slice(0, m.index)}<mark ref={mark} className="rounded-[2px] bg-accent px-0.5 text-accent-fg">{text.slice(m.index, m.index + m[0].length)}</mark>{text.slice(m.index + m[0].length)}</> : text}
        </pre>
        <p className="border-t border-line px-5 py-2.5 font-mono text-[10.5px] text-muted">Quote checked against this file{m ? "" : " (whitespace differs)"} · stays on your device</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- timeline
export interface Range { a: number; b: number }
export function Timeline({ board, version, range, setRange, playing, onPlay }: {
  board: Board; version: number; range: Range | null; setRange: (r: Range | null) => void; playing: boolean; onPlay: () => void;
}) {
  const data = useMemo(() => {
    const ts: number[] = [];
    for (const x of board.evidence) if (x.date) ts.push(new Date(x.date).getTime());
    for (const d of board.docs) for (const m of d.messages ?? []) if (m.at) ts.push(new Date(m.at).getTime());
    const evs = board.events.map((v) => ({ v, t: new Date(v.date).getTime() })).filter((x) => !isNaN(x.t));
    for (const x of evs) ts.push(x.t);
    const ok = ts.filter((t) => !isNaN(t) && t > 0);
    if (ok.length < 2) return null;
    const min = Math.min(...ok), max = Math.max(...ok);
    if (max - min < 60_000) return null;
    const N = 72;
    const bins = Array(N).fill(0) as number[];
    for (const t of ok) bins[Math.min(N - 1, Math.floor(((t - min) / (max - min)) * N))]++;
    return { min, max, bins, top: Math.max(...bins), evs };
  }, [board, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef<null | { mode: "a" | "b" | "new"; start: number }>(null);
  if (!data) return <div className="flex h-full items-center px-4 font-mono text-[11px] text-muted">No dates yet. Emails and chats bring their own.</div>;
  const { min, max, bins, top, evs } = data;
  const r = range ?? { a: min, b: max };
  const x = (t: number) => ((t - min) / (max - min)) * 100;
  const tAt = (clientX: number) => { const rc = ref.current!.getBoundingClientRect(); return min + Math.min(1, Math.max(0, (clientX - rc.left) / rc.width)) * (max - min); };
  const down = (e: React.PointerEvent) => {
    const t = tAt(e.clientX);
    const near = (u: number) => Math.abs(x(u) - x(t)) < 2.5;
    dragging.current = { mode: near(r.a) ? "a" : near(r.b) ? "b" : "new", start: t };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (dragging.current.mode === "new") setRange({ a: t, b: t });
  };
  const move = (e: React.PointerEvent) => {
    const D = dragging.current; if (!D) return;
    const t = tAt(e.clientX);
    if (D.mode === "a") setRange({ a: Math.min(t, r.b), b: r.b });
    else if (D.mode === "b") setRange({ a: r.a, b: Math.max(t, r.a) });
    else setRange({ a: Math.min(D.start, t), b: Math.max(D.start, t) });
  };
  const up = () => { const D = dragging.current; dragging.current = null; if (D?.mode === "new" && range && range.b - range.a < (max - min) / 200) setRange(null); };
  const full = !range || (range.a <= min && range.b >= max);
  return (
    <div className="flex h-full items-stretch gap-3 px-3 sm:px-4">
      <button onClick={onPlay} className="sk-icon-btn my-auto shrink-0 border border-line" aria-label={playing ? "Stop the replay" : "Replay the board through time"} title="Replay through time">
        {playing ? <svg width="10" height="10" viewBox="0 0 10 10"><rect width="3.5" height="10" fill="currentColor" /><rect x="6.5" width="3.5" height="10" fill="currentColor" /></svg>
          : <svg width="10" height="11" viewBox="0 0 10 11"><path d="M0 0 L10 5.5 L0 11Z" fill="currentColor" /></svg>}
      </button>
      <div className="relative flex min-w-0 flex-1 flex-col justify-end py-2">
        <div className="mb-1 flex justify-between font-mono text-[10.5px] text-muted">
          <span>{fmt(new Date(r.a).toISOString(), true)}</span>
          {!full && <button className="text-accent hover:underline" onClick={() => setRange(null)}>Show all time</button>}
          <span>{fmt(new Date(r.b).toISOString(), true)}</span>
        </div>
        <div ref={ref} className="relative h-12 cursor-crosshair select-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          role="slider" aria-label="Time range" aria-valuemin={min} aria-valuemax={max} aria-valuenow={r.b} aria-valuetext={`${fmt(new Date(r.a).toISOString(), true)} to ${fmt(new Date(r.b).toISOString(), true)}`} tabIndex={0}
          onKeyDown={(e) => { const step = (max - min) / 40; if (e.key === "ArrowLeft") setRange({ a: r.a, b: Math.max(r.a, r.b - step) }); if (e.key === "ArrowRight") setRange({ a: r.a, b: Math.min(max, r.b + step) }); }}>
          <div className="absolute inset-0 flex items-end gap-px">
            {bins.map((v, i) => {
              const t = min + ((i + 0.5) / bins.length) * (max - min);
              const inside = t >= r.a && t <= r.b;
              return <span key={i} className="flex-1 rounded-t-[1px]" style={{ height: `${v ? 8 + (v / top) * 72 : 0}%`, background: inside ? "rgba(242,242,240,0.42)" : "rgba(242,242,240,0.1)" }} />;
            })}
          </div>
          {evs.map(({ v, t }) => <span key={v.id} title={`${fmt(v.date, true)}: ${v.title}`} className="absolute top-0 h-2 w-2 -translate-x-1/2 rotate-45 bg-accent" style={{ left: `${x(t)}%`, opacity: t >= r.a && t <= r.b ? 1 : 0.25 }} />)}
          {!full && <>
            <span className="pointer-events-none absolute inset-y-0 border-l-2 border-accent" style={{ left: `${x(r.a)}%` }} />
            <span className="pointer-events-none absolute inset-y-0 border-l-2 border-accent" style={{ left: `${x(r.b)}%` }} />
            <span className="pointer-events-none absolute inset-y-0 bg-accent/10" style={{ left: `${x(r.a)}%`, width: `${x(r.b) - x(r.a)}%` }} />
          </>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ask
export interface Turn { q: string; a: string; focus?: string }
export function Answer({ board, text, onSelect, onCite }: { board: Board; text: string; onSelect: (id: string) => void; onCite: (id: string) => void }) {
  const pieces = useMemo(() => parseAnswer(text, board), [text, board]);
  const order = new Map<string, number>();
  return (
    <div className="whitespace-pre-wrap text-[14px] leading-relaxed">
      {pieces.map((p, i) => {
        if (p.t === "text") return <span key={i}>{p.v}</span>;
        if (p.t === "ent") return <button key={i} onClick={() => onSelect(p.id)} className="font-medium text-fg underline decoration-accent decoration-2 underline-offset-[3px] hover:text-accent">{p.v}</button>;
        if (!order.has(p.id)) order.set(p.id, order.size + 1);
        return <button key={i} onClick={() => onCite(p.id)} className="mx-[1px] inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-[3px] border border-accent/60 px-1 align-middle font-mono text-[10px] text-accent hover:bg-accent hover:text-accent-fg" aria-label={`Source ${order.get(p.id)}`}>{order.get(p.id)}</button>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------- ops log
export function OpsLog({ log, phase, onStop }: { log: LogLine[]; phase: Phase; onStop: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const busy = phase.kind !== "idle";
  const [open, setOpen] = useState(true);
  useEffect(() => { if (busy) setOpen(true); }, [busy]);
  useEffect(() => { const t = busy ? null : setTimeout(() => setOpen(false), 2600); return () => { if (t) clearTimeout(t); }; }, [busy]);
  // scroll the log itself, never its ancestors (scrollIntoView would scroll the whole app shell)
  useEffect(() => { const b = box.current; if (b) b.scrollTop = b.scrollHeight; }, [log, open]);
  const pct = phase.kind === "reading" || phase.kind === "replay" ? Math.round((phase.done / Math.max(1, phase.total)) * 100) : null;
  const last = log[log.length - 1];
  return (
    <div className="flex max-h-full flex-col overflow-hidden rounded-[var(--radius-sm)] border border-line bg-bg/90 shadow-[var(--shadow-2)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-1">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-7 min-w-0 flex-1 items-center gap-2 text-left">
          <Label className="flex shrink-0 items-center gap-2">
            {busy && <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" /></span>}
            {phase.kind === "parsing" ? "Parsing" : phase.kind === "reading" ? `Reading ${phase.done}/${phase.total}` : phase.kind === "replay" ? `Building ${phase.done}/${phase.total}` : `Log · ${log.length}`}
          </Label>
          {!open && last && <span className="truncate font-mono text-[11px] text-fg/70">{last.text}</span>}
        </button>
        {busy && phase.kind === "reading" ? <button onClick={onStop} className="min-h-7 font-mono text-[11px] text-muted hover:text-fg">Stop</button>
          : <span className="font-mono text-[11px] text-muted" aria-hidden>{open ? "−" : "+"}</span>}
      </div>
      {pct !== null && <div className="h-px bg-line"><div className="h-px bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} /></div>}
      {open && (
        <div ref={box} className="max-h-[210px] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.55]" aria-live="polite">
          {log.map((l) => (
            <p key={l.id} className={l.tone === "ok" ? "text-[var(--ok)]" : l.tone === "warn" ? "text-[#ffc940]" : l.tone === "err" ? "text-[var(--danger)]" : l.tone === "dim" ? "text-muted" : "text-fg/80"}>
              <span className="text-muted">▸ </span>{l.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
