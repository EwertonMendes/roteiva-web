import { collection, doc, documentId, getAggregateFromServer, sum, where, getDocFromServer, getDocsFromCache, getDocsFromServer, getCountFromServer, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, type DocumentData, type Firestore, type QueryDocumentSnapshot } from "firebase/firestore";
import { collections, decodeWorkspace, encodeWorkspace, equalData, type Data, type Records } from "./workspace-codec.ts";
import type { WorkspaceData } from "../domain/workspace";
import { advanceSync, bootstrapSync, emptyNumbers, parseSync, persistentCacheSelected, readManifest, readSync, recordCounts, saveManifest, syncRef, type Domain, type SyncStamp } from "./firestore-sync.ts";
import { FirestoreQueryGate } from "./firestore-query-gate.ts";
import { trackAggregation, trackMutation, trackPage, trackRevision, usageSnapshot } from "./firestore-usage.ts";

export type ProfessionalType = "freelancer" | "studio" | "producer" | "other";
export type RoteivaProfile = {
  displayName: string;
  studioName: string;
  professionalType: ProfessionalType;
  revision: number;
  legacy: boolean;
};
export type ProfileChanges = Pick<RoteivaProfile, "displayName" | "studioName" | "professionalType">;
export function validateProfileChanges(profile: ProfileChanges): ProfileChanges {
  const displayName=profile.displayName.trim();
  const studioName=profile.studioName.trim();
  if (displayName.length<2 || displayName.length>120 || studioName.length>120 ||
      !["freelancer","studio","producer","other"].includes(profile.professionalType)) {
    throw new Error("Confira o nome, o estúdio e a área de atuação.");
  }
  return {displayName,studioName,professionalType:profile.professionalType};
}
function readProfile(data:DocumentData): RoteivaProfile {
  return {
    displayName:typeof data.displayName==="string" ? data.displayName : "",
    studioName:typeof data.studioName==="string" ? data.studioName : "",
    professionalType:["freelancer","studio","producer","other"].includes(data.professionalType)
      ? data.professionalType as ProfessionalType : "freelancer",
    revision:data.revision as number,
    legacy:!data.registrationCompletedAt,
  };
}

