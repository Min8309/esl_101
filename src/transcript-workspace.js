import {escapeHTML as escape} from './html.js';
import {videoId,sameVideo} from './core.js';
export const COLORS=['yellow','green','blue','pink','purple'];
export const DEFAULT_PALETTE=[{color:'yellow',name:'단어'},{color:'green',name:'문장'},{color:'blue',name:'표현'},{color:'pink',name:'질문'},{color:'purple',name:'문법'}];
export const scriptKey=data=>`video:${videoId(data.url)}:${data.language}`;
export const selectionText=segments=>segments.map(s=>s.text).join('\n');
export function validSegments(cues,segments){
 return Array.isArray(segments)&&segments.length>0&&segments.every(s=>s&&Number.isInteger(s.cue)&&typeof cues[s.cue]?.text==='string'&&Number.isInteger(s.start)&&Number.isInteger(s.end)&&s.start>=0&&s.end>s.start&&s.end<=cues[s.cue].text.length&&typeof s.text==='string'&&s.text.trim()&&cues[s.cue].text.slice(s.start,s.end)===s.text);
}
export function validPalette(palette){return Array.isArray(palette)&&palette.length===5&&palette.every((p,i)=>p&&p.color===COLORS[i]&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=24);}
export function validScriptRecord(record){
 if(record?.id==='palette')return validPalette(record.palette);
 const d=record?.data;
 return !!d&&typeof d.title==='string'&&typeof d.url==='string'&&/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(d.url)&&typeof d.language==='string'&&['en','ko','ja'].some(l=>d.language===l||d.language?.startsWith(l+'-'))&&record.id===scriptKey(d)&&Array.isArray(d.cues)&&d.cues.length>0&&d.cues.every(c=>c&&typeof c.text==='string'&&Number.isFinite(c.start)&&c.start>=0)&&Array.isArray(record.highlights)&&record.highlights.every(h=>h&&typeof h.id==='string'&&COLORS.includes(h.color)&&validSegments(d.cues,h.segments));
}
export function highlightedHTML(text,cue,highlights){
 const spans=highlights.flatMap(h=>h.segments.filter(s=>s.cue===cue).map(s=>({...s,color:h.color})));
 const points=[...new Set([0,text.length,...spans.flatMap(s=>[s.start,s.end])])].sort((a,b)=>a-b);
 return points.slice(0,-1).map((start,i)=>{
  const end=points[i+1],active=spans.findLast(s=>s.start<=start&&s.end>=end),part=escape(text.slice(start,end));
  return active?`<mark class="ink-${active.color}">${part}</mark>`:part;
 }).join('');
}
export function selectionSegments(root,selection=window.getSelection()){
 if(!selection||selection.isCollapsed||!selection.rangeCount)return [];
 const range=selection.getRangeAt(0),segments=[];
 for(const element of root.querySelectorAll('.script-text')){
  if(element.closest('[hidden]')||!range.intersectsNode(element))continue;
  const selected=range.cloneRange();selected.selectNodeContents(element);
  if(element.contains(range.startContainer))selected.setStart(range.startContainer,range.startOffset);
  if(element.contains(range.endContainer))selected.setEnd(range.endContainer,range.endOffset);
  const prefix=range.cloneRange();prefix.selectNodeContents(element);prefix.setEnd(selected.startContainer,selected.startOffset);
  let text=selected.toString(),start=prefix.toString().length;
  const leading=text.length-text.trimStart().length;start+=leading;text=text.trim();
  if(text)segments.push({cue:Number(element.dataset.cue),start,end:start+text.length,text});
 }
 return segments;
}
function restoreSelection(root,segments){
 const selection=window.getSelection();if(!selection||!segments.length)return;
 const point=(segment,offset)=>{
  const el=root.querySelector(`.script-text[data-cue="${segment.cue}"]`);if(!el)return null;
  const walker=document.createTreeWalker(el,4);let node;
  while((node=walker.nextNode())){if(offset<=node.textContent.length)return [node,offset];offset-=node.textContent.length;}
  return null;
 };
 const a=point(segments[0],segments[0].start),last=segments.at(-1),b=point(last,last.end);
 if(a&&b){const range=document.createRange();range.setStart(...a);range.setEnd(...b);selection.removeAllRanges();selection.addRange(range);}
}

