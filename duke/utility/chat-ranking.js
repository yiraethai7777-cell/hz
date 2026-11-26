'use strict';
const {format,fold}=require('../core');
const LINE='━━━━━━━━━━━━━━',PAGE=100;
const clean=v=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,50).join('');
const num=v=>v.toLocaleString('ko-KR');
function createChatRanking({list,getName=()=>'',now=Date.now}={}){
 const last=new Map();
 function execute(e,cmd){
  if(e.msg?.room?.isOpenChat!==true)return '오픈채팅방에서만 사용할 수 있습니다.';
  if(cmd==='채팅순위전체'?e.args.length>1||e.args[0]&&!/^[1-9]\d{0,8}$/.test(e.args[0]):e.args.length)return '사용법 : -'+cmd+(cmd==='채팅순위전체'?' [페이지]':'');
  const key=e.roomId+':'+e.userId,at=now();
  if(last.has(key)&&at-last.get(key)<3000)return '채팅 순위 명령어는 3초 후 다시 사용해 주세요.';
  last.delete(key);last.set(key,at);while(last.size>2048)last.delete(last.keys().next().value);
  const rows=list(e.roomId).sort((a,b)=>b.chats-a.chats||a.id.localeCompare(b.id));
  let rank=0,prev=null,total=0;
  for(let i=0;i<rows.length;i++){const r=rows[i];if(r.chats!==prev)rank=i+1;r.rank=rank;prev=r.chats;total+=r.chats;}
  const name=r=>clean(getName(e.roomId,r.id)||r.name)||'이름 미확인';
  const line=r=>r.rank+'위 | '+name(r)+' : '+num(r.chats)+'회';
  if(cmd==='내채팅'){
   const me=rows.find(r=>r.id===e.userId);
   return format('RANKING',clean(e.msg?.sender?.name|| (me?name(me):''))+'님의 채팅 기록\n\n현재 순위 : '+(me?me.rank+'위 / '+rows.length+'명':'순위 없음')+'\n전체 채팅량 : '+num(me?.chats||0)+'회\n채팅 비율 : '+(total?((me?.chats||0)*100/total).toFixed(2):'0.00')+'%');
  }
  if(!rows.length)return format('RANKING','아직 집계된 채팅이 없습니다.');
  const summary=format('RANKING','채팅순위'+(cmd==='채팅순위전체'?' 전체':' TOP 10')+'\n집계 인원 : '+num(rows.length)+'명\n전체 채팅량 : '+num(total)+'회');
  if(cmd==='채팅순위'){
   const graph=r=>{const n=Math.max(1,Math.min(10,Math.round(10*r.chats/rows[0].chats)));return '▰'.repeat(n)+'▱'.repeat(10-n);};
   return fold(summary,LINE+'\n[ TOP 10 ]\n\n'+rows.slice(0,10).map(r=>line(r)+'\n'+graph(r)).join('\n\n')+'\n'+LINE+'\n그래프 기준 : 1위 채팅량');
  }
  const pages=Math.ceil(rows.length/PAGE),page=Number(e.args[0]||1);
  if(page>pages)return '존재하지 않는 페이지입니다. (1~'+pages+')';
  const compact=r=>r.rank+'. '+name(r).slice(0,24)+' '+num(r.chats);
  return fold(summary,LINE+'\n[ '+page+'/'+pages+' 페이지 · 단위: 회 ]\n'+rows.slice((page-1)*PAGE,page*PAGE).map(compact).join('\n')+'\n'+LINE+(page<pages?'\n다음 : -채팅순위전체 '+(page+1):''));
 }
 return {register(core){for(const [name,description] of [['채팅순위','누적 채팅 순위 상위 10명'],['채팅순위전체','누적 채팅 전체 순위 (100명/페이지)'],['내채팅','내 누적 채팅량과 순위']])core.register({name,description,execute:e=>execute(e,name)});}};
}
module.exports={createChatRanking};
