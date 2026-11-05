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
 clock+=24*60*60000;await load(input);assert.equal(calls,2);
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
 const limited=make({getLimits:()=>({daily:20}),fetcher:async()=>json(payload)});
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

test('rolling daily and 30-day limits reserve before calls, cache remains available', async()=>{
 let clock=1000,calls=0;
 const day=24*60*60000;
 const load=make({now:()=>clock,getLimits:()=>({daily:2,monthly:3}),fetcher:async()=>{calls++;return json(payload);}});
 await load(input);await load({...input,id:'second'});
 await assert.rejects(load({...input,id:'third'}),e=>e.code==='API_DAILY_LIMITED'&&e.retryAfter===86400);
 await load(input);assert.equal(calls,2);
 clock+=day;await load({...input,id:'third'});
 await assert.rejects(load({...input,id:'fourth'}),{code:'API_PERIOD_LIMITED'});
 clock+=29*day;await load({...input,id:'fourth'});assert.equal(calls,4);
});
test('failure and timeout attempts are charged locally and duplicate retries cool down',async()=>{
 let clock=1000,calls=0;
 const load=make({now:()=>clock,getLimits:()=>({daily:2}),fetcher:async()=>{calls++;throw Error('timeout');}});
 await assert.rejects(load(input),{code:'API_NETWORK_ERROR'});
 await assert.rejects(load(input),e=>e.code==='API_RETRY_COOLDOWN'&&e.retryAfter===600);
 assert.equal(calls,1);clock+=600000;
 await assert.rejects(load(input),{code:'API_NETWORK_ERROR'});
 await assert.rejects(load({...input,id:'other'}),{code:'API_DAILY_LIMITED'});assert.equal(calls,2);
});
test('206 and job polling consume budget without a new job or extra HTTP calls after exhaustion',async()=>{
 let calls=0;
 const load=make({getLimits:()=>({daily:2}),sleep:async()=>{},fetcher:async()=>json(++calls===1?{jobId:'job'}:{status:'active'},206)});
 await assert.rejects(load(input),{code:'API_DAILY_LIMITED'});
 await assert.rejects(load(input),{code:'API_DAILY_LIMITED'});assert.equal(calls,2);
});
test('concurrent distinct requests cannot overshoot budget and pending duplicate is shared',async()=>{
 let finish,calls=0;
 const load=make({getLimits:()=>({daily:1}),fetcher:()=>{calls++;return new Promise(r=>finish=r);}});
 const first=load(input),duplicate=load(input);
 await assert.rejects(load({...input,id:'second'}),{code:'API_DAILY_LIMITED'});
 finish(json(payload));await Promise.all([first,duplicate]);assert.equal(calls,1);
});
test('concurrency is bounded even before asynchronous jobs finish',async()=>{
 const finishes=[];
 const load=make({fetcher:()=>new Promise(r=>finishes.push(r))});
 const first=load(input),second=load({...input,id:'second'});
 await assert.rejects(load({...input,id:'third'}),{code:'API_BUSY'});
 finishes.forEach(f=>f(json(payload)));await Promise.all([first,second]);
});
test('zero disables new calls and malformed configuration fails closed; cache still works',async()=>{
 let limits={},calls=0;
 const load=make({getLimits:()=>limits,fetcher:async()=>{calls++;return json(payload);}});
 await load(input);
 limits={daily:0};await load(input);
 await assert.rejects(load({...input,id:'other'}),{code:'API_IMPORT_DISABLED'});
 for(const value of ['', 'abc', '-1', '1.5', Infinity, 100001]){
  limits={monthly:value};await assert.rejects(load({...input,id:'other'}),{code:'API_CONFIG_ERROR'});
 }
 assert.equal(calls,1);
});
test('provider auth/quota rejection pauses other videos too',async()=>{
 for(const status of [401,402,429]) {
  let calls=0;
  const load=make({fetcher:async()=>{calls++;return json({},status);}});
  await assert.rejects(load(input));
  await assert.rejects(load({...input,id:'other'}),{code:'API_SERVICE_PAUSED'});assert.equal(calls,1);
 }
});
test('fresh loader has fresh counters: memory protection cannot survive restarts or span workers',async()=>{
 const options={getLimits:()=>({daily:1}),fetcher:async()=>json(payload)};
 const first=make(options);await first(input);
 await assert.rejects(first({...input,id:'other'}),{code:'API_DAILY_LIMITED'});
 await make(options)({...input,id:'other'});
});

test('unset limits enforce default 5 daily and 80 rolling 30-day HTTP calls',async()=>{
 let clock=1000,calls=0;
 const load=make({getLimits:()=>({}),now:()=>clock,fetcher:async()=>{calls++;return json(payload);}});
 for(let day=0;day<16;day++) {
  for(let i=0;i<5;i++)await load({...input,id:`${day}-${i}`});
  await assert.rejects(load({...input,id:`blocked-${day}`}),{code:day===15?'API_PERIOD_LIMITED':'API_DAILY_LIMITED'});
  clock+=24*60*60000;
 }
 assert.equal(calls,80);
});
