const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
// openid supplies the stable subject needed to bind the grant to a connection.
const SCOPE='openid '+DRIVE_SCOPE;
export type PickerConfig={authorized:false;clientId:string;appId:string;developerKey:string;accountId:string};
type TokenReply={access_token?:string;scope?:string;error?:string;expires_in?:number};
type PickerReply={action:string;docs?:{id:string;name?:string;resourceKey?:string}[]};
interface View {setIncludeFolders(value:boolean):View;setSelectFolderEnabled(value:boolean):View;setMode(value:unknown):View;setMimeTypes(value:string):View;}
interface Picker {setVisible(value:boolean):void;dispose():void;}
interface Builder {addView(view:View):Builder;setOAuthToken(token:string):Builder;setDeveloperKey(key:string):Builder;
  enableFeature(feature:unknown):Builder;setMaxItems(max:number):Builder;
  setAppId(id:string):Builder;setOrigin(origin:string):Builder;setTitle(title:string):Builder;
  setSize(width:number,height:number):Builder;setCallback(callback:(reply:PickerReply)=>void):Builder;build():Picker;}
type Google={accounts:{oauth2:{initTokenClient(config:{client_id:string;scope:string;include_granted_scopes:false;
  login_hint:string;callback:(reply:TokenReply)=>void;error_callback:()=>void}):{requestAccessToken(config:{prompt:string}):void}}};
  picker:{DocsView:new(id:unknown)=>View;ViewId:{FOLDERS:unknown;DOCS:unknown};Feature:{MULTISELECT_ENABLED:unknown};DocsViewMode:{LIST:unknown};PickerBuilder:new()=>Builder}};
const api=()=> (window as unknown as {google:Google}).google;
let loading:Promise<void>|undefined;
function script(src:string):Promise<void>{
  return new Promise((resolve,reject)=>{
    const element=document.createElement('script');element.src=src;element.async=true;
    element.onload=()=>resolve();element.onerror=()=>{element.remove();reject(new Error('Não foi possível carregar a autorização Google.'));};
    document.head.append(element);
  });
}
export function preparePicker():Promise<void>{
  return loading??=(async()=>{
    await Promise.all([script('https://accounts.google.com/gsi/client'),script('https://apis.google.com/js/api.js')]);
    await new Promise<void>((resolve,reject)=>{
      const gapi=(window as unknown as {gapi:{load:(name:string,options:unknown)=>void}}).gapi;
      gapi.load('picker',{callback:resolve,onerror:()=>reject(new Error('O seletor Google está indisponível.')),
        timeout:15000,ontimeout:()=>reject(new Error('O seletor Google demorou para responder.'))});
    });
  })().catch(error=>{loading=undefined;throw error;});
}

