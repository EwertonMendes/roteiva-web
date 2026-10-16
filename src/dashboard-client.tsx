"use client";

import {
  BadgeDollarSign, Bell, CalendarCheck2, CalendarDays, Check, ChevronDown,
  ChevronRight, CirclePause, CirclePlay, Clock3, Command, Film, Folder, FolderOpen,
  Grid2X2, LayoutDashboard, LibraryBig, ListFilter, Menu, PanelsTopLeft,
  ArrowUpRight, Building2, Moon, UserRound,
  MoreHorizontal, Pencil, Plus, ReceiptText, Search, Sparkles, Sun, Trash2,
  UserRoundPlus, Users, WalletCards, X, Upload, Image as ImageIcon,
  FileVideo, FileAudio, FileText, HardDrive, ChevronLeft, type LucideIcon,
} from "lucide-react";
import { ProjectDetail, ClientDetail, TodayStudio, StudioReviews, WorkspaceTools, FinancePanel, projectTemplates } from "./studio-features";
import { validTimeRange, overlaps, eventRange, eventDuration } from "./studio-calendar";
import { toISO as toISOAdded, parseMoney, splitInstallments } from "./studio-finance";
import { FormEvent, useEffect, useMemo, useState, useCallback } from "react";

export type View = "overview" | "projects" | "clients" | "reviews" | "finance" | "calendar" | "library";
export type Status = "Em produção" | "Em aprovação" | "Ajustes" | "Aprovado";
export type Project = { clientId?: number; dueDate?: string; description?: string; tasks?: { id: number; title: string; done: boolean }[]; template?: string;  id: number; name: string; client: string; status: Status; due: string; progress: number; files: number; color: string; initials: string };
type ClientType = "Recorrente" | "Avulso";
export type Client = { deliveries?: { id:number; title:string; month:string; done:boolean }[];  packageTitle?: string; monthlyDeliverables?: number; monthlyFee?: number;  id: number; name: string; contact: string; email?: string; phone?: string; projects: number; active: number; color: string; initials: string; type: ClientType; since: string };
export type FinanceEntry = { projectId?: number; kind?: "income" | "expense";  id: number; project: string; client: string; clientId?: number; amount: number; date: string; status: "Recebido" | "A receber" };
export type CalendarEvent = { endTime?: string; autoDeadline?: boolean; projectId?: number;  id: number; title: string; date: string; time: string; type: "Produção" | "Entrega" | "Reunião" | "Aprovação"; client: string };
type AssetKind = "Vídeo" | "Imagem" | "Áudio" | "Documento";
export type LibraryAsset = { fileKey?: string; url?: string; mimeType?: string; projectId?: number; version?: number;  id: number; name: string; kind: AssetKind; size: string; addedAt: string; project: string; color: string; preview?: string };

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
  const labels: Record<Status, string> = { "Em produção": "Em produção", "Em aprovação": "Em aprovação", Ajustes: "Ajustes pedidos", Aprovado: "Aprovado" };
  return <span className={`status status-${status.toLowerCase().replaceAll(" ", "-")}`}>{labels[status]}</span>;
}

function BrandAvatar({ initials, color, large = false }: { initials: string; color: string; large?: boolean }) {
  return <span className={`brand-avatar ${color} ${large ? "large" : ""}`}>{initials}</span>;
}

