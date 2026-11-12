import {useEffect,useState} from 'react';
import {useAuth} from '../auth/AuthProvider';
import {authenticatedOwnerReviewMedia} from '../drive/authenticated-media';
import {ReviewPdfViewer} from './ReviewPdfViewer';
import {ReviewImageViewer} from './ReviewImageViewer';
import type {Asset} from './review-model';
export function ReviewSourcePreview({reviewId,asset}:{reviewId:string;asset:Asset}){
 const {user}=useAuth(),[url,setURL]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  setURL('');setError('');if(!user)return;let alive=true,release:(()=>void)|undefined;
  void authenticatedOwnerReviewMedia(reviewId,asset.fileId,()=>user.getIdToken()).then(binding=>{
   if(!alive){binding.close();return;}release=binding.close;setURL(binding.url);
  }).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Não foi possível abrir a versão enviada.');});
  return()=>{alive=false;release?.();};
 },[reviewId,asset.fileId,user]);
 const fail=()=>setError('A versão enviada está indisponível ou o navegador não reproduz este formato. O arquivo atual não substitui esta versão.');
 if(error)return <p role="alert" className="reviews-warning">{error}</p>;
 if(!url)return <p role="status">Preparando a versão enviada…</p>;
 return asset.mimeType==='application/pdf'?<ReviewPdfViewer src={url} name={asset.name}/>:
 asset.mimeType.startsWith('image/')?<ReviewImageViewer src={url} name={asset.name}/>:
 asset.mimeType.startsWith('video/')?<video src={url} controls playsInline preload="metadata" onError={fail}/>:
 <audio src={url} controls preload="metadata" onError={fail}/>;
}
