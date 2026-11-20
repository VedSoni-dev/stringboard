// What the ask route gets: the board as compact lines, and the quotes most relevant to the question.
// Also: turning the answer's {e12} and [x40] marks back into lit nodes and source chips.
import type { Board } from "./types";
import { degree, norm } from "./board";

const STOP = new Set("the a an and or of to in on at for by with from is was were be been are who what when where why how did does do it this that these those which about into than then there their they them his her him she he i you we our your my me any all".split(" "));
const words = (s: string) => norm(s).replace(/[^a-z0-9$ ]/g, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w));

export function boardContext(b: Board, question: string, focus?: string[], compact = false) {
  // compact: small local models get a few-KB context (Ollama defaults to ~4K tokens) so nothing important is cut off
  const L = compact ? { ents: 40, links: 60, events: 25, ev: 14 } : { ents: 220, links: 400, events: 150, ev: 60 };
  const deg = degree(b);
  const name = new Map(b.entities.map((e) => [e.id, e.name]));
  const ents = [...b.entities].sort((x, y) => (deg.get(y.id) ?? 0) - (deg.get(x.id) ?? 0)).slice(0, L.ents);
  const lines = [
    "EVENTS:",
    ...[...b.events].sort((x, y) => x.date.localeCompare(y.date)).slice(0, L.events).map((v) => `${v.date.slice(0, 10)} ${v.title} {${v.who.join(",")}} [${v.evidence.join(",")}]`),
    "ENTITIES:",
    ...ents.map((e) => `${e.id} ${e.kind} ${e.name}${e.aliases.length ? ` (aka ${e.aliases.slice(0, 3).join(", ")})` : ""}${e.note ? `: ${e.note}` : ""}`),
    "LINKS:",
    ...b.links.filter((l) => l.origin === "ai" || l.count > 0).filter((l) => !compact || l.origin === "ai").sort((x, y) => (x.origin === "ai" ? -1 : 1) - (y.origin === "ai" ? -1 : 1)).slice(0, L.links)
      .map((l) => `${l.a} ${name.get(l.a)} —${l.label}${l.origin === "comm" ? ` ×${l.count}` : ""}→ ${l.b} ${name.get(l.b)}${l.date ? ` (${l.date.slice(0, 10)})` : ""}${l.evidence.length ? ` [${l.evidence.slice(0, 3).join(",")}]` : ""}`),
  ];
  // Retrieve evidence by word overlap with the question (and the focused entities' names), plus focus entities' own quotes.
  const q = new Set(words(question + " " + (focus ?? []).map((f) => name.get(f) ?? "").join(" ")));
  const focusEv = new Set((focus ?? []).flatMap((f) => b.entities.find((e) => e.id === f)?.evidence ?? []));
  const docName = new Map(b.docs.map((d) => [d.id, d.name]));
  const scored = b.evidence.map((x) => {
    const w = words(x.quote);
    let s = w.filter((t) => q.has(t)).length + (focusEv.has(x.id) ? 3 : 0);
    if (s && x.quote.length > 40) s += 0.5;
    return { x, s };
  }).filter((r) => r.s > 0).sort((a, c) => c.s - a.s).slice(0, L.ev);
  const pool = scored.length ? scored.map((r) => r.x) : b.evidence.filter((x) => x.quote.length > 40).slice(0, L.ev);
  const evidence = pool.map((x) => `${x.id} (${docName.get(x.doc) ?? "file"}${x.date ? `, sent ${x.date.slice(0, 10)}` : ""}): "${x.quote.replace(/\s+/g, " ")}"`).join("\n");
  return { board: lines.join("\n"), evidence };
}

/**
 * Small local models often skip the {e12} marks. Add them back for names the board knows, so any model's answer
 * still lights up the board. Names already followed by a mark are left alone.
 */
export function linkNames(text: string, b: Board): string {
  const cands = b.entities.flatMap((e) => [e.name, ...e.aliases.filter((a) => !a.includes("@") && /\s/.test(a))].map((n) => ({ n, id: e.id })))
    .filter(({ n }) => (n.length >= 4 && !/^(the|and|this|that|with)$/i.test(n)) || /^[A-Z0-9&]{3}$/.test(n))
    .sort((a, c) => c.n.length - a.n.length);
  let out = text;
  const done = new Set<string>();
  for (const { n, id } of cands) {
    if (done.has(id)) continue;
    const re = new RegExp(`(?<![\\w{])(${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\w])(?!\\s*\\{)`, "g");
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    out = out.replace(re, `$1 {${id}}`);
    done.add(id);
  }
  return out;
}

export type Piece = { t: "text"; v: string } | { t: "ent"; id: string; v: string } | { t: "cite"; id: string };

/** "Fastow {e3} ran it [x4, x5]" → text / entity / cite pieces. Unknown ids fall back to plain text. */
export function parseAnswer(raw: string, b: Board): Piece[] {
  const text = /\{e[a-z0-9]+\}/i.test(raw) ? raw : linkNames(raw, b);
  const ents = new Set(b.entities.map((e) => e.id));
  const evs = new Set(b.evidence.map((x) => x.id));
  const out: Piece[] = [];
  const re = /\{([a-z0-9,\s]+)\}|\[([a-z0-9,\s]+)\]/gi;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const ids = (m[1] ?? m[2])!.split(/[,\s]+/).filter(Boolean);
    const okE = m[1] && ids.every((i) => ents.has(i));
    const okX = m[2] && ids.every((i) => evs.has(i));
    if (!okE && !okX) continue;
    let before = text.slice(last, m.index);
    if (okE) {
      // The words right before {e3} that belong to that entity's name ("Andrew Fastow {e3}") become the link.
      const e = b.entities.find((x) => x.id === ids[0])!;
      const tokens = new Set([e.name, ...e.aliases].flatMap((n) => n.toLowerCase().split(/[\s.,@]+/)).filter((t) => t.length > 1));
      const parts = before.split(/(\s+)/);
      let k = parts.length;
      while (k > 0) {
        const w = parts[k - 1]!;
        if (/^\s+$/.test(w) || w === "") { k--; continue; }
        if (tokens.has(w.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f'-]/g, "").replace(/'s$/, ""))) { k--; continue; }
        break;
      }
      while (k < parts.length && /^\s*$/.test(parts[k]!)) k++;
      const label = parts.slice(k).join("").trim();
      const head = parts.slice(0, k).join("");
      if (head) out.push({ t: "text", v: head });
      out.push({ t: "ent", id: e.id, v: label || e.name });
    } else {
      if (before) out.push({ t: "text", v: before.replace(/\s+$/, "") });
      for (const i of ids) out.push({ t: "cite", id: i });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/** Entity ids an answer mentions, and the links between them: what lights up on the board. */
export function answerPath(raw: string, b: Board) {
  const text = /\{e[a-z0-9]+\}/i.test(raw) ? raw : linkNames(raw, b);
  const ids = new Set<string>();
  for (const m of text.matchAll(/\{([a-z0-9,\s]+)\}/gi)) for (const i of m[1]!.split(/[,\s]+/)) if (b.entities.some((e) => e.id === i)) ids.add(i);
  const cites = new Set<string>();
  for (const m of text.matchAll(/\[([a-z0-9,\s]+)\]/gi)) for (const i of m[1]!.split(/[,\s]+/)) cites.add(i);
  const links = b.links.filter((l) => (ids.has(l.a) && ids.has(l.b)) || l.evidence.some((x) => cites.has(x))).map((l) => l.id);
  for (const l of b.links) if (links.includes(l.id)) { ids.add(l.a); ids.add(l.b); }
  return { nodes: [...ids], links };
}
