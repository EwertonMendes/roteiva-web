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

/** Dropbox's signed media endpoint intentionally returns at most 8 MiB per request
 * for native PDF files. Assemble and verify every byte before exposing a blob
 * to the browser PDF viewer; a partial PDF often looks like a broken preview.
 * Dropbox Office conversion is a separate, non-range PDF stream. */
export async function fetchDropboxDocument(call:Api,link:DropboxFolderLink,file:DriveItem,
 signal:AbortSignal,limit=VIEWER_BYTES):Promise<Blob>{
 const ticket=await call<Ticket>('/integrations/dropbox/'+encodeURIComponent(link.connectionId)+'/preview-ticket','POST',{
  fileId:file.id,projectId:link.projectId,linkedFolderId:link.folderId
 });
 const url=new URL(ticket.url);
 if(url.origin!==API_ORIGIN||url.pathname!=='/integrations/dropbox/media'||
  ticket.mimeType!=='application/pdf')throw Error('A prévia retornada pelo Dropbox não é um documento PDF confiável.');
 const original=/\.pdf$/i.test(file.name);
 if(!Number.isSafeInteger(ticket.size)||ticket.size<0)throw Error('Tamanho da prévia inválido.');
 if(original&&ticket.size>limit)throw Error('Este documento é muito grande para uma prévia rápida.');

 const chunkSize=8*1024*1024;
 const rangeDownload=original&&ticket.size>chunkSize;
 const parts:Uint8Array[]=[];
 let total=0;
 for(let start=0;start<(rangeDownload?ticket.size:1);start+=chunkSize){
  if(signal.aborted)throw new DOMException('Prévia cancelada.','AbortError');
  const end=Math.min(start+chunkSize,ticket.size)-1;
  const headers:Record<string,string>={Accept:'application/pdf'};
  if(rangeDownload)headers.Range='bytes='+start+'-'+end;
  const response=await fetch(url.toString(),{signal,cache:'no-store',headers});
  if(!response.ok)throw Error('Não foi possível carregar a prévia do documento pelo Dropbox.');
  if(response.headers.get('Content-Type')?.split(';')[0]?.trim()!=='application/pdf'){
   await response.body?.cancel();
   throw Error('O Dropbox não retornou um PDF válido para esta prévia.');
  }
  if(rangeDownload){
   const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')||'');
   if(response.status!==206||!match||Number(match[1])!==start||
      Number(match[2])!==end||Number(match[3])!==ticket.size){
    await response.body?.cancel();
    throw Error('O Dropbox retornou um intervalo inválido do PDF.');
   }
  }else if(response.status!==200){
   await response.body?.cancel();
   throw Error('O Dropbox retornou uma prévia incompleta.');
  }
  const reported=Number(response.headers.get('Content-Length')||0);
  if(reported>limit-total||(rangeDownload&&reported>0&&reported!==end-start+1)){
   await response.body?.cancel();
   throw Error('Prévia indisponível: tamanho do documento inválido.');
  }
  if(!response.body)throw Error('A prévia retornada não possui conteúdo.');
  const reader=response.body.getReader();
  let received=0;
  try{
   while(true){
    const {done,value}=await reader.read();if(done)break;
    total+=value.byteLength;received+=value.byteLength;
    if(total>limit||(rangeDownload&&received>end-start+1)){
     await reader.cancel();
     throw Error('Prévia indisponível: arquivo convertido muito grande ou inválido.');
    }
    parts.push(value);
   }
  }finally{reader.releaseLock()}
  if(rangeDownload&&received!==end-start+1)
   throw Error('O Dropbox retornou um intervalo incompleto do PDF.');
 }
 if(original&&total!==ticket.size)throw Error('O Dropbox retornou um PDF incompleto.');
 return new Blob(parts as BlobPart[],{type:'application/pdf'});
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
