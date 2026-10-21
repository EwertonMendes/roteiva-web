/** Helpers shared by video feedback UX and tests. Times are seconds in D1. */
export const MAX_REVIEW_SECOND=172800;
export function formatReviewTime(seconds:number):string{
  const safe=Math.max(0,Math.min(MAX_REVIEW_SECOND,Math.floor(seconds)));
  return Math.floor(safe/60)+":"+String(safe%60).padStart(2,"0");
}
/** Keep only numbers and one automatically placed colon, without altering intent. */
export function maskReviewTime(value:string):string{
  const digits=value.replace(/\D/g,"").slice(0,6);
  if(digits.length<=2)return digits;
  return digits.slice(0,-2)+":"+digits.slice(-2);
}
export function parseReviewTime(value:string):number|null{
  if(!value.trim())return null;
  const match=/^(\d{1,4}):([0-5]\d)$/.exec(value);
  if(!match)return NaN;
  const seconds=Number(match[1])*60+Number(match[2]);
  return Number.isSafeInteger(seconds)&&seconds<=MAX_REVIEW_SECOND?seconds:NaN;
}
export function validReviewSecond(value:number|null,duration:number|null):boolean{
  return value===null||(Number.isInteger(value)&&value>=0&&value<=MAX_REVIEW_SECOND&&
    (duration===null||value<=Math.floor(duration)));
}

/** Capture an actual HTML5 playhead, pausing before composing feedback. */
export function captureReviewPlayback(video:Pick<HTMLVideoElement,"currentTime"|"pause">|null):number|null{
  if(!video||!Number.isFinite(video.currentTime)||video.currentTime<0)return null;
  video.pause();
  return Math.min(MAX_REVIEW_SECOND,Math.floor(video.currentTime));
}
