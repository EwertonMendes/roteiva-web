import {useEffect,useMemo,useRef,useState} from 'react';
import {AppButton} from '../ui/AppButton';
import {AppTextarea} from '../ui/AppTextarea';
import {AppSelect} from '../ui/AppSelect';
import {useDriveApi} from './drive-api';
import {useOverlayFocus} from './DriveLibraryUI';
import {folderPlanFromPaths,folderTemplates} from './library-structure-plan';
export function LibraryStructureDialog({projectId,parentId,onClose,onApplied}:{projectId:number;parentId:string;onClose:()=>void;onApplied:()=>void}){
 const call=useDriveApi(),[text,setText]=useState(folderTemplates.video),[template,setTemplate]=useState('video');
 const [busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[error,setError]=useState('');
 const attempt=useRef(crypto.randomUUID()),operation=useRef<AbortController|null>(null),dialog=useOverlayFocus(()=>{if(!busy)onClose();});
 const result=useMemo(()=>{try{return {folders:folderPlanFromPaths(text),error:''};}catch(e){return {folders:[],error:e instanceof Error?e.message:'Estrutura inválida.'};}},[text]);
 useEffect(()=>()=>operation.current?.abort(),[]);
 function edit(value:string){setText(value);attempt.current=crypto.randomUUID();setError('');}
 async function apply(){
  if(busy||!result.folders.length||result.error)return;const controller=new AbortController();operation.current=controller;setBusy(true);setLocked(true);setError('');
  try{await call('/library/projects/'+projectId+'/structure','POST',{attemptId:attempt.current,parentId,folders:result.folders},controller.signal);if(!controller.signal.aborted)onApplied();}
  catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Não foi possível confirmar a estrutura. Repita a mesma operação para conferir sem duplicar pastas.');if(['invalid_library_structure','invalid_library_name','library_depth_exceeded','library_parent_denied','library_structure_mismatch'].includes((e as {code?:string}).code||''))setLocked(false);}}
  finally{if(!controller.signal.aborted)setBusy(false);}
 }
 return <div className="virtual-library-backdrop"><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="library-structure-title" className="virtual-library-editor">
  <h3 id="library-structure-title">Criar uma estrutura de pastas</h3><p>As pastas serão criadas dentro da pasta atual do Roteiva. Os originais no Drive e Dropbox permanecem no mesmo lugar.</p>
  <label>Modelo<AppSelect aria-label="Modelo de pastas" value={template} disabled={busy||locked} onValueChange={value=>{setTemplate(value);edit(folderTemplates[value as keyof typeof folderTemplates]||'');}}><option value="video">Produção de vídeo</option><option value="photo">Fotografia</option><option value="design">Design e documentos</option><option value="custom">Personalizado</option></AppSelect></label>
  <label>Pastas e subpastas<AppTextarea rows={9} value={text} disabled={busy||locked} maxLength={20000} onChange={e=>{setTemplate('custom');edit(e.target.value);}}/></label>
  <p>Uma estrutura por linha. Use / para subpastas, por exemplo: Vídeos/Originais. Pastas repetidas no texto são agrupadas.</p>
  {result.error&&<p role="alert" className="virtual-library-error">{result.error}</p>}{error&&<p role="alert" className="virtual-library-error">{error}</p>}
  <p role="status">{result.folders.length} pasta(s) serão criadas nesta operação.</p>
  {locked&&!busy&&<p>Repita a confirmação para conferir esta operação sem duplicar pastas. Antes de iniciar outra estrutura, confira o resultado na biblioteca.</p>}
  <div className="virtual-library-toolbar"><AppButton disabled={busy||!result.folders.length||Boolean(result.error)} onClick={()=>void apply()}>{locked?'Conferir e concluir':'Criar pastas'}</AppButton><AppButton disabled={busy} onClick={onClose}>Fechar</AppButton></div>
 </div></div>;
}
