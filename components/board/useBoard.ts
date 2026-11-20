"use client";
// Board state for the app: the open board (mutated in place, `version` bumps re-render), saving to IndexedDB, the
// ingest pipeline (parse → headers → model, chunk by chunk) and the sample's replayed build.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Board, Doc, Extraction } from "@/lib/types";
import { emptyBoard } from "@/lib/types";
import { addMetadata, chunkDocs, knownFor, mergeExtraction } from "@/lib/board";
import { fileToDocs, textToDocs } from "@/lib/parse";
import { enronBoard, enronSteps, SAMPLE_ID } from "@/lib/samples/enron";
import { deleteBoard, listBoards, loadBoard, saveBoard } from "@/lib/store";
import { useStudio } from "@/kit/react/studio";

export interface LogLine { id: number; text: string; tone: "info" | "ok" | "warn" | "err" | "dim" }
export type Phase = { kind: "idle" } | { kind: "parsing" } | { kind: "reading"; done: number; total: number } | { kind: "replay"; done: number; total: number };

let lid = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useBoard() {
  const studio = useStudio();
  const [board, setBoard] = useState<Board | null>(null);
  const [version, setVersion] = useState(0);
  const [boards, setBoards] = useState<Awaited<ReturnType<typeof listBoards>>>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [ready, setReady] = useState(false);
  const cur = useRef<Board | null>(null);
  const stop = useRef<AbortController | null>(null);
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string, tone: LogLine["tone"] = "info") => setLog((l) => [...l.slice(-80), { id: ++lid, text, tone }]), []);
  const bump = useCallback(() => {
    setVersion((v) => v + 1);
    if (saveT.current) clearTimeout(saveT.current);
    saveT.current = setTimeout(() => { if (cur.current && !cur.current.sample) void saveBoard(cur.current).then(() => listBoards().then(setBoards)); }, 600);
  }, []);
  const open = useCallback((b: Board | null) => { cur.current = b; setBoard(b); setVersion((v) => v + 1); setLog([]); }, []);

  useEffect(() => {
    void (async () => {
      setBoards(await listBoards());
      const want = new URLSearchParams(location.search).get("board");
      if (want && want !== SAMPLE_ID) { const b = await loadBoard(want); if (b) open(b); }
      setReady(true);
    })();
  }, [open]);

  const openId = useCallback(async (id: string) => {
    if (id === SAMPLE_ID) { open(enronBoard()); return; }
    const b = await loadBoard(id); if (b) open(b);
  }, [open]);

  /** The sample, built in front of you: headers first, then one email's reading at a time. No AI is called. */
  const replaySample = useCallback(async () => {
    stop.current?.abort();
    const ac = new AbortController(); stop.current = ac;
    const { docs, steps } = enronSteps();
    const b: Board = { ...emptyBoard("Enron: 20 public emails"), id: SAMPLE_ID, sample: true, docs: [] };
    open(b);
    const fast = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    say("SAMPLE · 20 public Enron emails (FERC release, 2003)", "dim");
    say(`Parsed ${docs.length} emails · 2000-05-11 → 2001-12-06`);
    b.docs = docs;
    addMetadata(b, docs);
    bump();
    say(`Headers: ${b.entities.filter((e) => e.kind === "person").length} people, ${b.links.length} email strings. No AI yet.`, "ok");
    setPhase({ kind: "replay", done: 0, total: steps.length });
    await wait(fast ? 0 : 900);
    let i = 0;
    for (const s of steps) {
      if (ac.signal.aborted) return;
      const r = mergeExtraction(b, { id: s.doc.id, doc: s.doc.id, text: s.doc.text, header: s.doc.name, date: s.doc.date }, s.extraction as Extraction);
      bump();
      setPhase({ kind: "replay", done: ++i, total: steps.length });
      say(`${s.doc.date?.slice(0, 10)} "${s.doc.name.slice(0, 44)}" · +${r.entities.length} entities, +${r.links.length} strings${r.events.length ? `, ${r.events.length} event` : ""}`);
      await wait(fast ? 0 : 260);
    }
    say(`Board ready: ${b.entities.length} entities, ${b.links.filter((l) => l.origin === "ai").length} red strings, ${b.events.length} events. Every string cites its email.`, "ok");
    setPhase({ kind: "idle" });
  }, [bump, open, say]);

  /** Real files → the open board (or a new one). Headers land instantly; the model reads chunk by chunk. */
  const ingest = useCallback(async (input: File[] | { text: string; name?: string }) => {
    stop.current?.abort();
    const ac = new AbortController(); stop.current = ac;
    let b = cur.current;
    if (!b || b.sample) {
      const first = Array.isArray(input) ? input[0]?.name.replace(/\.[^.]+$/, "") : input.name;
      b = emptyBoard(first ? `Board: ${first}`.slice(0, 60) : "New board");
      open(b);
    }
    setPhase({ kind: "parsing" });
    const docs: Doc[] = [];
    if (Array.isArray(input)) {
      for (const f of input) {
        try { const d = await fileToDocs(f); docs.push(...d); say(`${f.name} → ${d.length > 1 ? `${d.length} emails` : d[0]!.type === "chat" ? `chat, ${d[0]!.messages?.length ?? 0} messages` : `${d[0]!.type}, ${(d[0]!.text.length / 1000).toFixed(1)}k chars`}`); }
        catch (e) { say(e instanceof Error ? e.message : `Couldn't read ${f.name}.`, "err"); }
      }
    } else docs.push(...textToDocs(input.text, input.name ?? "Pasted text"));
    if (!docs.length) { setPhase({ kind: "idle" }); return; }
    const before = b.entities.length, beforeL = b.links.length;
    b.docs.push(...docs);
    addMetadata(b, docs);
    bump();
    const fromHeaders = b.entities.length - before;
    if (fromHeaders) say(`Headers: +${fromHeaders} nodes, +${b.links.length - beforeL} strings from who-talks-to-whom. No AI yet.`, "ok");

    const mode = studio.status?.active ?? null;
    const local = mode === "local";
    const chunks = chunkDocs(docs, local ? 2600 : 9000);
    if (!mode) {
      say("Pick how to power the AI to read the text itself. The header graph is already on the board.", "warn");
      studio.openPicker({ message: "Pick an AI to read your files. Nothing leaves your computer with a local model." });
      setPhase({ kind: "idle" });
      return;
    }
    say(`Reading ${chunks.length} chunk${chunks.length > 1 ? "s" : ""} with ${studio.status?.modes.find((m) => m.id === mode)?.label ?? mode}${local ? " (on this computer)" : ""}…`, "dim");
    if (local) {
      const model = studio.status?.modes.find((m) => m.id === "local")?.model ?? "";
      if (/(^|[^0-9])(1|1\.5|2|3|3\.2)b|llama3\.2(:latest)?$|qwen2\.5:(0\.5|1\.5|3)b/i.test(model)) say(`${model} is small and misses strings. qwen2.5:7b or llama3.1:8b reads far better (ollama pull qwen2.5:7b).`, "warn");
    }
    setPhase({ kind: "reading", done: 0, total: chunks.length });
    let done = 0, next = 0, failed = 0;
    const worker = async () => {
      while (next < chunks.length && !ac.signal.aborted) {
        const c = chunks[next++]!;
        try {
          const res = await fetch("/api/extract", { method: "POST", signal: ac.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ text: c.text, known: knownFor(b!), tier: "fast", lite: local }) });
          const j = (await res.json().catch(() => ({}))) as Extraction & { error?: string; action?: { label: string; url: string } };
          if (!res.ok) {
            if (res.status === 401 || res.status === 409 || res.status === 402) { studio.openPicker({ message: j.error ?? "This AI mode needs attention.", action: j.action }); ac.abort(); say(j.error ?? "Stopped: the AI mode needs attention.", "err"); return; }
            failed++; say(`${c.header}: ${j.error ?? `failed (${res.status})`}`, "warn"); continue;
          }
          const r = mergeExtraction(b!, c, j);
          bump();
          say(`${c.header.slice(0, 48)} · +${r.entities.length} entities, +${r.links.length} strings${r.events.length ? `, +${r.events.length} events` : ""}${r.rejected ? ` · dropped ${r.rejected} unsourced` : ""}`, r.rejected ? "warn" : "info");
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          failed++; say(`${c.header}: ${(e as Error).message}`, "warn");
        } finally {
          setPhase({ kind: "reading", done: ++done, total: chunks.length });
        }
      }
    };
    await Promise.all(Array.from({ length: local ? 1 : 3 }, worker));
    if (!ac.signal.aborted) say(`Done. ${b.entities.length} entities, ${b.links.filter((l) => l.origin === "ai").length} red strings, ${b.events.length} events${b.rejected ? `, ${b.rejected} unsourced claims dropped` : ""}${failed ? `, ${failed} chunks failed` : ""}.`, "ok");
    setPhase({ kind: "idle" });
    bump();
  }, [bump, open, say, studio]);

  /** The sample's text, read live by the person's own AI mode (proof the board isn't canned). */
  const rereadSample = useCallback(async () => {
    const b = { ...emptyBoard("Enron, read live") };
    open(b);
    const files = enronSteps().docs.map((d) => new File([d.text.replace(/^Date: .*$/m, `Date: ${new Date(d.date!).toUTCString()}`)], `${d.id}.eml`, { type: "message/rfc822" }));
    await ingest(files);
  }, [ingest, open]);

  const cancel = useCallback(() => { stop.current?.abort(); setPhase({ kind: "idle" }); say("Stopped.", "warn"); }, [say]);
  const rename = useCallback((name: string) => { if (cur.current) { cur.current.name = name.slice(0, 80) || cur.current.name; bump(); } }, [bump]);
  const remove = useCallback(async (id: string) => { await deleteBoard(id); setBoards(await listBoards()); if (cur.current?.id === id) open(null); }, [open]);

  return { board, version, boards, log, phase, ready, open, openId, replaySample, rereadSample, ingest, cancel, rename, remove, bump };
}
