import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import webpush from 'web-push';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export function groupHash(token){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw fail('기기 연결 키를 확인하세요.',401);
 return createHash('sha256').update(token).digest('hex');
}
export function validSubscription(s){
 let u;try{u=new URL(s?.endpoint);}catch{return false;}
 const allowed=u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.push.apple.com')||u.hostname==='wns.windows.com'||u.hostname.endsWith('.notify.windows.com');
 return allowed&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&s.endpoint.length<4096&&/^[\w-]{87}$/.test(s.keys?.p256dh)&&/^[\w-]{22}$/.test(s.keys?.auth);
}
export function reminderInput(body,now=Date.now()){
 const c=body?.card,when=Date.parse(body?.when);
 if(!Number.isFinite(when)||when<now+10000||when>now+366*86400000)throw fail('알림 시간을 10초 이후부터 1년 이내로 선택하세요.');
 if(!c||typeof c.text!=='string'||!c.text.trim()||c.text.length>1500)throw fail('알림 문장을 확인하세요.');
 const card={text:c.text.trim(),meaning:typeof c.meaning==='string'?c.meaning.slice(0,1000):'',note:typeof c.note==='string'?c.note.slice(0,3000):'',category:typeof c.category==='string'?c.category.slice(0,24):'일반',source:typeof c.source==='string'?c.source.slice(0,200):'',url:'',start:Number.isFinite(c.start)&&c.start>=0?c.start:0};
 if(typeof c.url==='string'&&/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(c.url))card.url=c.url;
 return {card,when};
}
export async function createPushService(env=process.env,{sender=webpush.sendNotification.bind(webpush),clock=Date.now}={}){
 if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT||!env.PUSH_DATA_DIR)return null;
 webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
 const {DatabaseSync}=await import('node:sqlite');
 mkdirSync(env.PUSH_DATA_DIR,{recursive:true,mode:0o700});
 const dbPath=join(env.PUSH_DATA_DIR,'push.sqlite');
 const db=new DatabaseSync(dbPath);chmodSync(dbPath,0o600);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS subscriptions(endpoint TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY, owner TEXT NOT NULL, card TEXT NOT NULL, due INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS reminders_due ON reminders(status,due);
 CREATE INDEX IF NOT EXISTS reminders_owner ON reminders(owner);`);
 const getSubs=owner=>db.prepare('SELECT data FROM subscriptions WHERE owner=?').all(owner);
 async function deliver(owner,payload){
  const subs=getSubs(owner);let sent=0,failed=0;
  for(const row of subs){const sub=JSON.parse(row.data);
   try{await sender(sub,JSON.stringify(payload),{TTL:86400,urgency:'normal',timeout:10000});sent++;}
   catch(e){if([404,410].includes(e.statusCode))db.prepare('DELETE FROM subscriptions WHERE endpoint=?').run(sub.endpoint);else failed++;}
  }
  return {sent,failed};
 }
 let running=false;
 async function tick(){
  if(running)return;running=true;
  try{
   const now=clock();
   db.prepare("DELETE FROM reminders WHERE updated<? AND status!='pending'").run(now-30*86400000);
   db.prepare('DELETE FROM subscriptions WHERE created<?').run(now-180*86400000);
   db.prepare("UPDATE reminders SET status='pending' WHERE status='sending' AND updated<?").run(now-5*60000);
   const rows=db.prepare("SELECT * FROM reminders WHERE status='pending' AND due<=? ORDER BY due LIMIT 20").all(now);
   for(const r of rows){
    if(r.due<now-86400000){db.prepare("UPDATE reminders SET status='expired',updated=? WHERE id=?").run(now,r.id);continue;}
    db.prepare("UPDATE reminders SET status='sending',updated=?,attempts=attempts+1 WHERE id=?").run(now,r.id);
    const card=JSON.parse(r.card),result=await deliver(r.owner,{title:'말줍 · 오늘의 표현',body:card.text.slice(0,180),url:`/?reminder=${r.id}`,tag:r.id});
    const status=result.sent?'sent':result.failed&&r.attempts<2?'pending':'failed';
    db.prepare('UPDATE reminders SET status=?,updated=? WHERE id=?').run(status,clock(),r.id);
   }
  }finally{running=false;}
 }
 const rates=new Map();
 async function handle(req,res,path){
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   if(path==='/api/push/config'&&req.method==='GET'){json(200,{enabled:true,publicKey:env.VAPID_PUBLIC_KEY});return;}
   if(req.headers.origin&&req.headers.origin!==`https://${req.headers.host}`&&req.headers.origin!==`http://${req.headers.host}`)throw fail('같은 앱에서 요청하세요.',403);
   const owner=groupHash(req.headers.authorization?.replace(/^Bearer /,''));
   if(rates.size>=1000)for(const [k,v]of rates)if(clock()-v.start>=60000)rates.delete(k);
   if(!rates.has(owner)&&rates.size>=2000)throw fail('요청이 많습니다. 잠시 후 다시 시도하세요.',429);
   const now=clock(),rate=rates.get(owner)||{start:now,count:0};if(now-rate.start>=60000){rate.start=now;rate.count=0;}if(++rate.count>30)throw fail('요청이 많습니다. 잠시 후 다시 시도하세요.',429);rates.set(owner,rate);if(rates.size>1000)for(const [k,v]of rates)if(now-v.start>60000)rates.delete(k);
   let body={};
   if(['POST','DELETE'].includes(req.method)){
    if(!req.headers['content-type']?.startsWith('application/json'))throw fail('JSON 요청이 필요합니다.',415);
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16000)throw fail('요청이 너무 큽니다.',413);}try{body=JSON.parse(raw);}catch{throw fail('요청 형식을 확인하세요.');}
   }
   if(path==='/api/push/subscription'&&req.method==='POST'){
    if(!validSubscription(body.subscription))throw fail('지원하는 브라우저의 알림 구독이 아닙니다.');
    if(getSubs(owner).length>=5||db.prepare('SELECT count(*) AS n FROM subscriptions').get().n>=1000)throw fail('알림 기기 등록 한도에 도달했습니다.',429);
    const endpoint=body.subscription.endpoint;
    const existing=db.prepare('SELECT owner FROM subscriptions WHERE endpoint=?').get(endpoint);if(existing&&existing.owner!==owner)throw fail('이 기기의 기존 알림 연결을 먼저 해제하세요.',409);
    db.prepare('INSERT OR REPLACE INTO subscriptions VALUES(?,?,?,?)').run(endpoint,owner,JSON.stringify(body.subscription),now);json(200,{ok:true});return;
   }
   if(path==='/api/push/subscription'&&req.method==='DELETE'){
    if(typeof body.endpoint!=='string')throw fail('알림 기기를 확인하세요.');db.prepare('DELETE FROM subscriptions WHERE endpoint=? AND owner=?').run(body.endpoint,owner);json(200,{ok:true});return;
   }
   if(path==='/api/push/test'&&req.method==='POST'){
    if(!getSubs(owner).length)throw fail('아이폰에서 먼저 알림을 켜세요.');
    const result=await deliver(owner,{title:'말줍 알림 연결 완료',body:'이제 수집한 문장을 예약해 보세요.',url:'/',tag:'maljup-test'});
    if(!result.sent)throw fail('알림 전송에 실패했습니다. 아이폰에서 알림을 다시 연결하세요.',502);
    json(200,{sent:result.sent});return;
   }
   if(path==='/api/push/reminders'&&req.method==='POST'){
    const {card,when}=reminderInput(body,now);
    if(!getSubs(owner).length)throw fail('연결된 알림 기기가 없습니다. 아이폰에서 먼저 알림을 켜세요.');
    if(db.prepare("SELECT count(*) AS n FROM reminders WHERE owner=? AND status='pending'").get(owner).n>=100||db.prepare('SELECT count(*) AS n FROM reminders').get().n>=10000)throw fail('예약 한도에 도달했습니다.',429);
    const id=randomUUID();db.prepare('INSERT INTO reminders(id,owner,card,due,updated) VALUES(?,?,?,?,?)').run(id,owner,JSON.stringify(card),when,now);json(201,{id});return;
   }
   if(path==='/api/push/reminders'&&req.method==='GET'){
    const rows=db.prepare('SELECT id,card,due,status FROM reminders WHERE owner=? ORDER BY due DESC LIMIT 100').all(owner);json(200,{devices:getSubs(owner).length,reminders:rows.map(r=>({...r,card:JSON.parse(r.card)}))});return;
   }
   const match=path.match(/^\/api\/push\/reminders\/([\w-]{36})$/);
   if(match&&req.method==='GET'){const row=db.prepare('SELECT card FROM reminders WHERE id=? AND owner=?').get(match[1],owner);if(!row)throw fail('알림 기록이 없거나 연결 키가 다릅니다.',404);json(200,{card:JSON.parse(row.card)});return;}
   if(match&&req.method==='DELETE'){db.prepare('DELETE FROM reminders WHERE id=? AND owner=?').run(match[1],owner);json(200,{ok:true});return;}
   if(path==='/api/push/reset'&&req.method==='DELETE'){
    db.prepare('DELETE FROM reminders WHERE owner=?').run(owner);db.prepare('DELETE FROM subscriptions WHERE owner=?').run(owner);json(200,{ok:true});return;
   }
   json(404,{error:'알림 경로를 확인하세요.'});
  }catch(e){json(e.status||503,{error:e.status?e.message:'알림 서버 처리에 실패했습니다. 잠시 후 다시 시도하세요.'});}
 }
 const timer=setInterval(()=>tick().catch(()=>console.error('[push] scheduler failed')),30000);timer.unref();
 return {handle,tick,close(){clearInterval(timer);db.close();}};
}
