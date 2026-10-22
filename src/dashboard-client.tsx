import {SidebarAccountMenu} from "./features/ui/SidebarAccountMenu";
import {ProjectsView} from "./features/projects/ProjectsView";
"use client";

import {
  BadgeDollarSign, CalendarCheck2, CalendarDays, Check, ChevronDown,
  ChevronRight, CirclePause, CirclePlay, Clock3, Film, Folder, FolderOpen,
  Grid2X2, LayoutDashboard, LibraryBig, ListFilter, Menu, PanelsTopLeft,
  ArrowUpRight, Building2, UserRound,
  MoreHorizontal, Pencil, Plus, ReceiptText, Search, Trash2,
  UserRoundPlus, Users, WalletCards, X, Upload, Image as ImageIcon,
  FileVideo, FileAudio, FileText, HardDrive, ChevronLeft, Settings2,
  UsersRound, Repeat2, ContactRound, type LucideIcon,
} from "lucide-react";
import { ProjectDetail, ClientDetail, StudioReviews, WorkspaceTools, FinancePanel, projectTemplates } from "./studio-features";
import {ReviewsDashboard} from "./features/reviews/ReviewsDashboard";
import { TodayStudio } from "./features/dashboard/DashboardOverview";
import { ActivityHistoryDrawer } from "./features/dashboard/ActivityHistory";
import { validTimeRange, overlaps, eventRange, eventDuration } from "./studio-calendar";
import { toISO as toISOAdded, parseMoney, splitInstallments } from "./studio-finance";
import { FormEvent, useEffect, useLayoutEffect, useMemo, useState, useCallback } from "react";

import { isDemo, useEmulators } from "./lib/firebase";
import { hrefForWorkspaceRoute, routeFromLocation, type WorkspaceRoute } from "./lib/workspace-routing";
import { SettingsPage } from "./features/settings/SettingsPage";
import { IconLabel } from "./features/ui/IconLabel";
import { PROJECT_STATUS_ICONS, PROJECT_STATUS_LABELS } from "./features/ui/project-status";
import { DriveConnectionPanel } from "./features/drive/DriveConnectionPanel";
import { LibraryReviewDemo } from "./features/drive/LibraryReviewDemo";
import type { RoteivaProfile, ProfileChanges } from "./data/firestore-workspace";
import type { WorkspaceCommand } from "./data/firestore-commands";
import type { FirestoreUsage } from "./data/firestore-usage";
import { newId, type WorkspaceData, type Activity, type View, type Project, type Client, type ClientType, type AssetKind, type FinanceEntry, type CalendarEvent, type LibraryAsset, type Status } from "./domain/workspace";
export type { View, Project, Client, FinanceEntry, CalendarEvent, LibraryAsset, Status } from "./domain/workspace";

const initialProjects: Project[] = [];
const initialClients: Client[] = [];
const monthLabels = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const initialFinanceEntries: FinanceEntry[] = [];
const initialCalendarEvents: CalendarEvent[] = [];
const initialLibraryAssets: LibraryAsset[] = [];

const nav = [
  { id: "overview" as View, label: "Visão geral", icon: LayoutDashboard, hoverIcon: PanelsTopLeft },
  { id: "projects" as View, label: "Projetos", icon: Folder, hoverIcon: FolderOpen },
  { id: "clients" as View, label: "Clientes", icon: UserRound, hoverIcon: Users },
  { id: "reviews" as View, label: "Aprovações", icon: CirclePlay, hoverIcon: CirclePause },
  { id: "finance" as View, label: "Financeiro", icon: WalletCards, hoverIcon: BadgeDollarSign },
];

function AnimatedNavIcon({ icon: Icon, hoverIcon: HoverIcon, kind }: { icon: LucideIcon; hoverIcon: LucideIcon; kind: string }) {
  return <span className={`nav-icon nav-icon-${kind}`} aria-hidden="true"><Icon className="nav-icon-base" size={18} /><HoverIcon className="nav-icon-hover" size={18} /></span>;
}

function StatusBadge({ status }: { status: Status }) {
  return <span className={`status status-with-icon status-${status.toLowerCase().replaceAll(" ", "-")}`}>
    <IconLabel icon={PROJECT_STATUS_ICONS[status]} size={14}>{PROJECT_STATUS_LABELS[status]}</IconLabel>
  </span>;
}

