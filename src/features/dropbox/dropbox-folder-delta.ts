import type {DriveItem} from '../drive/DriveLibraryUI';

export type DropboxChange=DriveItem|{deleted:true;pathLower:string};
export type DropboxDelta={reset?:boolean;changes?:DropboxChange[];syncCursor?:string;hasMore?:boolean};
const pathOf=(item:DriveItem)=>(item.pathLower||item.pathDisplay||'').toLocaleLowerCase('en-US');

/** Dropbox change cursors can include removals and renames. Apply by ID and
 * normalized Dropbox path (not name) to avoid affecting same-named siblings. */
export function applyDropboxChanges(files:DriveItem[],changes:DropboxChange[]):DriveItem[]{
 const next=new Map(files.map(file=>[file.id,file]));
 for(const change of changes){
  if('deleted' in change){
   const path=change.pathLower.toLocaleLowerCase('en-US');
   for(const [id,file] of next)if(pathOf(file)===path)next.delete(id);
  }else{
   for(const [id,file] of next){
    if(id!==change.id&&pathOf(change)&&pathOf(file)===pathOf(change))next.delete(id);
   }
   next.set(change.id,change);
  }
 }
 return [...next.values()];
}
