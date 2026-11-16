import assert from 'node:assert/strict';
import {validTimeRange, overlaps, eventRange, eventDuration} from '../src/studio-calendar.ts';
import {calendarCells,dateKey,isValidCivilDate,todayKey} from '../src/features/calendar/calendar-dates.ts';
const work={id:1,date:'2026-10-23',time:'09:00',endTime:'11:30'};
assert.equal(validTimeRange('09:00','11:30'),true);
for(const range of [['09:00','09:00'],['11:00','09:00'],['25:00','26:00'],['09:00','']])assert.equal(validTimeRange(...range),false);
assert.equal(overlaps(work,{...work,id:2,time:'11:00',endTime:'12:30'}),true);
assert.equal(overlaps(work,{...work,id:2,time:'11:30',endTime:'12:30'}),false);
assert.equal(overlaps(work,{...work,id:2,time:'08:00',endTime:'12:30'}),true);
assert.equal(overlaps(work,{...work,id:2,date:'2026-10-24'}),false);
assert.equal(overlaps(work,work),false);
assert.equal(overlaps(work,{...work,id:2,endTime:undefined}),false);
assert.equal(eventRange(work),'09:00 – 11:30');
assert.equal(eventDuration(work),'2h 30min');
assert.equal(eventDuration({...work,endTime:'10:00'}),'1h');
assert.equal(eventRange({...work,endTime:undefined}),'09:00 · sem término');
assert.equal(calendarCells(2026,1).length,28); // February 2026: four complete weeks
assert.equal(calendarCells(2026,10).length,35); // November 2026: five weeks
assert.equal(calendarCells(2026,7).length,42); // August 2026: six weeks
assert.equal(calendarCells(2026,10)[0].key,"2026-11-01");
assert.equal(calendarCells(2026,9)[0].key,"2026-09-27");
assert.equal(dateKey(2026,10,0),"2026-10-31");
assert.equal(isValidCivilDate("2028-02-29"),true);
assert.equal(isValidCivilDate("2026-02-29"),false);
assert.equal(isValidCivilDate("2026-04-31"),false);
assert.equal(isValidCivilDate("2026-11-16"),true);
assert.match(todayKey(),/^\d{4}-\d{2}-\d{2}$/);
console.log('Agenda: validações, datas civis, grade adaptativa e sobreposições OK');
