import {test,expect} from '@playwright/test';
import {withMediaServer} from './media-fixture';
const origin='http://127.0.0.1:4173';
test('native media transport binds the URL to its tab and forwards authenticated ranges',async({page,context})=>{
 await withMediaServer(async received=>{
 await page.goto(origin+'/sobre.html');
 const url=await page.evaluate(async()=>{
 await navigator.serviceWorker.register('/roteiva-media-sw.js?mediaProtocol=3',{scope:'/'});
 await navigator.serviceWorker.ready;
 if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));
 navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='media-authorization')event.ports[0].postMessage({authorization:'Bearer browser-synthetic'});});
 const id=crypto.randomUUID(),channel=new MessageChannel();
 const ready=new Promise<void>((resolve,reject)=>{channel.port1.onmessage=e=>{channel.port1.close();e.data.ok?resolve():reject(new Error('binding failed'));};});
 navigator.serviceWorker.controller!.postMessage({type:'bind-media',id,url:'http://127.0.0.1:8787/library/projects/17/nodes/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/content'},[channel.port2]);
 await ready;return '/__roteiva_media/'+id;
 });
 const first=await page.evaluate(async url=>{const r=await fetch(url,{headers:{Range:'bytes=0-3'}});return {status:r.status,body:await r.text(),range:r.headers.get('Content-Range')};},url);
 expect(first).toEqual({status:206,body:'test',range:'bytes 0-3/4'});expect(received).toHaveLength(1);
 const other=await context.newPage();await other.goto(origin+'/sobre.html');
 const denied=await other.evaluate(async url=>(await fetch(url)).status,url);expect(denied).toBe(403);expect(received).toHaveLength(1);
 await page.evaluate(async url=>{
 const channel=new MessageChannel();const done=new Promise<void>(resolve=>{channel.port1.onmessage=()=>{channel.port1.close();resolve();};});
 navigator.serviceWorker.controller!.postMessage({type:'revoke-media',id:url.split('/').at(-1)},[channel.port2]);await done;
 },url);
 expect(await page.evaluate(async url=>(await fetch(url)).status,url)).toBe(403);
 });
});

test('cold browser takes SW control without a page reload and native audio/video players load real bytes',async({page})=>{
 await withMediaServer(async received=>{
  await page.goto(origin+'/sobre.html');
  const result=await page.evaluate(async()=>{
   const initialUrl=location.href;
   const registration=await navigator.serviceWorker.register('/roteiva-media-sw.js?mediaProtocol=3',{scope:'/',updateViaCache:'none'});
   await navigator.serviceWorker.ready;
   if(!navigator.serviceWorker.controller){
    const controlled=new Promise<void>((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error('Worker did not claim the current tab')),5000);
     const changed=()=>{if(navigator.serviceWorker.controller){clearTimeout(timer);resolve();}};
     navigator.serviceWorker.addEventListener('controllerchange',changed,{once:true});
     changed();
    });
    const channel=new MessageChannel();
    registration.active?.postMessage({type:'claim-media-clients'},[channel.port2]);
    await controlled;
   }
   navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type==='media-authorization')event.ports[0].postMessage({authorization:'Bearer browser-synthetic'});
   });
   const bind=async(node:string)=>{
    const id=crypto.randomUUID();
    const url='http://127.0.0.1:8787/library/projects/17/nodes/'+node+'/content';
    const channel=new MessageChannel();
    const ready=new Promise<void>((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error('Media binding timed out')),3000);
     channel.port1.onmessage=event=>{
      clearTimeout(timer);channel.port1.close();
      event.data?.ok?resolve():reject(new Error('Media binding was rejected'));
     };
    });
    navigator.serviceWorker.controller!.postMessage({type:'bind-media',id,url},[channel.port2]);
    await ready;
    return '/__roteiva_media/'+id;
   };
   const [wav,mp4]=await Promise.all([
    bind('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'),
    bind('cccccccc-cccc-4ccc-cccc-cccccccccccc'),
   ]);
   const audio=document.createElement('audio'),video=document.createElement('video');
   audio.preload='metadata';video.preload='auto';video.muted=true;video.autoplay=true;video.playsInline=true;
   document.body.append(audio,video);
   const metadata=(element:HTMLMediaElement,label:string)=>new Promise<number>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(label+' metadata timeout')),10000);
    element.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve(element.duration);},{once:true});
    element.addEventListener('error',()=>{
     clearTimeout(timer);reject(new Error(label+' media error '+element.error?.code));
    },{once:true});
   });
   const readyAudio=metadata(audio,'wav'),readyVideo=metadata(video,'mp4');
   audio.src=wav;video.src=mp4;
   const [audioDuration,videoDuration]=await Promise.all([readyAudio,readyVideo]);
   // Autoplay with sound is browser-policy dependent, so require the permitted
   // muted-inline configuration and preserve the native Play fallback.
   if(!video.autoplay||!video.muted||!video.playsInline)throw new Error('Native autoplay policy settings are missing');
   audio.remove();video.remove();
   return {audioDuration,videoDuration,unchanged:location.href===initialUrl,controlled:!!navigator.serviceWorker.controller};
  });
  expect(result.unchanged).toBe(true);
  expect(result.controlled).toBe(true);
  expect(result.audioDuration).toBeGreaterThan(0);
  expect(result.videoDuration).toBeGreaterThan(0);
  expect(received.filter(x=>x.path.includes('bbbbbbbb')&&x.authorization==='Bearer browser-synthetic'&&!!x.range).length).toBeGreaterThan(0);
  expect(received.filter(x=>x.path.includes('cccccccc')&&x.authorization==='Bearer browser-synthetic'&&!!x.range).length).toBeGreaterThan(0);
 });
});

