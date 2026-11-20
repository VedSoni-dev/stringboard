// The board's data model. Plain JSON so it lives in IndexedDB on the person's own browser (never on a server).
//
//   Doc       a file (or one email / one chat) the person dropped in
//   Evidence  an exact quote from a doc; every entity, link and event points at evidence
//   Entity    a person, org, place, money amount, account, thing
//   Link      a string between two entities ("paid", "works at", "emailed")
//   Event     something that happened on a date, with who was in it

export type Kind = "person" | "org" | "place" | "money" | "account" | "thing";
export const KINDS: Kind[] = ["person", "org", "place", "money", "account", "thing"];
export const KIND_LABEL: Record<Kind, string> = {
  person: "Person", org: "Organisation", place: "Place", money: "Money", account: "Account", thing: "Project / thing",
};

export type DocType = "email" | "chat" | "pdf" | "csv" | "text";

export interface Message { at?: string; from?: string; to?: string[]; text: string }

export interface Doc {
  id: string;
  name: string;
  type: DocType;
  text: string;
  date?: string;        // ISO, the doc's own date when it has one (an email's Date header)
  from?: string;        // email sender / chat author when the whole doc has one
  to?: string[];
  messages?: Message[]; // chats and mailboxes: one per message, for metadata (who talks to whom, when)
  sample?: boolean;
}

export interface Evidence { id: string; doc: string; quote: string; date?: string }

export interface Entity {
  id: string;
  name: string;
  kind: Kind;
  aliases: string[];
  note?: string;        // one line: who or what this is
  evidence: string[];
  firstSeen?: string;
  lastSeen?: string;
  /** 'meta' when it only came from headers (an email address), 'ai' once extraction saw it. */
  origin: "meta" | "ai";
}

export interface Link {
  id: string;
  a: string;
  b: string;
  label: string;
  /** 'comm' = they emailed / messaged (from headers); 'ai' = a relation the model read in the text. */
  origin: "comm" | "ai";
  count: number;
  date?: string;
  evidence: string[];
}

export interface BoardEvent { id: string; date: string; title: string; who: string[]; evidence: string[] }

export interface Board {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  docs: Doc[];
  entities: Entity[];
  links: Link[];
  events: BoardEvent[];
  evidence: Evidence[];
  /** Quotes the model returned that were not in the source text: dropped, counted so people see the filter work. */
  rejected: number;
  sample?: boolean;
}

/** What /api/extract returns for one chunk (refs are local to the chunk, or ids of known entities). */
export interface Extraction {
  entities: { ref: string; name: string; kind: Kind; aliases?: string[]; note?: string; quote?: string }[];
  links: { a: string; b: string; label: string; date?: string; quote: string }[];
  events: { date: string; title: string; who: string[]; quote: string }[];
}

export interface Chunk { id: string; doc: string; text: string; date?: string; header: string }

export const emptyBoard = (name: string): Board => {
  const now = new Date().toISOString();
  return { id: `b${Date.now().toString(36)}`, name, createdAt: now, updatedAt: now, docs: [], entities: [], links: [], events: [], evidence: [], rejected: 0 };
};
