import { readFile } from "node:fs/promises";
import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, Timestamp, writeBatch } from "firebase/firestore";
import { FirestoreWorkspace } from "../src/data/firestore-workspace.ts";
import { emptyWorkspace } from "../src/domain/workspace.ts";
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
before(async()=>{ env=await initializeTestEnvironment({projectId:"demo-roteiva",firestore:{host:"127.0.0.1",port:8080,rules:await readFile("firestore.rules","utf8")}}); });
after(async()=>await env?.cleanup());
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    for (const uid of ["alice","bob"]) {
      const stamp={ownerUid:uid,schemaVersion:1,revision:1,createdAt:Timestamp.now(),updatedAt:Timestamp.now()};
      await setDoc(doc(db,"users",uid),{...profile,...stamp});
      await setDoc(doc(db,"users",uid,"clients","1"),{...client,id:1,...stamp});
      await setDoc(doc(db,"users",uid,"projects","2"),{...project,id:2,...stamp});
    }
  });
});
for (const [name,data] of Object.entries(fixtures)) {
  test(name+": own CRUD, anonymous denial and A/B separation",async()=>{
    const alice=dbFor("alice"),bob=dbFor("bob"),anon=dbFor();
    const path=pathFor("alice",name),ref=doc(alice,path);
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
  await assertFails(setDoc(doc(charlie,"users/charlie"),{...profile,...meta("alice")}));
  await assertSucceeds(setDoc(doc(charlie,"users/charlie"),{...profile,...meta("charlie")}));
  await assertFails(setDoc(doc(charlie,"users/charlie/private/secret"),{role:"admin"}));
  await assertSucceeds(updateDoc(doc(alice,path),{displayName:"Novo nome",revision:2,updatedAt:serverTimestamp()}));
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
  await a.initializeProfile(profile);
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
