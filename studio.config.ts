// One file says what this build is and which AI modes it offers. The kit reads it everywhere.
import type { StudioConfig } from "@/kit/ai/types";

const config: StudioConfig = {
  app: {
    name: "Stringboard",
    slug: "stringboard",
    version: "0.1.0",
    tagline: "Drop in your chats, emails and files. Get an investigation board of everyone and everything in them",
    repo: "https://github.com/VedSoni-dev/stringboard",
    url: "https://stringboard.vedantsoni.com",
    alternativeTo: "Palantir Gotham",
  },
  // Pick the modes that make sense for this build (docs/auth.md). Order = order in the picker. The hosted picker hides ChatGPT plan (local runs only).
  modes: ["local","claude","publik","chatgpt"],
  defaultMode: "claude",
};

export default config;
