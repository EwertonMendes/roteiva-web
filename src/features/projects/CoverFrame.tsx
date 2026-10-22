import {useEffect,useRef,useState,type CSSProperties} from 'react';
import type {ProjectCover} from '../../domain/workspace';
import {coverGeometry,dragCover} from './cover-geometry';
export function CoverFrame({src,cover,onChange}:{src:string;cover:ProjectCover;onChange?:(cover:ProjectCover)=>void}){
 const box=useRef<HTMLDivElement>(null);const [size,setSize]=useState({width:0,height:0});
 const [image,setImage]=useState({src:'',width:1,height:1});
 const drag=useRef<{id:number;x:number;y:number;cover:ProjectCover;overflowX:number;overflowY:number}|null>(null);
 useEffect(()=>{const el=box.current;if(!el)return;const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(el);return ()=>observer.disconnect();},[]);
 const geometry=coverGeometry(size.width,size.height,image.width,image.height,cover);
 const style:CSSProperties={width:geometry.width,height:geometry.height,left:geometry.left,top:geometry.top,opacity:image.src===src?1:0};
 return <div className={'pc-cover-frame'+(onChange?' pc-crop-interactive':'')} ref={box}
  onPointerDown={e=>{if(!onChange||e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,cover,overflowX:geometry.overflowX,overflowY:geometry.overflowY};}}
  onPointerMove={e=>{const start=drag.current;if(start&&start.id===e.pointerId)onChange?.(dragCover(start.cover,e.clientX-start.x,e.clientY-start.y,start.overflowX,start.overflowY));}}
  onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}>
  <img src={src} alt="" draggable={false} style={style} onLoad={e=>setImage({src,width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}/>
 </div>;
}
