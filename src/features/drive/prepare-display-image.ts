/** Local display optimization: preserve an honest crop, not an upscaled 220px thumbnail.
 * The authenticated original stays transient; only the bounded WebP/JPEG preview
 * can be persisted by storage-image-cache. No image is uploaded to a third party. */
export async function prepareDisplayImage(original:Blob):Promise<Blob>{
 if(typeof createImageBitmap!=="function"||typeof document==="undefined")return original;
 let bitmap:ImageBitmap|undefined;
 try{
  bitmap=await createImageBitmap(original);
  const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  if(!Number.isFinite(scale)||scale<=0) return original;
  const width=Math.max(1,Math.round(bitmap.width*scale));
  const height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement("canvas");
  canvas.width=width;canvas.height=height;
  const context=canvas.getContext("2d",{alpha:true});
  if(!context)return original;
  context.imageSmoothingQuality="high";
  context.drawImage(bitmap,0,0,width,height);
  const target=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/webp",.84));
  // Compressed preview is useful only when it saves bandwidth on subsequent visits
  // and is eligible for local persistence. Originals stay available for the editor.
  return target&&target.size>0&&target.size<original.size?target:original;
 }catch{return original;}
 finally{bitmap?.close();}
}
