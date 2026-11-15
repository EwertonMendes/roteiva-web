import {createServer} from 'node:http';
// Generated silent-color 1-second H.264/MP4 fixture (not user media).
const smallMp4=Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM5bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmR0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHcbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAMABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABh21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUdzdGJsAAAAt3N0c2QAAAAAAAAAAQAAAKdhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALWF2Y0MBQsAK/+EAFmdCwAraEJsBEAAAAwAQAAADAMDxImoBAARozg/IAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAFWAAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAYAAAgAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAYAAAABAAAALHN0c3oAAAAAAAAAAAAAAAYAAAJ6AAAACgAAAAoAAAAKAAAACgAAAAoAAAAUc3RjbwAAAAAAAAABAAADaQAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjEuNy4xMDMAAAAIZnJlZQAAArRtZGF0AAACUwYF//9P3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzEwOCAzMWUxOWY5IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTEgZGVibG9jaz0wOjA6MCBhbmFseXNlPTA6MCBtZT1kaWEgc3VibWU9MCBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0wIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MCA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0wIHRocmVhZHM9MiBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90b3dfdGhyZWFkcz0xIHNjZW5lY3V0PTAgaW50cmFfcmVmcmVzaD0wIHJjPWNyZiBtYnRyZWU9MCBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0wAIAAAAAfZYiEOhGKAAIxccAAQ8o4AAgFycnJ1111111111114AAAAAZBmiAToIwAAAAGQZpAFKCMAAAABkGaYBSgjAAAAAZBmoAUoIwAAAAGQZqgFKCM','base64');
type Received={path:string;method:string;authorization?:string;session?:string;range?:string;invite?:string;body?:Record<string,unknown>};
/** Real HTTP transport: WebKit does not route Service Worker fetches through context.route(). */
export async function withMediaServer(job:(requests:Received[])=>Promise<void>,handler?:(request:Received)=>{status?:number;json:unknown}|undefined){
 const requests:Received[]=[];
 const server=createServer(async(request,response)=>{
  response.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:4173');
  response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Review-Token, X-Review-Session, Range');
  response.setHeader('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');
  response.setHeader('Access-Control-Expose-Headers','Content-Range, Content-Length');
  if(request.method==='OPTIONS'){response.writeHead(204);response.end();return;}
  const path=new URL(request.url||'/','http://127.0.0.1:8787').pathname;
  let text='';for await(const chunk of request){text+=chunk;if(text.length>16384){response.writeHead(413);response.end();return;}}
  const item:Received={path,method:request.method||'GET',authorization:request.headers.authorization,session:String(request.headers['x-review-session']||''),range:request.headers.range,invite:String(request.headers['x-review-token']||''),body:text?JSON.parse(text):undefined};
  requests.push(item);
  const result=handler?.(item);if(result){response.writeHead(result.status||200,{'Content-Type':'application/json'});response.end(JSON.stringify(result.json));return;}
  if(path==='/reviews/media'&&request.headers['x-review-session']==='s'.repeat(43)){
   response.setHeader('Content-Type','image/png');response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));return;
  }
  if(path==='/library/projects/17/nodes/cccccccc-cccc-4ccc-cccc-cccccccccccc/content'&&request.headers.authorization==='Bearer browser-synthetic'){
   const match=/^bytes=(\\d+)-(\\d*)$/.exec(request.headers.range||'bytes=0-');
   if(!match){response.writeHead(416);response.end();return;}
   const first=Number(match[1]),last=match[2]?Math.min(Number(match[2]),smallMp4.length-1):smallMp4.length-1;
   if(first>=smallMp4.length||last<first){response.writeHead(416);response.end();return;}
   const chunk=smallMp4.subarray(first,last+1);
   response.writeHead(206,{'Content-Type':'video/mp4','Content-Length':String(chunk.length),
    'Content-Range':'bytes '+first+'-'+last+'/'+smallMp4.length,'Accept-Ranges':'bytes'});
   response.end(chunk);return;
  }
  if(path==='/library/projects/17/nodes/bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb/content'&&request.headers.authorization==='Bearer browser-synthetic'){
   // Small real 8-kHz mono PCM WAV; exercises HTMLAudioElement's native Range
   // loading, rather than only testing generic fetch() with synthetic text.
   const pcm=Buffer.alloc(16000);
   for(let i=0;i<8000;i++)pcm.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/8000)*8000),i*2);
   const wav=Buffer.alloc(44+pcm.length);
   wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);
   wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);
   wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);
   wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);
   wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
   const match=/^bytes=(\\d+)-(\\d*)$/.exec(request.headers.range||'bytes=0-');
   if(!match){response.writeHead(416);response.end();return;}
   const first=Number(match[1]),last=match[2]?Math.min(Number(match[2]),wav.length-1):wav.length-1;
   if(first>=wav.length||last<first){response.writeHead(416);response.end();return;}
   const chunk=wav.subarray(first,last+1);
   response.writeHead(206,{'Content-Type':'audio/wav','Content-Length':String(chunk.length),
    'Content-Range':'bytes '+first+'-'+last+'/'+wav.length,'Accept-Ranges':'bytes'});
   response.end(chunk);return;
  }
  if(path==='/library/projects/17/nodes/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/content'&&request.headers.authorization==='Bearer browser-synthetic'&&request.headers.range==='bytes=0-3'){
   response.writeHead(206,{'Content-Range':'bytes 0-3/4','Content-Length':'4'});response.end('test');return;
  }
  response.writeHead(403);response.end();
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',resolve);});
 try{await job(requests);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
