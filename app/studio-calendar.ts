export type ScheduledItem = {id:number;date:string;time:string;endTime?:string};
export function timeMinutes(time:string) { if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return NaN; const [h,m]=time.split(":").map(Number); return h*60+m; }
export function validTimeRange(start:string,end:string) { return Number.isFinite(timeMinutes(start)) && Number.isFinite(timeMinutes(end)) && timeMinutes(end)>timeMinutes(start); }
export function overlaps(a:ScheduledItem,b:ScheduledItem) {
  return a.id!==b.id && a.date===b.date && !!a.endTime && !!b.endTime && validTimeRange(a.time,a.endTime) && validTimeRange(b.time,b.endTime) && timeMinutes(a.time)<timeMinutes(b.endTime) && timeMinutes(b.time)<timeMinutes(a.endTime);
}
export function eventRange(item:Pick<ScheduledItem,"time"|"endTime">) { return item.endTime ? `${item.time} – ${item.endTime}` : `${item.time} · sem término`; }
export function eventDuration(item:Pick<ScheduledItem,"time"|"endTime">) {
  if(!item.endTime||!validTimeRange(item.time,item.endTime))return "";
  const duration=timeMinutes(item.endTime)-timeMinutes(item.time);
  return [Math.floor(duration/60)?`${Math.floor(duration/60)}h`:"", duration%60?`${duration%60}min`:""].filter(Boolean).join(" ");
}
