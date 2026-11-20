// Building the board: the metadata layer (who talks to whom, from headers, instant, no AI), chunking text for the
// model, and merging what the model found, keeping only facts whose quote is really in the source.
import type { Board, BoardEvent, Chunk, Doc, Entity, Evidence, Extraction, Kind, Link } from "./types";
import { KINDS } from "./types";
import { displayFromEmail, orgFromDomain, resolve } from "./names";

let n = 0;
const id = (p: string) => `${p}${Date.now().toString(36).slice(-5)}${(n++).toString(36)}`;

export const norm = (s: string) => s.toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/\s+/g, " ").trim();
const ROLE_ADDR = /(^|[._-])(litigation|legal|info|admin|support|help|team|questions|hr|office|sales|billing|accounts?|press|media|contact|hello|security|it)([._-]|$)/i;
const NOISE_ADDR = /^(no\.?address|noreply|no-reply|donotreply|mailer-daemon|postmaster|dl-|announcements?|newsletter|bounce|notifications?)/i;

function touch(e: Entity, date?: string) {
  if (!date) return;
  if (!e.firstSeen || date < e.firstSeen) e.firstSeen = date;
  if (!e.lastSeen || date > e.lastSeen) e.lastSeen = date;
}

export function upsertEntity(b: Board, name: string, kind: Kind, opts: { alias?: string[]; note?: string; origin: Entity["origin"]; date?: string; evidence?: string }): Entity {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 80);
  let e = resolve(b.entities, clean, kind) ?? (opts.alias ?? []).map((a) => resolve(b.entities, a, kind)).find(Boolean) ?? null;
  if (!e) {
    e = { id: id("e"), name: clean, kind, aliases: [], evidence: [], origin: opts.origin };
    b.entities.push(e);
  } else if (opts.origin === "ai") {
    // An AI-read name ("Andrew Fastow") beats a header-made one ("Andrew Fastow" from andrew.fastow@) or an initial.
    if (e.origin === "meta" || (clean.length > e.name.length && !/@/.test(clean) && /\s/.test(clean) && !/\./.test(clean))) {
      if (e.name !== clean && !e.aliases.includes(e.name)) e.aliases.push(e.name);
      e.name = clean;
    }
    e.origin = "ai";
  }
  for (const a of [clean, ...(opts.alias ?? [])]) if (a && a !== e.name && !e.aliases.some((x) => x.toLowerCase() === a.toLowerCase())) e.aliases.push(a.slice(0, 80));
  // A spelling the model gave ("chairman.ken@enron.com") that names another header-made node: that node is this one.
  if (opts.origin === "ai") {
    const spell = new Set([e.name, ...e.aliases].map((x) => x.toLowerCase()));
    for (const other of b.entities.filter((o) => o !== e && o.origin === "meta" && (o.kind === e.kind || o.kind === "account") && [o.name, ...o.aliases].some((x) => spell.has(x.toLowerCase())))) mergeInto(b, e, other);
  }
  if (opts.note && !e.note) e.note = opts.note.slice(0, 160);
  if (opts.evidence && !e.evidence.includes(opts.evidence)) e.evidence.push(opts.evidence);
  touch(e, opts.date);
  return e;
}

/** Fold `drop` into `keep`: its names, quotes and strings move over, then it leaves the board. */
export function mergeInto(b: Board, keep: Entity, drop: Entity) {
  for (const a of [drop.name, ...drop.aliases]) if (a !== keep.name && !keep.aliases.some((x) => x.toLowerCase() === a.toLowerCase())) keep.aliases.push(a);
  for (const x of drop.evidence) if (!keep.evidence.includes(x)) keep.evidence.push(x);
  touch(keep, drop.firstSeen); touch(keep, drop.lastSeen);
  for (const l of b.links) { if (l.a === drop.id) l.a = keep.id; if (l.b === drop.id) l.b = keep.id; }
  // strings that now run keep→keep go; duplicates of the same kind fold together
  const seen = new Map<string, Link>();
  b.links = b.links.filter((l) => {
    if (l.a === l.b) return false;
    const k = [l.origin, l.origin === "comm" ? "" : l.label, ...[l.a, l.b].sort()].join("|");
    const twin = seen.get(k);
    if (!twin) { seen.set(k, l); return true; }
    twin.count += l.count;
    for (const x of l.evidence) if (!twin.evidence.includes(x)) twin.evidence.push(x);
    return false;
  });
  for (const v of b.events) v.who = [...new Set(v.who.map((w) => (w === drop.id ? keep.id : w)))];
  b.entities = b.entities.filter((e) => e !== drop);
}

