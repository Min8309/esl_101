export function day(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
export function nextDay(value){const d=new Date(value+'T12:00:00');d.setDate(d.getDate()+1);return day(d)}
export function due(card,today=day()){return card.reviews<3&&card.next<=today}
export function review(card,today=day()){if(!due(card,today))throw Error('아직 복습 시간이 아닙니다.');return {...card,reviews:card.reviews+1,next:nextDay(today),reviewDates:[...(card.reviewDates||[]),today]}}
export function videoId(value){
 try{
  const u=new URL(value);
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)return null;
  const host=u.hostname.replace(/^www\./,'');
  const id=host==='youtu.be'?u.pathname.match(/^\/([\w-]{11})\/?$/)?.[1]:['youtube.com','m.youtube.com'].includes(host)?(u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})\/?$/)?.[1]):null;
  return /^[\w-]{11}$/.test(id||'')?id:null;
 }catch{return null;}
}
export const sameVideo=(a,b)=>!!videoId(a)&&videoId(a)===videoId(b);
export function parseSubtitles(raw){const time=s=>s.trim().split(':').reduce((a,v)=>a*60+Number(v.replace(',','.')),0);return raw.replace(/\r/g,'').split(/\n\s*\n/).flatMap(block=>{const lines=block.split('\n');const n=lines.findIndex(l=>l.includes('-->'));if(n<0)return [];const start=time(lines[n].split('-->')[0]);const text=lines.slice(n+1).join(' ').replace(/<[^>]*>/g,'').trim();return Number.isFinite(start)&&text?[{start,text}]:[]})}

export function calendarEvents(cards,date,today=day()){
 const events=[];
 for(const card of cards){
  if(day(new Date(card.created))===date)events.push({card,type:'learned'});
  if((card.reviewDates||[]).includes(date))events.push({card,type:'reviewed'});
  if(card.reviews<3){
   let planned=card.next<today?today:card.next;
   for(let i=card.reviews;i<3;i++){if(planned===date)events.push({card,type:i===card.reviews&&card.next<today?'overdue':'planned'});planned=nextDay(planned)}
  }
 }
 return events;
}
export function calendarDays(year,month){
 const first=new Date(year,month,1,12), count=new Date(year,month+1,0,12).getDate();
 return [...Array(first.getDay()).fill(null),...Array.from({length:count},(_,i)=>day(new Date(year,month,i+1,12)))];
}
