import {useEffect,useMemo,useRef,useState} from 'react';
import {AppButton} from '../ui/AppButton';
import {AppInput} from '../ui/AppInput';
import {AppSelect} from '../ui/AppSelect';
import {useDriveApi,messages} from './drive-api';
import {useOverlayFocus} from './DriveLibraryUI';
import {assistedLibraryPlan,type AssistedFile} from './assisted-library-plan';
import {importLibraryBatch} from './library-import';
import type {InspectedLibrarySource} from '../../../shared/library-selection';
export function AssistedLibraryImport({projectId,parentId,sources,unavailable,onClose,onApplied}:{projectId:number;parentId:string;sources:InspectedLibrarySource[];unavailable:{name:string;code:string}[];onClose:()=>void;onApplied:()=>void}){
 const initial=useMemo(()=>{try{return {plan:assistedLibraryPlan(sources),error:''};}catch(e){return {plan:null,error:e instanceof Error?e.message:'Não foi possível preparar a organização.'};}},[sources]);
 const [folders,setFolders]=useState(initial.plan?.folders||[]),[files,setFiles]=useState<AssistedFile[]>(initial.plan?.files||[]);
 const [mapping,setMapping]=useState<Record<string,string>|null>(null),[started,setStarted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState('');
 const [failures,setFailures]=useState<Record<string,string>>({});
 const call=useDriveApi(),attempt=useRef(crypto.randomUUID()),operation=useRef<AbortController|null>(null),dialog=useOverlayFocus(()=>{if(!busy)onClose();});
 useEffect(()=>()=>operation.current?.abort(),[]);
 const fileKey=(x:AssistedFile)=>x.provider+':'+x.connectionId+':'+x.fileId;
 const folderPath=(key:string):string=>{const node=folders.find(x=>x.key===key);return node?(node.parentKey?folderPath(node.parentKey)+' / ':'')+node.name:'Pasta atual';};
 async function apply(){
  if(busy||initial.error||!folders.length&&!files.length)return;const controller=new AbortController();operation.current=controller;setBusy(true);setError('');
  try{
   let destination=mapping;
   if(!destination){
    setStarted(true);setProgress('Conferindo a estrutura de pastas…');
    const result=folders.length?await call<{created:{key:string;id:string}[]}>('/library/projects/'+projectId+'/structure','POST',{attemptId:attempt.current,parentId,folders,reuseExisting:true},controller.signal):{created:[]};
    destination=Object.fromEntries(result.created.map(x=>[x.key,x.id]));setMapping(destination);
   }
   const groups=new Map<string,AssistedFile[]>();
   for(const file of files){const target=file.targetKey?destination[file.targetKey]:parentId;if(!target)throw new Error('A pasta de destino não foi confirmada. Atualize a biblioteca antes de continuar.');groups.set(target,[...(groups.get(target)||[]),file]);}
   const remaining:AssistedFile[]=[],codes:Record<string,string>={};let completed=0,blocked='';
   for(const [target,items] of groups){
    if(blocked){remaining.push(...items);for(const item of items)codes[fileKey(item)]=blocked;continue;}
    const failed=await importLibraryBatch(call,'/library/projects/'+projectId+'/imports',target,items,controller.signal,(done)=>setProgress('Adicionando '+(completed+done)+' de '+files.length+' arquivos…'));
    for(const item of failed){const original=items.find(x=>x.fileId===item.fileId&&x.connectionId===item.connectionId)!;remaining.push(original);codes[fileKey(original)]=item.code;}
    blocked=failed.find(x=>['provider_rate_limited','drive_rate_limited','dropbox_rate_limited','rate_limited','provider_temporary_failure','service_unavailable'].includes(x.code))?.code||'';
    completed+=items.length;
   }
   if(!controller.signal.aborted){setFiles(remaining);setFailures(codes);if(!remaining.length)onApplied();else setError('Os itens confirmados foram preservados. Repita somente os arquivos abaixo; você pode ajustar seus destinos.');}
  }catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Não foi possível confirmar a importação. Repita para conferir sem duplicar pastas ou arquivos.');if(!mapping&&['invalid_library_structure','invalid_library_name','library_depth_exceeded','library_parent_denied','library_structure_ambiguous','library_structure_mismatch'].includes((e as {code?:string}).code||'')){setStarted(false);attempt.current=crypto.randomUUID();}}}
  finally{if(!controller.signal.aborted){setBusy(false);setProgress('');}}
 }
 return <div className="virtual-library-backdrop"><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="assisted-library-title" className="virtual-library-editor virtual-library-preview">
  <h3 id="assisted-library-title">Revisar organização selecionada</h3><p>Somente as pastas e os arquivos selecionados serão adicionados. Selecionar uma pasta não inclui seus arquivos automaticamente. Os originais permanecem no provedor.</p>
  <p>Pastas virtuais com o mesmo nome no destino serão reutilizadas quando houver uma única correspondência. Arquivos sem pasta pai selecionada ficam na pasta atual; ajuste os destinos abaixo.</p>
  {Boolean(initial.plan?.adapted)&&<p>Alguns nomes foram adaptados para evitar barras e pastas repetidas. Confira os nomes antes de criar.</p>}
  {unavailable.length>0&&<div className="virtual-library-error" role="alert"><p>{unavailable.length} item(ns) não puderam ser conferidos e não serão adicionados:</p><ul>{unavailable.map((x,i)=><li key={i}>{x.name}: {messages[x.code]||'Item indisponível.'}</li>)}</ul></div>}
  {folders.length>0&&<fieldset><legend>Pastas e subpastas ({folders.length})</legend>{folders.map(folder=><label key={folder.key} style={{marginLeft:folder.parentKey?16:0}}>{folder.parentKey?folderPath(folder.parentKey):'Pasta atual'}<AppInput aria-label={'Nome da pasta '+folder.name} value={folder.name} maxLength={120} disabled={busy||started} onChange={e=>setFolders(old=>old.map(x=>x.key===folder.key?{...x,name:e.target.value}:x))}/></label>)}</fieldset>}
  <ul className="virtual-library-nodes">{files.map(file=><li key={fileKey(file)}><strong>{file.name}</strong><label>Destino<AppSelect aria-label={'Destino de '+file.name} value={file.targetKey||''} disabled={busy} onValueChange={value=>setFiles(old=>old.map(x=>fileKey(x)===fileKey(file)?{...x,targetKey:value||null}:x))}><option value="">Pasta atual</option>{folders.map(x=><option key={x.key} value={x.key}>{folderPath(x.key)}</option>)}</AppSelect></label><AppButton disabled={busy} aria-label={'Ignorar '+file.name+' nesta importação'} onClick={()=>setFiles(old=>old.filter(x=>fileKey(x)!==fileKey(file)))}>Ignorar</AppButton>{failures[fileKey(file)]&&<p>{messages[failures[fileKey(file)]]||'Não foi possível confirmar este arquivo.'}</p>}</li>)}</ul>
  {(initial.error||error)&&<p role="alert" className="virtual-library-error">{initial.error||error}</p>}{progress&&<p role="status">{progress}</p>}
  {!folders.length&&!files.length&&<p>Nenhum item disponível nesta seleção.</p>}
  <div className="virtual-library-toolbar"><AppButton disabled={busy||Boolean(initial.error)||!folders.length&&!files.length} onClick={()=>void apply()}>{mapping?files.length?'Repetir somente os arquivos pendentes':'Concluir importação':started?'Conferir e concluir':'Criar estrutura e adicionar '+files.length+' arquivo(s)'}</AppButton><AppButton disabled={busy} onClick={onClose}>Fechar</AppButton></div>
 </div></div>;
}
