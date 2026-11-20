// Tells the builds hub which build a person is using, so the hub can split publik's one-listing numbers by build.
// Anonymous: the build's slug, the event, the AI mode, and a random id kept in a cookie on this browser.
// No content, no IP, no account. Never sent for browsers with Do Not Track / Global Privacy Control, or when the
// operator sets DO_NOT_TRACK / STUDIO_BEACON=off. Fire-and-forget: the hub being down never slows or breaks a build.
import { randomUUID } from "node:crypto";
import hub from "../hub.json";
import config from "@/studio.config";
import type { Mode } from "./types";
import { cookieOpts, YEAR, type Jar } from "./seal";

export type BeaconEvent = "app_opened" | "active_session" | "ai_call";
const COOKIE = `${config.app.slug}-studio-id`;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function off(req: Request): boolean {
  if (req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1") return true;
  const dnt = (process.env.DO_NOT_TRACK ?? "").trim().toLowerCase();
  if (dnt !== "" && dnt !== "0" && dnt !== "false") return true;
  return ["0", "false", "off"].includes((process.env.STUDIO_BEACON ?? "").trim().toLowerCase());
}

/** This browser's anonymous id (created on first use). */
function installId(jar: Jar, req: Request): string {
  const v = (jar.get(COOKIE)?.value ?? "").toLowerCase();
  if (UUID4.test(v)) return v;
  const id = randomUUID();
  try { jar.set(COOKIE, id, cookieOpts(req, YEAR)); } catch { /* read-only context: still count, with a throwaway id */ }
  return id;
}

export function beacon(jar: Jar, req: Request, event: BeaconEvent, extra: { mode?: Mode | null; publik?: boolean } = {}): void {
  if (off(req)) return;
  const url = `${(process.env.STUDIO_HUB_URL || hub.hubUrl).replace(/\/$/, "")}/api/beacon`;
  const body = { v: 1, build: config.app.slug, event, mode: extra.mode ?? null, install: installId(jar, req), publik: !!extra.publik, app_version: config.app.version };
  const debug = process.env.STUDIO_BEACON_DEBUG === "1";
  void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000), cache: "no-store" })
    .then((r) => { if (debug) process.stderr.write(`studio-beacon: ${event} ${extra.mode ?? ""} -> ${r.status}\n`); })
    .catch((e) => { if (debug) process.stderr.write(`studio-beacon: ${event} -> ${e instanceof Error ? e.name : "error"}\n`); });
}
