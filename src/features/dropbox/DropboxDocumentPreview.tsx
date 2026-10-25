import {useEffect,useRef,useState} from 'react';
import {FileText,LoaderCircle} from 'lucide-react';
import {useDriveApi} from '../drive/drive-api';
import type {DriveItem} from '../drive/DriveLibraryUI';
import type {DropboxFolderLink} from '../../data/dropbox-folder-links';

type Ticket={url:string;mimeType:string;size:number;expiresAt:number};
type Api=ReturnType<typeof useDriveApi>;
const API_ORIGIN='https://roteiva-api-dev.ewertonmendes9.workers.dev';
const THUMBNAIL_BYTES=14*1024*1024;
const VIEWER_BYTES=48*1024*1024;
const DOCUMENT=/\.(pdf|pptx?|ppsx?|docx?|rtf|odp|odt)$/i;
export const isDropboxDocument=(file:DriveItem)=>DOCUMENT.test(file.name)&&file.mimeType!=='application/vnd.roteiva.folder';

export async function fetchDropboxDocument(call:Api,link:DropboxFolderLink,file:DriveItem,
 signal:AbortSignal,limit=VIEWER_BYTES):Promise<Blob>{
 const ticket=await call<Ticket>('/integrations/dropbox/'+encodeURIComponent(link.connectionId)+'/preview-ticket','POST',{
  fileId:file.id,projectId:link.projectId,linkedFolderId:link.folderId
 });
 const url=new URL(ticket.url);
 if(url.origin!==API_ORIGIN||url.pathname!=='/integrations/dropbox/media'||
  ticket.mimeType!=='application/pdf')throw Error('A prévia retornada pelo Dropbox não é um documento PDF confiável.');
 if(ticket.size>limit&&file.name.toLowerCase().endsWith('.pdf'))
  throw Error('Este documento é muito grande para uma prévia rápida.');
 const response=await fetch(url.toString(),{signal,cache:'no-store',headers:{Accept:'application/pdf'}});
 if(!response.ok)throw Error('Não foi possível carregar a prévia do documento pelo Dropbox.');
 if(response.headers.get('Content-Type')?.split(';')[0]?.trim()!=='application/pdf')
  throw Error('O Dropbox não retornou um PDF válido para esta prévia.');
 if(Number(response.headers.get('Content-Length')||0)>limit){
  await response.body?.cancel();throw Error('Prévia indisponível: arquivo convertido muito grande.');
 }
 if(!response.body)throw Error('A prévia retornada não possui conteúdo.');
 const reader=response.body.getReader();
 const chunks:Uint8Array[]=[];
 let count=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   count+=value.byteLength;
   if(count>limit){await reader.cancel();throw Error('Prévia indisponível: arquivo convertido muito grande.');}
   chunks.push(value);
  }
 }finally{reader.releaseLock()}
 return new Blob(chunks as BlobPart[],{type:'application/pdf'});
}

/** Lazy PDF first-page preview. Browser PDF rendering is isolated in a blob
 * iframe; no OAuth token or original Dropbox download URL enters the DOM. */
export function DropboxDocumentThumbnail({file,link}:{file:DriveItem;link:DropboxFolderLink}){
 const call=useDriveApi(),ref=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(false);
 const [src,setSrc]=useState<string|null>(null);
 const [failed,setFailed]=useState(false);
 useEffect(()=>{
  const node=ref.current;if(!node)return;
  const io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);io.disconnect()}},
   {rootMargin:'120px'});
  io.observe(node);return()=>io.disconnect();
 },[file.id,link.id]);
 useEffect(()=>{
  if(!visible)return;
  const controller=new AbortController();let url:string|null=null;
  setSrc(null);setFailed(false);
  void fetchDropboxDocument(call,link,file,controller.signal,THUMBNAIL_BYTES)
   .then(blob=>{if(controller.signal.aborted)return;
    url=URL.createObjectURL(blob);setSrc(url)})
   .catch(()=>{if(!controller.signal.aborted)setFailed(true)});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url)};
 },[visible,call,link.connectionId,link.folderId,link.projectId,link.id,file.id,file.name]);
 return <div ref={ref} className="rl-document-thumbnail" aria-label={'Miniatura de '+file.name}>
  {src?<iframe src={src+'#page=1&toolbar=0&navpanes=0&scrollbar=0&view=FitH'}
    title={'Primeira página de '+file.name} tabIndex={-1} aria-hidden="true" loading="lazy"/>:
   failed?<FileText size={27} aria-hidden="true"/>:
   <LoaderCircle className="rl-spin" size={20} aria-hidden="true"/>}
 </div>;
}
