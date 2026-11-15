import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackRange,sourceRange} from '../src/library-source.ts';

const size=String(220*1024*1024);
const firstEnd=8*1024*1024-1;

test('native playback preserves a bounded startup segment for fast reopens',()=>{
 assert.equal(playbackRange(null,size),'bytes=0-'+firstEnd);
 assert.equal(playbackRange('bytes=0-',size),'bytes=0-'+firstEnd);
 assert.equal(playbackRange('bytes=0-99999999',size),'bytes=0-'+firstEnd);
 assert.equal(playbackRange('bytes=0-1',size),'bytes=0-1');
});

test('after the first segment, one continuous response can reach EOF',()=>{
 const start=firstEnd+1;
 assert.equal(playbackRange('bytes='+start+'-',size),'bytes='+start+'-'+(Number(size)-1));
 assert.equal(playbackRange('bytes=20000000-',size),'bytes=20000000-'+(Number(size)-1));
 assert.equal(playbackRange('bytes=20000000-60000000',size),'bytes=20000000-60000000');
 // Documents remain bounded; this change is only for native video/audio.
 assert.equal(sourceRange('bytes='+start+'-',size),'bytes='+start+'-'+(start+8*1024*1024-1));
});

test('invalid native media ranges do not bypass validation',()=>{
 for(const range of ['bytes=99999999999-','bytes=-0','bytes=9-8','bytes=2-1,4-5']){
  assert.throws(()=>playbackRange(range,size),error=>error.status===416);
 }
});
