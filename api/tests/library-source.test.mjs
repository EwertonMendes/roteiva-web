import test from 'node:test';
import assert from 'node:assert/strict';
import {revisionEndpoint,sourceRange,sourceFailure} from '../src/library-source.ts';

const source={provider:'google_drive',fileId:'abcdefghijklmnop',revision:'revision_01',size:'1234',mimeType:'video/mp4'};
test('review source is an exact provider revision, never the mutable head',()=>{
 assert.equal(revisionEndpoint(source).url,'https://www.googleapis.com/drive/v3/files/abcdefghijklmnop/revisions/revision_01?alt=media');
 const dbx=revisionEndpoint({...source,provider:'dropbox',fileId:'id:abcdefghijk',revision:'abc123'});
 assert.equal(dbx.method,'POST');assert.deepEqual(JSON.parse(dbx.headers['Dropbox-API-Arg']),{path:'rev:abc123'});
 for(const patch of [{revision:''},{revision:'../head'},{fileId:'https://evil.example/file'},{provider:'other'},{size:'0'},{mimeType:'text/html'}])
   assert.throws(()=>revisionEndpoint({...source,...patch}),e=>e.code==='invalid_source_version');
});
test('source ranges cannot exceed snapshot or chunk, including suffixes',()=>{
 assert.equal(sourceRange(null,'1234'),'bytes=0-1233');
 assert.equal(sourceRange('bytes=10-99999','1234',100),'bytes=10-109');
 assert.equal(sourceRange('bytes=-10000','1234',100),'bytes=1134-1233');
 assert.equal(sourceRange('bytes=1200-','1234'),'bytes=1200-1233');
 for(const range of ['bytes=1234-','bytes=4-3','bytes=0-1,4-5','bytes=-0','bytes=9999999999999999-'])
   assert.throws(()=>sourceRange(range,'1234'),e=>e.status===416);
});
test('provider faults cannot silently mark deleted files or disconnect the whole account',()=>{
 assert.equal(sourceFailure(404).reason,'source_unavailable');
 assert.equal(sourceFailure(403,'userRateLimitExceeded').reason,'rate_limited');
 assert.equal(sourceFailure(403).reason,'source_restricted');
 assert.equal(sourceFailure(503).retryable,true);
 assert.equal(sourceFailure(401).reason,'reconnect_required');
});
