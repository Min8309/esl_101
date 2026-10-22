import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppServer} from '../server.mjs';
import {transcriptInput} from '../youtube-transcript.mjs';
const url='https://www.youtube.com/watch?v=HWv1x2We9ag';
test('validates watch/short links and rejects non-YouTube URLs, credentials, schemes and unsupported languages',()=>{
 assert.deepEqual(transcriptInput(url,'en'),{id:'HWv1x2We9ag',language:'en'});
 assert.equal(transcriptInput('https://youtu.be/HWv1x2We9ag?t=4','ko').id,'HWv1x2We9ag');
 for(const u of ['https://example.com/?v=HWv1x2We9ag','ftp://youtube.com/watch?v=HWv1x2We9ag','https://user:pass@youtube.com/watch?v=HWv1x2We9ag','https://youtube.com:444/watch?v=HWv1x2We9ag','--help'])assert.throws(()=>transcriptInput(u),{status:400});
 assert.throws(()=>transcriptInput(url,'../../'),{status:400});
});
async function withServer(provider,fn){
 const server=createAppServer({transcript:provider});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await fn(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
const post=(base,data,extra={})=>fetch(base+'/api/youtube-transcript',{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(data)});
test('HTTP endpoint returns timestamped subtitles and still serves the app and assets',async()=>{
 const result={title:'영상',url,language:'en',automatic:true,cues:[{start:12.3,text:'Hello & welcome'}]};
 await withServer(async(u,lang)=>{assert.equal(u,url);assert.equal(lang,'en');return result;},async base=>{
  const r=await post(base,{url,language:'en'});assert.equal(r.status,200);assert.deepEqual(await r.json(),result);
  for(const path of ['/','/src/app.js','/src/style.css'])assert.equal((await fetch(base+path)).status,200);
  assert.equal((await fetch(base+'/missing')).status,404);
 });
});
test('rejects invalid requests before invoking the extractor',async()=>{
 await withServer(()=>assert.fail('extractor must not run'),async base=>{
  assert.equal((await fetch(base+'/api/youtube-transcript')).status,405);
  assert.equal((await post(base,{url:'http://127.0.0.1/private'})).status,400);
  assert.equal((await post(base,{url},{Origin:'https://other-site.example'})).status,403);
  assert.equal((await post(base,{url:'x'.repeat(5000)})).status,413);
  assert.equal((await fetch(base+'/api/youtube-transcript',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
 });
});
test('missing captions and missing tool are actionable errors rather than empty success',async()=>{
 for(const status of [404,503])await withServer(async()=>{throw Object.assign(Error('자막 도구 또는 자막 확인'),{status});},async base=>{
  const r=await post(base,{url});assert.equal(r.status,status);assert.match((await r.json()).error,/확인/);
 });
});
test('concurrent imports are rejected until the active import completes',async()=>{
 let finish,started;const active=new Promise(r=>started=r);
 await withServer(()=>{started();return new Promise(r=>finish=r);},async base=>{
  const first=post(base,{url});await active;
  try{assert.equal((await post(base,{url})).status,429);}finally{finish({cues:[{start:0,text:'ok'}]});}
  assert.equal((await first).status,200);
 });
});
