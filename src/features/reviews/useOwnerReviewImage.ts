import {useEffect,useRef,useState} from "react";
import {useAuth} from "../auth/AuthProvider";

const API="https://roteiva-api-dev.ewertonmendes9.workers.dev";
const MAX_IMAGE_BYTES=24*1024*1024;
type State={fileId:string;url:string;loading:boolean;error:string};

/** Owner previews use a Firebase-authorized, review-scoped image endpoint.
 * No Google access tokens or private URLs are embedded in markup. Object URLs
 * live only in this modal, are LRU-bounded, and are revoked on unmount.
 */
export function useOwnerReviewImage(reviewId:string,fileId:string|undefined,enabled:boolean):State{
  const {user}=useAuth();
  const urls=useRef(new Map<string,string>());
  const [state,setState]=useState<State>({fileId:"",url:"",loading:false,error:""});
  useEffect(()=>()=>{for(const url of urls.current.values())URL.revokeObjectURL(url);urls.current.clear();},[]);
  useEffect(()=>{
    if(!enabled||!fileId||!user){
      setState({fileId:"",url:"",loading:false,error:""});
      return;
    }
    const key=reviewId+":"+fileId;
    const cached=urls.current.get(key);
    if(cached){
      // Keep frequent material switching instantaneous.
      urls.current.delete(key);urls.current.set(key,cached);
      setState({fileId,url:cached,loading:false,error:""});
      return;
    }
    const controller=new AbortController();
    setState({fileId,url:"",loading:true,error:""});
    void (async()=>{
      try{
        let response:Response|undefined;
        for(let attempt=0;attempt<2;attempt++){
          const token=await user.getIdToken(attempt===1);
          if(controller.signal.aborted)return;
          response=await fetch(API+"/reviews/"+encodeURIComponent(reviewId)+"/image?fileId="+
            encodeURIComponent(fileId),{headers:{Authorization:"Bearer "+token},
            cache:"no-store",signal:controller.signal});
          if(response.status!==401)break;
        }
        if(!response?.ok)throw new Error("Não foi possível carregar a imagem. Confira a conexão com o Google Drive.");
        const mime=(response.headers.get("Content-Type")||"").split(";")[0];
        if(!mime.startsWith("image/"))throw new Error("O arquivo recebido não é uma imagem.");
        const size=Number(response.headers.get("Content-Length")||0);
        if(size>MAX_IMAGE_BYTES)throw new Error("A imagem é grande demais para a prévia. Abra no Google Drive.");
        const blob=await response.blob();
        if(blob.size>MAX_IMAGE_BYTES)throw new Error("A imagem é grande demais para a prévia. Abra no Google Drive.");
        if(controller.signal.aborted)return;
        const objectUrl=URL.createObjectURL(blob);
        urls.current.set(key,objectUrl);
        while(urls.current.size>2){
          const oldest=urls.current.keys().next().value;
          if(oldest===undefined)break;
          URL.revokeObjectURL(urls.current.get(oldest)!);urls.current.delete(oldest);
        }
        setState({fileId,url:objectUrl,loading:false,error:""});
      }catch(e){
        if(!controller.signal.aborted)setState({fileId,url:"",loading:false,
          error:e instanceof Error?e.message:"Não foi possível carregar a imagem."});
      }
    })();
    return()=>controller.abort();
  },[enabled,fileId,reviewId,user]);
  return state;
}
