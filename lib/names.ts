// Entity resolution: the same person shows up as "andrew.fastow@enron.com", "Fastow, Andrew S.", "Andy Fastow"
// and "Andy". Gotham calls this resolution; here it's a few honest rules, run on the person's own machine.
import type { Entity, Kind } from "./types";

const NICK: Record<string, string> = {
  andy: "andrew", drew: "andrew", jeff: "jeffrey", geoff: "jeffrey", ken: "kenneth", kenny: "kenneth", rick: "richard", rich: "richard",
  dick: "richard", ben: "benjamin", benji: "benjamin", mike: "michael", mikey: "michael", vince: "vincent", jim: "james", jimmy: "james",
  bob: "robert", rob: "robert", bobby: "robert", bill: "william", will: "william", liz: "elizabeth", beth: "elizabeth", kate: "katherine",
  katie: "katherine", tom: "thomas", tommy: "thomas", dave: "david", steve: "steven", sam: "samuel", alex: "alexander", chris: "christopher",
  matt: "matthew", dan: "daniel", danny: "daniel", joe: "joseph", tony: "anthony", nick: "nicholas", greg: "gregory", pat: "patrick",
  sue: "susan", jen: "jennifer", jenny: "jennifer", meg: "margaret", peggy: "margaret", ed: "edward", ted: "edward", larry: "lawrence",
};
const TITLES = new Set(["mr", "mrs", "ms", "dr", "jr", "sr", "ii", "iii", "iv", "prof", "sir", "evp", "cfo", "ceo", "vp"]);
const ORG_NOISE = /\b(the|inc|incorporated|corp|corporation|llc|l\.?l\.?c|lp|l\.?p|ltd|limited|co|company|plc|gmbh|group|holdings)\b\.?/g;
export const FREE_MAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|live|aol|icloud|me|mac|msn|proton|protonmail|gmx|mail|yandex|comcast|att|verizon)\./;

export interface PersonName { first?: string; last?: string; key: string }

export function personName(raw: string): PersonName {
  let s = raw.trim();
  const email = s.match(/^([^@\s]+)@/);
  if (email) s = email[1]!.replace(/[._-]+/g, " ");
  if (/,/.test(s) && !email) { const [l, f] = s.split(",", 2); s = `${f} ${l}`; } // "Fastow, Andrew S."
  const words = s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-zÀ-ɏ' -]/g, " ").split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, "")).filter((w) => w && !TITLES.has(w));
  const long = words.filter((w) => w.length > 1);
  if (!long.length) return { key: words.join(" ") || s.toLowerCase() };
  const last = long.length > 1 || words.length > 1 ? long[long.length - 1] : undefined;
  let first: string | undefined = words[0] === last ? undefined : words[0];
  if (first && NICK[first]) first = NICK[first];
  if (!last) return { first: long[0] && (NICK[long[0]] ?? long[0]), key: NICK[long[0]!] ?? long[0]! };
  return { first, last, key: [first && first.length > 1 ? first : first?.[0], last].filter(Boolean).join(" ") };
}

export const orgKey = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(ORG_NOISE, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
export const plainKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9$%.]/g, "");

export function keyOf(name: string, kind: Kind): string {
  if (kind === "person") return personName(name).key;
  if (kind === "org") return orgKey(name);
  return plainKey(name);
}

/** "andrew.fastow@enron.com" → "Andrew Fastow"; "j.kaminski@…" → "J. Kaminski". */
export function displayFromEmail(addr: string): string {
  const local = addr.split("@")[0]!.replace(/^\.+/, "");
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (!parts.length) return addr;
  return parts.map((p) => (p.length === 1 ? `${p.toUpperCase()}.` : p[0]!.toUpperCase() + p.slice(1))).join(" ");
}

export function orgFromDomain(addr: string): string | null {
  const domain = addr.split("@")[1]?.toLowerCase();
  if (!domain || FREE_MAIL.test(domain)) return null;
  const parts = domain.split(".");
  const core = parts.length > 2 && ["co", "com", "org", "net", "ac", "gov"].includes(parts[parts.length - 2]!) ? parts[parts.length - 3]! : parts[parts.length - 2]!;
  return core ? core[0]!.toUpperCase() + core.slice(1) : null;
}

/** Find the entity this name already is, or null. Same kind only. */
export function resolve(entities: Entity[], name: string, kind: Kind): Entity | null {
  const lower = name.trim().toLowerCase();
  const same = entities.filter((e) => e.kind === kind);
  const exact = same.find((e) => e.name.toLowerCase() === lower || e.aliases.some((a) => a.toLowerCase() === lower));
  if (exact) return exact;
  const k = keyOf(name, kind);
  if (!k) return null;
  const byKey = same.find((e) => keyOf(e.name, kind) === k || e.aliases.some((a) => keyOf(a, kind) === k));
  if (byKey || kind !== "person") return byKey ?? null;
  // People: same surname, and the first names agree (equal, an initial of the other, or one side has none),
  // and that surname is unique on the board so far, so two Fastows never collapse into one.
  const p = personName(name);
  if (!p.last) {
    // a lone first name ("Andy"): only when exactly one person on the board has that first name
    const hits = same.filter((e) => [e.name, ...e.aliases].some((n) => personName(n).first === p.first));
    return hits.length === 1 ? hits[0]! : null;
  }
  const sameLast = same.filter((e) => [e.name, ...e.aliases].some((n) => personName(n).last === p.last));
  if (sameLast.length !== 1) return null;
  const other = sameLast[0]!;
  const firsts = [other.name, ...other.aliases].map((n) => personName(n).first).filter(Boolean) as string[];
  if (!p.first || !firsts.length) return other;
  const ok = firsts.some((f) => f === p.first || (f.length === 1 && p.first!.startsWith(f)) || (p.first!.length === 1 && f.startsWith(p.first!)));
  return ok ? other : null;
}
