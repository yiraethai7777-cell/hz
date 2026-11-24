'use strict';
// Room-scoped VALORANT duo recruitment; independent from party and scrim data.
const {command,tail,limit,clean}=require('./core');
const {cleanup}=require('./database');
const COMMANDS=new Set(['!듀오모집','!듀오목록','!듀오신청','!듀오취소','!듀오종료']);
const MAX_NOTE=120;
function parseRecruitment(raw){
 const q=clean(raw);
 if(!q)return {tier:'티어 무관',note:'함께 플레이할 듀오를 모집합니다.'};
 let tier,note;
 if(q.includes('/')){
  const index=q.indexOf('/');
  tier=clean(q.slice(0,index));
  note=clean(q.slice(index+1));
 }else{
  const space=q.indexOf(' ');
  tier=space<0?q:clean(q.slice(0,space));
  note=space<0?'함께 플레이할 듀오를 모집합니다.':clean(q.slice(space+1));
 }
 if(!tier||!note||[...tier].length>40||[...note].length>MAX_NOTE)return null;
 return {tier,note};
}
function number(raw,reply){
 return limit(clean(raw)||reply,1,Number.MAX_SAFE_INTEGER);
}
async function handle(ctx){
 const {text,roomId,userId,userName,db,send,mention}=ctx;
 const c=command(text);
 if(!COMMANDS.has(c))return false;
 const room=String(roomId??''),user=String(userId??'');
 if(!room||!user||typeof send!=='function')return false;
 await cleanup(db);
 const name=clean(userName||'참가자').slice(0,40)||'참가자';
 const q=tail(text);
 if(c==='!듀오모집'){
  const info=parseRecruitment(q);
  if(!info)return send('사용법: !듀오모집 (티어) / (모집 설명)\n예시: !듀오모집 골드 / 경쟁전 마이크 가능');
  // One open recruitment per user and room. A previously matched duo does
  // not block new recruitment.
  const active=await db.query(
   'SELECT id FROM vs_duos WHERE room_id=$1 AND owner_id=$2 AND partner_id IS NULL AND expires_at>NOW() ORDER BY id DESC LIMIT 1',
   [room,user]);
  if(active.rowCount)return send('❌ 이미 진행 중인 듀오 모집 #'+active.rows[0].id+'이 있습니다.\n!듀오종료 후 다시 등록해 주세요.');
  const result=await db.query(
   'INSERT INTO vs_duos(room_id,owner_id,owner_name,tier,note) VALUES($1,$2,$3,$4,$5) RETURNING id',
   [room,user,name,info.tier,info.note]);
  if(!result.rowCount)return send('❌ 듀오 모집글을 등록하지 못했습니다.');
  const id=result.rows[0].id;
  return send('🎮 VALORANT SCHOOL | 듀오 모집 #'+id+
   '\n👤 모집자: '+name+'\n🏅 티어: '+info.tier+
   '\n📝 '+info.note+
   '\n⏰ 2시간 뒤 자동 종료'+
   '\n\n✅ 신청: !듀오신청 '+id+' (또는 이 글에 답장으로 !듀오신청)'+
   '\n❌ 모집 종료: !듀오종료 '+id);
 }
 if(c==='!듀오목록'){
  const rows=await db.query(
   'SELECT id,owner_name,tier,note FROM vs_duos WHERE room_id=$1 AND partner_id IS NULL AND expires_at>NOW() ORDER BY id DESC LIMIT 30',
   [room]);
  if(!rows.rowCount)return send('🎮 VALORANT SCHOOL | 듀오 모집\n현재 모집 중인 듀오가 없습니다.\n!듀오모집 (티어) / (설명)');
  return send('🎮 VALORANT SCHOOL | 듀오 모집 목록\n'+
   rows.rows.map(x=>'#'+x.id+' · '+clean(x.owner_name)+' · '+clean(x.tier)+'\n'+clean(x.note)).join('\n\n')+
   '\n\n참가: !듀오신청 (번호)');
 }
 if(c==='!듀오신청'){
  const id=number(q,ctx.replyDuoNumber);
  if(!id)return send('사용법: !듀오신청 (모집번호)\n또는 듀오 모집글에 답장으로 !듀오신청');
  const already=await db.query(
   'SELECT id FROM vs_duos WHERE room_id=$1 AND partner_id=$2 AND expires_at>NOW() LIMIT 1',
   [room,user]);
  if(already.rowCount)return send('❌ 이미 듀오 #'+already.rows[0].id+'에 참가 중입니다.\n!듀오취소 (번호)로 취소할 수 있습니다.');
  // Atomic update: a concurrent second applicant cannot take the same slot.
  const joined=await db.query(
   'UPDATE vs_duos SET partner_id=$3,partner_name=$4,matched_at=NOW() WHERE room_id=$1 AND id=$2 AND owner_id<>$3 AND partner_id IS NULL AND expires_at>NOW() RETURNING id,owner_id,owner_name,tier',
   [room,String(id),user,name]);
  if(!joined.rowCount){
   const check=await db.query('SELECT owner_id,partner_id FROM vs_duos WHERE room_id=$1 AND id=$2 AND expires_at>NOW()',[room,String(id)]);
   if(check.rows?.[0]?.owner_id===user)return send('❌ 본인이 등록한 듀오 모집에는 신청할 수 없습니다.');
   return send('❌ 신청할 수 없는 듀오입니다.\n이미 모집이 완료되었거나 만료되었습니다. !듀오목록을 확인해 주세요.');
  }
  const duo=joined.rows[0];
  await send('✅ 듀오 #'+duo.id+' 매칭 완료\n👤 '+clean(duo.owner_name)+' + '+name+
   '\n🏅 티어: '+clean(duo.tier)+'\n모집글은 목록에서 자동으로 내려갑니다.\n참가 취소: !듀오취소 '+duo.id);
  const ownerTag=typeof mention==='function'?mention(String(duo.owner_id),clean(duo.owner_name)):'@'+clean(duo.owner_name);
  await send(String(ownerTag)+'님, '+name+'님이 듀오 #'+duo.id+'에 참가했습니다.');
  return true;
 }
 if(c==='!듀오취소'){
  const id=number(q,ctx.replyDuoNumber);
  if(q&&!id)return send('사용법: !듀오취소 (번호)');
  const params=[room,user];
  let sql='UPDATE vs_duos SET partner_id=NULL,partner_name=NULL,matched_at=NULL WHERE room_id=$1 AND partner_id=$2 AND expires_at>NOW()';
  if(id){params.push(String(id));sql+=' AND id=$3';}
  sql+=' RETURNING id,owner_id,owner_name';
  // A user can be matched to only one duo by the command-level guard.
  const res=await db.query(sql,params);
  if(!res.rowCount)return send('❌ 취소할 듀오 참가 기록이 없습니다.\n모집자가 종료하려면 !듀오종료를 입력하세요.');
  await send('✅ 듀오 #'+res.rows[0].id+' 참가를 취소했습니다.\n모집글이 다시 열렸습니다.');
  return true;
 }
 // Only the recruitment owner may end it, whether still open or matched.
 const id=number(q,ctx.replyDuoNumber);
 if(q&&!id)return send('사용법: !듀오종료 (번호)');
 const params=[room,user];
 let sql='DELETE FROM vs_duos WHERE room_id=$1 AND owner_id=$2';
 if(id){params.push(String(id));sql+=' AND id=$3';}
 else sql+=' AND id=(SELECT id FROM vs_duos WHERE room_id=$1 AND owner_id=$2 ORDER BY id DESC LIMIT 1)';
 sql+=' RETURNING id';
 const result=await db.query(sql,params);
 return send(result.rowCount?'✅ 듀오 모집 #'+result.rows[0].id+'을(를) 종료했습니다.':'❌ 종료할 본인 명의의 듀오 모집이 없습니다.');
}
module.exports={COMMANDS,parseRecruitment,handle};
