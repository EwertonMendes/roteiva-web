import { ApiError, type Env } from './types.ts';
import { connection } from './repository.ts';
import { DRIVE_READ_SCOPE } from './google.ts';
import { driveJson } from './drive-client.ts';
import { sealThumbnailTicket } from './thumbnails.ts';

export type DriveItem = {
  id:string; name:string; mimeType:string;
  size?:string; modifiedTime?:string; thumbnailLink?:string;
  webViewLink?:string; parents?:string[]; thumbnailTicket?:string;
};
const FOLDER = 'application/vnd.google-apps.folder';
const idPattern = /^[A-Za-z0-9_-]{10,200}$/;

function validateId(id: string, allowRoot = false) {
  if ((allowRoot && (id === 'root' || id === 'all')) || idPattern.test(id)) return id;
  throw new ApiError(400, 'invalid_folder_id');
}
function validatePage(page: string | null): string {
  if (!page) return '';
  if (page.length > 2048 || /[\x00-\x20\x7F]/.test(page)) throw new ApiError(400, 'invalid_page_token');
  return page;
}
function safeItem(value: DriveItem): DriveItem {
  return {
    id:value.id, name:value.name, mimeType:value.mimeType,
    size:value.size, modifiedTime:value.modifiedTime,
    thumbnailTicket:value.thumbnailTicket, webViewLink:value.webViewLink, parents:value.parents,
  };
}
async function authorize(env:Env,uid:string,connectionId:string,fetcher:typeof fetch) {
  const row=await connection(env,uid,connectionId);
  if(!row.scopes.split(' ').includes(DRIVE_READ_SCOPE))throw new ApiError(409,'drive_read_permission_missing');
  return row;
}

/** Read-only folder picker built on Drive API. Pages are bounded and opt-in scoped. */
export async function listFolders(env:Env,uid:string,connectionId:string,parent:string,page:string|null,fetcher:typeof fetch=fetch){
  const parentId=validateId(parent,true);
  const pageToken=validatePage(page);
  const row=await authorize(env,uid,connectionId,fetcher);
  const url=new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q',parentId === 'all'
    ? `mimeType = '${FOLDER}' and trashed = false`
    : `'${parentId}' in parents and mimeType = '${FOLDER}' and trashed = false`);
  url.searchParams.set('fields','nextPageToken,files(id,name,mimeType,parents),incompleteSearch');
  url.searchParams.set('pageSize','100');
  url.searchParams.set('orderBy','name');
  url.searchParams.set('supportsAllDrives','true');
  url.searchParams.set('includeItemsFromAllDrives','true');
  if(pageToken)url.searchParams.set('pageToken',pageToken);
  const data=await driveJson(env,row,url,fetcher,'drive_folder_not_found');
  if(!Array.isArray(data.files))throw new ApiError(502,'invalid_google_response');
  return Response.json({folders:(data.files as DriveItem[]).map(safeItem),
    nextPageToken:typeof data.nextPageToken==='string'?data.nextPageToken:null,
    incompleteSearch:data.incompleteSearch===true});
}

/** Direct-child search. Drive query escaping is independent of URL encoding. */
function cleanSearch(value:string|null):string {
  if(!value)return '';
  const trimmed=value.trim();
  if(trimmed.length>100||/[\\x00-\\x1F\\x7F]/.test(trimmed))throw new ApiError(400,'invalid_search');
  return trimmed.length>=2?trimmed:'';
}
function driveQuote(value:string){
  return value.replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'");
}

/** Parallel folder validation and listing remove a sequential Drive round-trip. */
export async function listFolderItems(env:Env,uid:string,connectionId:string,folderId:string,
  page:string|null,fetcher:typeof fetch=fetch,search:string|null=null){
  const id=validateId(folderId);
  const pageToken=validatePage(page);
  const term=cleanSearch(search);
  const row=await authorize(env,uid,connectionId,fetcher);
  const infoUrl=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id));
  infoUrl.searchParams.set('fields','id,name,mimeType,trashed');
  infoUrl.searchParams.set('supportsAllDrives','true');
  const url=new URL('https://www.googleapis.com/drive/v3/files');
  const predicate=`'${id}' in parents and trashed = false`;
  url.searchParams.set('q',term?predicate+` and name contains '${driveQuote(term)}'`:predicate);
  url.searchParams.set('fields','nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,parents),incompleteSearch');
  url.searchParams.set('pageSize','100');
  url.searchParams.set('orderBy','folder,name');
  url.searchParams.set('supportsAllDrives','true');
  url.searchParams.set('includeItemsFromAllDrives','true');
  if(pageToken)url.searchParams.set('pageToken',pageToken);
  const started=Date.now();
  const [info,data]=await Promise.all([
    driveJson(env,row,infoUrl,fetcher,'drive_folder_not_found'),
    driveJson(env,row,url,fetcher,'drive_folder_not_found')
  ]);
  if(info.mimeType!==FOLDER||info.trashed===true)throw new ApiError(404,'drive_folder_not_found');
  if(!Array.isArray(data.files))throw new ApiError(502,'invalid_google_response');
  const latest=await connection(env,uid,connectionId);
  if(latest.status!=='connected')throw new ApiError(409,'reconnect_required');
  const files=await Promise.all((data.files as DriveItem[]).map(async file=>{
    const result=safeItem(file);
    if(file.thumbnailLink){
      result.thumbnailTicket=await sealThumbnailTicket(env,uid,connectionId,latest.revision,file.id,file.thumbnailLink);
    }
    return result;
  }));
  console.info(JSON.stringify({event:'drive_folder_list',durationMs:Date.now()-started,count:files.length,
    mode:term?'search':'folder'}));
  return Response.json({folder:{id:info.id,name:info.name},files,
    nextPageToken:typeof data.nextPageToken==='string'?data.nextPageToken:null,
    incompleteSearch:data.incompleteSearch===true});
}
