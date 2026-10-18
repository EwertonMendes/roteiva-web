import {useEffect, useRef, useState} from "react";
import {LoaderCircle, Play} from "lucide-react";
import {driveKindIcon, type DriveItem, DRIVE_FOLDER} from "./DriveLibraryUI";

type GetThumbnail = (item:DriveItem)=>Promise<Blob|null>;
type Phase = "idle"|"loading"|"loaded"|"unavailable";
type ThumbnailState={key:string;phase:Phase;src:string|null};
const MAX_CACHE=48;
const MAX_CONCURRENT=4;
const cache=new Map<string,string>();
const pending=new Map<string,Promise<string|null>>();
const tasks:Array<()=>void>=[];
let running=0;
let generation=0;

function runNext(){
  while(running<MAX_CONCURRENT && tasks.length){
    const task=tasks.shift();
    if(task){running++;task();}
  }
}
function enqueue<T>(operation:()=>Promise<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
    tasks.push(()=>{
      operation().then(resolve,reject).finally(()=>{running--;runNext();});
    });
    runNext();
  });
}

/** No persistence of Google Drive binaries: bound object URLs to the current browser session. */
export function clearDriveThumbnailCache(){
  generation++;
  for(const url of cache.values())URL.revokeObjectURL(url);
  cache.clear();pending.clear();
}

function resolveThumbnail(key:string,item:DriveItem,getThumbnail:GetThumbnail):Promise<string|null>{
  if(cache.has(key))return Promise.resolve(cache.get(key)!);
  const existing=pending.get(key);
  if(existing)return existing;
  const epoch=generation;
  const operation=enqueue(async()=>{
    if(epoch!==generation)return null;
    try {
      const blob=await getThumbnail(item);
      if(epoch!==generation || !blob || blob.size===0 || blob.size>1024*1024 || !blob.type.startsWith("image/"))return null;
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
  return {key,src,phase:src?"loaded":available?"idle":"unavailable"};
}

/** Keep an icon when offscreen; display a spinner only during the actual request. */
export function DriveThumbnail({item,scope,getThumbnail}:{item:DriveItem;scope:string;getThumbnail:GetThumbnail}){
  const Icon=driveKindIcon(item.mimeType);
  const ref=useRef<HTMLSpanElement>(null);
  const key=scope+":"+item.id+":"+(item.modifiedTime||"");
  const available=Boolean(item.thumbnailLink) && item.mimeType!==DRIVE_FOLDER;
  const [state,setState]=useState<ThumbnailState>(()=>initialState(key,available));
  // Avoid showing an image belonging to a previous item if React reuses the component.
  const current=state.key===key?state:initialState(key,available);
  useEffect(()=>{
    const cached=initialState(key,available);
    setState(cached);
    if(!available || cached.phase==="loaded")return;
    let active=true;
    let started=false;
    const load=()=>{
      if(started)return;
      started=true;
      setState({key,src:null,phase:"loading"});
      void resolveThumbnail(key,item,getThumbnail).then(url=>{
        if(active)setState({key,src:url,phase:url?"loaded":"unavailable"});
      });
    };
    if(!ref.current || typeof IntersectionObserver==="undefined"){
      load();
      return ()=>{active=false;};
    }
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();load();}
    },{rootMargin:"160px"});
    observer.observe(ref.current);
    return ()=>{active=false;observer.disconnect();};
  },[key,available,getThumbnail]);

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
        :<Icon size={20}/>}
    {current.phase!=="loading" && item.mimeType.startsWith("video/") &&
      <span className="rl-video-mark" aria-hidden="true"><Play size={11} fill="currentColor"/></span>}
  </span>;
}
