/** Drive v3 list returns a short-lived opaque thumbnailTicket on the authenticated API.
 * Legacy/demo responses may still carry thumbnailLink; never render that URL directly.
 */
export function hasDriveThumbnailSource(item:{
  mimeType:string;thumbnailTicket?:string;thumbnailLink?:string;thumbnailFallback?:boolean;
}):boolean{
  return item.mimeType!=="application/vnd.google-apps.folder" &&
    Boolean(item.thumbnailTicket||item.thumbnailLink||item.thumbnailFallback);
}
