// Ask the board a question. The browser sends the board (entities, links, events) and the quotes that match the
// question; the answer streams back with {entity ids} and [evidence ids] the UI turns into lit nodes and source chips.
import { streamText } from "@/kit/ai";
import type { ChatMessage } from "@/kit/ai/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM = `You are the analyst inside Stringboard, a link-analysis board built from the user's own files.

You get BOARD (entities with ids like e12, links between them, dated events) and EVIDENCE (exact quotes with ids like x40).
Answer the question like a sharp intelligence briefing: the answer first, in one or two sentences, then the chain of facts that supports it.

Rules:
- Mention entities by writing their id in braces right after the name: "Andrew Fastow {e3} ran LJM {e9}". Every entity you name gets its id.
- Back every factual claim with evidence ids in square brackets: "...was 'blown up' [x41]". Only cite ids from EVIDENCE.
- Dates: an EVENT's date is when it happened. An email's date is only when it was sent, which can be weeks later. Answer "when" with the event date, and say if they differ.
- If the board doesn't contain the answer, say what is missing and which file would settle it. Never invent facts, people or dates.
- Use plain words. Short paragraphs, or a short numbered chain when it's a sequence. No headings. Under 180 words unless asked for more.`;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { question?: string; board?: string; evidence?: string; history?: ChatMessage[]; focus?: string };
  const q = (body.question ?? "").trim().slice(0, 2000);
  if (!q) return Response.json({ error: "Ask a question first." }, { status: 400 });
  const context = `BOARD:\n${(body.board ?? "").slice(0, 60_000)}\n\nEVIDENCE:\n${(body.evidence ?? "").slice(0, 40_000)}${body.focus ? `\n\nFOCUS: ${body.focus.slice(0, 400)}` : ""}`;
  const history = (body.history ?? []).slice(-6).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  return streamText(req, {
    system: SYSTEM,
    tier: "balanced",
    messages: [...history, { role: "user", content: `${context}\n\nQUESTION: ${q}` }],
  });
}
