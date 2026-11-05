import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAppServer} from '../server.mjs';
import {createTranscriptBudget} from '../transcript-budget.mjs';
const input=JSON.stringify({url:'https://youtu.be/5skWbChJy-8',language:'en'});
const post=(base,headers={})=>fetch(base+'/api/youtube-transcript',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:input});
async function serve(options,fn){const server=createAppServer(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await fn(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}}
test('partial body cannot monopolize import lock, and is disconnected on body deadline',async()=>{
 await serve({bodyTimeoutMs:200,transcript:async()=>({cues:[]})},async base=>{
  const req=http.request(base+'/api/youtube-transcript',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':100}});
  const closed=new Promise(r=>req.on('close',r));req.on('error',()=>{});req.write('{');
  await new Promise(r=>setTimeout(r,40));assert.equal((await post(base)).status,200);await closed;
 });
});
test('access password gates provider, rejects weak configuration, and leaves stored app usable',async()=>{
 let calls=0;
 await serve({accessPassword:'a-long-secret-password',transcript:async()=>{calls++;return {cues:[]};}},async base=>{
  assert.equal((await post(base)).status,401);
  assert.equal((await post(base,{'X-Transcript-Password':'wrong'})).status,401);
  assert.equal(calls,0);
  assert.equal((await post(base,{'X-Transcript-Password':'a-long-secret-password'})).status,200);
  const asset=await fetch(base);assert.equal(asset.status,200);assert.equal(asset.headers.get('x-frame-options'),'DENY');
 });
 await serve({accessPassword:'short',transcript:()=>assert.fail()},async base=>assert.equal((await post(base)).status,503));
});
test('persistent budget survives reopening and coordinates separate connections; failure never falls back',()=>{
 const dir=mkdtempSync(join(tmpdir(),'maljup-budget-')),path=join(dir,'budget.sqlite');
 const check=rows=>{if(rows.length>=1)throw Object.assign(Error('limited'),{status:429});};
 let first=createTranscriptBudget(path);const second=createTranscriptBudget(path);
 try{
  first.reserve(1000,check);assert.throws(()=>second.reserve(1001,check),{status:429});
  first.close();first=createTranscriptBudget(path);assert.throws(()=>first.reserve(1002,check),{status:429});
  first.reserve(1000+30*86400000,check);
  const broken=createTranscriptBudget(join(dir,'missing','budget.sqlite'));
  assert.throws(()=>broken.reserve(1000,check),{code:'API_BUDGET_UNAVAILABLE'});broken.close();
 }finally{first.close();second.close();rmSync(dir,{recursive:true,force:true});}
});
test('a waiting invalid body cannot release another request import lock',async()=>{
 let finish,started;const active=new Promise(r=>started=r);
 await serve({transcript:()=>{started();return new Promise(r=>finish=r);}},async base=>{
  const req=http.request(base+'/api/youtube-transcript',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':2}});
  const completed=new Promise((resolve,reject)=>{req.on('response',r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});req.on('error',reject);});
  req.write('{');await new Promise(r=>setTimeout(r,30));
  const first=post(base);await active;
  try{req.end('}');assert.equal(await completed,400);assert.equal((await post(base)).status,429);}
  finally{finish({cues:[]});await first;}
 });
});
test('unavailable persistent budget prevents the Supadata network request',async()=>{
 const {createSupadataLoader}=await import('../youtube-transcript.mjs');
 const dir=mkdtempSync(join(tmpdir(),'maljup-no-budget-'));
 const budget=createTranscriptBudget(join(dir,'missing','budget.sqlite'));
 try {
  const load=createSupadataLoader({budget,getKey:()=> 'test-key',fetcher:()=>assert.fail('must not contact provider')});
  await assert.rejects(load({id:'5skWbChJy-8',language:'en'}),{code:'API_BUDGET_UNAVAILABLE'});
 } finally {budget.close();rmSync(dir,{recursive:true,force:true});}
});
