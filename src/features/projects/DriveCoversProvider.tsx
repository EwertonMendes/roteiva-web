import {createContext,useContext,useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {useAuth} from '../auth/AuthProvider';
import {useDriveApi} from '../drive/drive-api';
import type {ProjectCover} from '../../domain/workspace';
export type CoverConnection={id:string;google_email:string;status:string;scopes:string;provider:'google_drive'|'dropbox'};
type Context={connections:CoverConnection[];error:string;uid:string;load:(cover:ProjectCover,signal:AbortSignal)=>Promise<Blob>};
const CoverContext=createContext<Context|null>(null);
function imageQueue(){
 let running=0;const waiters:(()=>void)[]=[];
 return async(signal:AbortSignal)=>{
  if(signal.aborted)throw signal.reason;
  await new Promise<void>((resolve,reject)=>{
   const start=()=>{signal.removeEventListener('abort',abort);running++;resolve();};
   const abort=()=>{const index=waiters.indexOf(start);if(index>=0)waiters.splice(index,1);reject(signal.reason);};
   if(running<3)start();else{waiters.push(start);signal.addEventListener('abort',abort,{once:true});}
  });
  return ()=>{running--;waiters.shift()?.();};
 };
}
const API='https://roteiva-api-dev.ewertonmendes9.workers.dev';
export function DriveCoversProvider({children,includeDropbox=false}:{children:ReactNode;includeDropbox?:boolean}){
 const {user}=useAuth();const call=useDriveApi();const [acquire]=useState(imageQueue);
 const [connections,setConnections]=useState<CoverConnection[]>([]),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();setConnections([]);setError('');
  const sources=[
   call<{connections:{id:string;google_email:string;status:string;scopes:string}[]}>('/integrations/drive','GET',undefined,controller.signal)
     .then(data=>data.connections.filter(c=>c.status==='connected').map(c=>({...c,provider:'google_drive' as const}))),
   ...(includeDropbox?[call<{connections:{id:string;email:string;status:string;scopes:string}[]}>('/integrations/dropbox','GET',undefined,controller.signal)
     .then(data=>data.connections.filter(c=>c.status==='connected').map(c=>({id:c.id,google_email:c.email,status:c.status,scopes:c.scopes,provider:'dropbox' as const})))]:[]),
  ];
  void Promise.allSettled(sources).then(results=>{
   if(controller.signal.aborted)return;
   setConnections(results.flatMap(result=>result.status==='fulfilled'?result.value:[]));
   if(results.every(result=>result.status==='rejected'))setError('Não foi possível consultar as conexões de armazenamento.');
  });
  return ()=>controller.abort();
 },[call,user?.uid,includeDropbox]);
 const load=useCallback(async(cover:ProjectCover,signal:AbortSignal)=>{
  if(!user)throw Error('Entre novamente para carregar a capa.');
  const release=await acquire(signal);try{
  const provider=cover.provider==='dropbox'?'dropbox':'drive';
  const path=API+'/integrations/'+provider+'/'+encodeURIComponent(cover.connectionId)+'/files/'+encodeURIComponent(cover.fileId)+'/cover';
  let response:Response|undefined;
  for(let attempt=0;attempt<2;attempt++){
   const token=await user.getIdToken(attempt===1);
   response=await fetch(path,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal});if(response.status!==401)break;
  }
  if(!response?.ok)throw Error('A imagem está indisponível. Confira o arquivo e a conexão do Drive.');
  if(!['image/jpeg','image/png','image/webp','image/avif'].includes(response.headers.get('Content-Type')?.split(';')[0]||''))throw Error('Formato de imagem não suportado.');
  const blob=await response.blob();if(!blob.size||blob.size>8*1024*1024)throw Error('A imagem excede o limite de 8 MB.');return blob;
  }finally{release();}
 },[user,acquire]);
 return <CoverContext.Provider value={{connections,error,uid:user?.uid||'',load}}>{children}</CoverContext.Provider>;
}
export const useDriveCovers=()=>useContext(CoverContext);
export function useCoverImage(cover:ProjectCover|undefined,visible=true){
 const context=useDriveCovers();const [state,setState]=useState({key:'',src:'',error:''});
 const load=context?.load;const key=[context?.uid,cover?.provider||'google_drive',cover?.connectionId,cover?.fileId].join(':');
 const current=useRef(cover);current.current=cover;
 const connected=!!context?.connections.some(c=>c.id===cover?.connectionId&&c.provider===(cover?.provider||'google_drive'));
 useEffect(()=>{
  if(!load||!current.current||!visible||!connected)return;
  const controller=new AbortController();let src='';setState({key,src:'',error:''});
  void load(current.current,controller.signal).then(blob=>{if(controller.signal.aborted)return;src=URL.createObjectURL(blob);setState({key,src,error:''});}).catch(e=>{if(!controller.signal.aborted)setState({key,src:'',error:e.message});});
  return ()=>{controller.abort();if(src)URL.revokeObjectURL(src);};
 },[load,key,visible,connected]);
 return connected&&state.key===key?state:{key,src:'',error:''};
}
