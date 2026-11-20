// PDF → text, in memory. Nothing is written to disk or kept: the text goes straight back to the browser.
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Send a PDF as 'file'." }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: `${file.name} is over 25 MB. Split it, or run Stringboard on your computer.` }, { status: 413 });
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map((t, i) => `--- page ${i + 1} ---\n${t.trim()}`).join("\n\n");
    if (pages.replace(/--- page \d+ ---/g, "").trim().length < 20) return Response.json({ error: `${file.name} has no text layer (it's a scan). Run it through OCR first.` }, { status: 422 });
    return Response.json({ text: pages.slice(0, 600_000), pages: Array.isArray(text) ? text.length : 1 });
  } catch {
    return Response.json({ error: `Couldn't read ${file.name}. Is it a real PDF?` }, { status: 422 });
  }
}
