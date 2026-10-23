import {escapeHTML as esc} from './html.js';
export class ArchiveRecorder {
 constructor({getCards,save,notify}) {
  this.getCards=getCards;this.save=save;this.notify=notify;this.state='idle';this.session=0;
  document.addEventListener('click',event=>{
   if(!this.active||!this.root?.isConnected||this.root.contains(event.target))return;
   const button=event.target.closest('button'),brand=event.target.closest('a.brand');
   if(button?.hasAttribute('data-open-more')||button?.dataset.close==='mobileMore')return;
   if(button||brand){event.preventDefault();event.stopImmediatePropagation();this.notify('녹음을 종료하고 저장하거나 다시 녹음을 눌러 주세요.');}
  },true);
  window.addEventListener('beforeunload',event=>{if(this.active){event.preventDefault();event.returnValue='';}});
 }
 get active(){return ['recording','stopping','preview','saving'].includes(this.state);}
 mount(){
  this.root=document.querySelector('#archiveRecorder');if(!this.root)return;
  this.root.innerHTML=`<h2>바로 녹음하기</h2><p class="muted">학습 카드는 ‘내 표현 수집함’에 저장한 문장입니다. 카드를 연결하거나 자유롭게 녹음하세요.</p><label>연결할 학습 카드<select id="archiveCard"><option value="">카드 없이 자유 녹음</option>${this.getCards().map(c=>`<option value="${esc(c.id)}">${esc(c.text)}</option>`).join('')}</select></label><label>녹음 제목<input id="archiveTitle" maxlength="200" placeholder="예: 오늘의 영어 연습"></label><div class="actions"><button class="primary" data-archive-action="start">● 녹음 시작</button><button class="secondary" data-archive-action="stop" disabled>■ 녹음 종료</button><button class="secondary" data-view="library">학습 카드 보러 가기 →</button></div><p class="muted" data-archive-status role="status">마이크 권한을 허용하고 녹음을 시작하세요. 녹음은 이 브라우저에 저장됩니다.</p><div data-archive-preview></div>`;
  this.root.onclick=event=>{const button=event.target.closest('[data-archive-action]');if(!button)return;this.action(button.dataset.archiveAction).catch(()=>this.notify('녹음을 처리하지 못했습니다. 저장 공간을 확인하세요.'));};
 }
 controls(){
  if(!this.root?.isConnected)return;
  const idle=this.state==='idle';
  this.root.querySelector('[data-archive-action=start]').disabled=!idle;
  this.root.querySelector('[data-archive-action=stop]').disabled=this.state!=='recording';
  this.root.querySelector('#archiveCard').disabled=!idle;this.root.querySelector('#archiveTitle').disabled=!idle;
  this.root.querySelector('[data-view=library]').disabled=this.active;
 }
 status(text){const el=this.root?.querySelector('[data-archive-status]');if(el)el.textContent=text;}
 tracks(){this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;}
 dispose(){
  this.session++;const recorder=this.recorder;this.recorder=null;
  if(recorder?.state==='recording')try{recorder.stop();}catch{}
  this.tracks();if(this.previewURL)URL.revokeObjectURL(this.previewURL);this.previewURL=null;this.pending=null;this.state='idle';
 }
 async action(type){
  if(type==='start')return this.start();
  if(type==='stop'&&this.state==='recording'){this.state='stopping';this.controls();this.status('녹음 파일을 준비하고 있습니다…');this.recorder.stop();return;}
  if(type==='discard'&&this.state==='preview'){this.dispose();this.mount();return;}
  if(type==='save'&&this.state==='preview'){
   this.state='saving';this.controls();this.root.querySelectorAll('[data-archive-preview] button').forEach(b=>b.disabled=true);
   try{await this.save(this.pending);this.dispose();this.mount();this.notify('녹음을 저장했습니다. 아래 파일 목록에서 확인하세요.');}
   catch{this.state='preview';this.controls();this.root.querySelectorAll('[data-archive-preview] button').forEach(b=>b.disabled=false);this.notify('녹음을 저장하지 못했습니다. 저장 공간을 확인하고 다시 저장하세요.');}
  }
 }
 async start(){
  if(this.state!=='idle')return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){this.notify('HTTPS 주소의 Safari 등 녹음을 지원하는 브라우저에서 사용하세요.');return;}
  const root=this.root,session=++this.session,cardId=root.querySelector('#archiveCard').value;
  const title=root.querySelector('#archiveTitle').value.trim()||this.getCards().find(c=>c.id===cardId)?.text||'자유 녹음';
  this.state='requesting';this.controls();this.status('마이크 권한을 요청하고 있습니다…');
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});
   if(session!==this.session||!root.isConnected){stream.getTracks().forEach(t=>t.stop());return;}
   this.stream=stream;
   const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported?.(t));
   const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),parts=[];this.recorder=recorder;
   recorder.ondataavailable=event=>{if(event.data.size)parts.push(event.data);};
   recorder.onstop=()=>{
    if(session!==this.session||!root.isConnected)return;
    this.tracks();this.recorder=null;
    const blob=new Blob(parts,{type:recorder.mimeType||parts[0]?.type||'audio/webm'});
    if(!blob.size){this.state='idle';this.controls();this.status('녹음된 소리가 없습니다. 다시 녹음하세요.');return;}
    this.pending={id:crypto.randomUUID(),cardId,title,blob,created:Date.now()};this.state='preview';this.previewURL=URL.createObjectURL(blob);
    root.querySelector('[data-archive-preview]').innerHTML=`<h3>방금 녹음한 파일</h3><audio controls src="${this.previewURL}"></audio><div class="actions"><button class="primary" data-archive-action="save">녹음 저장</button><button class="secondary" data-archive-action="discard">다시 녹음</button></div>`;
    this.controls();this.status('들어본 뒤 녹음 저장을 누르세요.');
   };
   recorder.onerror=()=>{if(session!==this.session)return;this.dispose();this.mount();this.status('녹음 중 오류가 발생했습니다. 다시 시도하세요.');};
   recorder.start();this.state='recording';this.controls();this.status('● 녹음 중입니다. 끝나면 녹음 종료를 누르세요.');
  }catch{
   if(session!==this.session||!root.isConnected)return;
   this.dispose();this.mount();this.status('마이크를 사용할 수 없습니다. 브라우저의 마이크 권한을 확인하세요.');
  }
 }
}
