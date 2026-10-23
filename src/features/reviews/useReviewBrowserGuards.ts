import {useEffect} from "react";

/**
 * Review-only friction against the browser's ordinary context-menu, source,
 * save, print and developer-tool keyboard shortcuts.
 *
 * IMPORTANT: browsers own DevTools. These handlers cannot disable their menu,
 * remote debugging, network tools, screenshots or programmatic HTTP requests.
 * Authorization must remain enforced on the Worker for every media request.
 */
type ReviewKeyboardShortcut = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

export function isReviewRestrictedShortcut(event:ReviewKeyboardShortcut):boolean {
  const key=event.key.toLowerCase();
  if(key==="f12"||key==="contextmenu"||(key==="f10"&&event.shiftKey))return true;

  // View source, save page and print (Windows/Linux and macOS).
  if((event.ctrlKey||event.metaKey)&&["u","s","p"].includes(key))return true;

  // Chromium/Firefox developer tools and responsive developer view.
  if(event.ctrlKey&&event.shiftKey&&["i","j","c","k","m"].includes(key))return true;

  // Chromium developer tools on macOS (Cmd+Option+I/J/C).
  if(event.metaKey&&event.altKey&&["i","j","c","k"].includes(key))return true;

  return false;
}

/** Scoped to ReviewPortal: no changes to the owner's editor or workspace. */
export function useReviewBrowserGuards():void {
  useEffect(()=>{
    const blockContextMenu=(event:MouseEvent)=>event.preventDefault();
    const blockShortcut=(event:KeyboardEvent)=>{
      if(!isReviewRestrictedShortcut(event))return;
      event.preventDefault();
      event.stopPropagation();
    };

    // Capture events from page whitespace, header, comments, footer, portal
    // overlays and embedded interactive controls, not just the preview canvas.
    document.addEventListener("contextmenu",blockContextMenu,true);
    window.addEventListener("keydown",blockShortcut,true);
    return()=>{
      document.removeEventListener("contextmenu",blockContextMenu,true);
      window.removeEventListener("keydown",blockShortcut,true);
    };
  },[]);
}
