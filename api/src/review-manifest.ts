import {hash} from './crypto.ts';
type Asset={provider:string;connection_id:string;file_id:string;name?:string;mime_type:string;source_revision?:string|null;source_size?:string|null;source_checksum?:string|null};
export async function reviewManifestHash(files:Asset[]){
 return hash(JSON.stringify(files.map(a=>[a.provider,a.connection_id,a.file_id,a.name||'',a.mime_type,a.source_revision,a.source_size,a.source_checksum||null])));
}
