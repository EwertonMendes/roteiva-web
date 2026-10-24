import type {DriveItem} from '../drive/DriveLibraryUI';
/** Dropbox's own web UI, never a generated public/download link. */
export function dropboxWebUrl(file:Pick<DriveItem,'pathDisplay'>):string{
 const path=file.pathDisplay;
 if(!path||!path.startsWith('/')||path.includes('\\0'))return 'https://www.dropbox.com/home';
 const segments=path.split('/').slice(1);
 if(!segments.length||segments.some(s=>!s||s==='.'||s==='..'||/[\\u0000-\\u001f]/.test(s)))
   return 'https://www.dropbox.com/home';
 return 'https://www.dropbox.com/home/'+segments.map(encodeURIComponent).join('/');
}
