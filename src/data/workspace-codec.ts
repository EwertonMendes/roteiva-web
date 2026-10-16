import { emptyWorkspace, type WorkspaceData, type Client, type Project } from "../domain/workspace.ts";
import { toISO } from "../studio-finance.ts";
export type Data = Record<string, string | number | boolean>;
export type Records = Map<string, Data>;
export const collections = ["clients", "projects", "tasks", "deliveries", "events", "financeEntries", "activities"] as const;
export function encodeWorkspace(workspace: WorkspaceData): Records {
  const records: Records = new Map();
  const put = (collection: string, id: number | string, data: Data) => records.set(collection + "/" + id, data);
  for (const c of workspace.clients) {
    put("clients", c.id, {id:c.id,name:c.name,contact:c.contact,email:c.email || "",phone:c.phone || "",color:c.color,initials:c.initials,type:c.type,since:c.since,packageTitle:c.packageTitle || "",monthlyDeliverables:c.monthlyDeliverables || 0,monthlyFeeCents:Math.round((c.monthlyFee || 0)*100)});
    for (const d of c.deliveries || []) put("deliveries",d.id,{...d,clientId:c.id});
  }
  for (const p of workspace.projects) {
    put("projects",p.id,{id:p.id,name:p.name,clientId:p.clientId || 0,client:p.client,status:p.status,dueDate:p.dueDate || "",description:p.description || "",template:p.template || "Livre",color:p.color,initials:p.initials});
    for (const t of p.tasks || []) put("tasks",t.id,{...t,projectId:p.id});
  }
  for (const e of workspace.calendarEvents) put("events",e.id,{...e,projectId:e.projectId || 0,endTime:e.endTime || "",autoDeadline:!!e.autoDeadline});
  for (const e of workspace.financeEntries) {
    const {amount, ...rest} = e;
    put("financeEntries",e.id,{...rest,projectId:e.projectId || 0,clientId:e.clientId || 0,kind:e.kind || "income",date:toISO(e.date),amountCents:Math.round(amount*100)});
  }
  for (const a of workspace.activities) {
    if (a.id) put("activities",a.id,{id:a.id,text:a.text,when:a.when});
  }
  return records;
}
export function decodeWorkspace(records: Records): WorkspaceData {
  const workspace = emptyWorkspace();
  for (const [path,d] of records) {
    const collection = path.split("/")[0];
    if (collection === "clients") {
      const {monthlyFeeCents, ...rest} = d;
      workspace.clients.push({...rest,monthlyFee:Number(monthlyFeeCents)/100,projects:0,active:0,deliveries:[]} as unknown as Client);
    }
    if (collection === "projects") workspace.projects.push({...d,due:d.dueDate ? new Date(d.dueDate+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short"}) : "Sem prazo",tasks:[],progress:0,files:0} as unknown as Project);
    if (collection === "events") workspace.calendarEvents.push(d as unknown as WorkspaceData["calendarEvents"][number]);
    if (collection === "financeEntries") {
      const {amountCents, ...rest} = d;
      workspace.financeEntries.push({...rest,amount:Number(amountCents)/100,date:String(d.date).split("-").reverse().join("/")} as WorkspaceData["financeEntries"][number]);
    }
    if (collection === "activities") workspace.activities.push(d as WorkspaceData["activities"][number]);
  }
  for (const [path,d] of records) {
    if (path.startsWith("tasks/")) workspace.projects.find(p=>p.id===d.projectId)?.tasks?.push({id:Number(d.id),title:String(d.title),done:!!d.done});
    if (path.startsWith("deliveries/")) workspace.clients.find(c=>c.id===d.clientId)?.deliveries?.push({id:Number(d.id),title:String(d.title),month:String(d.month),done:!!d.done});
  }
  for (const p of workspace.projects) p.progress = p.tasks?.length ? Math.round(p.tasks.filter(t=>t.done).length/p.tasks.length*100) : 0;
  workspace.activities.sort((a,b)=>b.when.localeCompare(a.when));
  return workspace;
}
export function equalData(a: Data | undefined, b: Data | undefined): boolean {
  if (!a || !b) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key=>a[key]===b[key]);
}
