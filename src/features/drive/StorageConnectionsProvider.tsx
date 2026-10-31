import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import {useAuth} from "../auth/AuthProvider";
import {useDriveApi} from "./drive-api";
import {invalidateStorageConnection,type MediaProvider} from "./storage-image-cache";

export type StorageConnection={
 id:string;provider:MediaProvider;email:string;status:string;scopes:string;updatedAt?:number;
};
type ConnectionsResult={drive:StorageConnection[];dropbox:StorageConnection[]};
type ConnectionsState={
 connections:StorageConnection[];loading:boolean;error:string;
 refresh:(force?:boolean)=>Promise<ConnectionsResult>;
};
const Context=createContext<ConnectionsState|null>(null);
const FRESH_MS=60_000;
export function useStorageConnections(){
 const value=useContext(Context);
 if(!value)throw new Error("StorageConnectionsProvider ausente.");
 return value;
}
export function StorageConnectionsProvider({children}:{children:ReactNode}){
 const {user}=useAuth(),call=useDriveApi();
 const [connections,setConnections]=useState<StorageConnection[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const last=useRef(0);
 const current=useRef<ConnectionsResult>({drive:[],dropbox:[]});
 const inFlight=useRef<Promise<ConnectionsResult>|null>(null);
 const serial=useRef(0);
 const previous=useRef<StorageConnection[]>([]);
 const refresh=useCallback((force=false):Promise<ConnectionsResult>=>{
  if(!user)return Promise.resolve({drive:[],dropbox:[]});
  if(inFlight.current)return inFlight.current;
  if(!force&&Date.now()-last.current<FRESH_MS)return Promise.resolve(current.current);
  const request=++serial.current;
  setLoading(true);
  const work=Promise.allSettled([
   call<{connections:Array<{id:string;google_email:string;status:string;scopes:string;updated_at?:number}>}>("/integrations/drive"),
   call<{connections:Array<{id:string;email:string;status:string;scopes:string;updated_at?:number}>}>("/integrations/dropbox")
  ]).then(results=>{
   if(request!==serial.current)return current.current;
   const drive=results[0].status==="fulfilled"
    ?results[0].value.connections.map(c=>({id:c.id,provider:"google_drive" as const,email:c.google_email,status:c.status,scopes:c.scopes,updatedAt:c.updated_at}))
    :current.current.drive;
   const dropbox=results[1].status==="fulfilled"
    ?results[1].value.connections.map(c=>({id:c.id,provider:"dropbox" as const,email:c.email,status:c.status,scopes:c.scopes,updatedAt:c.updated_at}))
    :current.current.dropbox;
   const all=[...drive,...dropbox];
   for(const old of previous.current){
    const next=all.find(c=>c.id===old.id&&c.provider===old.provider);
    if(!next||next.status!=="connected"||(old.updatedAt&&next.updatedAt&&old.updatedAt!==next.updatedAt))
      void invalidateStorageConnection(user.uid,old.provider,old.id);
   }
   previous.current=all;current.current={drive,dropbox};last.current=Date.now();
   setConnections(all);
   setError(results.map((result,i)=>result.status==="rejected"?(i===0?"Google Drive":"Dropbox"):null).filter(Boolean).join(" e "));
   setLoading(false);
   return current.current;
  }).finally(()=>{if(inFlight.current===work)inFlight.current=null;});
  inFlight.current=work;
  return work;
 },[user?.uid,call]);
 useEffect(()=>{
  serial.current++;current.current={drive:[],dropbox:[]};previous.current=[];
  last.current=0;inFlight.current=null;
  setConnections([]);setLoading(true);setError("");
  void refresh(true);
  return ()=>{serial.current++;};
 },[user?.uid,refresh]);
 useEffect(()=>{
  const check=()=>{if(document.visibilityState==="visible"&&Date.now()-last.current>2*FRESH_MS)void refresh(true);};
  window.addEventListener("focus",check);document.addEventListener("visibilitychange",check);
  return ()=>{window.removeEventListener("focus",check);document.removeEventListener("visibilitychange",check);};
 },[refresh]);
 return <Context.Provider value={{connections,loading,error,refresh}}>{children}</Context.Provider>;
}
