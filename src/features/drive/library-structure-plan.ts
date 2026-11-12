export type VirtualFolderPlan={key:string;parentKey:string|null;name:string};
/** Paths describe only virtual organization; they never become provider/filesystem paths. */
export function folderPlanFromPaths(text:string):VirtualFolderPlan[]{
 if(text.length>20000)throw new Error('A estrutura é grande demais. Use até 80 pastas por operação.');
 const folders:VirtualFolderPlan[]=[],known=new Map<string,string>();
 for(const line of text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)){
  const segments=line.split('/').map(x=>x.normalize('NFC').trim());
  if(segments.length>16||segments.some(x=>!x||x==='.'||x==='..'||x.length>120||/[\\\x00-\x1f\x7f]/.test(x)))throw new Error('Use nomes de até 120 caracteres e até 16 níveis, separados por /.');
  let parentKey:string|null=null;
  for(let i=0;i<segments.length;i++){
   const path=JSON.stringify(segments.slice(0,i+1));let key=known.get(path);
   if(!key){key='folder-'+folders.length;known.set(path,key);folders.push({key,parentKey,name:segments[i]});if(folders.length>80)throw new Error('Use até 80 pastas por operação.');}
   parentKey=key;
  }
 }
 return folders;
}
export const folderTemplates={
 video:'Briefing\nReferências\nVídeos/Originais\nVídeos/Edição\nÁudios\nEntregas/Em revisão\nEntregas/Aprovados',
 photo:'Briefing\nReferências\nFotos/Originais\nFotos/Seleção\nFotos/Tratadas\nEntregas/Em revisão\nEntregas/Aprovados',
 design:'Briefing\nReferências\nArquivos de trabalho\nEntregas/Em revisão\nEntregas/Aprovados',
};
