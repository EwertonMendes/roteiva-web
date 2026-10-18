import {useEffect, useRef, useState} from "react";
import {Play} from "lucide-react";
import {driveKindIcon, type DriveItem, DRIVE_FOLDER} from "./DriveLibraryUI";

type GetThumbnail = (item:DriveItem)=>Promise<Blob|null>;
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

/** Lazy thumbnail only when the row/card intersects the viewport; graceful icon fallback. */
export function DriveThumbnail({item,scope,getThumbnail}:{item:DriveItem;scope:string;getThumbnail:GetThumbnail}){
  const Icon=driveKindIcon(item.mimeType);
  const ref=useRef<HTMLSpanElement>(null);
  const key=scope+":"+item.id+":"+(item.modifiedTime||"");
  const available=Boolean(item.thumbnailLink) && item.mimeType!==DRIVE_FOLDER;
  const [src,setSrc]=useState<string|null>(()=>cache.get(key)||null);
  useEffect(()=>{
    setSrc(cache.get(key)||null);
    if(!available)return;
    let live=true;
    const load=()=>{
      void resolveThumbnail(key,item,getThumbnail).then(url=>{if(live)setSrc(url);});
    };
    if(!ref.current || typeof IntersectionObserver==="undefined"){load();return ()=>{live=false;};}
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();load();}
    },{rootMargin:"160px"});
    observer.observe(ref.current);
    return ()=>{live=false;observer.disconnect();};
  },[key,available,getThumbnail]);
  return <span className={"rl-file-icon"+(src?" rl-file-icon--image":"")} ref={ref} data-mime={item.mimeType}>
    {src?<img src={src} alt="" loading="lazy" decoding="async"/>:<Icon size={20}/>}
    {item.mimeType.startsWith("video/")&&<span className="rl-video-mark" aria-hidden="true"><Play size={11} fill="currentColor"/></span>}
  </span>;
}
