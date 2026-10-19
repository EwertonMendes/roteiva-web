import { readFile } from "node:fs/promises";
import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, Timestamp, writeBatch, setLogLevel } from "firebase/firestore";
import { FirestoreWorkspace } from "../src/data/firestore-workspace.ts";
import { emptyWorkspace } from "../src/domain/workspace.ts";
setLogLevel('silent');
let env;
const profile={displayName:"Alice",email:"alice@example.com",photoURL:""};
const meta=(uid,revision=1)=>({ownerUid:uid,schemaVersion:1,revision,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
const client={id:10,name:"Cliente",contact:"Contato",email:"c@example.com",phone:"",color:"blue",initials:"CL",type:"Avulso",since:"out 2026",packageTitle:"",monthlyDeliverables:0,monthlyFeeCents:0};
const project={id:10,name:"Projeto",clientId:1,client:"Cliente",status:"Em produção",dueDate:"2026-10-16",description:"",template:"Livre",color:"blue",initials:"PR"};
const fixtures={
  clients:client,projects:project,
  tasks:{id:10,projectId:2,title:"Roteiro",done:false},
  deliveries:{id:10,clientId:1,title:"Entrega",month:"2026-10",done:false},
  events:{id:10,projectId:2,title:"Gravação",date:"2026-10-16",time:"09:00",endTime:"10:00",autoDeadline:false,type:"Produção",client:"Cliente"},
  financeEntries:{id:10,projectId:2,clientId:1,project:"Projeto",client:"Cliente",kind:"income",amountCents:10001,date:"2026-10-16",status:"A receber"},
  activities:{id:"a1",text:"Atividade",when:"2026-10-16T12:00:00.000Z"},
  preferences:{theme:"dark"}
};
const pathFor=(uid,name)=>"users/"+uid+"/"+name+"/"+(name==="preferences"?"ui":name==="activities"?"a1":"10");
const dbFor=uid=>uid?env.authenticatedContext(uid).firestore():env.unauthenticatedContext().firestore();
async function authorizeTestAccount(uid){
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),"users",uid,"access","current"),{
      ownerUid:uid,schemaVersion:1,source:"trial",suspended:false,unlimited:false,
      trialEndsAt:Timestamp.fromMillis(Date.now()+604800000),
      accessUntil:Timestamp.fromMillis(Date.now()+604800000),
      updatedAt:Timestamp.now()
    });
  });
}
before(async()=>{ env=await initializeTestEnvironment({projectId:"demo-roteiva",firestore:{host:"127.0.0.1",port:8080,rules:await readFile("firestore.rules","utf8")}}); });
after(async()=>await env?.cleanup());
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    for (const uid of ["alice","bob"]) {
      const stamp={ownerUid:uid,schemaVersion:1,revision:1,createdAt:Timestamp.now(),updatedAt:Timestamp.now()};
      await setDoc(doc(db,"users",uid),{...profile,...stamp});
      await setDoc(doc(db,"users",uid,"access","current"),{
        ownerUid:uid,schemaVersion:1,source:"trial",suspended:false,unlimited:false,
        trialEndsAt:Timestamp.fromMillis(Date.now()+604800000),
        accessUntil:Timestamp.fromMillis(Date.now()+604800000),
        updatedAt:Timestamp.now()
      });
      await setDoc(doc(db,"users",uid,"clients","1"),{...client,id:1,...stamp});
      await setDoc(doc(db,"users",uid,"projects","2"),{...project,id:2,...stamp});
    }
  });
});
for (const [name,data] of Object.entries(fixtures)) {
  test(name+": own CRUD, anonymous denial and A/B separation",async()=>{
    const alice=dbFor("alice"),bob=dbFor("bob"),anon=dbFor();
    const path=pathFor("alice",name),ref=doc(alice,path);
    await assertFails(setDoc(ref,{...data,...meta("bob")}));
    for (const field of Object.keys(data)) {
      const incomplete={...data,...meta("alice")}; delete incomplete[field];
      await assertFails(setDoc(ref,incomplete));
    }
    await assertSucceeds(setDoc(ref,{...data,...meta("alice")}));
    await assertSucceeds(getDoc(ref));
    // preferences/ui is intentionally a singleton get; listing settings is denied.
    if (name==="preferences") await assertFails(getDocs(collection(alice,"users","alice",name)));
    else await assertSucceeds(getDocs(collection(alice,"users","alice",name)));
    for (const db of [bob,anon]) {
      await assertFails(getDoc(doc(db,path)));
      await assertFails(getDocs(collection(db,"users","alice",name)));
      await assertFails(setDoc(doc(db,path),{...data,...meta("alice")}));
      await assertFails(updateDoc(doc(db,path),{revision:2,updatedAt:serverTimestamp()}));
      await assertFails(deleteDoc(doc(db,path)));
    }
    await assertFails(setDoc(doc(alice,pathFor("bob",name)),{...data,...meta("alice")}));
    await assertFails(updateDoc(ref,{ownerUid:"bob",revision:2,updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(ref,{role:"admin",revision:2,updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(ref,{createdAt:Timestamp.fromMillis(0),revision:2,updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(ref,{updatedAt:Timestamp.fromMillis(0),revision:2}));
    await assertFails(updateDoc(ref,{schemaVersion:2,revision:2,updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(ref,{revision:4,updatedAt:serverTimestamp()}));
    for (const field of Object.keys(data)) {
      await assertFails(updateDoc(ref,{[field]:deleteField(),revision:2,updatedAt:serverTimestamp()}));
      const wrongType=typeof data[field]==="string" ? 42 : "invalid";
      await assertFails(updateDoc(ref,{[field]:wrongType,revision:2,updatedAt:serverTimestamp()}));
      if(typeof data[field]==="string") await assertFails(updateDoc(ref,{[field]:"x".repeat(12000),revision:2,updatedAt:serverTimestamp()}));
    }
    await assertSucceeds(updateDoc(ref,{revision:2,updatedAt:serverTimestamp()}));
    await assertSucceeds(deleteDoc(ref));
  });
}
test("profile PII, creation, ownership, schema and orphan denial",async()=>{
  const alice=dbFor("alice"),bob=dbFor("bob"),anon=dbFor(),charlie=dbFor("charlie");
  const path="users/alice";
  await assertFails(getDoc(doc(bob,path)));
  await assertFails(getDoc(doc(anon,path)));
  await assertFails(getDocs(collection(alice,"users")));
  await assertFails(updateDoc(doc(alice,path),{plan:"studio",revision:2,updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(alice,path)));
  await assertFails(setDoc(doc(charlie,"users/charlie/clients/10"),{...client,...meta("charlie")}));
  const registration={...profile,studioName:"Estúdio de testes",professionalType:"freelancer",registrationCompletedAt:serverTimestamp(),dataAcknowledgedAt:serverTimestamp()};
  await assertFails(setDoc(doc(charlie,"users/charlie"),{...registration,...meta("alice")}));
  await assertFails(setDoc(doc(charlie,"users/charlie"),{...profile,...meta("charlie")})); // login alone cannot create a profile
  await assertFails(setDoc(doc(charlie,"users/charlie"),{...registration,professionalType:"admin",...meta("charlie")}));
  await assertFails(setDoc(doc(charlie,"users/charlie"),{...registration,studioName:"x".repeat(200),...meta("charlie")}));
  await assertFails(setDoc(doc(charlie,"users/charlie"),{...registration,registrationCompletedAt:Timestamp.fromMillis(0),...meta("charlie")}));
  await assertFails(setDoc(doc(charlie,"users/charlie"),{...registration,dataAcknowledgedAt:Timestamp.fromMillis(0),...meta("charlie")}));
  await assertSucceeds(setDoc(doc(charlie,"users/charlie"),{...registration,...meta("charlie")}));
  await assertFails(updateDoc(doc(charlie,"users/charlie"),{registrationCompletedAt:serverTimestamp(),revision:2,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(charlie,"users/charlie"),{dataAcknowledgedAt:serverTimestamp(),revision:2,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(charlie,"users/charlie"),{studioName:deleteField(),revision:2,updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(charlie,"users/charlie/private/secret"),{role:"admin"}));
  await assertSucceeds(updateDoc(doc(alice,path),{displayName:"Novo nome",revision:2,updatedAt:serverTimestamp()}));
});
test("studio profile changes: legacy compatibility, privacy and concurrent saves",async()=>{
  const alice=dbFor("alice"),bob=dbFor("bob"),charlie=dbFor("charlie");
  const legacy=new FirestoreWorkspace(alice,"alice");
  const old=await legacy.loadProfile();
  assert.equal(old.legacy,true);
  assert.equal(old.studioName,"");
  assert.equal(old.revision,1);
  const updated=await legacy.saveProfile({displayName:"Alice Editora",studioName:"Estúdio dos Crias",professionalType:"studio"},old.revision);
  assert.equal(updated.revision,2);
  assert.equal(updated.legacy,true);
  const legacyRaw=(await getDoc(doc(alice,"users/alice"))).data();
  assert.equal(legacyRaw.studioName,"Estúdio dos Crias");
  assert.equal(legacyRaw.professionalType,"studio");
  assert.equal("registrationCompletedAt" in legacyRaw,false);
  assert.equal("dataAcknowledgedAt" in legacyRaw,false);
  assert.equal(legacyRaw.email,profile.email);
  await assertFails(updateDoc(doc(bob,"users/alice"),{displayName:"Invadido",revision:3,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(alice,"users/alice"),{email:"fake@example.com",revision:3,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(alice,"users/alice"),{studioName:"x".repeat(121),revision:3,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(alice,"users/alice"),{professionalType:"admin",revision:3,updatedAt:serverTimestamp()}));
  await assert.rejects(()=>legacy.saveProfile({displayName:"Rascunho",studioName:"Outro",professionalType:"producer"},1),/Conflito/);
  await assert.rejects(()=>legacy.saveProfile({displayName:"A",studioName:"Outro",professionalType:"producer"},2),/Confira/);
  await assertFails(updateDoc(doc(alice,"users/alice"),{registrationCompletedAt:serverTimestamp(),dataAcknowledgedAt:serverTimestamp(),revision:3,updatedAt:serverTimestamp()}));

  const modern=new FirestoreWorkspace(charlie,"charlie");
  await modern.registerProfile({...profile,studioName:"Studio A",professionalType:"freelancer",acknowledgedDataUse:true});
  await authorizeTestAccount("charlie");
  const current=await modern.loadProfile();
  assert.equal(current.legacy,false);
  const next=await modern.saveProfile({displayName:"Alice Studio",studioName:"Studio B",professionalType:"producer"},current.revision);
  assert.equal(next.studioName,"Studio B");
  const modernRaw=(await getDoc(doc(charlie,"users/charlie"))).data();
  assert.equal(modernRaw.registrationCompletedAt.toMillis()>0,true);
  assert.equal(modernRaw.dataAcknowledgedAt.toMillis()>0,true);
  await assertFails(updateDoc(doc(charlie,"users/charlie"),{photoURL:"https://example.com/avatar.png",revision:3,updatedAt:serverTimestamp()}));
  assert.equal((await modern.loadProfile()).revision,2);
});
test("invalid money, civil dates, time ranges and references are rejected",async()=>{
  const db=dbFor("alice");
  for(const amountCents of [-1,0,1.5,100000000001,"100"]) await assertFails(setDoc(doc(db,pathFor("alice","financeEntries")),{...fixtures.financeEntries,amountCents,...meta("alice")}));
  for(const date of ["2026-02-29","2026-04-31","2026-13-01","16/10/2026"]) await assertFails(setDoc(doc(db,pathFor("alice","events")),{...fixtures.events,date,...meta("alice")}));
  for(const [time,endTime] of [["25:00",""],["09:00","08:00"],["09:00","09:00"]]) await assertFails(setDoc(doc(db,pathFor("alice","events")),{...fixtures.events,time,endTime,...meta("alice")}));
  await assertSucceeds(setDoc(doc(db,pathFor("alice","events")),{...fixtures.events,date:"2028-02-29",...meta("alice")}));
  for(const name of ["tasks","events","financeEntries"]) await assertFails(setDoc(doc(db,pathFor("alice",name)),{...fixtures[name],projectId:999,...meta("alice")}));
  await assertFails(setDoc(doc(db,pathFor("alice","projects")),{...project,clientId:999,...meta("alice")}));
  await assertFails(setDoc(doc(db,"users/alice/clients/99"),{...client,...meta("alice")}));
});
test("atomic project+tasks references resolve with getAfter",async()=>{
  const db=dbFor("alice"),batch=writeBatch(db);
  batch.set(doc(db,"users/alice/projects/10"),{...project,...meta("alice")});
  batch.set(doc(db,"users/alice/tasks/10"),{...fixtures.tasks,projectId:10,...meta("alice")});
  await assertSucceeds(batch.commit());
});
test("repository: empty new account, CRUD, cents, refresh and conflict",async()=>{
  const db=dbFor("charlie"),a=new FirestoreWorkspace(db,"charlie");
  assert.equal(await a.profileExists(),false);
  await a.registerProfile({...profile,studioName:"Studio QA",professionalType:"freelancer",acknowledgedDataUse:true});
  await authorizeTestAccount("charlie");
  assert.equal(await a.profileExists(),true);
  await a.registerProfile({...profile,studioName:"Outro estúdio",professionalType:"studio",acknowledgedDataUse:true});
  const existing=await getDoc(doc(db,"users/charlie"));
  assert.equal(existing.data().studioName,"Studio QA"); // idempotent: login never overwrites profile
  assert.deepEqual(await a.load(),emptyWorkspace());
  const workspace=emptyWorkspace();
  workspace.clients=[{...client,monthlyFee:99.99,projects:0,active:0,deliveries:[{id:31,title:"Entrega mensal",month:"2026-10",done:false}]}];
  workspace.projects=[{...project,id:20,clientId:10,due:"16 out",progress:0,files:0,tasks:[{id:30,title:"Editar",done:false}]}];
  workspace.calendarEvents=[{...fixtures.events,projectId:20}];
  workspace.financeEntries=[{...fixtures.financeEntries,projectId:20,clientId:10,amount:100.01,date:"16/10/2026"}];
  workspace.activities=[{id:"a1",text:"Criado",when:"2026-10-16T12:00:00.000Z"}];
  await a.save(workspace);
  const raw=await getDoc(doc(db,"users/charlie/financeEntries/10"));
  assert.equal(raw.data().amountCents,10001);
  assert.equal("amount" in raw.data(),false);
  const p=await getDoc(doc(db,"users/charlie/projects/20"));
  assert.equal("tasks" in p.data(),false);
  const b=new FirestoreWorkspace(db,"charlie");
  const restored=await b.load();
  assert.equal(restored.financeEntries[0].amount,100.01);
  assert.equal(restored.calendarEvents[0].date,"2026-10-16");
  assert.equal(restored.projects[0].tasks[0].title,"Editar");
  assert.equal(restored.clients[0].monthlyFee,99.99);
  await b.saveTheme("dark"); assert.equal(await a.loadTheme(),"dark");
  const taskBefore=(await getDoc(doc(db,"users/charlie/tasks/30"))).data().revision;
  workspace.clients[0].name="Editado";
  await a.save(workspace);
  assert.equal((await getDoc(doc(db,"users/charlie/tasks/30"))).data().revision,taskBefore);
  restored.clients[0].name="Concorrente";
  await assert.rejects(()=>b.save(restored),/Conflito/);
  const bob=new FirestoreWorkspace(dbFor("bob"),"charlie");
  await assert.rejects(()=>bob.load());
  workspace.financeEntries=[]; await a.save(workspace);
  assert.equal((await getDoc(doc(db,"users/charlie/financeEntries/10"))).exists(),false);
});

test("sync stamps are private, versioned and cannot be deleted", async () => {
  const alice=dbFor("alice"),bob=dbFor("bob"),anon=dbFor();
  const path="users/alice/sync/state",ref=doc(alice,path);
  const counts={clients:1,projects:1,tasks:0,deliveries:0,events:0,financeEntries:0,activities:0};
  const domains={clients:0,projects:0,tasks:0,deliveries:0,events:0,financeEntries:0,activities:0};
  await assertFails(getDoc(doc(bob,path)));
  await assertFails(getDoc(doc(anon,path)));
  await assertFails(setDoc(doc(bob,path),{...meta("alice"),domains,counts}));
  await assertFails(setDoc(ref,{...meta("alice"),domains,counts:{...counts,clients:-1}}));
  await assertSucceeds(setDoc(ref,{...meta("alice"),domains,counts}));
  await assertSucceeds(getDoc(ref));
  await assertFails(updateDoc(ref,{counts:{...counts,clients:"invalid"},revision:2,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{ownerUid:"bob",revision:2,updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref,{domains:{...domains,clients:1},revision:2,updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(ref));
});

test("domain-scoped writes preserve untouched collections and their revisions",async()=>{
  const db=dbFor("charlie"), repository=new FirestoreWorkspace(db,"charlie");
  await repository.registerProfile({...profile,studioName:"Studio scoped",professionalType:"freelancer",acknowledgedDataUse:true});
  await authorizeTestAccount("charlie");
  const workspace=emptyWorkspace();
  workspace.clients=[{...client,id:101,name:"Cliente preservado",monthlyFee:0,projects:0,active:0,deliveries:[]}];
  workspace.financeEntries=[{...fixtures.financeEntries,id:102,projectId:0,clientId:101,amount:25,date:"16/10/2026"}];
  await repository.save(workspace);
  await repository.load();
  const state=emptyWorkspace();
  state.financeEntries=[{...workspace.financeEntries[0],amount:30}];
  assert.equal(await repository.save(state,["financeEntries"]),true);
  assert.equal((await getDoc(doc(db,"users/charlie/clients/101"))).data().name,"Cliente preservado");
  assert.equal((await getDoc(doc(db,"users/charlie/financeEntries/102"))).data().amountCents,3000);
  const stamp=(await getDoc(doc(db,"users/charlie/sync/state"))).data();
  assert.equal(stamp.counts.clients,1);
  assert.equal(stamp.counts.financeEntries,1);
  assert.equal(stamp.domains.clients,1);
  assert.equal(stamp.domains.financeEntries,2);
  assert.equal(await repository.save(state,["financeEntries"]),false);
});

test("legacy account migrates counts and reads only requested workspace domains",async()=>{
  const db=dbFor("alice");
  const repository=new FirestoreWorkspace(db,"alice");
  const clients=await repository.load(["clients"]);
  assert.equal(repository.hasLoaded(["clients"]),true);
  assert.equal(repository.hasLoaded(["projects"]),false);
  assert.equal(clients.clients.length,1);
  assert.equal(clients.projects.length,0);
  const revised={...clients,clients:clients.clients.map(c=>({...c,contact:"Contato otimizado"}))};
  await repository.save(revised,["clients"]);
  assert.equal((await getDoc(doc(db,"users/alice/projects/2"))).exists(),true);
  const both=await repository.load(["projects"]);
  assert.equal(both.clients[0].contact,"Contato otimizado");
  assert.equal(both.projects.length,1);
  const stamp=(await getDoc(doc(db,"users/alice/sync/state"))).data();
  assert.equal(stamp.counts.clients,1);
  assert.equal(stamp.counts.projects,1);
  assert.equal(stamp.domains.clients,1);
  assert.equal(stamp.domains.projects,0);
});

test("overview aggregates client count and receivables without fetching finance documents",async()=>{
  const db=dbFor("alice");
  await assertSucceeds(setDoc(doc(db,"users/alice/financeEntries/10"),
    {...fixtures.financeEntries,...meta("alice")}));
  const repository=new FirestoreWorkspace(db,"alice");
  const metrics=await repository.overviewMetrics();
  assert.equal(metrics.clientCount,1);
  assert.equal(metrics.receivableAmount,100.01);
  assert.equal(metrics.projectCount,1);
  assert.equal(metrics.projectStatuses["Em produção"],1);
  const expense={...fixtures.financeEntries,id:11,kind:"expense",amountCents:1500};
  await assertSucceeds(setDoc(doc(db,"users/alice/financeEntries/11"),
    {...expense,...meta("alice")}));
  const fresh=await repository.overviewMetrics();
  assert.equal(fresh.receivableAmount,100.01);
  assert.equal(repository.hasLoaded(["clients"]),false);
  assert.equal(repository.hasLoaded(["financeEntries"]),false);
});

test("typed commands preserve counts, reject duplicates, and detect concurrent edits",async()=>{
  const db=dbFor("alice");
  const owner=new FirestoreWorkspace(db,"alice");
  const rival=new FirestoreWorkspace(db,"alice");
  const before=await owner.load(["clients","projects","financeEntries"]);
  await rival.load(["clients","projects","financeEntries"]);
  const entry={
    id:103,clientId:1,projectId:2,project:"Projeto",client:"Cliente",
    kind:"income",amount:83.25,date:"17/10/2026",status:"A receber",
  };
  assert.equal(await owner.applyCommands([{kind:"saveFinance",entry}]),true);
  assert.equal(await owner.applyCommands([{kind:"saveFinance",entry}]),false);
  assert.equal((await getDoc(doc(db,"users/alice/financeEntries/103"))).data().amountCents,8325);
  let revision=(await getDoc(doc(db,"users/alice/sync/state"))).data();
  assert.equal(revision.counts.financeEntries,1);
  assert.equal(await owner.applyCommands([{kind:"saveFinance",entry:{...entry,amount:84}}]),true);
  revision=(await getDoc(doc(db,"users/alice/sync/state"))).data();
  assert.equal(revision.counts.financeEntries,1);
  await assert.rejects(()=>rival.applyCommands([{kind:"saveFinance",entry:{...entry,amount:40}}]),/Conflito/);
  assert.equal(await owner.applyCommands([{kind:"deleteFinance",id:103}]),true);
  revision=(await getDoc(doc(db,"users/alice/sync/state"))).data();
  assert.equal(revision.counts.financeEntries,0);
  assert.equal((await getDoc(doc(db,"users/alice/clients/1"))).exists(),true);
  assert.equal((await getDoc(doc(db,"users/alice/projects/2"))).exists(),true);
  assert.equal(before.clients.length,1);
});

test("server cursor pages return distinct projects, status filters and joined tasks",async()=>{
  const db=dbFor("alice");
  for(const id of [11,12,13,14]){
    await assertSucceeds(setDoc(doc(db,"users/alice/projects/"+id),
      {...project,id,clientId:1,status:id===14?"Aprovado":"Em produção",...meta("alice")}));
  }
  await assertSucceeds(setDoc(doc(db,"users/alice/tasks/50"),
    {...fixtures.tasks,id:50,projectId:12,...meta("alice")}));
  const repo=new FirestoreWorkspace(db,"alice");
  const first=await repo.projectPage({reset:true,size:2});
  assert.equal(first.workspace.projects.length,2);
  assert.equal(first.total,5);
  assert.equal(first.hasMore,true);
  assert.equal(repo.hasLoaded(["projects"]),false);
  const second=await repo.projectPage({size:2});
  assert.equal(second.workspace.projects.length,4);
  assert.equal(new Set(second.workspace.projects.map(p=>p.id)).size,4);
  const last=await repo.projectPage({size:2});
  assert.equal(last.workspace.projects.length,5);
  assert.equal(last.hasMore,false);
  const filtered=await repo.projectPage({status:"Aprovado",reset:true,size:2});
  assert.deepEqual(filtered.workspace.projects.map(p=>p.id),[14]);
  assert.equal(filtered.total,1);
  const complete=await repo.load(["projects","tasks"]);
  assert.equal(complete.projects.length,5);
  assert.equal(complete.projects.find(p=>p.id===12).tasks.length,1);
});

test("client directory uses bounded cursor, accurate recurring count, and never marks partial as complete",async()=>{
  const db=dbFor("alice");
  for(const id of [11,12,13]){
    await assertSucceeds(setDoc(doc(db,"users/alice/clients/"+id),
      {...client,id,name:"Cliente "+id,type:id===12||id===13?"Recorrente":"Avulso",...meta("alice")}));
  }
  const repo=new FirestoreWorkspace(db,"alice");
  const first=await repo.clientPage({reset:true,size:2});
  assert.equal(first.total,4);
  assert.equal(first.recurring,2);
  assert.equal(first.workspace.clients.length,2);
  assert.equal(first.hasMore,true);
  assert.equal(repo.hasLoaded(["clients"]),false);
  const second=await repo.clientPage({size:2});
  assert.equal(second.workspace.clients.length,4);
  assert.equal(new Set(second.workspace.clients.map(c=>c.id)).size,4);
  assert.equal(second.hasMore,false);
  const complete=await repo.load(["clients","deliveries"]);
  assert.equal(complete.clients.length,4);
  assert.equal(repo.hasLoaded(["clients"]),true);
});

test("client and project cursors reject pages mixed across remote revisions",async()=>{
  const db=dbFor("alice");
  await assertSucceeds(setDoc(doc(db,"users/alice/projects/11"),
    {...project,id:11,clientId:1,...meta("alice")}));
  await assertSucceeds(setDoc(doc(db,"users/alice/clients/11"),
    {...client,id:11,name:"Cliente onze",...meta("alice")}));
  const first=new FirestoreWorkspace(db,"alice"),second=new FirestoreWorkspace(db,"alice");
  const projectPage=await first.projectPage({reset:true,size:1});
  assert.equal(projectPage.hasMore,true);
  const other=await second.load(["projects","clients"]);
  await second.applyCommands([{kind:"saveProject",project:{...other.projects.find(p=>p.id===2),name:"Atualizado em outra aba"}}]);
  await assert.rejects(()=>first.projectPage({size:1}),/Conflito/);
  const clientPage=await first.clientPage({reset:true,size:1});
  assert.equal(clientPage.hasMore,true);
  await second.applyCommands([{kind:"saveClient",client:{...other.clients.find(c=>c.id===1),contact:"Mudou remotamente"}}]);
  await assert.rejects(()=>first.clientPage({size:1}),/Conflito/);
});


test("finance annual windows avoid reading older history and preserve cross-year records",async()=>{
  const db=dbFor("alice");
  for(const [id,date] of [[101,"2024-06-17"],[102,"2025-10-17"],[103,"2026-02-02"],[104,"2026-10-17"]]){
    await assertSucceeds(setDoc(doc(db,"users/alice/financeEntries/"+id),
      {...fixtures.financeEntries,id,date,amountCents:id*100,...meta("alice")}));
  }
  const repo=new FirestoreWorkspace(db,"alice");
  const baseline=repo.diagnostics().serverDocumentsReturned;
  const thisYear=await repo.financeYear(2026);
  assert.deepEqual(thisYear.financeEntries.map(x=>x.id).sort(),[103,104]);
  assert.equal(repo.hasLoaded(["financeEntries"]),false);
  const afterFirst=repo.diagnostics();
  assert.equal(afterFirst.serverDocumentsReturned-baseline,2);
  const cached=await repo.financeYear(2026);
  assert.equal(cached.financeEntries.length,2);
  assert.equal(repo.diagnostics().serverDocumentsReturned-baseline,2);
  const previous=await repo.financeYear(2025);
  assert.deepEqual(previous.financeEntries.map(x=>x.id).sort(),[102,103,104]);
  assert.equal(repo.diagnostics().serverDocumentsReturned-baseline,3);
  const full=await repo.load(["financeEntries"]);
  assert.equal(full.financeEntries.length,4);
});

test("calendar windows include adjacent grid months, exclude distant history",async()=>{
  const db=dbFor("alice");
  for(const [id,date] of [[201,"2026-08-31"],[202,"2026-09-15"],[203,"2026-10-01"],[204,"2026-11-30"],[205,"2026-12-01"]]){
    await assertSucceeds(setDoc(doc(db,"users/alice/events/"+id),
      {...fixtures.events,id,date,...meta("alice")}));
  }
  const repo=new FirestoreWorkspace(db,"alice");
  const first=await repo.calendarWindow(2026,9);
  assert.deepEqual(first.calendarEvents.map(e=>e.id).sort(),[202,203,204,205]);
  assert.equal(repo.hasLoaded(["events"]),false);
  const again=await repo.calendarWindow(2026,9);
  assert.equal(again.calendarEvents.length,4);
  const shifted=await repo.calendarWindow(2026,10);
  assert.deepEqual(shifted.calendarEvents.map(e=>e.id).sort(),[202,203,204,205]);
  await assert.rejects(()=>repo.calendarWindow(2026,12),/inválido/);
});


test("financial month reads only requested month, and annual bars respect year and client",async()=>{
  const db=dbFor("alice");
  for(const [id,date,clientId,kind,amountCents] of [
    [301,"2025-10-11",1,"income",99900],
    [302,"2026-01-11",1,"income",10001],
    [303,"2026-10-12",1,"income",20050],
    [304,"2026-10-15",0,"income",5000],
    [305,"2026-10-17",1,"expense",700],
  ]){
    await assertSucceeds(setDoc(doc(db,"users/alice/financeEntries/"+id),
      {...fixtures.financeEntries,id,date,clientId,kind,amountCents,...meta("alice")}));
  }
  const repo=new FirestoreWorkspace(db,"alice");
  const baseline=repo.diagnostics().serverDocumentsReturned;
  const month=await repo.financeMonth(2026,9);
  assert.deepEqual(month.financeEntries.map(x=>x.id).sort(),[303,304,305]);
  assert.equal(repo.diagnostics().serverDocumentsReturned-baseline,3);
  assert.equal(repo.hasLoaded(["financeEntries"]),false);
  const all=await repo.financeYearBars(2026);
  assert.equal(all[0],100.01);
  assert.equal(all[9],250.5);
  assert.equal(all.reduce((a,b)=>a+b,0),350.51);
  const filtered=await repo.financeYearBars(2026,1);
  assert.equal(filtered[9],200.5);
  assert.equal(filtered[0],100.01);
  const other=await repo.financeMonth(2025,9);
  assert.equal(other.financeEntries.some(e=>e.id===301),true);
  assert.equal((await repo.load(["financeEntries"])).financeEntries.length,5);
});


test("large finance histories use server annual aggregation and refresh only changed months",async()=>{
  const db=dbFor("alice");
  await env.withSecurityRulesDisabled(async ctx=>{
    const admin=ctx.firestore();
    for(let i=0;i<45;i++){
      const date=i<40?"2025-08-12":"2026-10-12";
      await setDoc(doc(admin,"users/alice/financeEntries/"+(700+i)),
        {...fixtures.financeEntries,id:700+i,date,clientId:i%2?1:2,
        kind:"income",amountCents:100,...meta("alice")});
    }
  });
  const repo=new FirestoreWorkspace(db,"alice");
  const initial=repo.diagnostics();
  const page=await repo.financeMonth(2026,9);
  assert.equal(page.financeEntries.length,5);
  const aggregationBaseline=repo.diagnostics().aggregationQueries;
  const bars=await repo.financeYearBars(2026);
  assert.equal(bars[9],5);
  assert.equal(bars.reduce((a,b)=>a+b,0),5);
  const after=repo.diagnostics();
  assert.equal(repo.hasLoaded(["financeEntries"]),false);
  assert.equal(after.serverDocumentsReturned-initial.serverDocumentsReturned,5);
  assert.equal(after.aggregationQueries-aggregationBaseline,12);
  const commands=[{kind:"saveFinance",entry:{
    id:999,project:"Novo",client:"Cliente",clientId:1,projectId:2,
    kind:"income",amount:7.5,date:"17/10/2026",status:"Recebido"
  }}];
  assert.deepEqual(repo.affectedFinanceMonths(commands,2026),[9]);
  await repo.applyCommands(commands);
  const rechecked=await repo.financeYearBars(2026,undefined,[9]);
  assert.equal(rechecked[9],12.5);
  assert.equal(repo.diagnostics().aggregationQueries-after.aggregationQueries,1);
  const forClient=await repo.financeYearBars(2026,1);
  assert.equal(forClient[9],9.5);
});

test("Drive folder links: user-owned projects only, no cross-account reads or edits",async()=>{
  const alice=dbFor("alice"),bob=dbFor("bob"),anon=dbFor();
  const connectionId="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const folderId="folder_1234567890";
  const id="2_"+connectionId+"_"+folderId;
  const linkPath="users/alice/driveFolders/"+id;
  const data={ownerUid:"alice",schemaVersion:1,projectId:2,connectionId,
    folderId,folderName:"Materiais de gravação",createdAt:serverTimestamp()};
  const ref=doc(alice,linkPath);
  await assertFails(setDoc(ref,{...data,ownerUid:"bob"}));
  await assertFails(setDoc(ref,{...data,projectId:999}));
  await assertFails(setDoc(ref,{...data,folderId:"other_folder_9999"}));
  await assertFails(setDoc(ref,{...data,folderName:""}));
  await assertFails(setDoc(ref,{...data,extra:"secret"}));
  await assertSucceeds(setDoc(ref,data));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(getDocs(collection(alice,"users/alice/driveFolders")));
  await assertFails(updateDoc(ref,{folderName:"Alterado"}));
  await assertFails(setDoc(ref,data));
  for(const unauthorized of [bob,anon]){
    await assertFails(getDoc(doc(unauthorized,linkPath)));
    await assertFails(getDocs(collection(unauthorized,"users/alice/driveFolders")));
    await assertFails(setDoc(doc(unauthorized,linkPath),data));
    await assertFails(deleteDoc(doc(unauthorized,linkPath)));
  }
  await assertSucceeds(deleteDoc(ref));
});

test("deletion marker blocks all client mutations while retaining per-owner isolation",async()=>{
  const alice=dbFor("alice"),bob=dbFor("bob");
  const root=doc(alice,"users/alice"),item=doc(alice,"users/alice/projects/2");
  await env.withSecurityRulesDisabled(async admin=>{
    await updateDoc(doc(admin.firestore(),"users/alice"),{deletionState:"deleting"});
  });
  await assertSucceeds(getDoc(root));
  await assertFails(getDoc(item));
  await assertFails(updateDoc(root,{displayName:"After deletion",revision:2,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(root,{deletionState:"active",revision:2,updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(alice,"users/alice/clients/333"),{...client,id:333,...meta("alice")}));
  await assertFails(updateDoc(item,{name:"Modified",revision:2,updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(item));
  await assertFails(getDoc(doc(bob,"users/alice")));
  // A different account remains usable.
  await assertSucceeds(updateDoc(doc(bob,"users/bob/projects/2"),{name:"Unchanged isolation",revision:2,updatedAt:serverTimestamp()}));
});

test("residual JWT cannot recreate a deleted profile or remove the independent fence",async()=>{
  const alice=dbFor('alice'),bob=dbFor('bob');
  await env.withSecurityRulesDisabled(async admin=>{
    await setDoc(doc(admin.firestore(),'accountDeletionFences/alice'),{deleting:true});
    await deleteDoc(doc(admin.firestore(),'users/alice'));
  });
  const registration={...profile,...meta('alice'),studioName:'Disposable',professionalType:'freelancer',
    registrationCompletedAt:serverTimestamp(),dataAcknowledgedAt:serverTimestamp()};
  await assertFails(setDoc(doc(alice,'users/alice'),registration));
  await assertFails(getDoc(doc(alice,'users/alice/projects/2')));
  await assertFails(setDoc(doc(alice,'users/alice/clients/10'),{...client,...meta('alice')}));
  for(const db of [alice,bob,dbFor()]){
    await assertFails(getDoc(doc(db,'accountDeletionFences/alice')));
    await assertFails(deleteDoc(doc(db,'accountDeletionFences/alice')));
    await assertFails(setDoc(doc(db,'accountDeletionFences/alice'),{deleting:false}));
  }
  await assertSucceeds(getDoc(doc(bob,'users/bob/projects/2')));
});

test("commercial access cannot be forged and expires at server time",async()=>{
  const alice=dbFor("alice"),bob=dbFor("bob");
  const accessRef=doc(alice,"users/alice/access/current");
  await assertSucceeds(getDoc(accessRef));
  await assertFails(getDoc(doc(bob,"users/alice/access/current")));
  await assertFails(updateDoc(accessRef,{unlimited:true}));
  await assertFails(deleteDoc(accessRef));
  await env.withSecurityRulesDisabled(async context=>{
    await updateDoc(doc(context.firestore(),"users/alice/access/current"),{
      accessUntil:Timestamp.fromMillis(Date.now()-1000),unlimited:false
    });
  });
  await assertFails(getDoc(doc(alice,"users/alice/clients/1")));
  await assertSucceeds(getDoc(doc(alice,"users/alice")));
  await env.withSecurityRulesDisabled(async context=>{
    await updateDoc(doc(context.firestore(),"users/alice/access/current"),{unlimited:true});
  });
  await assertSucceeds(getDoc(doc(alice,"users/alice/clients/1")));
  await env.withSecurityRulesDisabled(async context=>{
    await updateDoc(doc(context.firestore(),"users/alice/access/current"),{suspended:true});
  });
  await assertFails(getDoc(doc(alice,"users/alice/clients/1")));
});
