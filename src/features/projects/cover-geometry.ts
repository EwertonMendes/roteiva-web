import type {ProjectCover} from '../../domain/workspace';
export const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
export type CoverPoint={x:number;y:number};
/** Crop dimensions in CSS pixels; positions are percentages of the available overflow. */
export function coverGeometry(width:number,height:number,imageWidth:number,imageHeight:number,cover:Pick<ProjectCover,'x'|'y'|'zoom'>){
 const scale=Math.max(width/imageWidth,height/imageHeight)*cover.zoom;
 const w=imageWidth*scale,h=imageHeight*scale;
 return {width:w,height:h,left:-(w-width)*cover.x/100,top:-(h-height)*cover.y/100,overflowX:w-width,overflowY:h-height};
}
export function dragCover(cover:ProjectCover,dx:number,dy:number,overflowX:number,overflowY:number):ProjectCover{
 return {...cover,x:overflowX>0?clamp(cover.x-dx/overflowX*100,0,100):cover.x,y:overflowY>0?clamp(cover.y-dy/overflowY*100,0,100):cover.y};
}
/** Keep the image point under the gesture anchor fixed while scaling and panning. */
export function transformCover(cover:ProjectCover,width:number,height:number,imageWidth:number,imageHeight:number,zoom:number,from:CoverPoint,to:CoverPoint=from):ProjectCover{
 if(width<=0||height<=0||imageWidth<=0||imageHeight<=0)return cover;
 const before=coverGeometry(width,height,imageWidth,imageHeight,cover);
 const next={...cover,zoom:clamp(zoom,1,3)};
 const after=coverGeometry(width,height,imageWidth,imageHeight,next);
 const left=to.x-(from.x-before.left)/before.width*after.width;
 const top=to.y-(from.y-before.top)/before.height*after.height;
 return {...next,x:after.overflowX>1e-6?clamp(-left/after.overflowX*100,0,100):50,y:after.overflowY>1e-6?clamp(-top/after.overflowY*100,0,100):50};
}
export function coverGesture(points:readonly CoverPoint[]){
 const a=points[0],b=points[1];
 return b?{center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.hypot(b.x-a.x,b.y-a.y)}:{center:a,distance:0};
}