test('an already-open tab upgrades its old worker to the media protocol without page refresh',async({page})=>{
 await page.goto(origin+'/sobre.html');
 const state=await page.evaluate(async()=>{
  const beforeNavigation=performance.getEntriesByType('navigation').length;
  (window as unknown as {mediaUpgradeMarker?:string}).mediaUpgradeMarker='preserved';
  const old=await navigator.serviceWorker.register('/roteiva-media-sw.js',{scope:'/',updateViaCache:'none'});
  await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller){
   await new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('old worker not controlling')),5000);
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
     clearTimeout(timeout);resolve();
    },{once:true});
   });
  }
  const oldScript=navigator.serviceWorker.controller?.scriptURL||'';
  const updated=await navigator.serviceWorker.register('/roteiva-media-sw.js?mediaProtocol=3',{scope:'/',updateViaCache:'none'});
  await new Promise<void>((resolve,reject)=>{
   const ready=()=>navigator.serviceWorker.controller?.scriptURL.includes('?mediaProtocol=3');
   if(ready()){resolve();return;}
   const timeout=setTimeout(()=>{cleanup();reject(new Error('protocol upgrade did not claim this tab'));},8000);
   const check=()=>{if(ready()){cleanup();resolve();}};
   const cleanup=()=>{clearTimeout(timeout);navigator.serviceWorker.removeEventListener('controllerchange',check);updated.removeEventListener('updatefound',check);};
   navigator.serviceWorker.addEventListener('controllerchange',check);
   updated.addEventListener('updatefound',check);
   check();
  });
  return {oldScript,updatedScript:navigator.serviceWorker.controller?.scriptURL,
   marker:(window as unknown as {mediaUpgradeMarker?:string}).mediaUpgradeMarker,
   sameNavigation:performance.getEntriesByType('navigation').length===beforeNavigation};
 });
 expect(state.oldScript).toContain('/roteiva-media-sw.js');
 expect(state.oldScript).not.toContain('mediaProtocol=3');
 expect(state.updatedScript).toContain('?mediaProtocol=3');
 expect(state.marker).toBe('preserved');
 expect(state.sameNavigation).toBe(true);
});

test('reopening the same private media in one tab reuses completed ranges without contacting API twice',async({page})=>{
 await withMediaServer(async received=>{
  await page.goto(origin+'/sobre.html');
  const answers=await page.evaluate(async()=>{
   await navigator.serviceWorker.register('/roteiva-media-sw.js?mediaProtocol=3',{scope:'/',updateViaCache:'none'});
   await navigator.serviceWorker.ready;
   if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));
   navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type==='media-authorization')event.ports[0].postMessage({authorization:'Bearer browser-synthetic'});
   });
   const url='http://127.0.0.1:8787/library/projects/17/nodes/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/content';
   const bind=async()=>{
    const id=crypto.randomUUID(),channel=new MessageChannel();
    const ready=new Promise<void>((resolve,reject)=>{
     channel.port1.onmessage=e=>{channel.port1.close();e.data?.ok?resolve():reject(new Error('binding rejected'));};
    });
    navigator.serviceWorker.controller!.postMessage({type:'bind-media',id,url,scope:'test-owner'},[channel.port2]);
    await ready;return id;
   };
   const revoke=async(id:string)=>{
    const channel=new MessageChannel();
    const done=new Promise<void>(resolve=>{channel.port1.onmessage=()=>{channel.port1.close();resolve();};});
    navigator.serviceWorker.controller!.postMessage({type:'revoke-media',id},[channel.port2]);
    await done;
   };
   const read=async(id:string)=>{
    const response=await fetch('/__roteiva_media/'+id,{headers:{Range:'bytes=0-3'}});
    return {status:response.status,body:await response.text()};
   };
   const firstId=await bind(),first=await read(firstId);await revoke(firstId);
   // A 4-byte range finishes immediately; allow clone/stream completion in SW.
   await new Promise(r=>setTimeout(r,100));
   const secondId=await bind(),second=await read(secondId);await revoke(secondId);
   return {first,second};
  });
  expect(answers.first).toEqual({status:206,body:'test'});
  expect(answers.second).toEqual({status:206,body:'test'});
  expect(received.filter(x=>x.path.includes('/nodes/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/content'))).toHaveLength(1);
 });
});
