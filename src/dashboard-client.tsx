import {FolderPlus as ModalFolderPlus, Wallet as ModalWallet, Clapperboard as ModalClapperboard, CreditCard as ModalCreditCard, ReceiptText as ModalReceiptText} from "lucide-react";
import {AppInput} from "./features/ui/AppInput";
import {AppTextarea} from "./features/ui/AppTextarea";
import {AppButton} from "./features/ui/AppButton";
import {useToast} from "./features/ui/ToastProvider";
import { AppSelect } from "./features/ui/AppSelect";
import { MoneyInput } from "./features/ui/MoneyInput";
import {AppDateFormField,readFormDate} from "./features/ui/AppDateFormField";
import {ProjectDetail} from './features/projects/ProjectDetail';
import {SidebarAccountMenu} from "./features/ui/SidebarAccountMenu";
import {FeedbackDialog} from "./features/feedback/FeedbackDialog";
import {ProjectsView} from "./features/projects/ProjectsView";
import {useProjectFileCount} from "./features/projects/useProjectFileCount";
import {ClientDirectory} from "./features/clients/ClientDirectory";
import {ClientFormDialog} from "./features/clients/ClientFormDialog";
import {phoneDigits,validBrazilPhone} from "./lib/brazil-phone";
"use client";

import {
  BadgeDollarSign, CalendarCheck2, CalendarDays, Check, ChevronDown,
  ChevronRight, CirclePause, CirclePlay, Clock3, Film, Folder, FolderOpen,
  Grid2X2, LayoutDashboard, LibraryBig, ListFilter, Menu, PanelsTopLeft,
  ArrowUpRight, Building2, UserRound,
  Pencil, Plus, ReceiptText, Search, Trash2,
  UserRoundPlus, Users, WalletCards, X, Upload, Image as ImageIcon,
  FileVideo, FileAudio, FileText, HardDrive, ChevronLeft, Settings2, MessageCircleHeart,
  type LucideIcon,
} from "lucide-react";
import { ClientDetail, StudioReviews, projectTemplates } from "./studio-features";
import {FinancePanel} from "./features/finance/FinancePanel";
import {ReviewsDashboard} from "./features/reviews/ReviewsDashboard";
import { TodayStudio } from "./features/dashboard/DashboardOverview";
import {BrandLogo} from "./features/ui/BrandLogo";
import { ActivityHistoryDrawer } from "./features/dashboard/ActivityHistory";
import {timeMinutes,validTimeRange} from "./studio-calendar";
import {CalendarView} from "./features/calendar/CalendarView";
import {CalendarEventDialog,type CalendarDraft} from "./features/calendar/CalendarEventDialog";
import {ConfirmationDialog} from "./features/ui/ConfirmationDialog";
import {AppModal,AppModalHeader,AppModalBody,AppModalFooter,AppModalSection} from "./features/ui/AppModal";
import {isValidCivilDate,todayKey} from "./features/calendar/calendar-dates";
import { toISO as toISOAdded, parseMoney, splitInstallments } from "./studio-finance";
import { FormEvent, useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from "react";

import { isDemo, useEmulators } from "./lib/firebase";
import { hrefForWorkspaceRoute, routeFromLocation, type WorkspaceRoute } from "./lib/workspace-routing";
import { SettingsPage } from "./features/settings/SettingsPage";
import { IconLabel } from "./features/ui/IconLabel";
import { PROJECT_STATUS_ICONS, PROJECT_STATUS_LABELS } from "./features/ui/project-status";
import { DriveConnectionPanel } from "./features/drive/DriveConnectionPanel";
import {VirtualLibrary} from './features/drive/VirtualLibrary';
import { DropboxConnectionPanel } from "./features/dropbox/DropboxConnectionPanel";
import googleDriveMark from "./assets/brand/google-drive.svg";
import dropboxMark from "./assets/brand/dropbox.svg";
import { LibraryReviewDemo } from "./features/drive/LibraryReviewDemo";
import type { RoteivaProfile, ProfileChanges } from "./data/firestore-workspace";
import {applyTheme, isTheme, readStoredTheme, systemTheme, themeStorageKey, writeStoredTheme, type Theme} from "./lib/theme-preference";
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
  getFeedbackToken?:()=>Promise<string>;
  initialWorkspace?: WorkspaceData; initialTheme?: "light"|"dark";
  onThemeChange?:(theme:"light"|"dark")=>void;
  onRouteChange?:(route:WorkspaceRoute)=>void;
  onCommands?:(commands:readonly WorkspaceCommand[])=>Promise<boolean>|void;
  onProjectRemoved?:()=>void;
  overviewMetrics?:{clientCount?:number;receivableAmount?:number;cashBalance?:number;projectCount?:number;projectStatuses?:Record<Status,number>}; projectPage?:{total:number;hasMore:boolean;status:string};
  onMoreProjects?:()=>void;onProjectStatus?:(status:Status|"Todos")=>void;
  onSearchProjects?:()=>void; clientPage?:{total:number;recurring:number;hasMore:boolean};
  onFinancePeriodChange?:(year:number,month:number,clientId?:number)=>void;
  financeBars?:{key:string;bars:number[]};eventCount?:number;usage?:Readonly<FirestoreUsage>;onCalendarMonthChange?:(year:number,month:number)=>void;
  onMoreClients?:()=>void;onSearchClients?:()=>void;onClientCreated?:(client:Client)=>void;canValidateProjectLink?:boolean;canValidateClientLink?:boolean; saving?:boolean; onLogout?:()=>void;
};
export default function DashboardClient({ firstName, email, photoURL, profile, onSaveProfile, getFeedbackToken, initialWorkspace, initialTheme, onThemeChange, onRouteChange, onCommands, onProjectRemoved, overviewMetrics, projectPage, onMoreProjects, onProjectStatus, onSearchProjects, clientPage, onMoreClients, onSearchClients, onClientCreated, onFinancePeriodChange, financeBars, eventCount, usage, onCalendarMonthChange, canValidateProjectLink, canValidateClientLink, saving, onLogout }: DashboardProps) {
  const routeEnvironment={base:import.meta.env.BASE_URL,useHash:isDemo};
  const initialRoute=()=>routeFromLocation(window.location,routeEnvironment);
  const [initialBrowserRoute]=useState<WorkspaceRoute>(initialRoute);
  const [view, setView] = useState<View>(initialBrowserRoute.view);
  const notify=useToast();
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
  const [feedbackOpen,setFeedbackOpen]=useState(false);
  const [financeModalOpen, setFinanceModalOpen] = useState(false);
  const [financeKind, setFinanceKind] = useState<"income" | "expense">("income");
  const [editingFinanceEntry, setEditingFinanceEntry] = useState<FinanceEntry | null>(null);
  const [deletingFinanceEntry, setDeletingFinanceEntry] = useState<FinanceEntry | null>(null);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [deletingCalendarEvent,setDeletingCalendarEvent]=useState<CalendarEvent|null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Closing restores position; navigation from the drawer resets the next page.
  const resetScrollAfterMobileNavigation = useRef(false);
  const [demoTheme, setDemoTheme] = useState<Theme>(()=>readStoredTheme(themeStorageKey()) ?? systemTheme());
  const theme = isDemo ? demoTheme : (initialTheme ?? "light");
  const [reviewState, setReviewState] = useState<"pending" | "changes" | "approved">("pending");
  
  const [comments, setComments] = useState<{ name: string; initials: string; time: string; text: string; when: string }[]>([]);
  const [dataReady, setDataReady] = useState(false);
  const [selectedProject, setSelectedProject] = useState<number | null>(initialBrowserRoute.projectId || null);
  const [selectedClient, setSelectedClient] = useState<number | null>(initialBrowserRoute.clientId || null);
  const consumeReviewStart=useCallback(()=>setReviewStart(null),[]);
  const [reviewStart,setReviewStart]=useState<{clientId?:number;projectId?:number}|null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [eventDate, setEventDate] = useState("");
  const [calendarFocus,setCalendarFocus]=useState<{date:string;revision:number}|null>(null);
  const [demoStorageWarning, setDemoStorageWarning] = useState(false);
  const [libraryProject, setLibraryProject] = useState("");
  const [libraryTarget,setLibraryTarget]=useState<{projectId:number;folderId:string}|null>(null);
  const [uploading, setUploading] = useState(false);
  const storageKey = "roteiva-pages-demo-workspace-v1";
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);

  function commitCommands(commands:WorkspaceCommand[],successMessage?:string,failureMessage="Não foi possível salvar as alterações. Confira sua conexão e tente novamente."){
    // Only an acknowledged Firestore write may produce a success toast.
    // The demo retains its own local snapshot and does not access Firestore.
    if(isDemo){if(successMessage)notify(successMessage,"success");return;}
    if(!onCommands||!commands.length)return;
    const outcome=onCommands(commands);
    if(!successMessage||!outcome)return;
    void outcome.then(saved=>notify(saved?successMessage:failureMessage,saved?"success":"error"))
      .catch(()=>notify(failureMessage,"error"));
  }
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
    setEditingEvent(entry);
    setEventDate(entry?.date || date || todayKey());
    setEventModalOpen(true);
  }
  function projectDeleted(id:number){
    // Do not update the UI until the server confirms all deletion stages.
    setProjects(current=>current.filter(p=>p.id!==id));
    setCalendarEvents(current=>current.filter(e=>e.projectId!==id));
    setFinanceEntries(current=>current.map(e=>e.projectId===id?{...e,projectId:undefined}:e));
    setLibraryAssets(current=>current.filter(asset=>asset.projectId!==id));
    setLibraryTarget(current=>current?.projectId===id?null:current);
    navigateRoute({view:'projects'},{replace:true});
    notify('Projeto excluído com segurança.', 'success');
    if(!isDemo)onProjectRemoved?.();
  }
  function updateProject(updated: Project) {
    const old = projects.find(p => p.id === updated.id);
    setProjects(current => current.map(p => p.id === updated.id ? updated : p));
    if (old?.name !== updated.name) setLibraryAssets(current => current.map(a => a.projectId === updated.id ? {...a, project:updated.name} : a));
    const commands:WorkspaceCommand[]=[{kind:"saveProject",project:updated}];
    const previousTasks=new Map((old?.tasks||[]).map(t=>[t.id,t]));
    for(const task of updated.tasks||[]){
      const was=previousTasks.get(task.id);
      if(!was || was.title!==task.title || was.done!==task.done || was.order!==task.order)
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
    // Keep task writes and their activity in one non-blocking batch. A separate
    // blocking activity write would briefly make the entire app inert and steal
    // focus from the checklist input after each addition.
    const activity:Activity={id:crypto.randomUUID(),text:`Projeto atualizado: ${updated.name}`,when:new Date().toISOString()};
    setActivities(current=>[activity,...current].slice(0,150));
    commands.push({kind:"appendActivity",activity});
    if(activities.length>=150&&activities[149]?.id)
      commands.push({kind:"deleteActivity",id:activities[149].id!});
    commitCommands(commands,"Projeto atualizado.");
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
    commitCommands(commands,"Entregas do cliente atualizadas.");
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
      setDataReady(true);
      return;
    }
    try {
      const local=localStorage.getItem(storageKey);
      if(local)restoreWorkspace(JSON.parse(local));
      setDemoStorageWarning(false);
    } catch { setDemoStorageWarning(true); }
    setDataReady(true);
  },[restoreWorkspace,initialWorkspace]);

  // Theme is not part of the business-data hydration lifecycle. A new page
  // snapshot must never reset a theme explicitly selected by the user.
  useLayoutEffect(() => {
    if (isDemo) applyTheme(demoTheme);
  },[demoTheme]);

  useEffect(() => {
    if (!isDemo) return;
    const onStorage=(event:StorageEvent)=>{
      if(event.key===themeStorageKey() && isTheme(event.newValue)) setDemoTheme(event.newValue);
    };
    window.addEventListener("storage",onStorage);
    return ()=>window.removeEventListener("storage",onStorage);
  },[]);

  // iOS Safari may scroll behind an overlay even with overflow:hidden.
  // Fix the page at its existing scroll offset; the sidebar nav can still scroll.
  useLayoutEffect(() => {
    if (!mobileOpen) return;
    const mobile = window.matchMedia("(max-width: 820px)");
    if (!mobile.matches) { setMobileOpen(false); return; }
    const root = document.documentElement;
    const body = document.body;
    const previous = {
      position: body.style.position, top: body.style.top, left: body.style.left,
      right: body.style.right, width: body.style.width,
      bodyOverflow: body.style.overflow, rootOverflow: root.style.overflow,
      overscroll: root.style.overscrollBehavior
    };
    const x = window.scrollX;
    const y = window.scrollY;
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = `-${x}px`;
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    const onBreakpointChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileOpen(false);
    };
    mobile.addEventListener("change", onBreakpointChange);
    return () => {
      mobile.removeEventListener("change", onBreakpointChange);
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.overflow = previous.bodyOverflow;
      root.style.overflow = previous.rootOverflow;
      root.style.overscrollBehavior = previous.overscroll;
      const reset = resetScrollAfterMobileNavigation.current;
      resetScrollAfterMobileNavigation.current = false;
      window.scrollTo(reset ? 0 : x, reset ? 0 : y);
    };
  }, [mobileOpen]);

  // The Pages demo preserves its existing browser-only snapshot contract.
  // Firebase never persists a render/effect: business mutations call commands.
  useLayoutEffect(() => {
    if (!dataReady || !isDemo) return;
    const payload={projects,clients:clientList,financeEntries,calendarEvents,
      libraryAssets:libraryAssets.map(asset=>({...asset,preview:undefined})),
      comments,reviewState,activities};
    try {
      localStorage.setItem(storageKey,JSON.stringify({...payload,monthlyRevenue}));
      setDemoStorageWarning(false);
    } catch {setDemoStorageWarning(true);}
  },[projects,clientList,financeEntries,monthlyRevenue,calendarEvents,libraryAssets,comments,reviewState,activities,dataReady]);

  useEffect(() => {
    if (!dataReady) return;
    document.documentElement.setAttribute("data-roteiva-ready", "true");
    window.dispatchEvent(new Event("roteiva:ready"));
  }, [dataReady]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    if (isDemo) {
      setDemoTheme(next);
      writeStoredTheme(themeStorageKey(),next);
    } else onThemeChange?.(next);
  }

  function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "Novo projeto");
    const clientId = Number(form.get("clientId")) || undefined;
    const client = clientList.find(c => c.id === clientId)?.name || "Sem cliente vinculado";
    const selectedDue=readFormDate(form,"due");
    if(!selectedDue.valid){notify("Informe um prazo válido (DD/MM/AAAA) antes de criar o projeto.","error");return;}
    const dueValue=selectedDue.value;
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
      ...(deadline?[{kind:"saveEvent" as const,event:deadline}]:[])],"Projeto criado.");
    setModalOpen(false);
    openProject(projectId);
    logActivity(`Projeto criado: ${name}`);
  }

  function saveClientPhoto(id:number,photo:Client["photo"]){
    const client=clientList.find(item=>item.id===id);
    if(!client)return;
    const updated={...client,photo};
    setClientList(current=>current.map(item=>item.id===id?updated:item));
    commitCommands([{kind:"saveClient",client:updated}],photo?"Foto do cliente atualizada.":"Foto do cliente removida.");
  }
  function addClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "Novo cliente").trim();
    const contact = String(form.get("contact") || "Contato não informado").trim();
    const email = String(form.get("email") || "").trim();
    const typedPhone=String(form.get("phone") || "").trim();
    if(typedPhone&&!validBrazilPhone(typedPhone)){
      event.currentTarget.elements.namedItem('phone') instanceof HTMLInputElement &&
        (event.currentTarget.elements.namedItem('phone') as HTMLInputElement).reportValidity();
      return;
    }
    const phone=typedPhone?phoneDigits(typedPhone):"";
    const type = String(form.get("type") || "Avulso") as ClientType;
    const since = new Date().toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(" de ", " ").replace(".", "");
    const monthlyDeliverables = Math.max(0, Number(form.get("monthlyDeliverables")) || 0);
    const monthlyFee = Math.max(0, parseMoney(String(form.get("monthlyFee") || "0")) || 0);
    const packageTitle = String(form.get("packageTitle") || "").trim();
    const updated: Client = { photo:editingClient?.photo, deliveries: editingClient?.deliveries || [], id: editingClient?.id || newId(), name, contact, email, phone, projects: editingClient?.projects || 0, active: editingClient?.active || 0, color: type === "Recorrente" ? "violet" : "blue", initials: name.slice(0, 2).toUpperCase(), type, since: editingClient?.since || since, monthlyDeliverables:type==="Recorrente"?monthlyDeliverables:0, monthlyFee:type==="Recorrente"?monthlyFee:0, packageTitle:type==="Recorrente"?packageTitle:"" };
    setClientList(current => editingClient ? current.map(c => c.id === updated.id ? updated : c) : [updated, ...current]);
    if (editingClient) {
      setProjects(current => current.map(p => p.clientId === updated.id ? {...p, client: name} : p));
      setFinanceEntries(current => current.map(e => e.clientId === updated.id ? {...e, client: name} : e));
    }
    const commands:WorkspaceCommand[]=[{kind:"saveClient",client:updated}];
    if(editingClient && editingClient.name!==name){
      commands.push(...projects.filter(p=>p.clientId===updated.id).map(project=>({
        kind:"saveProject" as const,project:{...project,client:name},
      })));
      commands.push(...financeEntries.filter(e=>e.clientId===updated.id).map(entry=>({
        kind:"saveFinance" as const,entry:{...entry,client:name},
      })));
    }
    if(!editingClient)onClientCreated?.(updated);
    commitCommands(commands,"Cliente salvo.");
    setClientModalOpen(false); setEditingClient(null);
    logActivity(`Cliente ${editingClient ? "atualizado" : "cadastrado"}: ${name}`);
  }

  function addFinanceEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const project = String(form.get("project") || "").trim() || projects.find(p => p.id === Number(form.get("projectId")))?.name || "Receita avulsa";
    const clientId = Number(form.get("clientId") || 0) || projects.find(p => p.id === Number(form.get("projectId")))?.clientId || undefined;
    const linkedClient = clientList.find((client) => client.id === clientId);
    const client = linkedClient?.name || "Sem cliente vinculado";
    const amountRaw = String(form.get("amount") || "0").trim();
    const amount = parseMoney(amountRaw);
    const status = String(form.get("status") || "A receber") as FinanceEntry["status"];
    const selectedDate=readFormDate(form,"date");
    if(!selectedDate.valid){notify("Informe uma data válida (DD/MM/AAAA) para o lançamento.","error");return;}
    const dateValue=selectedDate.value;
    const entryDate = dateValue ? new Date(`${dateValue}T12:00:00`) : new Date();
    if (!Number.isFinite(entryDate.getTime()) || !Number.isFinite(amount) || amount <= 0) return notify("Informe um valor válido.","error");
    const projectId = Number(form.get("projectId")) || undefined;
    const kind = form.get("kind") === "expense" ? "expense" : "income";
    const updatedEntry: FinanceEntry = { projectId, kind, id: editingFinanceEntry?.id || newId(), project, client, clientId, amount, date: entryDate.toLocaleDateString("pt-BR"), status };
    const savedMessage=editingFinanceEntry?"Lançamento atualizado.":kind==="expense"?"Custo registrado.":"Receita registrada.";
    if (editingFinanceEntry) {
      setFinanceEntries((current) => current.map((entry) => entry.id === editingFinanceEntry.id ? updatedEntry : entry));
      commitCommands([{kind:"saveFinance",entry:updatedEntry}],savedMessage);
    } else {
      const count = Math.max(1, Math.min(24, Number(form.get("installments")) || 1));
      if (Math.round(amount * 100) < count) return notify("O valor não é suficiente para dividir entre as parcelas.","error");
      const parts: FinanceEntry[] = splitInstallments(amount, count, entryDate).map((part,i) => ({...updatedEntry, id: newId(), project: count > 1 ? `${project} · ${i+1}/${count}` : project, ...part, status: i === 0 ? status : "A receber"}));
      setFinanceEntries((current) => [...parts, ...current]);
      commitCommands(parts.map(entry=>({kind:"saveFinance",entry})),savedMessage);
    }
    logActivity(`${kind === "expense" ? "Despesa" : "Receita"} ${editingFinanceEntry ? "atualizada" : "registrada"}: ${project}`);
    setFinanceModalOpen(false);
    setEditingFinanceEntry(null);
  }

  function openFinanceModal(entry: FinanceEntry | null = null) {
    setEditingFinanceEntry(entry); setFinanceKind(entry?.kind || "income");
    setFinanceModalOpen(true);
  }

  function closeFinanceModal() {
    setFinanceModalOpen(false);
    setEditingFinanceEntry(null);
  }

  function deleteFinanceEntry() {
    if (!deletingFinanceEntry) return;
    commitCommands([{kind:"deleteFinance",id:deletingFinanceEntry.id}],"Lançamento excluído.");
    setFinanceEntries((current) => current.filter((entry) => entry.id !== deletingFinanceEntry.id));
    logActivity(`Lançamento excluído: ${deletingFinanceEntry.project}`);
    setDeletingFinanceEntry(null);
  }

  function saveCalendarEvent(draft:CalendarDraft) {
    const {title,date,time,endTime,type,client,projectId}=draft;
    if(!title.trim()||!isValidCivilDate(date)||!Number.isFinite(timeMinutes(time))||(endTime&&!validTimeRange(time,endTime))){
      notify("Confira a data, os horários e o título do compromisso.","error");return;
    }
    if(editingEvent?.autoDeadline && (type!=="Entrega"||editingEvent.projectId!==projectId)){
      notify("Este prazo é automático e precisa manter o tipo e o projeto originais.","warning");return;
    }
    const entry:CalendarEvent={
      id:editingEvent?.id||newId(),autoDeadline:!!editingEvent?.autoDeadline&&type==="Entrega",
      title:title.trim(),date,time,endTime,type,client,projectId,
    };
    const commands:WorkspaceCommand[]=[{kind:"saveEvent",event:entry}];
    setCalendarEvents(current=>(editingEvent?current.map(item=>item.id===entry.id?entry:item):[...current,entry])
      .sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)));
    if(entry.autoDeadline&&entry.projectId) {
      const linked=projects.find(p=>p.id===entry.projectId);
      if(linked){
        const modified:Project={...linked,dueDate:date,
          due:new Date(date+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})};
        setProjects(current=>current.map(p=>p.id===modified.id?modified:p));
        commands.push({kind:"saveProject",project:modified});
      }
    }
    commitCommands(commands,editingEvent?"Compromisso atualizado.":"Compromisso salvo.","Não foi possível salvar o compromisso. Confira sua conexão e tente novamente."); // One atomic transaction.
    logActivity("Compromisso salvo: "+entry.title);
    setEditingEvent(null);setEventModalOpen(false);
    setCalendarFocus(previous=>({date,revision:(previous?.revision||0)+1}));
    changeView("calendar");
  }
  function deleteCalendarEvent(entry:CalendarEvent) {
    if(entry.autoDeadline) {
      notify("Para remover um prazo automático, altere a data de entrega do projeto.","warning");return;
    }
    setDeletingCalendarEvent(entry);
  }
  function confirmDeleteCalendarEvent() {
    if(!deletingCalendarEvent)return;
    const entry=deletingCalendarEvent;
    commitCommands([{kind:"deleteEvent",id:entry.id}],"Compromisso excluído.","Não foi possível excluir o compromisso. Confira sua conexão e tente novamente.");
    setCalendarEvents(current=>current.filter(e=>e.id!==entry.id));
    logActivity("Compromisso excluído: "+entry.title);
    setDeletingCalendarEvent(null);
    setEditingEvent(null);setEventModalOpen(false);
  }

  function uploadAssets(_files: FileList | null, _projectId?: number) {
    notify("O envio de arquivos estará disponível após conectar o Google Drive.","info");
  }

  function applyRoute(next:WorkspaceRoute) {
    setActivityOpen(false);
    setView(next.view);
    setSelectedProject(next.view==="projects" ? next.projectId || null : null);
    setSelectedClient(next.view==="clients" ? next.clientId || null : null);
    setMobileOpen(false);
  }

  function navigateRoute(next:WorkspaceRoute,{replace=false}:{replace?:boolean}={}) {
    if (mobileOpen) resetScrollAfterMobileNavigation.current = true;
    const target=hrefForWorkspaceRoute(next,routeEnvironment);
    if(window.location.pathname+window.location.hash!==target) {
      window.history[replace?"replaceState":"pushState"](null,"",target);
    }
    applyRoute(next);
    onRouteChange?.(next);
    window.scrollTo({top:0,behavior:"auto"});
  }

  function startProject(){if(!isDemo&&view!=="projects")changeView("projects");setModalOpen(true);}
  function changeView(next:View) {
    if(next==="library")setLibraryTarget(null);
    setActivityOpen(false);
    navigateRoute({view:next});
    if(next==="projects"&&query.trim())onSearchProjects?.();
    if(next==="clients"&&query.trim())onSearchClients?.();
  }
  function openProject(id:number) { navigateRoute({view:"projects",projectId:id}); }
  function openClient(id:number) { navigateRoute({view:"clients",clientId:id}); }
  function signOut() {
    // Do not leave a previous account's private record URL in a shared browser.
    window.history.replaceState(null,"",hrefForWorkspaceRoute({view:"overview"},routeEnvironment));
    onLogout?.();
  }

  useEffect(()=>{
    const onNavigation=()=>{
      // popstate/hashchange handler is registered once, so don't rely on a
      // potentially stale mobileOpen closure when deciding the restore target.
      if (document.body.style.position === "fixed" && window.matchMedia("(max-width: 820px)").matches) {
        resetScrollAfterMobileNavigation.current = true;
      }
      const next=routeFromLocation(window.location,routeEnvironment);
      applyRoute(next);
      onRouteChange?.(next);
      window.scrollTo({top:0,behavior:"auto"});
    };
    window.addEventListener("popstate",onNavigation);
    if(routeEnvironment.useHash)window.addEventListener("hashchange",onNavigation);
    return ()=>{
      window.removeEventListener("popstate",onNavigation);
      if(routeEnvironment.useHash)window.removeEventListener("hashchange",onNavigation);
    };
  },[onRouteChange]);

  // Direct links must not display another user's records or leave a broken detail URL.
  useEffect(()=>{
    if(!dataReady)return;
    const route=routeFromLocation(window.location,routeEnvironment);
    if(route.projectId && (isDemo||canValidateProjectLink) && !projects.some(p=>p.id===route.projectId))navigateRoute({view:"projects"},{replace:true});
    if(route.clientId && (isDemo||canValidateClientLink) && !clientList.some(c=>c.id===route.clientId))navigateRoute({view:"clients"},{replace:true});
  },[dataReady,projects,clientList,canValidateProjectLink,canValidateClientLink]);

  const pageTitles: Record<View, [string, string]> = {
    overview: [`Olá, ${firstName}.`, "Aqui está o ritmo da sua produção hoje."],
    projects: ["Projetos", "Acompanhe cada entrega, do briefing à aprovação."],
    clients: ["Clientes", "Relacionamentos, projetos e acessos em um só lugar."],
    reviews: ["Sala de aprovação", "Feedback claro, versões organizadas e decisões registradas."],
    finance: ["Gestão financeira", "Faturamento, recebimentos e visão mensal do seu estúdio."],
    calendar: ["Calendário", "Prazos, gravações, reuniões e entregas em uma única agenda."],
    library: ["Biblioteca", "Centralize arquivos, versões e materiais de todos os projetos."],
    settings: ["Configurações", "Sua identidade profissional, estúdio e preferências."],
  };

  if (!dataReady) return <main className="studio-loading" role="status">Carregando seu estúdio…</main>;

  return (
    <div className={`app-shell app-view-${view}${view==="clients"&&!selectedClient?" app-client-directory":""}`} inert={saving || undefined}>
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="brand-lockup">
          <BrandLogo theme={theme} />
          <AppButton className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X size={18} /></AppButton>
        </div>
        <nav>
          <small className="nav-label">ESPAÇO DE TRABALHO</small>
          {nav.map((item) => {
            const count = item.id === "projects" ? (overviewMetrics?.projectCount ?? projectPage?.total ?? projects.length) : undefined;
            return <AppButton key={item.id} className={view === item.id ? "active" : ""} onClick={() => changeView(item.id)}>
              <AnimatedNavIcon icon={item.icon} hoverIcon={item.hoverIcon} kind={item.id} /><span>{item.label}</span>{count !== undefined && <em>{count}</em>}
            </AppButton>;
          })}
          <AppButton className={view === "calendar" ? "active" : ""} onClick={() => changeView("calendar")}><AnimatedNavIcon icon={CalendarDays} hoverIcon={CalendarCheck2} kind="calendar" /><span>Calendário</span><em>{eventCount ?? calendarEvents.length}</em></AppButton>
          <AppButton className={view === "library" ? "active" : ""} onClick={() => changeView("library")}><AnimatedNavIcon icon={Grid2X2} hoverIcon={LibraryBig} kind="library" /><span>Biblioteca</span></AppButton>
          <AppButton className={view === "settings" ? "active" : ""} onClick={() => changeView("settings")}><AnimatedNavIcon icon={Settings2} hoverIcon={UserRound} kind="settings" /><span>Configurações</span></AppButton>
        </nav>

        {getFeedbackToken&&<AppButton type="button" className="sidebar-feedback-button" onClick={()=>{setMobileOpen(false);setFeedbackOpen(true);}}><MessageCircleHeart size={19} aria-hidden="true"/><span>Enviar feedback</span></AppButton>}
        <div className="sidebar-profile">
          {photoURL ? <img className="profile-photo" src={photoURL} alt="Foto do usuário" referrerPolicy="no-referrer" /> : <span>{firstName.slice(0, 2).toUpperCase()}</span>}<div><b>{firstName}</b><small>{email}</small></div><SidebarAccountMenu key={view} theme={theme} onToggleTheme={toggleTheme} onLogout={onLogout?signOut:undefined}/>
        </div>
      </aside>
      {mobileOpen && <AppButton className="mobile-scrim" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} />}
      {view === "overview" && activityOpen && <ActivityHistoryDrawer activities={activities} onClose={() => setActivityOpen(false)}/>}

      <main className="main">
        <section className="page">
          {isDemo ? <div className="pages-demo-notice" role="note"><b>Modo demonstração</b><span>Explore o Roteiva com dados salvos apenas neste navegador. Entre na sua conta para trabalhar com seus próprios projetos.</span></div> : null}
          <AppButton type="button" className="menu-button page-menu-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menu" aria-expanded={mobileOpen}><Menu size={20} /></AppButton>
          <div className="page-heading">
            <div><span className="eyebrow">ROTEIVA / {view === "overview" ? "PAINEL" : pageTitles[view][0].toUpperCase()}</span><h1>{pageTitles[view][0]}</h1><p>{pageTitles[view][1]}</p></div>
            <div className="heading-actions">
              {isDemo && demoStorageWarning && <p role="alert" className="workspace-save-warning">Não foi possível salvar os dados da demonstração neste navegador.</p>}
              {view === "settings" ? null : view === "clients" ? <AppButton className="primary-button" onClick={() => { setEditingClient(null); setClientModalOpen(true); }}><UserRoundPlus size={17} /> Novo cliente</AppButton>
                : view === "finance" ? <AppButton className="primary-button finance-new-revenue" onClick={() => openFinanceModal()}><Plus size={19} aria-hidden="true"/> Nova receita</AppButton>
                : view === "calendar" ? <AppButton className="primary-button" onClick={() => openEvent()}><Plus size={17} /> Novo compromisso</AppButton>
                : view === "library" ? (isDemo && import.meta.env.VITE_LIBRARY_REVIEW === "true" ? null : <>{(isDemo||import.meta.env.VITE_VIRTUAL_LIBRARY!=='true')&&<AppSelect aria-label="Projeto dos arquivos" value={libraryProject} onValueChange={value=> setLibraryProject(value)}><option value="">Todos os projetos</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</AppSelect>}{isDemo && <label className="primary-button upload-button"><Upload size={17} /> {uploading ? "Enviando…" : "Adicionar arquivos"}<AppInput type="file" disabled multiple onChange={(event) => { uploadAssets(event.target.files, Number(libraryProject) || undefined); event.target.value = ""; }} /></label>}</>)
                : view === "reviews" ? null : <AppButton className="primary-button" onClick={startProject}><Plus size={17} /> Criar projeto</AppButton>}
            </div>
          </div>
          {((view === "projects" && !selectedProject) || (view === "clients" && !selectedClient && (clientPage?.total??clientList.length)>=5 || view === "clients" && !selectedClient && !!query.trim())) && <label className="page-search"><Search size={17}/><AppInput aria-label={view === "projects" ? "Buscar projetos" : "Buscar clientes"} value={query} onChange={e => { const value=e.target.value; setQuery(value); if(value.trim()){ if(view === "projects")onSearchProjects?.(); else onSearchClients?.(); } }} placeholder={view === "projects" ? "Buscar projetos" : "Buscar clientes"}/></label>}
          {view === "settings" && <SettingsPage profile={profile} email={email} photoURL={photoURL} theme={theme} toggleTheme={toggleTheme} onSaveProfile={onSaveProfile} />}
          {view === "overview" && <TodayStudio clients={clientList} projects={projects} entries={financeEntries} events={calendarEvents} activities={activities} onView={changeView} onOpenActivity={() => setActivityOpen(true)} overviewMetrics={overviewMetrics} />}
          {view === "projects" && (selectedProject && projects.some(p => p.id === selectedProject) ? <ProjectDetail key={selectedProject} project={projects.find(p => p.id === selectedProject)!} clients={clientList} entries={financeEntries} assets={libraryAssets} events={calendarEvents} onSave={updateProject} onDeleted={()=>projectDeleted(selectedProject)} onDeleteDemo={()=>projectDeleted(selectedProject)} onBack={() => changeView("projects")} onRevenue={addLinkedRevenue} onEditRevenue={openFinanceModal} onMaterials={(folderId)=>{setLibraryTarget({projectId:selectedProject!,folderId:folderId||"root"});setLibraryProject(String(selectedProject));navigateRoute({view:"library"});}} onEditEvent={(event)=>openEvent(event)} onEvent={(p) => { openEvent(null, p.dueDate); }} onReview={()=>{setReviewStart({clientId:projects.find(p=>p.id===selectedProject)?.clientId,projectId:selectedProject||undefined});changeView("reviews");}} /> : <ProjectsView projects={filtered.map(p => ({...p, files: libraryAssets.filter(a => a.projectId === p.id).length}))}
                  onSaveCover={(id,cover)=>{const project=projects.find(p=>p.id===id);if(project)updateProject({...project,cover});}} statusFilter={statusFilter} setStatusFilter={(status)=>{
                    setStatusFilter(status);
                    onProjectStatus?.(status);
                  }} onOpen={openProject}
                  total={projectPage && !query.trim()?projectPage.total:undefined}
                  hasMore={!!projectPage?.hasMore&&!query.trim()} onMore={onMoreProjects} />)}
          {view === "clients" && (selectedClient && clientList.some(c => c.id === selectedClient) ? <ClientDetail client={clientList.find(c => c.id === selectedClient)!} projects={projects} entries={financeEntries} onBack={() => changeView("clients")} onEdit={(client) => { setEditingClient(client); setClientModalOpen(true); }} onSave={saveClientPackage} onProject={openProject} onReview={()=>{setReviewStart({clientId:selectedClient||undefined});changeView("reviews");}} /> : <ClientDirectory clients={clientList.filter(c => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(query.toLowerCase())).map(c => ({...c, projects: projects.filter(p => p.clientId === c.id).length, active: projects.filter(p => p.clientId === c.id && p.status !== "Aprovado").length}))}
                  onOpen={openClient} onAdd={() => {setEditingClient(null);setClientModalOpen(true);}} onSavePhoto={saveClientPhoto}
                  totalCount={clientPage && !query.trim()?clientPage.total:undefined}
                  recurringCount={clientPage && !query.trim()?clientPage.recurring:undefined}
                  activeProjectsCount={clientPage && !query.trim()?projects.filter(p=>p.status!=="Aprovado" && !!p.clientId).length:undefined}
                  hasMore={!!clientPage?.hasMore&&!query.trim()} onMore={onMoreClients} />)}
          {view === "reviews" && (isDemo ? <StudioReviews /> : <ReviewsDashboard onStartConsumed={consumeReviewStart} clients={clientList} projects={projects} studioName={workspaceName} onLibrary={()=>changeView("library")} startClientId={reviewStart?.clientId} startProjectId={reviewStart?.projectId} />)}
          {view === "finance" && <FinancePanel entries={financeEntries} clients={clientList} onPeriodChange={onFinancePeriodChange} serverBars={financeBars} onAdd={() => openFinanceModal()} onEdit={(entry) => openFinanceModal(entry)} onDelete={setDeletingFinanceEntry} />}
          {view === "calendar" && <CalendarView events={calendarEvents} projects={projects} focusDate={calendarFocus}
            onMonthChange={onCalendarMonthChange} onAdd={date=>openEvent(null,date)}
            onEdit={openEvent} onDelete={deleteCalendarEvent}/>}

          {view === "library" && <LibraryView assets={libraryAssets} query={query} onUpload={(files) => uploadAssets(files, Number(libraryProject) || undefined)} projects={projects} selectedProjectId={Number(libraryProject)||undefined} onSelectProject={setLibraryProject} initialFolder={libraryTarget} />}
        </section>
      </main>

      {modalOpen && (
        <AppModal size="medium" className="rt-project-dialog" onCloseRequest={() => setModalOpen(false)}
          aria-labelledby="project-new-title" aria-describedby="project-new-description">
          <form className="rt-modal__layout project-modal" onSubmit={addProject}>
            <AppModalHeader icon={<ModalFolderPlus size={26}/>} title="Comece uma nova produção" titleId="project-new-title"
              eyebrow="NOVO PROJETO" descriptionId="project-new-description"
              description="Defina o essencial agora. A equipe completa os detalhes depois."
              onClose={() => setModalOpen(false)}/>
            <AppModalBody>
            <AppModalSection>
            <label>Nome do projeto<AppInput name="name" required autoFocus placeholder="Ex.: Campanha Primavera 2027" /></label>
            <div className="form-grid"><label>Cliente cadastrado<AppSelect aria-label="Cliente cadastrado" name="clientId"><option value="">Sem cliente vinculado</option>{[...clientList].sort((a,b) => a.name.localeCompare(b.name, "pt-BR")).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</AppSelect></label><AppDateFormField name="due" label="Prazo"/></div>
            </AppModalSection>
            <AppModalSection heading="Detalhes da produção" icon={<ModalClapperboard size={19}/>}> 
            <label>Modelo de produção<AppSelect aria-label="Modelo de produção" name="template">{Object.keys(projectTemplates).map(t => <option key={t}>{t}</option>)}</AppSelect></label><label>Descrição<AppTextarea name="description" placeholder="Objetivo, formatos e contexto da produção…" /></label>
            </AppModalSection>
            </AppModalBody>
            <AppModalFooter><AppButton type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</AppButton><AppButton variant="primary" type="submit">Criar projeto <ChevronRight size={16} /></AppButton></AppModalFooter>
          </form>
        </AppModal>
      )}
      {clientModalOpen && <ClientFormDialog key={editingClient?.id||"new"} client={editingClient}
        onClose={()=>{setClientModalOpen(false);setEditingClient(null);}} onSubmit={addClient}/>}
      {financeModalOpen && (
        <AppModal size="medium" className="rt-finance-dialog" onCloseRequest={closeFinanceModal}
          aria-labelledby="finance-modal-title" aria-describedby="finance-modal-description">
          <form key={editingFinanceEntry?.id || "new-revenue"} className="rt-modal__layout project-modal finance-modal" onSubmit={addFinanceEntry}>
            <AppModalHeader icon={<ModalWallet size={26}/>} title={editingFinanceEntry ? "Atualize o lançamento" : "Registre uma entrada ou custo"} titleId="finance-modal-title"
              eyebrow={editingFinanceEntry ? "EDITAR LANÇAMENTO" : "NOVO LANÇAMENTO"} descriptionId="finance-modal-description"
              description={editingFinanceEntry ? "Revise os dados e salve para atualizar os indicadores financeiros." : "Escolha a data para registrar a entrada ou o custo no mês correspondente."}
              onClose={closeFinanceModal}/>
            <AppModalBody>
            <AppModalSection>
            <label>Tipo de lançamento<AppSelect aria-label="Tipo de lançamento" name="kind" value={financeKind} onValueChange={value=> setFinanceKind(value as "income" | "expense")}><option value="income">Receita</option><option value="expense">Despesa / custo de produção</option></AppSelect></label><label>Projeto vinculado<AppSelect aria-label="Projeto vinculado" name="projectId" defaultValue={editingFinanceEntry?.projectId || selectedProject || ""}><option value="">Sem projeto vinculado</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</AppSelect></label><label>Trabalho ou projeto <small className="field-hint">Opcional</small><AppInput name="project" autoFocus defaultValue={editingFinanceEntry?.project === "Receita avulsa" ? "" : editingFinanceEntry?.project || ""} placeholder="Ex.: Filme institucional — Corte final" /></label>
            </AppModalSection>
            <AppModalSection heading="Valor e previsão" icon={<ModalCreditCard size={19}/>}> 
            <div className="form-grid"><label>Cliente cadastrado<AppSelect aria-label="Cliente cadastrado" name="clientId" defaultValue={editingFinanceEntry?.clientId || projects.find(p => p.id === selectedProject)?.clientId || ""}><option value="">Sem cliente vinculado</option>{[...clientList].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((client) => <option key={client.id} value={client.id}>{client.name} · {client.type}</option>)}</AppSelect><small className="field-hint">{clientList.length ? `${clientList.length} ${clientList.length === 1 ? "cliente disponível" : "clientes disponíveis"}` : "Cadastre clientes para vinculá-los às receitas"}</small></label><label>Valor do trabalho<MoneyInput name="amount" required defaultValue={editingFinanceEntry?.amount} /></label></div>
            <div className="form-grid"><AppDateFormField key={editingFinanceEntry?.id||"new"} name="date" label={financeKind==="expense"?"Vencimento do pagamento":"Previsão de recebimento"} initialValue={editingFinanceEntry?editingFinanceEntry.date.split("/").reverse().join("-"):""}/><label>Situação<AppSelect aria-label="Situação" name="status" defaultValue={editingFinanceEntry?.status || "A receber"}><option value="Recebido">{financeKind === "expense" ? "Pago" : "Recebido"}</option><option value="A receber">{financeKind === "expense" ? "A pagar" : "A receber"}</option></AppSelect></label></div>
            </AppModalSection>
            <AppModalSection heading="Forma de pagamento" icon={<ModalReceiptText size={19}/>}> 
            <label>Parcelamento<AppSelect aria-label="Parcelamento" name="installments" defaultValue="1" disabled={!!editingFinanceEntry}>{[1,2,3,4,5,6,10,12,24].map(n => <option key={n} value={n}>{n === 1 ? "Pagamento único" : `${n} parcelas mensais (dividir o valor total)`}</option>)}</AppSelect><small className="field-hint">Ao parcelar, o valor informado é dividido entre os meses. Cada parcela pode ser editada depois.</small></label>
            </AppModalSection>
            </AppModalBody>
            <AppModalFooter><AppButton type="button" variant="secondary" onClick={closeFinanceModal}>Cancelar</AppButton><AppButton variant="primary" type="submit">{editingFinanceEntry ? "Salvar alterações" : "Adicionar lançamento"} <ArrowUpRight size={16} /></AppButton></AppModalFooter>
          </form>
        </AppModal>
      )}
      {feedbackOpen&&getFeedbackToken&&<FeedbackDialog getToken={getFeedbackToken} onClose={()=>setFeedbackOpen(false)} />}
      {deletingFinanceEntry && <ConfirmationDialog
        title="Remover este lançamento?"
        description={deletingFinanceEntry.project+", no valor de "+formatCurrency(deletingFinanceEntry.amount)+", será removido do financeiro e dos indicadores do mês."}
        confirmLabel="Excluir lançamento" cancelLabel="Manter lançamento"
        onCancel={() => setDeletingFinanceEntry(null)} onConfirm={deleteFinanceEntry}/>}
      {eventModalOpen && <CalendarEventDialog key={editingEvent?.id||eventDate||"new-event"}
        editing={editingEvent} date={eventDate} projects={projects} clients={clientList}
        preferredProjectId={selectedProject} events={calendarEvents}
        onSave={saveCalendarEvent} onCancel={()=>{setEventModalOpen(false);setEditingEvent(null);}}
        onDelete={deleteCalendarEvent}/>}
      {deletingCalendarEvent&&<ConfirmationDialog key={deletingCalendarEvent.id}
        title="Excluir compromisso?"
        description={"“"+deletingCalendarEvent.title+"” será removido permanentemente do calendário."}
        confirmLabel="Excluir compromisso" cancelLabel="Manter compromisso"
        onCancel={()=>setDeletingCalendarEvent(null)}
        onConfirm={confirmDeleteCalendarEvent}/>}
      <nav className="mobile-bottom-nav" aria-label="Navegação no celular">
        <AppButton className={view === "overview" ? "active" : ""} aria-current={view === "overview" ? "page" : undefined} onClick={()=>changeView("overview")}><LayoutDashboard size={20}/><span>Início</span></AppButton>
        <AppButton className={view === "projects" ? "active" : ""} aria-current={view === "projects" ? "page" : undefined} onClick={()=>changeView("projects")}><Folder size={20}/><span>Projetos</span></AppButton>
        <AppButton className={view === "calendar" ? "active" : ""} aria-current={view === "calendar" ? "page" : undefined} onClick={()=>changeView("calendar")}><CalendarDays size={20}/><span>Agenda</span></AppButton>
        <AppButton className={view === "finance" ? "active" : ""} aria-current={view === "finance" ? "page" : undefined} onClick={()=>changeView("finance")}><WalletCards size={20}/><span>Financeiro</span></AppButton>
        <AppButton className={["clients","reviews","library"].includes(view) ? "active" : ""} aria-label="Mais opções de navegação" onClick={()=>setMobileOpen(true)}><Menu size={20}/><span>Mais</span></AppButton>
      </nav>
    </div>
  );
}

