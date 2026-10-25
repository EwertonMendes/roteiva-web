import {useDriveApi} from '../drive/drive-api';
import type {DriveItem} from '../drive/DriveLibraryUI';
import type {DropboxFolderLink} from '../../data/dropbox-folder-links';

type Ticket={url:string;mimeType:string;size:number;expiresAt:number};
type Api=ReturnType<typeof useDriveApi>;
const API_ORIGIN='https://roteiva-api-dev.ewertonmendes9.workers.dev';
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