export default function DashboardClient({ firstName, email }: { firstName: string; email: string }) {
  const [view, setView] = useState<View>("overview");
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
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [selectedClient, setSelectedClient] = useState<number | null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [eventDate, setEventDate] = useState("");
  const [eventDraft, setEventDraft] = useState({date:"",time:"09:00",endTime:""});
  const [eventError, setEventError] = useState("");
  const [saveStatus, setSaveStatus] = useState("Carregando dados…");
  const [libraryProject, setLibraryProject] = useState("");
  const [uploading, setUploading] = useState(false);
  const storageKey = "roteiva-pages-demo-workspace-v1";
  const [activities, setActivities] = useState<{text: string; when: string}[]>([]);
  const workspace = { projects, clients: clientList, financeEntries, monthlyRevenue, calendarEvents, libraryAssets: libraryAssets.map((asset) => ({ ...asset, preview: undefined })), comments, reviewState, activities };
  function logActivity(text: string) { setActivities(current => [{text, when: new Date().toISOString()}, ...current].slice(0, 150)); }
  const restoreWorkspace = useCallback((data: Partial<typeof workspace>) => {
    setProjects(data.projects || []); setClientList(data.clients || []); setFinanceEntries(data.financeEntries || []);
    setCalendarEvents(data.calendarEvents || []);
    setLibraryAssets(data.libraryAssets || []); setComments(data.comments || []); setReviewState(data.reviewState || "pending"); setActivities(data.activities || []);
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
    if (old?.dueDate !== updated.dueDate || old?.name !== updated.name) {
      setCalendarEvents(current => {
        const isDeadline = (e: CalendarEvent) => e.projectId === updated.id && e.type === "Entrega" && (e.autoDeadline || e.title === `Entrega — ${old?.name}`);
        const existing = current.find(isDeadline);
        const rest = current.filter(e => !isDeadline(e));
        return updated.dueDate ? [...rest, {id:existing?.id || Date.now(), autoDeadline:true, projectId:updated.id, title:`Entrega — ${updated.name}`, date:updated.dueDate, time:existing?.time || "18:00", type:"Entrega", client:updated.client}] : rest;
      });
    }
    logActivity(`Projeto atualizado: ${updated.name}`); notify("Projeto salvo");
  }
  function saveClientPackage(client: Client) {
    setClientList(current => current.map(c => c.id === client.id ? client : c));
    logActivity(`Entregas atualizadas: ${client.name}`);
  }
  function addLinkedRevenue(project: Project) { openFinanceModal(); setSelectedProject(project.id); }


  const filtered = useMemo(() => projects.filter((project) => {
    const matchText = `${project.name} ${project.client}`.toLowerCase().includes(query.toLowerCase());
    return matchText && (statusFilter === "Todos" || project.status === statusFilter);
  }), [projects, query, statusFilter]);

  useEffect(() => {
    const saved = localStorage.getItem("roteiva-theme");
    const preferred = saved === "dark" || saved === "light"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(preferred);
    document.documentElement.setAttribute("data-theme", preferred);
    try {
      const local = localStorage.getItem(storageKey);
      if (local) restoreWorkspace(JSON.parse(local));
      setSaveStatus("Demonstração · dados somente neste navegador");
    } catch {
      setSaveStatus("Demonstração · armazenamento local indisponível");
    }
    setDataReady(true);
  }, [restoreWorkspace]);

  useEffect(() => {
    if (!dataReady) return;
    const payload = {
      projects, clients: clientList, financeEntries, monthlyRevenue, calendarEvents,
      libraryAssets: libraryAssets.map(asset => ({...asset, preview: undefined})),
      comments, reviewState, activities,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
      setSaveStatus("Demonstração · salvo neste navegador");
    } catch {
      setSaveStatus("Falha ao salvar · exporte seus dados");
    }
  }, [projects, clientList, financeEntries, monthlyRevenue, calendarEvents, libraryAssets, comments, reviewState, activities, dataReady]);

  useEffect(() => {
    if (!dataReady) return;
    document.documentElement.setAttribute("data-roteiva-ready", "true");
    window.dispatchEvent(new Event("roteiva:ready"));
  }, [dataReady]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("roteiva-theme", next);
    document.documentElement.setAttribute("data-theme", next);
    notify(next === "dark" ? "Modo escuro ativado" : "Modo claro ativado");
  }

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

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
    const tasks = (projectTemplates[template] || []).map((title, i) => ({ id: Date.now() + i, title, done: false }));
    const projectId = Date.now();
    setProjects((current) => [{ id: projectId, name, client, clientId, dueDate: dueValue, description, tasks, template, status: "Em produção", due, progress: 0, files: 0, color: "blue", initials: client.slice(0, 2).toUpperCase() }, ...current]);
    if (dueValue) setCalendarEvents((current) => [{ id: Date.now() + 1, projectId, autoDeadline:true, title: `Entrega — ${name}`, date: dueValue, time: "18:00", type: "Entrega", client }, ...current]);
    setModalOpen(false);
    setView("projects"); setSelectedProject(projectId);
    logActivity(`Projeto criado: ${name}`);
    notify("Projeto criado com sucesso");
  }

  function addClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "Novo cliente").trim();
    const contact = String(form.get("contact") || "Contato não informado").trim();
    const email = String(form.get("email") || "").trim();
    const phone = String(form.get("phone") || "").trim();
    const type = String(form.get("type") || "Avulso") as ClientType;
    const since = new Date().toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(" de ", " ").replace(".", "");
    const monthlyDeliverables = Math.max(0, Number(form.get("monthlyDeliverables")) || 0);
    const monthlyFee = Math.max(0, parseMoney(String(form.get("monthlyFee") || "0")) || 0);
    const packageTitle = String(form.get("packageTitle") || "").trim();
    const updated: Client = { deliveries: editingClient?.deliveries || [], id: editingClient?.id || Date.now(), name, contact, email, phone, projects: editingClient?.projects || 0, active: 0, color: type === "Recorrente" ? "violet" : "blue", initials: name.slice(0, 2).toUpperCase(), type, since: editingClient?.since || since, monthlyDeliverables, monthlyFee, packageTitle };
    setClientList(current => editingClient ? current.map(c => c.id === updated.id ? updated : c) : [updated, ...current]);
    if (editingClient) {
      setProjects(current => current.map(p => p.clientId === updated.id ? {...p, client: name} : p));
      setFinanceEntries(current => current.map(e => e.clientId === updated.id ? {...e, client: name} : e));
    }
    setClientModalOpen(false); setEditingClient(null);
    logActivity(`Cliente ${editingClient ? "atualizado" : "cadastrado"}: ${name}`);
    notify("Cliente salvo com sucesso");
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
    const dateValue = String(form.get("date") || "");
    const entryDate = dateValue ? new Date(`${dateValue}T12:00:00`) : new Date();
    if (!Number.isFinite(entryDate.getTime()) || !Number.isFinite(amount) || amount <= 0) return notify("Informe um valor válido");
    const projectId = Number(form.get("projectId")) || undefined;
    const kind = form.get("kind") === "expense" ? "expense" : "income";
    const updatedEntry: FinanceEntry = { projectId, kind, id: editingFinanceEntry?.id || Date.now(), project, client, clientId, amount, date: entryDate.toLocaleDateString("pt-BR"), status };
    if (editingFinanceEntry) {
      setFinanceEntries((current) => current.map((entry) => entry.id === editingFinanceEntry.id ? updatedEntry : entry));
    } else {
      const count = Math.max(1, Math.min(24, Number(form.get("installments")) || 1));
      if (Math.round(amount * 100) < count) return notify("Valor insuficiente para dividir em parcelas");
      const parts: FinanceEntry[] = splitInstallments(amount, count, entryDate).map((part,i) => ({...updatedEntry, id: Date.now() * 1000 + i, project: count > 1 ? `${project} · ${i+1}/${count}` : project, ...part, status: i === 0 ? status : "A receber"}));
      setFinanceEntries((current) => [...parts, ...current]);
    }
    logActivity(`${kind === "expense" ? "Despesa" : "Receita"} ${editingFinanceEntry ? "atualizada" : "registrada"}: ${project}`);
    setFinanceModalOpen(false);
    setEditingFinanceEntry(null);
    notify(editingFinanceEntry ? "Lançamento atualizado com sucesso" : kind === "expense" ? "Custo registrado no financeiro" : linkedClient ? `Receita vinculada a ${linkedClient.name}` : "Receita adicionada sem cliente vinculado");
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
    setFinanceEntries((current) => current.filter((entry) => entry.id !== deletingFinanceEntry.id));
    logActivity(`Lançamento excluído: ${deletingFinanceEntry.project}`);
    setDeletingFinanceEntry(null);
    notify("Receita excluída e indicadores atualizados");
  }

  function addCalendarEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "Novo compromisso").trim();
    const date = String(form.get("date") || "");
    const time = String(form.get("time") || "09:00");
    const endTime = String(form.get("endTime") || "");
    if (!validTimeRange(time,endTime)) { setEventError("O término precisa ser depois do início, no mesmo dia."); return; }
    const type = String(form.get("type") || "Produção") as CalendarEvent["type"];
    const client = String(form.get("client") || "Interno").trim();
    if (!date) return notify("Escolha a data do compromisso");
    const entry: CalendarEvent = { autoDeadline:editingEvent?.autoDeadline && type === "Entrega", id: editingEvent?.id || Date.now(), title, date, time, endTime, type, client, projectId: Number(form.get("projectId")) || undefined };
    setCalendarEvents(current => (editingEvent ? current.map(e => e.id === entry.id ? entry : e) : [...current, entry]).sort((a,b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)));
    if (entry.autoDeadline && entry.projectId) {
      setProjects(current => current.map(p => p.id === entry.projectId ? {...p,dueDate:date,due:new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})} : p));
    }
    logActivity(`Compromisso salvo: ${title}`); setEditingEvent(null);
    setEventModalOpen(false);
    setView("calendar");
    notify("Compromisso adicionado ao calendário");
  }

  function uploadAssets(_files: FileList | null, _projectId?: number) {
    notify("Envio de arquivos ficará disponível após a integração com Google Drive.");
  }

  function changeView(next: View) {
    setSelectedProject(null); setSelectedClient(null);
    setView(next);
    setMobileOpen(false);
    window.scrollTo({top:0,behavior:"auto"});
  }

  const pageTitles: Record<View, [string, string]> = {
    overview: [`Olá, ${firstName}.`, "Aqui está o ritmo da sua produção hoje."],
    projects: ["Projetos", "Acompanhe cada entrega, do briefing à aprovação."],
    clients: ["Clientes", "Relacionamentos, projetos e acessos em um só lugar."],
    reviews: ["Sala de aprovação", "Feedback claro, versões organizadas e decisões registradas."],
    finance: ["Gestão financeira", "Faturamento, recebimentos e visão mensal do seu estúdio."],
    calendar: ["Calendário", "Prazos, gravações, reuniões e entregas em uma única agenda."],
    library: ["Biblioteca", "Centralize arquivos, versões e materiais de todos os projetos."],
  };

  if (!dataReady) return <main className="studio-loading" role="status">Carregando seu estúdio…</main>;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="brand-lockup">
          <img src={theme === "light" ? "roteiva-logo-black.png" : "roteiva-logo-white.png"} alt="Roteiva" />
          <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X size={18} /></button>
        </div>
        <nav>
          <small className="nav-label">ESPAÇO DE TRABALHO</small>
          {nav.map((item) => {
            const count = item.id === "projects" ? projects.length : item.id === "reviews" ? projects.filter((project) => project.status === "Em aprovação").length : undefined;
            return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => changeView(item.id)}>
              <AnimatedNavIcon icon={item.icon} hoverIcon={item.hoverIcon} kind={item.id} /><span>{item.label}</span>{count !== undefined && <em>{count}</em>}
            </button>;
          })}
          <small className="nav-label second">FERRAMENTAS</small>
          <button className={view === "calendar" ? "active" : ""} onClick={() => changeView("calendar")}><AnimatedNavIcon icon={CalendarDays} hoverIcon={CalendarCheck2} kind="calendar" /><span>Calendário</span><em>{calendarEvents.length}</em></button>
          <button className={view === "library" ? "active" : ""} onClick={() => changeView("library")}><AnimatedNavIcon icon={Grid2X2} hoverIcon={LibraryBig} kind="library" /><span>Biblioteca</span><em>{libraryAssets.length}</em></button>
        </nav>
        <div className="storage-card">
          <div><span><Sparkles size={15} /> Roteiva Studio</span><b>{libraryAssets.length} arquivos</b></div>
          <p>Seu espaço de produção</p>
          <small className="sync-status" role="status">{saveStatus}</small>
        </div>
        <div className="sidebar-profile">
          <span>{firstName.slice(0, 2).toUpperCase()}</span><div><b>{firstName}</b><small>{email}</small></div><MoreHorizontal size={18} />
        </div>
      </aside>
      {mobileOpen && <button className="mobile-scrim" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} />}

      <main className="main">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menu" aria-expanded={mobileOpen}><Menu size={20} /></button>
          <div className="workspace-switch"><span className="sync-dot">R</span><b>Roteiva Studio</b><ChevronDown size={14} /></div>
          <label className="global-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar projetos, clientes ou arquivos" /><kbd><Command size={11} /> K</kbd></label>
          <div className="top-actions"><button className="icon-button" title="Ver atividades" aria-label="Ver atividades" onClick={() => { changeView("overview"); notify(activities[0]?.text || "Nenhuma atividade ainda"); }}><Bell size={18} /></button><button className="icon-button theme-toggle" onClick={toggleTheme} aria-label={theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"} title={theme === "light" ? "Modo escuro" : "Modo claro"}>{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}</button><button className="primary-button" onClick={() => setModalOpen(true)}><Plus size={17} /> Novo projeto</button></div>
        </header>

        <section className="page">
          <div className="pages-demo-notice" role="note"><b>Modo demonstração</b><span>Projetos, clientes, agenda e financeiro ficam salvos apenas neste navegador. Sem login, sincronização, uploads ou links públicos de aprovação.</span></div>
          <div className="page-heading">
            <div><span className="eyebrow">ROTEIVA / {view === "overview" ? "PAINEL" : pageTitles[view][0].toUpperCase()}</span><h1>{pageTitles[view][0]}</h1><p>{pageTitles[view][1]}</p></div>
            <div className="heading-actions">
              <WorkspaceTools workspace={workspace} status={saveStatus} onNotify={notify} />
              {view === "clients" ? <button className="primary-button" onClick={() => { setEditingClient(null); setClientModalOpen(true); }}><UserRoundPlus size={17} /> Novo cliente</button>
                : view === "finance" ? <button className="primary-button" onClick={() => openFinanceModal()}><Plus size={17} /> Nova receita</button>
                : view === "calendar" ? <button className="primary-button" onClick={() => openEvent()}><Plus size={17} /> Novo compromisso</button>
                : view === "library" ? <><select aria-label="Projeto dos arquivos" value={libraryProject} onChange={e => setLibraryProject(e.target.value)}><option value="">Sem projeto</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><label className="primary-button upload-button"><Upload size={17} /> {uploading ? "Enviando…" : "Adicionar arquivos"}<input type="file" disabled multiple onChange={(event) => { uploadAssets(event.target.files, Number(libraryProject) || undefined); event.target.value = ""; }} /></label></>
                : <button className="primary-button" onClick={() => setModalOpen(true)}><Plus size={17} /> Criar projeto</button>}
            </div>
          </div>
          {view === "overview" && <><TodayStudio clients={clientList} projects={projects} entries={financeEntries} events={calendarEvents} activities={activities} onView={changeView} /><Overview projects={projects} setView={changeView} /></>}
          {view === "projects" && (selectedProject && projects.some(p => p.id === selectedProject) ? <ProjectDetail project={projects.find(p => p.id === selectedProject)!} clients={clientList} entries={financeEntries} assets={libraryAssets} events={calendarEvents} onSave={updateProject} onBack={() => setSelectedProject(null)} onRevenue={addLinkedRevenue} onUpload={uploadAssets} onEvent={(p) => { openEvent(null, p.dueDate); }} uploading={uploading} /> : <ProjectsView projects={filtered.map(p => ({...p, files: libraryAssets.filter(a => a.projectId === p.id).length}))} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onOpen={(id)=>{setSelectedProject(id);window.scrollTo({top:0,behavior:"auto"});}} />)}
          {view === "clients" && (selectedClient && clientList.some(c => c.id === selectedClient) ? <ClientDetail client={clientList.find(c => c.id === selectedClient)!} projects={projects} entries={financeEntries} onBack={() => setSelectedClient(null)} onEdit={(client) => { setEditingClient(client); setClientModalOpen(true); }} onSave={saveClientPackage} onProject={(id) => { setSelectedProject(id); setView("projects"); }} /> : <ClientsView clients={clientList.filter(c => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(query.toLowerCase())).map(c => ({...c, projects: projects.filter(p => p.clientId === c.id).length, active: projects.filter(p => p.clientId === c.id && p.status !== "Aprovado").length}))} onOpen={(id)=>{setSelectedClient(id);window.scrollTo({top:0,behavior:"auto"});}} onAdd={() => { setEditingClient(null); setClientModalOpen(true); }} />)}
          {view === "reviews" && <StudioReviews />}
          {view === "finance" && <FinancePanel entries={financeEntries} clients={clientList} onAdd={() => openFinanceModal()} onEdit={(entry) => openFinanceModal(entry)} onDelete={setDeletingFinanceEntry} />}
          {view === "calendar" && <CalendarView events={calendarEvents} onAdd={(date) => openEvent(null, date)} onEdit={(entry) => openEvent(entry)} onDelete={(entry) => { if (window.confirm(`Excluir o compromisso “${entry.title}”?`)) { setCalendarEvents(current => current.filter(e => e.id !== entry.id)); logActivity(`Compromisso excluído: ${entry.title}`); } }} />}
          {view === "library" && <LibraryView assets={libraryAssets} query={query} onUpload={(files) => uploadAssets(files, Number(libraryProject) || undefined)} />}
        </section>
      </main>

      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={() => setModalOpen(false)}>
          <form className="project-modal" onSubmit={addProject} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span>NOVO PROJETO</span><h2>Comece uma nova produção</h2><p>Defina o essencial agora. A equipe completa os detalhes depois.</p></div><button type="button" onClick={() => setModalOpen(false)}><X size={19} /></button></div>
            <label>Nome do projeto<input name="name" required autoFocus placeholder="Ex.: Campanha Primavera 2027" /></label>
            <div className="form-grid"><label>Cliente cadastrado<select name="clientId"><option value="">Sem cliente vinculado</option>{[...clientList].sort((a,b) => a.name.localeCompare(b.name, "pt-BR")).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Prazo<input name="due" type="date" /></label></div>
            <label>Modelo de produção<select name="template">{Object.keys(projectTemplates).map(t => <option key={t}>{t}</option>)}</select></label><label>Descrição<textarea name="description" placeholder="Objetivo, formatos e contexto da produção…" /></label>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>Cancelar</button><button className="primary-button" type="submit">Criar projeto <ChevronRight size={16} /></button></div>
          </form>
        </div>
      )}
      {clientModalOpen && (
        <div className="modal-backdrop" onMouseDown={() => setClientModalOpen(false)}>
          <form key={editingClient?.id || "new-client"} className="project-modal" onSubmit={addClient} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span>{editingClient ? "EDITAR CLIENTE" : "NOVO CLIENTE"}</span><h2>{editingClient ? "Atualize o cadastro" : "Cadastre um relacionamento"}</h2><p>Defina o perfil para acompanhar recorrência e histórico de trabalhos.</p></div><button type="button" onClick={() => setClientModalOpen(false)}><X size={19} /></button></div>
            <label>Nome do cliente<input name="name" required autoFocus defaultValue={editingClient?.name} placeholder="Ex.: Estúdio Aurora" /></label>
            <div className="form-grid"><label>Contato principal<input name="contact" defaultValue={editingClient?.contact} required placeholder="Nome do contato" /></label><label>Telefone<input name="phone" defaultValue={editingClient?.phone} type="tel" inputMode="tel" placeholder="(11) 99999-9999" /></label></div>
            <label>E-mail<input name="email" defaultValue={editingClient?.email} type="email" placeholder="contato@empresa.com" /></label>
            <fieldset className="client-type-field"><legend>Tipo de relacionamento</legend><label><input type="radio" name="type" value="Recorrente" defaultChecked={!editingClient || editingClient.type === "Recorrente"} /><span><Building2 size={18} /><b>Recorrente</b><small>Cliente com trabalhos contínuos</small></span></label><label><input type="radio" name="type" value="Avulso" defaultChecked={editingClient?.type === "Avulso"} /><span><ReceiptText size={18} /><b>Avulso</b><small>Um trabalho ou projeto pontual</small></span></label></fieldset>
            <label>Pacote mensal (opcional)<input name="packageTitle" defaultValue={editingClient?.packageTitle} placeholder="Ex.: Conteúdo para redes sociais" /></label><div className="form-grid"><label>Entregas por mês<input name="monthlyDeliverables" type="number" min="0" defaultValue={editingClient?.monthlyDeliverables || ""} /></label><label>Valor mensal combinado<input name="monthlyFee" inputMode="decimal" defaultValue={editingClient?.monthlyFee || ""} placeholder="0,00" /></label></div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setClientModalOpen(false)}>Cancelar</button><button className="primary-button" type="submit">Salvar cliente <ChevronRight size={16} /></button></div>
          </form>
        </div>
      )}
      {financeModalOpen && (
        <div className="modal-backdrop" onMouseDown={closeFinanceModal}>
          <form key={editingFinanceEntry?.id || "new-revenue"} className="project-modal finance-modal" onSubmit={addFinanceEntry} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span>{editingFinanceEntry ? "EDITAR LANÇAMENTO" : "NOVO LANÇAMENTO"}</span><h2>{editingFinanceEntry ? "Atualize o lançamento" : "Registre uma entrada ou custo"}</h2><p>{editingFinanceEntry ? "Revise os dados e salve para atualizar os indicadores financeiros." : "Escolha a data para registrar a entrada ou o custo no mês correspondente."}</p></div><button type="button" onClick={closeFinanceModal}><X size={19} /></button></div>
            <label>Tipo de lançamento<select name="kind" value={financeKind} onChange={e => setFinanceKind(e.target.value as "income" | "expense")}><option value="income">Receita</option><option value="expense">Despesa / custo de produção</option></select></label><label>Projeto vinculado<select name="projectId" defaultValue={editingFinanceEntry?.projectId || selectedProject || ""}><option value="">Sem projeto vinculado</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Trabalho ou projeto <small className="field-hint">Opcional</small><input name="project" autoFocus defaultValue={editingFinanceEntry?.project === "Receita avulsa" ? "" : editingFinanceEntry?.project || ""} placeholder="Ex.: Filme institucional — Corte final" /></label>
            <div className="form-grid"><label>Cliente cadastrado<select name="clientId" defaultValue={editingFinanceEntry?.clientId || projects.find(p => p.id === selectedProject)?.clientId || ""}><option value="">Sem cliente vinculado</option>{[...clientList].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((client) => <option key={client.id} value={client.id}>{client.name} · {client.type}</option>)}</select><small className="field-hint">{clientList.length ? `${clientList.length} ${clientList.length === 1 ? "cliente disponível" : "clientes disponíveis"}` : "Cadastre clientes para vinculá-los às receitas"}</small></label><label>Valor do trabalho<div className="money-input"><span>R$</span><input name="amount" required inputMode="decimal" defaultValue={editingFinanceEntry?.amount || ""} placeholder="0,00" /></div></label></div>
            <div className="form-grid"><label>{financeKind === "expense" ? "Vencimento do pagamento" : "Previsão de recebimento"}<input name="date" type="date" defaultValue={editingFinanceEntry ? editingFinanceEntry.date.split("/").reverse().join("-") : ""} /></label><label>Situação<select name="status" defaultValue={editingFinanceEntry?.status || "A receber"}><option value="Recebido">{financeKind === "expense" ? "Pago" : "Recebido"}</option><option value="A receber">{financeKind === "expense" ? "A pagar" : "A receber"}</option></select></label></div>
            <label>Parcelamento<select name="installments" defaultValue="1" disabled={!!editingFinanceEntry}>{[1,2,3,4,5,6,10,12,24].map(n => <option key={n} value={n}>{n === 1 ? "Pagamento único" : `${n} parcelas mensais (dividir o valor total)`}</option>)}</select><small className="field-hint">Ao parcelar, o valor informado é dividido entre os meses. Cada parcela pode ser editada depois.</small></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={closeFinanceModal}>Cancelar</button><button className="primary-button" type="submit">{editingFinanceEntry ? "Salvar alterações" : "Adicionar lançamento"} <ArrowUpRight size={16} /></button></div>
          </form>
        </div>
      )}
      {deletingFinanceEntry && (
        <div className="modal-backdrop" onMouseDown={() => setDeletingFinanceEntry(null)}>
          <section className="project-modal delete-revenue-modal" role="dialog" aria-modal="true" aria-labelledby="delete-revenue-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="delete-revenue-icon"><Trash2 size={22} /></span>
            <div><span className="eyebrow">EXCLUIR LANÇAMENTO</span><h2 id="delete-revenue-title">Remover este lançamento?</h2><p><b>{deletingFinanceEntry.project}</b>, no valor de <b>{formatCurrency(deletingFinanceEntry.amount)}</b>, será removido do financeiro e dos indicadores do mês.</p></div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setDeletingFinanceEntry(null)}>Manter lançamento</button><button type="button" className="danger-button" onClick={deleteFinanceEntry}>Excluir lançamento <Trash2 size={15} /></button></div>
          </section>
        </div>
      )}
      {eventModalOpen && (
        <div className="modal-backdrop" onMouseDown={() => setEventModalOpen(false)}>
          <form key={editingEvent?.id || eventDate || "new-event"} className="project-modal calendar-event-modal" role="dialog" aria-modal="true" aria-labelledby="event-title" onSubmit={addCalendarEvent} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span>{editingEvent ? "EDITAR COMPROMISSO" : "NOVO COMPROMISSO"}</span><h2 id="event-title">{editingEvent ? "Atualize sua agenda" : "Reserve um horário"}</h2><p>Defina o intervalo de cada trabalho e visualize sua disponibilidade.</p></div><button type="button" onClick={() => setEventModalOpen(false)}><X size={19} /></button></div>
            <label>Título<input name="title" defaultValue={editingEvent?.title} required autoFocus placeholder="Ex.: Gravação externa — campanha verão" /></label>
            <label>Data do trabalho<input name="date" type="date" required defaultValue={eventDraft.date} onInput={e=>{const value=e.currentTarget.value;setEventDraft(d=>({...d,date:value}));setEventError("");}} /></label>
            <div className="form-grid time-range-fields"><label>Horário de início<input name="time" type="time" required defaultValue={eventDraft.time} onInput={e=>{const value=e.currentTarget.value;setEventDraft(d=>({...d,time:value}));setEventError("");}} /></label><label>Horário de término<input name="endTime" type="time" required defaultValue={eventDraft.endTime} onInput={e=>{const value=e.currentTarget.value;setEventDraft(d=>({...d,endTime:value}));setEventError("");}} /></label></div>
            {eventError && <p className="event-form-error" role="alert">{eventError}</p>}
            {validTimeRange(eventDraft.time,eventDraft.endTime) && <div className={`event-availability ${overlappingEvents.length ? "has-overlap" : ""}`} role="status"><Clock3 size={16}/><div><b>{eventDuration(eventDraft)} de duração{overlappingEvents.length ? " · atenção ao horário" : " · horário disponível"}</b><span>{overlappingEvents.length ? `Coincide com: ${overlappingEvents.map(e=>`${e.title} (${eventRange(e)})`).join("; ")}. Você pode salvar se os trabalhos forem simultâneos.` : "Nenhum outro compromisso com duração definida neste intervalo."}</span></div></div>}
            <div className="form-grid"><label>Tipo<select name="type" defaultValue={editingEvent?.type || "Produção"}><option>Produção</option><option>Entrega</option><option>Reunião</option><option>Aprovação</option></select></label><label>Cliente<input name="client" defaultValue={editingEvent?.client} placeholder="Nome do cliente ou Interno" /></label></div>
            <label>Projeto vinculado<select name="projectId" defaultValue={editingEvent?.projectId || selectedProject || ""}><option value="">Sem projeto</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setEventModalOpen(false)}>Cancelar</button><button className="primary-button" type="submit">Salvar compromisso <CalendarDays size={16} /></button></div>
          </form>
        </div>
      )}
      <nav className="mobile-bottom-nav" aria-label="Navegação no celular">
        <button className={view === "overview" ? "active" : ""} aria-current={view === "overview" ? "page" : undefined} onClick={()=>changeView("overview")}><LayoutDashboard size={20}/><span>Início</span></button>
        <button className={view === "projects" ? "active" : ""} aria-current={view === "projects" ? "page" : undefined} onClick={()=>changeView("projects")}><Folder size={20}/><span>Projetos</span></button>
        <button className={view === "calendar" ? "active" : ""} aria-current={view === "calendar" ? "page" : undefined} onClick={()=>changeView("calendar")}><CalendarDays size={20}/><span>Agenda</span></button>
        <button className={view === "finance" ? "active" : ""} aria-current={view === "finance" ? "page" : undefined} onClick={()=>changeView("finance")}><WalletCards size={20}/><span>Financeiro</span></button>
        <button className={["clients","reviews","library"].includes(view) ? "active" : ""} aria-label="Mais opções de navegação" onClick={()=>setMobileOpen(true)}><Menu size={20}/><span>Mais</span></button>
      </nav>
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </div>
  );
}

