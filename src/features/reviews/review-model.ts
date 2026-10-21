export type Status="draft"|"publishing"|"pending"|"changes"|"approved"|"replacing"|"closing"|"closed";
export type Mode="link"|"google";
export type Review={id:string;clientId:number;projectId:number;clientName:string;projectName:string;studioName:string;title:string;message:string;recipientEmail:string;mode:Mode;status:Status;version:number;expiresAt:number;createdAt:number;updatedAt:number;url?:string};
export type Asset={version:number;fileId:string;name:string;mimeType:string;grantState:string};
export type Comment={id:string;version:number;file_id:string;author_name:string;body:string;seconds:number|null;created_at:number};
export type Decision={version:number;decision:"approved"|"changes";author_name:string;message:string;created_at:number};
export type Participant={email:string;role:"reviewer"|"viewer"};
export type Vote={version:number;email:string;decision:"approved"|"changes";author_name:string;message:string;created_at:number};
export type Detail={review:Review;participants?:Participant[];votes?:Vote[];assets:Asset[];comments:Comment[];decisions:Decision[]};
export const statusText:Record<Status,string>={
  draft:"Rascunho",publishing:"Preparando compartilhamento",pending:"Aguardando cliente",
  changes:"Ajustes solicitados",approved:"Aprovado",replacing:"Preparando nova versão",
  closing:"Revogação pendente",closed:"Encerrado"
};
export const fmt=(time:number)=>new Date(time).toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"});
