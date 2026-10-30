import {AppButton} from "../ui/AppButton";
import { AppSelect } from "../ui/AppSelect";
import { useState } from "react";
import { Check, ChevronDown, FolderOpen, MoreHorizontal, Plus, ShieldCheck } from "lucide-react";
import { DRIVE_FOLDER, DriveFileExplorer, StorageFolderPicker, type DriveItem, type DriveTrail } from "./DriveLibraryUI";
import "./drive-library.css";

/** Compile-time, no-auth UX review. Never connects to Firebase, Drive, or the Worker. */
const examples: Record<string,DriveItem[]> = {
  "folder-datasoul": [
    {id:"sample-canvas",name:"Canvas do projeto.pdf",mimeType:"application/pdf",size:"33000",modifiedTime:"2026-10-15T16:00:00Z"},
    {id:"sample-image",name:"Identidade visual.png",mimeType:"image/png",size:"275000",modifiedTime:"2026-10-14T14:00:00Z"},
    {id:"folder-brand",name:"Materiais de marca",mimeType:DRIVE_FOLDER},
    {id:"sample-notes",name:"Planejamento.docx",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",size:"85000"},
  ],
  "folder-bemfeito": [
    {id:"sample-product",name:"Fotos dos produtos.jpg",mimeType:"image/jpeg",size:"560000"},
    {id:"sample-catalog",name:"Catálogo de produtos.pdf",mimeType:"application/pdf",size:"140000"},
  ],
  "folder-brand": [{id:"sample-logo",name:"Logo principal.svg",mimeType:"image/svg+xml",size:"6500"}],
  "folder-videos": [{id:"sample-video",name:"Vídeo institucional.mp4",mimeType:"video/mp4",size:"124000000"}],
  "folder-finance": [{id:"sample-budget",name:"Proposta comercial.pdf",mimeType:"application/pdf",size:"83000"}],
  "folder-other": [],
};
const root:DriveTrail = {id:"root",name:"Meu Drive"};
const folders:DriveItem[]=[
  {id:"folder-datasoul",name:"Datasoul",mimeType:DRIVE_FOLDER},
  {id:"folder-bemfeito",name:"Bem Feito",mimeType:DRIVE_FOLDER},
  {id:"folder-videos",name:"Vídeos",mimeType:DRIVE_FOLDER},
  {id:"folder-finance",name:"Documentos comerciais",mimeType:DRIVE_FOLDER},
  {id:"folder-other",name:"Outros materiais",mimeType:DRIVE_FOLDER},
];
const projects=[{id:1,name:"[QA] Projeto DEV"},{id:2,name:"Campanha exemplo"}];

export function LibraryReviewDemo() {
  const [project,setProject]=useState(1);
  const [links,setLinks]=useState<Record<number,string[]>>({1:["folder-datasoul","folder-bemfeito"],2:[]});
  const [active,setActive]=useState<string|null>(null);
  const [path,setPath]=useState<DriveTrail[]>([]);
  const [picker,setPicker]=useState(false);
  const [pickerPath,setPickerPath]=useState<DriveTrail[]>([root]);
  const [notice,setNotice]=useState("");
  const [removeId,setRemoveId]=useState<string|null>(null);
  const activeLinks=links[project]||[];
  const selected=folders.filter(f=>activeLinks.includes(f.id));
  const activeFolder=folders.find(f=>f.id===active);
  const folderContent=(examples[path.at(-1)?.id||""]||[]);

  function openFolder(id:string,name:string){
    const top=folders.find(f=>f.id===id);
    setActive(top?.id||active);
    if(top?.id===id)setPath([{id,name}]);
    else setPath(previous=>[...previous,{id,name}]);
  }
  function changeProject(id:string){
    setProject(Number(id)||1);
    setActive(null);setPath([]);
  }
  function unlink(id:string){
    setLinks(old=>({...old,[project]:(old[project]||[]).filter(v=>v!==id)}));
    if(active===id){setActive(null);setPath([]);}
    setRemoveId(null);setNotice("Pasta removida apenas deste exemplo. Nenhum arquivo real foi alterado.");
  }
  async function linkMultiple(items:DriveItem[]) {
    setLinks(old=>({...old,[project]:[...new Set([...(old[project]||[]),...items.map(x=>x.id)])]}));
    setNotice("Pastas vinculadas nesta demonstração. Os dados não são salvos nem enviados.");
    return true;
  }
  return <section className="rl-library" aria-label="Prévia visual da Biblioteca 2.0">
    <p className="rl-review-notice" role="status"><ShieldCheck size={18}/><span><strong>Prévia visual interativa</strong> — pastas e arquivos fictícios. Aqui você testa layout, navegação e vínculo múltiplo sem login. Nenhum dado do seu Drive é acessado.</span></p>
    <header className="rl-toolbar">
      <div className="rl-title"><span className="rl-title-icon"><FolderOpen size={20}/></span><div><h2>Arquivos dos projetos</h2><p>Explore as pastas vinculadas ao seu Google Drive.</p></div></div>
      <div className="rl-toolbar-actions">
        <div className="rl-review-account"><ShieldCheck size={16}/> Drive de exemplo <ChevronDown size={14}/></div>
        <AppButton className="primary-button" type="button" onClick={()=>{setPickerPath([root]);setPicker(true);}}><Plus size={16}/> Vincular pasta</AppButton>
      </div>
    </header>
    <div className="rl-review-project">
      <label htmlFor="rl-review-project-select">Projeto</label>
      <AppSelect id="rl-review-project-select" value={project} onValueChange={value=>changeProject(value)}>
        {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </AppSelect>
    </div>
    {notice&&<p className="rl-status" role="status"><Check size={16}/>{notice}<AppButton type="button" className="rl-retry" onClick={()=>setNotice("")}>Fechar</AppButton></p>}
    <div className="rl-explorer" data-mobile-detail={!!active}>
      <aside className="rl-folders" aria-label="Pastas vinculadas">
        <div className="rl-folders-header"><h3>Pastas do projeto</h3><small>{selected.length}</small></div>
        <div className="rl-folder-list">{selected.map(f=><div className="rl-folder-entry" data-active={active===f.id} key={f.id}>
          <AppButton className="rl-folder-button" type="button" title={f.name} onClick={()=>openFolder(f.id,f.name)}>
            <FolderOpen size={18}/><span><b>{f.name}</b><small>{projects.find(p=>p.id===project)?.name}</small></span>
          </AppButton>
          <details className="rl-menu"><summary aria-label={"Opções da pasta "+f.name}><MoreHorizontal size={17}/></summary>
            <div className="rl-menu-items"><AppButton type="button" onClick={()=>openFolder(f.id,f.name)}>Abrir pasta</AppButton><AppButton type="button" onClick={()=>setRemoveId(f.id)}>Desvincular do projeto</AppButton></div></details>
        </div>)}
        {!selected.length&&<div className="rl-state"><FolderOpen size={27}/><p>Nenhuma pasta vinculada a este projeto.</p><AppButton type="button" className="secondary-button" onClick={()=>setPicker(true)}>Vincular pasta</AppButton></div>}
        </div>
      </aside>
      <DriveFileExplorer folderName={activeFolder?.name} path={path} files={folderContent} loading={false} hasMore={false}
        onBack={()=>{setActive(null);setPath([]);}}
        onNavigate={(_,target)=>setPath(target)}
        onOpen={file=>file.mimeType===DRIVE_FOLDER?openFolder(file.id,file.name):setNotice("Prévia de arquivo indisponível neste exemplo. No sistema conectado, o arquivo original é aberto pelo Google Drive.")}
        onMore={()=>{}}/>
    </div>
    {picker&&<StorageFolderPicker projects={projects} projectId={project} onProjectChange={changeProject}
      folders={pickerPath.length===1?folders:examples[pickerPath.at(-1)?.id||""]?.filter(f=>f.mimeType===DRIVE_FOLDER)||[]}
      path={pickerPath} mode="root" onModeChange={mode=>setPickerPath([{id:mode,name:mode==="root"?"Meu Drive":"Todas as pastas"}])}
      loading={false} working={false} canRead={true} hasMore={false} error=""
      linkedIds={new Set(activeLinks)} onClose={()=>setPicker(false)} onNavigate={(_,next)=>setPickerPath(next)}
      onMore={()=>{}} onLink={linkMultiple} onConnect={()=>{}}/>}
    {removeId&&<div className="rl-overlay"><div className="rl-confirm" role="dialog" aria-modal="true" aria-label="Desvincular pasta">
      <h2>Desvincular “{folders.find(f=>f.id===removeId)?.name}”?</h2><p>A pasta não ficará mais vinculada neste exemplo. Nenhum arquivo é apagado.</p>
      <footer><AppButton type="button" className="secondary-button" onClick={()=>setRemoveId(null)}>Manter pasta</AppButton><AppButton type="button" className="primary-button" onClick={()=>unlink(removeId)}>Desvincular</AppButton></footer>
    </div></div>}
  </section>;
}
