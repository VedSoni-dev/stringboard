// Files → docs, in the browser. Accepts whatever people actually have: .eml, .mbox, WhatsApp exports (iOS and
// Android), Telegram and Instagram/Messenger JSON exports, CSV bank statements, text, markdown, HTML, JSON.
// PDFs go through /api/parse (text only, never stored). Postel's law: accept messy input, return clean docs.
import type { Doc, Message } from "./types";

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const iso = (d: Date) => (isNaN(d.getTime()) ? undefined : d.toISOString());

// ---------- email ----------
function unfold(head: string) { return head.replace(/\r?\n[ \t]+/g, " "); }
function decodeQP(s: string) {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function decodeWord(s: string) {
  // =?utf-8?B?...?= / =?utf-8?Q?...?= in headers
  return s.replace(/=\?[^?]+\?([BQ])\?([^?]*)\?=/gi, (_, enc: string, txt: string) => {
    try {
      if (enc.toUpperCase() === "B") return decodeURIComponent(escape(atob(txt)));
      return decodeQP(txt.replace(/_/g, " "));
    } catch { return txt; }
  });
}
export const addrList = (v?: string): string[] =>
  (v ?? "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => s.trim()).filter(Boolean)
    .map((s) => (s.match(/<([^>]+)>/)?.[1] ?? s).replace(/^"|"$/g, "").trim().toLowerCase())
    .filter((s) => s.length > 2);

function bodyOf(raw: string, headers: Record<string, string>): string {
  const ct = headers["content-type"] ?? "";
  const boundary = ct.match(/boundary="?([^";]+)"?/i)?.[1];
  if (boundary) {
    const parts = raw.split(`--${boundary}`);
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p)) ?? parts.find((p) => /content-type:\s*text\/html/i.test(p));
    if (plain) {
      const i = plain.search(/\r?\n\r?\n/);
      const ph = plain.slice(0, i), pb = plain.slice(i).trim();
      const txt = /quoted-printable/i.test(ph) ? decodeQP(pb) : /base64/i.test(ph) ? safeB64(pb) : pb;
      return /text\/html/i.test(ph) ? stripHtml(txt) : txt;
    }
  }
  const enc = headers["content-transfer-encoding"] ?? "";
  const txt = /quoted-printable/i.test(enc) ? decodeQP(raw) : /base64/i.test(enc) ? safeB64(raw) : raw;
  return /text\/html/i.test(ct) ? stripHtml(txt) : txt;
}
function safeB64(s: string) { try { return decodeURIComponent(escape(atob(s.replace(/\s+/g, "")))); } catch { return s; } }
export function stripHtml(html: string) {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function parseEmail(raw: string, name: string): Doc | null {
  const split = raw.search(/\r?\n\r?\n/);
  if (split < 0) return null;
  const head = unfold(raw.slice(0, split));
  const headers: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (m) headers[m[1]!.toLowerCase()] ??= decodeWord(m[2]!);
  }
  if (!headers.from && !headers.subject) return null;
  const body = bodyOf(raw.slice(split).trim(), headers).trim();
  const from = addrList(headers.from)[0];
  const to = [...addrList(headers.to), ...addrList(headers.cc)];
  const date = headers.date ? iso(new Date(headers.date)) : undefined;
  const subject = headers.subject?.trim() || "(no subject)";
  return {
    id: uid("d"), name: subject || name, type: "email", date, from, to,
    text: `From: ${headers.from ?? ""}\nTo: ${headers.to ?? ""}${headers.cc ? `\nCc: ${headers.cc}` : ""}\nDate: ${headers.date ?? ""}\nSubject: ${subject}\n\n${body}`,
    messages: [{ at: date, from, to, text: body.slice(0, 400) }],
  };
}

export function parseMbox(raw: string, name: string): Doc[] {
  return raw.split(/^From [^\n]*\n/m).map((part, i) => parseEmail(part, `${name} #${i + 1}`)).filter((d): d is Doc => !!d);
}

