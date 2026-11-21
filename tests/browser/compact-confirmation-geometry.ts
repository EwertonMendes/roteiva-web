import {expect,type Locator} from '@playwright/test';

/**
 * Browser-level regression for shared and compact confirmations.
 * The title + message must live in one scrollable region, while the footer
 * remains visible. Short content needs a real bottom gap; long content may
 * scroll without falling behind actions. Works for light/dark and phone sizes.
 */
export async function expectCompactConfirmationGeometry(dialog:Locator){
  await expect(dialog).toBeVisible();
  const geometry=await dialog.evaluate(root=>{
    const content=root.querySelector<HTMLElement>('.rt-confirm-content');
    const message=root.querySelector<HTMLElement>('.rt-confirm-description');
    const footer=root.querySelector<HTMLElement>('.rt-modal__footer');
    const header=root.querySelector<HTMLElement>('.rt-modal__header');
    const buttons=Array.from(root.querySelectorAll<HTMLButtonElement>('.rt-modal__footer button'));
    if(!content||!message||!footer||!header||buttons.length!==2)return null;
    const box=root.getBoundingClientRect();
    const scroller=content.getBoundingClientRect();
    const foot=footer.getBoundingClientRect();
    const desc=message.getBoundingClientRect();
    const first=buttons[0].getBoundingClientRect(),second=buttons[1].getBoundingClientRect();
    const overflowing=content.scrollHeight>content.clientHeight+2;
    const fittingButtons=buttons.every(button=>{
      const rect=button.getBoundingClientRect();
      return rect.left>=box.left-1&&rect.right<=box.right+1
        &&rect.top>=foot.top-1&&rect.bottom<=foot.bottom+1
        &&button.scrollWidth<=button.clientWidth+2
        &&button.scrollHeight<=button.clientHeight+2;
    });
    return {
      footerInside:foot.bottom<=box.bottom+1 && foot.top>=scroller.bottom-1,
      buttonsFit:fittingButtons,
      buttonsDoNotOverlap:first.right<=second.left+1||second.right<=first.left+1
        ||first.bottom<=second.top+1||second.bottom<=first.top+1,
      noHorizontalOverflow:root.scrollWidth<=root.clientWidth+2
        &&document.documentElement.scrollWidth<=window.innerWidth+2,
      bottomGap:overflowing?null:foot.top-desc.bottom,
      contentIsScrollable:!overflowing||getComputedStyle(content).overflowY==='auto',
      descriptionBelongsToScrollableArea:content.contains(message),
      heightWithinViewport:box.top>=-1&&box.bottom<=window.innerHeight+1,
    };
  });
  expect(geometry,'Confirmation elements must exist').not.toBeNull();
  expect(geometry!.descriptionBelongsToScrollableArea).toBe(true);
  expect(geometry!.footerInside).toBe(true);
  expect(geometry!.buttonsFit).toBe(true);
  expect(geometry!.buttonsDoNotOverlap).toBe(true);
  expect(geometry!.noHorizontalOverflow).toBe(true);
  expect(geometry!.contentIsScrollable).toBe(true);
  expect(geometry!.heightWithinViewport).toBe(true);
  if(geometry!.bottomGap!==null)expect(geometry!.bottomGap).toBeGreaterThanOrEqual(12);
}
