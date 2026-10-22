import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,LoaderCircle,RotateCcw,Search,Trash2,X} from 'lucide-react';
import type {Project,ProjectCover} from '../../domain/workspace';
import {useDriveApi} from '../drive/drive-api';
import type {DriveItem} from '../drive/DriveLibraryUI';
import {DriveThumbnail} from '../drive/DriveThumbnail';
import {useDriveThumbnailFetch} from '../drive/useDriveThumbnailFetch';
import {useCoverImage,useDriveCovers} from './DriveCoversProvider';
import {CoverFrame} from './CoverFrame';
type Page={files:DriveItem[];nextPageToken:string|null;incompleteSearch?:boolean};
export function CoverEditor({project,onClose,onSave}:{project:Project;onClose:()=>void;onSave:(cover:ProjectCover|undefined)=>void}){
 const context=useDriveCovers()!;const call=useDriveApi();const getThumbnail=useDriveThumbnailFetch();
 const dialog=useRef<HTMLDialogElement>(null);
 const existingConnection=context.connections.some(c=>c.id===project.cover?.connectionId);
 const [account,setAccount]=useState(existingConnection?project.cover!.connectionId:context.connections[0]?.id||'');
 const [cover,setCover]=useState<ProjectCover|undefined>(project.cover);
 const [choosing,setChoosing]=useState(!project.cover||!existingConnection);
 const [search,setSearch]=useState('');const [term,setTerm]=useState('');
 const [page,setPage]=useState<Page>({files:[],nextPageToken:null});const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [moreToken,setMoreToken]=useState('');const [retry,setRetry]=useState(0);const {src,error:imageError}=useCoverImage(cover);
 const currentAccount=context.connections.find(c=>c.id===account);
 const canRead=currentAccount?.scopes.split(' ').includes('https://www.googleapis.com/auth/drive.readonly');
 const thumbnail=useCallback((file:DriveItem,signal?:AbortSignal)=>getThumbnail(file,signal,account),[getThumbnail,account]);
 useEffect(()=>{const el=dialog.current!;el.showModal();const old=document.body.style.overflow;document.body.style.overflow='hidden';return ()=>{document.body.style.overflow=old;el.close();};},[]);
 useEffect(()=>{const timer=setTimeout(()=>{setPage({files:[],nextPageToken:null});setMoreToken('');setTerm(search.trim());},300);return ()=>clearTimeout(timer);},[search]);
 useEffect(()=>{
  if(!choosing||!account||!canRead)return;
  const controller=new AbortController();setBusy(true);setError('');
  const params=new URLSearchParams({search:term,...(moreToken?{pageToken:moreToken}:{})});
  void call<Page>('/integrations/drive/'+encodeURIComponent(account)+'/cover-images?'+params,'GET',undefined,controller.signal).then(data=>{if(!controller.signal.aborted)setPage(old=>({...data,files:moreToken?[...old.files,...data.files.filter(f=>!old.files.some(p=>p.id===f.id))]:data.files}));}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return ()=>controller.abort();
 },[account,canRead,choosing,term,moreToken,call,retry]);
 function select(file:DriveItem){setCover({connectionId:account,fileId:file.id,name:file.name,x:50,y:50,zoom:1});setChoosing(false);}
 return <dialog ref={dialog} className="pc-dialog" aria-labelledby="pc-editor-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <header><div><span className="eyebrow">CAPA DO PROJETO</span><h2 id="pc-editor-title">{choosing?'Escolha uma imagem':'Encontre o melhor enquadramento'}</h2><p>{project.name}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fechar editor de capa"><X size={20}/></button></header>
  <div className="pc-editor-body">
   {choosing?<>
    <div className="pc-picker-tools"><label>Conta do Drive<select value={account} onChange={e=>{setAccount(e.target.value);setPage({files:[],nextPageToken:null});setMoreToken('');}}>{context.connections.map(c=><option key={c.id} value={c.id}>{c.google_email}</option>)}</select></label><label className="pc-image-search"><span>Buscar imagens no Drive</span><div><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome da imagem" maxLength={100}/></div></label></div>
    <p className="pc-helper">JPG, PNG, WebP ou AVIF de até 8 MB. O arquivo permanece privado no seu Drive.</p>
    {!canRead?<p role="status">Autorize a leitura do Drive na <a href="/biblioteca">Biblioteca</a> para escolher suas imagens.</p>:<>
     {error&&<p role="alert">{error} <button type="button" className="secondary-button" onClick={()=>{setRetry(n=>n+1);}}>Tentar novamente</button></p>}
     <div className="pc-image-grid" aria-busy={busy}>{page.files.map(file=><button type="button" key={file.id} onClick={()=>select(file)} title={file.name}><DriveThumbnail item={file} scope={context.uid+':'+account} getThumbnail={thumbnail}/><span>{file.name}</span></button>)}</div>
     {busy?<p role="status" className="pc-loading"><LoaderCircle size={20} className="pc-spin"/>Carregando imagens…</p>:!page.files.length&&!error?<p className="pc-empty">Nenhuma imagem encontrada. Tente outro nome ou confira os formatos e tamanhos.</p>:null}
     {page.incompleteSearch&&<p role="status">O Drive retornou resultados parciais. Refine a busca pelo nome.</p>}
     {page.nextPageToken&&<button className="secondary-button" type="button" disabled={busy} onClick={()=>setMoreToken(page.nextPageToken!)}>Carregar mais imagens</button>}
    </>}
   </>:cover?<>
    <button type="button" className="pc-text-button" onClick={()=>setChoosing(true)}><ArrowLeft size={16}/>Escolher outra imagem</button>
    <div className="pc-editor-preview">{src?<CoverFrame src={src} cover={cover} onChange={setCover}/>:<p role={imageError?'alert':'status'}>{imageError||'Carregando imagem…'}</p>}</div>
    <p className="pc-helper">Arraste a imagem para posicionar. Você também pode usar os controles abaixo.</p>
    <div className="pc-crop-controls">{([{key:'zoom',label:'Zoom',min:1,max:3,step:.01},{key:'x',label:'Posição horizontal',min:0,max:100,step:1},{key:'y',label:'Posição vertical',min:0,max:100,step:1}] as const).map(control=><label key={control.key} htmlFor={"pc-crop-"+control.key}><span>{control.label}<output>{control.key==='zoom'?Math.round(cover.zoom*100)+'%':Math.round(cover[control.key])+'%'}</output></span><input id={"pc-crop-"+control.key} aria-label={control.label} type="range" min={control.min} max={control.max} step={control.step} value={cover[control.key]} onChange={e=>setCover({...cover,[control.key]:Number(e.target.value)})}/></label>)}</div>
    <button type="button" className="pc-text-button" onClick={()=>setCover({...cover,x:50,y:50,zoom:1})}><RotateCcw size={16}/>Redefinir enquadramento</button>
   </>:null}
  </div>
  <footer><div>{project.cover&&<button type="button" className="pc-text-button" onClick={()=>{onSave(undefined);onClose();}}><Trash2 size={16}/>Remover capa</button>}</div><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="button" className="primary-button" disabled={choosing||!cover||!src||!!imageError} onClick={()=>{if(cover){onSave(cover);onClose();}}}><Check size={17}/>Salvar capa</button></footer>
 </dialog>;
}
