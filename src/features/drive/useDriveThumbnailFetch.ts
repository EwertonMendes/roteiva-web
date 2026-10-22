import {useCallback} from "react";
import {useAuth} from "../auth/AuthProvider";
import type {DriveItem} from "./DriveLibraryUI";

const API="https://roteiva-api-dev.ewertonmendes9.workers.dev";

/** Shared authenticated thumbnail loader. Only opaque tickets are passed to the
 * Worker; Google upstream URLs and OAuth tokens never enter image src attributes. */
export function useDriveThumbnailFetch(){
  const {user}=useAuth();
  return useCallback(async(file:DriveItem,signal?:AbortSignal,accountId?:string):Promise<Blob|null>=>{
    if(!user||!accountId||(!file.thumbnailTicket&&!file.thumbnailLink&&!file.thumbnailFallback))return null;
    const base="/integrations/drive/"+encodeURIComponent(accountId)+"/files/"+encodeURIComponent(file.id)+"/thumbnail";
    const load=async(useTicket:boolean,refreshToken=false)=>{
      const token=await user.getIdToken(refreshToken);
      return fetch(API+(useTicket&&file.thumbnailTicket?base+"?ticket="+encodeURIComponent(file.thumbnailTicket):base),
        {headers:{Authorization:"Bearer "+token},signal,cache:"no-store"});
    };
    try{
      let response=await load(Boolean(file.thumbnailTicket));
      if(response.status===401)response=await load(Boolean(file.thumbnailTicket),true);
      if(file.thumbnailTicket&&(response.status===403||response.status===410))response=await load(false);
      if(!response.ok)return null;
      if(!(response.headers.get("Content-Type")||"").startsWith("image/"))return null;
      const blob=await response.blob();
      return blob.size>0&&blob.size<=1024*1024?blob:null;
    }catch{return null;}
  },[user]);
}
