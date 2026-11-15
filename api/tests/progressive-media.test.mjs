import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackRange,sourceRange} from '../src/library-source.ts';

const size=String(220*1024*1024);
const last=Number(size)-1;

test('an open-ended native video range streams to EOF from the first request',()=>{
 assert.equal(playbackRange(null,size),'bytes=0-'+last);
 assert.equal(playbackRange('bytes=0-',size),'bytes=0-'+last);
 assert.equal(playbackRange('bytes=0-99999999',size),'bytes=0-99999999');
 assert.equal(playbackRange('bytes=0-1',size),'bytes=0-1');
});

test('native audio/video seeks support large continuous ranges without 8MiB truncation',()=>{
 const start=8*1024*1024;
 assert.equal(playbackRange('bytes='+start+'-',size),'bytes='+start+'-'+last);
 assert.equal(playbackRange('bytes=20000000-',size),'bytes=20000000-'+last);
 assert.equal(playbackRange('bytes=20000000-60000000',size),'bytes=20000000-60000000');
 assert.equal(playbackRange('bytes=-12582912',size),'bytes='+(Number(size)-12582912)+'-'+last);
 // Images and PDFs keep the original bounded range policy.
 assert.equal(sourceRange('bytes='+start+'-',size),'bytes='+start+'-'+(start+8*1024*1024-1));
});

test('invalid native media ranges remain rejected',()=>{
 for(const range of ['bytes=99999999999-','bytes=-0','bytes=9-8','bytes=2-1,4-5']){
  assert.throws(()=>playbackRange(range,size),e=>e.status===416);
 }
});
