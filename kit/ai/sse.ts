// Server-sent events reader for fetch() bodies (OpenAI Responses, Chat Completions, Ollama's OpenAI endpoint).

export interface SSEEvent { event: string | null; data: string }

export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.search(/\r?\n\r?\n/)) !== -1) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut).replace(/^\r?\n\r?\n/, "");
        const ev = parseBlock(block);
        if (ev) yield ev;
      }
    }
    const tail = parseBlock(buf);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SSEEvent | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

/** Chat Completions streaming (Ollama, LM Studio, publik): yields content deltas. Falls back to a plain JSON body. */
export async function* chatCompletionDeltas(res: Response): AsyncGenerator<string> {
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream")) {
    const body = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: unknown } }[] };
    const c = body.choices?.[0]?.message?.content;
    if (typeof c === "string" && c) yield c;
    return;
  }
  for await (const ev of readSSE(res.body!)) {
    if (ev.data === "[DONE]") return;
    try {
      const j = JSON.parse(ev.data) as { choices?: { delta?: { content?: unknown } }[]; error?: { message?: string } };
      if (j.error?.message) throw new Error(j.error.message);
      const d = j.choices?.[0]?.delta?.content;
      if (typeof d === "string" && d) yield d;
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
}
