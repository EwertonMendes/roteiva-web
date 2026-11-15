import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,Link2,Plus,RefreshCw,ShieldCheck,Unplug,AlertCircle} from 'lucide-react';
import {AppButton} from '../ui/AppButton';
import googleDriveMark from '../../assets/brand/google-drive.svg';
import dropboxMark from '../../assets/brand/dropbox.svg';
import {useStorageConnections,type StorageConnection} from './StorageConnectionsProvider';
import {useDriveTransfers} from './DriveTransfersProvider';
import {useDriveApi} from './drive-api';
import './library-accounts.css';

type Provider='google_drive'|'dropbox';
type ConnectProvider='drive'|'dropbox';

export function LibraryConnections({
 busy,onConnect,selectedDriveId,selectedDropboxId,onSelectDrive,onSelectDropbox
}:{
 busy:boolean;
 onConnect:(provider:ConnectProvider)=>void;
 selectedDriveId?:string;selectedDropboxId?:string;
 onSelectDrive:(id:string)=>void;onSelectDropbox:(id:string)=>void;
}){
 const storage=useStorageConnections(),transfers=useDriveTransfers(),call=useDriveApi();
 const [selected,setSelected]=useState<StorageConnection|null>(null);
 const [working,setWorking]=useState(false),[error,setError]=useState('');
 const operation=useRef<AbortController|null>(null),back=useRef<HTMLButtonElement>(null);
 const disabled=busy||working;
 useEffect(()=>()=>operation.current?.abort(),[]);
 useEffect(()=>{if(selected)back.current?.focus();},[selected?.id]);

 const providers=[
  {id:'google_drive' as const,label:'Google Drive',mark:googleDriveMark,connect:'drive' as const},
  {id:'dropbox' as const,label:'Dropbox',mark:dropboxMark,connect:'dropbox' as const},
 ];

 async function disconnect(){
  const account=selected;
  if(!account||disabled)return;
  const controller=new AbortController();
  operation.current=controller;setWorking(true);setError('');
  try{
   // Cancel only transfers owned by this connection, never another account.
   transfers.cancelAll(account.id);
   await call('/integrations/'+(account.provider==='dropbox'?'dropbox':'drive')+'/'+encodeURIComponent(account.id)+'/disconnect','POST',undefined,controller.signal);
   if(controller.signal.aborted)return;
   await storage.refresh(true);
   setSelected(null);
   if(account.status==='minimum_reconsent_required')onConnect('drive');
  }catch(e){
   if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível desconectar a conta.');
  }finally{
   if(!controller.signal.aborted)setWorking(false);
   if(operation.current===controller)operation.current=null;
  }
 }
 function selectForUse(account:StorageConnection){
  if(account.status!=='connected'||disabled)return;
  if(account.provider==='dropbox')onSelectDropbox(account.id);
  else onSelectDrive(account.id);
 }
 function askDisconnect(account:StorageConnection){
  if(disabled)return;
  setSelected(account);setError('');
 }
 function renderProvider(provider:typeof providers[number]){
  const accounts=storage.connections.filter(item=>item.provider===provider.id);
  const connected=accounts.filter(item=>item.status==='connected');
  const preferred=provider.id==='dropbox'?selectedDropboxId:selectedDriveId;
  const active=connected.some(item=>item.id===preferred)?preferred:connected[0]?.id;
  return <section className="vl-provider" key={provider.id} aria-label={provider.label}>
   <div className="vl-provider-heading">
    <span className="vl-provider-brand"><img src={provider.mark} alt="" aria-hidden="true"/></span>
    <div className="vl-provider-title">
     <h3>{provider.label}</h3>
     <span>{accounts.length===0?'Nenhuma conta adicionada':accounts.length===1?'1 conta cadastrada':accounts.length+' contas cadastradas'}</span>
    </div>
    {accounts.length>0&&<AppButton type="button" className="vl-provider-add" disabled={disabled} onClick={()=>onConnect(provider.connect)} aria-label={'Adicionar outra conta '+provider.label}>
     <Plus size={16} aria-hidden="true"/> Adicionar conta
    </AppButton>}
   </div>
   {accounts.length===0?
    <div className="vl-provider-empty">
     <p>Conecte seu {provider.label} para usar os arquivos nos projetos.</p>
     <AppButton type="button" className="vl-provider-connect" disabled={disabled} onClick={()=>onConnect(provider.connect)}>
      <Link2 size={16} aria-hidden="true"/> Conectar {provider.label}
     </AppButton>
    </div>
    :<ul className="vl-connected-list">
     {accounts.map(account=>{
      const healthy=account.status==='connected';
      const isActive=healthy&&account.id===active;
      const needsConsent=account.status==='minimum_reconsent_required';
      const reconnect=account.status==='reconnect_required';
      const revoking=account.status==='revocation_pending';
      return <li className="vl-connected-account" key={account.provider+':'+account.id} data-connection-state={account.status}>
       <div className="vl-account-identity">
        <strong className="vl-account-email" title={account.email}>{account.email||'Conta sem e-mail informado'}</strong>
        <div className="vl-account-badges">
         <span className={'vl-account-state'+(healthy?' is-connected':' is-attention')}>
          {healthy?<ShieldCheck size={13} aria-hidden="true"/>:<AlertCircle size={13} aria-hidden="true"/>}
          {healthy?'Conectada':revoking?'Desconexão pendente':needsConsent?'Atualização necessária':'Reconexão necessária'}
         </span>
         {isActive&&connected.length>1&&<span className="vl-account-in-use"><Check size={13} aria-hidden="true"/> Em uso</span>}
        </div>
       </div>
       <div className="vl-account-buttons">
        {healthy?<>
         {connected.length>1&&!isActive&&<AppButton type="button" className="vl-account-use" disabled={disabled} onClick={()=>selectForUse(account)} aria-label={'Usar conta '+account.email}>Usar conta</AppButton>}
         <AppButton type="button" className="vl-account-disconnect" disabled={disabled} onClick={()=>askDisconnect(account)} aria-label={'Desconectar '+account.email}><Unplug size={15} aria-hidden="true"/> Desconectar</AppButton>
        </>:needsConsent?
         <AppButton type="button" className="vl-account-fix" disabled={disabled} onClick={()=>askDisconnect(account)} aria-label={'Atualizar autorização de '+account.email}><RefreshCw size={15} aria-hidden="true"/> Atualizar acesso</AppButton>
        :reconnect?
         <AppButton type="button" className="vl-account-fix" disabled={disabled} onClick={()=>onConnect(provider.connect)} aria-label={'Reconectar '+account.email}><Link2 size={15} aria-hidden="true"/> Reconectar</AppButton>
        :<span className="vl-account-wait" role="status">Aguarde a desconexão</span>}
       </div>
      </li>;
     })}
    </ul>}
  </section>;
 }

 if(selected){
  const renew=selected.status==='minimum_reconsent_required';
  return <div className="vl-account-confirm" aria-label={renew?'Atualizar autorização':'Confirmar desconexão'}>
   <AppButton ref={back} type="button" className="vl-confirm-back" disabled={working} onClick={()=>{setSelected(null);setError('');}}><ArrowLeft size={17} aria-hidden="true"/> Voltar às contas</AppButton>
   <span className="vl-confirm-icon"><Unplug size={24} aria-hidden="true"/></span>
   <h3>{renew?'Atualizar acesso ao Google Drive':'Desconectar conta?'}</h3>
   <p className="vl-confirm-account" title={selected.email}>{selected.email}</p>
   <p>{renew?'A autorização antiga precisa ser substituída. Vamos desconectar esta conta e abrir a autorização do Google novamente.':'Esta conta deixará de fornecer arquivos à Biblioteca até ser conectada novamente.'}</p>
   <p className="vl-confirm-note">Seus arquivos originais não serão excluídos. Links de aprovação que dependem desta conta podem ficar indisponíveis.</p>
   {error&&<p className="vl-confirm-error" role="alert">{error}</p>}
   <div className="vl-confirm-buttons">
    <AppButton type="button" className="vl-confirm-submit" disabled={working} onClick={()=>void disconnect()}>{working?'Processando…':renew?'Continuar com a nova autorização':'Desconectar conta'}</AppButton>
    <AppButton type="button" className="vl-confirm-cancel" disabled={working} onClick={()=>{setSelected(null);setError('');}}>Cancelar</AppButton>
   </div>
  </div>;
 }
 return <div className="vl-accounts-content" aria-label="Gerenciar contas de armazenamento">
  <p className="vl-accounts-intro">Escolha as contas que o Roteiva pode usar. Você pode conectar mais de uma por serviço.</p>
  {storage.loading&&!storage.connections.length&&<p className="vl-accounts-loading" role="status"><RefreshCw size={16} className="vl-loading" aria-hidden="true"/> Buscando contas conectadas…</p>}
  <div className="vl-provider-list">{providers.map(renderProvider)}</div>
  <p className="vl-accounts-footnote"><ShieldCheck size={15} aria-hidden="true"/> Os arquivos continuam no Google Drive ou Dropbox. O Roteiva apenas organiza o acesso.</p>
 </div>;
}
