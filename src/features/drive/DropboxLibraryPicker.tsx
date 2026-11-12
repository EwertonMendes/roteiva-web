import {useCallback,useEffect,useRef,useState} from 'react';
import {AppButton} from '../ui/AppButton';
import {AppInput} from '../ui/AppInput';
import {useDriveApi} from './drive-api';
import {useOverlayFocus} from './DriveLibraryUI';
type Item={id:string;name:string;isFolder:boolean};
type Page={files:Item[];nextPageToken:string|null};
/** Selection survives folder navigation, but is never itself an authorization grant. */
export function DropboxLibraryPicker({connectionId,onClose,onSelect,includeFolders=false}:{connectionId:string;onClose:()=>void;onSelect:(ids:string[],names:Map<string,string>,folders:Set<string>)=>void;includeFolders?:boolean}){
 const call=useDriveApi(),dialogRef=useOverlayFocus(onClose);
 const [trail,setTrail]=useState([{id:'root',name:'Meu Dropbox'}]),[loaded,setPage]=useState<(Page&{scope:string})|null>(null);
 const [selected,setSelected]=useState<Map<string,string>>(new Map()),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),folder=trail.at(-1)!.id;
 const selectedFolders=useRef(new Set<string>());
 const scope=connectionId+':'+folder,page=loaded?.scope===scope?loaded:null;
 const load=useCallback(async(cursor?:string)=>{
 const g=++generation.current;setBusy(true);setError('');
 try{const result=await call<Page>('/integrations/dropbox/'+connectionId+'/folders/'+encodeURIComponent(folder)+'/items'+(cursor?'?pageToken='+encodeURIComponent(cursor):''));
 if(g===generation.current)setPage(old=>({...result,scope,files:cursor&&old?.scope===scope?[...old.files,...result.files]:result.files}));
 }catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Não foi possível abrir esta pasta.');}
 finally{if(g===generation.current)setBusy(false);}
 },[call,connectionId,folder,scope]);
 useEffect(()=>{setPage(null);void load();return()=>{++generation.current;};},[load]);
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
