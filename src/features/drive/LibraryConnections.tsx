import {useEffect,useRef,useState} from 'react';
import {ChevronDown,HardDrive,Link2,RefreshCw,ShieldCheck,Unplug,AlertCircle} from 'lucide-react';
import {AppButton} from '../ui/AppButton';
import {IconLabel} from '../ui/IconLabel';
import googleDriveMark from '../../assets/brand/google-drive.svg';
import dropboxMark from '../../assets/brand/dropbox.svg';
import {useStorageConnections,type StorageConnection} from './StorageConnectionsProvider';
import {useDriveTransfers} from './DriveTransfersProvider';
import {useDriveApi} from './drive-api';
import {useOverlayFocus} from './DriveLibraryUI';

export function LibraryConnections({busy,onConnect}:{busy:boolean;onConnect:(provider:'drive'|'dropbox')=>void}){
 const storage=useStorageConnections(),transfers=useDriveTransfers(),call=useDriveApi();
 const [selected,setSelected]=useState<StorageConnection|null>(null),[working,setWorking]=useState(false),[error,setError]=useState('');
 const operation=useRef<AbortController|null>(null),dialog=useOverlayFocus(()=>{if(!working)setSelected(null);},Boolean(selected));
 useEffect(()=>()=>operation.current?.abort(),[]);
 async function disconnect(){
  if(!selected||working)return;
  const controller=new AbortController();operation.current=controller;setWorking(true);setError('');
  transfers.cancelAll(selected.id);
  try{
   await call('/integrations/'+(selected.provider==='dropbox'?'dropbox':'drive')+'/'+selected.id+'/disconnect','POST',undefined,controller.signal);
   if(!controller.signal.aborted){
    setSelected(null);await storage.refresh(true);
    if(selected.status==='minimum_reconsent_required')onConnect('drive');
   }
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível desconectar.');}
  finally{if(!controller.signal.aborted)setWorking(false);}
 }
 return <section className="vl-connections" aria-label="Conexões de armazenamento">
  <div className="vl-connections-heading">
   <div className="vl-section-heading">
    <span className="vl-section-icon"><HardDrive size={18} aria-hidden="true"/></span>
    <div><h3>Armazenamento conectado</h3><p>Gerencie suas contas do Google Drive e Dropbox.</p></div>
   </div>
   <div className="vl-connection-actions">
    <AppButton type="button" className="vl-action vl-connect-button" disabled={busy||working} onClick={()=>onConnect('drive')}>
     <img src={googleDriveMark} alt="" aria-hidden="true"/><span>Conectar Google Drive</span>
    </AppButton>
    <AppButton type="button" className="vl-action vl-connect-button" disabled={busy||working} onClick={()=>onConnect('dropbox')}>
     <img src={dropboxMark} alt="" aria-hidden="true"/><span>Conectar Dropbox</span>
    </AppButton>
   </div>
  </div>
  {storage.connections.length>0&&<details className="vl-account-details">
   <summary><span className="vl-summary-title"><ShieldCheck size={17} aria-hidden="true"/> Contas de armazenamento ({storage.connections.length})</span><ChevronDown className="vl-summary-chevron" size={16} aria-hidden="true"/></summary>
   <ul className="vl-account-list">{storage.connections.map(account=><li key={account.provider+account.id}>
    <span className="vl-account-logo"><img src={account.provider==='dropbox'?dropboxMark:googleDriveMark} alt="" aria-hidden="true"/></span>
    <div className="vl-account-copy"><strong>{account.provider==='dropbox'?'Dropbox':'Google Drive'}</strong><span title={account.email}>{account.email}</span></div>
    <span className={'vl-account-status'+(account.status==='connected'?' vl-account-status--connected':'')}>
     {account.status==='connected'?<ShieldCheck size={14} aria-hidden="true"/>:<AlertCircle size={14} aria-hidden="true"/>}
     {account.status==='connected'?'Conectada':account.status==='revocation_pending'?'Desconexão pendente':'Reconexão necessária'}
    </span>
    {account.status==='minimum_reconsent_required'?
     <AppButton className="vl-action vl-account-action" disabled={busy||working} onClick={()=>{setError('');setSelected(account);}} aria-label={'Atualizar autorização de '+account.email}><IconLabel icon={RefreshCw}>Atualizar autorização</IconLabel></AppButton>:
    account.status==='reconnect_required'?
     <AppButton className="vl-action vl-account-action" disabled={busy||working} onClick={()=>onConnect(account.provider==='dropbox'?'dropbox':'drive')} aria-label={'Reconectar '+account.email}><IconLabel icon={Link2}>Reconectar</IconLabel></AppButton>:
     <AppButton className="vl-action vl-account-action" disabled={busy||working} onClick={()=>{setError('');setSelected(account);}} aria-label={'Desconectar '+account.email}><IconLabel icon={Unplug}>Desconectar</IconLabel></AppButton>}
   </li>)}</ul>
  </details>}
  {selected&&<div className="virtual-library-backdrop"><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Desconectar armazenamento" className="virtual-library-editor">
   <h3>{selected.status==='minimum_reconsent_required'?'Atualizar autorização de ':'Desconectar '}{selected.email}?</h3>
   {selected.status==='minimum_reconsent_required'&&<p>O Roteiva passou a acessar somente os arquivos que você selecionar. A autorização anterior será revogada antes de abrir o novo consentimento Google.</p>}
   <p>Os originais e a organização da biblioteca serão preservados. Arquivos desta conta deixam de estar disponíveis até uma nova conexão e autorização. Encerre antes as aprovações ativas que utilizam esta conta.</p>
   {error&&<p role="alert" className="virtual-library-error">{error}</p>}
   <div className="virtual-library-toolbar"><AppButton variant="primary" disabled={working} onClick={()=>void disconnect()}>{selected.status==='minimum_reconsent_required'?'Continuar com novo acesso':'Confirmar desconexão'}</AppButton><AppButton variant="secondary" disabled={working} onClick={()=>setSelected(null)}>Cancelar</AppButton></div>
  </div></div>}
 </section>;
}
