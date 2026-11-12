import type {InspectedLibrarySource} from '../../../shared/library-selection';
import type {VirtualFolderPlan} from './library-structure-plan';
import type {LibraryImport} from './library-import';
export type AssistedFile=LibraryImport&{targetKey:string|null};
export type AssistedPlan={folders:VirtualFolderPlan[];files:AssistedFile[];adapted:number;atRoot:number};
export function assistedLibraryPlan(input:InspectedLibrarySource[]):AssistedPlan{
 const sources=[...new Map(input.map(x=>[x.provider+':'+x.connectionId+':'+x.fileId,x])).values()];
 const directories=sources.filter(x=>x.kind==='folder');if(directories.length>80)throw new Error('Selecione até 80 pastas por operação.');
 const id=(x:InspectedLibrarySource)=>x.provider+':'+x.connectionId+':'+x.fileId;
 const parentOf=(source:InspectedLibrarySource)=>{
  const matches=directories.filter(parent=>parent.provider===source.provider&&parent.connectionId===source.connectionId&&
   (source.provider==='google_drive'?source.parentIds.includes(parent.fileId):Boolean(source.path&&parent.path&&source.path.slice(0,source.path.lastIndexOf('/'))===parent.path)));
  return matches.length===1?matches[0]:null;
 };
 const keys=new Map<string,string>(),folders:VirtualFolderPlan[]=[],pending=[...directories],names=new Set<string>();let adapted=0;
 while(pending.length){
  let progress=false;
  for(let i=0;i<pending.length;){
   const source=pending[i],parent=parentOf(source);if(parent&&!keys.has(id(parent))){i++;continue;}
   const parentKey=parent?keys.get(id(parent))!:null;
   let name=source.name.normalize('NFC').replace(/[/\\\x00-\x1f\x7f]/g,' — ').trim().slice(0,120)||'Pasta';
   const original=name;let suffix=1;
   while(names.has(JSON.stringify([parentKey,name.toLocaleLowerCase('pt-BR')]))){const tail=' ('+(++suffix)+')';name=original.slice(0,120-tail.length)+tail;}
   if(name!==source.name)adapted++;
   names.add(JSON.stringify([parentKey,name.toLocaleLowerCase('pt-BR')]));
   const key='source-folder-'+folders.length;keys.set(id(source),key);folders.push({key,parentKey,name});pending.splice(i,1);progress=true;
  }
  if(!progress)throw new Error('A seleção contém uma organização inconsistente. Selecione as pastas novamente.');
 }
 let atRoot=0;
 const files=sources.filter(x=>x.kind==='asset').map(source=>{
  const parent=parentOf(source),targetKey=parent?keys.get(id(parent))||null:null;if(!targetKey)atRoot++;
  return {provider:source.provider,connectionId:source.connectionId,fileId:source.fileId,name:source.name,targetKey};
 });
 return {folders,files,adapted,atRoot};
}