function BrandAvatar({ initials, color, large = false }: { initials: string; color: string; large?: boolean }) {
  return <span className={`brand-avatar ${color} ${large ? "large" : ""}`}>{initials}</span>;
}

type DashboardProps = {
  firstName: string; email: string; photoURL?: string; profile?:RoteivaProfile|null;
  onSaveProfile?:(changes:ProfileChanges)=>Promise<void>;
  initialWorkspace?: WorkspaceData; initialTheme?: "light"|"dark";
  onThemeChange?:(theme:"light"|"dark")=>void;
  onLoadWorkspace?:()=>Promise<WorkspaceData>; onRouteChange?:(route:WorkspaceRoute)=>void;
  onCommands?:(commands:readonly WorkspaceCommand[])=>void;
  overviewMetrics?:{clientCount?:number;receivableAmount?:number;cashBalance?:number;projectCount?:number;projectStatuses?:Record<Status,number>}; projectPage?:{total:number;hasMore:boolean;status:string};
  onMoreProjects?:()=>void;onProjectStatus?:(status:Status|"Todos")=>void;
  onSearchProjects?:()=>void; clientPage?:{total:number;recurring:number;hasMore:boolean};
  onFinancePeriodChange?:(year:number,month:number,clientId?:number)=>void;
  financeBars?:{key:string;bars:number[]};eventCount?:number;usage?:Readonly<FirestoreUsage>;onCalendarMonthChange?:(year:number,month:number)=>void;
  onMoreClients?:()=>void;onSearchClients?:()=>void;onClientCreated?:(client:Client)=>void;canValidateProjectLink?:boolean;canValidateClientLink?:boolean; cloudStatus?:string; saving?:boolean; onLogout?:()=>void;
};
export default function DashboardClient({ firstName, email, photoURL, profile, onSaveProfile, initialWorkspace, initialTheme, onThemeChange, onLoadWorkspace, onRouteChange, onCommands, overviewMetrics, projectPage, onMoreProjects, onProjectStatus, onSearchProjects, clientPage, onMoreClients, onSearchClients, onClientCreated, onFinancePeriodChange, financeBars, eventCount, usage, onCalendarMonthChange, canValidateProjectLink, canValidateClientLink, cloudStatus, saving, onLogout }: DashboardProps) {
  const routeEnvironment={base:import.meta.env.BASE_URL,useHash:isDemo};
  const initialRoute=()=>routeFromLocation(window.location,routeEnvironment);
  const [initialBrowserRoute]=useState<WorkspaceRoute>(initialRoute);
  const [view, setView] = useState<View>(initialBrowserRoute.view);
  const workspaceName=profile?.studioName.trim() || "Roteiva Studio";
  const [projects, setProjects] = useState(initialProjects);
  const [clientList, setClientList] = useState(initialClients);
  const [financeEntries, setFinanceEntries] = useState(initialFinanceEntries);
  const monthlyRevenue = useMemo(() => monthLabels.map((_, month) => financeEntries.filter(e => e.kind !== "expense" && Number(e.date.split("/")[1]) - 1 === month && Number(e.date.split("/")[2]) === new Date().getFullYear()).reduce((total,e) => total + Math.round(e.amount * 100), 0) / 100), [financeEntries]);
  const [calendarEvents, setCalendarEvents] = useState(initialCalendarEvents);
  const [libraryAssets, setLibraryAssets] = useState(initialLibraryAssets);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "Todos">("Todos");
  const [modalOpen, setModalOpen] = useState(false);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [financeModalOpen, setFinanceModalOpen] = useState(false);
  const [financeKind, setFinanceKind] = useState<"income" | "expense">("income");
  const [editingFinanceEntry, setEditingFinanceEntry] = useState<FinanceEntry | null>(null);
  const [deletingFinanceEntry, setDeletingFinanceEntry] = useState<FinanceEntry | null>(null);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [toast, setToast] = useState("");
  const [reviewState, setReviewState] = useState<"pending" | "changes" | "approved">("pending");
  
  const [comments, setComments] = useState<{ name: string; initials: string; time: string; text: string; when: string }[]>([]);
  const [dataReady, setDataReady] = useState(false);
  const [selectedProject, setSelectedProject] = useState<number | null>(initialBrowserRoute.projectId || null);
  const [selectedClient, setSelectedClient] = useState<number | null>(initialBrowserRoute.clientId || null);
  const [reviewStart,setReviewStart]=useState<{clientId?:number;projectId?:number}|null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [eventDate, setEventDate] = useState("");
  const [eventDraft, setEventDraft] = useState({date:"",time:"09:00",endTime:""});
  const [eventError, setEventError] = useState("");
  const [saveStatus, setSaveStatus] = useState("Carregando dados…");
  const [libraryProject, setLibraryProject] = useState("");
  const [linkedFolderCount, setLinkedFolderCount] = useState<number|null>(null);
  const [uploading, setUploading] = useState(false);
  const storageKey = "roteiva-pages-demo-workspace-v1";
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);

  function commitCommands(commands:WorkspaceCommand[]){
    // The cloud is persisted only through explicit typed business commands.
    // The demo retains its independent localStorage snapshot.
    if (!isDemo && onCommands && commands.length)onCommands(commands);
  }
  const workspace = { projects, clients: clientList, financeEntries, monthlyRevenue, calendarEvents, libraryAssets: libraryAssets.map((asset) => ({ ...asset, preview: undefined })), comments, reviewState, activities };
  function logActivity(text: string) {
    const activity:Activity={id:crypto.randomUUID(),text,when:new Date().toISOString()};
    setActivities(current=>[activity,...current].slice(0,150));
    const commands:WorkspaceCommand[]=[{kind:"appendActivity",activity}];
    if(activities.length>=150 && activities[149].id)commands.push({kind:"deleteActivity",id:activities[149].id!});
    commitCommands(commands);
  }
  const restoreWorkspace = useCallback((data: Partial<WorkspaceData>) => {
    const next={
      projects:data.projects || [],clients:data.clients || [],financeEntries:data.financeEntries || [],
      calendarEvents:data.calendarEvents || [],activities:data.activities || [],
    };
    setProjects(next.projects);setClientList(next.clients);setFinanceEntries(next.financeEntries);
    setCalendarEvents(next.calendarEvents);
    setLibraryAssets(data.libraryAssets || []);setComments(data.comments || []);
    setReviewState(data.reviewState || "pending");setActivities(next.activities);
  }, []);
  function openEvent(entry: CalendarEvent | null = null, date = "") {
    setEditingEvent(entry); setEventDate(date); setEventError("");
    setEventDraft({date:entry?.date || date || new Date().toLocaleDateString("en-CA"),time:entry?.time || "09:00",endTime:entry?.endTime || ""});
    setEventModalOpen(true);
  }
  const overlappingEvents = calendarEvents.filter(e => overlaps({...eventDraft,id:editingEvent?.id || -1},e));
  function updateProject(updated: Project) {
    const old = projects.find(p => p.id === updated.id);
    setProjects(current => current.map(p => p.id === updated.id ? updated : p));
    if (old?.name !== updated.name) setLibraryAssets(current => current.map(a => a.projectId === updated.id ? {...a, project:updated.name} : a));
    const commands:WorkspaceCommand[]=[{kind:"saveProject",project:updated}];
    const previousTasks=new Map((old?.tasks||[]).map(t=>[t.id,t]));
    for(const task of updated.tasks||[]){
      const was=previousTasks.get(task.id);
      if(!was || was.title!==task.title || was.done!==task.done)
        commands.push({kind:"saveTask",projectId:updated.id,task});
      previousTasks.delete(task.id);
    }
    for(const id of previousTasks.keys())commands.push({kind:"deleteTask",id});
    if (old?.dueDate !== updated.dueDate || old?.name !== updated.name) {
      const isDeadline=(e:CalendarEvent)=>e.projectId===updated.id && e.type==="Entrega" &&
        (e.autoDeadline || e.title===`Entrega — ${old?.name}`);
      const existing=calendarEvents.find(isDeadline);
      const deadline:CalendarEvent|undefined=updated.dueDate ? {
        id:existing?.id || newId(),autoDeadline:true,projectId:updated.id,
        title:`Entrega — ${updated.name}`,date:updated.dueDate,time:existing?.time || "18:00",
        type:"Entrega",client:updated.client,
      } : undefined;
      setCalendarEvents(current=>[...current.filter(e=>!isDeadline(e)),...(deadline?[deadline]:[])]);
      if(deadline)commands.push({kind:"saveEvent",event:deadline});
      else if(existing)commands.push({kind:"deleteEvent",id:existing.id});
    }
    commitCommands(commands);
    logActivity(`Projeto atualizado: ${updated.name}`); notifyChange("Projeto salvo");
  }
  function saveClientPackage(client: Client) {
    setClientList(current => current.map(c => c.id === client.id ? client : c));
    const previous=clientList.find(c=>c.id===client.id);
    const old=new Map((previous?.deliveries||[]).map(d=>[d.id,d]));
    const commands:WorkspaceCommand[]=[{kind:"saveClient",client}];
    for(const delivery of client.deliveries||[]){
      const was=old.get(delivery.id);
      if(!was||was.title!==delivery.title||was.month!==delivery.month||was.done!==delivery.done)
        commands.push({kind:"saveDelivery",clientId:client.id,delivery});
      old.delete(delivery.id);
    }
    for(const id of old.keys())commands.push({kind:"deleteDelivery",id});
    commitCommands(commands);
    logActivity(`Entregas atualizadas: ${client.name}`);
  }
  function addLinkedRevenue(project: Project) { openFinanceModal(); setSelectedProject(project.id); }


  const filtered = useMemo(() => projects.filter((project) => {
    const matchText = `${project.name} ${project.client}`.toLowerCase().includes(query.toLowerCase());
    return matchText && (statusFilter === "Todos" || project.status === statusFilter);
  }), [projects, query, statusFilter]);

  useEffect(() => {
    if (!isDemo) {
      if (initialWorkspace) restoreWorkspace(initialWorkspace);
      const preferred=initialTheme || "light";
      setTheme(preferred);
      document.documentElement.setAttribute("data-theme",preferred);
      setDataReady(true);
      return;
    }
    try {
      const saved=localStorage.getItem("roteiva-theme");
      const preferred=saved==="dark"||saved==="light" ? saved : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark":"light";
      setTheme(preferred); document.documentElement.setAttribute("data-theme",preferred);
      const local=localStorage.getItem(storageKey);
      if(local)restoreWorkspace(JSON.parse(local));
      setSaveStatus("Demonstração · dados somente neste navegador");
    } catch { setSaveStatus("Demonstração · armazenamento local indisponível"); }
    setDataReady(true);
  },[restoreWorkspace,initialWorkspace,initialTheme]);

  // The Pages demo preserves its existing browser-only snapshot contract.
  // Firebase never persists a render/effect: business mutations call commands.
  useLayoutEffect(() => {
    if (!dataReady || !isDemo) return;
    const payload={projects,clients:clientList,financeEntries,calendarEvents,
      libraryAssets:libraryAssets.map(asset=>({...asset,preview:undefined})),
      comments,reviewState,activities};
    try {
      localStorage.setItem(storageKey,JSON.stringify({...payload,monthlyRevenue}));
      setSaveStatus("Demonstração · salvo neste navegador");
    } catch {setSaveStatus("Falha ao salvar · exporte seus dados");}
  },[projects,clientList,financeEntries,monthlyRevenue,calendarEvents,libraryAssets,comments,reviewState,activities,dataReady]);

  useEffect(() => {
    if (!dataReady) return;
    document.documentElement.setAttribute("data-roteiva-ready", "true");
    window.dispatchEvent(new Event("roteiva:ready"));
  }, [dataReady]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    if (isDemo) { try { localStorage.setItem("roteiva-theme", next); } catch { /* Theme still works in memory. */ } }
    else onThemeChange?.(next);
    document.documentElement.setAttribute("data-theme", next);
    notify(next === "dark" ? "Modo escuro ativado" : "Modo claro ativado");
  }

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  function notifyChange(message: string) { notify(isDemo ? message : "Alteração preparada · confira a confirmação na nuvem"); }

  function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "Novo projeto");
    const clientId = Number(form.get("clientId")) || undefined;
    const client = clientList.find(c => c.id === clientId)?.name || "Sem cliente vinculado";
    const dueValue = String(form.get("due") || "");
    const due = dueValue ? new Date(`${dueValue}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : "Sem prazo";
    const template = String(form.get("template") || "Livre");
    const description = String(form.get("description") || "");
    const tasks = (projectTemplates[template] || []).map((title, i) => ({ id: newId() + i, title, done: false }));
    const projectId = newId();
    const created:Project={id:projectId,name,client,clientId,dueDate:dueValue,
      description,tasks,template,status:"Em produção",due,progress:0,files:0,
      color:"blue",initials:client.slice(0,2).toUpperCase()};
    const deadline:CalendarEvent|undefined=dueValue ? {
      id:newId(),projectId,autoDeadline:true,title:`Entrega — ${name}`,date:dueValue,
      time:"18:00",type:"Entrega",client,
    } : undefined;
    setProjects(current=>[created,...current]);
    if(deadline)setCalendarEvents(current=>[deadline,...current]);
    commitCommands([{kind:"saveProject",project:created},
      ...tasks.map(task=>({kind:"saveTask" as const,projectId,task})),
      ...(deadline?[{kind:"saveEvent" as const,event:deadline}]:[])]);
    setModalOpen(false);
    openProject(projectId);
    logActivity(`Projeto criado: ${name}`);
    notifyChange("Projeto criado com sucesso");
  }

  function addClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "Novo cliente").trim();
    const contact = String(form.get("contact") || "Contato não informado").trim();
    const email = String(form.get("email") || "").trim();
    const phone = String(form.get("phone") || "").trim();
    const type = String(form.g…16118 tokens truncated…    min-height: 0;
    overflow: clip;
  }
  .app-view-overview .page {
    height: 100%;
    min-height: 0;
    max-height: 100%;
    overflow: clip;
    display: flex;
    flex-direction: column;
    gap: clamp(10px, 1.75dvh, 24px);
    padding: clamp(12px, 2.5dvh, 32px) clamp(18px, 2.4vw, 44px);
  }
  .app-view-overview .page-heading {
    flex: 0 0 auto;
    min-height: 0;
    margin-bottom: 0;
  }
  .app-view-overview .page-heading h1 {
    font-size: clamp(2rem, min(3.8vw, 6dvh), 3.65rem);
  }
  .app-view-overview .heading-actions .workspace-tools .secondary-button,
  .app-view-overview .heading-actions > .primary-button {
    min-height: clamp(40px, 5.7dvh, 54px);
  }
  .app-view-overview .panel.flow-overview {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto auto auto;
    padding: clamp(14px, 2.5dvh, 34px) clamp(20px, 2.6vw, 36px) 0;
  }
  .app-view-overview .flow-overview-head h2 {
    font-size: clamp(1.4rem, min(2vw, 3.4dvh), 2.15rem);
  }
  .app-view-overview .flow-numbers {
    align-self: stretch;
    align-content: center;
    min-height: 0;
    margin: clamp(8px, 2dvh, 28px) 0;
  }
  .app-view-overview .flow-numbers > button { gap: clamp(4px, 1dvh, 10px); }
  .app-view-overview .flow-numbers strong { font-size: clamp(1.85rem, min(3vw, 5.6dvh), 3.2rem); }
  .app-view-overview .flow-numbers .flow-money { font-size: clamp(1.65rem, min(2.7vw, 5dvh), 3rem); }
  .app-view-overview .flow-progress { padding: clamp(10px, 1.75dvh, 28px) 0; }
  .app-view-overview .flow-progress-title { margin-bottom: clamp(6px, 1.4dvh, 15px); }
  .app-view-overview .flow-legend { margin-top: clamp(7px, 1.4dvh, 18px); }
  .app-view-overview .flow-next {
    min-height: 0;
    padding: clamp(9px, 1.9dvh, 20px) 0;
  }
  .app-view-overview .flow-next p {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .app-shell .sidebar { padding-top: clamp(12px, 2.6dvh, 24px); padding-bottom: clamp(10px, 1.75dvh, 16px); }
  .app-shell .sidebar .brand-lockup { height: clamp(44px, 7dvh, 64px); }
  .app-shell .sidebar nav {
    margin-top: clamp(9px, 2dvh, 28px);
    gap: clamp(1px, .45dvh, 5px);
  }
  .app-shell .sidebar nav > button { min-height: clamp(34px, 5.5dvh, 47px); }
  .app-shell .sidebar-profile { padding-top: clamp(7px, 1.4dvh, 14px); }

}
@media (min-width: 821px) and (max-width: 1120px) {
  .app-view-overview .page-heading { gap: 10px; }
  .app-view-overview .flow-numbers { gap: clamp(8px, 1.8dvh, 20px) 0; }
  .app-view-overview .flow-numbers strong { font-size: clamp(1.75rem, 4.5dvh, 2.6rem); }
}
@media (min-width: 821px) and (max-height: 680px) {
  .app-view-overview .page { gap: 8px; padding-top: 10px; padding-bottom: 10px; }
  .app-view-overview .page-heading h1 { font-size: clamp(1.75rem, 5dvh, 2.5rem); margin-bottom: 2px; }
  .app-view-overview .page-heading p { font-size: .9375rem; }
  .app-view-overview .flow-overview-head .eyebrow { font-size: .8125rem; }
  .app-view-overview .flow-numbers { margin: 7px 0; }
  .app-view-overview .flow-progress { padding: 8px 0; }
  .app-view-overview .flow-legend { margin-top: 6px; }
  .app-view-overview .flow-next { padding: 8px 0; }
}


/* Activity history: meaningful preview within the dashboard, full detail in a fixed drawer. */
.flow-activity-preview {
  border-top:1px solid #363638;
  padding:clamp(10px,1.7dvh,18px) 0 clamp(12px,1.8dvh,18px);
  min-width:0;
}
.flow-activity-header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
.flow-activity-header > span { display:inline-flex; align-items:center; gap:9px; font-size:.98rem; font-weight:600; }
.flow-activity-header > span svg { color:#aaa; }
.flow-activity-open { border:0; background:transparent; color:#d8d8da; padding:7px 0 7px 8px; font-size:.875rem; font-weight:600; cursor:pointer; text-align:right; }
.flow-activity-open:hover { color:white; }
.flow-activity-empty { margin:6px 0 0; font-size:.875rem; color:#aaa; }
.flow-activity-rows { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.activity-history-item { display:flex; align-items:flex-start; min-width:0; gap:12px; padding:14px 0; border-bottom:1px solid #323234; }
.activity-history-item.is-compact { padding:6px 0; border-bottom:0; align-items:center; }
.activity-kind-icon { flex:0 0 38px; width:38px; height:38px; display:grid; place-items:center; border-radius:11px; background:rgba(160,160,170,.12); color:#bbb; }
.activity-kind-projects { color:#63a4ff; background:rgba(52,141,244,.12); }
.activity-kind-finance { color:#50d6a2; background:rgba(32,205,99,.1); }
.activity-kind-clients { color:#c5a0ff; background:rgba(128,86,238,.14); }
.activity-kind-calendar { color:#ffbf67; background:rgba(244,174,57,.13); }
.activity-history-copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.activity-history-copy strong { font-weight:600; color:#f4f4f5; font-size:.875rem; line-height:1.3; }
.activity-history-copy span { color:#adadb2; font-size:.8125rem; line-height:1.35; overflow-wrap:anywhere; }
.activity-history-item.is-compact .activity-history-copy strong,
.activity-history-item.is-compact .activity-history-copy span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.activity-history-item time { color:#a3a3a9; flex:0 0 auto; font-size:.75rem; font-variant-numeric:tabular-nums; line-height:1.5; }
.activity-history-overlay { position:fixed; inset:0; z-index:90; display:flex; justify-content:flex-end; }
.activity-history-backdrop { position:absolute; inset:0; width:100%; height:100%; border:0; background:rgba(0,0,0,.55); backdrop-filter:blur(3px); cursor:default; }
.activity-history-drawer { position:relative; width:min(440px,100vw); height:100dvh; background:#19191b; border-left:1px solid #36363a; color:#f5f5f6; box-shadow:-22px 0 65px #0006; display:flex; flex-direction:column; min-width:0; }
.activity-drawer-heading { flex:0 0 auto; display:flex; justify-content:space-between; gap:18px; align-items:flex-start; padding:30px 26px 19px; }
.activity-drawer-heading h2 { margin:0; font-size:1.4rem; line-height:1.2; font-weight:700; letter-spacing:-.025em; }
.activity-drawer-heading p { margin:8px 0 0; color:#adadb4; font-size:.9rem; line-height:1.5; }
.activity-drawer-close { display:grid; place-items:center; flex:0 0 40px; width:40px; height:40px; border-radius:11px; border:1px solid #414145; background:#2a2a2e; color:inherit; }
.activity-drawer-filters { display:flex; gap:7px; flex-wrap:wrap; padding:0 26px 18px; border-bottom:1px solid #343438; }
.activity-drawer-filters button { border:1px solid #404045; border-radius:999px; padding:7px 12px; color:#bfc0c5; background:#232326; font-size:.875rem; font-weight:550; }
.activity-drawer-filters button.selected { background:#f1f1f2; color:#171719; border-color:#f1f1f2; }
.activity-drawer-content { flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:#54545a transparent; padding:12px 26px 26px; }
.activity-history-group h3 { color:#a7a7b0; margin:24px 0 10px; font-size:.8125rem; font-weight:600; }
.activity-history-group:first-child h3 { margin-top:8px; }
.activity-history-group .activity-history-item:last-child { border-bottom:0; }
.activity-drawer-empty { display:flex; align-items:center; flex-direction:column; gap:11px; text-align:center; padding:50px 15px; color:#bbb; }
.activity-drawer-empty strong { color:#f5f5f6; font-size:1rem; }
.activity-drawer-empty p { margin:0; font-size:.875rem; max-width:300px; }
.activity-history-drawer button:focus-visible,.flow-activity-open:focus-visible { outline:2px solid #80b7ff; outline-offset:3px; }
:root:not([data-theme="dark"]) .flow-activity-preview { border-color:#e4e4e5; }
:root:not([data-theme="dark"]) .flow-activity-header > span { color:#1f2023; }
:root:not([data-theme="dark"]) .flow-activity-header > span svg,
:root:not([data-theme="dark"]) .flow-activity-empty { color:#666; }
:root:not([data-theme="dark"]) .flow-activity-open { color:#343437; }
:root:not([data-theme="dark"]) .flow-activity-open:hover { color:#000; }
:root:not([data-theme="dark"]) .activity-history-drawer { background:#fff; color:#191919; border-color:#e1e1e4; box-shadow:-22px 0 65px #0002; }
:root:not([data-theme="dark"]) .activity-drawer-heading p,
:root:not([data-theme="dark"]) .activity-history-copy span,
:root:not([data-theme="dark"]) .activity-history-item time,
:root:not([data-theme="dark"]) .activity-history-group h3 { color:#666872; }
:root:not([data-theme="dark"]) .activity-history-copy strong,
:root:not([data-theme="dark"]) .activity-drawer-empty strong { color:#1a1a1c; }
:root:not([data-theme="dark"]) .activity-drawer-close,
:root:not([data-theme="dark"]) .activity-drawer-filters button { background:#f4f4f5; color:#303035; border-color:#dfdfe2; }
:root:not([data-theme="dark"]) .activity-drawer-filters button.selected { background:#202024; color:white; border-color:#202024; }
:root:not([data-theme="dark"]) .activity-drawer-filters,
:root:not([data-theme="dark"]) .activity-history-item { border-color:#e8e8e9; }
:root:not([data-theme="dark"]) .activity-drawer-empty { color:#666; }
:root:not([data-theme="dark"]) .app-view-overview .flow-legend > span > span { color:#626267; }
@media(min-width:821px) and (max-height:740px) {
  .app-view-overview .flow-activity-rows > :nth-child(n+2) { display:none; }
  .app-view-overview .flow-activity-preview { padding:8px 0 9px; }
  .app-view-overview .flow-activity-header { margin-bottom:3px; }
}
@media(max-width:820px) {
  .app-view-overview .flow-activity-preview { margin:0 -20px; padding:18px 20px; }
  .app-view-overview .flow-activity-rows { grid-template-columns:1fr; gap:5px; }
  .activity-history-drawer { width:min(440px,100vw); }
  .activity-drawer-heading { padding:24px 19px 17px; }
  .activity-drawer-filters { padding:0 19px 16px; }
  .activity-drawer-content { padding:12px 19px max(26px,env(safe-area-inset-bottom)); }
}
@media(max-width:430px) {
  .activity-drawer-heading h2 { font-size:1.25rem; }
  .app-view-overview .flow-activity-header { align-items:flex-start; }
  .app-view-overview .flow-activity-open { font-size:.8125rem; }
  .activity-history-item { gap:9px; }
  .activity-kind-icon { flex-basis:34px; width:34px; height:34px; }
}
@media(prefers-reduced-motion:no-preference) {
  .activity-history-drawer { animation:activity-drawer-enter .18s ease-out both; }
  @keyframes activity-drawer-enter { from {transform:translateX(22px);opacity:.7;} to {transform:translateX(0);opacity:1;} }
}
