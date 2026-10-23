import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PALETTE,COLORS,highlightedHTML,validSegments,validScriptRecord,scriptKey,selectionText} from '../src/transcript-workspace.js';
const data={url:'https://www.youtube.com/watch?v=HWv1x2We9ag',title:'Lesson',language:'en',cues:[{start:336,text:'Honey, she keeps cancelling on us.'},{start:340,text:'What if something gets broken?'}]};
const segment={cue:0,start:0,end:5,text:'Honey'};
test('five palette categories and exact substring anchors including multi-line selection',()=>{
 assert.deepEqual(DEFAULT_PALETTE.map(p=>p.color),COLORS);
 assert.ok(validSegments(data.cues,[segment,{cue:1,start:0,end:7,text:'What if'}]));
 assert.equal(selectionText([segment,{text:'What if'}]),'Honey\nWhat if');
 for(const bad of [{...segment,text:'injected'},{...segment,end:100},{...segment,cue:99},{...segment,start:-1}])assert.equal(validSegments(data.cues,[bad]),false);
 assert.equal(validSegments(data.cues,[]),false);assert.equal(validSegments(data.cues,[null]),false);
});
test('overlapping marks preserve every character, latest color wins, script HTML is escaped',()=>{
 const text='A <b> lesson & word',highlights=[{color:'yellow',segments:[{cue:0,start:2,end:10}]},{color:'blue',segments:[{cue:0,start:6,end:12}]}];
 const html=highlightedHTML(text,0,highlights);
 assert.ok(html.includes('ink-yellow'));assert.ok(html.includes('ink-blue'));assert.ok(html.includes('&lt;b&gt;'));assert.ok(html.includes('&amp;'));
 assert.equal(html.replace(/<\/?mark[^>]*>/g,'').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&'),text);
 assert.equal(highlightedHTML('Honey',0,[]),'Honey');
});
test('script backup validation rejects invalid anchors, colors, URLs and palettes',()=>{
 const record={id:scriptKey(data),data,highlights:[{id:'h',color:'yellow',segments:[segment]}]};
 assert.ok(validScriptRecord(record));assert.ok(validScriptRecord({id:'palette',palette:DEFAULT_PALETTE}));
 for(const changes of [{id:'wrong'},{highlights:[{id:'h',color:'red',segments:[segment]}]},{data:{...data,url:'javascript:alert(1)'}},{highlights:[{id:'h',color:'green',segments:[{...segment,text:'wrong'}]}]}])assert.equal(validScriptRecord({...record,...changes}),false);
 assert.equal(validScriptRecord({id:'palette',palette:[{color:'yellow',name:'word'}]}),false);
 for(const bad of [{...record,data:{...data,language:4}},{...record,data:{...data,cues:[null]}},{...record,highlights:[null]},{id:'palette',palette:[null,null,null,null,null]}])assert.equal(validScriptRecord(bad),false);
});

test('video identity is shared across canonical, short and timestamp URLs',async()=>{
 const {sameVideo}=await import('../src/core.js');
 assert.ok(sameVideo(data.url,'https://youtu.be/HWv1x2We9ag?t=336'));
 assert.ok(sameVideo(data.url,'https://m.youtube.com/watch?v=HWv1x2We9ag&feature=share'));
 assert.equal(sameVideo('',undefined),false);
 const {TranscriptWorkspace}=await import('../src/transcript-workspace.js');
 const ws=new TranscriptWorkspace({persist:async()=>{},collect:async()=>0,notify:()=>{},getCards:()=>[{id:'saved',text:'Honey',url:'https://youtu.be/HWv1x2We9ag?t=3'}]});
 ws.setDocument(data);assert.match(ws.innerHTML(),/data-card="saved"/);
});

test('empty highlight collection does not trigger storage or leave saving enabled',async()=>{
 const {TranscriptWorkspace}=await import('../src/transcript-workspace.js');
 const ws=new TranscriptWorkspace({persist:async()=>{},collect:()=>assert.fail('empty collection'),notify:()=>{}});
 ws.setDocument(data);await ws.collectRecords([]);assert.equal(ws.saving,false);
});
