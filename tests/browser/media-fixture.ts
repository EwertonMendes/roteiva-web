import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Large fixture generated only in the isolated browser test. This intentionally
// exceeds the former 8 MiB boundary and contains 60 seconds of decodable video.
let longMp4:Buffer|undefined;
function largeVideo(){
 if(longMp4)return longMp4;
 const dir=mkdtempSync(join(tmpdir(),'roteiva-long-video-')),output=join(dir,'60s.mp4');
 try{
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi',
   '-i','testsrc2=size=640x360:rate=24','-t','60','-c:v','libx264',
   '-preset','ultrafast','-crf','13','-pix_fmt','yuv420p','-an',
   '-movflags','+faststart','-y',output],{stdio:'pipe',timeout:30000});
  longMp4=readFileSync(output);
  if(longMp4.byteLength<=8*1024*1024)throw new Error('long fixture must exceed the old 8 MiB boundary');
  return longMp4;
 }finally{rmSync(dir,{recursive:true,force:true});}
}

// Generated silent-color 1-second H.264/MP4 fixture (not user media).
const smallMp4=Buffer.from('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','base64');
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
  if(path==='/library/projects/17/nodes/dddddddd-dddd-4ddd-dddd-dddddddddddd/content'&&request.headers.authorization==='Bearer browser-synthetic'){
   const data=largeVideo();
   const match=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range||'bytes=0-');
   if(!match){response.writeHead(416);response.end();return;}
   const first=Number(match[1]),last=match[2]?Math.min(Number(match[2]),data.length-1):data.length-1;
   if(!Number.isSafeInteger(first)||first>=data.length||last<first){response.writeHead(416);response.end();return;}
   const chunk=data.subarray(first,last+1);
   response.writeHead(206,{'Content-Type':'video/mp4','Content-Length':String(chunk.length),
    'Content-Range':'bytes '+first+'-'+last+'/'+data.length,'Accept-Ranges':'bytes'});
   response.end(chunk);return;
  }
  if(path==='/library/projects/17/nodes/cccccccc-cccc-4ccc-cccc-cccccccccccc/content'&&request.headers.authorization==='Bearer browser-synthetic'){
   const match=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range||'bytes=0-');
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
   const match=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range||'bytes=0-');
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
