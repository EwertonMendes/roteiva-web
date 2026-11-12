import {useEffect,useRef,useState} from 'react';
import {AppButton} from '../ui/AppButton';
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
  if(!selected||working)return;const controller=new AbortController();operation.current=controller;setWorking(true);setError('');
  transfers.cancelAll(selected.id);
  try{
   await call('/integrations/'+(selected.provider==='dropbox'?'dropbox':'drive')+'/'+selected.id+'/disconnect','POST',undefined,controller.signal);
   if(!controller.signal.aborted){setSelected(null);await storage.refresh(true);if(selected.status==='minimum_reconsent_required')onConnect('drive');}
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível desconectar.');}
  finally{if(!controller.signal.aborted)setWorking(false);}
 }
 return <><div className="virtual-library-toolbar"><AppButton disabled={busy||working} onClick={()=>onConnect('drive')}>Conectar Google Drive</AppButton><AppButton disabled={busy||working} onClick={()=>onConnect('dropbox')}>Conectar Dropbox</AppButton></div>
 {storage.connections.length>0&&<details><summary>Contas de armazenamento ({storage.connections.length})</summary><ul className="virtual-library-nodes">{storage.connections.map(account=><li key={account.provider+account.id}><span>{account.provider==='dropbox'?'Dropbox':'Google Drive'} · {account.email}</span><span>{account.status==='connected'?'Conectada':account.status==='revocation_pending'?'Desconexão pendente':'Reconexão necessária'}</span>{account.status==='minimum_reconsent_required'?<AppButton disabled={busy||working} onClick={()=>{setError('');setSelected(account);}}>Atualizar autorização de {account.email}</AppButton>:account.status==='reconnect_required'?<AppButton disabled={busy||working} onClick={()=>onConnect(account.provider==='dropbox'?'dropbox':'drive')}>Reconectar {account.email}</AppButton>:<AppButton disabled={busy||working} onClick={()=>{setError('');setSelected(account);}}>Desconectar {account.email}</AppButton>}</li>)}</ul></details>}
 {selected&&<div className="virtual-library-backdrop"><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Desconectar armazenamento" className="virtual-library-editor"><h3>{selected.status==='minimum_reconsent_required'?'Atualizar autorização de ':'Desconectar '}{selected.email}?</h3>{selected.status==='minimum_reconsent_required'&&<p>O Roteiva passou a acessar somente os arquivos que você selecionar. A autorização anterior será revogada antes de abrir o novo consentimento Google.</p>}<p>Os originais e a organização da biblioteca serão preservados. Arquivos desta conta deixam de estar disponíveis até uma nova conexão e autorização. Encerre antes as aprovações ativas que utilizam esta conta.</p>{error&&<p role="alert" className="virtual-library-error">{error}</p>}<div className="virtual-library-toolbar"><AppButton disabled={working} onClick={()=>void disconnect()}>{selected.status==='minimum_reconsent_required'?'Continuar com novo acesso':'Confirmar desconexão'}</AppButton><AppButton disabled={working} onClick={()=>setSelected(null)}>Cancelar</AppButton></div></div></div>}
 </>;
}
