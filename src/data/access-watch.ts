import {doc,onSnapshot,type Firestore} from "firebase/firestore";
import {readOwnServerDocument} from './firestore-server-read.ts';
import {parseAccess,parseAccessRest,type AccessInfo} from './access-state.ts';
import {observeAccess} from './access-observer.ts';
export {parseAccess,type AccessInfo} from './access-state.ts';

async function readServerAccess(db:Firestore,uid:string):Promise<AccessInfo|null>{
  const document=await readOwnServerDocument(db,uid,'access/current');
  return document?parseAccessRest(document,document.name,uid):null;
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
