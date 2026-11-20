// One chunk of the person's files → the people, organisations, money, places, links and events in it, each with
// an exact quote. The client checks every quote against the source and drops the ones that aren't there.
import { errorResponse, generateText, parseJSON } from "@/kit/ai";
import type { Extraction } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM = `You are an intelligence analyst building a link-analysis board (people, organisations, money and how they connect) from documents the user owns.

Read the CHUNK and return JSON with exactly this shape:
{"entities":[{"ref":"r1","name":"Andrew Fastow","kind":"person","aliases":["Andy"],"note":"CFO of Enron","quote":"Andy Fastow\\nEVP/CFO, ENRON"}],
 "links":[{"a":"r1","b":"r2","label":"controls","date":"2001-08-02","quote":"exact words from the chunk"}],
 "events":[{"date":"2001-10-03","title":"Raptor described as blown up","who":["r3"],"quote":"exact words from the chunk"}]}

Rules:
- kind is one of: person, org, place, money, account, thing. "thing" = a project, deal, vehicle, partnership code name, product. "money" = a specific amount ("$1.2 billion charge"). "account" = a bank account, card, phone number or handle.
- If an entity is in KNOWN, use its id as "ref" (do not repeat it as new). Otherwise give it a short ref like r1, r2.
- "quote" must be copied character for character from the chunk, 3 to 25 words. Never paraphrase a quote. No quote, no fact.
- Links are specific relations a reader would care about: works for, reports to, owns, paid, owes, controls, invested in, met, warned, asked, lied to, hid, signed, sent money to. Not "mentioned together".
- Links "a" and "b" are refs or KNOWN ids. Every ref you use in links or events must be defined in "entities". Direction: a does it to b.
- Include every named person, even ones who only appear once.
- Events need a date (YYYY-MM-DD, or YYYY-MM) that the chunk states or that the email's Date header gives.
- Ignore signatures, disclaimers, phone numbers of offices, and newsletter boilerplate.
- At most 25 entities, 25 links, 10 events. Fewer is fine. Return {"entities":[],"links":[],"events":[]} if nothing matters.`;

// Small local models can't juggle refs. They get a flat format (names + who-did-what-to-whom) that we convert here.
const LITE = `Extract a link-analysis board from the TEXT. Return JSON only:
{"people":["Jordan","Sam"],"orgs":["Brightline"],"places":["Cabo"],"money":["$640"],"things":["Project Margaux"],
 "facts":[{"who":"Jordan","did":"owes","whom":"Sam","quote":"he still owes me $640 for the villa"}]}
Rules: names exactly as written in the TEXT. "quote" is copied word for word from the TEXT. One fact per relation: owes, paid, works at, travelled to, lied to, met, told, warned, booked, sent money to, controls, owns. Use real names, never "he" or "me": work out who they are from the speaker and context.`;

interface Lite { people?: string[]; orgs?: string[]; places?: string[]; money?: string[]; things?: string[]; facts?: { who?: string; did?: string; whom?: string; quote?: string }[] }

function fromLite(x: Lite, text: string): Extraction {
  const lines = text.split(/\n/);
  const strs = (a: unknown) => (Array.isArray(a) ? a.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 40) : []);
  const entities: Extraction["entities"] = [];
  const add = (names: string[], kind: Extraction["entities"][number]["kind"]) => { for (const n of names) if (!entities.some((e) => e.name.toLowerCase() === n.toLowerCase())) entities.push({ ref: n, name: n.trim(), kind }); };
  add(strs(x.people), "person"); add(strs(x.orgs), "org"); add(strs(x.places), "place"); add(strs(x.money), "money"); add(strs(x.things), "thing");
  const links: Extraction["links"] = [];
  for (const f of Array.isArray(x.facts) ? x.facts.slice(0, 40) : []) {
    if (!f?.who || !f.whom || !f.did) continue;
    let quote = typeof f.quote === "string" ? f.quote : "";
    // no quote, or a made-up one: the shortest line that names both sides is the evidence
    if (!quote || !text.toLowerCase().includes(quote.toLowerCase().slice(0, 40))) {
      const both = lines.filter((l) => l.toLowerCase().includes(f.who!.toLowerCase()) && l.toLowerCase().includes(f.whom!.toLowerCase())).sort((a, b) => a.length - b.length)[0];
      quote = both ? both.replace(/^\[[^\]]*\]\s*/, "").slice(0, 300) : quote;
    }
    for (const n of [f.who, f.whom]) if (!entities.some((e) => e.name.toLowerCase() === n.toLowerCase())) entities.push({ ref: n, name: n, kind: "person" });
    links.push({ a: f.who, b: f.whom, label: String(f.did).slice(0, 60), quote });
  }
  return { entities, links, events: [] };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; known?: { id: string; name: string; kind: string; aliases?: string[] }[]; tier?: "fast" | "balanced" | "smart"; lite?: boolean };
  const text = (body.text ?? "").slice(0, 24_000);
  if (!text.trim()) return Response.json({ error: "Nothing to read in this chunk." }, { status: 400 });
  const known = (body.known ?? []).slice(0, 80).map((k) => `${k.id} | ${k.kind} | ${k.name}${k.aliases?.length ? ` (aka ${k.aliases.slice(0, 3).join(", ")})` : ""}`).join("\n");
  try {
    if (body.lite) {
      const out = await generateText(req, { system: LITE, json: true, tier: "fast", messages: [{ role: "user", content: `TEXT:\n${text}` }] });
      let x: Lite;
      try { x = parseJSON<Lite>(out); } catch { return Response.json({ error: "The local model's answer wasn't readable JSON. Try a bigger model.", raw: out.slice(0, 400) }, { status: 422 }); }
      return Response.json(fromLite(x, text));
    }
    const out = await generateText(req, {
      system: SYSTEM,
      json: true,
      tier: body.tier ?? "fast",
      messages: [{ role: "user", content: `KNOWN:\n${known || "(none yet)"}\n\nCHUNK:\n${text}` }],
    });
    let x: Extraction;
    try { x = parseJSON<Extraction>(out); }
    catch { return Response.json({ error: "The model's answer wasn't readable JSON. A bigger model does better here.", raw: out.slice(0, 400) }, { status: 422 }); }
    return Response.json({ entities: Array.isArray(x.entities) ? x.entities : [], links: Array.isArray(x.links) ? x.links : [], events: Array.isArray(x.events) ? x.events : [] });
  } catch (e) {
    return errorResponse(e);
  }
}
