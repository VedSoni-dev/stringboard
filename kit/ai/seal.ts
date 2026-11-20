// Cookie sealing and a tiny cookie-jar type, shared by every provider.
// A sealed cookie is AES-256-GCM encrypted with STUDIO_COOKIE_SECRET, http-only, so only this server can read it.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** The part of Next's `await cookies()` the kit uses. */
export interface Jar {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, opts?: CookieOpts): unknown;
  delete(name: string): unknown;
}
export interface CookieOpts { httpOnly?: boolean; sameSite?: "lax" | "strict" | "none"; secure?: boolean; path?: string; maxAge?: number }

export const YEAR = 60 * 60 * 24 * 365;

let warned = false;
function secret(): string {
  const s = process.env.STUDIO_COOKIE_SECRET?.trim();
  if (s) return s;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL && !warned) {
    warned = true;
    process.stderr.write("studio: STUDIO_COOKIE_SECRET is not set; sealed cookies use a per-boot key and sign everyone out on each deploy.\n");
  }
  // Per-process random key: safe (nobody can forge it) but sessions end when the server restarts.
  return (globalThis as { __studioBootKey?: string }).__studioBootKey ??= randomBytes(32).toString("base64");
}
const keyFor = (purpose: string) => createHash("sha256").update(`studio:${purpose}:${secret()}`).digest();

export function seal(purpose: string, value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFor(purpose), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64url");
}

export function unseal<T>(purpose: string, sealed: string | undefined): T | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    const d = createDecipheriv("aes-256-gcm", keyFor(purpose), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8")) as T;
  } catch { return null; }
}

export const isHttps = (req: Request) =>
  (req.headers.get("x-forwarded-proto") ?? "").split(",")[0]!.trim() === "https" || new URL(req.url).protocol === "https:";

export const cookieOpts = (req: Request, maxAge?: number): CookieOpts =>
  ({ httpOnly: true, sameSite: "lax", secure: isHttps(req), path: "/", ...(maxAge ? { maxAge } : {}) });

/** true on Vercel or when STUDIO_HOSTED=1: the server is not the person's own computer. */
export const isHosted = () => !!process.env.VERCEL || process.env.STUDIO_HOSTED === "1";

/** A readable failure: the route turns it into { error, action } with this status. */
export class StudioError extends Error {
  constructor(public status: number, message: string, public action?: { label: string; url: string }) { super(message); }
}
