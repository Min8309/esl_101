import test from 'node:test';
import assert from 'node:assert/strict';
import {noteRows,exportNotes,resolveGoogleClientId,DEFAULT_GOOGLE_CLIENT_ID} from '../src/google-sheets.js';
const card={id:'one',text:'=IMPORTXML("example")',meaning:'뜻',note:'여러 줄\n메모',created:0,start:12,reviews:2,next:'2026-10-22',memoEntries:[{text:'날짜 메모',created:0}],reviewDates:['2026-10-21'],mustMemorize:true,category:'단어',highlightColor:'yellow'};
test('export includes learning notes, dated memos and review state without changing cards',()=>{
 const original=structuredClone(card),rows=noteRows([card]);
 assert.equal(rows.length,2);assert.equal(rows[0].length,16);assert.equal(rows[1].length,16);
 assert.equal(rows[1][3],'여러 줄\n메모');assert.match(rows[1][4],/1970-01-01T00:00:00.000Z\n날짜 메모/);
 assert.equal(rows[1][11],'2026-10-21');assert.equal(rows[1][12],'예');assert.equal(rows[1][14],'단어');assert.equal(rows[1][15],'yellow');assert.deepEqual(card,original);
});
test('creates a private account file then writes literal strings rather than formulas',async()=>{
 const calls=[];
 const url=await exportNotes('test-token',[card],async(url,options)=>{
  calls.push({url,...options,body:JSON.parse(options.body)});
  return {ok:true,json:async()=>calls.length===1?{spreadsheetId:'sheet-123'}:{}};
 });
 assert.equal(calls.length,2);assert.match(url,/sheet-123\/edit$/);
 assert.equal(calls[0].headers.Authorization,'Bearer test-token');
 const cells=calls[1].body.requests[0].updateCells;
 assert.deepEqual(cells.rows[1].values[1].userEnteredValue,{stringValue:card.text});
 assert.deepEqual(cells.rows[1].values[6].userEnteredValue,{numberValue:12});
 assert.equal(calls[0].body.sheets[0].properties.sheetId,0);
});
test('empty exports make no network call',async()=>{
 await assert.rejects(exportNotes('token',[],()=>assert.fail('unexpected request')),/카드가 없습니다/);
});
test('expired authorization has a reconnect message',async()=>{
 await assert.rejects(exportNotes('token',[card],async()=>({ok:false,status:401})),/다시 연결/);
});
test('write failure reports the already created sheet and never claims success',async()=>{
 let calls=0;
 await assert.rejects(exportNotes('token',[card],async()=>++calls===1?{ok:true,json:async()=>({spreadsheetId:'partial'})}:{ok:false,status:403}),e=>{
  assert.match(e.message,/권한/);assert.match(e.sheetUrl,/partial\/edit$/);return true;
 });
});


test('uses the web OAuth client and migrates the retired desktop ID while preserving custom IDs',()=>{
 assert.equal(resolveGoogleClientId(null),DEFAULT_GOOGLE_CLIENT_ID);
 assert.equal(resolveGoogleClientId('  '),DEFAULT_GOOGLE_CLIENT_ID);
 assert.equal(resolveGoogleClientId('417489052087-29ss7hbohvrq77bj5u66dpo1hc8ilvhi.apps.googleusercontent.com'),DEFAULT_GOOGLE_CLIENT_ID);
 assert.equal(resolveGoogleClientId(' custom.apps.googleusercontent.com '),'custom.apps.googleusercontent.com');
});
