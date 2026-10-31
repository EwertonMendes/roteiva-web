import {createContext,useContext,useCallback,useEffect,useRef,useState,type ReactNode} from "react";
import {useAuth} from "../auth/AuthProvider";
import {useStorageConnections,type StorageConnection} from "../drive/StorageConnectionsProvider";
import {cachedMediaUrl,loadStorageImage,type MediaIdentity} from "../drive/storage-image-cache";
import type {ProjectCover} from "../../domain/workspace";

export type CoverConnection={id:string;google_email:string;status:string;scopes:string;provider:"google_drive"|"dropbox"};
type Context={
 connections:CoverConnection[];error:string;loadingConnections:boolean;
 retryConnections:()=>void;uid:string;
 load:(cover:ProjectCover,thumbnail?:boolean)=>Promise<string>;
};
const CoverContext=createContext<Context|null>(null);
const API="https://roteiva-api-dev.ewertonmendes9.workers.dev";
function coverIdentity(uid:string,cover:ProjectCover,thumbnail:boolean):MediaIdentity{
 return {uid,provider:cover.provider==="dropbox"?"dropbox":"google_drive",
  connectionId:cover.connectionId,fileId:cover.fileId,
  revision:cover.modifiedTime,variant:thumbnail?"thumbnail":"original"};
}
export function DriveCoversProvider({children,includeDropbox=false}:{children:ReactNode;includeDropbox?:boolean}){
 const {user}=useAuth();
 const storage=useStorageConnections();
 const connections:CoverConnection[]=storage.connections
  .filter(c=>c.status==="connected"&&(includeDropbox||c.provider==="google_drive"))
  .map((c:StorageConnection)=>({id:c.id,google_email:c.email,status:c.status,scopes:c.scopes,provider:c.provider}));
 const retryConnections=useCallback(()=>{void storage.refresh(true);},[storage.refresh]);
 const load=useCallback(async(cover:ProjectCover,thumbnail=false)=>{
  if(!user)throw new Error("Entre novamente para carregar a imagem.");
  const identity=coverIdentity(user.uid,cover,thumbnail);
  return loadStorageImage(identity,async signal=>{
   const provider=identity.provider==="dropbox"?"dropbox":"drive";
   const path=API+"/integrations/"+provider+"/"+encodeURIComponent(cover.connectionId)+
    "/files/"+encodeURIComponent(cover.fileId)+(thumbnail?"/thumbnail":"/cover");
   let response:Response|undefined;
   for(let attempt=0;attempt<2;attempt++){
    const token=await user.getIdToken(attempt===1);
    response=await fetch(path,{headers:{Authorization:"Bearer "+token},cache:"no-store",signal});
    if(response.status!==401)break;
   }
   if(!response?.ok||response.status===204)throw Error("Imagem indisponível. Confira o arquivo e a conexão de armazenamento.");
   const mime=(response.headers.get("Content-Type")||"").split(";")[0].toLowerCase();
   if(!["image/jpeg","image/png","image/webp","image/avif"].includes(mime))
    throw Error("Formato de imagem não suportado.");
   const blob=await response.blob();
   return blob.type===mime?blob:new Blob([blob],{type:mime});
  },{persist:thumbnail,priority:thumbnail?1:2});
 },[user]);
 return <CoverContext.Provider value={{connections,error:storage.error&&(includeDropbox||storage.error.includes("Google Drive"))?("Não foi possível consultar "+storage.error+"."): "",
  loadingConnections:storage.loading,retryConnections,uid:user?.uid||"",load}}>{children}</CoverContext.Provider>;
}
export const useDriveCovers=()=>useContext(CoverContext);
export function useCoverImage(cover:ProjectCover|undefined,visible=true,thumbnail=false){
 const context=useDriveCovers();
 const identity=cover&&context?.uid?coverIdentity(context.uid,cover,thumbnail):null;
 const key=identity?JSON.stringify(identity):"";
 const [state,setState]=useState({key:"",src:"",error:""});
 const load=context?.load;
 const selected=useRef(cover);selected.current=cover;
 const connected=!!context?.connections.some(c=>c.id===cover?.connectionId&&c.provider===(cover?.provider||"google_drive"));
 const cached=identity&&connected?cachedMediaUrl(identity):null;
 useEffect(()=>{
  if(!load||!selected.current||!visible||!connected)return;
  let active=true;
  setState({key,src:cachedMediaUrl(coverIdentity(context!.uid,selected.current,thumbnail))||"",error:""});
  void load(selected.current,thumbnail).then(src=>{if(active)setState({key,src,error:""});})
   .catch(e=>{if(active)setState({key,src:"",error:e instanceof Error?e.message:"Imagem indisponível."});});
  return ()=>{active=false;};
 },[load,key,visible,connected,thumbnail]);
 return connected?state.key===key?state:{key,src:cached||"",error:""}:{key,src:"",error:context?.loadingConnections?"":"Conexão indisponível."};
}
