'use strict';
const {command,tail,clean}=require('./core');
const {isAllowedRoom}=require('./allowed-rooms');
const featureControls=require('./feature-controls');
const noShow=require('./scrim-no-show');
const promo=require('./scrim-promo');
const management=require('./management');
const COMMANDS=new Set(['!내전예약','!내전등록','!내전참여','!내전탈퇴','!내전참가자','!내전팀짜기','!내전재편성','!내전선수교체','!내전밸런스','!내전결과','!내전초기화','!후보참여','!내전시간','!불참','!노쇼내역','!불참취소',...promo.COMMANDS]);
const tierScore=s=>{const ranks=['아이언','브론즈','실버','골드','플래티넘','다이아','초월자','불멸','레디언트'];const i=ranks.findIndex(x=>String(s).includes(x));return i<0?0:i*3+(Number(String(s).match(/[123]/)?.[0])||1)};
const pending=new Map(),TTL=300000;
function parseSchedule(raw){
 const m=/^(\d{4})[-./년 ]\s*(\d{1,2})[-./월 ]\s*(\d{1,2})[일 ]*\s+(\d{1,2}):(\d{2})$/.exec(raw.trim());
 if(!m)return null;
 const [y,mo,d,h,mi]=m.slice(1).map(Number);
 if(mo<1||mo>12||h>23||mi>59)return null;
 const iso=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:00+09:00`;
 const ms=Date.parse(iso);
 if(!Number.isFinite(ms)||new Date(ms+9*3600000).getUTCDate()!==d)return null;
 return new Date(ms);
}
function makeTeams(rows){
 const sorted=[...rows].sort((a,b)=>tierScore(b.tier)-tierScore(a.tier)),teams=[[],[]],scores=[0,0];
 for(const p of sorted){const ix=teams[0].length===teams[1].length?(scores[0]<=scores[1]?0:1):(teams[0].length<teams[1].length?0:1);teams[ix].push({user_id:p.user_id,name:p.name,tier:p.tier});scores[ix]+=tierScore(p.tier)}
 return {teams,scores,createdAt:new Date().toISOString()};
}
function teamText(state,prefix='🎯 내전 팀 편성'){const t=state?.teams||[[],[]],s=state?.scores||[0,0];return prefix+'\nA팀 ('+s[0]+'점)\n'+(t[0].map(p=>p.name+' · '+p.tier).join('\n')||'없음')+'\n\nB팀 ('+s[1]+'점)\n'+(t[1].map(p=>p.name+' · '+p.tier).join('\n')||'없음')}
async function handleReply(ctx){
 if(!ctx.replyToScrimRegistration||!['네','아니요'].includes(String(ctx.text||'').trim()))return false;
 const key=String(ctx.roomId)+':'+String(ctx.userId),p=pending.get(key);
 if(!p||p.expires<Date.now()){pending.delete(key);return false}
 const registration=await ctx.db.query('SELECT tier,discord,riot_id FROM vs_scrim_players WHERE room_id=$1 AND user_id=$2',[ctx.roomId,ctx.userId]);
 if(!registration.rowCount||registration.rows[0].tier!==p.tier||registration.rows[0].discord!==p.discord||registration.rows[0].riot_id!==p.riot){pending.delete(key);return false}
 pending.delete(key);
 if(ctx.text.trim()==='아니요')return ctx.send('✅ 내전 프로필만 저장했습니다. 내전에는 참여하지 않습니다.');
 const reservation=await ctx.db.query('SELECT scheduled_at,round_id FROM vs_scrims WHERE room_id=$1',[ctx.roomId]);
 if(!reservation.rowCount||!reservation.rows[0].scheduled_at||Date.parse(reservation.rows[0].scheduled_at)<=Date.now())return ctx.send('❌ 현재 참여 가능한 예약 내전이 없습니다.');
 if(await noShow.blocked(ctx.db,reservation.rows[0].round_id,ctx.userId,registration.rows[0].riot_id))return ctx.send('🚫 노쇼 제재로 다음 내전 1회는 참가할 수 없습니다.');
 await noShow.evictBlocked(ctx.db,String(ctx.roomId),reservation.rows[0].round_id);
 const roster=await ctx.db.query("SELECT COUNT(*)::int AS n FROM vs_scrim_players WHERE room_id=$1 AND status='active'",[ctx.roomId]);
 if(Number(roster.rows[0]?.n||0)>=10)return ctx.send('❌ 정규 참가자가 10명으로 마감되었습니다. 후보 등록은 !후보참여를 이용해 주세요.');
 await ctx.db.query("UPDATE vs_scrim_players SET status='active',name=$3,joined_at=NOW() WHERE room_id=$1 AND user_id=$2",[ctx.roomId,ctx.userId,clean(ctx.userName).slice(0,35)]);
 return ctx.send('✅ 예약된 내전 참가가 완료되었습니다.');
}
// Supports !내전등록 티어/공백이 포함된 디스코드닉/라이엇ID#태그
// while retaining legacy whitespace-delimited registrations.
function parseRegistration(raw){
 const input=clean(raw);
 if(!input||input.length>250)return null;
 let parts;
 if(input.includes('/')){
  const first=input.indexOf('/'),last=input.lastIndexOf('/');
  if(first===last)return null;
  parts=[input.slice(0,first).trim(),input.slice(first+1,last).trim(),input.slice(last+1).trim()];
 }else{
  const match=/^(\S+)\s+(\S+)\s+(\S+#\S+)$/.exec(input);
  if(!match)return null;
  parts=match.slice(1);
 }
 const [tier,discord,riot]=parts;
 if(!tier||!discord||!riot||tier.length>50||discord.length>100||riot.length>50)return null;
 if(tier.includes('#')||discord.includes('#'))return null;
 const riotMatch=/^([^#]+)#([^#]+)$/.exec(riot);
 if(!riotMatch||!riotMatch[1].trim()||!riotMatch[2].trim())return null;
 return {tier,discord,riot};
}

async function handle(ctx){
 const {text,roomId,userId,userName,db,send}=ctx,c=command(text),q=tail(text),room=String(roomId),user=String(userId),name=clean(userName).slice(0,35);
 if(!COMMANDS.has(c))return false;
 if(promo.COMMANDS.has(c))return promo.handle(ctx);
 if(c==='!내전등록'){
  const profile=parseRegistration(q);
  if(!profile)return send('사용법: !내전등록 (티어) (디스코드닉) (닉#태그)\n또는 !내전등록 (티어)/(공백 포함 디스코드닉)/(닉#태그)');
  const {tier,discord,riot}=profile;
  const existing=await db.query('SELECT status FROM vs_scrim_players WHERE room_id=$1 AND user_id=$2',[room,user]);
  await db.query("INSERT INTO vs_scrim_players(room_id,user_id,name,tier,discord,riot_id,status) VALUES($1,$2,$3,$4,$5,$6,'registered') ON CONFLICT(room_id,user_id) DO UPDATE SET name=$3,tier=$4,discord=$5,riot_id=$6",[room,user,name,tier,discord,riot]);
  const reservation=await db.query('SELECT scheduled_at FROM vs_scrims WHERE room_id=$1',[room]);
  const active=reservation.rowCount&&reservation.rows[0].scheduled_at&&Date.parse(reservation.rows[0].scheduled_at)>Date.now();
  if(!active)return send('✅ 등록을 완료하였습니다.\n티어: '+tier+'\n디스코드닉: '+discord+'\n발로란트닉: '+riot+'\n현재 예약된 내전이 없습니다.');
  pending.set(room+':'+user,{tier,discord,riot,expires:Date.now()+TTL});
  return send('✅ 등록을 완료하였습니다.\n티어: '+tier+'\n디스코드닉: '+discord+'\n발로란트닉: '+riot+'\n\n현재 예약된 내전에 참여하시겠습니까?\n(이 메시지에 답장으로 네/아니요 입력해주세요)');
 }
 if(c==='!내전시간'){
  const r=await db.query('SELECT scheduled_at,round_id FROM vs_scrims WHERE room_id=$1',[room]);
  if(!r.rowCount||!r.rows[0].scheduled_at)return send('📭 현재 예약된 내전이 없습니다.');
  await noShow.evictBlocked(db,room,r.rows[0].round_id);
  const counts=await db.query("SELECT COUNT(*) FILTER (WHERE status='active')::int AS active,COUNT(*) FILTER (WHERE status='substitute')::int AS standby FROM vs_scrim_players WHERE room_id=$1",[room]);
  const start=new Date(r.rows[0].scheduled_at),active=Number(counts.rows[0]?.active||0),standby=Number(counts.rows[0]?.standby||0);
  return send('📅 VALORANT SCHOOL | 내전 시간\n🕘 '+noShow.kst(start)+' (한국시간)\n👥 정규 참가: '+active+'/10명\n🪑 후보: '+standby+'명\n📌 상태: '+(start.getTime()<=Date.now()?'시작 시간 경과':active>=10?'정규 참가 마감':'참가 접수 중'));
 }
 if(c==='!불참')return noShow.mark(ctx,q);
 if(c==='!불참취소')return noShow.cancel(ctx,q);
 if(c==='!노쇼내역')return noShow.history(ctx);
 if(c==='!내전예약'){
  const date=parseSchedule(q);if(!date||date.getTime()<=Date.now())return send('사용법: !내전예약 2026-11-21 20:00 (한국시간, 미래 날짜)');
  const existing=await db.query('SELECT scheduled_at FROM vs_scrims WHERE room_id=$1',[room]);
  if(existing.rows[0]?.scheduled_at&&new Date(existing.rows[0].scheduled_at).getTime()===date.getTime())
   return send('📅 이미 같은 시간에 예약된 내전입니다. 기존 참가자 정보는 유지됩니다.');
  const cx=await db.connect();
  try{
   await cx.query('BEGIN');
   await noShow.assignRound(cx,room,date);
   await cx.query('COMMIT');
  }catch(e){await cx.query('ROLLBACK').catch(()=>{});throw e}finally{cx.release()}
  return send('📅 내전 예약 완료: '+q+' (한국시간)\n새 회차를 시작하여 기존 내전의 정규 참가·후보 상태를 초기화했습니다.\n등록된 티어·디스코드·라이엇 ID 정보는 유지됩니다.');
 }
 if(c==='!내전참여'||c==='!후보참여'){
  const state=c==='!후보참여'?'substitute':'active';
  const reservation=await db.query('SELECT scheduled_at,round_id FROM vs_scrims WHERE room_id=$1',[room]);
  if(!reservation.rows[0]?.scheduled_at||Date.parse(reservation.rows[0].scheduled_at)<=Date.now())
   return send('❌ 참가할 수 있는 예약 내전이 없습니다. !내전시간을 확인해 주세요.');
  const profile=await db.query('SELECT status,riot_id FROM vs_scrim_players WHERE room_id=$1 AND user_id=$2',[room,user]);
  if(!profile.rowCount)return send('❌ 먼저 !내전등록으로 프로필을 등록해 주세요.');
  if(await noShow.blocked(db,reservation.rows[0].round_id,user,profile.rows[0].riot_id))
   return send('🚫 노쇼 제재로 다음 내전 1회는 정규 참가와 후보 참가가 모두 제한됩니다.');
  await noShow.evictBlocked(db,room,reservation.rows[0].round_id);
  if(state==='active'&&profile.rows[0].status!=='active'){
   const roster=await db.query("SELECT COUNT(*)::int AS n FROM vs_scrim_players WHERE room_id=$1 AND status='active'",[room]);
   if(Number(roster.rows[0]?.n||0)>=10)return send('❌ 정규 참가자가 10명으로 마감되었습니다. 후보 등록은 !후보참여를 이용해 주세요.');
  }
  const r=await db.query('UPDATE vs_scrim_players SET status=$3,name=$4,joined_at=NOW() WHERE room_id=$1 AND user_id=$2 RETURNING user_id',[room,user,state,name]);
  return send(state==='active'?'✅ 내전 참가 완료':'✅ 내전 후보 등록 완료 · 정규 참가자가 빠지면 등록 순서대로 교체됩니다.');
 }
 if(c==='!내전탈퇴'){const r=await db.query("UPDATE vs_scrim_players SET status='registered' WHERE room_id=$1 AND user_id=$2 RETURNING user_id",[room,user]);return send(r.rowCount?'✅ 내전에서 탈퇴했습니다.':'❌ 등록된 프로필이 없습니다.')}
 if(c==='!내전참가자'){
  const scheduled=await db.query('SELECT round_id FROM vs_scrims WHERE room_id=$1',[room]);
  if(scheduled.rows[0]?.round_id)await noShow.evictBlocked(db,room,scheduled.rows[0].round_id);
  const r=await db.query("SELECT name,tier,riot_id,status FROM vs_scrim_players WHERE room_id=$1 AND status IN ('active','substitute') ORDER BY joined_at LIMIT 50",[room]);return send('🎯 내전 참가자\n'+(r.rows.map((x,i)=>(i+1)+'. '+x.name+' · '+x.tier+' · '+x.riot_id+(x.status==='substitute'?' [후보]':'')).join('\n')||'참가자가 없습니다.'))}
 if(c==='!내전팀짜기'||c==='!내전재편성'||c==='!내전밸런스'){
  // Only the bot, superadmins, registered admins, and verified OpenChat room managers can change teams.
  if(!management.isOpenChatRoomManager(ctx)&&(await management.role(ctx))<1)
   return send('⛔ 관리자만 사용할 수 있는 내전 명령어입니다.');
  let reservation=await db.query('SELECT scheduled_at,state,round_id FROM vs_scrims WHERE room_id=$1',[room]);
  if(!reservation.rowCount||!reservation.rows[0].scheduled_at)return send('❌ 먼저 !내전예약으로 일정을 예약해 주세요.');
  if(await noShow.evictBlocked(db,room,reservation.rows[0].round_id))reservation=await db.query('SELECT scheduled_at,state,round_id FROM vs_scrims WHERE room_id=$1',[room]);
  const existing=reservation.rows[0].state||{};
  if(existing.teams&&c!=='!내전재편성')return send(teamText(existing,'🎯 저장된 내전 팀 편성'));
  if(Date.parse(reservation.rows[0].scheduled_at)<=Date.now())return send(existing.teams?teamText(existing,'🎯 확정된 내전 팀 편성'):'❌ 예약 시간이 지난 내전입니다.');
  const players=await db.query("SELECT user_id,name,tier FROM vs_scrim_players WHERE room_id=$1 AND status='active' ORDER BY joined_at LIMIT 10",[room]);
  if(players.rows.length<2)return send('❌ 최소 2명의 내전 참가자가 필요합니다.');
  const state=makeTeams(players.rows);
  await db.query('UPDATE vs_scrims SET state=$2::jsonb WHERE room_id=$1',[room,JSON.stringify(state)]);
  return send(teamText(state,'🎯 내전 팀 편성 저장 완료'));
 }
 if(c==='!내전초기화'){await db.query('DELETE FROM vs_scrim_players WHERE room_id=$1',[room]);await db.query("UPDATE vs_scrims SET state='{}'::jsonb WHERE room_id=$1",[room]);return send('✅ 이 방의 내전 참가 및 팀 편성을 초기화했습니다.')}
 if(c==='!내전선수교체'||c==='!내전결과')return send('⚠️ 해당 기능은 아직 구현되지 않았습니다.');
 return false;
}
async function processDue(db,sendByRoom){
 const r=await db.query("SELECT room_id,scheduled_at,state,round_id FROM vs_scrims WHERE scheduled_at IS NOT NULL AND scheduled_at<>'' AND scheduled_at ~ '^\\d{4}-\\d{2}-\\d{2}T' AND CASE WHEN scheduled_at ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN scheduled_at::timestamptz<=NOW() ELSE FALSE END AND NOT(state ? 'teams') LIMIT 100");
 for(const row of r.rows){
  if(!isAllowedRoom(row.room_id))continue;
  if(!featureControls.isEnabled(await featureControls.load(db,row.room_id),'autoScrim'))continue;
  try{
   await noShow.evictBlocked(db,row.room_id,row.round_id);
   const players=await db.query("SELECT user_id,name,tier FROM vs_scrim_players WHERE room_id=$1 AND status='active' ORDER BY joined_at LIMIT 10",[row.room_id]);
   if(players.rows.length<2)continue;
   const state=makeTeams(players.rows);
   const updated=await db.query("UPDATE vs_scrims SET state=$2::jsonb WHERE room_id=$1 AND NOT(state ? 'teams') RETURNING room_id",[row.room_id,JSON.stringify(state)]);
   if(updated.rowCount){const send=sendByRoom.get(String(row.room_id));if(send)await send(teamText(state,'⏰ 예약 시간이 되어 자동으로 팀을 편성했습니다.'))}
  }catch(e){console.error('[SCRIM AUTO TEAM]',row.room_id,e)}
 }
}
module.exports={COMMANDS,handle,handleReply,processDue,parseSchedule,makeTeams,tierScore,parseRegistration};
