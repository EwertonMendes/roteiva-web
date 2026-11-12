import {useCallback,useEffect,useRef,useState} from 'react';
import {AppButton} from '../ui/AppButton';
import {AppInput} from '../ui/AppInput';
import {useDriveApi} from './drive-api';
import {useOverlayFocus} from './DriveLibraryUI';
import {useAuth} from '../auth/AuthProvider';
import {cacheKey,getCachedFolder,setCachedFolder,onceFolderRequest} from './storage-folder-cache';
type Item={id:string;name:string;isFolder:boolean};
type Page={files:Item[];nextPageToken:string|null};
/** Selection survives folder navigation, but is never itself an authorization grant. */
export function DropboxLibraryPicker({connectionId,onClose,onSelect,includeFolders=false}:{connectionId:string;onClose:()=>void;onSelect:(ids:string[],names:Map<string,string>,folders:Set<string>)=>void;includeFolders?:boolean}){
 const call=useDriveApi(),dialogRef=useOverlayFocus(onClose),{user}=useAuth();
 const [trail,setTrail]=useState([{id:'root',name:'Meu Dropbox'}]),[loaded,setPage]=useState<(Page&{scope:string})|null>(null);
 const [selected,setSelected]=useState<Map<string,string>>(new Map()),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),folder=trail.at(-1)!.id;
 const selectedFolders=useRef(new Set<string>());
 const scope=cacheKey(user?.uid||'anonymous',connectionId,folder,'library-picker','','dropbox');
 const stored=getCachedFolder(scope);
 const page=loaded?.scope===scope?loaded:stored?{files:stored.files as unknown as Item[],nextPageToken:stored.nextPageToken,scope}:null;
 const load=useCallback(async(cursor?:string)=>{
  const g=++generation.current;
  const cached=getCachedFolder(scope);
  // Revisit recently opened folders without another provider request.
  if(!cursor&&cached&&Date.now()-cached.fetchedAt<45_000){
   setPage({files:cached.files as unknown as Item[],nextPageToken:cached.nextPageToken,scope});
   setBusy(false);setError('');return;
  }
  if(!cached||cursor)setBusy(true);
  setError('');
  try{
   const endpoint='/integrations/dropbox/'+connectionId+'/folders/'+encodeURIComponent(folder)+'/items'+
    (cursor?'?pageToken='+encodeURIComponent(cursor):'');
   const result=await onceFolderRequest(scope+':'+(cursor||'first'),()=>call<Page>(endpoint));
   if(g!==generation.current)return;
   setPage(old=>{
    const prev=old?.scope===scope?old:cached?{files:cached.files as unknown as Item[],nextPageToken:cached.nextPageToken,scope}:null;
    const next={...result,scope,files:cursor&&prev?[...prev.files,...result.files]:result.files};
    setCachedFolder(scope,{files:next.files as never,nextPageToken:next.nextPageToken});
    return next;
   });
  }catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Não foi possível abrir esta pasta.');}
  finally{if(g===generation.current)setBusy(false);}
 },[call,connectionId,folder,scope]);
 useEffect(()=>{
  const cached=getCachedFolder(scope);
  setPage(cached?{files:cached.files as unknown as Item[],nextPageToken:cached.nextPageToken,scope}:null);
  void load();return()=>{++generation.current;};
 },[load,scope]);
 return <div className="virtual-library-backdrop"><div ref={dialogRef} tabIndex={-1} className="virtual-library-editor" role="dialog" aria-modal="true" aria-labelledby="dropbox-library-title">
 <h3 id="dropbox-library-title">Adicionar do Dropbox</h3><p>Escolha até 100 {includeFolders?'pastas e arquivos':'arquivos'}. A seleção permanece ao navegar pelas pastas.{includeFolders?' A importação poderá incluir as subpastas e arquivos da pasta selecionada; revise o resumo antes de confirmar.':''}</p>
 <nav aria-label="Pastas do Dropbox">{trail.map((p,i)=><AppButton key={p.id} disabled={busy} onClick={()=>setTrail(x=>x.slice(0,i+1))}>{p.name}</AppButton>)}</nav>
 {error&&<div role="alert" className="virtual-library-error">{error}<AppButton onClick={()=>void load()}>Tentar novamente</AppButton></div>}
 <ul className="virtual-library-nodes">{page?.files.map(file=><li key={file.id}>{file.isFolder?<>{includeFolders&&<AppInput type="checkbox" aria-label={'Selecionar pasta '+file.name} checked={selected.has(file.id)} disabled={!selected.has(file.id)&&selected.size>=100} onChange={()=>setSelected(old=>{const next=new Map(old);if(next.has(file.id)){next.delete(file.id);selectedFolders.current.delete(file.id);}else{next.set(file.id,file.name);selectedFolders.current.add(file.id);}return next;})}/>}<AppButton disabled={busy} onClick={()=>setTrail(x=>[...x,{id:file.id,name:file.name}])}>{file.name}</AppButton></>:<label><AppInput type="checkbox" checked={selected.has(file.id)} disabled={!selected.has(file.id)&&selected.size>=100} onChange={()=>setSelected(old=>{const next=new Map(old);if(next.has(file.id))next.delete(file.id);else if(next.size<100)next.set(file.id,file.name);return next;})}/>{file.name}</label>}</li>)}</ul>
 {busy&&<p role="status">Carregando…</p>}{page&&!page.files.length&&!busy&&<p>Esta pasta está vazia.</p>}
 {page?.nextPageToken&&<AppButton disabled={busy} onClick={()=>void load(page.nextPageToken!)}>Carregar mais</AppButton>}
 <p role="status">{selected.size} arquivo(s) selecionado(s)</p>
 <div className="virtual-library-toolbar"><AppButton disabled={!selected.size} onClick={()=>onSelect(Array.from(selected.keys()),selected,new Set(selectedFolders.current))}>Adicionar selecionados</AppButton><AppButton onClick={onClose}>Cancelar</AppButton></div>
 </div></div>;
}
