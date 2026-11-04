import {useEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {AppButton} from '../ui/AppButton';
import './ReviewPdfViewer.css';

/** One page at a time, with bounded raster memory and no native download toolbar. */
export function ReviewPdfViewer({src,name}:{src:string;name:string}){
 const [document,setDocument]=useState<PDFDocumentProxy|null>(null);
 const [page,setPage]=useState(1),[zoom,setZoom]=useState(1);
 const [error,setError]=useState(''),[rendering,setRendering]=useState(true);
 const canvas=useRef<HTMLCanvasElement>(null),region=useRef<HTMLDivElement>(null);
 const [width,setWidth]=useState(600);
 useEffect(()=>{
  const node=region.current;if(!node)return;
  const observer=new ResizeObserver(([entry])=>setWidth(Math.max(1,entry.contentRect.width-24)));
  observer.observe(node);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  let alive=true,task:ReturnType<typeof import('pdfjs-dist')['getDocument']>|undefined;
  setDocument(null);setError('');setPage(1);setZoom(1);setRendering(true);
  void import('pdfjs-dist').then(pdf=>{
   if(!alive)return;
   pdf.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();
   task=pdf.getDocument({url:src,rangeChunkSize:256*1024,disableAutoFetch:true,disableStream:true});
   return task.promise.then(value=>{if(alive)setDocument(value);});
  }).catch(()=>{if(alive){setError('Não foi possível ler este PDF. Confira se o arquivo está disponível e não exige senha.');setRendering(false);}});
  return()=>{alive=false;void task?.destroy();};
 },[src]);
 useEffect(()=>{
  if(!document||!canvas.current)return;
  let alive=true,task:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined;
  setRendering(true);setError('');
  void document.getPage(page).then(async value=>{
   if(!alive||!canvas.current)return;
   const natural=value.getViewport({scale:1});
   const scale=Math.min(width/natural.width,1.5)*zoom;
   const viewport=value.getViewport({scale});
   const pixelRatio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(16000000/(viewport.width*viewport.height)));
   const node=canvas.current;node.width=Math.floor(viewport.width*pixelRatio);node.height=Math.floor(viewport.height*pixelRatio);
   node.style.width=viewport.width+'px';node.style.height=viewport.height+'px';
   task=value.render({canvas:node,viewport,transform:pixelRatio===1?undefined:[pixelRatio,0,0,pixelRatio,0,0]});
   await task.promise;if(alive)setRendering(false);
  }).catch(reason=>{if(alive&&reason?.name!=='RenderingCancelledException'){setError('Não foi possível mostrar esta página do PDF.');setRendering(false);}});
  return()=>{alive=false;task?.cancel();};
 },[document,page,zoom,width]);
 return <section className="review-pdf-viewer" aria-label={'PDF '+name}>
  <div className="review-pdf-toolbar" role="group" aria-label="Controles do PDF">
   <AppButton type="button" disabled={!document||page===1} onClick={()=>setPage(v=>v-1)} aria-label="Página anterior">←</AppButton>
   <span aria-live="polite">Página {page} de {document?.numPages||'…'}</span>
   <AppButton type="button" disabled={!document||page===document.numPages} onClick={()=>setPage(v=>v+1)} aria-label="Próxima página">→</AppButton>
   <AppButton type="button" disabled={zoom<=.5} onClick={()=>setZoom(v=>Math.max(.5,v-.25))} aria-label="Reduzir PDF">−</AppButton>
   <span>{Math.round(zoom*100)}%</span>
   <AppButton type="button" disabled={zoom>=3} onClick={()=>setZoom(v=>Math.min(3,v+.25))} aria-label="Ampliar PDF">+</AppButton>
  </div>
  <div className="review-pdf-pages" ref={region} aria-busy={rendering}>
   {error?<p role="alert">{error}</p>:<>{rendering&&<p role="status">Carregando PDF…</p>}<canvas ref={canvas} aria-label={'Página '+page+' de '+name} role="img"/></>}
  </div>
 </section>;
}