// ---------- chats ----------
// iOS:     [12/03/2024, 21:14:05] Maya: text
// Android: 12/03/2024, 21:14 - Maya: text   ·   3/12/24, 9:14 PM - Maya: text
const WA = /^‎?\[?(\d{1,2})[./-](\d{1,2})[./-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?\]?\s*(?:-|–)?\s*([^:]{1,60}?):\s([\s\S]*)$/;

export function parseWhatsApp(raw: string, name: string): Doc | null {
  const lines = raw.replace(/\r/g, "").split("\n");
  const rows: { a: number; b: number; y: number; h: number; m: number; s: number; who: string; text: string }[] = [];
  for (const line of lines) {
    const m = line.match(WA);
    if (m) {
      let h = +m[4]!; const ap = m[7]?.toLowerCase().replace(/\./g, "");
      if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
      let y = +m[3]!; if (y < 100) y += 2000;
      rows.push({ a: +m[1]!, b: +m[2]!, y, h, m: +m[5]!, s: +(m[6] ?? 0), who: m[8]!.replace(/^‎/, "").trim(), text: m[9]!.trim() });
    } else if (rows.length && line.trim()) rows[rows.length - 1]!.text += "\n" + line;
  }
  if (rows.length < 3) return null;
  // 13/03 can only be day-first; 03/13 only month-first; all ambiguous → month-first (the US export default).
  const monthFirst = !rows.some((r) => r.a > 12);
  const messages: Message[] = rows.filter((r) => !/^(<Media omitted>|image omitted|‎?audio omitted|Messages and calls are end-to-end encrypted)/i.test(r.text))
    .map((r) => {
      const [mo, d] = monthFirst ? [r.a, r.b] : [r.b, r.a];
      return { at: iso(new Date(r.y, mo - 1, d, r.h, r.m, r.s)), from: r.who, text: r.text };
    });
  return chatDoc(name.replace(/\.txt$/i, "").replace(/^WhatsApp Chat (with|-) /i, ""), messages);
}

function chatDoc(name: string, messages: Message[]): Doc {
  const people = [...new Set(messages.map((m) => m.from).filter(Boolean))] as string[];
  for (const m of messages) m.to = people.filter((p) => p !== m.from);
  const text = messages.map((m) => `[${m.at ? m.at.slice(0, 16).replace("T", " ") : "?"}] ${m.from}: ${m.text}`).join("\n");
  return { id: uid("d"), name: `Chat: ${name}`, type: "chat", text, messages, date: messages[0]?.at };
}

function parseJSONExport(raw: string, name: string): Doc | null {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  const o = j as Record<string, unknown>;
  const flat = (t: unknown): string => typeof t === "string" ? t : Array.isArray(t) ? t.map((x) => typeof x === "string" ? x : (x as { text?: string }).text ?? "").join("") : "";
  // Telegram: { name, messages: [{ date, from, text }] }
  if (Array.isArray(o.messages) && (o.messages as Record<string, unknown>[]).some((m) => "from" in m && "date" in m)) {
    const msgs = (o.messages as Record<string, unknown>[]).filter((m) => m.type !== "service" && m.from)
      .map((m) => ({ at: iso(new Date(String(m.date))), from: String(m.from), text: flat(m.text) })).filter((m) => m.text);
    return msgs.length ? chatDoc(String(o.name ?? name), msgs) : null;
  }
  // Instagram / Messenger: { participants, messages: [{ sender_name, timestamp_ms, content }] }
  if (Array.isArray(o.messages) && (o.messages as Record<string, unknown>[]).some((m) => "sender_name" in m)) {
    const fix = (s: string) => { try { return decodeURIComponent(escape(s)); } catch { return s; } }; // Meta exports double-encode UTF-8
    const msgs = (o.messages as Record<string, unknown>[]).filter((m) => m.content)
      .map((m) => ({ at: iso(new Date(Number(m.timestamp_ms))), from: fix(String(m.sender_name)), text: fix(String(m.content)) })).reverse();
    return msgs.length ? chatDoc(fix(String(o.title ?? name)), msgs) : null;
  }
  return { id: uid("d"), name, type: "text", text: JSON.stringify(j, null, 1).slice(0, 400_000) };
}

// ---------- entry ----------
export async function fileToDocs(file: File): Promise<Doc[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch("/api/parse", { method: "POST", body: fd });
    const j = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!r.ok || !j.text) throw new Error(j.error ?? `Couldn't read ${file.name}.`);
    return [{ id: uid("d"), name: file.name, type: "pdf", text: j.text }];
  }
  if (/\.(png|jpe?g|gif|webp|heic|mp4|mov|zip)$/.test(lower)) throw new Error(`${file.name}: images, video and zips aren't read yet. Export the chat as text, or unzip it first.`);
  const raw = await file.text();
  return textToDocs(raw, file.name);
}

export function textToDocs(raw: string, name = "Pasted text"): Doc[] {
  const lower = name.toLowerCase();
  const t = raw.replace(/^﻿/, "");
  if (lower.endsWith(".mbox") || /^From \S+.*\n[A-Za-z-]+: /.test(t)) { const d = parseMbox(t, name); if (d.length) return d; }
  if (lower.endsWith(".eml") || /^(Return-Path|Received|From|Message-ID|Date|MIME-Version):/im.test(t.slice(0, 600)) && /\n(Subject|From):/i.test(t.slice(0, 3000))) {
    const d = parseEmail(t, name); if (d) return [d];
  }
  if (lower.endsWith(".json")) { const d = parseJSONExport(t, name); if (d) return [d]; }
  const wa = parseWhatsApp(t, name); if (wa) return [wa];
  if (/\.html?$/.test(lower)) return [{ id: uid("d"), name, type: "text", text: stripHtml(t) }];
  return [{ id: uid("d"), name, type: lower.endsWith(".csv") ? "csv" : "text", text: t.slice(0, 600_000) }];
}
