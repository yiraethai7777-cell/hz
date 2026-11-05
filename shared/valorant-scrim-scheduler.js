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
    const pending=await db.query('SELECT 1 FROM hz_valorant_scrim_games WHERE room_id=$1 AND winner IS NULL LIMIT 1',[room]);
    if(pending.rowCount){
     await client.chat.sendText(room,'⚠️ NEXI | 예약 내전 시작 시간입니다.\n이미 진행 중인 내전이 있어 자동 편성을 건너뜁니다.');
     await db.query('UPDATE hz_valorant_scrim_reservations SET started_at=NOW() WHERE room_id=$1 AND started_at IS NULL',[room]);
     continue;
    }
    const teams=choose(players);
    const format=group=>group.map((p,i)=>(i+1)+'. '+marker(client.chat,room,p.user_id,p.display_name)+' ('+p.tier+')').join('\n');
    const message=['⚔️ NEXI | 내전 시작합니다!','━━━━━━━━━━━━━━━━',
      '🔴 공격팀 ('+teams.a.length+'명)',format(teams.a),'',
      '🔵 수비팀 ('+teams.b.length+'명)',format(teams.b),
      '━━━━━━━━━━━━━━━━','⚖️ 티어 점수 차이: '+teams.delta,
      '📢 참가자분들은 각 팀을 확인해 주세요.'].join('\n');
    await client.chat.sendText(room,message);
    await db.query('INSERT INTO hz_valorant_scrim_games(room_id,team_a,team_b) VALUES($1,$2::jsonb,$3::jsonb)',
      [room,JSON.stringify(teams.a.map(p=>p.user_id)),JSON.stringify(teams.b.map(p=>p.user_id))]);
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