function upsertLink(b: Board, a: string, c: string, label: string, origin: Link["origin"], date?: string, ev?: string): Link | null {
  if (a === c) return null;
  const lab = label.trim().toLowerCase().slice(0, 60) || "connected";
  let l = b.links.find((x) => x.origin === origin && ((x.a === a && x.b === c) || (x.a === c && x.b === a)) && (origin === "comm" || x.label === lab));
  if (!l) { l = { id: id("l"), a, b: c, label: lab, origin, count: 0, evidence: [] }; b.links.push(l); }
  l.count++;
  if (date && (!l.date || date < l.date)) l.date = date;
  if (ev && !l.evidence.includes(ev) && l.evidence.length < 40) l.evidence.push(ev);
  return l;
}

function addEvidence(b: Board, doc: string, quote: string, date?: string): Evidence {
  const q = quote.trim().slice(0, 600);
  const have = b.evidence.find((x) => x.doc === doc && x.quote === q);
  if (have) return have;
  const ev = { id: id("x"), doc, quote: q, date };
  b.evidence.push(ev);
  return ev;
}

/** The metadata layer: every sender and recipient becomes a node, every message a string. Instant, no AI. */
export function addMetadata(b: Board, docs: Doc[]) {
  for (const d of docs) {
    for (const m of d.messages ?? []) {
      if (!m.from) continue;
      const isAddr = (s: string) => s.includes("@");
      const node = (who: string) => {
        if (isAddr(who) && NOISE_ADDR.test(who)) return null;
        const role = isAddr(who) && ROLE_ADDR.test(who.split("@")[0]!);
        const e = role ? upsertEntity(b, who, "account", { origin: "meta", date: m.at, note: "Shared mailbox" })
          : upsertEntity(b, isAddr(who) ? displayFromEmail(who) : who, "person", { alias: [who], origin: "meta", date: m.at });
        const org = isAddr(who) ? orgFromDomain(who) : null;
        if (org) { const o = upsertEntity(b, org, "org", { alias: [who.split("@")[1]!], origin: "meta", date: m.at }); upsertLink(b, e.id, o.id, "email domain", "comm", m.at); }
        return e;
      };
      const from = node(m.from);
      if (!from) continue;
      const subject = d.type === "email" ? d.text.match(/^Subject: .*$/m)?.[0] : undefined;
      const ev = subject ? addEvidence(b, d.id, subject, m.at) : addEvidence(b, d.id, `${m.from}: ${m.text.split("\n")[0]!.slice(0, 160)}`, m.at);
      from.evidence.includes(ev.id) || from.evidence.length > 60 || from.evidence.push(ev.id);
      for (const to of (m.to ?? []).slice(0, d.type === "chat" ? 12 : 25)) {
        const t = node(to);
        if (t) upsertLink(b, from.id, t.id, d.type === "chat" ? "messaged" : "emailed", "comm", m.at, ev.id);
      }
    }
  }
}

