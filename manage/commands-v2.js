'use strict';
const {getPool}=require('../shared/db');
const {attend}=require('./attendance');
const {messages:chatRanks}=require('./chat-ranking');
const {mentions,reference,resolve:resolveReply}=require('./targets');
const {formatCommandHelp}=require('../shared/help');
const {reset:resetSpam}=require('./spam');
const PUBLIC=new Set(['!출석','!출석이미지','!출석순위','!채팅순위','!채팅순위전체','!채팅정보']);
const STAFF=new Set(['!경고','!경고내역','!경고삭제','!경고초기화','!kick','!k','!내풀','!벤해제','!벤기록','!관리로그','!입퇴장로그','!입장변경','!퇴장변경','!프로필로그','!공지예약','!공지목록','!공지삭제']);
const OWNER=new Set(['!관리on','!관리off','!관리자추가','!관리자삭제','!도배감지on','!삭제감지on','!삭제감지off','!프로필감지on','!프로필감지off']);
const ALL=new Set([...PUBLIC,...STAFF,...OWNER,'!관리명령어','!id','!멘션감지on','!멘션감지off','!멘션감지상태']);
const OWNER_IDS=new Set(String(process.env.HZ_OWNER_IDS||process.env.HZ_OWNER_ID||'').split(/[\s,;]+/).filter(Boolean));
const owner=(u,bot)=>bot===true||String(u)===String(process.env.GL_OWNER_ID||'__NO_OWNER__')||OWNER_IDS.has(String(u));
async function enabled(db,room){
 const r=await db.query("SELECT COALESCE((SELECT enabled FROM gl_manage_rooms WHERE room_id=$1),(SELECT (data->>'manage')::boolean FROM hz_rooms WHERE room_id=$1),FALSE) AS enabled",[room]);
 return r.rows[0]?.enabled===true;
}
async function isStaff(db,room,user,type,isOwner){
 if(isOwner||[1,4].includes(Number(type)))return true;
 const r=await db.query('SELECT 1 FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2',[room,user]);
 return r.rowCount>0;
}
const time=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'시간 확인 불가';};
async function pages(send,title,rows){
 let bucket=[],len=0,page=1;
 for(const item of rows.length?rows:['기록 없음']){
  const line=String(item);
  if(bucket.length&&len+line.length>2600){
   await send(title+' ('+(page++)+'페이지)\n'+bucket.join('\n'));bucket=[];len=0;
  }
  bucket.push(line);len+=line.length+1;
 }
 await send(title+(page>1?' ('+page+'페이지)':'')+'\n'+bucket.join('\n'));
}
async function setEnabled(db,room,on){
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('INSERT INTO gl_manage_rooms(room_id,enabled) VALUES($1,$2) ON CONFLICT(room_id) DO UPDATE SET enabled=EXCLUDED.enabled',[room,on]);
  await c.query("INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object('manage',$2::boolean)) ON CONFLICT(room_id) DO UPDATE SET data=jsonb_set(hz_rooms.data,'{manage}',to_jsonb($2::boolean),true),updated_at=NOW()",[room,on]);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function targetOf(db,room,msg,tail,client,allowMention=true){
 const first=String(tail||'').trim().split(/\s+/)[0];
 if(/^\d{4,}$/.test(first))return {id:first,name:first};
 const tagged=mentions(msg);
 if(allowMention&&tagged.length===1)return tagged[0];
 if(!allowMention&&tagged.length)return null;
 const r=await resolveReply({msg,text:'#대상 '+String(tail||'').trim(),roomId:room,client,db});
 return r?.id?r:null;
}
const goodTarget=(t,user,bot)=>!!t&&/^\d{4,}$/.test(String(t.id))&&String(t.id)!==String(user)&&String(t.id)!==String(bot);
async function action(db,room,user,target,name,detail){
 await db.query('INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,$4,$5)',[room,user,target,name,detail]);
}
async function history(db,room,target){
 const a=await db.query("SELECT created_at,action,actor_id,target_id,detail FROM gl_manage_actions WHERE room_id=$1 AND action IN ('KICK','KICK_RELEASE','UNKICK','AUTO_BAN') AND ($2::text IS NULL OR target_id=$2) ORDER BY id DESC LIMIT 100",[room,target||null]);
 const b=await db.query("SELECT created_at,user_id AS target_id,meta FROM hz_events WHERE room_id=$1 AND event_type='kick' AND ($2::text IS NULL OR user_id=$2) AND (meta->>'actorType') IN ('1','4') ORDER BY id DESC LIMIT 100",[room,target||null]);
 return [
  ...a.rows.map(v=>({d:new Date(v.created_at),s:time(v.created_at)+' · '+(v.detail||v.action)+' · 대상 '+v.target_id+' · 실행 '+(v.actor_id||'자동')})),
  ...b.rows.map(v=>({d:new Date(v.created_at),s:time(v.created_at)+' · 방장/부방장 강퇴 · 대상 '+v.target_id+' · 실행 '+(v.meta?.actorName||v.meta?.actorId||'미확인')}))
 ].sort((x,y)=>y.d-x.d).slice(0,150).map(v=>v.s);
}
async function handle(ctx){
 const raw=String(ctx.text||'').trim(),cmd=raw.split(/\s+/)[0];
 if(!ALL.has(cmd)||cmd==='!관리명령어'&&raw!=='!관리명령어')return false;
 const db=getPool(),room=String(ctx.roomId),user=String(ctx.userId),tail=raw.slice(cmd.length).trim();
 const send=ctx.send,botOwner=owner(user,ctx.isBotAccount);
 if(ctx.msg?.room?.isOpenChat===false){await send('❌ 오픈채팅방에서만 사용할 수 있습니다.');return true;}
 if(cmd==='!관리명령어'){
  await send(formatCommandHelp({manage:await enabled(db,room),game:false},'관리'));return true;
 }
 if(OWNER.has(cmd)&&!botOwner){await send('⛔ 봇 관리자만 사용할 수 있습니다.');return true;}
 if(cmd==='!관리on'||cmd==='!관리off'){
  const on=cmd==='!관리on';await setEnabled(db,room,on);
  await send(on?'🛡️ 관리 기능이 작동되었습니다.':'⏹️ 관리 기능이 중지되었습니다.');return true;
 }
 if(!await enabled(db,room)){await send('⏹️ 관리 기능 중지 · !관리on으로 작동할 수 있습니다.');return true;}
 if(cmd==='!멘션감지on'||cmd==='!멘션감지off'||cmd==='!멘션감지상태'){
  const notifier=require('./mention-notify');
  if(cmd==='!멘션감지상태'){
   await send('🔔 멘션 감지: '+(await notifier.isEnabled(db,room)?'ON':'OFF'));return true;
  }
  if(!botOwner&&![1,4].includes(Number(ctx.senderType))){
   await send('⛔ 멘션 감지 설정은 방장·부방장 또는 봇 관리자만 변경할 수 있습니다.');return true;
  }
  const on=cmd==='!멘션감지on';await notifier.setEnabled(db,room,on);
  await send(on?'🔔 멘션 감지 ON · 부재중 멘션 기록과 알림을 시작합니다.':'⏹️ 멘션 감지 OFF · 새 멘션을 기록하거나 알리지 않습니다.');return true;
 }
 if(cmd==='!id'){
  if(!ctx.isBotAccount&&![1,4].includes(Number(ctx.senderType))){await send('⛔ 방장·부방장·봇 계정만 사용할 수 있습니다.');return true;}
  const tagged=mentions(ctx.msg),ref=reference(ctx.msg);
  const hasTarget=tail||tagged.length||ref||Number(ctx.msg?.message?.type??ctx.msg?.type)===26;
  if(!hasTarget){
   if(!/^\d{4,}$/.test(user)){await send('❌ 사용자 ID를 확인할 수 없습니다.');return true;}
   await send('🆔 내 아이디: '+user);return true;
  }
  const target=tagged.length>1?null:await targetOf(db,room,ctx.msg,tail,ctx.client);
  if(!target){await send('❌ 대상을 확인할 수 없습니다. !id에 멘션·아이디를 지정하거나 대상 메시지에 답장해 주세요.');return true;}
  await send('🆔 '+(target.name&&target.name!==target.id?target.name+'님의 ':'')+'사용자 ID: '+target.id);return true;
 }
 if(STAFF.has(cmd)&&!await isStaff(db,room,user,ctx.senderType,botOwner)){
  await send('⛔ 방장·부방장 또는 지정 관리자만 사용할 수 있습니다.');return true;
 }
 if(cmd==='!공지예약'||cmd==='!공지목록'||cmd==='!공지삭제'){
  const notices=require('./scheduled-notices');
  try{
   if(cmd==='!공지예약'){
    const m=/^(\S+)\s+([\s\S]+)$/.exec(tail);
    if(!m){await send('사용법: !공지예약 HH:MM (내용)\n예: !공지예약 18:30 오늘 저녁 모임을 시작합니다.');return true;}
    if(ctx.msg?.room?.isOpenChat!==true){await send('❌ 실제 공지 예약은 오픈채팅방에서만 사용할 수 있습니다.');return true;}
    const transport=notices.noticeCapability(ctx.client,room,ctx.msg.room.openLinkId);
    const linkId=transport.experimental?
      require('../shared/event-board-api').getLinkId(ctx.client,room,ctx.msg.room.openLinkId):null;
    const record=await notices.schedule(db,{roomId:room,userId:user,time:m[1],content:m[2],linkId});
    await send('✅ 공지 예약 완료\n━━━━━━━━━━━━━━━━━━\n'+
      '예약 번호: '+record.noticeNo+'\n'+
      '전송 예정: '+notices.formatKST(record.scheduledAt)+' (한국시간)\n'+
      '내용: '+record.content+'\n'+
      '※ 1회 등록 · 실제 채팅방 공지 (일반 채팅 전송 아님)\n'+
      (transport.experimental?'⚠️ 공지 API는 시험용입니다. 지정 시각에 등록 성공 여부를 확인합니다.':'지정 시각에 실제 공지 등록 성공 여부를 확인합니다.'));
    return true;
   }
   if(cmd==='!공지목록'){
    if(tail){await send('사용법: !공지목록');return true;}
    const items=await notices.list(db,room);
    const entries=items.length?items:[];
    if(!entries.length){await send('📋 예약한 공지가 없습니다.');return true;}
    // Keep one notice per line group and respect Kakao message length limits.
    const rows=entries.map(r=>('#'+r.notice_no+' ┃ '+notices.formatKST(r.scheduled_at)+
      (r.state==='failed'?' · ⚠️ 공지 등록 실패·확인 필요':'')+'\n┃ '+
      String(r.content).replace(/\s+/g,' ').slice(0,100)+
      (r.content.length>100?'…':'')));
    await pages(send,'📋 예약 공지 목록 ('+entries.length+'개)\n!공지삭제 (번호)로 삭제',rows);
    return true;
   }
   if(cmd==='!공지삭제'){
    if(!/^\d+$/.test(tail)){await send('사용법: !공지삭제 (공지 번호)\n예: !공지삭제 1');return true;}
    const deleted=await notices.remove(db,room,tail);
    await send(deleted?'✅ '+tail+'번 예약 공지를 삭제했습니다.':'❌ 해당 번호의 대기 중인 공지가 없습니다. (!공지목록 확인)');
    return true;
   }
  }catch(error){
   if(error instanceof Error&&(
     /시간을 HH:MM|공지 내용|최대 2000자|최대 100개|사용자 ID|올바른 채팅방 ID|삭제할 공지 번호|실제 채팅방 공지|링크 ID|오픈채팅/.test(error.message))){
    await send('❌ '+error.message);
   }else{
    console.error('[SCHEDULED NOTICE COMMAND]',error);
    await send('❌ 공지 예약 처리 중 오류가 발생했습니다. Railway 로그를 확인해 주세요.');
   }
   return true;
  }
 }
 if(cmd==='!출석'||cmd==='!출석이미지'){
  let attendanceDate,completionMessage;
  if(cmd==='!출석'){
   // Commit once, then confirm photo upload before sending completion text.
   const result=await attend(room,user,ctx.userName||user,{detailed:true});
   if(!result.isNew){await send(result.message);return true;}
   attendanceDate=result.date;
   completionMessage=result.message;
  }
  try{
   await require('./attendance-image/automatic').sendAttendanceImage(ctx.client,{
   roomId:room,userId:user,send,attendanceDate,userName:ctx.userName||user,onDemand:cmd==='!출석이미지'
   });
  }catch(error){console.error('[ATTENDANCE IMAGE TASK]',error);}
  finally{if(completionMessage)await send(completionMessage);}
  return true;
 }
 if(cmd==='!출석순위'){
  const r=await db.query("SELECT user_name,attended_at FROM hz_new_attendance WHERE room_id=$1 AND attend_date=(NOW() AT TIME ZONE 'Asia/Seoul')::date ORDER BY attended_at,user_id",[room]);
  await pages(send,'🏆 오늘 출석 순위 ('+r.rows.length+'명)',r.rows.map((v,i)=>(i+1)+'. '+v.user_name+' · '+time(v.attended_at)));return true;
 }
 if(cmd==='!채팅순위'){
  await require('./chat-ranking-image/automatic').sendRankingImage(db,ctx);
  return true;
 }
 if(cmd==='!채팅순위전체'){
  for(const part of await chatRanks(db,room,true))await send(part);
  return true;
 }
 if(cmd==='!채팅정보'){
  const r=await db.query('SELECT user_name,count FROM gl_manage_chat_counts WHERE room_id=$1 AND user_id=$2',[room,user]);
  if(!r.rows[0]){await send('💬 채팅 기록이 없습니다.');return true;}
  const value=r.rows[0],rank=await db.query('SELECT COUNT(*)::bigint+1 AS rank FROM gl_manage_chat_counts WHERE room_id=$1 AND (count>$2::bigint OR (count=$2::bigint AND user_id<$3))',[room,value.count,user]);
  await send('💬 '+(value.user_name||user)+'님의 채팅 정보\n🏆 채팅 순위: '+(rank.rows[0]?.rank||'?')+'위\n💬 횟수: '+value.count+'회');return true;
 }
 if(cmd==='!관리자추가'||cmd==='!관리자삭제'){
  const t=await targetOf(db,room,ctx.msg,tail,ctx.client);
  if(!t){await send('사용법: '+cmd+' (멘션·아이디)');return true;}
  await db.query(cmd==='!관리자추가'?'INSERT INTO gl_manage_admins(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING':'DELETE FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2',[room,t.id]);
  await send('✅ 관리자 '+(cmd==='!관리자추가'?'추가':'삭제')+': '+t.id);return true;
 }
 if(cmd==='!도배감지on'){
  await db.query('INSERT INTO gl_manage_rooms(room_id,enabled,spam_enabled) VALUES($1,TRUE,TRUE) ON CONFLICT(room_id) DO UPDATE SET spam_enabled=TRUE',[room]);
  resetSpam(room);await send('🛡️ 도배 감지 ON · 5초 내 동일 채팅·이모티콘 4회 경고 / 10회 강퇴');return true;
 }
 if(cmd==='!프로필감지on'||cmd==='!프로필감지off'){
  const on=cmd==='!프로필감지on';
  await require('./profile-alerts').setEnabled(db,room,on);
  await send(on?'👤 프로필 변경 감지 ON':'⏹️ 프로필 변경 감지 OFF');return true;
 }
 if(cmd==='!삭제감지on'||cmd==='!삭제감지off'){
  const on=cmd==='!삭제감지on';
  await db.query('INSERT INTO gl_manage_rooms(room_id,enabled,deleted_enabled) VALUES($1,TRUE,$2) ON CONFLICT(room_id) DO UPDATE SET deleted_enabled=EXCLUDED.deleted_enabled',[room,on]);
  await send(on?'🗑️ 삭제 감지 ON':'⏹️ 삭제 감지 OFF');return true;
 }
 if(cmd==='!입장변경'||cmd==='!퇴장변경'){
  if(!tail||tail.length>2000){await send('사용법: '+cmd+' (내용 · 기본으로 초기화, 최대 2000자)');return true;}
  const field=cmd==='!입장변경'?'joinTemplate':'leaveTemplate';
  await db.query("INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object($2::text,$3::text)) ON CONFLICT(room_id) DO UPDATE SET data=jsonb_set(hz_rooms.data,ARRAY[$2::text],to_jsonb($3::text),true),updated_at=NOW()",[room,field,tail==='기본'?'':tail]);
  await send('✅ '+(cmd==='!입장변경'?'입장':'퇴장')+' 인사말 변경 완료');return true;
 }
 if(cmd==='!관리로그'||cmd==='!벤기록'){
  const t=cmd==='!벤기록'?await targetOf(db,room,ctx.msg,tail,ctx.client):null;
  if(cmd==='!벤기록'&&!t){await send('사용법: !벤기록 (멘션·아이디·답장)');return true;}
  await pages(send,cmd==='!관리로그'?'📜 관리 로그':'📜 '+t.id+' 내보내기 기록',await history(db,room,t?.id));return true;
 }
 if(cmd==='!입퇴장로그'){
  const t=await targetOf(db,room,ctx.msg,tail,ctx.client);
  if(!t){await send('사용법: !입퇴장로그 (멘션·아이디·답장)');return true;}
  const r=await db.query("SELECT event_type,created_at FROM hz_events WHERE room_id=$1 AND user_id=$2 AND event_type IN ('join','leave','kick') ORDER BY id DESC LIMIT 500",[room,t.id]);
  await pages(send,'🚪 '+t.id+' 입퇴장 내역',r.rows.map(x=>time(x.created_at)+' · '+(x.event_type==='join'?'입장':x.event_type==='leave'?'퇴장':'강퇴')));return true;
 }
 if(cmd==='!프로필로그'){
  const t=await targetOf(db,room,ctx.msg,tail,ctx.client);
  if(!t){await send('사용법: !프로필로그 (멘션·아이디·답장)');return true;}
  await send(await require('./profile-history').message(db,room,t));return true;
 }
 if(['!경고','!경고내역','!경고삭제','!경고초기화'].includes(cmd)){
  const m=cmd==='!경고'?/^([\s\S]*?)\s+(\d+)\s+([\s\S]+)$/.exec(tail):null;
  const replyOnly=cmd==='!경고'&&!m?/^(\d+)\s+([\s\S]+)$/.exec(tail):null;
  const del=cmd==='!경고삭제'?/^([\s\S]*?)\s+(\d+)$/.exec(tail):null;
  const delReply=cmd==='!경고삭제'&&!del?/^(\d+)$/.exec(tail):null;
  if(cmd==='!경고'&&!m&&!replyOnly){await send('사용법: !경고 (대상) (개수) (사유)');return true;}
  if(cmd==='!경고삭제'&&!del&&!delReply){await send('사용법: !경고삭제 (대상) (번호)');return true;}
  const t=await targetOf(db,room,ctx.msg,m?m[1]:del?del[1]:replyOnly||delReply?'':tail,ctx.client);
  if(!t){await send('❌ 대상은 실제 멘션·아이디·답장으로 지정해 주세요.');return true;}
  if(t.id===String(ctx.botId)||t.id===user){await send('⛔ 본인·봇에게 경고를 줄 수 없습니다.');return true;}
  if(cmd==='!경고'){
   const n=Number(m?m[2]:replyOnly[1]),reason=String(m?m[3]:replyOnly[2]).trim().slice(0,500);
   if(!Number.isSafeInteger(n)||n<1||n>100||!reason){await send('❌ 경고 수량은 1~100, 사유는 필수입니다.');return true;}
   const c=await db.connect();
   try{await c.query('BEGIN');
    for(let i=0;i<n;i++)await c.query('INSERT INTO gl_manage_warnings(room_id,user_id,user_name,reason,issuer_id) VALUES($1,$2,$3,$4,$5)',[room,t.id,t.name||t.id,reason,user]);
    await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
   const result=await db.query('SELECT COUNT(*)::int AS n FROM gl_manage_warnings WHERE room_id=$1 AND user_id=$2 AND NOT removed',[room,t.id]);
   const count=Number(result.rows[0]?.n||0);
   await send('⚠️ '+t.id+' 경고 '+n+'개 부여 · 누적 '+count+'개');
   if(count>=4&&goodTarget(t,user,ctx.botId)&&typeof ctx.kick==='function'){
    try{await ctx.kick(t.id);await action(db,room,user,t.id,'KICK','경고 누적 4회 강퇴');}
    catch(e){await send('⚠️ 경고 누적으로 강퇴 시도 실패: '+String(e.message||e));}
   }
   return true;
  }
  if(cmd==='!경고내역'||cmd==='!경고삭제'){
   const r=await db.query('SELECT id,reason,issuer_id,created_at FROM gl_manage_warnings WHERE room_id=$1 AND user_id=$2 AND NOT removed ORDER BY id',[room,t.id]);
   if(cmd==='!경고내역')await pages(send,'⚠️ '+t.id+' 경고 내역 ('+r.rows.length+'개)',r.rows.map((v,i)=>(i+1)+'. '+v.reason+' · '+time(v.created_at)));
   else{
    const seq=Number(del?del[2]:delReply[1]);
    if(!Number.isSafeInteger(seq)||seq<1||seq>r.rows.length){await send('❌ 경고 번호가 없습니다.');return true;}
    await db.query('UPDATE gl_manage_warnings SET removed=TRUE WHERE room_id=$1 AND user_id=$2 AND id=$3 AND NOT removed',[room,t.id,r.rows[seq-1].id]);
    await send('✅ '+t.id+'의 '+seq+'번 경고 삭제 완료');
   }
   return true;
  }
  await db.query('UPDATE gl_manage_warnings SET removed=TRUE WHERE room_id=$1 AND user_id=$2 AND NOT removed',[room,t.id]);
  await send('✅ '+t.id+' 경고 초기화 완료');return true;
 }
 if(['!kick','!k','!내풀','!벤해제'].includes(cmd)){
  const t=await targetOf(db,room,ctx.msg,tail,ctx.client,cmd!=='!벤해제');
  if(!t){await send('사용법: '+cmd+' (대상 ID·답장'+(cmd==='!벤해제'?'':'·멘션')+')');return true;}
  if(!goodTarget(t,user,ctx.botId)){await send('⛔ 올바른 대상이 아니거나 본인·봇입니다.');return true;}
  if(cmd==='!kick'||cmd==='!k'){
   if(typeof ctx.kick!=='function'){await send('❌ 강퇴 API가 없습니다.');return true;}
   await ctx.kick(t.id);await action(db,room,user,t.id,'KICK',cmd+' 강퇴');
   await send('🚫 강퇴 요청 완료: '+t.id);return true;
  }
  if(typeof ctx.unban!=='function'||cmd==='!내풀'&&typeof ctx.kick!=='function'){await send('❌ 벤 해제 API가 없습니다.');return true;}
  if(cmd==='!내풀'){
   await ctx.kick(t.id);
   try{await ctx.unban(t.id);}catch(e){await action(db,room,user,t.id,'KICK','!내풀 해제 실패');await send('⚠️ 강퇴 후 해제 실패: '+String(e.message||e));return true;}
   await action(db,room,user,t.id,'KICK_RELEASE','!내풀');
  }else{await ctx.unban(t.id);await action(db,room,user,t.id,'UNKICK','!벤해제');}
  await send('✅ '+t.id+' '+(cmd==='!내풀'?'강퇴 후 해제':'내보내기 해제')+' 완료');return true;
 }
 return false;
}
module.exports={handle,ALL,owner,isStaff,pages};
