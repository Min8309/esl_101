import {createAppServer} from '../server.mjs';
const {chromium}=await import(process.env.BROWSER_TEST_MODULE||'playwright-core');
const server=createAppServer();
import assert from 'node:assert/strict';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:process.platform==='linux'?{executablePath:'/usr/bin/chromium'}:{channel:'chrome'}),headless:true,args:['--no-sandbox']});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=`http://127.0.0.1:${server.address().port}`;
const fixture={title:'Review fixture',url:'https://www.youtube.com/watch?v=HWv1x2We9ag',language:'en',cues:[{start:3,text:'Hello there, a test phrase.'},{start:6,text:'Another test phrase.'}]};
const read=store=>page.evaluate(store=>new Promise(resolve=>{const r=indexedDB.open('phrase-garden');r.onsuccess=()=>{const db=r.result,q=db.transaction(store).objectStore(store).getAll();q.onsuccess=()=>{resolve(q.result);db.close();};};}),store);
await page.addInitScript(()=>{
 window.mockStopped=0;window.permissionRequests=[];
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>new Promise((resolve,reject)=>window.permissionRequests.push({resolve:()=>resolve({getTracks:()=>[{stop:()=>window.mockStopped++}]}),reject}))}});
 window.MediaRecorder=class{
  constructor(){this.state='inactive';this.mimeType='audio/webm';}
  start(){this.state='recording';}
  stop(){this.state='inactive';setTimeout(()=>{this.ondataavailable?.({data:new Blob(['audio'],{type:'audio/webm'})});this.onstop?.();},0);}
 };
});
try{
 await page.route('**/api/youtube-transcript',r=>r.fulfill({json:fixture}));await page.goto(base);await page.locator('#homeYoutubeForm').waitFor();
 await page.locator('#homeYoutubeForm input[name=url]').fill(fixture.url);await page.locator('#homeYoutubeForm button').click();await page.locator('.script-text').first().waitFor();
 await page.evaluate(()=>{const el=document.querySelector('.script-text'),r=document.createRange();r.setStart(el.firstChild,0);r.setEnd(el.firstChild,5);getSelection().removeAllRanges();getSelection().addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
 await page.locator('[data-collect-highlights]').click();await page.waitForFunction(()=>document.querySelector('.collected-card')?.textContent.includes('Hello'));
 await page.locator('.collected-card').click();await page.locator('#record').click();await page.waitForFunction(()=>permissionRequests.length===1);
 await page.locator('#detail [data-close]').click();await page.evaluate(()=>permissionRequests[0].resolve());await page.waitForFunction(()=>mockStopped===1);assert.equal(await page.locator('#detail').evaluate(d=>d.open),false);
 await page.locator('.collected-card').click();await page.locator('#record').click();await page.waitForFunction(()=>permissionRequests.length===2);await page.evaluate(()=>permissionRequests[1].resolve());await page.locator('#stop').waitFor({state:'visible'});
 await page.locator('[data-important]').click();assert.equal(await page.locator('[data-important]').isChecked(),false);assert.equal(await page.locator('#stop').isEnabled(),true);
 await page.locator('#stop').click();await page.locator('#saveRecording').waitFor();await page.locator('#saveRecording').click();await page.waitForFunction(()=>document.querySelectorAll('#cardRecordings audio').length===1);assert.equal((await read('recordings')).length,1);await page.locator('#detail [data-close]').click();
 // The logo navigates back, and delayed caption requests cannot recreate cleared data.
 await page.locator('.brand').click();await page.locator('#homeYoutubeForm').waitFor();let release,started;const seen=new Promise(r=>started=r);
 await page.unroute('**/api/youtube-transcript');await page.route('**/api/youtube-transcript',async r=>{started();await new Promise(resolve=>release=resolve);try{await r.fulfill({json:fixture});}catch{}});
 await page.locator('#homeYoutubeForm button').click();await seen;await page.locator('[data-view=settings]').click();page.on('dialog',d=>d.accept());await page.locator('#clear').click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('전체 데이터를 삭제'));
 release();await page.waitForTimeout(150);for(const store of ['cards','recordings','scripts'])assert.equal((await read(store)).length,0);
 await page.locator('.brand').click();assert.equal(await page.locator('#scriptWorkspace').count(),0);assert.equal(await page.locator('.script-launch').count(),0);assert.equal(await page.locator('#homeYoutubeForm button').isEnabled(),true);
 // Save a fractional timestamp through a real submit click.
 await page.locator('nav [data-view=library]').click();await page.locator('.heading [data-new]').click();await page.locator('#cardForm [name=text]').fill('Fractional time');await page.locator('#cardForm [name=start]').fill('12.345');await page.locator('#cardForm button.primary').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal((await read('cards'))[0].start,12.345);
 // Common desktop and small-screen widths must not overflow after CSS cleanup.
 for(const width of [1440,1024,768,390,320]){
  await page.setViewportSize({width,height:900});
  for(const view of ['home','library','calendar','review','recordings','checklist']){
   const target=page.locator(`nav [data-view=${view}]`);if(await target.isVisible())await target.click();else{await page.locator('#mobileMoreToggle').click();await page.locator(`#mobileMore [data-menu-view=${view}]`).click();}assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow in ${view} at ${width}`);
  }
 }
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),phone=await mobile.newPage();
 await phone.route('**/api/youtube-transcript',r=>r.fulfill({json:fixture}));await phone.goto(base);await phone.locator('#homeYoutubeForm').waitFor();
 assert.equal(await phone.locator('#homeYoutubeForm input[name=url]').evaluate(e=>getComputedStyle(e).fontSize),'16px');
 await phone.locator('#homeYoutubeForm input[name=url]').fill(fixture.url);await phone.locator('#homeYoutubeForm button').tap();await phone.locator('.script-text').first().waitFor();
 assert.equal(await phone.locator('#collectorBody').isVisible(),false);
 await phone.evaluate(()=>{const el=document.querySelector('.script-text'),r=document.createRange();r.setStart(el.firstChild,0);r.setEnd(el.firstChild,5);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));});
 await phone.locator('[data-mark-selection]').tap();await phone.locator('.script-text mark').waitFor();
 await phone.locator('[data-toggle-collector]').tap();await phone.locator('[data-collect-highlights]').tap();await phone.waitForFunction(()=>document.querySelector('.collected-card')?.textContent.includes('Hello'));
 await phone.reload();await phone.locator('.script-launch [data-view=script]').tap();await phone.locator('[data-toggle-collector]').tap();assert.equal(await phone.locator('.collected-card').count(),1);
 assert.equal(await phone.locator('nav button:visible').count(),5);
 await phone.locator('#mobileMenuToggle').tap();assert.equal(await phone.locator('#mobileMore.side-drawer').evaluate(d=>d.open),true);assert.equal(await phone.locator('#mobileMore [data-menu-view]').count(),7);
 await phone.locator('#mobileMore [data-menu-view=settings]').tap();await phone.locator('#googleClientId').waitFor();await phone.waitForFunction(()=>document.querySelector('#mobileMenuToggle').getAttribute('aria-expanded')==='false');
 await phone.locator('nav [data-view=home]').tap();await phone.locator('#homeYoutubeForm').waitFor();
 await page.setViewportSize({width:1440,height:1000});assert.equal(await page.locator('#mobileMenuToggle').isVisible(),false);assert.equal(await page.locator('#mobileMoreToggle').isVisible(),false);assert.equal(await page.locator('nav button:visible').count(),6);
 await mobile.close();
 assert.deepEqual(errors,[]);console.log('PASS desktop/mobile Chromium: permission-close race, recording controls/preview/save, atomic clear during delayed import, logo navigation and 5 responsive widths');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
