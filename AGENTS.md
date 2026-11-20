# Stringboard: notes for coding agents

- Next.js (App Router) + TypeScript + Tailwind v4. `npm run dev`, `npm run build`, `npm run typecheck`.
- `/` is the public landing page; `/app` is the app (wrapped in `<StudioProvider>` by `app/app/layout.tsx`).
- **AI goes through the kit only:** `streamText(req, { system, messages, tier })` or `generateText(...)` from `@/kit/ai` in a
  server route. Never call a model SDK directly; never put a key in client code. The person's chosen mode (local model,
  ChatGPT plan, Claude key, publik) is resolved by the kit from their cookies.
- Client: `useAI()` streams from `/api/ai`; `<ModeGate>` and `<ModeButton>` from `@/kit/react/ModePanel`.
- `kit/` is shared across all builds and synced from the studio (`~/Projects/vedanttalksai`, `npm run kit:sync`). Don't
  edit it here; change it in the studio and sync.
- Design: `DESIGN.md`, tokens in `kit/ui/kit.css` + the theme file. Motion and UX rules: the studio's `docs/principles.md`.
- Never read `.env*` files, print keys or tokens, or commit them.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
