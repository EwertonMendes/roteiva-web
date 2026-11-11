import {doc,onSnapshot,type Firestore} from "firebase/firestore";
import {getAuth} from 'firebase/auth';
import {appEnvironment} from '../lib/environment.ts';
import {parseAccess,parseAccessRest,type AccessInfo} from './access-state.ts';
import {observeAccess} from './access-observer.ts';
export {parseAccess,type AccessInfo} from './access-state.ts';

async function readServerAccess(db:Firestore,uid:string):Promise<AccessInfo|null>{
  const auth=getAuth(db.app),user=auth.currentUser;
  const project=appEnvironment.firebase?.projectId;
  if(!user||user.uid!==uid||!project||db.app.options.projectId!==project)throw new Error('Sessão inválida.');
  const token=await user.getIdToken();
  if(auth.currentUser?.uid!==uid)throw new Error('Sessão alterada.');
  const name='projects/'+project+'/databases/(default)/documents/users/'+encodeURIComponent(uid)+'/access/current';
  const origin=appEnvironment.useEmulators?'http://127.0.0.1:8080':'https://firestore.googleapis.com';
  const response=await fetch(origin+'/v1/'+name,{headers:{Authorization:'Bearer '+token},
    cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(auth.currentUser?.uid!==uid)throw new Error('Sessão alterada.');
  if(response.status===404)return null;
  if(!response.ok)throw new Error('Leitura de acesso negada ou indisponível.');
  const document=await response.json();
  if(auth.currentUser?.uid!==uid)throw new Error('Sessão alterada.');
  return parseAccessRest(document,name,uid);
}

export function watchAccess(db:Firestore,uid:string,onValue:(access:AccessInfo)=>void,onError:(error:Error)=>void):()=>void{
  return observeAccess((next,error)=>onSnapshot(doc(db,'users',uid,'access','current'),
    {includeMetadataChanges:true},snapshot=>{
      if(snapshot.metadata.fromCache)return;
      try{
        const data=snapshot.exists()?snapshot.data():null;
        if(data&&data.ownerUid!==uid)throw new Error('Projeção de outro usuário.');
        next({fromCache:false,value:data?parseAccess(data):null});
      }catch{error();}
    },error),()=>readServerAccess(db,uid),onValue,onError);
}