function Overview({ projects, setView, onOpenProject }: { projects: Project[]; setView: (view: View) => void; onOpenProject:(id:number)=>void }) {
  return <>
    <div className="dashboard-grid">
      <div className="panel projects-panel">
        <div className="panel-head"><div><span>EM ANDAMENTO</span><h2>Projetos recentes</h2></div><AppButton onClick={() => setView("projects")}>Ver todos <ChevronRight size={15} /></AppButton></div>
        <div className="project-list">{projects.slice(0, 4).map((project) => <ProjectRow project={project} key={project.id} onOpen={() => onOpenProject(project.id)} />)}{!projects.length && <div className="empty-state compact"><FolderOpen size={27} /><h3>Seu espaço está pronto</h3><p>Crie o primeiro projeto para começar a organizar sua produção.</p><AppButton className="primary-button" onClick={() => setView("projects")}>Começar agora</AppButton></div>}</div>
      </div>

    </div>

  </>;
}

function ProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const virtual= !isDemo && import.meta.env.VITE_VIRTUAL_LIBRARY === "true";
  const actualCount=useProjectFileCount(project.id,virtual);
  const files=virtual?actualCount:project.files;
  return <AppButton className="project-row" onClick={onOpen}>
    <BrandAvatar initials={project.initials} color={project.color} /><div className="project-name"><b>{project.name}</b><small>{project.client} · {files??"…"} {files===1?"arquivo":"arquivos"}</small></div>
    <StatusBadge status={project.status} /><div className="progress-cell"><span><i style={{ width: `${project.progress}%` }} /></span><small>{project.progress}%</small></div>
    <div className="due-cell"><small>Prazo</small><b>{project.due}</b></div><ChevronRight size={16} />
  </AppButton>;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function assetIcon(kind: AssetKind) {
  return kind === "Vídeo" ? FileVideo : kind === "Imagem" ? ImageIcon : kind === "Áudio" ? FileAudio : FileText;
}

