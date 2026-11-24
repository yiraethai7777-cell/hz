'use strict';
const targets=require('./management-targets');
const management=require('./management');
const {BASE_ROOM_IDS}=require('./allowed-rooms');
const SHARED_ROOMS=BASE_ROOM_IDS.slice(0,2);
const eq=(a,b)=>String(a)===String(b);
const tidy=x=>String(x||'').normalize('NFC').trim();
const kst=v=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));
function tierScore(s){const ranks=['아이언','브론즈','실버','골드','플래티넘','다이아','초월자','불멸','레디언트'];const i=ranks.findIndex(x=>String(s).includes(x));return i<0?0:i*3+(Number(String(s).match(/[123]/)?.[0])||1)}
async function init(db){
 for(const sql of [
  'ALTER TABLE vs_scrims ADD COLUMN IF NOT EXISTS round_id BIGINT',
  "CREATE TABLE IF NOT EXISTS vs_scrim_rounds (id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,scheduled_at TIMESTAMPTZ NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  "CREATE INDEX IF NOT EXISTS vs_scrim_rounds_next ON vs_scrim_rounds(status,scheduled_at,id)",
  "CREATE TABLE IF NOT EXISTS vs_scrim_no_shows (id BIGSERIAL PRIMARY KEY,round_id BIGINT NOT NULL,room_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT NOT NULL,actor_id TEXT NOT NULL,riot_id TEXT NOT NULL DEFAULT '',warnings JSONB NOT NULL DEFAULT '[]'::jsonb,replacement_user_id TEXT,team_index INTEGER,team_slot INTEGER,was_on_team BOOLEAN NOT NULL DEFAULT FALSE,revoked BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(round_id,room_id,user_id))",
  "CREATE INDEX IF NOT EXISTS vs_scrim_no_shows_room ON vs_scrim_no_shows(room_id,id DESC)",
  "CREATE TABLE IF NOT EXISTS vs_scrim_no_show_blocks (no_show_id BIGINT NOT NULL REFERENCES vs_scrim_no_shows(id),subject_id TEXT NOT NULL,riot_id TEXT NOT NULL DEFAULT '',blocked_round_id BIGINT,PRIMARY KEY(no_show_id,subject_id))",
  "CREATE INDEX IF NOT EXISTS vs_scrim_no_show_blocks_round ON vs_scrim_no_show_blocks(blocked_round_id,subject_id)"
 ])await db.query(sql);
 await db.query("WITH missing AS (SELECT room_id,scheduled_at::timestamptz AS start_time FROM vs_scrims WHERE round_id IS NULL AND scheduled_at LIKE '____-__-__T%'), inserted AS (INSERT INTO vs_scrim_rounds(room_id,scheduled_at) SELECT room_id,start_time FROM missing RETURNING id,room_id) UPDATE vs_scrims s SET round_id=i.id FROM inserted i WHERE s.room_id=i.room_id AND s.round_id IS NULL");
}
async function assignRound(cx,room,when){
 const old=await cx.query('SELECT round_id FROM vs_scrims WHERE room_id=$1 FOR UPDATE',[room]);
 if(old.rows[0]?.round_id){
  await cx.query("UPDATE vs_scrim_rounds SET status='replaced' WHERE id=$1",[old.rows[0].round_id]);
  await cx.query('UPDATE vs_scrim_no_show_blocks SET blocked_round_id=NULL WHERE blocked_round_id=$1',[old.rows[0].round_id]);
 }
 const created=await cx.query('INSERT INTO vs_scrim_rounds(room_id,scheduled_at) VALUES($1,$2) RETURNING id',[room,when]);
 const round=created.rows[0].id;
 await cx.query("INSERT INTO vs_scrims(room_id,scheduled_at,state,round_id) VALUES($1,$2,'{}'::jsonb,$3) ON CONFLICT(room_id) DO UPDATE SET scheduled_at=$2,state='{}'::jsonb,round_id=$3",[room,new Date(when).toISOString(),round]);
 await cx.query("UPDATE vs_scrim_players SET status='registered' WHERE room_id=$1 AND status IN ('active','substitute')",[room]);
 await cx.query("UPDATE vs_scrim_no_show_blocks b SET blocked_round_id=(SELECT r.id FROM vs_scrim_rounds r JOIN vs_scrim_no_shows n ON n.id=b.no_show_id JOIN vs_scrim_rounds origin ON origin.id=n.round_id WHERE r.status='scheduled' AND r.scheduled_at>origin.scheduled_at AND (CASE WHEN n.room_id=ANY($1::text[]) THEN r.room_id=ANY($1::text[]) ELSE r.room_id=n.room_id END) ORDER BY r.scheduled_at,r.id LIMIT 1) WHERE b.blocked_round_id IS NULL AND EXISTS (SELECT 1 FROM vs_scrim_no_shows n WHERE n.id=b.no_show_id AND NOT n.revoked)",[SHARED_ROOMS]);
 return round;
}