function Overview({ projects, setView }: { projects: Project[]; setView: (view: View) => void }) {
  return <>
    <div className="dashboard-grid">
      <div className="panel projects-panel">
        <div className="panel-head"><div><span>EM ANDAMENTO</span><h2>Projetos recentes</h2></div><button onClick={() => setView("projects")}>Ver todos <ChevronRight size={15} /></button></div>
        <div className="project-list">{projects.slice(0, 4).map((project) => <ProjectRow project={project} key={project.id} onOpen={() => setView(project.status === "Em aprovação" ? "reviews" : "projects")} />)}{!projects.length && <div className="empty-state compact"><FolderOpen size={27} /><h3>Seu espaço está pronto</h3><p>Crie o primeiro projeto para começar a organizar sua produção.</p><button className="primary-button" onClick={() => setView("projects")}>Começar agora</button></div>}</div>
      </div>

    </div>

  </>;
}

function ProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return <button className="project-row" onClick={onOpen}>
    <BrandAvatar initials={project.initials} color={project.color} /><div className="project-name"><b>{project.name}</b><small>{project.client} · {project.files} arquivos</small></div>
    <StatusBadge status={project.status} /><div className="progress-cell"><span><i style={{ width: `${project.progress}%` }} /></span><small>{project.progress}%</small></div>
    <div className="due-cell"><small>Prazo</small><b>{project.due}</b></div><ChevronRight size={16} />
  </button>;
}

