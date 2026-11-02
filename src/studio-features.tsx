import {ArrowLeft, Receipt, Phone, Mail, FolderKanban} from "lucide-react";
import { IconLabel } from "./features/ui/IconLabel";
import { newId } from "./domain/workspace";
import { sumMoney, toISO } from "./studio-finance";
import type {Project, Client, FinanceEntry} from "./dashboard-client";

export const money = (v: number) => new Intl.NumberFormat("pt-BR", {style: "currency", currency: "BRL"}).format(v);
export const isoDate = toISO;
const today = () => new Date().toLocaleDateString("en-CA");
const sum = sumMoney;
export const projectTemplates: Record<string, string[]> = {
  "Livre": [],
  "Institucional": ["Aprovar briefing", "Preparar roteiro", "Planejar gravação", "Captar imagens e áudio", "Montar primeiro corte", "Revisar com o cliente", "Entregar arquivos finais"],
  "Conteúdo mensal": ["Definir pauta do mês", "Aprovar roteiros", "Gravar conteúdos", "Editar vídeos e cortes", "Enviar para aprovação", "Entregar pacote mensal"],
  "Evento": ["Confirmar programação e local", "Conferir equipamentos", "Captar evento", "Fazer backup", "Editar highlights", "Aprovar e entregar"],
  "Casamento": ["Reunião com o casal", "Confirmar cronograma", "Preparar equipamentos", "Captar cerimônia e festa", "Fazer backup", "Editar teaser", "Editar filme completo", "Aprovar e entregar"],
};
function Empty({children}: {children: ReactNode}) { return <p className="studio-empty">{children}</p>; }
function Back({onClick}: {onClick: () => void}) { return <AppButton className="secondary-button" onClick={onClick}><ArrowLeft size={16}/> Voltar</AppButton>; }
export function ClientDetail({client, projects, entries, onBack, onEdit, onProject, onSave, onReview}: {onReview?:()=>void;onSave: (client:Client) => void; client: Client; projects: Project[]; entries: FinanceEntry[]; onBack: () => void; onEdit: (c: Client) => void; onProject: (id:number) => void}) {
  const linked = projects.filter(p => p.clientId === client.id || (!p.clientId && p.client === client.name));
  const finances = entries.filter(e => e.clientId === client.id && e.kind !== "expense");
  const [month,setMonth] = useState(today().slice(0,7));
  const deliveries = (client.deliveries || []).filter(d => d.month === month);
  const completed = deliveries.filter(d => d.done).length;
  function prepareDeliveries() {
    const count = Math.min(100, Math.floor(client.monthlyDeliverables || 0));
    const existing = client.deliveries || [];
    const needed = Math.max(0, count - deliveries.length);
    onSave({...client,deliveries:[...existing,...Array.from({length:needed},(_,i)=>({id:newId()+i,title:`Entrega ${deliveries.length+i+1}`,month,done:false}))]});
  }
  return <div className="studio-detail"><div className="studio-toolbar"><Back onClick={onBack}/>{onReview&&<AppButton className="secondary-button" onClick={onReview}>Enviar para aprovação</AppButton>}<AppButton className="primary-button" onClick={() => onEdit(client)}>Editar cliente</AppButton></div><section className="panel studio-section"><span className="eyebrow">FICHA DO CLIENTE · {client.type}</span><h2>{client.name}</h2><p>{client.contact}</p><div className="contact-links">{client.phone && <a href={`tel:${client.phone.replace(/[^+\d]/g,"")}`}><IconLabel icon={Phone}>{formatPhoneDisplay(client.phone)}</IconLabel></a>}{client.email && <a href={`mailto:${client.email}`}><IconLabel icon={Mail}>{client.email}</IconLabel></a>}</div><div className="studio-stats"><div><small>Projetos</small><b>{linked.length}</b></div><div><small>Receitas registradas</small><b>{money(sum(finances))}</b></div><div><small>A receber</small><b>{money(sum(finances.filter(e => e.status === "A receber")))}</b></div></div></section>
  {client.type === "Recorrente" && <section className="panel studio-section"><span className="eyebrow">PACOTE RECORRENTE</span><h2>{client.packageTitle || "Defina seu pacote mensal"}</h2><p>{money(client.monthlyFee || 0)} / mês · {client.monthlyDeliverables || 0} entregas previstas</p><progress value={completed} max={Math.max(client.monthlyDeliverables || 1, completed)}/><p>{completed} de {client.monthlyDeliverables || 0} entregas concluídas. O valor combinado não gera uma receita automaticamente.</p><label>Mês do pacote<AppInput aria-label="Mês do pacote" type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>{deliveries.map(d=><label className="task-row" key={d.id}><AppInput type="checkbox" checked={d.done} onChange={()=>onSave({...client,deliveries:(client.deliveries || []).map(item=>item.id===d.id?{...item,done:!item.done}:item)})}/><span>{d.title}</span></label>)}{deliveries.length<(client.monthlyDeliverables||0)&&<AppButton className="secondary-button" onClick={prepareDeliveries}>Preparar entregas deste mês</AppButton>}</section>}
  <section className="panel studio-section"><h2><IconLabel icon={FolderKanban} size={20}>Projetos do cliente</IconLabel></h2>{linked.length ? linked.map(p => <AppButton className="studio-row" key={p.id} onClick={() => onProject(p.id)}><b>{p.name}</b><span>{p.status}</span><span>{p.due}</span></AppButton>) : <Empty>Nenhum projeto vinculado ainda.</Empty>}</section><section className="panel studio-section"><h2><IconLabel icon={Receipt} size={20}>Histórico financeiro</IconLabel></h2>{finances.map(e => <div className="studio-row" key={e.id}><b>{e.project}</b><span>{e.date} · {e.status}</span><strong>{money(e.amount)}</strong></div>)}{!finances.length && <Empty>Nenhuma receita vinculada.</Empty>}</section></div>;
}
export function StudioReviews() {
  return <div className="studio-detail"><section className="panel studio-section">
    <span className="eyebrow">APROVAÇÕES · DEMONSTRAÇÃO</span>
    <h2>Revisão de vídeos ainda não disponível</h2>
    <p>Os arquivos serão armazenados no Google Drive de cada profissional. Envio, convites, comentários e aprovações serão habilitados quando a integração segura estiver pronta.</p>
  </section></div>;
}
