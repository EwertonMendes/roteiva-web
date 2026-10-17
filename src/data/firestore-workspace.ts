import { collection, doc, documentId, getAggregateFromServer, sum, where, getDocFromServer, getDocsFromCache, getDocsFromServer, getCountFromServer, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, type DocumentData, type Firestore, type QueryDocumentSnapshot } from "firebase/firestore";
import { collections, decodeWorkspace, encodeWorkspace, equalData, type Data, type Records } from "./workspace-codec.ts";
import type { WorkspaceData, Status } from "../domain/workspace";
import { advanceSync, bootstrapSync, emptyNumbers, parseSync, persistentCacheSelected, readManifest, readSync, recordCounts, saveManifest, syncRef, type Domain, type SyncStamp } from "./firestore-sync.ts";
import { FirestoreQueryGate } from "./firestore-query-gate.ts";
import { missingQueryIndex } from "./firestore-recovery.ts";
import { encodeCommand,type WorkspaceCommand } from "./firestore-commands.ts";
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
  private readonly projectCursors=new Map<string,QueryDocumentSnapshot<DocumentData>|null>();
  private readonly pagedDomains=new Set<Domain>();
  private readonly filteredProjectCounts=new Map<string,{revision:number;count:number}>();
  private clientCursor:QueryDocumentSnapshot<DocumentData>|null|undefined;
  private recurringCount:{revision:number;count:number}|undefined;
  private readonly rangeRevisions=new Map<string,number>();
  private readonly peekKeys=new Map<string,Set<string>>();
  private readonly financeBarCache=new Map<string,{revision:number;bars:number[]}>();
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


  /**
   * A verified date window, not a full domain. Query bounds use the canonical
   * ISO civil-date field; old finance history and unrelated agenda months
   * cannot consume reads on the current screen. Never marks a domain complete.
   */
  private async fallbackDateWindow(name:"events"|"financeEntries"):Promise<WorkspaceData> {
    // An index can still be building after a Hosting deploy. A complete,
    // non-indexed read is an accurate fallback and never implies deletion.
    return this.loadDomains([name]);
  }
  private async dateWindow(name:"events"|"financeEntries",start:string,end:string):
    Promise<WorkspaceData> {
    const previous=this.loadQueue;
    let release!:()=>void;
    this.loadQueue=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    try{
      if(this.loadedDomains.has(name))return this.decoded();
      const before=await this.ensureSync();
      const key=name+":"+start+":"+end;
      if(this.rangeRevisions.get(key)===before.domains[name] && this.stamp?.domains[name]===before.domains[name])
        return this.decoded();
      const results=new Map<string,Stored>();
      const newPeek=new Set<string>();
      try {
      const base=collection(this.db,"users",this.uid,name);
      let cursor:QueryDocumentSnapshot<DocumentData>|undefined;
      while(true){
        const q=query(base,where("date",">=",start),where("date","<",end),
          orderBy("date"),orderBy(documentId()),...(cursor?[startAfter(cursor)]:[]),limit(200));
        const snapshot=await getDocsFromServer(q);
        trackPage(this.uid,"server",snapshot.size);
        for(const record of snapshot.docs){
          const {ownerUid:_o,schemaVersion:_s,revision,createdAt:_c,updatedAt:_u,...data}=record.data();
          results.set(name+"/"+record.id,{data:data as Data,revision});
        }
        if(snapshot.size<200)break;
        cursor=snapshot.docs[snapshot.docs.length-1];
      }
      if(name==="events"){
        const future=query(base,where("date",">=",end),orderBy("date"),orderBy(documentId()),limit(4));
        const extra=await getDocsFromServer(future);
        trackPage(this.uid,"server",extra.size);
        for(const record of extra.docs){
          const {ownerUid:_o,schemaVersion:_s,revision,createdAt:_c,updatedAt:_u,...data}=record.data();
          const path=name+"/"+record.id;
          results.set(path,{data:data as Data,revision});newPeek.add(path);
        }
      }
      } catch(error) {
        if(!missingQueryIndex(error))throw error;
        return this.fallbackDateWindow(name);
      }
      // The query succeeded, but the next revision check is mandatory.
      trackRevision(this.uid);
      const after=await readSync(this.db,this.uid);
      if(!after||before.domains[name]!==after.domains[name])
        throw Error("Conflito: os registros foram atualizados durante a consulta. Recarregue.");
      // Replace only this date window; other years and pending local records
      // remain intact. No inference of deletions outside the window.
      for(const [path,record] of this.stored){
        if(path.startsWith(name+"/") && typeof record.data.date==="string" &&
          record.data.date>=start && record.data.date<end)this.stored.delete(path);
      }
      for(const path of this.peekKeys.get(key)||[])if(!results.has(path))this.stored.delete(path);
      this.peekKeys.set(key,newPeek);
      for(const [path,item] of results)this.stored.set(path,item);
      this.pagedDomains.add(name);
      this.stamp={...after,domains:{...(this.stamp?.domains??after.domains),[name]:after.domains[name]}};
      this.rangeRevisions.set(key,after.domains[name]);
      return this.decoded();
    }finally{release();}
  }
  async financeMonth(year:number,month:number):Promise<WorkspaceData>{
    if(!Number.isInteger(year)||year<2000||year>2100||
      !Number.isInteger(month)||month<0||month>11)throw Error("Período financeiro inválido.");
    const start=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
    const end=new Date(Date.UTC(year,month+1,1)).toISOString().slice(0,10);
    return this.dateWindow("financeEntries",start,end);
  }
  affectedFinanceMonths(commands:readonly WorkspaceCommand[],year:number):number[]{
    const months=new Set<number>();
    const add=(date:unknown)=>{
      if(typeof date!=="string"||!date.startsWith(year+"-"))return;
      const month=Number(date.slice(5,7))-1;
      if(Number.isInteger(month)&&month>=0&&month<12)months.add(month);
    };
    for(const command of commands){
      const changed=encodeCommand(command);
      if(changed.collection!=="financeEntries")continue;
      add(this.stored.get(changed.key)?.data.date);
      add(changed.data?.date);
    }
    return [...months];
  }
  async financeYearBars(year:number,clientId?:number,affectedMonths?:readonly number[]):Promise<number[]>{
    if(!Number.isInteger(year)||year<2000||year>2100)throw Error("Ano financeiro inválido.");
    const stamp=await this.ensureSync();
    const key=year+":"+(clientId||"all");
    const cached=this.financeBarCache.get(key);
    if(cached?.revision===stamp.domains.financeEntries)return [...cached.bars];
    const refreshOnly=!!affectedMonths && !!cached &&
      cached.revision===stamp.domains.financeEntries-1;
    if(refreshOnly && !affectedMonths.length){
      this.financeBarCache.set(key,{revision:stamp.domains.financeEntries,bars:cached.bars});
      return [...cached.bars];
    }
    let bars:number[];
    // For small accounts a single complete read is cheaper and immediately
    // supports all filters, export and monthly charts without 12 aggregations.
    if(stamp.counts.financeEntries<=40 && !this.loadedDomains.has("financeEntries"))
      await this.load(["financeEntries"]);
    if(this.loadedDomains.has("financeEntries")){
      const records=this.decoded().financeEntries;
      bars=Array.from({length:12},(_,i)=>records.filter(entry=>
        entry.kind!=="expense" && (!clientId||entry.clientId===clientId) &&
        entry.date.endsWith("/"+year) && Number(entry.date.slice(3,5))===i+1)
        .reduce((n,entry)=>n+Math.round(entry.amount*100),0)/100);
    }else{
      const base=collection(this.db,"users",this.uid,"financeEntries");
      const indexes=refreshOnly ? [...new Set(affectedMonths)] : Array.from({length:12},(_,i)=>i);
      let values:number[];
      try{values=await Promise.all(indexes.map(async i=>{
        const start=new Date(Date.UTC(year,i,1)).toISOString().slice(0,10);
        const end=new Date(Date.UTC(year,i+1,1)).toISOString().slice(0,10);
        const filtered=query(base,...(clientId?[where("clientId","==",clientId)]:[]),
          where("kind","==","income"),where("date",">=",start),where("date","<",end));
        const result=await getAggregateFromServer(filtered,{amountCents:sum("amountCents")});
        trackAggregation(this.uid);
        return Number(result.data().amountCents??0)/100;
      }));}
      catch(error){
        if(!missingQueryIndex(error))throw error;
        // The annual chart is essential; return exact values by reading
        // the ordinary collection while an index is unavailable.
        await this.load(["financeEntries"]);
        const records=this.decoded().financeEntries;
        values=indexes.map(i=>records.filter(entry=>
          entry.kind!=="expense" && (!clientId||entry.clientId===clientId) &&
          entry.date.endsWith("/"+year) && Number(entry.date.slice(3,5))===i+1)
          .reduce((n,entry)=>n+Math.round(entry.amount*100),0)/100);
      }
      bars=refreshOnly ? [...cached!.bars] : Array(12).fill(0);
      indexes.forEach((month,i)=>{bars[month]=values[i];});
    }
    trackRevision(this.uid);
    const after=await readSync(this.db,this.uid);
    if(!after||after.domains.financeEntries!==stamp.domains.financeEntries)
      throw Error("Conflito: o financeiro mudou durante a consulta. Recarregue.");
    this.financeBarCache.set(key,{revision:after.domains.financeEntries,bars});
    return [...bars];
  }
  async financeYear(year:number):Promise<WorkspaceData>{
    if(!Number.isInteger(year)||year<2000||year>2100)throw Error("Ano financeiro inválido.");
    return this.dateWindow("financeEntries",year+"-01-01",(year+1)+"-01-01");
  }
  async calendarWindow(year:number,month:number):Promise<WorkspaceData>{
    if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(month)||month<0||month>11)
      throw Error("Período de agenda inválido.");
    // 42-cell calendar includes adjacent months; fetch one on either side.
    const start=new Date(Date.UTC(year,month-1,1)).toISOString().slice(0,10);
    const end=new Date(Date.UTC(year,month+2,1)).toISOString().slice(0,10);
    return this.dateWindow("events",start,end);
  }

  /**
   * A bounded client directory. Linked project counters stay accurate because
   * the clients route loads the projects domain separately; delivery history
   * is loaded only on client detail, not on every client list row.
   */
  async clientPage(options:{reset?:boolean;size?:number}={}):
    Promise<{workspace:WorkspaceData;total:number;recurring:number;hasMore:boolean}>{
    const previous=this.loadQueue;
    let release!:()=>void;
    this.loadQueue=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    try{return await this.readClientPage(options);}
    finally{release();}
  }
  private async readClientPage(options:{reset?:boolean;size?:number}):
    Promise<{workspace:WorkspaceData;total:number;recurring:number;hasMore:boolean}>{
    if(this.loadedDomains.has("clients")){
      const workspace=this.decoded();
      return {workspace,total:workspace.clients.length,
        recurring:workspace.clients.filter(c=>c.type==="Recorrente").length,hasMore:false};
    }
    if(options.reset)this.clientCursor=undefined;
    if(this.clientCursor===null && !options.reset){
      const workspace=this.decoded();
      return {workspace,total:this.stamp?.counts.clients??workspace.clients.length,
        recurring:this.recurringCount?.count??workspace.clients.filter(c=>c.type==="Recorrente").length,
        hasMore:false};
    }
    const size=Math.max(1,Math.min(30,options.size||24));
    const before=await this.ensureSync();
    if(!options.reset && this.pagedDomains.has("clients") &&
      this.stamp?.domains.clients!==before.domains.clients)
      throw new Error("Conflito: a lista de clientes mudou. Recarregue antes de continuar.");
    const base=collection(this.db,"users",this.uid,"clients");
    const q=query(base,orderBy("createdAt","desc"),orderBy(documentId(),"desc"),
      ...(this.clientCursor?[startAfter(this.clientCursor)]:[]),limit(size+1));
    let page;
    try{page=await getDocsFromServer(q);}
    catch(error){
      if(!missingQueryIndex(error))throw error;
      const workspace=await this.loadDomains(["clients"]);
      return {workspace,total:workspace.clients.length,
        recurring:workspace.clients.filter(client=>client.type==="Recorrente").length,
        hasMore:false};
    }
    trackPage(this.uid,"server",page.size);
    const docs=page.docs.slice(0,size);
    const groups=new Map<string,Stored>();
    for(const record of docs){
      const {ownerUid:_owner,schemaVersion:_schema,revision,createdAt:_created,updatedAt:_updated,...data}=record.data();
      groups.set("clients/"+record.id,{data:data as Data,revision});
    }
    let recurring=this.recurringCount?.count;
    if(this.recurringCount?.revision!==before.domains.clients){
      let result;
      try{result=await getCountFromServer(query(base,where("type","==","Recorrente")));}
      catch(error){
        if(!missingQueryIndex(error))throw error;
        const workspace=await this.loadDomains(["clients"]);
        return {workspace,total:workspace.clients.length,
          recurring:workspace.clients.filter(client=>client.type==="Recorrente").length,
          hasMore:false};
      }
      trackAggregation(this.uid);
      recurring=result.data().count;
      this.recurringCount={revision:before.domains.clients,count:recurring};
    }
    trackRevision(this.uid);
    const after=await readSync(this.db,this.uid);
    if(!after || after.domains.clients!==before.domains.clients)
      throw new Error("Conflito: os clientes mudaram durante a paginação. Recarregue a lista.");
    if(options.reset){
      for(const key of this.stored.keys())if(key.startsWith("clients/"))this.stored.delete(key);
    }
    for(const [key,data] of groups)this.stored.set(key,data);
    this.pagedDomains.add("clients");
    this.stamp={...after,domains:{...(this.stamp?.domains||after.domains),
      clients:after.domains.clients}};
    const hasMore=page.docs.length>size;
    this.clientCursor=hasMore?docs[docs.length-1]:null;
    return {workspace:this.decoded(),total:after.counts.clients,recurring:recurring||0,hasMore};
  }

  /**
   * Server-cursor pagination for the project catalogue. Only the requested
   * page and its linked tasks enter memory; it does NOT mark either collection
   * complete, so other views must explicitly call load() before full edits.
   */
  async projectPage(options:{status?:string;reset?:boolean;size?:number}={}):
    Promise<{workspace:WorkspaceData;total:number;hasMore:boolean}> {
    const previous=this.loadQueue;
    let release!:()=>void;
    this.loadQueue=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    try{return await this.readProjectPage(options);}
    finally{release();}
  }
  private async readProjectPage(options:{status?:string;reset?:boolean;size?:number}):
    Promise<{workspace:WorkspaceData;total:number;hasMore:boolean}> {
    if(this.loadedDomains.has("projects")){
      // Never replace a previously complete project collection with a page.
      // Load missing tasks once so every project's progress is correct.
      if(!this.loadedDomains.has("tasks")) await this.loadDomains(["tasks"]);
      const workspace=this.decoded();
      return {workspace,total:workspace.projects.length,hasMore:false};
    }
    const status=options.status && options.status!=="Todos" ? options.status : "";
    const key=status||"Todos",size=Math.max(1,Math.min(30,options.size||24));
    if(options.reset)this.projectCursors.delete(key);
    const previous=this.projectCursors.get(key);
    if(previous===null && !options.reset){
      return {workspace:this.decoded(),total:this.stamp?.counts.projects||0,hasMore:false};
    }
    const before=await this.ensureSync();
    if(!options.reset && this.pagedDomains.has("projects") &&
      this.stamp?.domains.projects!==before.domains.projects)
      throw new Error("Conflito: a lista de projetos mudou. Recarregue antes de continuar.");
    const base=collection(this.db,"users",this.uid,"projects");
    const conditions=status?[where("status","==",status)]:[];
    const entries=query(base,...conditions,orderBy("createdAt","desc"),
      orderBy(documentId(),"desc"),...(previous?[startAfter(previous)]:[]),limit(size+1));
    let list;
    try{list=await getDocsFromServer(entries);}
    catch(error){
      if(!missingQueryIndex(error))throw error;
      const workspace=await this.loadDomains(["projects","tasks"]);
      return {workspace,total:workspace.projects.length,hasMore:false};
    }
    trackPage(this.uid,"server",list.size);
    const docs=list.docs.slice(0,size);
    const projects=new Map<string,Stored>();
    for(const record of docs){
      const {ownerUid:_o,schemaVersion:_s,revision,createdAt:_c,updatedAt:_u,...data}=record.data();
      projects.set("projects/"+record.id,{revision,data:data as Data});
    }
    const tasks=new Map<string,Stored>();
    const ids=docs.map(item=>Number(item.id)).filter(Number.isSafeInteger);
    if(ids.length){
      const taskQuery=query(collection(this.db,"users",this.uid,"tasks"),where("projectId","in",ids));
      let taskDocs;
      try{taskDocs=await getDocsFromServer(taskQuery);}
      catch(error){
        if(!missingQueryIndex(error))throw error;
        const workspace=await this.loadDomains(["projects","tasks"]);
        return {workspace,total:workspace.projects.length,hasMore:false};
      }
      trackPage(this.uid,"server",taskDocs.size);
      for(const record of taskDocs.docs){
        const {ownerUid:_o,schemaVersion:_s,revision,createdAt:_c,updatedAt:_u,...data}=record.data();
        tasks.set("tasks/"+record.id,{revision,data:data as Data});
      }
    }
    let total=before.counts.projects;
    if(status){
      const storedCount=this.filteredProjectCounts.get(status);
      if(storedCount?.revision===before.domains.projects)total=storedCount.count;
      else {
        let aggregate;
        try{aggregate=await getCountFromServer(query(base,where("status","==",status)));}
        catch(error){
          if(!missingQueryIndex(error))throw error;
          const workspace=await this.loadDomains(["projects","tasks"]);
          return {workspace,total:workspace.projects.length,hasMore:false};
        }
        trackAggregation(this.uid);
        total=aggregate.data().count;
        this.filteredProjectCounts.set(status,{revision:before.domains.projects,count:total});
      }
    }
    trackRevision(this.uid);
    const after=await readSync(this.db,this.uid);
    if(!after || before.domains.projects!==after.domains.projects ||
      before.domains.tasks!==after.domains.tasks)
      throw new Error("Conflito: os projetos mudaram durante a paginação. Recarregue a lista.");
    if(options.reset){
      for(const path of this.stored.keys()){
        if(path.startsWith("projects/")||path.startsWith("tasks/"))this.stored.delete(path);
      }
    }
    for(const [key,item] of [...projects,...tasks])this.stored.set(key,item);
    this.pagedDomains.add("projects");this.pagedDomains.add("tasks");
    this.stamp={...after,domains:{...(this.stamp?.domains||after.domains),
      projects:after.domains.projects,tasks:after.domains.tasks}};
    const hasMore=list.docs.length>size;
    this.projectCursors.set(key,hasMore?docs[docs.length-1]:null);
    return {workspace:this.decoded(),total,hasMore};
  }

  async hasExternalChanges(): Promise<boolean> {
    if (!this.stamp) return false;
    trackRevision(this.uid);
    const current=await readSync(this.db,this.uid);
    return !current || [...new Set([...this.loadedDomains,...this.pagedDomains])].some(name=>this.stamp!.domains[name]!==current.domains[name]);
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
  async overviewMetrics(projects?:WorkspaceData["projects"]):
    Promise<{clientCount:number;receivableAmount:number;projectCount:number;projectStatuses:Record<Status,number>}> {
    const statuses:Status[]=["Em produção","Em aprovação","Ajustes","Aprovado"];
    // Reuse a verified complete small page. Empty accounts should not spend
    // four aggregation queries to discover that every project bucket is zero.
    const pageComplete=!!projects && this.stamp?.counts.projects===projects.length;
    try {
    const [clients,receivable,...counts]=await Promise.all([
      getCountFromServer(collection(this.db,"users",this.uid,"clients")),
      getAggregateFromServer(query(collection(this.db,"users",this.uid,"financeEntries"),
        where("kind","==","income"),where("status","==","A receber")),
        {amountCents:sum("amountCents")}),
      ...(pageComplete?[]:statuses.map(status=>getCountFromServer(query(
        collection(this.db,"users",this.uid,"projects"),where("status","==",status))))),
    ]);
    for(let i=0;i<2+counts.length;i++)trackAggregation(this.uid);
    const projectStatuses=Object.fromEntries(statuses.map((name,i)=>[
      name,pageComplete ? projects!.filter(project=>project.status===name).length
        : counts[i].data().count,
    ])) as Record<Status,number>;
    return {clientCount:clients.data().count,
      receivableAmount:(receivable.data().amountCents ?? 0)/100,
      projectCount:Object.values(projectStatuses).reduce((sum,value)=>sum+value,0),
      projectStatuses};
    }catch(error) {
      if(!missingQueryIndex(error))throw error;
      // Recover accurately while deployment indexes finish building. Only
      // activated on a failed aggregate; normal users keep cheap server sums.
      const data=await this.load(["clients","projects","financeEntries"]);
      const projectStatuses=Object.fromEntries(statuses.map(status=>[
        status,data.projects.filter(p=>p.status===status).length,
      ])) as Record<Status,number>;
      return {
        clientCount:data.clients.length,
        receivableAmount:data.financeEntries.filter(e=>e.kind!=="expense"&&e.status==="A receber")
          .reduce((sum,e)=>sum+Math.round(e.amount*100),0)/100,
        projectCount:data.projects.length,projectStatuses,
      };
    }
  }
  diagnostics() { return usageSnapshot(this.uid); }
  totalCount(domain:Domain):number|undefined{return this.stamp?.counts[domain];}
  async saveTheme(theme:"light"|"dark") {
    const ref=this.ref("preferences/ui");
    await runTransaction(this.db,async tx=>{
      const before=await tx.get(ref);
      tx.set(ref,{theme,ownerUid:this.uid,schemaVersion:1,revision:(before.data()?.revision || 0)+1,createdAt:before.data()?.createdAt || serverTimestamp(),updatedAt:serverTimestamp()});
    });
  }
  /**
   * Explicit document mutations. Unloaded pages are never treated as deletions.
   * The stored revision guards edits on known records; updates to records not
   * yet loaded are rejected until the caller fetches them.
   */
  async applyCommands(commands:readonly WorkspaceCommand[]):Promise<boolean>{
    const distinct=new Map(commands.map(command=>{
      const record=encodeCommand(command);
      return [record.key,record] as const;
    }));
    const changes=[...distinct.values()].filter(({key,data})=>!equalData(this.stored.get(key)?.data,data));
    if(!changes.length)return false;
    if(changes.length>350)throw new Error("Muitas alterações simultâneas.");
    await this.ensureSync();
    const expected=new Map(changes.map(c=>[c.key,this.stored.get(c.key)]));
    const result=await runTransaction(this.db,async tx=>{
      const sync=syncRef(this.db,this.uid),stamp=await tx.get(sync);
      const parsed=stamp.exists()?parseSync(stamp.data()):null;
      if(!parsed)throw new Error("Conflito: revisão do espaço indisponível.");
      const snaps=await Promise.all(changes.map(c=>tx.get(this.ref(c.key))));
      changes.forEach((change,index)=>{
        if((snaps[index].data()?.revision||0)!==(expected.get(change.key)?.revision||0)){
          throw new Error("Conflito: registro modificado em outro dispositivo. Recarregue antes de salvar.");
        }
      });
      const counts={...parsed.counts};
      const nextCounts={...counts};
      const touched=new Set<Domain>();
      changes.forEach((change,index)=>{
        const snap=snaps[index],before=snap.data(),path=this.ref(change.key);
        touched.add(change.collection);
        if(!change.data){
          tx.delete(path);
          if(snap.exists())nextCounts[change.collection]--;
        }else{
          tx.set(path,{...change.data,ownerUid:this.uid,schemaVersion:1,
            revision:(before?.revision||0)+1,
            createdAt:before?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()});
          if(!snap.exists())nextCounts[change.collection]++;
        }
      });
      const committed=advanceSync(tx,sync,stamp,counts,nextCounts,touched);
      return {old:parsed,committed,touched};
    });
    for(const change of changes){
      if(change.data)this.stored.set(change.key,{
        data:change.data,revision:(expected.get(change.key)?.revision||0)+1,
      });
      else this.stored.delete(change.key);
    }
    const known={...(this.stamp?.domains ?? result.committed.domains)};
    for(const name of result.touched) {
      if(!this.stamp || this.stamp.domains[name]===result.old.domains[name])
        known[name]=result.committed.domains[name];
    }
    this.stamp={...result.committed,domains:known};
    const safeManifest={...known};
    for(const name of collections)if(!this.loadedDomains.has(name))safeManifest[name]=-1;
    saveManifest(this.uid,safeManifest);
    trackMutation(this.uid,changes.length);
    return true;
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
