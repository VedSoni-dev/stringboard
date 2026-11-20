import { enronSteps } from "../lib/samples/enron";
import { norm } from "../lib/board";
const { steps } = enronSteps();
for (const s of steps) {
  const t = norm(s.doc.text);
  const x = s.extraction;
  const all = [...x.entities.map((e) => ["E " + e.name, e.quote, [e.name, ...(e.aliases ?? [])]] as const), ...x.links.map((l) => ["L " + l.label, l.quote, null] as const), ...x.events.map((v) => ["V " + v.title, v.quote, null] as const)];
  for (const [what, q, names] of all) {
    if (q && !t.includes(norm(q).slice(0, 120))) console.log(s.doc.id, "QUOTE", what, "::", q);
    if (names && !names.some((n) => t.includes(norm(n)))) console.log(s.doc.id, "NAME", what);
  }
}
