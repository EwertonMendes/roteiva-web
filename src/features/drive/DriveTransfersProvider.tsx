import {createContext,useContext,useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {useAuth} from '../auth/AuthProvider';
import {useDriveApi} from './drive-api';
import {useDriveUploads,type UploadDestination} from './useDriveUploads';
import {DriveUploadQueue} from './DriveUploadQueue';
import {preparePicker,pickUploadFolder,type PickerConfig} from './google-picker';
import {invalidateDriveFolderCache} from './drive-folder-cache';
import type {UploadSession,UploadedFile} from './drive-upload-client';
import './drive-library.css';
type Completion=(file:UploadedFile,destination:UploadDestination)=>void;
type Transfers=ReturnType<typeof useDriveUploads>&{subscribe:(callback:Completion)=>()=>void};
const TransfersContext=createContext<Transfers|null>(null);
export function useDriveTransfers(){const value=useContext(TransfersContext);if(!value)throw new Error('DriveTransfersProvider ausente.');return value;}
export function DriveTransfersProvider({children}:{children:ReactNode}){
  const {user}=useAuth();
  return <DriveTransfersSession key={user?.uid||''}>{children}</DriveTransfersSession>;
}
function DriveTransfersSession({children}:{children:ReactNode}){
  const {user}=useAuth();const call=useDriveApi();
  const [uploadGrant,setUploadGrant]=useState<{config:PickerConfig;destination:UploadDestination}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
  const grantController=useRef<AbortController|null>(null);
  const subscribers=useRef(new Set<Completion>());
  const subscribe=useCallback((callback:Completion)=>{subscribers.current.add(callback);return ()=>{subscribers.current.delete(callback);};},[]);
  useEffect(()=>()=>{grantController.current?.abort();},[]);
  const createUpload=useCallback(async(file:File,dest:UploadDestination,attemptId:string,signal:AbortSignal):Promise<UploadSession>=>{
    const path="/integrations/drive/"+encodeURIComponent(dest.connectionId)+"/folders/"+
      encodeURIComponent(dest.targetFolderId)+"/uploads";
    try{return await call<UploadSession>(path,"POST",{attemptId,projectId:dest.projectId,linkedFolderId:dest.linkedFolderId,
      name:file.name,size:file.size,mimeType:file.type||"application/octet-stream"},signal);}
    catch(error){
      if((error as {code?:string}).code==='drive_picker_required'){
        const config=await call<{authorized:true}|PickerConfig>(path+'/authorize','POST',
          {projectId:dest.projectId,linkedFolderId:dest.linkedFolderId},signal);
        if(!config.authorized){await preparePicker();if(!signal.aborted)setUploadGrant({config,destination:{...dest}});}
      }
      throw error;
    }
  },[call]);
  const confirmUpload=useCallback((uploaded:UploadedFile,size:number,dest:UploadDestination,session:UploadSession,signal:AbortSignal):Promise<UploadedFile>=>{
    const path="/integrations/drive/"+encodeURIComponent(dest.connectionId)+"/folders/"+
      encodeURIComponent(dest.targetFolderId)+"/uploads/complete";
    return call<{file:UploadedFile}>(path,"POST",{attemptId:session.attemptId,projectId:dest.projectId,linkedFolderId:dest.linkedFolderId,
      fileId:uploaded.id,size},signal).then(result=>result.file);
  },[call]);

  const completed=useCallback<Completion>((file,dest)=>{
    if(!user)return;
    setResult('');
    invalidateDriveFolderCache(user.uid,dest.connectionId,dest.targetFolderId);
    subscribers.current.forEach(callback=>callback(file,dest));
  },[user]);
  const uploads=useDriveUploads(createUpload,confirmUpload,completed,user?.uid||'');
  function authorizeFolder(){
    if(!uploadGrant||busy)return;
    const {config,destination:dest}=uploadGrant;
    const controller=new AbortController();grantController.current=controller;setBusy(true);setError('');
    void pickUploadFolder(config,dest.targetFolderId,dest.folderName,
      accessToken=>call('/integrations/drive/'+encodeURIComponent(dest.connectionId)+'/picker/verify','POST',{accessToken}),controller.signal)
      .then(async()=>{
        const verified=await call<{authorized:boolean}>('/integrations/drive/'+encodeURIComponent(dest.connectionId)+
          '/folders/'+encodeURIComponent(dest.targetFolderId)+'/uploads/authorize','POST',
          {projectId:dest.projectId,linkedFolderId:dest.linkedFolderId});
        if(!verified.authorized)throw new Error('O Google ainda não confirmou acesso à pasta. Tente novamente.');
        if(controller.signal.aborted)return;
        setUploadGrant(null);setResult('Pasta autorizada. Use Tentar novamente nos arquivos da fila.');
      }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Não foi possível autorizar a pasta.');})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  }

  const cancelAll=useCallback((id:string)=>{uploads.cancelAll(id);grantController.current?.abort();setUploadGrant(null);setBusy(false);},[uploads.cancelAll]);
  return <TransfersContext.Provider value={{...uploads,cancelAll,subscribe}}>{children}
    <div className="rl-transfer-layer">
      <DriveUploadQueue uploads={uploads.uploads} onCancel={uploads.cancel} onRetry={uploads.retry} onDismiss={uploads.dismiss}/>
      {(uploadGrant||error||result)&&<aside className="rl-upload-authorization" aria-label="Autorização de envio">
        {error&&<p role="alert">{error}</p>}{result&&<p role="status">{result}</p>}
    {uploadGrant&&<div className="rl-status" role="status"><p>O Google precisa autorizar envios para {uploadGrant.destination.folderName}.</p>
      <button type="button" className="secondary-button" disabled={busy} onClick={authorizeFolder}>Autorizar pasta no Google</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={()=>setUploadGrant(null)}>Agora não</button></div>}

        {!busy&&<button type="button" className="secondary-button" onClick={()=>{setError('');setResult('');setUploadGrant(null);}}>Fechar aviso</button>}
      </aside>}
    </div>
  </TransfersContext.Provider>;
}
