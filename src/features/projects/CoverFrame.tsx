import {ZoomToolbar} from '../../components/ZoomToolbar';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import type {ProjectCover} from '../../domain/workspace';
import {coverGeometry,coverGesture,transformCover,type CoverPoint} from './cover-geometry';
type Gesture={cover:ProjectCover;center:CoverPoint;distance:number};
type SafariGestureEvent=Event & {scale:number;clientX?:number;clientY?:number};
export function CoverFrame({src,cover,onChange}:{src:string;cover:ProjectCover;onChange?:(cover:ProjectCover)=>void}){
 const box=useRef<HTMLDivElement>(null);
 const [size,setSize]=useState({width:0,height:0});
 const [image,setImage]=useState({src:'',width:1,height:1});
 const [interacting,setInteracting]=useState(false);
 const pointers=useRef(new Map<number,CoverPoint>());
 const gesture=useRef<Gesture|null>(null),safari=useRef<Gesture|null>(null);
 const current=useRef({cover,onChange,size,image});current.current={cover,onChange,size,image};
 function emit(next:ProjectCover){current.current.cover=next;current.current.onChange?.(next);}
 function point(clientX:number,clientY:number){const r=box.current!.getBoundingClientRect();return {x:clientX-r.left,y:clientY-r.top};}
 function rebase(){const points=[...pointers.current.values()];gesture.current=points.length?{cover:current.current.cover,...coverGesture(points)}:null;setInteracting(points.length>0);}
 function transform(start:ProjectCover,zoom:number,from:CoverPoint,to=from){const {size,image}=current.current;return transformCover(start,size.width,size.height,image.width,image.height,zoom,from,to);}
 useEffect(()=>{const el=box.current;if(!el)return;const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(el);return ()=>observer.disconnect();},[]);
 useEffect(()=>{
  const el=box.current;if(!el||!onChange)return;
  function wheel(e:WheelEvent){
   if(current.current.image.src!==src)return;e.preventDefault();
   if(safari.current)return;
   const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?current.current.size.height:1);
   const next=current.current.cover.zoom*Math.exp(-delta*(e.ctrlKey ? 0.01 : 0.002));
   emit(transform(current.current.cover,next,point(e.clientX,e.clientY)));
   if(pointers.current.size)rebase();
  }
  function start(e:Event){e.preventDefault();if(pointers.current.size>=2)return;const {size}=current.current;const native=e as SafariGestureEvent;safari.current={cover:current.current.cover,center:typeof native.clientX==='number'&&typeof native.clientY==='number'?point(native.clientX,native.clientY):{x:size.width/2,y:size.height/2},distance:1};}
  function change(e:Event){e.preventDefault();const start=safari.current;if(!start)return;const native=e as SafariGestureEvent;if(!Number.isFinite(native.scale)||native.scale<=0)return;emit(transform(start.cover,start.cover.zoom*native.scale,start.center));}
  function end(){safari.current=null;}
  el.addEventListener('wheel',wheel,{passive:false});
  el.addEventListener('gesturestart',start,{passive:false});el.addEventListener('gesturechange',change,{passive:false});el.addEventListener('gestureend',end);
  return ()=>{el.removeEventListener('wheel',wheel);el.removeEventListener('gesturestart',start);el.removeEventListener('gesturechange',change);el.removeEventListener('gestureend',end);};
 },[!!onChange,src]);
 useEffect(()=>{pointers.current.clear();gesture.current=null;safari.current=null;setInteracting(false);},[src]);
 const geometry=coverGeometry(size.width,size.height,image.width,image.height,cover);
 const style:CSSProperties={width:geometry.width,height:geometry.height,left:geometry.left,top:geometry.top,opacity:image.src===src?1:0};
 function release(id:number){pointers.current.delete(id);rebase();}
 return <div className={'pc-cover-frame'+(onChange?' pc-crop-interactive':'')+(interacting?' pc-crop-active':'')} ref={box}
  tabIndex={onChange?0:undefined} role={onChange?'group':undefined} aria-label={onChange?'Enquadrar capa':undefined}
  aria-describedby={onChange?'pc-gesture-help':undefined} data-native-cursor={onChange?'':undefined}
  onPointerDown={e=>{if(!onChange||e.button!==0||image.src!==src)return;e.preventDefault();e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);pointers.current.set(e.pointerId,point(e.clientX,e.clientY));rebase();}}
  onPointerMove={e=>{if(!pointers.current.has(e.pointerId))return;pointers.current.set(e.pointerId,point(e.clientX,e.clientY));const start=gesture.current;if(!start)return;const next=coverGesture([...pointers.current.values()]);emit(transform(start.cover,start.distance>0?start.cover.zoom*next.distance/start.distance:start.cover.zoom,start.center,next.center));}}
  onPointerUp={e=>release(e.pointerId)} onPointerCancel={e=>release(e.pointerId)} onLostPointerCapture={e=>{if(pointers.current.has(e.pointerId))release(e.pointerId);}}
  onKeyDown={e=>{if(!onChange||e.target!==e.currentTarget)return;const center={x:size.width/2,y:size.height/2};const step=e.shiftKey?40:10;const moves:Record<string,CoverPoint>={ArrowLeft:{x:center.x-step,y:center.y},ArrowRight:{x:center.x+step,y:center.y},ArrowUp:{x:center.x,y:center.y-step},ArrowDown:{x:center.x,y:center.y+step}};
   if(moves[e.key]){e.preventDefault();emit(transform(cover,cover.zoom,center,moves[e.key]));}
   else if(['+','=','-','_'].includes(e.key)){e.preventDefault();emit(transform(cover,cover.zoom*(['-','_'].includes(e.key)?1/1.15:1.15),center));}
   else if(e.key==='Home'){e.preventDefault();emit({...cover,x:50,y:50,zoom:1});}
  }}>
  <img src={src} alt="" draggable={false} style={style} onLoad={e=>setImage({src,width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}/>
  {onChange&&<><span className="pc-crop-grid" aria-hidden="true"/>
   <ZoomToolbar className="pc-crop-toolbar" value={cover.zoom} min={1} max={3}
     label="Zoom da capa" decreaseLabel="Diminuir zoom" increaseLabel="Aumentar zoom" resetLabel="Redefinir enquadramento"
     onDecrease={()=>emit(transform(cover,cover.zoom/1.15,{x:size.width/2,y:size.height/2}))}
     onIncrease={()=>emit(transform(cover,cover.zoom*1.15,{x:size.width/2,y:size.height/2}))}
     onReset={()=>emit({...cover,x:50,y:50,zoom:1})}/></>}
 </div>;
}