/** Split docs into model-sized chunks. Emails pack together; long docs split on paragraph or line breaks. */
export function chunkDocs(docs: Doc[], size: number): Chunk[] {
  const out: Chunk[] = [];
  let buf: Doc[] = [], len = 0;
  const flush = () => {
    if (!buf.length) return;
    out.push({ id: id("c"), doc: buf.map((d) => d.id).join(","), date: buf[0]!.date, header: buf.length > 1 ? `${buf.length} emails` : buf[0]!.name,
      text: buf.map((d) => `=== ${d.name} ===\n${d.text}`).join("\n\n") });
    buf = []; len = 0;
  };
  for (const d of docs) {
    if (d.text.length <= size) {
      if (len + d.text.length > size) flush();
      buf.push(d); len += d.text.length;
      continue;
    }
    flush();
    const parts = d.text.split(d.type === "chat" || d.type === "csv" ? /\n/ : /\n\s*\n/);
    let cur = "";
    let i = 0;
    for (const p of parts) {
      if (cur.length + p.length + 1 > size && cur) { out.push({ id: id("c"), doc: d.id, header: `${d.name} · part ${++i}`, text: `=== ${d.name} (part ${i}) ===\n${cur}`, date: d.date }); cur = ""; }
      cur += (cur ? (d.type === "chat" || d.type === "csv" ? "\n" : "\n\n") : "") + p.slice(0, size);
    }
    if (cur) out.push({ id: id("c"), doc: d.id, header: `${d.name}${i ? ` · part ${++i}` : ""}`, text: `=== ${d.name} ===\n${cur}`, date: d.date });
  }
  flush();
  return out;
}

/** Where a quote really is: the doc that contains it (and, in a chat, the message's time). null = made up. */
export function locate(b: Board, chunk: Chunk, quote: string): { doc: string; date?: string } | null {
  const q = norm(quote);
  if (q.length < 3) return null;
  const docs = chunk.doc.split(",").map((i) => b.docs.find((d) => d.id === i)).filter((d): d is Doc => !!d);
  const probe = q.length > 120 ? q.slice(0, 120) : q;
  for (const d of docs) {
    if (!norm(d.text).includes(probe)) continue;
    const msg = d.messages?.find((m) => norm(m.text).includes(probe.slice(0, 60)));
    return { doc: d.id, date: msg?.at ?? d.date };
  }
  return null;
}

const DATE_OK = (s?: string) => !!s && /^\d{4}(-\d{2}(-\d{2})?)?/.test(s) && !isNaN(new Date(s.length === 4 ? `${s}-01-01` : s).getTime());

export interface MergeResult { entities: string[]; links: string[]; events: string[]; rejected: number }

