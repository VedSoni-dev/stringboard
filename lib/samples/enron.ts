// The sample board: 20 real emails from the public Enron corpus (released by FERC in 2003; this copy from the
// corbt/enron-emails dataset), phone numbers removed. The extraction was written ahead of time by Claude and goes
// through the same merge and quote check as a live run, so every string on the sample board points at a real line.
import emails from "./enron-emails.json";
import extract from "./enron-extract.json";
import type { Board, Doc, Extraction } from "../types";
import { emptyBoard } from "../types";
import { addMetadata, mergeExtraction } from "../board";

interface RawEmail { id: string; from: string; to: string[]; cc: string[]; date: string; subject: string; body: string }

export const SAMPLE_ID = "sample-enron";

export function enronDocs(): Doc[] {
  return (emails as RawEmail[]).map((m) => {
    const to = [...m.to, ...m.cc].filter(Boolean);
    const date = new Date(m.date.replace(" ", "T") + (m.date.endsWith("Z") ? "" : "Z")).toISOString();
    return {
      id: m.id, name: m.subject, type: "email", date, from: m.from, to, sample: true,
      text: `From: ${m.from}\nTo: ${m.to.filter(Boolean).join(", ")}${m.cc.filter(Boolean).length ? `\nCc: ${m.cc.filter(Boolean).join(", ")}` : ""}\nDate: ${date.slice(0, 16).replace("T", " ")}\nSubject: ${m.subject}\n\n${m.body}`,
      messages: [{ at: date, from: m.from, to, text: m.body.slice(0, 400) }],
    } satisfies Doc;
  });
}

/** Steps for the live build animation: metadata first, then one email's extraction at a time. */
export function enronSteps() {
  const docs = enronDocs();
  const x = extract as unknown as Record<string, Extraction>;
  return { docs, steps: docs.map((d) => ({ doc: d, extraction: x[d.id] ?? { entities: [], links: [], events: [] } })) };
}

export function enronBoard(): Board {
  const { docs, steps } = enronSteps();
  const b: Board = { ...emptyBoard("Enron: 20 public emails"), id: SAMPLE_ID, sample: true, docs };
  addMetadata(b, docs);
  for (const s of steps) mergeExtraction(b, { id: s.doc.id, doc: s.doc.id, text: s.doc.text, header: s.doc.name, date: s.doc.date }, s.extraction);
  return b;
}
