import type {Activity,CalendarEvent,Client,FinanceEntry,Project,WorkspaceData} from "../domain/workspace.ts";
import {encodeWorkspace,type CollectionName,type Data} from "./workspace-codec.ts";

/** A command changes one business document, never an implicitly missing page. */
export type WorkspaceCommand =
  | {kind:"saveClient";client:Client}
  | {kind:"saveProject";project:Project}
  | {kind:"saveFinance";entry:FinanceEntry}
  | {kind:"saveEvent";event:CalendarEvent}
  | {kind:"appendActivity";activity:Activity}
  | {kind:"deleteFinance";id:number}
  | {kind:"deleteEvent";id:number};

export type DocumentChange={key:string;collection:CollectionName;data?:Data};

const noRecords:WorkspaceData={
  projects:[],clients:[],financeEntries:[],calendarEvents:[],activities:[],
  libraryAssets:[],comments:[],reviewState:"pending",
};
function encoded(workspace:WorkspaceData,domain:CollectionName):DocumentChange {
  const records=encodeWorkspace(workspace,new Set([domain]));
  const entry=records.entries().next().value;
  if (!entry || records.size!==1) throw new Error("Comando inválido: esperado exatamente um documento.");
  return {key:entry[0],data:entry[1],collection:domain};
}
export function encodeCommand(command:WorkspaceCommand):DocumentChange {
  switch(command.kind){
    case "saveClient": return encoded({...noRecords,clients:[command.client]},"clients");
    case "saveProject": return encoded({...noRecords,projects:[command.project]},"projects");
    case "saveFinance": return encoded({...noRecords,financeEntries:[command.entry]},"financeEntries");
    case "saveEvent": return encoded({...noRecords,calendarEvents:[command.event]},"events");
    case "appendActivity":
      if (!command.activity.id) throw new Error("A atividade precisa de ID próprio.");
      return encoded({...noRecords,activities:[command.activity]},"activities");
    case "deleteFinance":
      if (!Number.isSafeInteger(command.id)||command.id<1)throw new Error("ID financeiro inválido.");
      return {key:"financeEntries/"+command.id,collection:"financeEntries"};
    case "deleteEvent":
      if (!Number.isSafeInteger(command.id)||command.id<1)throw new Error("ID de compromisso inválido.");
      return {key:"events/"+command.id,collection:"events"};
  }
}
