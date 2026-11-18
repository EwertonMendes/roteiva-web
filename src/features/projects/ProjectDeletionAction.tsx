import {useCallback,useEffect,useRef,useState} from 'react';
import {AlertTriangle,CheckCircle2,LoaderCircle,ShieldAlert,Trash2} from 'lucide-react';
import type {Project} from '../../domain/workspace';
import type {User} from 'firebase/auth';
import {AppButton} from '../ui/AppButton';
import {AppInput} from '../ui/AppInput';
import {AppCheckbox} from '../ui/AppCheckbox';
import {AppModal,AppModalHeader,AppModalBody,AppModalFooter} from '../ui/AppModal';
import {useAuth} from '../auth/AuthProvider';
import {API_BASE_URL} from '../../lib/environment';
import {isDemo} from '../../lib/firebase';

type Status='idle'|'processing'|'completed'|'manual_review';
type Result={status:Status;phase?:string;operationId?:string};
const PHRASE='EXCLUIR PROJETO';
const statusCopy:Record<string,string>={
 locking:'Protegendo o projeto contra novas alterações…',
 reviews:'Encerrando aprovações e removendo acessos…',
 uploads:'Finalizando registros de envios…',
 library:'Removendo vínculos da Biblioteca…',
 previews:'Limpando prévias exclusivas…',
 firestore:'Removendo dados vinculados e atualizando os contadores…'
};
async function call(uid:string,projectId:number,method:'GET'|'POST',name?:string):Promise<Result>{
  const {firebaseServices}=await import('../../lib/firebase');
  const user=firebaseServices().auth.currentUser;
  if(!user||user.uid!==uid)throw new Error('Sua sessão mudou. Entre novamente para continuar.');
  const token=await user.getIdToken();
  let response:Response;
  try{
    response=await fetch(API_BASE_URL+'/projects/'+projectId+'/deletion',{
      method,headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},
      ...(method==='POST'?{body:JSON.stringify({phrase:PHRASE,name,acknowledged:true})}:{}),
      cache:'no-store'
    });
  }catch{throw new Error('Não foi possível consultar a exclusão. Verifique sua conexão.');}
  const data=await response.json().catch(()=>null) as {status?:Status;phase?:string;operationId?:string;error?:{code?:string}}|null;
  if(!response.ok){
    if(data?.error?.code==='project_confirmation_mismatch')throw new Error('O projeto foi alterado em outra aba. Atualize a página antes de continuar.');
    if(data?.error?.code==='project_not_found')throw new Error('Este projeto não está mais disponível.');
    if(data?.error?.code==='project_deletion_unavailable')throw new Error('A exclusão não está disponível neste ambiente.');
    throw new Error('Não foi possível confirmar a operação. Confira a conexão e tente novamente.');
  }
  if(!data||!['idle','processing','completed','manual_review'].includes(data.status||''))
    throw new Error('O servidor não confirmou o estado da exclusão.');
  return data as Result;
}
type Props={project:Project;onDeleted:()=>void;onDeleteDemo?:()=>void};
export function ProjectDeletionAction(props:Props){
  return isDemo?<ProjectDeletionPanel {...props} user={null}/>:<AuthenticatedProjectDeletionAction {...props}/>;
}
function AuthenticatedProjectDeletionAction(props:Props){
  const {user}=useAuth();
  return <ProjectDeletionPanel {...props} user={user}/>;
}
function ProjectDeletionPanel({project,onDeleted,onDeleteDemo,user}:Props&{user:User|null}){
  const [opened,setOpened]=useState(false),[name,setName]=useState('');
  const [acknowledged,setAcknowledged]=useState(false);
  const [status,setStatus]=useState<Status>('idle');
  const [phase,setPhase]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [ready,setReady]=useState(isDemo);
  const completed=useRef(false),requesting=useRef(false);
  const poll=useCallback(async()=>{
    if(isDemo||!user)return;
    const result=await call(user.uid,project.id,'GET');
    setStatus(result.status);setPhase(result.phase||'');setError('');setReady(true);
    if(result.status==='completed'&&!completed.current){
      completed.current=true;onDeleted();
    }
  },[user?.uid,project.id,onDeleted]);
  useEffect(()=>{
    if(isDemo)return;
    let active=true,timeout:ReturnType<typeof setTimeout>|undefined;
    const check=async()=>{
      if(!active)return;
      try{
        const result=await call(user?.uid||'',project.id,'GET');
        if(!active)return;
        setStatus(result.status);setPhase(result.phase||'');setError('');setReady(true);
        if(result.status==='completed'&&!completed.current){
          completed.current=true;onDeleted();return;
        }
      }catch(cause){if(active){setError(cause instanceof Error?cause.message:'Não foi possível consultar a exclusão.');setReady(false);}}
      if(active)timeout=setTimeout(check,2500);
    };
    void check();
    return()=>{active=false;clearTimeout(timeout);};
  // Only remount on identity/project changes; the polling closure owns its own loop.
  },[user?.uid,project.id]);
  function open(){if(busy||status!=='idle')return;setName('');setAcknowledged(false);setError('');setOpened(true);}
  function dismiss(){if(requesting.current)return;setOpened(false);setName('');setAcknowledged(false);setError('');}
  async function confirm(){
    if(name!==project.name||!acknowledged||requesting.current)return;
    requesting.current=true;setBusy(true);setError('');
    try{
      if(isDemo){onDeleteDemo?.();setOpened(false);return;}
      if(!user)throw new Error('Sua sessão expirou. Entre novamente.');
      const result=await call(user.uid,project.id,'POST',project.name);
      setStatus(result.status);setPhase(result.phase||'');setOpened(false);
      if(result.status==='completed'&&!completed.current){completed.current=true;onDeleted();}
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Não foi possível solicitar a exclusão.');
      // A timeout may mean the server accepted the operation. Check status; never
      // blindly submit the destructive POST again.
      if(!isDemo)await poll().catch(()=>undefined);
    }finally{requesting.current=false;setBusy(false);}
  }
  const pending=!isDemo&&status==='processing';
  return <section className="panel studio-section pd-danger-zone" aria-labelledby="pd-danger-title">
    <div className="pd-danger-heading"><AlertTriangle size={19} aria-hidden="true"/><h2 id="pd-danger-title">Zona de perigo</h2></div>
    <div className="pd-danger-content">
      <div><strong>Excluir projeto</strong>
        <p>A exclusão é permanente e remove tarefas, compromissos, Biblioteca e aprovações vinculadas. O histórico financeiro e os arquivos originais no Google Drive ou Dropbox serão preservados.</p>
      </div>
      <AppButton type="button" variant="danger" onClick={open}
        disabled={busy||!ready||status!=='idle'}><Trash2 size={17}/> Excluir projeto</AppButton>
    </div>
    {pending&&<p className="pd-danger-state" role="status"><LoaderCircle size={17} className="pd-deletion-spin"/> {statusCopy[phase]||'Exclusão em andamento. Os dados estão protegidos e o processo continuará automaticamente.'}</p>}
    {status==='manual_review'&&<p role="alert" className="pd-danger-error"><ShieldAlert size={17}/> A exclusão requer uma verificação do suporte. O projeto permanece bloqueado e os arquivos originais estão preservados.</p>}
    {error&&!opened&&<p className="pd-danger-error" role="alert">{error} <AppButton type="button" onClick={()=>void poll().catch(()=>undefined)}>Tentar novamente</AppButton></p>}
    {opened&&<AppModal size="medium" className="pd-delete-dialog" aria-labelledby="pd-delete-title" aria-describedby="pd-delete-desc" onCloseRequest={dismiss}>
      <div className="rt-modal__layout">
        <AppModalHeader icon={<ShieldAlert size={25}/>} title="Excluir este projeto?" titleId="pd-delete-title"
          description="Essa ação é permanente e não pode ser desfeita." onClose={dismiss} closeDisabled={busy}/>
        <AppModalBody className="pd-delete-body">
          <div id="pd-delete-desc" className="pd-delete-intro">
            <p>Você está prestes a excluir <strong>{project.name}</strong>.</p>
            <p>Serão removidos as tarefas, os compromissos, os vínculos da Biblioteca e o histórico de aprovações associados a este projeto.</p>
          </div>
          <div className="pd-delete-preserve">
            <CheckCircle2 size={20} aria-hidden="true"/>
            <p><strong>O que será preservado</strong>
              <span>Os lançamentos financeiros continuarão no histórico, sem vínculo com este projeto. Os arquivos originais no Google Drive e Dropbox não serão apagados.</span>
            </p>
          </div>
          <div className="pd-delete-confirm-field">
            <label htmlFor="pd-project-confirm">Digite o nome exato do projeto para confirmar</label>
            <AppInput id="pd-project-confirm" className="pd-delete-name-input" value={name}
              onChange={event=>setName(event.target.value)} placeholder={project.name}
              autoComplete="off" spellCheck={false} maxLength={200} disabled={busy} autoFocus/>
            <span className="pd-delete-hint">Use o mesmo nome exibido acima, incluindo espaços e maiúsculas.</span>
          </div>
          <AppCheckbox className="pd-delete-acknowledge" checked={acknowledged}
            onChange={event=>setAcknowledged(event.target.checked)} disabled={busy}>
            Entendo que a exclusão dos dados vinculados no Roteiva não pode ser desfeita.
          </AppCheckbox>
          {error&&<p className="pd-danger-error" role="alert">{error}</p>}
        </AppModalBody>
        <AppModalFooter>
          <AppButton type="button" variant="secondary" disabled={busy} onClick={dismiss}>Cancelar</AppButton>
          <AppButton type="button" variant="danger" loading={busy} disabled={name!==project.name||!acknowledged||busy}
            onClick={()=>void confirm()}><Trash2 size={16}/> {busy?'Confirmando…':'Excluir definitivamente'}</AppButton>
        </AppModalFooter>
      </div>
    </AppModal>}
  </section>;
}
