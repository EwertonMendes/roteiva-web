import type {FinanceEntry} from "../../domain/workspace";

/** Explicitly a copy of the rows currently loaded into the workspace.
 * Never claim this is a complete Firestore backup: finance is loaded in windows. */
export function createLoadedFinanceCopy(entries:FinanceEntry[],exportedAt:string){
  return {
    format:"roteiva.finance.loaded-copy",
    version:1,
    scope:"loaded-entries",
    exportedAt,
    count:entries.length,
    entries:entries.map(e=>({
      id:e.id,project:e.project,client:e.client,clientId:e.clientId,
      projectId:e.projectId,kind:e.kind??"income",amount:e.amount,
      date:e.date,status:e.status,
    })),
  };
}

export function downloadLoadedFinanceCopy(entries:FinanceEntry[]){
  const now=new Date();
  const content=JSON.stringify(createLoadedFinanceCopy(entries,now.toISOString()),null,2);
  const url=URL.createObjectURL(new Blob([content],{type:"application/json;charset=utf-8"}));
  const link=document.createElement("a");
  link.href=url;
  link.download="roteiva-financeiro-carregado-"+now.toLocaleDateString("en-CA")+".json";
  link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),0);
}
