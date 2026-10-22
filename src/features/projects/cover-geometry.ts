import type {ProjectCover} from '../../domain/workspace';
export const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
/** Crop dimensions in CSS pixels; positions are percentages of the available overflow. */
export function coverGeometry(width:number,height:number,imageWidth:number,imageHeight:number,cover:Pick<ProjectCover,'x'|'y'|'zoom'>){
 const scale=Math.max(width/imageWidth,height/imageHeight)*cover.zoom;
 const w=imageWidth*scale,h=imageHeight*scale;
 return {width:w,height:h,left:-(w-width)*cover.x/100,top:-(h-height)*cover.y/100,overflowX:w-width,overflowY:h-height};
}
export function dragCover(cover:ProjectCover,dx:number,dy:number,overflowX:number,overflowY:number):ProjectCover{
 return {...cover,x:overflowX>0?clamp(cover.x-dx/overflowX*100,0,100):cover.x,y:overflowY>0?clamp(cover.y-dy/overflowY*100,0,100):cover.y};
}
