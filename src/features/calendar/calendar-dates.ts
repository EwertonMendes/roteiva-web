/** Local civil dates; never parse YYYY-MM-DD as a UTC instant. */
export function dateKey(year:number,month:number,day:number):string {
  const value=new Date(year,month,day,12);
  return [value.getFullYear(),String(value.getMonth()+1).padStart(2,"0"),String(value.getDate()).padStart(2,"0")].join("-");
}
export function todayKey(now=new Date()):string {
  return dateKey(now.getFullYear(),now.getMonth(),now.getDate());
}
export function isValidCivilDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [year,month,day]=value.split("-").map(Number);
  if(year<1900||year>2199||month<1||month>12||day<1||day>31)return false;
  return dateKey(year,month-1,day)===value;
}
export function localDate(value:string):Date {
  const [year,month,day]=value.split("-").map(Number);
  return new Date(year,month-1,day,12);
}
export function calendarCells(year:number,month:number) {
  const offset=new Date(year,month,1,12).getDay();
  const days=new Date(year,month+1,0,12).getDate();
  const count=Math.ceil((offset+days)/7)*7;
  return Array.from({length:count},(_,index)=>{
    const raw=index-offset+1;
    const key=dateKey(year,month,raw);
    return {key,day:Number(key.slice(-2)),current:raw>=1&&raw<=days};
  });
}