function ProjectsView({ projects, statusFilter, setStatusFilter, onOpen }: { onOpen: (id: number) => void; projects: Project[]; statusFilter: Status | "Todos"; setStatusFilter: (status: Status | "Todos") => void }) {
  const filters: (Status | "Todos")[] = ["Todos", "Em produção", "Em aprovação", "Ajustes", "Aprovado"];
  return <div className="panel full-panel">
    <div className="filter-bar"><div className="filter-pills">{filters.map((filter) => <button key={filter} className={statusFilter === filter ? "active" : ""} onClick={() => setStatusFilter(filter)}>{filter}</button>)}</div><span className="field-hint">{projects.length} projetos encontrados</span></div>
    <div className="project-cards">{projects.map((project) => <article className="project-card" key={project.id} onClick={() => onOpen(project.id)}>
      <div className={`project-cover ${project.color}`}><span className="cover-grid" /><BrandAvatar initials={project.initials} color={project.color} large /><button aria-label={`Abrir projeto ${project.name}`} onClick={(e) => { e.stopPropagation(); onOpen(project.id); }}><ChevronRight size={17} /></button><em><Film size={14} /> {project.files} arquivos</em></div>
      <div className="project-card-copy"><StatusBadge status={project.status} /><h3>{project.name}</h3><p>{project.client}</p><div className="card-progress"><span><i style={{ width: `${project.progress}%` }} /></span><b>{project.progress}%</b></div><footer><span><CalendarDays size={14} /> {project.due}</span><span>{project.template || "Produção"}</span></footer></div>
    </article>)}</div>
    {!projects.length && <div className="empty-state"><FolderOpen size={28} /><h3>Nenhum projeto cadastrado</h3><p>Use o botão “Criar projeto” para iniciar sua primeira produção.</p></div>}
  </div>;
}

