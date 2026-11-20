
import {useEffect,useId,useRef,useState} from "react";
import {ArrowUpRight,ChevronLeft,ChevronRight,ReceiptText} from "lucide-react";
import {AppButton} from "../ui/AppButton";
import {billingDate,billingRequest,money,sandboxLink,type PaymentPage} from "./billing-data";

const outcomes:Record<string,{label:string;tone:string}> = {
  pending:{label:"Pendente",tone:"warning"},
  overdue:{label:"Vencida",tone:"critical"},
  confirmed:{label:"Confirmada",tone:"positive"},
  received:{label:"Recebida",tone:"positive"},
  refused:{label:"Cartão recusado",tone:"critical"},
  refunded:{label:"Estornada",tone:"neutral"},
  chargeback:{label:"Contestada",tone:"critical"},
};
const inReview = {label:"Em análise",tone:"neutral"};

export function BillingHistory({firstPage,uid}:{firstPage:PaymentPage;uid:string}) {
  const heading = useId();
  const [pages,setPages] = useState([firstPage]);
  const [index,setIndex] = useState(0);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const request = useRef<AbortController|null>(null);
  useEffect(() => () => request.current?.abort(),[]);
  const current = pages[index];

  async function next() {
    if(request.current || !current.nextPaymentCursor) return;
    setError("");
    if(pages[index+1]) {
      setIndex(index+1);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const query = new URLSearchParams({paymentCursor:current.nextPaymentCursor});
      const result = await billingRequest<PaymentPage>("/billing/status?"+query,uid,undefined,controller.signal);
      if(controller.signal.aborted) return;
      setPages(previous=>[...previous,result]);
      setIndex(index+1);
    } catch {
      if(!controller.signal.aborted) setError("Não foi possível carregar a próxima página. Tente novamente.");
    } finally {
      request.current = null;
      if(!controller.signal.aborted) setLoading(false);
    }
  }

  return <section className="billing-history" aria-labelledby={heading}>
    <header className="billing-history-head">
      <ReceiptText size={20} aria-hidden="true"/>
      <h3 id={heading}>Histórico de cobranças</h3>
    </header>
    {current.payments.length>0 ? <div className="billing-table" role="table" aria-labelledby={heading} aria-busy={loading}>
      <div className="billing-table-head" role="row">
        <span role="columnheader">Vencimento</span>
        <span role="columnheader">Situação</span>
        <span role="columnheader">Valor</span>
        <span role="columnheader">Fatura</span>
      </div>
      {current.payments.map((payment,row) => {
        const state = outcomes[payment.state] ?? inReview;
        const invoice = sandboxLink(payment.invoiceUrl,"invoice");
        const due = payment.dueOn ? billingDate(payment.dueOn) : "Data indisponível";
        return <div className="billing-table-row" role="row" key={row}>
          <span className="billing-table-date" role="cell">{payment.dueOn?<time dateTime={payment.dueOn}>{due}</time>:due}</span>
          <span className="billing-table-state" role="cell"><span className="billing-pill" data-tone={state.tone}>{state.label}</span></span>
          <strong className="billing-table-amount" role="cell">{money(payment.amountCents)}</strong>
          <span className="billing-table-invoice" role="cell">
            {invoice ? <a href={invoice} target="_blank" rel="noreferrer" aria-label={`Abrir fatura de ${due} no Asaas (nova aba)`}>Fatura <ArrowUpRight size={14}/></a> :
              <><span className="billing-sr-only">Fatura indisponível</span><span aria-hidden="true">—</span></>}
          </span>
        </div>;
      })}
    </div> : <p className="billing-empty">{index===0?"Nenhuma cobrança registrada.":"Nenhuma cobrança nesta página."}</p>}
    {error&&<p className="billing-inline-error" role="alert">{error}</p>}
    {(index>0||current.nextPaymentCursor)&&<nav className="billing-pagination" aria-label="Páginas do histórico de cobranças">
      <AppButton variant="secondary" className="billing-page-button" aria-label="Página anterior" aria-disabled={index===0||loading}
        onClick={()=>{if(index>0&&!request.current){setIndex(index-1);setError("");}}}><ChevronLeft size={18}/></AppButton>
      <span role="status">{loading?"Carregando…":`Página ${index+1}`}</span>
      <AppButton variant="secondary" className="billing-page-button" aria-label="Próxima página" aria-disabled={!current.nextPaymentCursor||loading}
        onClick={()=>void next()}><ChevronRight size={18}/></AppButton>
    </nav>}
  </section>;
}
