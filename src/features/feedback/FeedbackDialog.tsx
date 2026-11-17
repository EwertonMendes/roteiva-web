import {useEffect,useRef,useState,type ClipboardEvent,type DragEvent,type FormEvent} from 'react';
import {CheckCircle2,ImagePlus,MessageCircleHeart,Paperclip,Trash2} from 'lucide-react';
import {AppModal,AppModalHeader,AppModalBody,AppModalFooter,AppModalSection} from '../ui/AppModal';
import {AppButton} from '../ui/AppButton';
import {AppInput} from '../ui/AppInput';
import {AppTextarea} from '../ui/AppTextarea';
import {API_BASE_URL} from '../../lib/environment';
import './feedback.css';

type Kind='bug'|'idea'|'praise'|'other';
type Preview={id:string;file:File;url:string};
type Report={id:string;kind:Kind;title:string;status:'sending'|'sent'|'failed';created_at:number};
const kinds:{value:Kind;label:string}[]=[
  {value:'bug',label:'Problema'},
  {value:'idea',label:'Sugestão'},
  {value:'praise',label:'Elogio'},
  {value:'other',label:'Outro'}
];
const messages:Record<string,string>={
  feedback_unavailable:'O envio está sendo configurado neste ambiente.',
  feedback_delivery_unconfirmed:'Não foi possível confirmar o envio. Guarde o protocolo e evite reenviar imediatamente.',
  feedback_daily_limit:'O limite de três feedbacks em 24 horas foi atingido.',
  feedback_already_attempted:'Essa tentativa já foi processada. Confira o histórico antes de criar outra.',
  feedback_invalid_form:'Confira o assunto, a descrição e os campos do formulário.',
  feedback_invalid_image:'Uma das imagens não é válida. Use PNG, JPEG ou WebP.',
  feedback_too_large:'O total de imagens excedeu o limite permitido.',
  feedback_too_many_images:'Adicione no máximo cinco imagens.',
  rate_limited:'Muitas tentativas. Aguarde e tente novamente.',
  invalid_identity:'Sua sessão expirou. Entre novamente.',
  account_deleting:'Esta conta está em processo de exclusão.'
};
async function compressImage(file:File):Promise<File>{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)
    throw Error('Selecione imagens PNG, JPEG ou WebP de até 8 MB.');
  const bitmap=await createImageBitmap(file);
  try{
    if(bitmap.width*bitmap.height>25000000)throw Error('A imagem tem resolução excessiva.');
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');
    if(!context)throw Error('Não foi possível preparar a imagem.');
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    async function encode(quality:number):Promise<Blob>{
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',quality));
      if(!blob)throw Error('Não foi possível comprimir a imagem.');
      return blob;
    }
    let compressed=await encode(.84);
    if(compressed.size>1024*1024)compressed=await encode(.68);
    if(compressed.size>1024*1024)throw Error('Esta imagem continua muito grande mesmo após otimização.');
    // Re-encoding drops EXIF and original filenames before they leave the browser.
    return new File([compressed],'captura.webp',{type:compressed.type||'image/webp'});
  }finally{bitmap.close();}
}
async function responsePayload(response:Response){
  return await response.json().catch(()=>({})) as {id?:string;error?:{code?:string};items?:Report[];available?:boolean};
}
export function FeedbackDialog({getToken,onClose}:{getToken:()=>Promise<string>;onClose:()=>void}){
  const [kind,setKind]=useState<Kind>('bug');
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [images,setImages]=useState<Preview[]>([]);
  const [processing,setProcessing]=useState(false);
  const [preparing,setPreparing]=useState(false);
  const [error,setError]=useState('');
  const [sentId,setSentId]=useState('');
  const [available,setAvailable]=useState<boolean|null>(null);
  const [history,setHistory]=useState<Report[]>([]);
  const [showHistory,setShowHistory]=useState(false);
  const [requestKey]=useState(()=>crypto.randomUUID());
  const fileInput=useRef<HTMLInputElement>(null);
  const imagesRef=useRef<Preview[]>([]);
  const pending=processing||preparing;
  useEffect(()=>{imagesRef.current=images;},[images]);
  useEffect(()=>()=>{for(const image of imagesRef.current)URL.revokeObjectURL(image.url);},[]);
  useEffect(()=>{
    const controller=new AbortController();
    void (async()=>{
      try{
        const token=await getToken();
        const result=await fetch(API_BASE_URL+'/feedback',{headers:{Authorization:'Bearer '+token},signal:controller.signal});
        if(!result.ok)throw Error('Não foi possível consultar os feedbacks.');
        const payload=await responsePayload(result);
        if(!controller.signal.aborted){setAvailable(payload.available===true);setHistory(payload.items||[]);}
      }catch{
        if(!controller.signal.aborted){setAvailable(false);setError('Não foi possível consultar o serviço de suporte.');}
      }
    })();
    return()=>controller.abort();
  },[getToken]);
  async function addFiles(files:File[]){
    if(pending||!files.length||sentId)return;
    if(imagesRef.current.length+files.length>5){setError('Você pode anexar até cinco imagens.');return;}
    setPreparing(true);setError('');
    const prepared:Preview[]=[];
    try{
      for(const file of files){
        const converted=await compressImage(file);
        prepared.push({id:crypto.randomUUID(),file:converted,url:URL.createObjectURL(converted)});
      }
      const next=[...imagesRef.current,...prepared];
      imagesRef.current=next;
      setImages(next);
    }catch(reason){
      for(const item of prepared)URL.revokeObjectURL(item.url);
      setError(reason instanceof Error?reason.message:'Não foi possível preparar as imagens.');
    }finally{setPreparing(false);}
  }
  function onPaste(event:ClipboardEvent<HTMLFormElement>){
    const files=Array.from(event.clipboardData.items).filter(item=>item.kind==='file'&&item.type.startsWith('image/'))
      .map(item=>item.getAsFile()).filter((file):file is File=>!!file);
    if(files.length){event.preventDefault();void addFiles(files);}
  }
  function onDrop(event:DragEvent<HTMLDivElement>){
    event.preventDefault();
    void addFiles(Array.from(event.dataTransfer.files));
  }
  function removeImage(id:string){
    if(pending)return;
    const item=imagesRef.current.find(preview=>preview.id===id);
    if(item)URL.revokeObjectURL(item.url);
    const remaining=imagesRef.current.filter(preview=>preview.id!==id);
    imagesRef.current=remaining;setImages(remaining);
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(pending||sentId||available!==true)return;
    if(title.trim().length<5||description.trim().length<15){
      setError('Informe um assunto de pelo menos 5 caracteres e uma descrição com pelo menos 15.');
      return;
    }
    setProcessing(true);setError('');
    try{
      const form=new FormData();
      form.set('kind',kind);form.set('title',title.trim());form.set('description',description.trim());
      form.set('screen',window.location.pathname||'/');form.set('requestKey',requestKey);
      for(const image of images)form.append('images',image.file,'captura.webp');
      const token=await getToken();
      const response=await fetch(API_BASE_URL+'/feedback',{
        method:'POST',headers:{Authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(30000)
      });
      const payload=await responsePayload(response);
      if(!response.ok)throw Error(messages[payload.error?.code||'']||'Não foi possível confirmar o envio. Verifique o histórico antes de tentar novamente.');
      setSentId(payload.id||'');
      if(payload.id)setHistory(old=>[{id:payload.id!,kind,title,status:'sent',created_at:Date.now()},...old].slice(0,15));
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Não foi possível confirmar o envio.');
    }finally{setProcessing(false);}
  }
  function close(){if(!pending)onClose();}
  return <AppModal size="medium" className="rt-feedback-dialog" onCloseRequest={close}
    aria-labelledby="feedback-dialog-title" aria-describedby="feedback-dialog-description">
    <form className="rt-modal__layout feedback-form" onSubmit={submit} onPaste={onPaste}>
      <AppModalHeader icon={<MessageCircleHeart size={26}/>} title="Enviar feedback" titleId="feedback-dialog-title"
        descriptionId="feedback-dialog-description" description="Ajude a melhorar o Roteiva. Bugs, sugestões e elogios são bem-vindos."
        eyebrow="SUPORTE ROTEIVA" onClose={close} closeDisabled={pending}/>
      <AppModalBody>
        {sentId?<div className="feedback-success" role="status">
          <CheckCircle2 size={36} aria-hidden="true"/>
          <h3>Feedback registrado!</h3>
          <p>Enviamos sua mensagem para nossa equipe de suporte.</p>
          <span>Protocolo: {sentId}</span>
        </div>:<>
          {available===false&&<p className="feedback-alert" role="alert">O envio de mensagens ainda não está configurado neste ambiente.</p>}
          <AppModalSection>
            <div className="feedback-field">
              <span className="feedback-label">Como podemos ajudar?</span>
              <div className="feedback-kinds" role="group" aria-label="Tipo de feedback">
                {kinds.map(option=><AppButton key={option.value} type="button"
                  className={kind===option.value?'feedback-kind selected':'feedback-kind'}
                  aria-pressed={kind===option.value} disabled={pending} onClick={()=>setKind(option.value)}>{option.label}</AppButton>)}
              </div>
            </div>
            <label className="feedback-field">Assunto
              <AppInput autoFocus maxLength={120} minLength={5} required value={title} disabled={pending}
                onChange={event=>setTitle(event.target.value)} placeholder="Ex.: Não consigo abrir um projeto"/>
            </label>
            <label className="feedback-field">Descrição
              <AppTextarea rows={4} maxLength={4000} minLength={15} required value={description} disabled={pending}
                onChange={event=>setDescription(event.target.value)}
                placeholder="Conte o que aconteceu, o que esperava ou o que gostaria de sugerir."/>
            </label>
          </AppModalSection>
          <AppModalSection heading="Capturas de tela (opcional)" icon={<Paperclip size={19}/>}>
            <div className="feedback-upload" onDragOver={event=>event.preventDefault()} onDrop={onDrop}>
              <ImagePlus size={24} aria-hidden="true"/>
              <p>Arraste imagens ou cole capturas com Ctrl+V</p>
              <span>Até cinco imagens, otimizadas antes do envio</span>
              <AppButton type="button" variant="secondary" disabled={pending||images.length>=5}
                onClick={()=>fileInput.current?.click()}>Selecionar imagens</AppButton>
              <AppInput ref={fileInput} className="feedback-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple
                aria-label="Selecionar capturas de tela" disabled={pending} onChange={event=>{
                  void addFiles(Array.from(event.target.files||[]));event.target.value='';
                }}/>
            </div>
            {images.length>0&&<div className="feedback-previews" aria-label="Imagens anexadas">{images.map((item,index)=>
              <div key={item.id} className="feedback-preview"><img src={item.url} alt={'Captura de tela '+(index+1)}/>
                <AppButton type="button" onClick={()=>removeImage(item.id)} disabled={pending}
                  aria-label={'Remover imagem '+(index+1)} title="Remover imagem"><Trash2 size={17}/></AppButton>
              </div>)}</div>}
          </AppModalSection>
        </>}
        {error&&<p className="feedback-alert" role="alert">{error}</p>}
        <p className="feedback-privacy">As informações e imagens enviadas serão recebidas no e-mail de suporte. Não inclua senhas, códigos de acesso ou documentos confidenciais.</p>
        <div className="feedback-history">
          <AppButton type="button" className="feedback-history-toggle" aria-expanded={showHistory}
            onClick={()=>setShowHistory(v=>!v)}>Meus feedbacks anteriores ({history.length})</AppButton>
          {showHistory&&(history.length?<ul>{history.map(item=><li key={item.id}>
            <span>{item.title}</span><small>{new Date(item.created_at).toLocaleDateString('pt-BR')} · {item.status==='sent'?'Recebido':item.status==='failed'?'Não confirmado':'Processando'}</small>
          </li>)}</ul>:<p>Você ainda não possui feedbacks registrados.</p>)}
        </div>
      </AppModalBody>
      <AppModalFooter>
        <AppButton type="button" variant="secondary" disabled={pending} onClick={close}>{sentId?'Fechar':'Cancelar'}</AppButton>
        {!sentId&&<AppButton type="submit" variant="primary" loading={pending} disabled={pending||available!==true||title.trim().length<5||description.trim().length<15}>
          {preparing?'Preparando imagens…':processing?'Enviando…':'Enviar feedback'}
        </AppButton>}
      </AppModalFooter>
    </form>
  </AppModal>;
}