async function evictBlocked(db,room,round){
 if(!round)return 0;
 const removed=await db.query("UPDATE vs_scrim_players p SET status='registered' WHERE p.room_id=$1 AND p.status IN ('active','substitute') AND EXISTS (SELECT 1 FROM vs_scrim_no_show_blocks b JOIN vs_scrim_no_shows n ON n.id=b.no_show_id WHERE NOT n.revoked AND (b.blocked_round_id=$2 OR n.round_id=$2) AND (b.subject_id=p.user_id OR (b.riot_id<>'' AND p.riot_id<>'' AND lower(b.riot_id)=lower(p.riot_id)))) RETURNING p.user_id",[room,round]);
 if(!removed.rowCount)return 0;
 const ids=new Set(removed.rows.map(x=>String(x.user_id)));
 const q=await db.query('SELECT state FROM vs_scrims WHERE room_id=$1 AND round_id=$2',[room,round]);
 const state=q.rows[0]?.state;
 if(Array.isArray(state?.teams)){
  state.teams=state.teams.map(team=>team.filter(x=>!ids.has(String(x.user_id))));
  state.scores=state.teams.map(team=>team.reduce((n,p)=>n+tierScore(p.tier),0));
  await db.query('UPDATE vs_scrims SET state=$3::jsonb WHERE room_id=$1 AND round_id=$2',[room,round,JSON.stringify(state)]);
 }
 return removed.rowCount;
}
async function blocked(db,round,user,riot=''){
 if(!round)return false;
 const q=await db.query("SELECT 1 FROM vs_scrim_no_show_blocks b JOIN vs_scrim_no_shows n ON n.id=b.no_show_id WHERE NOT n.revoked AND (b.blocked_round_id=$1 OR n.round_id=$1) AND (b.subject_id=$2 OR ($3<>'' AND lower(b.riot_id)=lower($3))) LIMIT 1",[round,String(user),String(riot||'')]);
 return q.rowCount>0;
}
async function admin(ctx){return (await management.role(ctx))>0||management.isOpenChatRoomManager(ctx)}
async function target(ctx,raw){
 const arg=String(raw||'').trim();
 if(!arg||(!targets.mentions(ctx.msg).length&&!targets.reference(ctx.msg)&&!/^(\d{4,})$/.test(arg)))return null;
 return targets.resolve({msg:ctx.msg,text:'#대상 '+arg,roomId:ctx.roomId,client:ctx.client,chat:ctx.chat,db:ctx.db});
}
async function matchRooms(cx,room,person){
 const rooms=SHARED_ROOMS.includes(room)?SHARED_ROOMS:[room];
 const q=await cx.query("SELECT room_id,user_id,name,riot_id FROM vs_scrim_players WHERE room_id=ANY($1::text[]) AND (user_id=$2 OR name=$3 OR ($4<>'' AND lower(riot_id)=lower($4))) UNION ALL SELECT room_id,user_id,name,'' AS riot_id FROM vs_chat_counts WHERE room_id=ANY($1::text[]) AND (user_id=$2 OR name=$3)",[rooms,String(person.user_id),tidy(person.name),person.riot_id||'']);
 const found=new Map();
 for(const p of q.rows){const key=p.room_id+':'+p.user_id;if(!found.has(key)||(!found.get(key).riot_id&&p.riot_id))found.set(key,p)}
 const matches=[{room_id:room,user_id:String(person.user_id),name:person.name,riot_id:person.riot_id}],ambiguous=[];
 for(const other of rooms.filter(x=>x!==room)){
  const rows=[...found.values()].filter(x=>eq(x.room_id,other));
  const byId=rows.filter(x=>eq(x.user_id,person.user_id));
  const byRiot=person.riot_id?rows.filter(x=>x.riot_id&&x.riot_id.toLowerCase()===person.riot_id.toLowerCase()):[];
  const byName=rows.filter(x=>tidy(x.name)===tidy(person.name)&&(!person.riot_id||!x.riot_id||x.riot_id.toLowerCase()===person.riot_id.toLowerCase()));
  const chosen=byId.length?byId:byRiot.length?byRiot:byName;
  if(chosen.length===1)matches.push(chosen[0]);
  else if(chosen.length>1)ambiguous.push(other);
 }
 return {matches,ambiguous};
}
function changedTeam(state,user,replacement){
 const next=state&&typeof state==='object'?JSON.parse(JSON.stringify(state)):{};
 const pos={team_index:null,team_slot:null,was_on_team:false};
 if(!Array.isArray(next.teams)||next.teams.length!==2)return {state:next,...pos};
 for(let i=0;i<2;i++){
  const at=next.teams[i].findIndex(p=>eq(p.user_id,user));
  if(at<0)continue;
  Object.assign(pos,{team_index:i,team_slot:at,was_on_team:true});
  if(replacement)next.teams[i][at]={user_id:replacement.user_id,name:replacement.name,tier:replacement.tier};
  else next.teams[i].splice(at,1);
  break;
 }
 if(!pos.was_on_team&&replacement){
  const i=next.teams[0].length<=next.teams[1].length?0:1;
  if(next.teams[i].length<5){
   Object.assign(pos,{team_index:i,team_slot:next.teams[i].length});
   next.teams[i].push({user_id:replacement.user_id,name:replacement.name,tier:replacement.tier});
  }
 }
 next.scores=next.teams.map(team=>team.reduce((n,p)=>n+tierScore(p.tier),0));
 return {state:next,...pos};
}
async function mark(ctx,raw){
 if(!await admin(ctx))return ctx.send('⛔ 관리 권한이 없습니다.');
 const person=await target(ctx,raw);
 if(!person?.id)return ctx.send('사용법: !불참 @대상 (실제 멘션 또는 사용자 ID)');
 const room=String(ctx.roomId),cx=await ctx.db.connect();let response;
 try{
  await cx.query('BEGIN');
  const r=await cx.query('SELECT round_id,state FROM vs_scrims WHERE room_id=$1 FOR UPDATE',[room]);
  const round=r.rows[0]?.round_id;
  if(!round)response='❌ 먼저 !내전예약으로 일정을 예약해 주세요.';
  else{
   const q=await cx.query('SELECT user_id,name,tier,riot_id,status FROM vs_scrim_players WHERE room_id=$1 AND user_id=$2 FOR UPDATE',[room,String(person.id)]);
   const player=q.rows[0];
   if(!player||player.status!=='active')response='❌ 이 사용자는 현재 내전의 정규 참가자가 아닙니다.';
   else if((await cx.query('SELECT id FROM vs_scrim_no_shows WHERE round_id=$1 AND room_id=$2 AND user_id=$3',[round,room,player.user_id])).rowCount)response='⚠️ 이미 이 회차에서 노쇼 처리된 참가자입니다.';
   else{
    const linked=await matchRooms(cx,room,player);
    const standby=await cx.query("SELECT user_id,name,tier,riot_id FROM vs_scrim_players WHERE room_id=$1 AND status='substitute' ORDER BY joined_at,user_id FOR UPDATE",[room]);
    let replacement=null;
    for(const candidate of standby.rows)if(!await blocked(cx,round,candidate.user_id,candidate.riot_id)){replacement=candidate;break}
    const team=changedTeam(r.rows[0].state,player.user_id,replacement);
    const upcoming=await cx.query("SELECT id FROM vs_scrim_rounds WHERE status='scheduled' AND id<>$1 AND room_id=ANY($2::text[]) AND scheduled_at>(SELECT scheduled_at FROM vs_scrim_rounds WHERE id=$1) ORDER BY scheduled_at,id LIMIT 1",[round,SHARED_ROOMS.includes(room)?SHARED_ROOMS:[room]]);
    const created=await cx.query('INSERT INTO vs_scrim_no_shows(round_id,room_id,user_id,name,riot_id,actor_id,replacement_user_id,team_index,team_slot,was_on_team) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',[round,room,player.user_id,player.name,player.riot_id,String(ctx.userId),replacement?.user_id||null,team.team_index,team.team_slot,team.was_on_team]);
    const id=created.rows[0].id,warnings=[],blockedSubjects=new Set();
    for(const match of linked.matches){
     const w=await cx.query("INSERT INTO gl_manage_warnings(room_id,user_id,user_name,reason,issuer_id) VALUES($1,$2,$3,'노쇼',$4) RETURNING id",[match.room_id,match.user_id,match.name||player.name,String(ctx.userId)]);
     warnings.push({id:w.rows[0].id,room_id:match.room_id,user_id:match.user_id});
     if(!blockedSubjects.has(String(match.user_id))){
      blockedSubjects.add(String(match.user_id));
      await cx.query('INSERT INTO vs_scrim_no_show_blocks(no_show_id,subject_id,riot_id,blocked_round_id) VALUES($1,$2,$3,$4)',[id,match.user_id,player.riot_id,upcoming.rows[0]?.id||null]);
     }
    }
    await cx.query('UPDATE vs_scrim_no_shows SET warnings=$2::jsonb WHERE id=$1',[id,JSON.stringify(warnings)]);
    await cx.query("UPDATE vs_scrim_players SET status='registered' WHERE room_id=$1 AND user_id=$2",[room,player.user_id]);
    if(replacement)await cx.query("UPDATE vs_scrim_players SET status='active' WHERE room_id=$1 AND user_id=$2",[room,replacement.user_id]);
    if(team.team_index!=null)await cx.query('UPDATE vs_scrims SET state=$2::jsonb WHERE room_id=$1',[room,JSON.stringify(team.state)]);
    await cx.query("INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,'SCRIM_NO_SHOW',$4)",[room,String(ctx.userId),player.user_id,'round '+round]);
    response='🚫 내전 불참 처리\n👤 대상: '+player.name+'\n⚠️ 경고: '+warnings.length+'개 방 / 사유: 노쇼\n⛔ 다음 내전 1회 참가 제한'+(linked.ambiguous.length?'\n⚠️ 동명이인 계정은 경고하지 않았습니다.':'')+(replacement?'\n🔄 후보 교체: '+replacement.name:'\n🪑 후보 없음 · 빈자리 유지');
   }
  }
  await cx.query('COMMIT');
 }catch(e){await cx.query('ROLLBACK').catch(()=>{});console.warn('[SCHOOL SCRIM NO SHOW]',String(e.message||e).slice(0,150));response='❌ 불참 처리에 실패했습니다.';}
 finally{cx.release()}
 return ctx.send(response);
}
async function cancel(ctx,raw){
 if(!await admin(ctx))return ctx.send('⛔ 관리 권한이 없습니다.');
 const person=await target(ctx,raw);
 if(!person?.id)return ctx.send('사용법: !불참취소 @대상 (실제 멘션 또는 사용자 ID)');
 const room=String(ctx.roomId),cx=await ctx.db.connect();let response;
 try{
  await cx.query('BEGIN');
  const current=await cx.query('SELECT round_id,state FROM vs_scrims WHERE room_id=$1 FOR UPDATE',[room]);
  const q=await cx.query('SELECT * FROM vs_scrim_no_shows WHERE room_id=$1 AND user_id=$2 AND NOT revoked ORDER BY id DESC LIMIT 1 FOR UPDATE',[room,String(person.id)]);
  const n=q.rows[0];
  if(!n)response='❌ 취소할 노쇼 기록이 없습니다.';
  else{
   for(const w of Array.isArray(n.warnings)?n.warnings:[])
    await cx.query('UPDATE gl_manage_warnings SET removed=TRUE WHERE room_id=$1 AND user_id=$2 AND id=$3',[w.room_id,w.user_id,w.id]);
   await cx.query('DELETE FROM vs_scrim_no_show_blocks WHERE no_show_id=$1',[n.id]);
   await cx.query('UPDATE vs_scrim_no_shows SET revoked=TRUE WHERE id=$1',[n.id]);
   if(eq(current.rows[0]?.round_id,n.round_id)){
    await cx.query("UPDATE vs_scrim_players SET status='active' WHERE room_id=$1 AND user_id=$2 AND status='registered'",[room,n.user_id]);
    if(n.replacement_user_id)await cx.query("UPDATE vs_scrim_players SET status='substitute' WHERE room_id=$1 AND user_id=$2 AND status='active'",[room,n.replacement_user_id]);
    const state=current.rows[0]?.state||{};
    if(Array.isArray(state.teams)&&n.team_index!=null&&Array.isArray(state.teams[n.team_index])){
     const team=state.teams[n.team_index];
     if(n.replacement_user_id){const at=team.findIndex(p=>eq(p.user_id,n.replacement_user_id));if(at>=0)team.splice(at,1)}
     if(n.was_on_team&&!team.some(p=>eq(p.user_id,n.user_id))){
      const old=await cx.query('SELECT name,tier FROM vs_scrim_players WHERE room_id=$1 AND user_id=$2',[room,n.user_id]);
      if(old.rows[0])team.splice(Math.min(Number(n.team_slot),team.length),0,{user_id:n.user_id,name:old.rows[0].name,tier:old.rows[0].tier});
     }
     state.scores=state.teams.map(t=>t.reduce((sum,p)=>sum+tierScore(p.tier),0));
     await cx.query('UPDATE vs_scrims SET state=$2::jsonb WHERE room_id=$1',[room,JSON.stringify(state)]);
    }
   }
   await cx.query("INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,'SCRIM_NO_SHOW_CANCEL',$4)",[room,String(ctx.userId),n.user_id,'round '+n.round_id]);
   response='✅ 노쇼 취소 완료\n👤 대상: '+n.name+'\n⚠️ 노쇼 경고 취소\n🔓 참가 제한 해제'+(eq(current.rows[0]?.round_id,n.round_id)?'\n🔄 후보 및 팀 원상복구':'');
  }
  await cx.query('COMMIT');
 }catch(e){await cx.query('ROLLBACK').catch(()=>{});console.warn('[SCHOOL SCRIM NO SHOW CANCEL]',String(e.message||e).slice(0,150));response='❌ 노쇼 취소에 실패했습니다.';}
 finally{cx.release()}
 return ctx.send(response);
}
async function history(ctx){
 if(!await admin(ctx))return ctx.send('⛔ 관리 권한이 없습니다.');
 const r=await ctx.db.query('SELECT n.name,n.revoked,r.scheduled_at,n.replacement_user_id FROM vs_scrim_no_shows n JOIN vs_scrim_rounds r ON r.id=n.round_id WHERE n.room_id=ANY($1::text[]) ORDER BY n.id DESC LIMIT 30',[SHARED_ROOMS.includes(String(ctx.roomId))?SHARED_ROOMS:[String(ctx.roomId)]]);
 return ctx.send('📋 내전 노쇼 내역\n'+(r.rows.map((x,i)=>(i+1)+'. '+x.name+' · '+kst(x.scheduled_at)+' (한국시간)'+(x.revoked?' [취소]':' [노쇼]')+(x.replacement_user_id?' · 후보 교체':'')).join('\n')||'기록 없음'));
}
module.exports={init,assignRound,blocked,evictBlocked,mark,cancel,history,kst,changedTeam,SHARED_ROOMS};
