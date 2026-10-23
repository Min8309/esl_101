// Public OAuth identifier; never put a client secret in the browser.
export const DEFAULT_GOOGLE_CLIENT_ID='417489052087-29ss7hbohvrq77bj5u66dpo1hc8ilvhi.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export function noteRows(cards) {
  return [
    ['카드 ID','표현','뜻','학습 메모','암기 메모 (날짜별)','영상 링크','시작 시간(초)','출처','생성 시각','복습 횟수','다음 복습일','복습 완료일','꼭 외울 문장','암기 완료','수집 카테고리','형광펜 색상'],
    ...cards.map(c => [c.id,c.text,c.meaning||'',c.note||'',
      (c.memoEntries||[]).map(m=>`${new Date(m.created).toISOString()}\n${m.text}`).join('\n\n'),
      c.url||'',c.start??0,c.source||'',new Date(c.created).toISOString(),c.reviews??0,c.next||'',
      (c.reviewDates||[]).join(', '),c.mustMemorize?'예':'아니요',c.memorized?'예':'아니요',c.category||'일반',c.highlightColor||''])
  ];
}
let loading;
function loadIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (!loading) loading = new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://accounts.google.com/gsi/client';script.async=true;
    script.onload=()=>{if(globalThis.google?.accounts?.oauth2)resolve();else reject(Error('Google 로그인 도구를 불러오지 못했습니다.'));};
    script.onerror=()=>reject(Error('Google 로그인에 연결하지 못했습니다. 네트워크를 확인하세요.'));
    document.head.append(script);
  }).catch(e=>{loading=null;throw e;});
  return loading;
}
export async function prepareGoogle() { await loadIdentity(); }
export function connectGoogle(clientId) {
  return new Promise((resolve,reject)=>{
    if (!globalThis.google?.accounts?.oauth2) {reject(Error('먼저 Google 연결 준비를 눌러 주세요.'));return;}
    const client=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:SCOPE,
      callback:r=>{if(r.error||!r.access_token||!google.accounts.oauth2.hasGrantedAllScopes(r,SCOPE))reject(Error('Google 파일 접근 권한을 허용한 뒤 다시 연결해 주세요.'));else resolve(r);},
      error_callback:()=>reject(Error('Google 로그인 창이 닫혔습니다. 팝업 허용 후 다시 시도하세요.'))});
    client.requestAccessToken({prompt:'consent'});
  });
}
export function disconnectGoogle(token) {
  if(token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token,()=>{});
}
export async function exportNotes(token,cards,fetcher=fetch) {
  if(!cards.length) throw Error('저장할 카드가 없습니다.');
  const values=noteRows(cards);
  async function api(path,body) {
    const res=await fetcher('https://sheets.googleapis.com/v4/spreadsheets'+path,{
      method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!res.ok) {
      if(res.status===401)throw Error('Google 연결이 만료되었습니다. 다시 연결해 주세요.');
      if(res.status===403)throw Error('Google Sheets API 사용 설정과 계정 권한을 확인해 주세요.');
      throw Error(`Google Sheets 저장에 실패했습니다 (${res.status}). 잠시 후 다시 시도하세요.`);
    }
    return res.json();
  }
  const created=await api('',{properties:{title:`말줍 메모 ${new Date().toISOString()}`},
    sheets:[{properties:{sheetId:0,title:'메모',gridProperties:{rowCount:Math.max(1000,values.length),columnCount:values[0].length,frozenRowCount:1}}}]});
  const url=`https://docs.google.com/spreadsheets/d/${encodeURIComponent(created.spreadsheetId)}/edit`;
  try {
    await api(`/${encodeURIComponent(created.spreadsheetId)}:batchUpdate`,{requests:[{updateCells:{
      start:{sheetId:0,rowIndex:0,columnIndex:0},fields:'userEnteredValue',
      rows:values.map(row=>({values:row.map(value=>({userEnteredValue:typeof value==='number'?{numberValue:value}:{stringValue:String(value)}}))}))
    }}]});
  } catch(e) { e.sheetUrl=url;throw e; }
  return url;
}