/** Fold one chunk's extraction into the board. Anything whose quote isn't in the source is dropped and counted. */
export function mergeExtraction(b: Board, chunk: Chunk, x: Extraction): MergeResult {
  const res: MergeResult = { entities: [], links: [], events: [], rejected: 0 };
  const refs = new Map<string, Entity>();
  for (const raw of x.entities ?? []) {
    if (!raw?.name || typeof raw.name !== "string") continue;
    const kind = (KINDS as string[]).includes(raw.kind) ? raw.kind : "thing";
    let ev: Evidence | undefined, date: string | undefined;
    if (raw.quote) {
      const at = locate(b, chunk, raw.quote);
      if (at) { ev = addEvidence(b, at.doc, raw.quote, at.date); date = at.date; } else res.rejected++;
    }
    // A name the source never mentions is a guess: keep it only if one of its spellings is in the chunk.
    const said = [raw.name, ...(raw.aliases ?? [])].some((nm) => norm(chunk.text).includes(norm(nm)));
    const known = b.entities.find((e) => e.id === raw.ref);
    if (!said && !known) { res.rejected++; continue; }
    const e = known ?? upsertEntity(b, raw.name, kind, { alias: raw.aliases?.filter((a) => typeof a === "string"), note: raw.note, origin: "ai", date, evidence: ev?.id });
    if (known) { if (ev && !known.evidence.includes(ev.id)) known.evidence.push(ev.id); touch(known, date); known.origin = "ai"; }
    refs.set(raw.ref, e);
    refs.set(raw.name, e);
    if (!res.entities.includes(e.id)) res.entities.push(e.id);
  }
  // Small models use names where refs belong, or refs they never defined: fall back to a name the chunk really says.
  const chunkNorm = norm(chunk.text);
  const pick = (r: string) => {
    if (typeof r !== "string" || !r) return null;
    const hit = refs.get(r) ?? b.entities.find((e) => e.id === r) ?? null;
    if (hit) return hit;
    if (/^r\d+$/i.test(r) || !chunkNorm.includes(norm(r))) return null;
    const known = b.entities.find((e) => [e.name, ...e.aliases].some((n) => n.toLowerCase() === r.toLowerCase()));
    if (known) return known;
    if (!/^[A-Z][\p{L}'-]+( [A-Z][\p{L}'.-]+){0,2}$/u.test(r.trim())) return null;
    const e = upsertEntity(b, r, "person", { origin: "ai" });
    refs.set(r, e); if (!res.entities.includes(e.id)) res.entities.push(e.id);
    return e;
  };
  for (const l of x.links ?? []) {
    const A = pick(l.a), B = pick(l.b);
    if (!A || !B || !l.quote) { res.rejected++; continue; }
    const at = locate(b, chunk, l.quote);
    if (!at) { res.rejected++; continue; }
    const ev = addEvidence(b, at.doc, l.quote, at.date);
    const link = upsertLink(b, A.id, B.id, l.label, "ai", DATE_OK(l.date) ? l.date : at.date, ev.id);
    for (const e of [A, B]) if (!e.evidence.includes(ev.id)) e.evidence.push(ev.id);
    if (link && !res.links.includes(link.id)) res.links.push(link.id);
  }
  for (const v of x.events ?? []) {
    if (!v?.title || !v.quote) continue;
    const at = locate(b, chunk, v.quote);
    if (!at) { res.rejected++; continue; }
    const date = DATE_OK(v.date) ? v.date : at.date;
    if (!date) continue;
    const ev = addEvidence(b, at.doc, v.quote, at.date);
    const who = (v.who ?? []).map(pick).filter((e): e is Entity => !!e).map((e) => e.id);
    const dupe = b.events.find((e) => e.date.slice(0, 10) === date.slice(0, 10) && norm(e.title) === norm(v.title));
    if (dupe) { for (const w of who) if (!dupe.who.includes(w)) dupe.who.push(w); if (!dupe.evidence.includes(ev.id)) dupe.evidence.push(ev.id); continue; }
    const event: BoardEvent = { id: id("v"), date, title: v.title.slice(0, 140), who, evidence: [ev.id] };
    b.events.push(event);
    res.events.push(event.id);
  }
  b.rejected += res.rejected;
  b.updatedAt = new Date().toISOString();
  return res;
}

/** The known entities a chunk's model call should reuse ids for (most connected first, capped). */
export function knownFor(b: Board, limit = 80) {
  const deg = new Map<string, number>();
  for (const l of b.links) { deg.set(l.a, (deg.get(l.a) ?? 0) + 1); deg.set(l.b, (deg.get(l.b) ?? 0) + 1); }
  return [...b.entities].sort((a, c) => (deg.get(c.id) ?? 0) - (deg.get(a.id) ?? 0)).slice(0, limit)
    .map((e) => ({ id: e.id, name: e.name, kind: e.kind, aliases: e.aliases.slice(0, 4) }));
}

export function degree(b: Board) {
  const deg = new Map<string, number>();
  for (const l of b.links) { const w = l.origin === "ai" ? 2 : 1; deg.set(l.a, (deg.get(l.a) ?? 0) + w); deg.set(l.b, (deg.get(l.b) ?? 0) + w); }
  return deg;
}

/** Pattern of life: a 7 × 24 grid of when this entity sends messages, from the docs' own timestamps. */
export function activity(b: Board, e: Entity): number[][] | null {
  const names = new Set([e.name, ...e.aliases].map((s) => s.toLowerCase()));
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  let total = 0;
  for (const d of b.docs) for (const m of d.messages ?? []) {
    if (!m.at || !m.from || !names.has(m.from.toLowerCase())) continue;
    const t = new Date(m.at);
    grid[t.getDay()]![t.getHours()]!++; total++;
  }
  return total >= 2 ? grid : null;
}
