export type View = "overview" | "projects" | "clients" | "reviews" | "finance" | "calendar" | "library" | "settings";
export type Status = "Em produção" | "Em aprovação" | "Ajustes" | "Aprovado";
export type ProjectCover = {connectionId:string;fileId:string;name:string;x:number;y:number;zoom:number};
export type Project = { cover?:ProjectCover; clientId?: number; dueDate?: string; description?: string; tasks?: { id: number; title: string; done: boolean }[]; template?: string;  id: number; name: string; client: string; status: Status; due: string; progress: number; files: number; color: string; initials: string };
export type ClientType = "Recorrente" | "Avulso";
export type Client = { deliveries?: { id:number; title:string; month:string; done:boolean }[];  packageTitle?: string; monthlyDeliverables?: number; monthlyFee?: number;  id: number; name: string; contact: string; email?: string; phone?: string; projects: number; active: number; color: string; initials: string; type: ClientType; since: string };
export type FinanceEntry = { projectId?: number; kind?: "income" | "expense";  id: number; project: string; client: string; clientId?: number; amount: number; date: string; status: "Recebido" | "A receber" };
export type CalendarEvent = { endTime?: string; autoDeadline?: boolean; projectId?: number;  id: number; title: string; date: string; time: string; type: "Produção" | "Entrega" | "Reunião" | "Aprovação"; client: string };
export type AssetKind = "Vídeo" | "Imagem" | "Áudio" | "Documento";
export type LibraryAsset = { fileKey?: string; url?: string; mimeType?: string; projectId?: number; version?: number;  id: number; name: string; kind: AssetKind; size: string; addedAt: string; project: string; color: string; preview?: string };


export type Activity = { id?: string; text: string; when: string };
export type WorkspaceData = {
  projects: Project[]; clients: Client[]; financeEntries: FinanceEntry[];
  calendarEvents: CalendarEvent[]; libraryAssets: LibraryAsset[];
  comments: { name: string; initials: string; time: string; text: string; when: string }[];
  reviewState: "pending" | "changes" | "approved"; activities: Activity[];
};
export const emptyWorkspace = (): WorkspaceData => ({
  projects: [], clients: [], financeEntries: [], calendarEvents: [], libraryAssets: [],
  comments: [], reviewState: "pending", activities: [],
});
// 48 random bits fit exactly in existing numeric UI contracts and avoid clock collisions.
export function newId(): number {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (words[0] & 0xffff) * 0x100000000 + words[1] || 1;
}
