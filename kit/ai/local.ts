// Mode "local": a model running on the person's own computer, through Ollama or LM Studio's
// OpenAI-compatible endpoint. Free, private, offline. Only works when this server runs on that computer.
import type { AIRequest } from "./types";
import { chatCompletionDeltas } from "./sse";
import { StudioError } from "./seal";

interface Server { name: "Ollama" | "LM Studio" | "Custom"; base: string; models: string[] }

const CANDIDATES: { name: Server["name"]; base: string; list: (base: string) => Promise<string[]> }[] = [
  { name: "Ollama", base: process.env.OLLAMA_HOST?.replace(/\/$/, "") || "http://127.0.0.1:11434", list: async (b) => {
    const r = await fetch(`${b}/api/tags`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return ((await r.json()) as { models?: { name: string }[] }).models?.map((m) => m.name) ?? [];
  } },
  { name: "LM Studio", base: "http://127.0.0.1:1234", list: async (b) => {
    const r = await fetch(`${b}/v1/models`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return ((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id).filter((id) => !/embed/i.test(id)) ?? [];
  } },
];

/** The first local model server that answers, with its models. STUDIO_LOCAL_BASE_URL points at any other OpenAI-compatible server. */
export async function findLocalServer(): Promise<Server | null> {
  const custom = process.env.STUDIO_LOCAL_BASE_URL?.replace(/\/$/, "");
  if (custom) {
    try {
      const r = await fetch(`${custom}/models`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
      const ids = ((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [];
      return { name: "Custom", base: custom.replace(/\/v1$/, ""), models: ids };
    } catch { return null; }
  }
  for (const c of CANDIDATES) {
    try { return { name: c.name, base: c.base, models: await c.list(c.base) }; } catch { /* not running */ }
  }
  return null;
}

export async function localStatus(preferred?: string) {
  const s = await findLocalServer();
  if (!s) return { ready: false, detail: undefined, models: [] as { id: string; label: string }[] };
  const model = preferred && s.models.includes(preferred) ? preferred : s.models[0];
  return {
    ready: !!model,
    detail: model ? `${model} on ${s.name}` : `${s.name} is running but has no models. Run: ollama pull llama3.2`,
    models: s.models.map((id) => ({ id, label: id })),
    model,
  };
}

export async function* localStream(req: AIRequest, preferred?: string, signal?: AbortSignal): AsyncGenerator<string> {
  const s = await findLocalServer();
  if (!s) throw new StudioError(503, "No local model is running. Start Ollama (or LM Studio) and try again.", { label: "Get Ollama", url: "https://ollama.com/download" });
  const model = preferred && s.models.includes(preferred) ? preferred : s.models[0];
  if (!model) throw new StudioError(409, `${s.name} has no models yet. Run: ollama pull llama3.2`);
  const system = [req.system, req.json ? "Answer with one JSON value only: no prose, no code fence." : ""].filter(Boolean).join("\n\n");
  let res: Response;
  try {
    res = await fetch(`${s.base}/v1/chat/completions`, {
      method: "POST", signal, cache: "no-store", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model, stream: true,
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
        messages: [...(system ? [{ role: "system", content: system }] : []), ...req.messages],
      }),
    });
  } catch {
    throw new StudioError(503, `Couldn't reach ${s.name}. Is it still running?`);
  }
  if (!res.ok) throw new StudioError(502, `${s.name} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  yield* chatCompletionDeltas(res);
}
