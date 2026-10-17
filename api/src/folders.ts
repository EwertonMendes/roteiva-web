import { ApiError, type Env } from './types.ts';
import { connection } from './repository.ts';
import { accessToken, DRIVE_READ_SCOPE } from './google.ts';

export type DriveItem = {
  id:string; name:string; mimeType:string;
  size?:string; modifiedTime?:string; thumbnailLink?:string;
  webViewLink?:string; parents?:string[];
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
    thumbnailLink:value.thumbnailLink, webViewLink:value.webViewLink, parents:value.parents,
  };
}
async function driveFetch(url: URL, token:string, fetcher:typeof fetch): Promise<Record<string,unknown>> {
  let response:Response;
  try{
    response=await fetcher(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
  }catch{throw new ApiError(502,'google_unavailable');}
  if(response.status===401||response.status===403)throw new ApiError(409,'drive_read_permission_missing');
  if(response.status===404)throw new ApiError(404,'drive_folder_not_found');
  if(!response.ok)throw new ApiError(502,'drive_unavailable');
  try{return await response.json() as Record<string,unknown>;}
  catch{throw new ApiError(502,'invalid_google_response');}
}
async function authorize(env:Env,uid:string,connectionId:string,fetcher:typeof fetch) {
  const row=await connection(env,uid,connectionId);
  if(!row.scopes.split(' ').includes(DRIVE_READ_SCOPE))throw new ApiError(409,'drive_read_permission_missing');
  return accessToken(env,row,fetcher);
}

/** Read-only folder picker built on Drive API. Pages are bounded and opt-in scoped. */
export async function listFolders(env:Env,uid:string,connectionId:string,parent:string,page:string|null,fetcher:typeof fetch=fetch){
  const parentId=validateId(parent,true);
  const pageToken=validatePage(page);
  const token=await authorize(env,uid,connectionId,fetcher);
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
  const data=await driveFetch(url,token,fetcher);
  if(!Array.isArray(data.files))throw new ApiError(502,'invalid_google_response');
  return Response.json({folders:(data.files as DriveItem[]).map(safeItem),
    nextPageToken:typeof data.nextPageToken==='string'?data.nextPageToken:null,
    incompleteSearch:data.incompleteSearch===true});
}

/** Verify selected folder exists, then list its direct files (not recursive). */
export async function listFolderItems(env:Env,uid:string,connectionId:string,folderId:string,page:string|null,fetcher:typeof fetch=fetch){
  const id=validateId(folderId);
  const pageToken=validatePage(page);
  const token=await authorize(env,uid,connectionId,fetcher);
  const infoUrl=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id));
  infoUrl.searchParams.set('fields','id,name,mimeType,trashed');
  infoUrl.searchParams.set('supportsAllDrives','true');
  const info=await driveFetch(infoUrl,token,fetcher);
  if(info.mimeType!==FOLDER || info.trashed===true)throw new ApiError(404,'drive_folder_not_found');
  const url=new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q',`'${id}' in parents and trashed = false`);
  url.searchParams.set('fields','nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,parents),incompleteSearch');
  url.searchParams.set('pageSize','100');
  url.searchParams.set('orderBy','folder,name');
  url.searchParams.set('supportsAllDrives','true');
  url.searchParams.set('includeItemsFromAllDrives','true');
  if(pageToken)url.searchParams.set('pageToken',pageToken);
  const data=await driveFetch(url,token,fetcher);
  if(!Array.isArray(data.files))throw new ApiError(502,'invalid_google_response');
  return Response.json({folder:{id:info.id,name:info.name},
    files:(data.files as DriveItem[]).map(safeItem),
    nextPageToken:typeof data.nextPageToken==='string'?data.nextPageToken:null,
    incompleteSearch:data.incompleteSearch===true});
}