export class TranscriptWorkspace{
 constructor({persist,collect,notify,getCards=()=>[]}){this.collectorOpen=false;this.getCards=getCards;this.persist=persist;this.collect=collect;this.notify=notify;this.palette=structuredClone(DEFAULT_PALETTE);this.color='yellow';this.filter='';this.only=false;this.query='';this.doc=null;this.selection=[];this.saving=false;this.queue=Promise.resolve();if(typeof document!=='undefined')document.addEventListener('selectionchange',()=>{if(this.root?.isConnected)this.capture(false);});}
 setDocument(data,stored){
  this.doc={id:scriptKey(data),data,highlights:(stored?.highlights||[]).filter(h=>validSegments(data.cues,h.segments)),updated:Date.now()};
  this.query='';this.filter='';this.only=false;this.selection=[];
 }
 persistDocument(){
  this.doc.updated=Date.now();const snapshot=structuredClone(this.doc);
  this.queue=this.queue.catch(()=>{}).then(()=>this.persist(snapshot));
  this.queue.catch(()=>this.notify('형광펜 저장에 실패했습니다. 저장 공간을 확인하고 백업해 주세요.'));
  return this.queue;
 }
 html(){return '<div id="scriptWorkspace">'+this.innerHTML()+'</div>';}
 innerHTML(){
  if(!this.doc)return '';
  const {data,highlights}=this.doc;
  const records=highlights.filter(h=>!this.filter||h.color===this.filter);
  const collected=this.getCards().filter(c=>sameVideo(c.url,data.url));
  const name=color=>this.palette.find(p=>p.color===color)?.name||'일반';
  const rows=data.cues.map((cue,i)=>{
   const visible=cue.text.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())&&(!this.only||highlights.some(h=>h.segments.some(s=>s.cue===i)));
   const stamp=`${String(Math.floor(cue.start/60)).padStart(2,'0')}:${String(Math.floor(cue.start%60)).padStart(2,'0')}`;
   return `<li class="script-line" ${visible?'':'hidden'}><a class="script-stamp" href="${escape(data.url)}&t=${Math.floor(cue.start)}s" target="_blank" rel="noopener noreferrer">${stamp}</a> <span class="script-text" data-cue="${i}">${highlightedHTML(cue.text,i,highlights)}</span></li>`;
  }).join('');
  return `<div class="script-heading"><h3>스크립트</h3><span class="muted">${escape(data.title)} · ${escape(data.language)}${data.automatic?' 자동 자막':''}</span></div><div class="ink-toolbar"><span>형광펜</span><div class="ink-colors" role="group" aria-label="형광펜 색상">${this.palette.map(p=>`<button type="button" class="ink-choice ink-${p.color}" data-ink="${p.color}" aria-pressed="${this.color===p.color}" title="${escape(p.name)}">${escape(p.name)}</button>`).join('')}</div><button class="secondary" type="button" data-mark-selection>선택 영역 표시</button><label class="ink-only"><input type="checkbox" id="onlyMarked" ${this.only?'checked':''}>표시한 줄만</label></div><details class="ink-settings"><summary>색상별 수집 카테고리 설정</summary><div class="ink-category-inputs">${this.palette.map(p=>`<label><span class="ink-dot ink-${p.color}"></span>${escape(p.name)}<input type="text" data-category-color="${p.color}" value="${escape(p.name)}" maxlength="24" aria-label="${p.color} 카테고리"></label>`).join('')}</div><p class="muted">색상을 고르고 텍스트를 드래그하면 표시됩니다. 분류명은 이후 수집하는 카드에 적용됩니다.</p></details><p class="muted script-help">텍스트를 선택하면 형광펜으로 표시됩니다. 선택한 텍스트를 다시 잡아 왼쪽 수집함에 끌어놓거나 ‘선택 내용 수집’을 누르세요.</p><div class="script-workspace-grid"><div class="script-reading"><label>스크립트 검색<input id="scriptSearch" type="search" value="${escape(this.query)}" placeholder="단어나 문장 검색"></label><ol class="script-lines">${rows}</ol><p class="script-no-results muted" ${data.cues.some((c,i)=>c.text.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())&&(!this.only||highlights.some(h=>h.segments.some(s=>s.cue===i))))?'hidden':''}>검색 결과가 없습니다.</p></div><div class="script-collector" role="complementary" aria-label="형광펜 수집함"><button class="collector-toggle" type="button" data-toggle-collector aria-expanded="${this.collectorOpen}" aria-controls="collectorBody">수집함 · 카드 ${collected.length}개 / 표시 ${highlights.length}개 <span>${this.collectorOpen?'접기 ↑':'펼치기 ↓'}</span></button><div id="collectorBody" class="collector-body ${this.collectorOpen?'is-open':''}"><div class="collected-cards"><h3>수집한 내용 <small>${collected.length}개</small></h3>${collected.length?collected.map(c=>`<button type="button" class="collected-card" data-card="${escape(c.id)}"><span class="ink-label ${COLORS.includes(c.highlightColor)?'ink-'+c.highlightColor:''}">${escape(c.category||'일반')}</span><span>${escape(c.text)}</span><small>메모 · 복습 열기 ↗</small></button>`).join(''):'<p class="muted">이 영상에서 수집한 내용이 여기에 표시됩니다.</p>'}</div><div class="script-dropzone" tabindex="0" role="region" aria-label="선택한 텍스트를 놓아 수집"><strong>내 표현 수집함에 바로 넣기</strong><p>선택한 텍스트를 여기로 끌어놓으세요</p><button type="button" class="primary" data-collect-selection ${this.saving?'disabled':''}>선택 내용 수집</button></div><h3>형광펜 기록 <small>${highlights.length}개</small></h3><label>색상별 보기<select id="inkFilter"><option value="">모든 색상</option>${this.palette.map(p=>`<option value="${p.color}" ${this.filter===p.color?'selected':''}>${escape(p.name)}</option>`).join('')}</select></label><button class="secondary" type="button" data-collect-highlights ${!records.length||this.saving?'disabled':''}>표시한 내용만 수집 (${records.length})</button><div class="highlight-records">${records.length?records.map(h=>`<article class="highlight-record"><span class="ink-label ink-${h.color}">${escape(name(h.color))}</span><p draggable="true" data-drag-highlight="${escape(h.id)}">${escape(selectionText(h.segments))}</p><div class="actions"><button type="button" class="secondary" data-collect-highlight="${escape(h.id)}" ${this.saving?'disabled':''}>수집</button><button type="button" class="danger" data-remove-highlight="${escape(h.id)}">표시 삭제</button></div></article>`).join(''):'<p class="muted">아직 표시한 내용이 없습니다.</p>'}</div><p class="muted">형광펜 기록에는 선택한 부분만 보관됩니다. 수집하면 카테고리·영상·시각이 포함된 카드로 저장합니다.</p><p class="ink-status" role="status" aria-live="polite"></p></div></div></div>`;
 }
 bind(){
  this.root=document.querySelector('#scriptWorkspace');if(!this.root)return;
  this.root.onmouseup=e=>{if(e.target.closest('.script-text'))this.capture(true);};
  this.root.onkeyup=e=>{if(e.key==='Shift'&&e.target.closest('.script-text'))this.capture(true);};
  this.root.onmousedown=e=>{if(e.target.closest('[data-ink],[data-mark-selection],[data-collect-selection]'))e.preventDefault();};
  this.root.onclick=e=>this.handleClick(e).catch(()=>this.notify('작업에 실패했습니다. 브라우저 저장 공간을 확인하세요.'));
  this.root.onchange=e=>this.handleChange(e).catch(()=>this.notify('설정을 저장하지 못했습니다.'));
  this.root.oninput=e=>{if(e.target.id==='scriptSearch'){this.query=e.target.value;this.filterRows();}};
  this.root.ondragstart=e=>{
   const target=e.target.nodeType===1?e.target:e.target.parentElement;
   const record=target?.closest('[data-drag-highlight]');let h;
   if(record)h=this.doc.highlights.find(x=>x.id===record.dataset.dragHighlight);
   else if(target?.closest('.script-reading')){const segments=this.capture(false);if(segments.length)h={segments,color:this.color};}
   if(h&&e.dataTransfer){e.dataTransfer.setData('application/x-maljup-selection',JSON.stringify({doc:this.doc.id,...h}));e.dataTransfer.setData('text/plain',selectionText(h.segments));e.dataTransfer.effectAllowed='copy';}
  };
  const zone=this.root.querySelector('.script-dropzone');
  zone.ondragover=e=>{if([...e.dataTransfer.types].includes('application/x-maljup-selection')){e.preventDefault();e.dataTransfer.dropEffect='copy';zone.classList.add('is-dragging');}};
  zone.ondragleave=()=>zone.classList.remove('is-dragging');
  zone.ondrop=async e=>{
   e.preventDefault();zone.classList.remove('is-dragging');
   try{const payload=JSON.parse(e.dataTransfer.getData('application/x-maljup-selection'));
    if(payload.doc!==this.doc.id||!COLORS.includes(payload.color)||!validSegments(this.doc.data.cues,payload.segments))throw Error();
    await this.collectRecords([{segments:payload.segments,color:payload.color}]);
   }catch{this.notify('이 스크립트에서 선택한 텍스트를 놓아 주세요.');}
  };
 }
 paint(keepSelection=false){
  const selection=keepSelection?this.selection:[],scroll=this.root?.querySelector('.script-lines')?.scrollTop||0;
  if(!this.root?.isConnected)return;
  this.root.innerHTML=this.innerHTML();this.bind();this.root.querySelector('.script-lines').scrollTop=scroll;
  if(selection.length)restoreSelection(this.root,selection);
 }
 filterRows(){
  this.root.querySelectorAll('.script-line').forEach((row,i)=>{row.hidden=!this.doc.data.cues[i].text.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())||(this.only&&!this.doc.highlights.some(h=>h.segments.some(s=>s.cue===i)));});
  this.root.querySelector('.script-no-results').hidden=!!this.root.querySelector('.script-line:not([hidden])');
 }
 capture(mark){
  const segments=selectionSegments(this.root);
  if(!validSegments(this.doc.data.cues,segments))return [];
  this.selection=segments;
  if(mark)this.mark(segments);
  return segments;
 }
 mark(segments){
  const same=this.doc.highlights.find(h=>JSON.stringify(h.segments)===JSON.stringify(segments));
  if(same){if(same.color===this.color)return;same.color=this.color;}
  else this.doc.highlights.push({id:crypto.randomUUID(),color:this.color,segments:structuredClone(segments)});
  this.persistDocument();this.paint(true);
 }
 async collectRecords(records){
  if(this.saving||!records.length)return;
  this.saving=true;
  this.root?.querySelectorAll('[data-collect-selection],[data-collect-highlight],[data-collect-highlights]').forEach(b=>b.disabled=true);
  try{
   const items=records.map(h=>({text:selectionText(h.segments),start:this.doc.data.cues[h.segments[0].cue].start,url:this.doc.data.url,source:this.doc.data.title,category:this.palette.find(p=>p.color===h.color).name,highlightColor:h.color}));
   const count=await this.collect(items);
   this.paint();const status=this.root?.querySelector('.ink-status');if(status)status.textContent=`${count}개를 수집했습니다. 같은 문장·영상·시각·분류의 카드는 중복 저장하지 않습니다.`;
  }finally{const status=this.root?.querySelector('.ink-status')?.textContent;this.saving=false;this.paint();const message=this.root?.querySelector('.ink-status');if(message&&status)message.textContent=status;}
 }
 async handleClick(e){
  const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-toggle-collector')){this.collectorOpen=!this.collectorOpen;this.paint();return;}
  if(b.dataset.ink){this.color=b.dataset.ink;const current=this.capture(false);if(current.length)this.mark(current);else this.paint();}
  if(b.hasAttribute('data-mark-selection')){const current=this.capture(false),parts=current.length?current:this.selection;if(parts.length)this.mark(parts);else this.notify('스크립트에서 먼저 텍스트를 선택하세요.');}
  if(b.hasAttribute('data-collect-selection')){const parts=this.capture(false);if(parts.length)await this.collectRecords([{segments:parts,color:this.color}]);else if(this.selection.length)await this.collectRecords([{segments:this.selection,color:this.color}]);else this.notify('스크립트에서 먼저 텍스트를 선택하세요.');}
  if(b.hasAttribute('data-collect-highlights'))await this.collectRecords(this.doc.highlights.filter(h=>!this.filter||h.color===this.filter));
  if(b.dataset.collectHighlight){const h=this.doc.highlights.find(h=>h.id===b.dataset.collectHighlight);if(h)await this.collectRecords([h]);}
  if(b.dataset.removeHighlight){this.doc.highlights=this.doc.highlights.filter(h=>h.id!==b.dataset.removeHighlight);this.selection=[];await this.persistDocument();this.paint();}
 }
 async handleChange(e){
  if(e.target.id==='onlyMarked'){this.only=e.target.checked;this.filterRows();}
  if(e.target.id==='inkFilter'){this.filter=e.target.value;this.paint();}
  if(e.target.dataset.categoryColor){const value=e.target.value.trim();if(!value){this.notify('분류명을 입력하세요.');this.paint();return;}this.palette.find(p=>p.color===e.target.dataset.categoryColor).name=value.slice(0,24);await this.persist({id:'palette',palette:structuredClone(this.palette)});this.paint();}
 }
}
