import {useEffect,useRef,useState} from 'react';
import {AlertTriangle,CheckCircle2,LoaderCircle,ShieldAlert,Trash2} from 'lucide-react';
import type {Project} from '../../domain/workspace';
import {AppButton} from '../ui/AppButton';
import {AppInput} from '../ui/AppInput';
import {AppCheckbox} from '../ui/AppCheckbox';
import {AppModal,AppModalHeader,AppModalBody,AppModalFooter} from '../ui/AppModal';
import {isDemo} from '../../lib/firebase';
import {useProjectDeletion,type DeletionResult} from './ProjectDeletionProvider';

const statusCopy:Record<string,string>={
 locking:'Protegendo o projeto contra novas alterações…',
 reviews:'Encerrando aprovações e removendo acessos…',
 uploads:'Finalizando registros de envios…',
 library:'Removendo vínculos da Biblioteca…',
 previews:'Limpando prévias exclusivas…',
 firestore:'Removendo dados vinculados e atualizando os contadores…'
};
type Props={project:Project;onDeleted:()=>void;onDeleteDemo?:()=>void};
export function ProjectDeletionAction({project,onDeleteDemo}:Props){
  const deletion=useProjectDeletion();
  const inspect=deletion?.inspect;
  const start=deletion?.start;
  const job=deletion?.jobs[project.id];
  const [opened,setOpened]=useState(false),[name,setName]=useState('');
  const [acknowledged,setAcknowledged]=useState(false);
  const [initialStatus,setInitialStatus]=useState<DeletionResult>({status:'idle'});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [ready,setReady]=useState(isDemo||Boolean(job));
  const requesting=useRef(false);
  // A single read when the detail page first mounts. The shared provider
  // remembers the answer, so opening the confirmation modal does not poll.
  useEffect(()=>{
    if(isDemo||!inspect)return;
    let active=true;
    void inspect(project).then(result=>{
      if(!active)return;
      setInitialStatus(result);setReady(true);setError('');
    }).catch(cause=>{
      if(!active)return;
      setError(cause instanceof Error?cause.message:'Não foi possível consultar a exclusão.');
      setReady(false);
    });
    return()=>{active=false;};
  },[inspect,project.id,project.name,project.status]);
  const status=job?.status||initialStatus.status;
  const phase=job?.phase||initialStatus.phase||'';
  async function recheck(){
    if(isDemo||!inspect)return;
    try{
      const result=await inspect(project,true);
      setInitialStatus(result);setReady(true);setError('');
    }catch(cause){setReady(false);setError(cause instanceof Error?cause.message:'Não foi possível consultar a exclusão.');}
  }
  function open(){
    if(busy||!ready||status!=='idle')return;
    setName('');setAcknowledged(false);setError('');setOpened(true);
  }
  function dismiss(){
    if(requesting.current)return;
    setOpened(false);setName('');setAcknowledged(false);setError('');
  }
  async function confirm(){
    if(name!==project.name||!acknowledged||requesting.current)return;
    requesting.current=true;setBusy(true);setError('');
    try{
      if(isDemo){onDeleteDemo?.();setOpened(false);return;}
      if(!start)throw new Error('Serviço de exclusão indisponível.');
      const result=await start(project);
      setInitialStatus(result);setOpened(false);
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Não foi possível solicitar a exclusão.');
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
    {error&&!opened&&<p className="pd-danger-error" role="alert">{error} <AppButton type="button" onClick={()=>void recheck()}>Tentar novamente</AppButton></p>}
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
