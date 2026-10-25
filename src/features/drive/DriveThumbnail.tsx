import {useEffect, useRef, useState} from "react";
import {LoaderCircle, Play} from "lucide-react";
import {driveKindIcon,isStorageFolder, type DriveItem} from "./DriveLibraryUI";
import {FileTypeArtwork,fileArtwork} from "./FileTypeArtwork";
import {hasDriveThumbnailSource} from "./drive-thumbnail-source";

type GetThumbnail = (item:DriveItem,signal?:AbortSignal,accountId?:string)=>Promise<Blob|null>;
type Phase = "idle"|"loading"|"loaded"|"unavailable";
type ThumbnailState={key:string;phase:Phase;src:string|null};
const MAX_CACHE=64;
const MAX_CONCURRENT=6;
const NEGATIVE_TTL=10*60*1000;
const unsupported=new Map<string,number>();
const cache=new Map<string,string>();
const pending=new Map<string,Promise<string|null>>();
type Queued={key:string;priority:number;run:()=>void;cancel:()=>void;controller:AbortController};
const tasks:Queued[]=[];
const active=new Set<AbortController>();
let running=0;
let generation=0;

function runNext(){
  // Visible thumbnails outrank near-viewport prefetches even when scrolled rapidly.
  while(running<MAX_CONCURRENT&&tasks.length){
    tasks.sort((a,b)=>b.priority-a.priority);
    const task=tasks.shift()!;
    if(task.controller.signal.aborted)continue;
    running++;active.add(task.controller);task.run();
  }
}
function promote(key:string){
  for(const task of tasks)if(task.key===key)task.priority=2;
}
function enqueue<T>(key:string,operation:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController();
  return new Promise((resolve,reject)=>{
    tasks.push({key,priority:1,controller,cancel:()=>resolve(null as T),run:()=>{
      operation(controller.signal).then(resolve,reject).finally(()=>{
        active.delete(controller);running--;runNext();
      });
    }});
    runNext();
  });
}
export function clearDriveThumbnailCache(){
  generation++;
  for(const task of tasks){task.controller.abort();task.cancel();}
  tasks.splice(0);
  for(const controller of active)controller.abort();
  for(const url of cache.values())URL.revokeObjectURL(url);
  cache.clear();pending.clear();unsupported.clear();
}

function resolveThumbnail(key:string,item:DriveItem,getThumbnail:GetThumbnail,accountId:string):Promise<string|null>{
  if(cache.has(key))return Promise.resolve(cache.get(key)!);
  if((unsupported.get(key)||0)>Date.now())return Promise.resolve(null);
  unsupported.delete(key);
  const existing=pending.get(key);
  if(existing)return existing;
  const epoch=generation;
  const operation=enqueue(key,async(signal)=>{
    if(epoch!==generation)return null;
    try {
      const blob=await getThumbnail(item,signal,accountId);
      if(epoch!==generation)return null;
      if(!blob){
        // A provider with no thumbnail should not be retried on every toggle.
        // File revisions have their own cache identity via modifiedTime.
        unsupported.set(key,Date.now()+NEGATIVE_TTL);
        if(unsupported.size>128)unsupported.delete(unsupported.keys().next().value!);
        return null;
      }
      if(blob.size===0 || blob.size>1024*1024 || !blob.type.startsWith("image/"))return null;
      const objectUrl=URL.createObjectURL(blob);
      cache.set(key,objectUrl);
      if(cache.size>MAX_CACHE){
        const oldest=cache.keys().next().value;
        if(oldest){URL.revokeObjectURL(cache.get(oldest)!);cache.delete(oldest);}
      }
      return objectUrl;
    }catch{return null;}
  }).finally(()=>{if(pending.get(key)===operation)pending.delete(key);});
  pending.set(key,operation);
  return operation;
}

function initialState(key:string,available:boolean):ThumbnailState{
  const src=available?cache.get(key)||null:null;
  const missing=(unsupported.get(key)||0)>Date.now();
  return {key,src,phase:src?"loaded":available&&!missing?"idle":"unavailable"};
}

/** Keep an icon when offscreen; display a spinner only during the actual request.
 * thumbnailFallback uses the authenticated metadata-based endpoint for review
 * assets without ephemeral tickets; it never embeds Google's private URL. */
export function DriveThumbnail({item,scope,getThumbnail}:{item:DriveItem;scope:string;getThumbnail:GetThumbnail}){
  const Icon=driveKindIcon(item.mimeType);
  const artwork=!isStorageFolder(item.mimeType)?fileArtwork(item.name):null;
  const ref=useRef<HTMLSpanElement>(null);
  const key=scope+":"+item.id+":"+(item.modifiedTime||"");
  const available=hasDriveThumbnailSource(item);
  const [state,setState]=useState<ThumbnailState>(()=>initialState(key,available));
  // Avoid showing an image belonging to a previous item if React reuses the component.
  const current=state.key===key?state:initialState(key,available);
  useEffect(()=>{
    const cached=initialState(key,available);
    setState(cached);
    if(!available || cached.phase==="loaded" || cached.phase==="unavailable")return;
    let active=true;
    let started=false;
    const load=()=>{
      if(started)return;
      started=true;
      setState({key,src:null,phase:"loading"});
      void resolveThumbnail(key,item,getThumbnail,scope.slice(scope.lastIndexOf(':')+1)).then(url=>{
        if(active)setState({key,src:url,phase:url?"loaded":"unavailable"});
      });
    };
    if(!ref.current || typeof IntersectionObserver==="undefined"){
      load();
      return ()=>{active=false;};
    }
    const prefetch=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){prefetch.disconnect();load();}
    },{rootMargin:"180px"});
    const visible=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){
        visible.disconnect();
        load();
        promote(key);
      }
    });
    prefetch.observe(ref.current);
    visible.observe(ref.current);
    return ()=>{active=false;prefetch.disconnect();visible.disconnect();};
  },[key,available,getThumbnail,item.thumbnailTicket,item.thumbnailLink,item.thumbnailFallback]);

  function handleImageError(){
    if(current.src && cache.get(key)===current.src){
      cache.delete(key);
      URL.revokeObjectURL(current.src);
    }
    setState({key,src:null,phase:"unavailable"});
  }
  return <span className={"rl-file-icon"+(current.src?" rl-file-icon--image":"")} ref={ref}
    data-mime={item.mimeType} data-thumbnail-state={current.phase}
    title={current.phase==="loading"?"Carregando miniatura":undefined}>
    {current.phase==="loading"
      ? <span className="rl-thumb-loading" aria-hidden="true"><LoaderCircle size={19} className="rl-thumb-loading-spin"/><span>Carregando prévia</span></span>
      :current.src
        ? <img src={current.src} alt="" loading="lazy" decoding="async" onError={handleImageError}/>
         :artwork?<FileTypeArtwork name={item.name}/>:<Icon size={20}/>}
    {current.phase!=="loading" && item.mimeType.startsWith("video/") &&
      <span className="rl-video-mark" aria-hidden="true"><Play size={11} fill="currentColor"/></span>}
  </span>;
}
