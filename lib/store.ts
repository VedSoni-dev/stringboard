// Boards live in IndexedDB on this browser only. No server copy, no account. Every call fails soft (private windows).
import type { Board } from "./types";

const DB = "stringboard", STORE = "boards";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function listBoards(): Promise<Pick<Board, "id" | "name" | "updatedAt" | "sample">[]> {
  try {
    const all = await tx<Board[]>("readonly", (s) => s.getAll() as IDBRequest<Board[]>);
    return all.map(({ id, name, updatedAt, sample }) => ({ id, name, updatedAt, sample })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch { return []; }
}
export async function loadBoard(id: string): Promise<Board | null> {
  try { return (await tx<Board | undefined>("readonly", (s) => s.get(id) as IDBRequest<Board | undefined>)) ?? null; } catch { return null; }
}
export async function saveBoard(b: Board): Promise<void> {
  try { await tx("readwrite", (s) => s.put(structuredClone(b))); } catch { /* storage blocked: the board still works for this tab */ }
}
export async function deleteBoard(id: string): Promise<void> {
  try { await tx("readwrite", (s) => s.delete(id)); } catch { /* nothing to do */ }
}