function LibraryView({ assets, query, onUpload, projects, selectedProjectId, onSelectProject, initialFolder }: { assets: LibraryAsset[]; query: string; onUpload: (files: FileList | null) => void; projects: readonly Project[]; selectedProjectId?:number; onSelectProject:(id:string)=>void; initialFolder?:{projectId:number;folderId:string}|null }) {
  const dropboxEnabled=import.meta.env.VITE_DROPBOX_ENABLED==='true';
  const [provider,setProvider]=useState<'google_drive'|'dropbox'>(()=>dropboxEnabled&&
    new URLSearchParams(window.location.search).has('dropbox')?'dropbox':'google_drive');
  const [kind, setKind] = useState<AssetKind | "Todos">("Todos");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState("recent");
  const filteredAssets = assets.filter((asset) => (kind === "Todos" || asset.kind === kind) && `${asset.name} ${asset.project}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => sort === "name" ? a.name.localeCompare(b.name, "pt-BR") : b.id - a.id);
  const totalMb = assets.reduce((total, asset) => total + Number(asset.size.replace(",", ".").replace(/[^0-9.]/g, "")) * (asset.size.includes("KB") ? .001 : 1), 0);
  const kinds: (AssetKind | "Todos")[] = ["Todos", "Vídeo", "Imagem", "Áudio", "Documento"];

  if (isDemo && import.meta.env.VITE_LIBRARY_REVIEW === "true") return <LibraryReviewDemo />;
  if (!isDemo && import.meta.env.VITE_VIRTUAL_LIBRARY === 'true') return <VirtualLibrary projects={projects} selectedProjectId={selectedProjectId} onSelectProject={onSelectProject} initialFolder={initialFolder}/>;
  return <div className="library-layout">
    {!isDemo && (!useEmulators || (import.meta.env.MODE === "emulator" && new URLSearchParams(window.location.search).get("driveE2E") === "1")) && <>
      {dropboxEnabled&&<nav className="storage-providers" aria-label="Provedor de armazenamento" role="tablist">
        <AppButton type="button" role="tab" aria-selected={provider==='google_drive'} aria-controls="storage-drive-panel"
          className={provider==='google_drive'?'active':''}
          onClick={()=>setProvider('google_drive')}>
          <img src={googleDriveMark} alt="" aria-hidden="true" width="20" height="20"/>
          <span>Google Drive</span>
        </AppButton>
        <AppButton type="button" role="tab" aria-selected={provider==='dropbox'} aria-controls="storage-dropbox-panel"
          className={provider==='dropbox'?'active':''}
          onClick={()=>setProvider('dropbox')}>
          <img src={dropboxMark} alt="" aria-hidden="true" width="20" height="20"/>
          <span>Dropbox</span>
        </AppButton>
      </nav>}
      <div id="storage-drive-panel" role="tabpanel" hidden={dropboxEnabled&&provider!=='google_drive'}>
        <DriveConnectionPanel projects={projects} selectedProjectId={selectedProjectId} onSelectProject={onSelectProject}
          />
      </div>
      {dropboxEnabled&&<div id="storage-dropbox-panel" role="tabpanel" hidden={provider!=='dropbox'}>
        <DropboxConnectionPanel projects={projects} selectedProjectId={selectedProjectId} onSelectProject={onSelectProject}
          />
      </div>}
    </>}
    {(isDemo || assets.length>0) && <>
    <div className="library-summary"><article><span><HardDrive size={18} /></span><div><small>ARQUIVOS</small><b>{assets.length}</b></div></article><article><span><Film size={18} /></span><div><small>ARMAZENAMENTO</small><b>{totalMb >= 1024 ? `${(totalMb / 1024).toFixed(1)} GB` : `${Math.round(totalMb)} MB`}</b></div></article><article><span><CalendarDays size={18} /></span><div><small>ADICIONADOS ESTE MÊS</small><b>{assets.filter(a => toISOAdded(a.addedAt).slice(0,7) === new Date().toLocaleDateString("en-CA").slice(0,7)).length}</b></div></article></div>
    <section className="panel library-panel">
      <div className="library-toolbar"><div className="filter-pills">{kinds.map((item) => <AppButton key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>{item}</AppButton>)}</div><div><AppSelect aria-label="Ordenar arquivos" value={sort} onValueChange={value=> setSort(value)}><option value="recent">Mais recentes</option><option value="name">Nome A–Z</option></AppSelect><AppButton className={`view-button ${layout === "grid" ? "active" : ""}`} onClick={() => setLayout("grid")}><Grid2X2 size={16} /></AppButton><AppButton className={`view-button ${layout === "list" ? "active" : ""}`} onClick={() => setLayout("list")}><ListFilter size={16} /></AppButton></div></div>
      <div className={`asset-collection ${layout}`}>{filteredAssets.map((asset) => { const Icon = assetIcon(asset.kind); return <article className="asset-card" key={asset.id}><div className={`asset-preview ${asset.color}`} style={asset.kind === "Imagem" && asset.url ? { backgroundImage: `url(${asset.url})` } : undefined}><Icon size={30} /><span>{asset.kind.toUpperCase()}</span></div><div className="asset-copy"><Icon size={17} /><div><b title={asset.name}>{asset.url ? <a href={asset.url} target="_blank" rel="noreferrer">{asset.name}</a> : asset.name}</b><small>{asset.project} · V{asset.version || 1}</small></div><span>{asset.size}</span><time>{asset.addedAt}</time><span>{asset.url ? <a href={`${asset.url}&download=1`} className="secondary-button" download>Baixar</a> : <small>Reenvie o arquivo</small>}</span></div></article>; })}</div>
      {!filteredAssets.length && <div className="library-empty"><FolderOpen size={34} /><h3>Nenhum arquivo encontrado</h3><p>Altere o filtro ou adicione novos materiais à biblioteca.</p></div>}
      <label className="library-drop"><Upload size={22} /><b>Clique para enviar arquivos</b><span>Vídeo, áudio, imagens, PDFs e documentos</span><AppInput type="file" multiple onChange={(event) => { onUpload(event.target.files); event.target.value = ""; }} /></label>
    </section>
    </>}
  </div>;
}