/** Config/scripts are prepared before the click so GIS preserves the user gesture. */
export function pickLibraryFiles(config:PickerConfig,verify:(token:string)=>Promise<unknown>,signal:AbortSignal,options?:{mimeTypes?:string;maxItems?:number;title?:string;includeFolders?:boolean;onDocuments?:(docs:{id:string;name?:string;resourceKey?:string}[])=>void}):Promise<string[]>{
 return new Promise((resolve,reject)=>{
 let picker:Picker|undefined,settled=false;
 const finish=(ids?:string[],error?:Error)=>{if(settled)return;settled=true;clearTimeout(timeout);signal.removeEventListener('abort',abort);picker?.dispose();error?reject(error):resolve(ids||[]);};
 const abort=()=>finish([],undefined);
 const timeout=setTimeout(()=>finish(undefined,new Error('A seleção expirou. Abra o seletor novamente.')),180000);
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
 api().accounts.oauth2.initTokenClient({client_id:config.clientId,scope:SCOPE,include_granted_scopes:false,login_hint:config.accountId,error_callback:abort,callback:reply=>{
 void(async()=>{
 if(settled)return;const scopes=new Set(reply.scope?.trim().split(/\s+/));
 if(reply.error||!reply.access_token||scopes.size!==2||!scopes.has('openid')||!scopes.has(DRIVE_SCOPE)||!reply.expires_in||reply.expires_in<60)throw new Error('O Google não concedeu a autorização necessária.');
 await verify(reply.access_token);if(settled)return;
 const google=api().picker;
 const view=new google.DocsView(google.ViewId.DOCS).setIncludeFolders(options?.includeFolders===true).setSelectFolderEnabled(options?.includeFolders===true).setMode(google.DocsViewMode.LIST);
 if(options?.mimeTypes)view.setMimeTypes(options.mimeTypes);
 const maxItems=options?.maxItems||100;
 picker=new google.PickerBuilder().addView(view)
 .enableFeature(google.Feature.MULTISELECT_ENABLED).setMaxItems(maxItems).setAppId(config.appId).setDeveloperKey(config.developerKey).setOAuthToken(reply.access_token)
 .setOrigin(window.location.origin).setTitle(options?.title||'Adicionar arquivos ao Roteiva')
 .setSize(Math.max(280,Math.min(900,window.innerWidth-24)),Math.max(300,Math.min(600,window.innerHeight-40)))
 .setCallback(data=>{if(data.action==='cancel')abort();if(data.action==='picked'){
 const ids=Array.from(new Set(data.docs?.map(x=>x.id)||[]));
 if(!ids.length||ids.length>maxItems||ids.some(id=>!/^[A-Za-z0-9_-]{10,200}$/.test(id)))finish(undefined,new Error('A seleção retornou arquivos inválidos.'));else{options?.onDocuments?.(data.docs||[]);finish(ids);}
 }}).build();picker.setVisible(true);
 })().catch(error=>finish(undefined,error instanceof Error?error:new Error('Não foi possível abrir o seletor.')));
 }}).requestAccessToken({prompt:''});
 });
}

/** Called directly by a button after preparePicker, preserving the popup user gesture. */
export function pickUploadFolder(config:PickerConfig,folderId:string,folderName:string,
  verify:(token:string)=>Promise<unknown>,signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
    let picker:Picker|undefined;let settled=false;let token='';
    const finish=(error?:Error)=>{
      if(settled)return;settled=true;token='';picker?.dispose();
      signal.removeEventListener('abort',abort);clearTimeout(timeout);
      if(error)reject(error);else resolve();
    };
    const abort=()=>finish(new Error('Autorização cancelada.'));
    const timeout=setTimeout(()=>finish(new Error('A autorização expirou. Tente novamente.')),180000);
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted){abort();return;}
    api().accounts.oauth2.initTokenClient({client_id:config.clientId,scope:SCOPE,include_granted_scopes:false,
      login_hint:config.accountId,error_callback:abort,callback:reply=>{
        void (async()=>{
          if(settled)return;
          const scopes=new Set(reply.scope?.trim().split(/\s+/));
          if(reply.error||!reply.access_token||scopes.size!==2||!scopes.has('openid')||!scopes.has(DRIVE_SCOPE)||!reply.expires_in||reply.expires_in<60)
            throw new Error('O Google não concedeu a autorização necessária. Tente novamente.');
          token=reply.access_token;
          await verify(token); // Server verifies audience, Google subject, expiry and exact scope.
          if(settled)return;
          const google=api().picker;
          picker=new google.PickerBuilder()
            .addView(new google.DocsView(google.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMode(google.DocsViewMode.LIST))
            .setAppId(config.appId).setDeveloperKey(config.developerKey).setOAuthToken(token)
            .setOrigin(window.location.origin).setTitle('Autorizar pasta: '+folderName)
            .setSize(Math.max(280,Math.min(900,window.innerWidth-24)),Math.max(300,Math.min(600,window.innerHeight-40)))
            .setCallback(data=>{
              if(data.action==='cancel')abort();
              if(data.action==='picked')finish(data.docs?.length===1&&data.docs[0].id===folderId?undefined:
                new Error('Selecione a mesma pasta de destino: '+folderName+'.'));
            }).build();
          picker.setVisible(true);token='';
        })().catch(error=>finish(error instanceof Error?error:new Error('Não foi possível autorizar a pasta.')));
      },
    }).requestAccessToken({prompt:''});
  });
}
