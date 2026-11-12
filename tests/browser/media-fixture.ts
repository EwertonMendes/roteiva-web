import {createServer} from 'node:http';
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
  if(path==='/library/projects/17/nodes/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/content'&&request.headers.authorization==='Bearer browser-synthetic'&&request.headers.range==='bytes=0-3'){
   response.writeHead(206,{'Content-Range':'bytes 0-3/4','Content-Length':'4'});response.end('test');return;
  }
  response.writeHead(403);response.end();
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',resolve);});
 try{await job(requests);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
