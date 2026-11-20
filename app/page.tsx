// The public landing page at "/": what it is, the real product, and how to run it. Nobody signs in to see this.
// The taste skill restyles it per build (docs/design.md); keep the structure: nav, hero, the product, modes, open source, footer.
import Link from "next/link";
import { existsSync } from "node:fs";
import { join } from "node:path";
import config from "@/studio.config";
import { MODE_COPY } from "@/kit/ai/types";
import { Backdrop } from "@/components/Backdrop";

export default function Landing() {
  const { app } = config;
  const run = `git clone ${app.repo}.git && cd ${app.slug} && npm install && npm run dev`;
  return (
    <main className="relative isolate overflow-hidden">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" className="flex min-h-11 items-center font-display text-lg font-semibold">{app.name}</Link>
        <div className="flex items-center gap-2">
          <a href={app.repo} className="sk-btn sk-btn-quiet" target="_blank" rel="noopener noreferrer">GitHub</a>
          <Link href="/app" className="sk-btn">Open {app.name}</Link>
        </div>
      </nav>

      <section className="relative mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pt-24">
        <Backdrop />
        <div className="sk-stagger max-w-3xl">
          {app.alternativeTo && <p className="font-mono text-xs uppercase tracking-widest text-muted">Free, open-source alternative to {app.alternativeTo}</p>}
          <h1 className="mt-4 text-5xl font-semibold leading-[0.95] sm:text-7xl">{app.tagline}</h1>
          <p className="mt-6 max-w-xl text-lg text-muted">The link-analysis idea behind Palantir Gotham, rebuilt open source for normal people. Free. Runs on a local model so your files never leave your laptop</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app" className="sk-btn">Open {app.name} →</Link>
            <a href={app.repo} className="sk-btn sk-btn-quiet" target="_blank" rel="noopener noreferrer">Star on GitHub</a>
          </div>
        </div>
        {/* The real product, captured by tools/capture.mjs (never a mockup): public/hero.png. */}
        {existsSync(join(process.cwd(), "public/hero.png")) && <div className="sk-rise mt-14 overflow-hidden rounded-[var(--radius)] border border-line bg-card shadow-[var(--shadow-3)]" style={{ animationDelay: "160ms" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hero.png" alt={`${app.name} in use`} className="block w-full" />
        </div>}
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <h2 className="text-3xl font-semibold sm:text-4xl">Bring your own AI</h2>
        <p className="mt-3 max-w-xl text-muted">No account with us. Pick what powers it.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {config.modes.map((m) => (
            <div key={m} className="rounded-[var(--radius)] border border-line bg-card p-5 shadow-[var(--shadow-1)]">
              <h3 className="text-lg font-semibold">{MODE_COPY[m].label}</h3>
              <p className="mt-1 text-sm text-muted">{MODE_COPY[m].blurb}{(m === "local" || m === "chatgpt") && " Runs on your computer."}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <h2 className="text-3xl font-semibold sm:text-4xl">Open source. Run it yourself.</h2>
        <p className="mt-3 max-w-xl text-muted">MIT licensed. One command, then open localhost:3000.</p>
        <pre className="mt-6 overflow-x-auto rounded-[var(--radius-sm)] border border-line bg-bg-2 p-4 font-mono text-sm">{run}</pre>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-8 text-sm text-muted sm:px-8">
        <span>Built by Vedant Soni · <a className="underline underline-offset-4" href="https://instagram.com/vedanttalksai" target="_blank" rel="noopener noreferrer">@vedanttalksai</a></span>
        <a className="underline underline-offset-4" href={app.repo} target="_blank" rel="noopener noreferrer">Source on GitHub</a>
      </footer>
    </main>
  );
}
