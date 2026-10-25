import type {DriveItem} from '../drive/DriveLibraryUI';
/** Opens the selected original in Dropbox's own UI; never generates a public link. */
export function dropboxWebUrl(file:Pick<DriveItem,'pathDisplay'>):string{
 const path=file.pathDisplay;
 if(!path||!path.startsWith('/'))return 'https://www.dropbox.com/home';
 const parts=path.split('/').slice(1);
 if(!parts.length||parts.some(part=>!part||part==='.'||part==='..'||[...part].some(ch=>ch.charCodeAt(0)<32)))
   return 'https://www.dropbox.com/home';
 return 'https://www.dropbox.com/home/'+parts.map(encodeURIComponent).join('/');
}