type Stored = {data: Data; revision: number};
export function dataErrorMessage(error: unknown): string {
  const code = (error as {code?:string})?.code || "";
  if (code.includes("permission-denied")) return "Sem permissão para acessar ou salvar estes dados. Entre novamente ou verifique as regras do projeto.";
  if (code.includes("unauthenticated")) return "Sua sessão expirou. Saia e entre novamente.";
  if (code.includes("unavailable") || code.includes("deadline-exceeded")) return "Sem conexão com a nuvem. As alterações não foram confirmadas. Reconecte e recarregue os dados.";
  if (code.includes("resource-exhausted")) return "A cota do projeto foi atingida. Aguarde a renovação da franquia.";
  return error instanceof Error && error.message.startsWith("Conflito") ? error.message : "Não foi possível salvar ou carregar os dados. Recarregue para recuperar a versão da nuvem.";
}
export class FirestoreWorkspace {
  private stored = new Map<string, Stored>();
  private db: Firestore;
  private uid: string;
  private stamp: SyncStamp | null = null;
  private readonly gate = new FirestoreQueryGate();
  private loadQueue:Promise<void>=Promise.resolve();
  private readonly loadedDomains = new Set<Domain>();
  hasLoaded(domains:readonly Domain[]):boolean { return domains.every(name=>this.loadedDomains.has(name)); }
  constructor(db: Firestore, uid: string) {
    if (!uid || uid.includes("/")) throw new Error("UID inválido.");
    this.db=db; this.uid=uid;
  }
  private ref(path: string) { return doc(this.db, "users/" + this.uid + "/" + path); }
  // Reading the profile does not create an account or a business workspace.
  async loadProfile(): Promise<RoteivaProfile|null> {
    const snap = await getDocFromServer(doc(this.db, "users", this.uid));
    return snap.exists() ? readProfile(snap.data()) : null;
  }
  async saveProfile(changes:ProfileChanges,expectedRevision:number): Promise<RoteivaProfile> {
    const validated=validateProfileChanges(changes);
    const ref=doc(this.db,"users",this.uid);
    return runTransaction(this.db,async tx=>{
      const snap=await tx.get(ref);
      if (!snap.exists()) throw new Error("Conflito: o cadastro não foi encontrado. Recarregue a página.");
      const before=snap.data();
      if (before.revision!==expectedRevision) throw new Error("Conflito: seu perfil foi alterado em outro dispositivo. Atualize a página antes de salvar.");
      // Never rewrite Google identity or onboarding acknowledgements.
      tx.update(ref,{...validated,revision:expectedRevision+1,updatedAt:serverTimestamp()});
      return {...validated,revision:expectedRevision+1,legacy:!before.registrationCompletedAt};
    });
  }
  async profileExists(): Promise<boolean> {
    return (await this.loadProfile()) !== null;
  }
  async registerProfile(profile: {
    displayName: string; email: string; photoURL: string;
    studioName: string; professionalType: "freelancer" | "studio" | "producer" | "other";
    acknowledgedDataUse: boolean;
  }): Promise<void> {
    const displayName = profile.displayName.trim();
    const studioName = profile.studioName.trim();
    if (displayName.length < 2 || displayName.length > 120 ||
        studioName.length > 120 ||
        !["freelancer","studio","producer","other"].includes(profile.professionalType) ||
        !profile.acknowledgedDataUse) throw new Error("Confira o cadastro e confirme o uso dos dados antes de continuar.");
    const ref = doc(this.db, "users", this.uid);
    const created=await runTransaction(this.db, async tx => {
      const current = await tx.get(ref);
      if (current.exists()) return false; // Never overwrite a legacy registration.
      tx.set(ref, {
        displayName, email: profile.email, photoURL: profile.photoURL,
        studioName, professionalType: profile.professionalType,
        registrationCompletedAt: serverTimestamp(),
        dataAcknowledgedAt: serverTimestamp(),
        ownerUid: this.uid, schemaVersion: 1, revision: 1,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      return true;
    });
    if (created) await bootstrapSync(this.db,this.uid,emptyNumbers());
  }
  private async readCollection(name: Domain, source: "server" | "cache"): Promise<Map<string, Stored>> {
    const result = new Map<string, Stored>();
    let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
    while (true) {
      const base = collection(this.db, "users", this.uid, name);
      const q = query(base, orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(200));
      const page = source === "cache" ? await getDocsFromCache(q) : await getDocsFromServer(q);
      trackPage(this.uid,source,page.size);
      for (const snapshot of page.docs) {
        const {ownerUid: _owner,schemaVersion: _schema,revision,createdAt: _created,updatedAt: _updated,...data} = snapshot.data();
        result.set(name + "/" + snapshot.id, {data:data as Data,revision});
      }
      if (page.size < 200) break;
      cursor = page.docs[page.docs.length - 1];
    }
    return result;
  }

  /** Serializes distinct route loads and deduplicates identical requests, so
   * navigation cannot replace a newer, wider snapshot with an older one.
   */
  async load(requested: readonly Domain[] = collections): Promise<WorkspaceData> {
    const names=[...new Set(requested)].sort() as Domain[];
    if (!names.length) return this.decoded();
    return this.gate.run(names.join(":"),async()=>{
      const previous=this.loadQueue;
      let release!:()=>void;
      this.loadQueue=new Promise<void>(resolve=>{release=resolve;});
      await previous;
      try {return await this.loadDomains(names);}
      finally {release();}
    });
  }
  private decoded(): WorkspaceData {
    return decodeWorkspace(new Map([...this.stored].map(([key,value])=>[key,value.data])));
  }
  private async ensureSync():Promise<SyncStamp> {
    trackRevision(this.uid);
    const existing=await readSync(this.db,this.uid);
    if (existing) return existing;
    // Migrate existing pre-revision accounts without downloading entire histories.
    const counts=emptyNumbers();
    await Promise.all(collections.map(async name=>{
      const aggregate=await getCountFromServer(collection(this.db,"users",this.uid,name));
      trackAggregation(this.uid);
      counts[name]=aggregate.data().count;
    }));
    return bootstrapSync(this.db,this.uid,counts);
  }
  private async loadDomains(names:readonly Domain[]):Promise<WorkspaceData> {
    for (let attempt=0;attempt<3;attempt++) {
      const before=await this.ensureSync();
      const required=names.filter(name=>!this.loadedDomains.has(name) ||
        !this.stamp || this.stamp.domains[name]!==before.domains[name]);
      if (!required.length) return this.decoded();
      const manifest=readManifest(this.uid);
      const groups=await Promise.all(required.map(async name=>{
        const useCache=manifest?.domains[name]===before.domains[name] && persistentCacheSelected();
        if (useCache) {
          try {
            const fromCache=await this.readCollection(name,"cache");
            if (fromCache.size===before.counts[name]) return {name,records:fromCache};
          } catch { /* Cache unavailable or evicted: fetch a complete page sequence. */ }
        }
        return {name,records:await this.readCollection(name,"server")};
      }));
      trackRevision(this.uid);
      const after=await readSync(this.db,this.uid);
      if (!after || before.revision!==after.revision ||
          collections.some(name=>before.domains[name]!==after.domains[name])) continue;
      if (groups.some(group=>group.records.size!==after.counts[group.name])) continue;
      const next=new Map(this.stored);
      for (const name of required) {
        for (const key of next.keys()) if(key.startsWith(name+"/"))next.delete(key);
      }
      for (const group of groups)for(const [key,value] of group.records)next.set(key,value);
      const known={...after.domains};
      for (const name of collections) {
        if (this.loadedDomains.has(name) && !required.includes(name) && this.stamp)
          known[name]=this.stamp.domains[name];
      }
      this.stored=next;
      this.stamp={...after,domains:known};
      for(const name of required)this.loadedDomains.add(name);
      saveManifest(this.uid,known);
      return this.decoded();
    }
    throw new Error("Conflito: os dados mudaram durante o carregamento. Tente novamente.");
  }

  async hasExternalChanges(): Promise<boolean> {
    if (!this.stamp) return false;
    trackRevision(this.uid);
    const current=await readSync(this.db,this.uid);
    return !current || [...this.loadedDomains].some(name=>this.stamp!.domains[name]!==current.domains[name]);
  }

  async loadTheme(): Promise<"light"|"dark"|undefined> {
    const snap=await getDocFromServer(this.ref("preferences/ui"));
    return snap.exists() ? snap.data().theme as "light"|"dark" : undefined;
  }
  /**
   * Server aggregations avoid downloading every finance entry or client
   * to render the overview. The composite index is declared with the rules.
   * A failed aggregation aborts the overview instead of reporting fake zeros.
   */
  async overviewMetrics(): Promise<{clientCount:number;receivableAmount:number}> {
    const [clients,receivable]=await Promise.all([
      getCountFromServer(collection(this.db,"users",this.uid,"clients")),
      getAggregateFromServer(query(collection(this.db,"users",this.uid,"financeEntries"),
        where("kind","==","income"),where("status","==","A receber")),
        {amountCents:sum("amountCents")}),
    ]);
    trackAggregation(this.uid);trackAggregation(this.uid);
    return {clientCount:clients.data().count,
      receivableAmount:(receivable.data().amountCents ?? 0)/100};
  }
  diagnostics() { return usageSnapshot(this.uid); }
  async saveTheme(theme:"light"|"dark") {
    const ref=this.ref("preferences/ui");
    await runTransaction(this.db,async tx=>{
      const before=await tx.get(ref);
      tx.set(ref,{theme,ownerUid:this.uid,schemaVersion:1,revision:(before.data()?.revision || 0)+1,createdAt:before.data()?.createdAt || serverTimestamp(),updatedAt:serverTimestamp()});
    });
  }
  async save(workspace: WorkspaceData, dirtyDomains?: readonly Domain[]): Promise<boolean> {
    if (dirtyDomains && !dirtyDomains.length) return false;
    const scope = dirtyDomains ? new Set(dirtyDomains) : undefined;
    const part = encodeWorkspace(workspace, scope);
    const full = new Map<string,Data>();
    if (scope) {
      for (const [key,value] of this.stored) {
        if (!scope.has(key.split("/")[0] as Domain)) full.set(key,value.data);
      }
    }
    for (const [key,data] of part) full.set(key,data);
    const keys = [...new Set([...this.stored.keys(),...full.keys()])]
      .filter(key => (!scope || scope.has(key.split("/")[0] as Domain)) &&
        !equalData(this.stored.get(key)?.data,full.get(key)));
    if (!keys.length) return false;
    // Reserve space in transactions for the sync document and Security Rules reads.
    if (keys.length > 350) throw new Error("Muitas alterações simultâneas. Recarregue e edite em etapas menores.");
    const expected = new Map(keys.map(key => [key,this.stored.get(key)]));
    const beforeCounts = recordCounts(this.stored);
    const afterCounts = recordCounts(full);
    const touched = new Set(keys.map(key => key.split("/")[0] as Domain));
    const result = await runTransaction(this.db, async tx => {
      const synchronization = syncRef(this.db,this.uid);
      const syncBefore = await tx.get(synchronization);
      const snapshots = await Promise.all(keys.map(key => tx.get(this.ref(key))));
      keys.forEach((key,index) => {
        if ((snapshots[index].data()?.revision || 0) !== (expected.get(key)?.revision || 0)) {
          throw new Error("Conflito: este registro mudou em outra aba ou dispositivo. Recarregue a versão da nuvem antes de editar novamente.");
        }
      });
      keys.forEach((key,index) => {
        const data = full.get(key),ref=this.ref(key),before=snapshots[index].data();
        if (!data) tx.delete(ref);
        else tx.set(ref,{...data,ownerUid:this.uid,schemaVersion:1,revision:(before?.revision||0)+1,
          createdAt:before?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()});
      });
      const previous = syncBefore.exists() ? parseSync(syncBefore.data()) : null;
      const committed = advanceSync(tx,synchronization,syncBefore,beforeCounts,afterCounts,touched);
      return {previous,committed};
    });
    trackMutation(this.uid,keys.length);
    for (const key of keys) {
      const data = full.get(key);
      if (data) this.stored.set(key,{data,revision:(expected.get(key)?.revision||0)+1});
      else this.stored.delete(key);
    }
    // Do not mark other-device changes as fresh just because this transaction succeeded.
    const known = {...(this.stamp?.domains ?? result.committed.domains)};
    for (const domain of touched) {
      if (!this.stamp || !result.previous ||
          result.previous.domains[domain] === this.stamp.domains[domain]) {
        known[domain] = result.committed.domains[domain];
      }
    }
    this.stamp = {...result.committed,domains:known};
    saveManifest(this.uid,known);
    return true;
  }
}
