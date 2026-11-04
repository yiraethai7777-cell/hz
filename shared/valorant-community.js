'use strict';
const {getPool}=require('./db');
const {fold}=require('./valorant-more');
const COMMANDS=new Set(['!내전참가','!내전탈퇴','!내전참가자','!내전팀짜기','!내전밸런스','!내전결과','!내전순위','!내전초기화','!듀오모집','!듀오목록','!듀오신청','!듀오취소']);
let ready=null;
async function init(db){
 if(!ready)ready=(async()=>{
  await db.query(`CREATE TABLE IF NOT EXISTS hz_valorant_scrim_players (
   room_id TEXT NOT NULL,user_id TEXT NOT NULL,display_name TEXT NOT NULL,
   tier TEXT NOT NULL DEFAULT '미입력',rating INTEGER NOT NULL DEFAULT 0,
   joined_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(room_id,user_id))`);
  await db.query(`CREATE TABLE IF NOT EXISTS hz_valorant_scrim_games (
   id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,
   team_a JSONB NOT NULL,team_b JSONB NOT NULL,
   winner TEXT CHECK(winner IN ('A','B')),created_at TIMESTAMPTZ DEFAULT NOW(),
   finished_at TIMESTAMPTZ)`);
  await db.query(`CREATE TABLE IF NOT EXISTS hz_valorant_duo_posts (
   room_id TEXT NOT NULL,user_id TEXT NOT NULL,display_name TEXT NOT NULL,
   description TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   PRIMARY KEY(room_id,user_id))`);
  await db.query(`CREATE TABLE IF NOT EXISTS hz_valorant_duo_applications (
   room_id TEXT NOT NULL,owner_id TEXT NOT NULL,applicant_id TEXT NOT NULL,
   applicant_name TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),
   PRIMARY KEY(room_id,owner_id,applicant_id))`);
 })().catch(e=>{ready=null;throw e});
 await ready;
}
function rating(s){
 const v=String(s||'').toLowerCase().replace(/\s+/g,'');
 if(!v||v==='미입력')return {label:'미입력',value:0};
 const ranks=[['아이언',100],['브론즈',400],['실버',700],['골드',1000],['플래티넘',1300],['다이아몬드',1600],['초월자',1900],['불멸',2200],['레디언트',2500]];
 const found=ranks.find(([name])=>v.startsWith(name));
 if(!found)return null;
 const suffix=v.slice(found[0].length);
 if(suffix&&!/^[123]$/.test(suffix))return null;
 return {label:found[0]+(suffix||''),value:found[1]+(Number(suffix||1)-1)*100};
}
function choose(players){
 const n=players.length;if(n!==10)throw Error('내전 참가자는 정확히 10명이 필요합니다.');
 const total=players.reduce((s,p)=>s+p.rating,0);
 let best=Infinity,chosen=null,draws=0;
 for(let mask=1;mask<(1<<n);mask++){
  let count=0,sum=0;
  for(let i=0;i<n;i++)if(mask&(1<<i)){count++;sum+=players[i].rating;}
  if(count!==5)continue;
  const delta=Math.abs(2*sum-total);
  if(delta<best){best=delta;chosen=mask;draws=1;}
  else if(delta===best){draws++;if(Math.random()*draws<1)chosen=mask;}
 }
 return {a:players.filter((p,i)=>chosen&(1<<i)),b:players.filter((p,i)=>!(chosen&(1<<i))),delta:best};
}
function formatTeam(team){return team.map((p,i)=>(i+1)+'. '+p.display_name+' ('+p.tier+')').join('\n');}
async function isManager({roomId,userId,senderType,isBotAccount,isSuperAdmin,db}){
 if(isBotAccount||isSuperAdmin||[1,4].includes(Number(senderType)))return true;
 return require('./room-bot-admin').isRoomBotAdmin(roomId,userId,db);
}
async function handle({text,roomId,userId,userName,senderType,isBotAccount,isSuperAdmin=false,send,db=getPool()}){
 const cmd=String(text||'').trim().split(/\s+/)[0];if(!COMMANDS.has(cmd))return false;
 const tail=String(text).trim().slice(cmd.length).trim();
 const room=String(roomId||''),user=String(userId||'');
 if(!/^[1-9]\d+$/.test(room)||!/^[1-9]\d+$/.test(user)){await send('❌ 방 또는 사용자 ID를 확인할 수 없습니다.');return true;}
 const name=String(userName||'참가자').replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,35);
 try{
  await init(db);
  if(cmd==='!내전참가'){
   const tier=rating(tail);
   if(!tier){await send('사용법: !내전참가 (티어)\n예: !내전참가 골드2\n※ 티어는 직접 입력한 값입니다.');return true;}
   const cnt=await db.query('SELECT COUNT(*)::int AS n FROM hz_valorant_scrim_players WHERE room_id=$1',[room]);
   const exists=await db.query('SELECT 1 FROM hz_valorant_scrim_players WHERE room_id=$1 AND user_id=$2',[room,user]);
   if(!exists.rowCount&&cnt.rows[0].n>=10){await send('⛔ 현재 내전 정원 10명이 모두 찼습니다.');return true;}
   await db.query(`INSERT INTO hz_valorant_scrim_players(room_id,user_id,display_name,tier,rating)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(room_id,user_id) DO UPDATE
    SET display_name=$3,tier=$4,rating=$5`,[room,user,name,tier.label,tier.value]);
   await send('✅ '+name+' 님 내전 참가 완료 ('+tier.label+')\n!내전참가자에서 명단을 확인하세요.');return true;
  }
  if(cmd==='!내전탈퇴'){
   await db.query('DELETE FROM hz_valorant_scrim_players WHERE room_id=$1 AND user_id=$2',[room,user]);
   await send('✅ 내전 참가 명단에서 탈퇴했습니다.');return true;
  }
  if(cmd==='!내전참가자'||cmd==='!내전팀짜기'||cmd==='!내전밸런스'){
   const list=await db.query('SELECT user_id,display_name,tier,rating FROM hz_valorant_scrim_players WHERE room_id=$1 ORDER BY joined_at,user_id',[room]);
   const rows=list.rows;
   if(cmd==='!내전참가자'){await send(fold('🎮 NEXI | 내전 참가자 ('+rows.length+'/10)',rows.length?rows.map((p,i)=>(i+1)+'. '+p.display_name+' · '+p.tier).join('\n'):'참가자가 없습니다.\n!내전참가 (티어)로 참여하세요.'));return true;}
   if(rows.length!==10){await send('❌ 5대5 팀 편성에는 참가자 10명이 필요합니다. 현재 '+rows.length+'/10명');return true;}
   const pending=await db.query('SELECT id FROM hz_valorant_scrim_games WHERE room_id=$1 AND winner IS NULL ORDER BY id DESC LIMIT 1',[room]);
   if(pending.rowCount){await send('⛔ 진행 중인 내전이 있습니다. !내전결과 A 또는 B로 먼저 종료해 주세요.');return true;}
   const balanced=cmd==='!내전밸런스';
   const pairing=balanced?choose(rows):(()=>{
    const shuffled=[...rows];
    for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    return {a:shuffled.slice(0,5),b:shuffled.slice(5),delta:null};
   })();
   await db.query('INSERT INTO hz_valorant_scrim_games(room_id,team_a,team_b) VALUES($1,$2::jsonb,$3::jsonb)',
     [room,JSON.stringify(pairing.a.map(p=>p.user_id)),JSON.stringify(pairing.b.map(p=>p.user_id))]);
   await send(fold('⚔️ NEXI | 5대5 내전 팀 편성',
    '🔵 A팀\n'+formatTeam(pairing.a)+'\n━━━━━━━━━━━━━━\n🔴 B팀\n'+formatTeam(pairing.b)+
    (balanced?'\n※ 참가자가 입력한 티어 점수 기준으로 균형을 맞췄습니다.':'\n※ 무작위 팀 편성입니다.')+
    '\n경기 종료 후 관리자: !내전결과 A 또는 B'));return true;
  }
  if(cmd==='!내전결과'){
   if(!await isManager({roomId:room,userId:user,senderType,isBotAccount,isSuperAdmin,db})){await send('⛔ 내전 결과 등록은 관리자만 가능합니다.');return true;}
   if(!/^[AB]$/i.test(tail)){await send('사용법: !내전결과 A 또는 !내전결과 B');return true;}
   const r=await db.query(`UPDATE hz_valorant_scrim_games SET winner=$2,finished_at=NOW()
     WHERE id=(SELECT id FROM hz_valorant_scrim_games WHERE room_id=$1 AND winner IS NULL ORDER BY id DESC LIMIT 1)
     AND winner IS NULL RETURNING id`,[room,tail.toUpperCase()]);
   await send(r.rowCount?'✅ 내전 결과 등록: '+tail.toUpperCase()+'팀 승리':'❌ 진행 중인 내전이 없습니다.');return true;
  }
  if(cmd==='!내전순위'){
   const result=await db.query(`SELECT user_id,COUNT(*)::int AS games,
    COUNT(*) FILTER(WHERE (winner='A' AND side='A') OR (winner='B' AND side='B'))::int AS wins
    FROM (
      SELECT jsonb_array_elements_text(team_a) AS user_id,'A' AS side,winner
      FROM hz_valorant_scrim_games WHERE room_id=$1 AND winner IS NOT NULL
      UNION ALL
      SELECT jsonb_array_elements_text(team_b) AS user_id,'B' AS side,winner
      FROM hz_valorant_scrim_games WHERE room_id=$1 AND winner IS NOT NULL
    ) q GROUP BY user_id ORDER BY wins DESC,games DESC,user_id LIMIT 20`,[room]);
   const names=await db.query('SELECT user_id,display_name FROM hz_valorant_scrim_players WHERE room_id=$1',[room]);
   const lookup=new Map(names.rows.map(x=>[x.user_id,x.display_name]));
   await send(fold('🏆 NEXI | 방 내전 순위',result.rows.length?result.rows.map((p,i)=>
     (i+1)+'. '+(lookup.get(p.user_id)||'사용자 '+p.user_id)+' · '+p.wins+'승 / '+p.games+'경기 · '+(100*p.wins/p.games).toFixed(1)+'%').join('\n'):'완료된 내전 기록이 없습니다.'));return true;
  }
  if(cmd==='!내전초기화'){
   if(!await isManager({roomId:room,userId:user,senderType,isBotAccount,isSuperAdmin,db})){await send('⛔ 내전 명단 초기화는 관리자만 가능합니다.');return true;}
   await db.query('DELETE FROM hz_valorant_scrim_games WHERE room_id=$1 AND winner IS NULL',[room]);
   await db.query('DELETE FROM hz_valorant_scrim_players WHERE room_id=$1',[room]);
   await send('✅ 이번 내전 참가 명단을 초기화했습니다. 완료된 내전 순위는 유지됩니다.');return true;
  }
  if(cmd==='!듀오모집'){
   if(!tail||tail.length>100){await send('사용법: !듀오모집 (모집 내용, 100자 이하)\n예: !듀오모집 골드 경쟁전 마이크 가능');return true;}
   await db.query('DELETE FROM hz_valorant_duo_applications WHERE room_id=$1 AND owner_id=$2',[room,user]);
   await db.query(`INSERT INTO hz_valorant_duo_posts(room_id,user_id,display_name,description)
     VALUES($1,$2,$3,$4) ON CONFLICT(room_id,user_id)
     DO UPDATE SET display_name=$3,description=$4,created_at=NOW()`,[room,user,name,tail]);
   await send('✅ 듀오 모집 등록\n'+name+' · '+tail+'\n지원자는 !듀오신청 '+user+' 입력');return true;
  }
  if(cmd==='!듀오목록'){
   const r=await db.query("SELECT user_id,display_name,description FROM hz_valorant_duo_posts WHERE room_id=$1 AND created_at>NOW()-INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 15",[room]);
   await send(fold('👥 NEXI | 듀오 모집 목록',r.rowCount?r.rows.map((p,i)=>(i+1)+'. '+p.display_name+' · '+p.description+'\n   신청: !듀오신청 '+p.user_id).join('\n'):'진행 중인 듀오 모집이 없습니다.'));return true;
  }
  if(cmd==='!듀오신청'){
   if(!/^[1-9]\d+$/.test(tail)){await send('사용법: !듀오신청 (모집자 ID)\n!듀오목록에서 ID를 확인하세요.');return true;}
   if(tail===user){await send('❌ 본인 모집글에는 신청할 수 없습니다.');return true;}
   const owner=await db.query("SELECT 1 FROM hz_valorant_duo_posts WHERE room_id=$1 AND user_id=$2 AND created_at>NOW()-INTERVAL '24 hours'",[room,tail]);
   if(!owner.rowCount){await send('❌ 해당 모집글이 없거나 24시간이 지났습니다.');return true;}
   const existing=await db.query('INSERT INTO hz_valorant_duo_applications(room_id,owner_id,applicant_id,applicant_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[room,tail,user,name]);
   await send(existing.rowCount?'✅ 듀오 신청 완료\n신청자: '+name+'\n모집자 ID: '+tail:'이미 신청한 모집글입니다.');return true;
  }
  if(cmd==='!듀오취소'){
   await db.query('DELETE FROM hz_valorant_duo_posts WHERE room_id=$1 AND user_id=$2',[room,user]);
   await db.query('DELETE FROM hz_valorant_duo_applications WHERE room_id=$1 AND owner_id=$2',[room,user]);
   await send('✅ 듀오 모집글을 삭제했습니다.');return true;
  }
 }catch(e){console.error('[NEXI VALORANT COMMUNITY]',String(e?.message||e).slice(0,220));await send('❌ 내전·파티 기능 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.');return true;}
 return true;
}
module.exports={COMMANDS,handle,rating,choose};
