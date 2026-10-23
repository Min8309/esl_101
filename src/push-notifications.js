import {escapeHTML as esc} from './html.js';
const storage='maljup.pushGroup';
let status='',busy=false,callbacks={};
const key=()=>localStorage.getItem(storage)||'';
function newKey(){return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
async function api(path='',method='GET',body){
 const response=await fetch('/api/push/'+path,{method,headers:{Authorization:'Bearer '+key(),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'알림 요청에 실패했습니다.');return result;
}
function localDate(date){return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function pushCardHTML(card){const tomorrow=new Date(Date.now()+86400000);tomorrow.setHours(9,0,0,0);return `<section class="record push-card"><h2>휴대폰으로 문장 알림</h2><p class="muted">데이터 관리에서 아이폰을 연결한 뒤 예약하세요. 문장·뜻·학습 메모 사본이 알림 서버에 저장됩니다.</p><label>알림 날짜·시간 (이 기기 시간대)<input type="datetime-local" id="pushWhen" value="${localDate(tomorrow)}"></label><button class="primary" data-push-action="schedule" data-push-card="${esc(card.id)}">이 문장 알림 예약</button><p role="status" id="pushCardStatus"></p></section>`;}
export function pushSettingsHTML(){return `<section class="record" id="pushSettings"><h2>아이폰 문장 알림</h2><p class="muted">iOS 16.4 이상 · Safari에서 공유 → 홈 화면에 추가 → 말줍 아이콘으로 실행한 뒤 알림을 켜세요. 예약한 문장만 연결된 기기로 전달됩니다.</p><p class="muted">① 아이폰에서 연결 키 만들기 → 알림 켜기 ② PC에서 같은 연결 키 입력·적용 ③ 수집한 카드에서 알림 예약</p><label>기기 연결 키 (비밀번호처럼 보관)<input id="pushGroupKey" type="password" autocomplete="off" spellcheck="false" value="${esc(key())}" placeholder="아이폰에서 만든 연결 키를 PC에 입력"></label><div class="actions"><button class="secondary" data-push-action="create">새 연결 키 만들기</button><button class="secondary" data-push-action="copy">연결 키 복사</button><button class="secondary" data-push-action="join">입력한 키 적용</button></div><div class="actions"><button class="primary" data-push-action="enable">이 기기 알림 켜기</button><button class="secondary" data-push-action="test">테스트 알림 보내기</button><button class="secondary" data-push-action="disable">이 기기 알림 끄기</button><button class="secondary" data-push-action="refresh">예약 확인</button></div><p class="muted">연결 키를 아는 사람은 알림 예약과 문장을 볼 수 있습니다. 공용 PC에 저장하지 마세요. 알림에 문장 일부가 표시되므로 잠금 화면 미리보기 설정도 확인하세요.</p><button class="danger" data-push-action="reset">연결된 모든 기기·예약 삭제</button><p id="pushStatus" role="status">${esc(status)}</p><div id="pushReminders"></div></section>`;}
async function registration(){if(!('serviceWorker'in navigator))throw Error('이 브라우저는 웹 푸시를 지원하지 않습니다.');await navigator.serviceWorker.register('/sw.js');return navigator.serviceWorker.ready;}
async function refresh(){
 const host=document.querySelector('#pushReminders');if(!host||!key())return;
 const data=await api('reminders');if(!host.isConnected)return;
 const names={pending:'예약됨',sending:'전송 중',sent:'전송됨',failed:'전송 실패',expired:'기한 만료'};
 host.innerHTML=`<p>연결된 알림 기기 ${data.devices}개 · 예약/기록 ${data.reminders.length}개</p>`+data.reminders.map(r=>`<article class="push-reminder"><strong>${esc(r.card.text)}</strong><p>${esc(new Date(r.due).toLocaleString())} · ${esc(names[r.status]||r.status)}</p><button class="secondary" data-push-action="cancel" data-reminder="${esc(r.id)}">${r.status==='pending'?'예약 취소':'기록 삭제'}</button></article>`).join('');
}
async function action(button){
 const type=button.dataset.pushAction;
 if(type==='enable'){
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
  if(ios&&!navigator.standalone&&!matchMedia('(display-mode: standalone)').matches)throw Error('Safari 공유 → 홈 화면에 추가 후 말줍 아이콘으로 열어 주세요.');
  if(!('Notification'in window)||!('PushManager'in window)||!isSecureContext)throw Error('HTTPS 주소와 웹 푸시 지원 브라우저가 필요합니다.');
  if(!key())throw Error('먼저 연결 키를 만들거나 입력하세요.');
  // Request permission directly from the user's click, before any network await.
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('알림을 허용해야 합니다. 아이폰 설정에서 말줍 알림 권한을 확인하세요.');
  const config=await api('config');if(!config.enabled)throw Error('서버의 알림 설정이 아직 완료되지 않았습니다.');
  const reg=await registration();
  const raw=config.publicKey.replaceAll('-','+').replaceAll('_','/');const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
  const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
  try{await api('subscription','POST',{subscription:sub.toJSON()});}catch(e){await sub.unsubscribe();throw e;}
  return '이 기기 알림을 연결했습니다. 테스트 알림을 보내 확인하세요.';
 }
 if(type==='create'){
  if(key()&&!confirm('새 연결 키를 만들면 이 브라우저는 기존 연결에서 분리됩니다. 기존 예약은 유지됩니다. 계속할까요?'))return '';
  await unlinkCurrent();localStorage.setItem(storage,newKey());document.querySelector('#pushGroupKey').value=key();return '연결 키를 만들었습니다. 아이폰에서 알림을 켜고 이 키를 PC에 입력하세요.';
 }
 if(type==='join'){
  const value=document.querySelector('#pushGroupKey').value.trim();if(!/^[\w-]{43}$/.test(value))throw Error('복사한 연결 키 전체를 입력하세요.');
  if(value!==key()){await unlinkCurrent();localStorage.setItem(storage,value);}await refresh();return '연결 키를 적용했습니다.';
 }
 if(type==='copy'){if(!key())throw Error('먼저 연결 키를 만드세요.');await navigator.clipboard.writeText(key());return '연결 키를 복사했습니다. 다른 사람에게 공개하지 마세요.';}
 if(!key())throw Error('데이터 관리에서 아이폰 연결 키를 만들거나 입력하세요.');
 if(type==='disable'){await unlinkCurrent();return '이 기기의 알림을 껐습니다. 다른 기기와 예약은 유지됩니다.';}
 if(type==='test'){const r=await api('test','POST',{});return `${r.sent}개 기기로 전송 요청을 완료했습니다. 실제 알림 수신을 확인하세요.`;}
 if(type==='schedule'){
  const card=callbacks.getCard(button.dataset.pushCard);if(!card)throw Error('카드를 찾지 못했습니다.');
  const date=new Date(document.querySelector('#pushWhen').value);if(!Number.isFinite(date.getTime()))throw Error('알림 날짜와 시간을 선택하세요.');
  await api('reminders','POST',{card,when:date.toISOString()});return '문장 알림을 예약했습니다. 데이터 관리에서 취소할 수 있습니다.';
 }
 if(type==='cancel'){await api('reminders/'+button.dataset.reminder,'DELETE',{});await refresh();return '예약/기록을 삭제했습니다.';}
 if(type==='reset'){
  if(!confirm('연결된 모든 기기의 알림 구독과 예약·기록을 서버에서 삭제할까요?'))return '';
  await api('reset','DELETE',{});if('serviceWorker'in navigator){const reg=await navigator.serviceWorker.getRegistration('/');await(await reg?.pushManager?.getSubscription())?.unsubscribe();}localStorage.removeItem(storage);document.querySelector('#pushGroupKey').value='';document.querySelector('#pushReminders').textContent='';return '서버의 알림 연결과 예약을 삭제했습니다. 다른 기기에서도 기존 연결 키를 지우세요.';
 }
 if(type==='refresh'){await refresh();return '예약 목록을 확인했습니다.';}
}
async function unlinkCurrent(){
 if(!('serviceWorker'in navigator))return;
 const reg=await navigator.serviceWorker.getRegistration('/');const sub=await reg?.pushManager.getSubscription();
 if(sub){if(key())await api('subscription','DELETE',{endpoint:sub.endpoint});await sub.unsubscribe();}
}
export function initPush(options){
 callbacks=options;
 document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-push-action]');if(!button||busy)return;
  busy=true;button.disabled=true;
  try{status=await action(button)||status;}catch(e){status=e.message;}
  finally{busy=false;button.disabled=false;const host=document.querySelector('#pushCardStatus')||document.querySelector('#pushStatus');if(host)host.textContent=status;}
 });
 // Register without requesting permission. Notification clicks reopen the installed app.
 if('serviceWorker'in navigator&&isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{});
 const id=new URL(location.href).searchParams.get('reminder');
 if(id&&/^[\w-]{36}$/.test(id)){
  if(!key()){options.notify('이 기기의 데이터 관리에서 기존 알림 연결 키를 입력해 주세요.');return;}
  api('reminders/'+id).then(r=>options.openCard(r.card)).then(()=>history.replaceState(null,'','/')).catch(e=>options.notify(e.message));
 }
}
