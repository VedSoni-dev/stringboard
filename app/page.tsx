// The public landing page at "/": what it is, the real product building itself, how it works, how to run it.
import Link from "next/link";
import config from "@/studio.config";
import { MODE_COPY } from "@/kit/ai/types";
import { Backdrop } from "@/components/Backdrop";
import { HeroBoard } from "@/components/HeroBoard";
import { Mark } from "@/components/Mark";

const INPUTS = [
  ["WhatsApp", "Export chat → .txt"],
  ["Telegram", "Desktop export (.json)"],
  ["Instagram & Messenger", "Your data download (.json)"],
  ["Email", ".eml files or a whole .mbox"],
  ["PDFs", "Contracts, statements, reports"],
  ["CSV", "Bank and card statements"],
] as const;

export default function Landing() {
  const { app } = config;
  const run = `git clone ${app.repo}.git && cd ${app.slug} && npm install && npm run dev`;
  return (
    <>
      <a href="#how" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg">Skip to how it works</a>
      <header className="absolute inset-x-0 top-0 z-20">
        <nav className="wrap flex items-center justify-between py-3">
          <Link href="/" className="flex min-h-11 items-center gap-2 font-display text-[15px] font-semibold"><Mark /> {app.name}</Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="hidden sm:contents">
              <a href="#how" className="sk-link flex min-h-11 items-center px-3 text-sm text-muted hover:text-fg">How it works</a>
              <a href={app.repo} className="sk-link flex min-h-11 items-center px-3 text-sm text-muted hover:text-fg" target="_blank" rel="noopener noreferrer">GitHub</a>
            </span>
            <Link href="/app" className="sk-btn">Start a board</Link>
          </div>
        </nav>
      </header>

      <main className="relative isolate overflow-x-clip">
        {/* 1 · hero: the real board, building itself */}
        <section className="relative flex min-h-[100svh] items-center pb-12 pt-[84px]">
          <div className="pointer-events-none absolute inset-0 -z-10 opacity-60 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]" aria-hidden><Backdrop className="absolute inset-0" /></div>
          <div className="wrap grid items-center gap-y-10 lg:grid-cols-12 lg:gap-x-6">
            <div className="sk-stagger relative lg:col-span-5" data-enter>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Open-source take on Palantir Gotham</p>
              <h1 className="mt-5 text-[2.6rem] font-semibold leading-[0.98] sm:text-6xl">An investigation board for your chats, emails and files.</h1>
              <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-fg/75">Drop in a group chat, an inbox or a stack of PDFs. Stringboard pulls out every person, company, place and dollar amount, strings them together, and cites the exact line each string came from.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/app?sample" className="sk-btn">Open the Enron board</Link>
                <Link href="/app" className="sk-btn sk-btn-quiet">Start with your files</Link>
              </div>
              <p className="mt-7 font-mono text-xs text-muted">Free · MIT licensed · runs on a local model, so your files never leave your laptop</p>
            </div>
            <div className="sk-rise relative h-[min(70svh,660px)] min-h-[380px] overflow-hidden lg:col-span-7 rounded-[var(--radius)] border border-line bg-bg shadow-[var(--shadow-3)]" style={{ animationDelay: "140ms" }}>
              <div className="flex items-center gap-2 border-b border-line bg-card px-3.5 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-line" /><span className="h-2.5 w-2.5 rounded-full bg-line" /><span className="h-2.5 w-2.5 rounded-full bg-line" />
                <span className="ml-2 truncate font-mono text-[11px] text-muted">stringboard / Enron: 20 public emails</span>
              </div>
              <div className="absolute inset-x-0 bottom-0 top-[37px]"><HeroBoard /></div>
            </div>
          </div>
        </section>

        {/* 2 · every string has a source */}
        <section className="flex items-center py-20 lg:min-h-[100svh]">
          <div className="wrap grid items-center gap-y-12 lg:grid-cols-12 lg:gap-x-6">
            <div className="lg:col-span-6">
              <h2 className="text-4xl font-semibold leading-[1.02] sm:text-5xl">Every red string points at a real line.</h2>
              <p className="mt-6 max-w-[32rem] text-[17px] leading-relaxed text-fg/75">The model has to quote your file word for word. Stringboard checks each quote against the original and throws out anything it can&apos;t find. A guess never makes the board.</p>
              <p className="mt-4 max-w-[32rem] text-[17px] leading-relaxed text-fg/75">Click a string, read the email it came from, with the line lit up.</p>
              <Link href="/app?sample" className="sk-btn mt-8">Try it on the Enron emails</Link>
            </div>
            <div className="space-y-3 lg:col-span-6">
              {[
                ["Rick Buy", "said was blown up", "Raptor", "Now that Raptor is blown up, should we begin valuation efforts of assets", "RE: Raptor Debris · 3 Oct 2001"],
                ["Vince Kaminski", "refused to back valuations to", "Ryan Siurek", "I cannot support the valuations my group has produced so far for the LJM/Raptor related transactions", "FW: LJM/Raptor valuations · 4 Oct 2001"],
                ["Sherron Watkins", "warned in person", "Kenneth Lay", "this is the page I reviewed with Lay on 8/22", "The key questions I asked Lay on Aug 22 · 30 Oct 2001"],
              ].map(([a, l, b, q, src]) => (
                <figure key={a} className="rounded-[var(--radius)] border border-line bg-card p-5 shadow-[var(--shadow-2)]">
                  <p className="text-lg"><span className="font-semibold">{a}</span> <span className="font-mono text-sm text-accent">— {l} →</span> <span className="font-semibold">{b}</span></p>
                  <blockquote className="mt-4 border-l-2 border-accent pl-4 text-[16px] leading-relaxed text-fg/85">“{q}”</blockquote>
                  <p className="mt-3 font-mono text-[11px] text-muted">{src} · quote found in source</p>
                </figure>
              ))}
              <div className="flex items-center justify-between rounded-[var(--radius)] border border-dashed border-line px-5 py-3 font-mono text-xs text-muted">
                <span>Unsourced claims on the sample board</span><span className="text-lg text-fg">0</span>
              </div>
            </div>
          </div>
        </section>

        {/* 3 · how it works */}
        <section id="how" className="flex items-center py-20 lg:min-h-[100svh]">
          <div className="wrap">
            <h2 className="max-w-3xl text-4xl font-semibold leading-[1.02] sm:text-5xl">Three passes, from a pile of files to a board.</h2>
            <ol className="mt-12 grid gap-3 md:grid-cols-3">
              {[
                ["01", "Parse", "Chat exports, inboxes, PDFs and statements become messages with a sender, a time and the words. In your browser."],
                ["02", "Headers", "Who talks to whom, and when, straight from the metadata. The first graph lands in under a second, before any AI runs."],
                ["03", "Read", "Your AI reads the text chunk by chunk: people, companies, money, places, who did what to whom. Every claim carries its quote."],
              ].map(([n, t, d]) => (
                <li key={n} className="rounded-[var(--radius)] border border-line bg-card p-6">
                  <p className="font-mono text-xs text-accent">{n}</p>
                  <h3 className="mt-6 text-xl font-semibold">{t}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-fg/70">{d}</p>
                </li>
              ))}
            </ol>
            <ul className="mt-10 grid gap-px overflow-hidden rounded-[var(--radius)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {INPUTS.map(([k, v]) => (
                <li key={k} className="flex min-h-16 items-center justify-between gap-4 bg-bg px-5 py-4">
                  <span className="font-medium">{k}</span><span className="text-right font-mono text-[11px] text-muted">{v}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 4 · the AI is yours, and so is the code */}
        <section className="flex items-center py-20 lg:min-h-[100svh]">
          <div className="wrap grid items-start gap-y-12 lg:grid-cols-12 lg:gap-x-6">
            <div className="lg:col-span-6">
              <h2 className="text-4xl font-semibold leading-[1.02] sm:text-5xl">Your files stay yours.</h2>
              <p className="mt-6 max-w-[30rem] text-[17px] leading-relaxed text-fg/75">No account with us and no upload. Boards are saved in your browser. Point it at a local model and not one word leaves your computer.</p>
              <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Run your own copy · MIT</p>
              <pre className="mt-3 whitespace-pre-wrap break-all border-y border-line py-4 font-mono text-[13px] leading-relaxed"><span className="select-none text-accent">$ </span>{run}</pre>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/app" className="sk-btn">Start a board</Link>
                <a href={app.repo} className="sk-btn sk-btn-quiet" target="_blank" rel="noopener noreferrer">Read the source</a>
              </div>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:col-span-6">
              {config.modes.map((m) => (
                <li key={m} className="flex min-h-[180px] flex-col rounded-[var(--radius)] border border-line bg-card p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xl font-semibold">{MODE_COPY[m].label}</h3>
                    {m === "local" && <span className="rounded-[3px] border border-[var(--ok)]/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--ok)]">Most private</span>}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-fg/70">{MODE_COPY[m].blurb}</p>
                  <p className="mt-auto pt-4 font-mono text-[11px] text-muted">{m === "local" || m === "chatgpt" ? "On your computer" : "Web and your computer"}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="wrap grid gap-3 py-8 text-sm text-muted lg:grid-cols-12 lg:gap-x-6">
          <span className="lg:col-span-6">Built by Vedant Soni · <a className="sk-link underline underline-offset-4" href="https://instagram.com/vedanttalksai" target="_blank" rel="noopener noreferrer">@vedanttalksai</a></span>
          <span className="lg:col-span-6">Inspired by Palantir Gotham&apos;s link analysis. Not affiliated with Palantir. Sample: public Enron emails (FERC, 2003).</span>
        </div>
      </footer>
    </>
  );
}
