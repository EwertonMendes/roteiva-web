import {File,FileAudio,FileImage,FileText,FileVideo} from 'lucide-react';
import {DriveThumbnail} from './DriveThumbnail';
import {useStorageThumbnailFetch} from './useStorageThumbnailFetch';
import type {DriveItem} from './DriveLibraryUI';
import type {MediaProvider} from './storage-image-cache';

export type LibraryThumbnailSource={
 id:string;name:string;kind:'folder'|'asset';provider?:string;connection_id?:string;
 file_id?:string;source_revision?:string;mime_type?:string;
};
function glyph(mime:string){
 if(mime.startsWith('image/'))return FileImage;
 if(mime.startsWith('audio/'))return FileAudio;
 if(mime.startsWith('video/'))return FileVideo;
 if(mime==='application/pdf')return FileText;
 return File;
}
/** Uses the identical lazy loading, deduplication and permission-scoped image cache as Drive. */
export function LibraryThumbnail({node,uid}:{node:LibraryThumbnailSource;uid:string}){
 const provider:MediaProvider=node.provider==='dropbox'?'dropbox':'google_drive';
 const getThumbnail=useStorageThumbnailFetch(provider);
 const mime=node.mime_type||'';
 const supported=mime.startsWith('image/')||mime.startsWith('video/')||mime==='application/pdf';
 if(node.kind!=='asset'||!node.file_id||!node.connection_id||!uid||!supported){
  const Icon=glyph(mime);return <Icon size={23} aria-hidden="true"/>;
 }
 const item:DriveItem={id:node.file_id,name:node.name,mimeType:mime,
  modifiedTime:node.source_revision,thumbnailFallback:true};
 return <DriveThumbnail item={item} scope={uid+':'+node.connection_id}
  provider={provider} getThumbnail={getThumbnail}/>;
}
