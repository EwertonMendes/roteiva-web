import type {InspectedLibrarySource} from '../../../shared/library-selection';
type Item={id:string;name:string;isFolder:boolean;pathLower?:string};
type Page={files:Item[];nextPageToken:string|null};
type Call=<T>(path:string,method?:'GET',data?:undefined,signal?:AbortSignal)=>Promise<T>;
/** Enumerate only Dropbox folders explicitly selected by the account owner.
 * The authenticated Worker continues to enforce account ownership for every page.
 * A partial tree is NEVER silently imported. All limits fail before mutations.
 */
export async function expandDropboxTree(call:Call,connectionId:string,selected:InspectedLibrarySource[],
 folderIds:ReadonlySet<string>,signal:AbortSignal,progress:(folders:number,files:number)=>void):Promise<InspectedLibrarySource[]>{
 const MAX_FOLDERS=80,MAX_FILES=500,MAX_REQUESTS=125;
 const results=new Map(selected.map(s=>[s.provider+':'+s.connectionId+':'+s.fileId,s]));
 const initial=selected.filter(x=>x.kind==='folder'&&folderIds.has(x.fileId));
 const queue=[...initial];
 const explored=new Set<string>();let requests=0;
 const fileCount=()=>Array.from(results.values()).filter(x=>x.kind==='asset').length;
 while(queue.length){
  if(signal.aborted)throw new DOMException('Operação cancelada','AbortError');
  const current=queue.shift()!;
  if(explored.has(current.fileId))continue;
  explored.add(current.fileId);
  if(explored.size>MAX_FOLDERS)throw new Error('Esta seleção ultrapassa 80 pastas. Importe subpastas separadamente para não omitir arquivos.');
  let cursor:string|null=null;
  do{
   if(++requests>MAX_REQUESTS)throw new Error('A árvore é grande demais para uma única operação. Importe por subpastas.');
   const endpoint:string='/integrations/dropbox/'+encodeURIComponent(connectionId)+'/folders/'+encodeURIComponent(current.fileId)+'/items'+
    (cursor?'?pageToken='+encodeURIComponent(cursor):'');
   const listing:Page=await call<Page>(endpoint,'GET',undefined,signal);
   if(!listing||!Array.isArray(listing.files))throw new Error('O Dropbox retornou uma página inválida. Nada foi importado.');
   for(const file of listing.files){
    if(!file||typeof file.id!=='string'||typeof file.name!=='string'||!file.id||!file.name)continue;
    const source:InspectedLibrarySource={provider:'dropbox',connectionId,fileId:file.id,
     kind:file.isFolder?'folder':'asset',name:file.name,parentIds:[],path:file.pathLower};
    const key=source.provider+':'+source.connectionId+':'+source.fileId;
    if(results.has(key))continue;
    results.set(key,source);
    if(file.isFolder)queue.push(source);
   }
   const folders=Array.from(results.values()).filter(x=>x.kind==='folder').length;
   const files=fileCount();progress(folders,files);
   if(folders>MAX_FOLDERS||files>MAX_FILES)
    throw new Error('A seleção ultrapassa o limite seguro de 80 pastas ou 500 arquivos. Selecione subpastas menores; nenhum item foi importado.');
   cursor=listing.nextPageToken||null;
  }while(cursor);
 }
 return [...results.values()];
}
