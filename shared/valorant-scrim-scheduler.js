'use strict';
const {getPool}=require('./db');
const {choose,init}=require('./valorant-community');
const {marker}=require('./valorant-recruit-reply');
let timer=null,running=false;
async function tick(client,db=getPool()){
 if(running)return;
 running=true;
 try{
  await init(db);
  const due=await db.query(`SELECT room_id FROM hz_valorant_scrim_reservations
    WHERE starts_at<=NOW() AND started_at IS NULL
      AND (claimed_at IS NULL OR claimed_at<NOW()-INTERVAL '2 minutes')
    ORDER BY starts_at LIMIT 10`);
  for(const item of due.rows){
   const room=String(item.room_id);
   const claim=await db.query(`UPDATE hz_valorant_scrim_reservations
    SET claimed_at=NOW() WHERE room_id=$1 AND starts_at<=NOW() AND started_at IS NULL
    AND (claimed_at IS NULL OR claimed_at<NOW()-INTERVAL '2 minutes') RETURNING starts_at`,[room]);
   if(!claim.rowCount)continue;
   try{
    const enabled=await require('./bot-power').enabled(room,db);
    const valorant=await require('./valorant-settings').isEnabled(room);
    if(!enabled||!valorant){await db.query('UPDATE hz_valorant_scrim_reservations SET claimed_at=NULL WHERE room_id=$1 AND started_at IS NULL',[room]);continue;}
    const participants=await db.query('SELECT user_id,display_name,tier,rating FROM hz_valorant_scrim_players WHERE room_id=$1 ORDER BY joined_at,user_id',[room]);
    const players=participants.rows;
    if(players.length<2){
     await client.chat.sendText(room,'⚠️ NEXI | 예약 내전 시작 시간입니다.\n참가자가 2명 미만이어서 팀을 편성할 수 없습니다.');
     await db.query('UPDATE hz_valorant_scrim_reservations SET started_at=NOW() WHERE room_id=$1 AND started_at IS NULL',[room]);
     continue;
    }
    const pending=await db.query('SELECT id,team_a,team_b FROM hz_valorant_scrim_games WHERE room_id=$1 AND winner IS NULL ORDER BY id DESC LIMIT 1',[room]);
    let teams,prearranged=false;
    if(pending.rowCount){
     const game=pending.rows[0];
     const idsA=Array.isArray(game.team_a)?game.team_a:JSON.parse(game.team_a);
     const idsB=Array.isArray(game.team_b)?game.team_b:JSON.parse(game.team_b);
     const lookup=new Map(players.map(p=>[String(p.user_id),p]));
     const ids=[...idsA,...idsB].map(String);
     if(ids.length!==players.length||new Set(ids).size!==ids.length||ids.some(id=>!lookup.has(id))){
      await client.chat.sendText(room,'⚠️ NEXI | 예약 내전 시작 시간입니다.\n미리 편성된 팀과 현재 참가 명단이 달라 관리자 확인이 필요합니다.');
      await db.query('UPDATE hz_valorant_scrim_reservations SET started_at=NOW() WHERE room_id=$1 AND started_at IS NULL',[room]);
      continue;
     }
     teams={a:idsA.map(id=>lookup.get(String(id))),b:idsB.map(id=>lookup.get(String(id)))};
     prearranged=true;
    }else teams=choose(players);
    const format=group=>group.map((p,i)=>(i+1)+'. '+marker(client.chat,room,p.user_id,p.display_name)+' ('+p.tier+')').join('\n');
    const score=group=>group.reduce((sum,p)=>sum+Number(p.rating||0),0);
    const delta=Math.abs(score(teams.a)-score(teams.b));
    const message=['⚔️ NEXI | 내전 시작합니다!','━━━━━━━━━━━━━━━━',
      prearranged?'📌 미리 편성한 팀을 그대로 적용했습니다.':'🎲 참가자 티어 기준으로 팀을 자동 편성했습니다.',
      '🔴 공격팀 ('+teams.a.length+'명)',format(teams.a),'',
      '🔵 수비팀 ('+teams.b.length+'명)',format(teams.b),
      '━━━━━━━━━━━━━━━━','⚖️ 티어 점수 차이: '+delta,
      '📢 참가자분들은 각 팀을 확인해 주세요.'].join('\n');
    await client.chat.sendText(room,message);
    if(!prearranged){
     await db.query('INSERT INTO hz_valorant_scrim_games(room_id,team_a,team_b) VALUES($1,$2::jsonb,$3::jsonb)',
      [room,JSON.stringify(teams.a.map(p=>p.user_id)),JSON.stringify(teams.b.map(p=>p.user_id))]);
    }
    await db.query('UPDATE hz_valorant_scrim_reservations SET started_at=NOW() WHERE room_id=$1 AND started_at IS NULL',[room]);
    console.log('[SCRIM SCHEDULE] started',room,players.length);
   }catch(error){
    console.error('[SCRIM SCHEDULE] failed',room,String(error?.message||error));
    await db.query('UPDATE hz_valorant_scrim_reservations SET claimed_at=NULL WHERE room_id=$1 AND started_at IS NULL',[room]).catch(()=>{});
   }
  }
 }catch(error){console.error('[SCRIM SCHEDULE] poll failed',String(error?.message||error));}
 finally{running=false;}
}
function start(client){
 if(timer)return;
 timer=setInterval(()=>{void tick(client)},15000);
 timer.unref?.();
 void tick(client);
 console.log('[SCRIM SCHEDULE] automatic start enabled');
}
module.exports={start,tick};
