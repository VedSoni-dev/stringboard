"use client";
// The landing's hero: the real board component building the Enron sample in front of you (no AI call, no mockup).
// Hover a node to see its strings; click one to light up its neighbourhood. Opening the app keeps going from there.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Board, Extraction } from "@/lib/types";
import { emptyBoard } from "@/lib/types";
import { addMetadata, mergeExtraction } from "@/lib/board";
import { enronSteps, SAMPLE_ID } from "@/lib/samples/enron";
import { Graph, type GraphHandle } from "@/components/board/Graph";

export function HeroBoard() {
  const [board] = useState<Board>(() => ({ ...emptyBoard("Enron: 20 public emails"), id: SAMPLE_ID, sample: true }));
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState({ done: 0, total: 20, date: "" });
  const graph = useRef<GraphHandle>(null);

  useEffect(() => {
    let alive = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { docs, steps } = enronSteps();
    board.docs = docs;
    addMetadata(board, docs);
    setVersion((v) => v + 1);
    let i = 0;
    const next = () => {
      if (!alive || i >= steps.length) return;
      const s = steps[i++]!;
      mergeExtraction(board, { id: s.doc.id, doc: s.doc.id, text: s.doc.text, header: s.doc.name, date: s.doc.date }, s.extraction as Extraction);
      setVersion((v) => v + 1);
      setStep({ done: i, total: steps.length, date: s.doc.date?.slice(0, 10) ?? "" });
      if (i % 5 === 0 || i === steps.length) graph.current?.fit(900);
      if (i === steps.length) { setTimeout(() => alive && graph.current?.fit(1200), 1800); setTimeout(() => alive && graph.current?.fit(1200), 4200); }
      setTimeout(next, reduced ? 0 : 230);
    };
    const t = setTimeout(next, reduced ? 0 : 700);
    return () => { alive = false; clearTimeout(t); };
  }, [board]);

  const red = board.links.filter((l) => l.origin === "ai").length;
  const sel = board.entities.find((e) => e.id === selected);
  return (
    <div className="relative h-full w-full">
      <Graph board={board} version={version} selected={selected} onSelect={setSelected} handle={graph} embedded inset={{ bottom: 48 }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-line bg-bg/85 px-4 py-2.5 font-mono text-[11px] backdrop-blur-md">
        <span className="min-w-0 text-muted">
          {step.done < step.total ? <>Reading email {step.done}/{step.total} · {step.date}</> : <>{board.entities.length} entities · <span className="text-accent">{red} red strings</span> · 0 made-up quotes</>}
        </span>
        {sel ? <Link href={`/app?sample`} className="pointer-events-auto shrink-0 text-fg underline decoration-accent underline-offset-4">Open {sel.name.split(" ")[0]}&apos;s dossier →</Link>
          : <span className="hidden shrink-0 text-muted sm:inline">Sample · public Enron emails</span>}
      </div>
    </div>
  );
}
