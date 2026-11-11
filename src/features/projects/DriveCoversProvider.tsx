import { API_BASE_URL } from "../../lib/environment.ts";
import {createContext,useContext,useCallback,useEffect,useRef,useState,type ReactNode} from "react";
import {useAuth} from "../auth/AuthProvider";
import {useStorageConnections,type StorageConnection} from "../drive/StorageConnectionsProvider";
import {cachedMediaUrl,loadStorageImage,type MediaIdentity} from "../drive/storage-image-cache";
import {prepareDisplayImage} from "../drive/prepare-display-image";
import type {ProjectCover} from "../../domain/workspace";

export type CoverConnection={id:string;google_email:string;status:string;scopes:string;provider:"google_drive"|"dropbox"};
type Context={
 connections:CoverConnection[];error:string;loadingConnections:boolean;
 retryConnections:()=>void;uid:string;
 load:(cover:ProjectCover,thumbnail?:boolean,highQuality?:boolean)=>Promise<string>;
};
const CoverContext=createContext<Context|null>(null);
const API=API_BASE_URL;
function coverIdentity(uid:string,cover:ProjectCover,thumbnail:boolean,highQuality=false):MediaIdentity{
 return {uid,provider:cover.provider==="dropbox"?"dropbox":"google_drive",
  connectionId:cover.connectionId,fileId:cover.fileId,
  revision:cover.modifiedTime,variant:thumbnail?(highQuality?"display":"thumbnail"):"original"};
}
export function DriveCoversProvider({children,includeDropbox=false}:{children:ReactNode;includeDropbox?:boolean}){
 const {user}=useAuth();
 const storage=useStorageConnections();
 const connections:CoverConnection[]=storage.connections
  .filter(c=>c.status==="connected"&&(includeDropbox||c.provider==="google_drive"))
  .map((c:StorageConnection)=>({id:c.id,google_email:c.email,status:c.status,scopes:c.scopes,provider:c.provider}));
 const retryConnections=useCallback(()=>{void storage.refresh(true);},[storage.refresh]);
 const load=useCallback(async(cover:ProjectCover,thumbnail=false,highQuality=false)=>{
  if(!user)throw new Error("Entre novamente para carregar a imagem.");
  const identity=coverIdentity(user.uid,cover,thumbnail,highQuality);
  return loadStorageImage(identity,async signal=>{
   const provider=identity.provider==="dropbox"?"dropbox":"drive";
   const base=API+"/integrations/"+provider+"/"+encodeURIComponent(cover.connectionId)+
    "/files/"+encodeURIComponent(cover.fileId);
   // Cards use a fast authenticated original path (one Drive upstream request).
   // A legacy Worker is still supported during staggered DEV rollout.
   const fetchImage=async(suffix:string)=>{
    let response:Response|undefined;
    for(let attempt=0;attempt<2;attempt++){
     const token=await user.getIdToken(attempt===1);
     response=await fetch(base+suffix,{headers:{Authorization:"Bearer "+token},cache:"no-store",signal});
     if(response.status!==401)break;
    }
    return response!;
   };
   let response=await fetchImage(highQuality&&thumbnail?"/preview":thumbnail?"/thumbnail":"/cover");
   if(response.status===404&&highQuality&&thumbnail)response=await fetchImage("/cover");
   if(!response.ok||response.status===204)throw Error("Imagem indisponível. Confira o arquivo e a conexão de armazenamento.");
   const mime=(response.headers.get("Content-Type")||"").split(";")[0].toLowerCase();
   if(!["image/jpeg","image/png","image/webp","image/avif"].includes(mime))
    throw Error("Formato de imagem não suportado.");
   const blob=await response.blob();
   const validated=blob.type===mime?blob:new Blob([blob],{type:mime});
   return highQuality&&thumbnail?prepareDisplayImage(validated):validated;
  },{persist:thumbnail,priority:thumbnail?1:2});
 },[user]);
 return <CoverContext.Provider value={{connections,error:storage.error&&(includeDropbox||storage.error.includes("Google Drive"))?("Não foi possível consultar "+storage.error+"."): "",
  loadingConnections:storage.loading,retryConnections,uid:user?.uid||"",load}}>{children}</CoverContext.Provider>;
}
export const useDriveCovers=()=>useContext(CoverContext);
export function useCoverImage(cover:ProjectCover|undefined,visible=true,thumbnail=false,highQuality=false){
 const context=useDriveCovers();
 const identity=cover&&context?.uid?coverIdentity(context.uid,cover,thumbnail,highQuality):null;
 const key=identity?JSON.stringify(identity):"";
 const [state,setState]=useState({key:"",src:"",error:""});
 const load=context?.load;
 const selected=useRef(cover);selected.current=cover;
 const connected=!!context?.connections.some(c=>c.id===cover?.connectionId&&c.provider===(cover?.provider||"google_drive"));
 const knownMissing=!!context&&!context.loadingConnections&&!connected;
 const cached=identity&&!knownMissing?cachedMediaUrl(identity):null;
 useEffect(()=>{
  if(!load||!selected.current||!visible||knownMissing)return;
  let active=true;
  setState({key,src:cachedMediaUrl(coverIdentity(context!.uid,selected.current,thumbnail,highQuality))||"",error:""});
  void load(selected.current,thumbnail,highQuality).then(src=>{if(active)setState({key,src,error:""});})
   .catch(e=>{if(active)setState({key,src:"",error:e instanceof Error?e.message:"Imagem indisponível."});});
  return ()=>{active=false;};
 },[load,key,visible,knownMissing,thumbnail,highQuality]);
 const result=state.key===key?state:{key,src:cached||"",error:""};
 return knownMissing?{key,src:"",error:"Conexão indisponível.",loading:false}:
  {...result,loading:!!cover&&!result.src&&!result.error};
}
