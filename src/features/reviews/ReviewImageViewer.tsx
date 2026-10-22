import {useCallback,useEffect,useRef,useState,type PointerEvent as ReactPointerEvent,type KeyboardEvent as ReactKeyboardEvent} from "react";
import {ZoomToolbar} from "../../components/ZoomToolbar";

type View={scale:number;x:number;y:number};
type Position={x:number;y:number};
const FIT:View={scale:1,x:0,y:0};
const MAX_SCALE=6;
const clamp=(number:number,min:number,max:number)=>Math.max(min,Math.min(max,number));

/** Cookie-independent and self-contained, with a fitted image by default.
 * Zoom is relative to the *contained* image, not its original pixel dimensions.
 * Panning is constrained to the displayed image's actual (letterboxed) bounds.
 */
export function ReviewImageViewer({src,name,onError}:{src:string;name:string;onError?:()=>void}){
  const [view,setView]=useState<View>(FIT);
  const [natural,setNatural]=useState<Position|null>(null);
  const [expanded,setExpanded]=useState(false);
  const viewportRef=useRef<HTMLDivElement>(null);
  const expandRef=useRef<HTMLButtonElement>(null);
  const pointers=useRef(new Map<number,Position>());
  const [size,setSize]=useState<Position>({x:0,y:0});
  useEffect(()=>{
    setView(FIT);setNatural(null);setExpanded(false);pointers.current.clear();
  },[src]);
  useEffect(()=>{
    const viewport=viewportRef.current;
    if(!viewport)return;
    const observer=new ResizeObserver(entries=>{
      const rect=entries[0]?.contentRect;
      if(rect)setSize({x:rect.width,y:rect.height});
    });
    observer.observe(viewport);
    return()=>observer.disconnect();
  },[]);
  const limit=useCallback((scale:number,x:number,y:number):View=>{
    const factor=clamp(scale,1,MAX_SCALE);
    if(!natural||!size.x||!size.y)return {scale:factor,x:0,y:0};
    const fit=Math.min(size.x/natural.x,size.y/natural.y);
    const width=natural.x*fit*factor,height=natural.y*fit*factor;
    const maxX=Math.max(0,(width-size.x)/2),maxY=Math.max(0,(height-size.y)/2);
    return {scale:factor,x:clamp(x,-maxX,maxX),y:clamp(y,-maxY,maxY)};
  },[natural,size.x,size.y]);
  useEffect(()=>setView(v=>limit(v.scale,v.x,v.y)),[limit]);
  const changeZoom=useCallback((target:number)=>setView(v=>limit(target,v.x,v.y)),[limit]);
  const reset=()=>setView(FIT);
  useEffect(()=>{
    if(!expanded)return;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();setExpanded(false);}
      if(event.key==="Tab"){
        const buttons=viewportRef.current?.parentElement?.querySelectorAll<HTMLButtonElement>(".review-image-controls button");
        if(!buttons?.length)return;
        const first=buttons[0],last=buttons[buttons.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    document.addEventListener("keydown",onKey);
    return()=>{
      document.removeEventListener("keydown",onKey);
      document.body.style.overflow=previousOverflow;
      expandRef.current?.focus();
    };
  },[expanded]);
  const onPointerDown=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(view.scale===1&&e.pointerType==="mouse")return;
    if(e.pointerType==="mouse"&&e.button!==0)return;
    pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const last=pointers.current.get(e.pointerId);
    if(!last)return;
    const points=[...pointers.current.values()];
    pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(points.length>=2&&pointers.current.size>=2){
      const current=[...pointers.current.values()];
      const oldDist=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
      const newDist=Math.hypot(current[0].x-current[1].x,current[0].y-current[1].y);
      if(oldDist>0){
        const rect=e.currentTarget.getBoundingClientRect();
        const focusX=(current[0].x+current[1].x)/2-rect.left-rect.width/2;
        const focusY=(current[0].y+current[1].y)/2-rect.top-rect.height/2;
        setView(v=>{
          const next=clamp(v.scale*newDist/oldDist,1,MAX_SCALE);
          const ratio=next/v.scale;
          return limit(next,focusX-(focusX-v.x)*ratio,focusY-(focusY-v.y)*ratio);
        });
      }
    }else if(view.scale>1){
      setView(v=>limit(v.scale,v.x+e.clientX-last.x,v.y+e.clientY-last.y));
    }
  };
  const onPointerEnd=(e:ReactPointerEvent<HTMLDivElement>)=>{
    pointers.current.delete(e.pointerId);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  };
  useEffect(()=>{
    const viewport=viewportRef.current;
    if(!viewport)return;
    const onWheel=(event:WheelEvent)=>{
      event.preventDefault();
      const rect=viewport.getBoundingClientRect();
      const focusX=event.clientX-rect.left-rect.width/2;
      const focusY=event.clientY-rect.top-rect.height/2;
      setView(v=>{
        const next=clamp(v.scale*(event.deltaY<0?1.2:1/1.2),1,MAX_SCALE);
        const ratio=next/v.scale;
        return limit(next,focusX-(focusX-v.x)*ratio,focusY-(focusY-v.y)*ratio);
      });
    };
    // Non-passive handler: normal wheel zooms the focused image, never the page.
    viewport.addEventListener("wheel",onWheel,{passive:false});
    return()=>viewport.removeEventListener("wheel",onWheel);
  },[limit]);
  const onKeys=(e:ReactKeyboardEvent<HTMLDivElement>)=>{
    if(e.target!==e.currentTarget)return;
    if(e.key==="+"||e.key==="="){e.preventDefault();changeZoom(view.scale*1.3);}
    if(e.key==="-"){e.preventDefault();changeZoom(view.scale/1.3);}
    if(e.key==="0"){e.preventDefault();reset();}
    const step=40;
    const delta:Record<string,Position>={
      ArrowLeft:{x:step,y:0},ArrowRight:{x:-step,y:0},ArrowUp:{x:0,y:step},ArrowDown:{x:0,y:-step}
    };
    if(delta[e.key]&&view.scale>1){
      e.preventDefault();
      setView(v=>limit(v.scale,v.x+delta[e.key].x,v.y+delta[e.key].y));
    }
  };
  return <div className={"review-private-viewer"+(expanded?" is-expanded":"")} role={expanded?"dialog":undefined}
      aria-modal={expanded?true:undefined} aria-label={expanded?"Imagem ampliada: "+name:undefined}>
    <div ref={viewportRef} className={"review-image-viewport"+(view.scale>1?" is-zoomed":"")}
      tabIndex={0} role="group" aria-label={"Imagem "+name+". Amplie com os controles, duplo clique ou gesto de pinça."}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
      onKeyDown={onKeys}
      onDoubleClick={()=>view.scale>1?reset():changeZoom(2)}>
      <img className="review-private-preview-image" src={src} alt={name} draggable={false}
        onLoad={e=>setNatural({x:e.currentTarget.naturalWidth,y:e.currentTarget.naturalHeight})}
        onError={onError}
        style={{transform:`translate(${view.x}px, ${view.y}px) scale(${view.scale})`}}/>
    </div>
    <ZoomToolbar className="review-image-toolbar" value={view.scale} min={1} max={MAX_SCALE}
      onDecrease={()=>changeZoom(view.scale/1.3)}
      onIncrease={()=>changeZoom(view.scale*1.3)} onReset={reset}
      fullscreen={expanded} onToggleFullscreen={()=>setExpanded(v=>!v)}/>
  </div>;
}
