import { collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, type DocumentData, type Firestore, type QueryDocumentSnapshot } from "firebase/firestore";
import { collections, decodeWorkspace, encodeWorkspace, equalData, type Data, type Records } from "./workspace-codec.ts";
import type { WorkspaceData } from "../domain/workspace";

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
    await runTransaction(this.db, async tx => {
      const current = await tx.get(ref);
      if (current.exists()) return; // Safe when two tabs submit at once. Never overwrite legacy users.
      tx.set(ref, {
        displayName, email: profile.email, photoURL: profile.photoURL,
        studioName, professionalType: profile.professionalType,
        registrationCompletedAt: serverTimestamp(),
        dataAcknowledgedAt: serverTimestamp(),
        ownerUid: this.uid, schemaVersion: 1, revision: 1,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    });
  }
  async load(): Promise<WorkspaceData> {
    const next = new Map<string,Stored>();
    await Promise.all(collections.map(async name=>{
      let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
      // Bounded pages keep each response small. No live listeners and no silent truncation.
      while (true) {
        const base = collection(this.db,"users",this.uid,name);
        const page = await getDocsFromServer(query(base,orderBy(documentId()),...(cursor ? [startAfter(cursor)] : []),limit(200)));
        for (const snapshot of page.docs) {
          const {ownerUid:_owner,schemaVersion:_schema,revision,createdAt:_created,updatedAt:_updated,...data}=snapshot.data();
          next.set(name+"/"+snapshot.id,{data:data as Data,revision});
        }
        if (page.size<200) break;
        cursor=page.docs[page.docs.length-1];
      }
    }));
    this.stored=next;
    return decodeWorkspace(new Map([...next].map(([key,value])=>[key,value.data])));
  }
  async loadTheme(): Promise<"light"|"dark"|undefined> {
    const snap=await getDocFromServer(this.ref("preferences/ui"));
    return snap.exists() ? snap.data().theme as "light"|"dark" : undefined;
  }
  async saveTheme(theme:"light"|"dark") {
    const ref=this.ref("preferences/ui");
    await runTransaction(this.db,async tx=>{
      const before=await tx.get(ref);
      tx.set(ref,{theme,ownerUid:this.uid,schemaVersion:1,revision:(before.data()?.revision || 0)+1,createdAt:before.data()?.createdAt || serverTimestamp(),updatedAt:serverTimestamp()});
    });
  }
  async save(workspace: WorkspaceData): Promise<boolean> {
    const next=encodeWorkspace(workspace);
    const keys=[...new Set([...this.stored.keys(),...next.keys()])].filter(key=>!equalData(this.stored.get(key)?.data,next.get(key)));
    if (!keys.length) return false;
    if (keys.length>400) throw new Error("Muitas alterações simultâneas. Recarregue e edite em etapas menores.");
    const expected=new Map(keys.map(key=>[key,this.stored.get(key)]));
    await runTransaction(this.db,async tx=>{
      const snapshots=await Promise.all(keys.map(key=>tx.get(this.ref(key))));
      keys.forEach((key,index)=>{
        const snapshot=snapshots[index];
        if ((snapshot.data()?.revision || 0)!==(expected.get(key)?.revision || 0)) {
          throw new Error("Conflito: este registro mudou em outra aba ou dispositivo. Recarregue a versão da nuvem antes de editar novamente.");
        }
      });
      keys.forEach((key,index)=>{
        const data=next.get(key), ref=this.ref(key), before=snapshots[index].data();
        if (!data) tx.delete(ref);
        else tx.set(ref,{...data,ownerUid:this.uid,schemaVersion:1,revision:(before?.revision || 0)+1,createdAt:before?.createdAt || serverTimestamp(),updatedAt:serverTimestamp()});
      });
    });
    for (const key of keys) {
      const data=next.get(key);
      if (data) this.stored.set(key,{data,revision:(expected.get(key)?.revision || 0)+1});
      else this.stored.delete(key);
    }
    return true;
  }
}