function ClientsView({ clients, onOpen, onAdd }: { clients: Client[]; onOpen: (id: number) => void; onAdd: () => void }) {
  const recurring = clients.filter((client) => client.type === "Recorrente").length;
  const activeProjects = clients.reduce((total, client) => total + client.active, 0);
  return <div className="panel full-panel client-panel">
    <div className="client-summary"><div><span>CLIENTES CADASTRADOS</span><strong>{clients.length}</strong><small>{activeProjects} {activeProjects === 1 ? "projeto em produção" : "projetos em produção"}</small></div><div><span>CLIENTES RECORRENTES</span><strong>{recurring}</strong><small className="positive">{Math.round(recurring / Math.max(1, clients.length) * 100)}% da carteira</small></div><div><span>CLIENTES AVULSOS</span><strong>{clients.length - recurring}</strong><small>Trabalhos pontuais</small></div></div>
    <div className="client-toolbar"><div><b>Carteira de clientes</b><small>Classifique cada relacionamento para entender melhor sua receita.</small></div><button className="secondary-button" onClick={onAdd}><UserRoundPlus size={15} /> Adicionar cliente</button></div>
    <div className="client-list-head"><span>Cliente</span><span>Relacionamento</span><span>Contato</span><span>Projetos</span><span>Desde</span><span /></div>
    <div className="client-list">{clients.map((client) => <button key={client.id} onClick={() => onOpen(client.id)}><div><BrandAvatar initials={client.initials} color={client.color} /><b>{client.name}</b></div><span><i className={`client-type ${client.type === "Recorrente" ? "recurring" : "one-off"}`}>{client.type === "Recorrente" ? <><Building2 size={12} /> Recorrente</> : <><ReceiptText size={12} /> Avulso</>}</i></span><span className="client-contact-meta"><b>{client.contact}</b><small>{client.phone || client.email || "Sem telefone ou e-mail"}</small>{client.phone && client.email && <small>{client.email}</small>}</span><span>{client.projects}</span><span>{client.since}</span><ChevronRight size={16} /></button>)}{!clients.length && <div className="empty-state"><Users size={30} /><h3>Nenhum cliente cadastrado</h3><p>Adicione o primeiro cliente e defina se o relacionamento é recorrente ou avulso.</p><button className="primary-button" onClick={onAdd}>Adicionar primeiro cliente</button></div>}</div>
  </div>;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

const calendarMonthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const weekNames = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

function dateKey(year: number, month: number, day: number) {
  const date = new Date(year, month, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function CalendarView({ events, onAdd, onEdit, onDelete }: { events: CalendarEvent[]; onAdd: (date: string) => void; onEdit: (entry: CalendarEvent) => void; onDelete: (entry: CalendarEvent) => void }) {
  const now = new Date();
  const today = dateKey(now.getFullYear(), now.getMonth(), now.getDate());
  const [cursor, setCursor] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(today);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousDays = new Date(year, month, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const raw = index - firstWeekday + 1;
    if (raw < 1) return { day: previousDays + raw, current: false, key: dateKey(year, month - 1, previousDays + raw) };
    if (raw > daysInMonth) return { day: raw - daysInMonth, current: false, key: dateKey(year, month + 1, raw - daysInMonth) };
    return { day: raw, current: true, key: dateKey(year, month, raw) };
  });
  const selectedEvents = events.filter((event) => event.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time));
  const upcoming = events.filter((event) => event.date >= selectedDate).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 4);

  return <div className="calendar-layout">
    <section className="panel calendar-panel">
      <div className="calendar-toolbar"><div><button aria-label="Mês anterior" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={17} /></button><button aria-label="Próximo mês" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight size={17} /></button></div><h2>{calendarMonthNames[month]} <span>{year}</span></h2><button className="secondary-button" onClick={() => { const current = new Date(); setCursor(new Date(current.getFullYear(), current.getMonth(), 1)); setSelectedDate(dateKey(current.getFullYear(), current.getMonth(), current.getDate())); }}>Hoje</button></div>
      <div className="calendar-week">{weekNames.map((name) => <span key={name}>{name}</span>)}</div>
      <div className="calendar-grid">{cells.map((cell) => {
        const dayEvents = events.filter((event) => event.date === cell.key);
        return <button key={cell.key} className={`${cell.current ? "" : "outside"} ${selectedDate === cell.key ? "selected" : ""}`} onClick={() => { setSelectedDate(cell.key); if (!cell.current) setCursor(new Date(`${cell.key}T12:00:00`)); }}><b>{cell.day}</b><div>{dayEvents.slice(0, 2).map((event) => <span className={`event-chip ${event.type.toLowerCase().replace("ã", "a")}`} key={event.id}><i />{event.time}{event.endTime ? `–${event.endTime}` : ""} {event.title}</span>)}{dayEvents.length > 2 && <small>+{dayEvents.length - 2} compromissos</small>}</div></button>;
      })}</div>
    </section>
    <aside className="panel agenda-panel">
      <div className="panel-head"><div><span>AGENDA DO DIA</span><h2>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}</h2></div><button aria-label="Adicionar compromisso neste dia" onClick={() => onAdd(selectedDate)}><Plus size={17} /></button></div>
      <div className="day-agenda">{selectedEvents.length ? selectedEvents.map((event) => <article key={event.id}><time><b>{event.time}</b><span>{event.endTime || "Sem término"}</span></time><div><i className={event.type.toLowerCase().replace("ã", "a")} /><b>{event.title}</b><small>{event.client} · {event.type}{eventDuration(event) ? ` · ${eventDuration(event)}` : ""}</small>{selectedEvents.some(other=>overlaps(event,other)) && <span className="overlap-label">Horário sobreposto</span>}<span className="revenue-actions"><button aria-label={`Editar ${event.title}`} onClick={() => onEdit(event)}><Pencil size={15}/></button><button aria-label={`Excluir ${event.title}`} onClick={() => onDelete(event)}><Trash2 size={15}/></button></span></div></article>) : <div className="agenda-empty"><CalendarDays size={28} /><b>Dia livre</b><span>Nenhum compromisso nesta data.</span><button onClick={() => onAdd(selectedDate)}>Adicionar compromisso</button></div>}</div>
      <div className="upcoming-list"><span>PRÓXIMOS COMPROMISSOS</span>{upcoming.map((event) => <article key={event.id}><div><b>{new Date(`${event.date}T12:00:00`).getDate()}</b><small>{monthLabels[new Date(`${event.date}T12:00:00`).getMonth()]}</small></div><p><b>{event.title}</b><small>{eventRange(event)} · {event.client}</small></p></article>)}</div>
    </aside>
  </div>;
}

