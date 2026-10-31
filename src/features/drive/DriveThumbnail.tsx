import {useEffect,useRef,useState} from "react";
import {LoaderCircle,Play} from "lucide-react";
import {driveKindIcon,isStorageFolder,type DriveItem} from "./DriveLibraryUI";
import {FileTypeArtwork,fileArtwork} from "./FileTypeArtwork";
import {hasDriveThumbnailSource} from "./drive-thumbnail-source";
import {cachedMediaUrl,invalidateStorageFile,loadStorageImage,mediaKey,type MediaIdentity,type MediaProvider} from "./storage-image-cache";

type GetThumbnail=(item:DriveItem,signal?:AbortSignal,accountId?:string)=>Promise<Blob|null>;
type Phase="idle"|"loading"|"loaded"|"unavailable";
type ThumbnailState={key:string;phase:Phase;src:string|null};
const NEGATIVE_TTL=5*60*1000;
const unsupported=new Map<string,number>();
export function clearDriveThumbnailCache(){unsupported.clear();}

function identityFor(item:DriveItem,scope:string,provider:MediaProvider):MediaIdentity{
 const separator=scope.lastIndexOf(":");
 return {uid:scope.slice(0,separator),connectionId:scope.slice(separator+1),
  provider,fileId:item.id,variant:"thumbnail",revision:item.modifiedTime};
}
function initialState(identity:MediaIdentity,available:boolean):ThumbnailState{
 const key=mediaKey(identity);
 const src=available?cachedMediaUrl(identity):null;
 const missing=(unsupported.get(key)||0)>Date.now();
 return {key,src,phase:src?"loaded":available&&!missing?"idle":"unavailable"};
}
/** Visible and near-viewport items share a bounded authenticated image loader.
 * Content always comes through the Worker, never a Google/Dropbox source URL. */
export function DriveThumbnail({item,scope,getThumbnail,provider="google_drive"}:
 {item:DriveItem;scope:string;getThumbnail:GetThumbnail;provider?:MediaProvider}){
 const Icon=driveKindIcon(item.mimeType);
 const artwork=!isStorageFolder(item.mimeType)?fileArtwork(item.name):null;
 const element=useRef<HTMLSpanElement>(null);
 const identity=identityFor(item,scope,provider);
 const key=mediaKey(identity);
 const available=hasDriveThumbnailSource(item)&&!!identity.uid&&!!identity.connectionId;
 const [state,setState]=useState<ThumbnailState>(()=>initialState(identity,available));
 const current=state.key===key?state:initialState(identity,available);
 useEffect(()=>{
  setState(initialState(identity,available));
  if(!available||cachedMediaUrl(identity)||(unsupported.get(key)||0)>Date.now())return;
  let active=true,started=false;
  const load=()=>{
   if(started)return;started=true;
   setState({key,src:null,phase:"loading"});
   void loadStorageImage(identity,async signal=>{
    const blob=await getThumbnail(item,signal,identity.connectionId);
    if(!blob)throw Error("Miniatura não disponível.");
    return blob;
   },{persist:true,priority:1}).then(src=>{
    if(active)setState({key,src,phase:"loaded"});
   }).catch(()=>{
    unsupported.set(key,Date.now()+NEGATIVE_TTL);
    if(unsupported.size>160)unsupported.delete(unsupported.keys().next().value!);
    if(active)setState({key,src:null,phase:"unavailable"});
   });
  };
  if(!element.current||typeof IntersectionObserver==="undefined"){
   load();return()=>{active=false;};
  }
  const observer=new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();load();}
  },{rootMargin:"180px"});
  observer.observe(element.current);
  return()=>{active=false;observer.disconnect();};
 },[key,available,getThumbnail,item.thumbnailTicket,item.thumbnailLink,item.thumbnailFallback]);
 function onImageError(){
  void invalidateStorageFile(identity);
  setState({key,src:null,phase:"unavailable"});
 }
 return <span className={"rl-file-icon"+(current.src?" rl-file-icon--image":"")} ref={element}
  data-mime={item.mimeType} data-thumbnail-state={current.phase}
  title={current.phase==="loading"?"Carregando miniatura":undefined}>
  {current.phase==="loading"
   ?<span className="rl-thumb-loading" aria-hidden="true"><LoaderCircle size={19} className="rl-thumb-loading-spin"/><span>Carregando prévia</span></span>
   :current.src
    ?<img src={current.src} alt="" loading="lazy" decoding="async" onError={onImageError}/>
    :artwork?<FileTypeArtwork name={item.name}/>:<Icon size={20}/>}
  {current.phase!=="loading"&&item.mimeType.startsWith("video/")&&
   <span className="rl-video-mark" aria-hidden="true"><Play size={11} fill="currentColor"/></span>}
 </span>;
}
