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
async function verifySheetsExport(target){
 const calls=[];
 await target.evaluate(()=>{window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:options=>({requestAccessToken:()=>options.callback({access_token:'mock-token',expires_in:3600})})}}};});
 await target.route('https://sheets.googleapis.com/v4/spreadsheets**',async route=>{
  calls.push(JSON.parse(route.request().postData()));
  await route.fulfill({json:calls.length===1?{spreadsheetId:'browser-test-sheet'}:{}});
 });
 await target.locator('#googleConnect').click();await target.waitForFunction(()=>document.querySelector('#googleConnect').textContent==='Google 계정 연결');
 await target.locator('#googleConnect').click();await target.waitForFunction(()=>!document.querySelector('#googleExport').disabled);
 await target.locator('#googleExport').click();await target.waitForFunction(()=>document.querySelector('a[href*="browser-test-sheet"]'));
 assert.equal(calls.length,2);
 const cells=calls[1].requests[0].updateCells.rows[1].values;
 assert.equal(cells[1].userEnteredValue.stringValue,'Hello');assert.equal(cells[14].userEnteredValue.stringValue,'단어');assert.equal(cells[15].userEnteredValue.stringValue,'yellow');
 assert.ok(await target.getByText('메모를 새 Google 시트에 저장했습니다.',{exact:true}).isVisible());
}
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
 await page.locator('[data-view=settings]').click();await verifySheetsExport(page);
 // A collected card is scheduled with its snapshot; no notification permission is needed on the PC.
 await page.locator('[data-push-action=create]').click();await page.waitForFunction(()=>document.querySelector('#pushGroupKey').value.length===43);
 let reservation;
 await page.route('**/api/push/reminders',async route=>{reservation=route.request().postDataJSON();await route.fulfill({status:201,json:{id:'test-reservation'}});});
 await page.locator('nav [data-view=library]').click();await page.locator('.card').first().click();
 await page.locator('#pushWhen').fill(new Date(Date.now()+3600000).toISOString().slice(0,16));
 await page.locator('[data-push-action=schedule]').click();await page.waitForFunction(()=>document.querySelector('#pushCardStatus').textContent.includes('예약했습니다'));
 assert.equal(reservation.card.text,'Hello');assert.ok(reservation.when);await page.locator('#detail [data-close]').click();
 // The logo navigates back, and delayed caption requests cannot recreate cleared data.
 await page.locator('.brand').click();await page.locator('#homeYoutubeForm').waitFor();let release,started;const seen=new Promise(r=>started=r);
 await page.unroute('**/api/youtube-transcript');await page.route('**/api/youtube-transcript',async r=>{started();await new Promise(resolve=>release=resolve);try{await r.fulfill({json:fixture});}catch{}});
 await page.locator('#homeYoutubeForm button').click();await seen;await page.locator('[data-view=settings]').click();page.on('dialog',d=>d.accept());await page.locator('#clear').click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('전체 데이터를 삭제'));
 release();await page.waitForTimeout(150);for(const store of ['cards','recordings','scripts'])assert.equal((await read(store)).length,0);
 await page.locator('.brand').click();assert.equal(await page.locator('#scriptWorkspace').count(),0);assert.equal(await page.locator('.script-launch').count(),0);assert.equal(await page.locator('#homeYoutubeForm button').isEnabled(),true);
 // Save a fractional timestamp through a real submit click.
 await page.locator('nav [data-view=library]').click();await page.locator('.heading [data-new]').click();await page.locator('#cardForm [name=text]').fill('Fractional time');await page.locator('#cardForm [name=start]').fill('12.345');await page.locator('#cardForm button.primary').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal((await read('cards'))[0].start,12.345);
 // Home-card delete has an independent hit target and preserves confirmation behavior.
 await page.locator('.brand').click();await page.locator('[data-delete-card]').waitFor();page.removeAllListeners('dialog');
 page.once('dialog',d=>d.dismiss());await page.locator('[data-delete-card]').click();assert.equal((await read('cards')).length,1);assert.equal(await page.locator('#detail').evaluate(d=>d.open),false);
 page.once('dialog',d=>d.accept());await page.locator('[data-delete-card]').click();await page.waitForFunction(()=>!document.querySelector('[data-delete-card]'));assert.equal((await read('cards')).length,0);
 // Common desktop and small-screen widths must not overflow after CSS cleanup.
 for(const width of [1440,1024,768,390,320]){
  await page.setViewportSize({width,height:900});
  for(const view of ['home','library','calendar','review','recordings','checklist']){
   const target=page.locator(`nav [data-view=${view}]`);if(await target.isVisible())await target.click();else{await page.locator('#mobileMoreToggle').click();await page.locator(`#mobileMore [data-menu-view=${view}]`).click();}assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow in ${view} at ${width}`);
  }
 }
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),phone=await mobile.newPage();
 phone.on('pageerror',e=>errors.push(e.message));
 await phone.route('**/api/youtube-transcript',r=>r.fulfill({json:fixture}));await phone.goto(base);await phone.locator('#homeYoutubeForm').waitFor();
 assert.equal(await phone.locator('#homeYoutubeForm input[name=url]').evaluate(e=>getComputedStyle(e).fontSize),'16px');
 await phone.locator('#homeYoutubeForm input[name=url]').fill(fixture.url);await phone.locator('#homeYoutubeForm button').tap();await phone.locator('.script-text').first().waitFor();
 assert.equal(await phone.locator('#collectorBody').isVisible(),false);
 await phone.evaluate(()=>{const el=document.querySelector('.script-text'),r=document.createRange();r.setStart(el.firstChild,0);r.setEnd(el.firstChild,5);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));});
 await phone.locator('[data-mobile-tools]').tap();assert.equal(await phone.locator('.mobile-ink-dots button').count(),5);assert.equal(await phone.locator('#mobileScriptTools .ink-toolbar').isVisible(),false);assert.equal(await phone.locator('#mobileScriptTools textarea').count(),0);assert.equal(await phone.locator('[data-toggle-collector] span').textContent(),'접기 ↑');
 await phone.locator('.mobile-ink-dot[data-ink=yellow]').tap();await phone.locator('.script-text mark').waitFor();
 const board=await phone.locator('#mobileScriptTools').boundingBox();assert.ok(board.x>150&&board.width<220&&board.height<500,'memo pad stays compact at lower right');
 const handle=await phone.locator('[data-drag-selection]').boundingBox(),pad=await phone.locator('.mobile-memo-pad').boundingBox();
 const touch=await mobile.newCDPSession(phone),x=handle.x+handle.width/2,y=handle.y+handle.height/2;
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:Math.min(y+38,pad.y+pad.height-5)}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await phone.waitForFunction(()=>document.querySelector('.collected-card')?.textContent.includes('Hello'));
 assert.equal(await phone.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('phrase-garden');r.onsuccess=()=>{const q=r.result.transaction('cards').objectStore('cards').getAll();q.onsuccess=()=>resolve(q.result[0].note);};})), '');
 await phone.locator('[data-mobile-sentence]').first().tap();assert.equal(await phone.locator('[data-mobile-sentence]').first().getAttribute('aria-pressed'),'true');phone.once('dialog',d=>d.accept());await phone.locator('[data-delete-sentence]').tap();await phone.waitForFunction(()=>document.querySelectorAll('[data-mobile-sentence]').length===0);
 await phone.evaluate(()=>{const el=document.querySelector('.script-text'),r=document.createRange();r.selectNodeContents(el.querySelector('mark'));getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));});
 await phone.locator('[data-quick-collect]').tap();await phone.waitForFunction(()=>document.querySelectorAll('[data-mobile-sentence]').length===1);
 await phone.screenshot({path:'/tmp/maljup-mobile-memo.png'});
 await phone.evaluate(()=>{const el=document.querySelector('.script-text'),r=document.createRange();r.selectNodeContents(el.querySelector('mark'));getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));});
 await phone.locator('[data-quick-collect]').tap();await phone.waitForFunction(()=>document.querySelector('.collected-card')?.textContent.includes('Hello'));
 await phone.waitForFunction(()=>document.querySelector('#toast').textContent.includes('이미 수집한 문장'));assert.equal(await phone.locator('.mobile-memo-count').textContent(),'1개');assert.equal(await phone.locator('[data-mobile-sentence]').count(),1);assert.ok(!(await phone.locator('#toast').textContent()).includes('0개'));
 await phone.reload();await phone.locator('.script-launch [data-view=script]').tap();await phone.locator('[data-mobile-tools]').tap();assert.equal(await phone.locator('.collected-card').count(),1);
 await phone.setViewportSize({width:1024,height:844});assert.equal(await phone.locator('#mobileScriptTools').isVisible(),false);assert.equal(await phone.locator('.ink-toolbar').isVisible(),true);assert.equal(await phone.locator('.script-collector').isVisible(),true);
 await phone.setViewportSize({width:390,height:844});await phone.keyboard.press('Escape');assert.equal(await phone.locator('[data-mobile-tools]').getAttribute('aria-expanded'),'false');await phone.locator('[data-mobile-tools]').tap();
 await phone.locator('[data-close-tools]').tap();assert.equal(await phone.locator('#mobileScriptTools').isVisible(),false);
 assert.equal(await phone.locator('nav button:visible').count(),5);
 await phone.locator('#mobileMenuToggle').tap();assert.equal(await phone.locator('#mobileMore.side-drawer').evaluate(d=>d.open),true);assert.equal(await phone.locator('#mobileMore [data-menu-view]').count(),7);
 await phone.locator('#mobileMore [data-menu-view=settings]').tap();await phone.locator('#googleClientId').waitFor();await phone.waitForFunction(()=>document.querySelector('#mobileMenuToggle').getAttribute('aria-expanded')==='false');
 await verifySheetsExport(phone);
 await phone.locator('nav [data-view=home]').tap();await phone.locator('#homeYoutubeForm').waitFor();
 await page.setViewportSize({width:1440,height:1000});assert.equal(await page.locator('#mobileMenuToggle').isVisible(),false);assert.equal(await page.locator('#mobileMoreToggle').isVisible(),false);assert.equal(await page.locator('nav button:visible').count(),6);
 await mobile.close();
 assert.deepEqual(errors,[]);console.log('PASS desktop/mobile Chromium: permission-close race, recording controls/preview/save, atomic clear during delayed import, logo navigation and 5 responsive widths');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
