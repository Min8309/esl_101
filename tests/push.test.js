import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import webpush from 'web-push';
import {createPushService,groupHash,reminderInput,validSubscription} from '../push-service.mjs';
import {createAppServer} from '../server.mjs';
const owner='a'.repeat(43),other='b'.repeat(43);
const subscription={endpoint:'https://web.push.apple.com/Qtest',keys:{p256dh:'a'.repeat(87),auth:'b'.repeat(22)}};
test('push validation rejects weak device keys, arbitrary destinations and invalid schedules',()=>{
 assert.equal(groupHash(owner).length,64);assert.throws(()=>groupHash('123456'),{status:401});
 assert.ok(validSubscription(subscription));
 for(const endpoint of ['http://web.push.apple.com/x','https://localhost/x','https://web.push.apple.com.evil.test/x','https://user@web.push.apple.com/x','https://web.push.apple.com:444/x'])assert.equal(validSubscription({...subscription,endpoint}),false);
 const now=Date.now();assert.throws(()=>reminderInput({card:{text:'hello'},when:new Date(now).toISOString()},now));
 const data=reminderInput({card:{text:' hi ',note:'memo',url:'javascript:alert(1)'},when:new Date(now+60000).toISOString()},now);assert.equal(data.card.text,'hi');assert.equal(data.card.url,'');
});
async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),'maljup-push-'));const keys=webpush.generateVAPIDKeys();
 const env={PUSH_DATA_DIR:dir,VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'mailto:test@example.com'};
 let clock=Date.now(),mode='ok';const sent=[];
 const options={clock:()=>clock,sender:async(sub,payload)=>{if(mode==='gone')throw {statusCode:410};if(mode==='error')throw {statusCode:503};sent.push({sub,payload:JSON.parse(payload)});}};
 let push=await createPushService(env,options);let server,base;
 async function start(){server=createAppServer({push});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
 async function stop(){server.closeAllConnections();await new Promise(r=>server.close(r));push.close();}
 await start();
 const api=(path,method='GET',body,token=owner,headers={})=>fetch(base+'/api/push/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 try{await fn({api,sent,tick:()=>push.tick(),advance:ms=>clock+=ms,mode:value=>mode=value,when:()=>new Date(clock+60000).toISOString(),restart:async()=>{await stop();push=await createPushService(env,options);await start();}});}finally{await stop();await rm(dir,{recursive:true,force:true});}
}
test('persistent scheduled push sends a sentence and deep link after restart, with owner isolation',async()=>fixture(async f=>{
 assert.equal((await f.api('subscription','POST',{subscription})).status,200);
 const response=await f.api('reminders','POST',{card:{text:'Hello world',note:'my memo'},when:f.when()});assert.equal(response.status,201);const {id}=await response.json();
 assert.equal((await f.api('reminders/'+id,'GET',undefined,other)).status,404);
 assert.equal((await f.api('reminders','GET',undefined,other)).status,200);
 assert.deepEqual((await(await f.api('reminders','GET',undefined,other)).json()).reminders,[]);
 await f.restart();f.advance(61000);await f.tick();assert.equal(f.sent.length,1);assert.equal(f.sent[0].payload.body,'Hello world');assert.equal(f.sent[0].payload.url,'/?reminder='+id);
 await f.tick();assert.equal(f.sent.length,1);assert.equal((await(await f.api('reminders/'+id)).json()).card.note,'my memo');
}));
test('cancel, disconnect and delete-all act only on the matching owner',async()=>fixture(async f=>{
 await f.api('subscription','POST',{subscription});
 const {id}=await(await f.api('reminders','POST',{card:{text:'cancel me'},when:f.when()})).json();
 await f.api('reminders/'+id,'DELETE',{},other);assert.equal((await f.api('reminders/'+id)).status,200);
 await f.api('reminders/'+id,'DELETE',{});f.advance(61000);await f.tick();assert.equal(f.sent.length,0);
 await f.api('reset','DELETE',{},other);assert.equal((await(await f.api('reminders')).json()).devices,1);
 await f.api('reset','DELETE',{});assert.equal((await(await f.api('reminders')).json()).devices,0);
}));
test('expired subscriptions are removed and transient sends retry with a bound',async()=>fixture(async f=>{
 await f.api('subscription','POST',{subscription});f.mode('gone');assert.equal((await f.api('test','POST',{})).status,502);assert.equal((await(await f.api('reminders')).json()).devices,0);
 await f.api('subscription','POST',{subscription});await f.api('reminders','POST',{card:{text:'retry'},when:f.when()});f.mode('error');f.advance(61000);
 await f.tick();await f.tick();await f.tick();assert.equal((await(await f.api('reminders')).json()).reminders[0].status,'failed');
}));
test('push endpoints reject missing credentials, cross-origin changes and invalid JSON',async()=>fixture(async f=>{
 assert.equal((await f.api('reminders','GET',undefined,'')).status,401);
 assert.equal((await f.api('subscription','POST',{subscription},owner,{Origin:'https://evil.test'})).status,403);
 assert.equal((await f.api('subscription','POST',{subscription:{...subscription,endpoint:'https://127.0.0.1/x'}})).status,400);
 const config=await(await f.api('config')).json();assert.equal(config.enabled,true);assert.ok(config.publicKey);assert.equal(config.privateKey,undefined);
}));
test('disabled push server still serves install manifest and root service worker',async()=>{
 const server=createAppServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{for(const path of ['/manifest.webmanifest','/sw.js','/assets/push-icon.svg'])assert.equal((await fetch(base+path)).status,200);assert.equal((await fetch(base+'/api/push/config')).status,200);assert.equal((await fetch(base+'/api/push/reminders')).status,503);assert.equal((await fetch(base+'/push-service.mjs')).status,404);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
