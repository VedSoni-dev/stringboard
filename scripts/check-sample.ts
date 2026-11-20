// node --experimental-strip-types: builds the sample board and reports dropped quotes + duplicate-looking entities.
import { enronBoard } from "../lib/samples/enron";
const b = enronBoard();
console.log("entities", b.entities.length, "links", b.links.length, "ai links", b.links.filter((l) => l.origin === "ai").length, "events", b.events.length, "evidence", b.evidence.length, "REJECTED", b.rejected);
const byKind: Record<string, string[]> = {};
for (const e of b.entities) (byKind[e.kind] ??= []).push(e.name + (e.origin === "meta" ? "°" : ""));
for (const [k, v] of Object.entries(byKind)) console.log(k, v.length, v.join(" | "));
