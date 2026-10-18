import {
  doc, getDocFromServer, runTransaction, serverTimestamp, type DocumentData,
  type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction,
} from "firebase/firestore";
import { collections, type Records } from "./workspace-codec.ts";

export type Domain = typeof collections[number];
export type DomainNumbers = Record<Domain, number>;
export type SyncStamp = { revision: number; domains: DomainNumbers; counts: DomainNumbers };
const CACHE_VERSION = 2;
const names: readonly Domain[] = collections;

export function emptyNumbers(): DomainNumbers {
  return Object.fromEntries(names.map(name => [name, 0])) as DomainNumbers;
}
export function recordCounts(records: Records | Map<string, unknown>): DomainNumbers {
  const counts = emptyNumbers();
  for (const key of records.keys()) {
    const name = key.split("/")[0] as Domain;
    if (name in counts) counts[name]++;
  }
  return counts;
}
export function parseSync(data: DocumentData | undefined): SyncStamp | null {
  if (!data) return null;
  if (!Number.isSafeInteger(data.revision) || data.revision < 1) return null;
  const domains = emptyNumbers(), counts = emptyNumbers();
  for (const name of names) {
    if (!Number.isSafeInteger(data.domains?.[name]) || data.domains[name] < 0 ||
        !Number.isSafeInteger(data.counts?.[name]) || data.counts[name] < 0) return null;
    domains[name] = data.domains[name];
    counts[name] = data.counts[name];
  }
  return { revision: data.revision, domains, counts };
}
export function syncRef(db: Firestore, uid: string): DocumentReference {
  return doc(db, "users", uid, "sync", "state");
}
export async function readSync(db: Firestore, uid: string): Promise<SyncStamp | null> {
  const snap = await getDocFromServer(syncRef(db, uid));
  if (!snap.exists()) return null;
  const parsed = parseSync(snap.data());
  if (!parsed) throw new Error("Estado de sincronização inválido; não é seguro reutilizar o cache.");
  return parsed;
}
export async function bootstrapSync(db: Firestore, uid: string, counts: DomainNumbers): Promise<SyncStamp> {
  return runTransaction(db, async tx => {
    const ref = syncRef(db, uid), existing = await tx.get(ref);
    if (existing.exists()) {
      const stamp = parseSync(existing.data());
      if (!stamp) throw new Error("Estado de sincronização inválido.");
      return stamp;
    }
    const stamp = {revision: 1, domains: emptyNumbers(), counts};
    tx.set(ref, {...stamp, ownerUid: uid, schemaVersion: 1,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()});
    return stamp;
  });
}
export function advanceSync(
  tx: Transaction, ref: DocumentReference, snapshot: DocumentSnapshot,
  beforeCounts: DomainNumbers, afterCounts: DomainNumbers,
  changedDomains: ReadonlySet<Domain>,
): SyncStamp {
  const old = snapshot.exists() ? parseSync(snapshot.data()) : null;
  if (snapshot.exists() && !old) throw new Error("Estado de sincronização inválido.");
  const domains = {...(old?.domains ?? emptyNumbers())};
  const counts = {...(old?.counts ?? beforeCounts)};
  for (const domain of changedDomains) {
    domains[domain]++;
    const delta = afterCounts[domain] - beforeCounts[domain];
    if (counts[domain] + delta < 0) throw new Error("Contagem inconsistente; recarregue seus dados.");
    counts[domain] += delta;
  }
  const stamp = {revision: (old?.revision ?? 0) + 1, domains, counts};
  const metadata = {ownerUid: ref.parent.parent!.id, schemaVersion: 1,
    revision: stamp.revision, updatedAt: serverTimestamp()};
  if (snapshot.exists()) tx.update(ref, {...stamp, updatedAt: serverTimestamp()});
  else tx.set(ref, {...stamp, ...metadata, createdAt: serverTimestamp()});
  return stamp;
}
type SnapshotManifest = {version: number; domains: DomainNumbers};
function manifestKey(uid: string): string { return "roteiva-cache-v2:" + uid; }
/** A cache hit is only safe after verifying server revisions and counts.
 * Storage failures fall back to a full server read.
 */
export function persistentCacheSelected(): boolean {
  try { return typeof window !== "undefined" && !!window.localStorage; }
  catch { return false; }
}
export function readManifest(uid: string): SnapshotManifest | null {
  if (!persistentCacheSelected()) return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(manifestKey(uid)) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const item = parsed as Partial<SnapshotManifest>;
    if (item.version !== CACHE_VERSION) return null;
    for (const name of names) if (!Number.isSafeInteger(item.domains?.[name])) return null;
    return item as SnapshotManifest;
  } catch { return null; }
}
export function saveManifest(uid: string, domains: DomainNumbers): void {
  if (!persistentCacheSelected()) return;
  try {window.localStorage.setItem(manifestKey(uid), JSON.stringify({version:CACHE_VERSION, domains}));}
  catch { /* No persistent manifest means the next session safely fetches from the server. */ }
}
export function clearManifest(uid: string): void {
  try {window.localStorage.removeItem(manifestKey(uid));} catch { /* Privacy mode. */ }
}
