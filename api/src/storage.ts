/** Provider-neutral contract for the Roteiva library and review systems. */
export type StorageProviderId = 'google_drive'|'dropbox';
export type StorageCapability = 'browse'|'search'|'thumbnail'|'resumableUpload'|'streamRange'|'directShare';
export type StorageAssetRef = {
  provider: StorageProviderId;
  connectionId: string;
  fileId: string;
  linkedFolderId: string;
};
export type StorageFile = {
  id: string; name: string; mimeType: string; size?: string;
  modifiedTime?: string; pathDisplay?: string;
  isFolder: boolean; webViewLink?: string; thumbnailAvailable?: boolean;
};
export type StorageFolderPage = {
  folder: {id:string;name:string};
  files: StorageFile[];
  nextPageToken: string|null;
};
export const STORAGE_CAPABILITIES: Readonly<Record<StorageProviderId,Readonly<Record<StorageCapability,boolean>>>>={
  google_drive:{browse:true,search:true,thumbnail:true,resumableUpload:true,streamRange:true,directShare:true},
  dropbox:{browse:true,search:true,thumbnail:true,resumableUpload:true,streamRange:true,directShare:false}
} as const;
const GOOGLE_ID=/^[A-Za-z0-9_-]{10,200}$/;
const DROPBOX_ID=/^id:[A-Za-z0-9_-]{8,200}$/;
export function validStorageFileId(provider:StorageProviderId,id:string):boolean {
  return (provider==='dropbox'?DROPBOX_ID:GOOGLE_ID).test(id);
}
export function validStorageFolderId(provider:StorageProviderId,id:string,allowRoot=false):boolean {
  return (allowRoot&&id==='root')||validStorageFileId(provider,id);
}
export function validConnectionId(id:string):boolean {
  return /^[a-f0-9-]{36}$/i.test(id);
}
export function isStorageProvider(x:unknown):x is StorageProviderId {
  return x==='google_drive'||x==='dropbox';
}
export function isStorageSelection(x:unknown):x is StorageAssetRef {
  if(!x||typeof x!=='object')return false;
  const a=x as Partial<StorageAssetRef>;
  return isStorageProvider(a.provider)&&typeof a.connectionId==='string'&&
    validConnectionId(a.connectionId)&&typeof a.fileId==='string'&&
    validStorageFileId(a.provider,a.fileId)&&typeof a.linkedFolderId==='string'&&
    validStorageFolderId(a.provider,a.linkedFolderId);
}
export function storageFileKey(ref:Pick<StorageAssetRef,'provider'|'fileId'>):string {
  if(!validStorageFileId(ref.provider,ref.fileId))throw new TypeError('invalid_storage_file_id');
  return ref.provider+':'+ref.fileId;
}
