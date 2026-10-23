self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// No fetch handler: personal pages and Google tokens are never cached here.
self.addEventListener('push',event=>{
 let data;try{data=event.data.json();}catch{data={};}
 const safe=typeof data.url==='string'&&/^\/\?reminder=[\w-]{36}$/.test(data.url)?data.url:'/';
 event.waitUntil(self.registration.showNotification(data.title||'말줍',{body:data.body||'오늘의 표현을 복습해 보세요.',icon:'/assets/push-icon.svg',badge:'/assets/push-icon.svg',tag:data.tag||'maljup',data:{url:safe}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const url=new URL(event.notification.data?.url||'/',self.location.origin);
 if(url.origin!==self.location.origin)return;
 event.waitUntil((async()=>{
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const client=clients.find(c=>new URL(c.url).origin===self.location.origin);
  if(client){await client.navigate(url.href);await client.focus();}else await self.clients.openWindow(url.href);
 })());
});
