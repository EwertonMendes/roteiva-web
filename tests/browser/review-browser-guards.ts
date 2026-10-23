import {expect, type Page} from "@playwright/test";

/** Browser-level menus remain outside web-page control; these verify the page's own event guards. */
export async function assertReviewPageGuards(page:Page):Promise<void> {
  const result=await page.evaluate(()=>{
    const selectors=["body","main.review-portal",".review-portal-intro",".review-portal-comments"];
    const prevented=selectors.map(selector=>{
      const element=document.querySelector(selector);
      if(!element)return false;
      const event=new MouseEvent("contextmenu",{bubbles:true,cancelable:true,composed:true});
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    const shortcut=(key:string,modifiers:KeyboardEventInit={})=>{
      const event=new KeyboardEvent("keydown",{key,cancelable:true,bubbles:true,...modifiers});
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return {
      prevented,
      hotkeys:[
        shortcut("F12"),
        shortcut("I",{ctrlKey:true,shiftKey:true}),
        shortcut("J",{ctrlKey:true,shiftKey:true}),
        shortcut("C",{ctrlKey:true,shiftKey:true}),
        shortcut("K",{ctrlKey:true,shiftKey:true}),
        shortcut("M",{ctrlKey:true,shiftKey:true}),
        shortcut("I",{metaKey:true,altKey:true}),
        shortcut("u",{ctrlKey:true}),
        shortcut("s",{ctrlKey:true}),
        shortcut("p",{ctrlKey:true}),
        shortcut("ContextMenu"),
        shortcut("F10",{shiftKey:true}),
      ],
      allowed:[
        shortcut("Tab"),
        shortcut("Escape"),
        shortcut("a",{ctrlKey:true}),
        shortcut("z",{ctrlKey:true}),
      ],
    };
  });
  expect(result.prevented).toEqual([true,true,true,true]);
  expect(result.hotkeys).toEqual(Array(12).fill(true));
  expect(result.allowed).toEqual(Array(4).fill(false));
}
