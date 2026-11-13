import {useCallback} from 'react';
import {useAuth} from '../auth/AuthProvider';
import {API_BASE_URL} from '../../lib/environment';
import type {DriveItem} from './DriveLibraryUI';
import type {MediaProvider} from './storage-image-cache';

/** One authenticated image transport for picker and virtual library; no provider URL or token enters img src. */
export function useStorageThumbnailFetch(provider:MediaProvider){
 const {user}=useAuth();
 return useCallback(async(item:DriveItem,signal?:AbortSignal,connectionId?:string):Promise<Blob|null>=>{
  if(!user||!connectionId||!item.id)return null;
  const base='/integrations/'+(provider==='google_drive'?'drive':'dropbox')+'/'+
    encodeURIComponent(connectionId)+'/files/'+encodeURIComponent(item.id)+'/thumbnail';
  const uri=API_BASE_URL+base;
  try{
   let response:Response|null=null;
   for(let attempt=0;attempt<2;attempt++){
    const token=await user.getIdToken(attempt>0);
    response=await fetch(uri,{method:'GET',headers:{Authorization:'Bearer '+token},signal,cache:'no-store'});
    if(response.status!==401)break;
   }
   if(!response?.ok||response.status===204)return null;
   const mime=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
   if(!['image/jpeg','image/png','image/webp','image/avif'].includes(mime))return null;
   const blob=await response.blob();
   return blob.size>0&&blob.size<=2*1024*1024?blob:null;
  }catch(error){if(signal?.aborted)throw error;return null;}
 },[user,provider]);
}
