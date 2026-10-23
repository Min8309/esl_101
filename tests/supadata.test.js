import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupadataLoader, loadTranscript} from '../youtube-transcript.mjs';
const input = {id:'5skWbChJy-8', language:'en'};
const payload = {lang:'en',content:[{offset:1200,duration:500,text:'Hello!'}]};
const json = (data, status=200) => new Response(JSON.stringify(data), {status});
const make = options => createSupadataLoader({getKey:()=> 'test-secret', ...options});
test('Supadata uses fixed HTTPS destination, server authentication, native timestamped captions and cache', async()=>{
 let calls=0, clock=1000;
 const load=make({now:()=>clock,fetcher:async(url,options)=>{
  calls++;
  const u=new URL(url);assert.equal(u.origin,'https://api.supadata.ai');assert.equal(u.pathname,'/v1/transcript');
  assert.equal(u.searchParams.get('mode'),'native');assert.equal(u.searchParams.get('text'),'false');
  assert.equal(u.searchParams.get('url'),'https://www.youtube.com/watch?v=5skWbChJy-8');
  assert.equal(options.headers['x-api-key'],'test-secret');assert.equal(options.redirect,'error');
  return json(payload);
 }});
 const data=await load(input);assert.deepEqual(data.cues,[{start:1.2,text:'Hello!'}]);assert.equal(data.language,'en');
 assert.ok(!JSON.stringify(data).includes('test-secret'));
 await load(input);assert.equal(calls,1);
 clock+=30*60000;await load(input);assert.equal(calls,2);
});
test('API errors are actionable and raw upstream secrets are never exposed',async()=>{
 for(const [status,code] of [[401,'API_AUTH_ERROR'],[403,'API_AUTH_ERROR'],[402,'API_QUOTA_EXCEEDED'],[429,'API_RATE_LIMITED'],[404,'NO_CAPTIONS'],[500,'API_UPSTREAM_ERROR']]) {
  const load=make({fetcher:async()=>json({error:'test-secret'},status)});
  await assert.rejects(load(input), e=>e.code===code&&!e.message.includes('test-secret'));
 }
 const missing=make({getKey:()=>'',fetcher:()=>assert.fail('no network without key')});
 await assert.rejects(missing(input),{code:'API_KEY_MISSING'});
 await assert.rejects(make({fetcher:async()=>{throw Error('test-secret');}})(input),{code:'API_NETWORK_ERROR'});
});
test('invalid content, timestamps and mismatched languages cannot become saved scripts',async()=>{
 for(const data of [{}, {lang:'en',content:'text'}, {lang:'en',content:[{offset:-1,text:'bad'}]}, {lang:'en',content:[{offset:true,text:'bad'}]}, {lang:'en',content:[{offset:0,text:null}]}])
  await assert.rejects(make({fetcher:async()=>json(data)})(input),{code:'API_FORMAT_ERROR'});
 for(const data of [{lang:'ko',content:payload.content},{lang:'en',content:[]}])
  await assert.rejects(make({fetcher:async()=>json(data)})(input),{code:'NO_CAPTIONS'});
});
test('async jobs support completed top-level and nested transcripts, fail without leaking details',async()=>{
 for(const completed of [{status:'completed',...payload},{status:'completed',result:payload}]) {
  let calls=0;
  const load=make({sleep:async()=>{},fetcher:async()=>json(++calls===1?{jobId:'safe-id'}:completed)});
  assert.deepEqual((await load(input)).cues,[{start:1.2,text:'Hello!'}]);assert.equal(calls,2);
 }
 let calls=0;
 await assert.rejects(make({sleep:async()=>{},fetcher:async()=>json(++calls===1?{jobId:'safe-id'}:{status:'failed',error:'test-secret'})})(input),{code:'API_UPSTREAM_ERROR'});
 await assert.rejects(make({fetcher:async()=>json({jobId:'https://evil.example'})})(input),{code:'API_FORMAT_ERROR'});
});
test('pending calls are deduplicated and uncached requests have a bounded budget',async()=>{
 let resolve, calls=0;
 const load=make({fetcher:()=>{calls++;return new Promise(r=>resolve=r);}});
 const first=load(input), second=load(input);resolve(json(payload));await Promise.all([first,second]);assert.equal(calls,1);
 const limited=make({fetcher:async()=>json(payload)});
 for(let i=0;i<10;i++)await limited({...input,id:String(i)});
 await assert.rejects(limited({...input,id:'eleventh'}),{code:'API_RATE_LIMITED'});
});
test('provider selection fails safely when explicitly configured without a key',async()=>{
 const provider=process.env.TRANSCRIPT_PROVIDER,key=process.env.SUPADATA_API_KEY;
 try {
  process.env.TRANSCRIPT_PROVIDER='supadata';delete process.env.SUPADATA_API_KEY;
  await assert.rejects(loadTranscript('https://youtu.be/5skWbChJy-8','en'),{code:'API_KEY_MISSING'});
 } finally {
  if(provider===undefined)delete process.env.TRANSCRIPT_PROVIDER;else process.env.TRANSCRIPT_PROVIDER=provider;
  if(key===undefined)delete process.env.SUPADATA_API_KEY;else process.env.SUPADATA_API_KEY=key;
 }
});
