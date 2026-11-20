// This build's AI call. Whatever mode the person picked (local model, ChatGPT plan, Claude key, publik),
// streamText() routes it there; keep prompts here and the kit does the rest.
import { streamText } from "@/kit/ai";
import type { ChatMessage } from "@/kit/ai/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM = `You are Stringboard, an investigation board for the user's chats, emails and files.
Answer in plain language. Keep it short unless asked for more.`;

export async function POST(req: Request) {
  const { messages } = (await req.json().catch(() => ({}))) as { messages?: ChatMessage[] };
  if (!Array.isArray(messages) || !messages.length) return Response.json({ error: "Send at least one message." }, { status: 400 });
  return streamText(req, { system: SYSTEM, messages: messages.slice(-40), tier: "balanced" });
}
