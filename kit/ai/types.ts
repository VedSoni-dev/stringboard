// Shared types for the studio kit. Server and client both import this file, so it holds no secrets and no Node APIs.

/** The ways a build can be powered. A build turns on the ones that make sense for it (studio.config.ts). */
export type Mode = "local" | "chatgpt" | "claude" | "openai" | "publik";
export const ALL_MODES: readonly Mode[] = ["local", "chatgpt", "claude", "openai", "publik"];

/** How hard the model should work. Each provider maps it to its own knob (Claude: effort; publik: tier model). */
export type Tier = "fast" | "balanced" | "smart";

export interface ChatMessage { role: "user" | "assistant"; content: string }

export interface AIRequest {
  /** Instructions for the model (Claude `system`, OpenAI `instructions`). */
  system?: string;
  messages: ChatMessage[];
  tier?: Tier;
  /** Ask for JSON only. Providers add an instruction; parse with parseJSON() from kit/ai. */
  json?: boolean;
}

export interface StudioConfig {
  app: {
    /** Display name, e.g. "Potluck". */
    name: string;
    /** Lowercase, url-safe. Also the subdomain: <slug>.vedantsoni.com, and the GitHub repo name. */
    slug: string;
    version: string;
    /** One line: what it does, in plain words. */
    tagline: string;
    /** https://github.com/VedSoni-dev/<slug> */
    repo: string;
    /** https://<slug>.vedantsoni.com */
    url: string;
    /** "Free alternative to X" when it is a clone; omit otherwise. */
    alternativeTo?: string;
  };
  /** Which modes this build offers, in the order the picker shows them. */
  modes: Mode[];
  /** Pre-selected when a person has not picked yet (must be in `modes` and available where it runs). */
  defaultMode?: Mode;
  claude?: { model?: string };
  /** Default OpenAI model; else the newest full model the person's key can use. */
  openai?: { model?: string };
  local?: { model?: string };
  chatgpt?: { model?: string };
}

/** What GET /api/studio/status answers. The client draws the picker from it. */
export interface StudioStatus {
  app: StudioConfig["app"];
  /** true on Vercel (or STUDIO_HOSTED=1): local models need the app on the person's machine; ChatGPT plan isn't offered at all. */
  hosted: boolean;
  mode: Mode | null;
  /** The mode that would answer right now (selected, else default, else the first ready one). */
  active: Mode | null;
  modes: ModeStatus[];
  runLocally: string;
}

export interface ModeStatus {
  id: Mode;
  label: string;
  blurb: string;
  /** false: cannot work where this copy runs (reason says why). */
  available: boolean;
  reason?: string;
  /** true: signed in / key saved / server found, ready to answer. */
  ready: boolean;
  /** "Signed in as a@b.com", "llama3.2 on Ollama", "Key ending …4f2a". */
  detail?: string;
  models?: { id: string; label: string }[];
  model?: string;
  /** Mode-specific extras the UI needs (ChatGPT: pending sign-in URL; publik: gate screen). */
  extra?: Record<string, unknown>;
}

/** Said next to every "Sign in with publik" button (kit mode picker, the hub's gate, a build's own gate). */
export const PUBLIK_CHEAPER = "20x cheaper than OpenAI and Anthropic";
/** The publik card's line when the builder's grant pays for answers (PUBLIK_SPONSOR_KEY is set). */
export const PUBLIK_FREE_BLURB = "Sign in with publik and chat free every day. No key, no plan.";

export const MODE_COPY: Record<Mode, { label: string; blurb: string }> = {
  local: { label: "Local model", blurb: "Runs on your computer with Ollama or LM Studio. Free and private." },
  chatgpt: { label: "ChatGPT plan", blurb: "Sign in with ChatGPT and use your Plus or Pro plan. No API key." },
  claude: { label: "Claude API key", blurb: "Paste your Anthropic key. It stays in an encrypted cookie on this browser." },
  openai: { label: "OpenAI API key", blurb: "Paste your OpenAI key. It stays in an encrypted cookie on this browser." },
  publik: { label: "publik", blurb: "Sign in with publik and use your publik plan. No key needed." },
};

/** A failure the UI can show as-is: one message and at most one action link. */
export interface StudioErrorBody { error: string; mode?: Mode; action?: { label: string; url: string } }
