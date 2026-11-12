import {useCallback,useEffect,useRef,useState} from 'react';
import {useDriveApi} from '../drive/drive-api';
import {AppButton} from '../ui/AppButton';
import {AppInput} from '../ui/AppInput';
export type ReviewLibraryItem={id:string;asset_id:string;name:string;mime_type:string;provider:'google_drive'|'dropbox';kind:'folder'|'asset'};
type Page={nodes:ReviewLibraryItem[];trail:{id:string;name:string}[];nextPage:string|null};
export function LibraryReviewSelector({projectId,selected,onToggle}:{projectId:number;selected:string[];onToggle:(item:ReviewLibraryItem)=>void}){
 const call=useDriveApi(),[parent,setParent]=useState('root'),[loaded,setPage]=useState<(Page&{scope:string})|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),seq=useRef(0);
 const scope=projectId+':'+parent,page=loaded?.scope===scope?loaded:null;
 const load=useCallback(async(after?:string)=>{
 if(!projectId)return;const s=++seq.current;setBusy(true);setError('');
 try{const result=await call<Page>('/library/projects/'+projectId+'/nodes?parent='+parent+(after?'&after='+after:''));if(s===seq.current)setPage(old=>({...result,scope,nodes:after&&old?.scope===scope?[...old.nodes,...result.nodes]:result.nodes}));}
 catch(e){if(s===seq.current)setError(e instanceof Error?e.message:'Não foi possível carregar os materiais.');}
 finally{if(s===seq.current)setBusy(false);}
 },[projectId,parent,call,scope]);
 useEffect(()=>{setParent('root');setPage(null);++seq.current;},[projectId]);
 useEffect(()=>{setPage(null);void load();return()=>{++seq.current;};},[load]);
 if(!projectId)return <p>Selecione um projeto para escolher os materiais.</p>;
 return <section aria-label="Materiais da Biblioteca virtual"><nav aria-label="Pasta dos materiais">{page?.trail.map(x=><AppButton key={x.id} disabled={busy} onClick={()=>setParent(x.id)}>{x.name}</AppButton>)}</nav>
 {error&&<p role="alert">{error}<AppButton onClick={()=>void load()}>Tentar novamente</AppButton></p>}
 {busy&&<p role="status">Carregando materiais…</p>}
 <ul className="virtual-library-nodes">{page?.nodes.map(node=><li key={node.id}>{node.kind==='folder'?<AppButton disabled={busy} onClick={()=>setParent(node.id)}>{node.name}</AppButton>:<label><AppInput type="checkbox" checked={selected.includes(node.asset_id)} disabled={!(/^(image|video|audio)\//.test(node.mime_type)||node.mime_type==='application/pdf')||selected.length>=8&&!selected.includes(node.asset_id)} onChange={()=>onToggle(node)}/>{node.name} · {node.provider==='dropbox'?'Dropbox':'Drive'}</label>}</li>)}</ul>
 {page&&!page.nodes.length&&!busy&&<p>Esta pasta ainda não possui materiais. Adicione os arquivos na Biblioteca.</p>}
 {page?.nextPage&&<AppButton disabled={busy} onClick={()=>void load(page.nextPage!)}>Carregar mais</AppButton>}
 </section>;
}