function assetIcon(kind: AssetKind) {
  return kind === "Vídeo" ? FileVideo : kind === "Imagem" ? ImageIcon : kind === "Áudio" ? FileAudio : FileText;
}

function LibraryView({ assets, query, onUpload }: { assets: LibraryAsset[]; query: string; onUpload: (files: FileList | null) => void }) {
  const [kind, setKind] = useState<AssetKind | "Todos">("Todos");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState("recent");
  const filteredAssets = assets.filter((asset) => (kind === "Todos" || asset.kind === kind) && `${asset.name} ${asset.project}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => sort === "name" ? a.name.localeCompare(b.name, "pt-BR") : b.id - a.id);
  const totalMb = assets.reduce((total, asset) => total + Number(asset.size.replace(",", ".").replace(/[^0-9.]/g, "")) * (asset.size.includes("KB") ? .001 : 1), 0);
  const kinds: (AssetKind | "Todos")[] = ["Todos", "Vídeo", "Imagem", "Áudio", "Documento"];

  return <div className="library-layout">
    <div className="library-summary"><article><span><HardDrive size={18} /></span><div><small>ARQUIVOS</small><b>{assets.length}</b></div></article><article><span><Film size={18} /></span><div><small>ARMAZENAMENTO</small><b>{totalMb >= 1024 ? `${(totalMb / 1024).toFixed(1)} GB` : `${Math.round(totalMb)} MB`}</b></div></article><article><span><CalendarDays size={18} /></span><div><small>ADICIONADOS ESTE MÊS</small><b>{assets.filter(a => toISOAdded(a.addedAt).slice(0,7) === new Date().toLocaleDateString("en-CA").slice(0,7)).length}</b></div></article></div>
    <section className="panel library-panel">
      <div className="library-toolbar"><div className="filter-pills">{kinds.map((item) => <button key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>{item}</button>)}</div><div><select aria-label="Ordenar arquivos" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Mais recentes</option><option value="name">Nome A–Z</option></select><button className={`view-button ${layout === "grid" ? "active" : ""}`} onClick={() => setLayout("grid")}><Grid2X2 size={16} /></button><button className={`view-button ${layout === "list" ? "active" : ""}`} onClick={() => setLayout("list")}><ListFilter size={16} /></button></div></div>
      <div className={`asset-collection ${layout}`}>{filteredAssets.map((asset) => { const Icon = assetIcon(asset.kind); return <article className="asset-card" key={asset.id}><div className={`asset-preview ${asset.color}`} style={asset.kind === "Imagem" && asset.url ? { backgroundImage: `url(${asset.url})` } : undefined}><Icon size={30} /><span>{asset.kind.toUpperCase()}</span></div><div className="asset-copy"><Icon size={17} /><div><b title={asset.name}>{asset.url ? <a href={asset.url} target="_blank" rel="noreferrer">{asset.name}</a> : asset.name}</b><small>{asset.project} · V{asset.version || 1}</small></div><span>{asset.size}</span><time>{asset.addedAt}</time><span>{asset.url ? <a href={`${asset.url}&download=1`} className="secondary-button" download>Baixar</a> : <small>Reenvie o arquivo</small>}</span></div></article>; })}</div>
      {!filteredAssets.length && <div className="library-empty"><FolderOpen size={34} /><h3>Nenhum arquivo encontrado</h3><p>Altere o filtro ou adicione novos materiais à biblioteca.</p></div>}
      <label className="library-drop"><Upload size={22} /><b>Clique para enviar arquivos</b><span>Vídeo, áudio, imagens, PDFs e documentos</span><input type="file" multiple onChange={(event) => { onUpload(event.target.files); event.target.value = ""; }} /></label>
    </section>
  </div>;
}

