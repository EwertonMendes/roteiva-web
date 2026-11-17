import {useLayoutEffect,useRef,useState,type FormEvent,type PointerEvent, type KeyboardEvent} from 'react';
import {Check,GripVertical,Plus,Trash2} from 'lucide-react';
import {AppButton} from '../ui/AppButton';
import {AppInput} from '../ui/AppInput';
import {newId,type Project} from '../../domain/workspace';

type Tasks=NonNullable<Project['tasks']>;
type Task=Tasks[number];

function reorder(tasks:Tasks,sourceId:number,targetId:number):Tasks{
 const source=tasks.findIndex(task=>task.id===sourceId);
 const destination=tasks.findIndex(task=>task.id===targetId);
 if(source<0||destination<0||source===destination)return tasks;
 const reordered=[...tasks];
 const [moved]=reordered.splice(source,1);
 reordered.splice(destination,0,moved);
 return reordered;
}

/** Pointer Events work with mouse, pen and touch. Keyboard arrows on the
 * drag handle are an accessible alternative; the stored array is the order. */
export function ProjectChecklist({tasks,onChange}:{tasks:Tasks;onChange:(next:Tasks)=>void}){
 const [draft,setDraft]=useState('');
 const [dragged,setDragged]=useState<number|null>(null);
 const [target,setTarget]=useState<number|null>(null);
 const [announcement,setAnnouncement]=useState('');
 const inputRef=useRef<HTMLInputElement>(null);
 const listRef=useRef<HTMLDivElement>(null);
 const pendingAdded=useRef<number|null>(null);
 const dragRef=useRef<{pointerId:number;source:number;target:number}|null>(null);
 const completed=tasks.filter(task=>task.done).length;
 const progress=tasks.length?Math.round(completed/tasks.length*100):0;

 useLayoutEffect(()=>{
  const id=pendingAdded.current;
  if(id===null||!tasks.some(task=>task.id===id))return;
  pendingAdded.current=null;
  if(listRef.current)listRef.current.scrollTop=listRef.current.scrollHeight;
  inputRef.current?.focus({preventScroll:true});
 },[tasks]);

 function addTask(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const title=draft.trim();
  if(!title)return;
  const id=newId();
  pendingAdded.current=id;
  onChange([...tasks,{id,title,done:false}]);
  setDraft('');
  inputRef.current?.focus({preventScroll:true});
 }

 function moveByKeyboard(event:KeyboardEvent<HTMLButtonElement>,task:Task){
  if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
  event.preventDefault();
  const current=tasks.findIndex(item=>item.id===task.id);
  const next=current+(event.key==='ArrowUp'?-1:1);
  if(next<0||next>=tasks.length)return;
  onChange(reorder(tasks,task.id,tasks[next].id));
  setAnnouncement(`Tarefa ${task.title} movida para a posição ${next+1} de ${tasks.length}.`);
 }

 function startDrag(event:PointerEvent<HTMLButtonElement>,task:Task){
  if(event.pointerType==='mouse'&&event.button!==0)return;
  dragRef.current={pointerId:event.pointerId,source:task.id,target:task.id};
  event.currentTarget.setPointerCapture(event.pointerId);
  setDragged(task.id);
  setTarget(task.id);
 }

 function dragMove(event:PointerEvent<HTMLButtonElement>){
  const active=dragRef.current;
  if(!active||active.pointerId!==event.pointerId)return;
  event.preventDefault();
  const list=listRef.current;
  if(!list)return;
  const bounds=list.getBoundingClientRect();
  if(event.clientY<bounds.top+30)list.scrollTop-=14;
  else if(event.clientY>bounds.bottom-30)list.scrollTop+=14;
  const hit=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-task-id]');
  if(!hit||!list.contains(hit))return;
  const id=Number(hit.dataset.taskId);
  if(!Number.isSafeInteger(id)||id===active.target)return;
  active.target=id;
  setTarget(id);
 }

 function finishDrag(event:PointerEvent<HTMLButtonElement>,cancelled=false){
  const active=dragRef.current;
  if(!active||active.pointerId!==event.pointerId)return;
  dragRef.current=null;
  if(event.currentTarget.hasPointerCapture(event.pointerId))
   event.currentTarget.releasePointerCapture(event.pointerId);
  setDragged(null);
  setTarget(null);
  if(cancelled||active.source===active.target)return;
  const changed=reorder(tasks,active.source,active.target);
  if(changed===tasks)return;
  onChange(changed);
  const moved=changed.findIndex(task=>task.id===active.source)+1;
  setAnnouncement(`Tarefa movida para a posição ${moved} de ${changed.length}.`);
 }

 return <section className="panel studio-section pd-checklist" aria-labelledby="pd-checklist-title">
  <div className="pd-section-head">
   <h2 id="pd-checklist-title">Checklist</h2>
   <div className="pd-progress"><span aria-live="polite">{completed} de {tasks.length} concluídas</span>
    <div><progress aria-label="Progresso do checklist" max={100} value={progress}/><span>{progress}%</span></div>
   </div>
  </div>
  <div className="pd-tasks" ref={listRef} role="list" aria-label="Tarefas do projeto">
   {tasks.map(task=><div className="pd-task" key={task.id} role="listitem"
    data-task-id={task.id} data-done={task.done} data-dragging={dragged===task.id||undefined}
    data-drop-target={dragged!==null&&dragged!==task.id&&target===task.id||undefined}>
    <AppButton className="pd-drag-handle" type="button" title="Arraste para reordenar. Use as setas para cima ou para baixo pelo teclado."
     aria-label={`Reordenar tarefa ${task.title}. Arraste ou use seta para cima e para baixo.`}
     onPointerDown={event=>startDrag(event,task)}
     onPointerMove={dragMove}
     onPointerUp={event=>finishDrag(event)}
     onPointerCancel={event=>finishDrag(event,true)}
     onKeyDown={event=>moveByKeyboard(event,task)}>
     <GripVertical size={18} aria-hidden="true"/>
    </AppButton>
    <label><AppInput type="checkbox" checked={task.done}
     onChange={()=>onChange(tasks.map(item=>item.id===task.id?{...item,done:!item.done}:item))}/>
     <span className="pd-check" aria-hidden="true">{task.done&&<Check size={17}/>}</span>
     <span>{task.title}</span>
    </label>
    <AppButton className="pd-remove" type="button" aria-label={`Remover tarefa ${task.title}`}
     onClick={()=>onChange(tasks.filter(item=>item.id!==task.id))}><Trash2 size={16} aria-hidden="true"/></AppButton>
   </div>)}
  </div>
  {!tasks.length&&<p className="pd-empty">Comece adicionando a primeira tarefa deste projeto.</p>}
  <form className="pd-add-task" onSubmit={addTask}>
   <AppInput ref={inputRef} name="taskTitle" aria-label="Nova tarefa" maxLength={200}
    placeholder="Adicionar uma tarefa" value={draft} onChange={event=>setDraft(event.target.value)}/>
   <AppButton className="secondary-button" type="submit" disabled={!draft.trim()} aria-label="Adicionar tarefa">
    <Plus size={22} aria-hidden="true"/>
   </AppButton>
  </form>
  <span className="pd-task-announcement" role="status" aria-live="polite">{announcement}</span>
 </section>;
}
