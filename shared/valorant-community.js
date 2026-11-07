'use strict';
const {getPool}=require('./db');
const {fold}=require('./valorant-more');
const {mentions,reference}=require('../manage/targets');
const recruit=require('./valorant-recruit-reply');
const COMMANDS=new Set(['!티어등록','!내전등록','!내전예약','!내전참여','!내전참가','!내전탈퇴','!내전참가자','!내전팀짜기','!내전재편성','!내전선수교체','!내전밸런스','!내전결과','!내전순위','!내전초기화','!듀오모집','!듀오목록','!듀오신청','!듀오취소']);
let ready=null;
const pendingCorrections=new Map();
const pendingScrimJoins=new Map();
function profileParts(tail){
 const input=String(tail||'').trim();
 if(input.includes('/')){const parts=input.split('/').map(x=>x.trim());return parts.length===3?parts:null;}
 const match=input.match(/^(\S+)\s+(\S+)\s+(.+#[^#\s]+)$/);
 return match?[match[1],match[2],match[3].trim()]:input.split(/\s+/).filter(Boolean);
}
function tierSuggestion(value){
 const s=String(value||'').replace(/\s+/g,'').toLowerCase();
 const known=['아이언','브론즈','실버','골드','플래티넘','다이아몬드','초월자','불멸','레디언트','플레','다이아','초월','레디'];
 const distance=(a,b)=>{const d=Array.from({length:a.length+1},(_,i)=>i);for(let j=1;j<=b.length;j++){let prev=d[0];d[0]=j;for(let i=1;i<=a.length;i++){const old=d[i];d[i]=Math.min(d[i]+1,d[i-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old;}}return d[a.length];};
 const suffix=/[123]$/.test(s)?s.slice(-1):'';
 const base=suffix?s.slice(0,-1):s;
 const options=known.map(k=>({k,d:distance(base,k)})).sort((a,b)=>a.d-b.d);
 if(!options.length||options[0].d>1||options[1]?.d===options[0].d)return null;
 return rating(options[0].k+suffix);
}

async function init(db){
 if(!ready)ready=(async()=>{
  await db.query(`CREATE TABLE IF NOT EXISTS hz_valorant_tier_profiles (
   user_id TEXT PRIMARY KEY,tier TEXT NOT NULL,rating INTEGER NOT NULL,
   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await db.query(`CREATE TABLE IF NOT EXISTS hz_valorant_scrim_profiles (
   user_id TEXT PRIMARY KEY,tier TEXT NOT NULL,rating INTEGER NOT NULL,
   discord_name TEXT NOT NULL,riot_id TEXT NOT NULL,updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await db.query(`CREATE TABLE IF NOT EXISTS hz_valorant_scrim_reservations (
   room_id TEXT PRIMARY KEY,starts_at TIMESTAMPTZ NOT NULL,
   created_by TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),
   started_at TIMESTAMPTZ,claimed_at TIMESTAMPTZ)`);
  await db.query('ALTER TABLE hz_valorant_scrim_reservations ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ');
  await db.query('ALTER TABLE hz_valorant_scrim_reservations ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ');
  await db.query(`CREATE TABLE IF NOT EXISTS hz_valorant_scrim_players (
   room_id TEXT NOT NULL,user_id TEXT NOT NULL,display_name TEXT NOT NULL,
   tier TEXT NOT NULL DEFAULT '미입력',rating INTEGER NOT NULL DEFAULT 0,
   joined_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(room_id,user_id))`);
  await db.query("ALTER TABLE hz_valorant_scrim_players ADD COLUMN IF NOT EXISTS discord_name TEXT NOT NULL DEFAULT ''");
  await db.query("ALTER TABLE hz_valorant_scrim_players ADD COLUMN IF NOT EXISTS riot_id TEXT NOT NULL DEFAULT ''");
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
 let v=String(s||'').toLowerCase().replace(/\s+/g,'');
 const aliases=[['플레','플래티넘'],['플렛','플래티넘'],['플랫','플래티넘'],['다야','다이아몬드'],['다이아','다이아몬드'],['초월','초월자'],['레디','레디언트'],['브론','브론즈'],['실','실버'],['골','골드'],['아연','아이언']];
 for(const [short,full] of aliases){if(v===short||(v.startsWith(short)&&/^[123]$/.test(v.slice(short.length)))){v=full+v.slice(short.length);break;}}
 if(!v||v==='미입력')return {label:'미입력',value:0};
 const ranks=[['아이언',100],['브론즈',400],['실버',700],['골드',1000],['플래티넘',1300],['다이아몬드',1600],['초월자',1900],['불멸',2200],['레디언트',2500]];
 const found=ranks.find(([name])=>v.startsWith(name));
 if(!found)return null;
 const suffix=v.slice(found[0].length);
 if(suffix&&!/^[123]$/.test(suffix))return null;
 return {label:found[0]+(suffix||''),value:found[1]+(Number(suffix||1)-1)*100};
}
function choose(players){
 const n=players.length;if(n<2||n>10)throw Error('내전 참가자는 2~10명이 필요합니다.');
 const total=players.reduce((s,p)=>s+p.rating,0);
 let best=Infinity,chosen=null,draws=0;
 for(let mask=1;mask<(1<<n);mask++){
  let count=0,sum=0;
  for(let i=0;i<n;i++)if(mask&(1<<i)){count++;sum+=players[i].rating;}
  if(count!==Math.floor(n/2))continue;
  const delta=Math.abs(2*sum-total);
  if(delta<best){best=delta;chosen=mask;draws=1;}
  else if(delta===best){draws++;if(Math.random()*draws<1)chosen=mask;}
 }
 return {a:players.filter((p,i)=>chosen&(1<<i)),b:players.filter((p,i)=>!(chosen&(1<<i))),delta:best};
}
function chooseDifferent(players,previousA){
 const old=new Set(previousA.map(String));
 const n=players.length,total=players.reduce((sum,p)=>sum+p.rating,0);
 let best=Infinity,maskBest=0,ties=0;
 for(let mask=1;mask<(1<<n);mask++){
  let count=0,sum=0,equal=true,complement=true;
  for(let i=0;i<n;i++){
   const yes=!!(mask&(1<<i));if(yes){count++;sum+=players[i].rating;}
   if(yes!==old.has(String(players[i].user_id)))equal=false;
   if(yes===old.has(String(players[i].user_id)))complement=false;
  }
  if(count!==Math.floor(n/2)||equal||complement)continue;
  const delta=Math.abs(2*sum-total);
  if(delta<best){best=delta;maskBest=mask;ties=1;}
  else if(delta===best){ties++;if(Math.random()*ties<1)maskBest=mask;}
 }
 if(!maskBest)return null;
 return {a:players.filter((p,i)=>maskBest&(1<<i)),
   b:players.filter((p,i)=>!(maskBest&(1<<i))),delta:best};
}
function formatTeam(team){return team.map((p,i)=>(i+1)+'. '+p.display_name+' ('+p.tier+')').join('\n');}
function yMd(date){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);}
function sideName(s){return s==='A'?'공격':'수비';}
async function isManager({roomId,userId,senderType,isBotAccount,isSuperAdmin,db}){
 if(isBotAccount||isSuperAdmin||[1,4].includes(Number(senderType)))return true;
 return require('./room-bot-admin').isRoomBotAdmin(roomId,userId,db);
}
async function handle({text,msg,client,chat,roomId,userId,userName,senderType,isBotAccount,isSuperAdmin=false,send,db=getPool()}){
 const cmd=String(text||'').trim().split(/\s+/)[0];if(!COMMANDS.has(cmd))return false;
 const tail=String(text).trim().slice(cmd.length).trim();
 const room=String(roomId||''),user=String(userId||'');
 if(!/^[1-9]\d+$/.test(room)||!/^[1-9]\d+$/.test(user)){await send('❌ 방 또는 사용자 ID를 확인할 수 없습니다.');return true;}
 const name=String(userName||'참가자').replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,35);
 try{
  await init(db);
  if(cmd==='!티어등록'){
   if(!tail){await send('사용법: !티어등록 (티어)\n예: !티어등록 골드2');return true;}
   const tier=rating(tail);
   if(!tier||tier.label==='미입력'){await send('❌ 유효한 티어를 입력해 주세요.\n예: 아이언1, 브론즈2, 실버3, 골드2, 플래티넘1, 다이아몬드3, 초월자1, 불멸2, 레디언트');return true;}
   await db.query(`INSERT INTO hz_valorant_tier_profiles(user_id,tier,rating) VALUES($1,$2,$3)
     ON CONFLICT(user_id) DO UPDATE SET tier=$2,rating=$3,updated_at=NOW()`,[user,tier.label,tier.value]);
   await db.query('UPDATE hz_valorant_scrim_players SET tier=$2,rating=$3 WHERE user_id=$1',[user,tier.label,tier.value]);
   await send('✅ '+name+'님의 내전 밸런스 티어가 '+tier.label+'(으)로 등록되었습니다.\n※ 실제 발로란트 계정 티어 인증이 아닌 직접 등록 정보입니다.');
   return true;
  }
  if(cmd==='!내전등록'||cmd==='!내전참여'||cmd==='!내전참가'){
   const parts=profileParts(tail);
   const explicit=parts.length>0;
   let profile=null;
   if(explicit){
    if(parts.length!==3){await send('사용법: '+cmd+' (티어) (디스코드닉) (발로란트 이름#태그)\n예: '+cmd+' 골드2 discord_name Player#KR1');return true;}
    const tier=rating(parts[0]);
    if(!tier){
     const suggested=tierSuggestion(parts[0]);
     if(suggested&&parts[1].length<=80&&parts[2].length<=80&&parts[2].includes('#')&&parts[2].split('#').length===2&&parts[2].split('#').every(Boolean)){
      pendingCorrections.set(room+':'+user,{command:cmd,tier:suggested,discord:parts[1],riot:parts[2],expires:Date.now()+120000});
      await send('❓ '+parts[0]+' → '+suggested.label+'로 입력하신 게 맞나요?\n이 메시지에 답장으로 네 또는 아니요를 입력해 주세요.');
      return true;
     }
    }
    if(!tier||tier.label==='미입력'||parts[1].length>80||parts[2].length>80||!/^[^#\s]+(?: [^#\s]+)*#[^#\s]+$/.test(parts[2])){
     await send('❌ 티어, 디스코드 닉네임 또는 발로란트 이름#태그 형식이 올바르지 않습니다.');return true;
    }
    profile={tier:tier.label,rating:tier.value,discord_name:parts[1],riot_id:parts[2]};
    await db.query(`INSERT INTO hz_valorant_scrim_profiles(user_id,tier,rating,discord_name,riot_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET
      tier=$2,rating=$3,discord_name=$4,riot_id=$5,updated_at=NOW()`,
      [user,profile.tier,profile.rating,profile.discord_name,profile.riot_id]);
    await db.query(`INSERT INTO hz_valorant_tier_profiles(user_id,tier,rating) VALUES($1,$2,$3)
      ON CONFLICT(user_id) DO UPDATE SET tier=$2,rating=$3,updated_at=NOW()`,[user,profile.tier,profile.rating]);
   }
   if(cmd==='!내전등록'){
    if(!explicit){await send('사용법: !내전등록 (티어) (디스코드닉) (발로란트 이름#태그)');return true;}
    const reservation=await db.query('SELECT starts_at,started_at FROM hz_valorant_scrim_reservations WHERE room_id=$1',[room]);
    const scheduled=reservation.rows[0];
    const active=scheduled&&scheduled.starts_at&&new Date(scheduled.starts_at).getTime()>Date.now()&&!scheduled.started_at;
    if(active)pendingScrimJoins.set(room+':'+user,{expires:Date.now()+300000,riot:profile.riot_id,tier:profile.tier,discord:profile.discord_name});
    else pendingScrimJoins.delete(room+':'+user);
    await send('✅ 내전 프로필 저장 완료\n티어: '+profile.tier+'\n디스코드: '+profile.discord_name+'\n발로란트: '+profile.riot_id+(active?'\n\n📅 예약된 내전이 있습니다. 참가하시겠습니까?\n이 메시지에 답장으로 네/아니요를 입력해 주세요.':'\n현재 참가 가능한 예약 내전이 없습니다.'));
    return true;
   }
   if(!profile){
    const saved=await db.query('SELECT tier,rating,discord_name,riot_id FROM hz_valorant_scrim_profiles WHERE user_id=$1',[user]);
    if(!saved.rowCount){await send('❌ 등록된 내전 프로필이 없습니다.\n!내전등록 (티어) (디스코드닉) (이름#태그) 또는 !내전참여 (티어) (디스코드닉) (이름#태그)를 입력해 주세요.');return true;}
    profile=saved.rows[0];
   }
   const reservation=await db.query('SELECT starts_at FROM hz_valorant_scrim_reservations WHERE room_id=$1',[room]);
   if(!reservation.rowCount){await send('❌ 예약된 내전이 없습니다. 먼저 !내전예약 (월)월 (일)일 (시)시 (분)분을 입력해 주세요.');return true;}
   const cnt=await db.query('SELECT COUNT(*)::int AS n FROM hz_valorant_scrim_players WHERE room_id=$1',[room]);
   const exists=await db.query('SELECT 1 FROM hz_valorant_scrim_players WHERE room_id=$1 AND user_id=$2',[room,user]);
   if(!exists.rowCount&&cnt.rows[0].n>=10){await send('⛔ 내전 정원 10명이 모두 찼습니다.');return true;}
   await db.query(`INSERT INTO hz_valorant_scrim_players(room_id,user_id,display_name,tier,rating,discord_name,riot_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(room_id,user_id) DO UPDATE SET
    display_name=$3,tier=$4,rating=$5,discord_name=$6,riot_id=$7`,
    [room,user,name,profile.tier,profile.rating,profile.discord_name,profile.riot_id]);
   await send('✅ '+name+'님 예약 내전 참가 완료 ('+(Number(cnt.rows[0].n)+(exists.rowCount?0:1))+'/10)\n티어: '+profile.tier+'\n디스코드: '+profile.discord_name+'\n발로란트: '+profile.riot_id);
   return true;
  }
  if(cmd==='!내전예약'){
   if(!await isManager({roomId:room,userId:user,senderType,isBotAccount,isSuperAdmin,db})){await send('⛔ 내전 예약은 관리자만 가능합니다.');return true;}
   const match=tail.match(/^(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분$/);
   if(!match){await send('사용법: !내전예약 11월 6일 20시 30분\n※ 한국시간(KST) 기준입니다.');return true;}
   const [,mo,day,hour,minute]=match.map(Number);
   const now=new Date(),year=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric'}).format(now));
   let start=null;
   for(const y of [year,year+1]){
    const candidate=new Date(Date.UTC(y,mo-1,day,hour-9,minute));
    const valid=mo>=1&&mo<=12&&day>=1&&day<=31&&hour>=0&&hour<=23&&minute>=0&&minute<=59&&
      candidate.getUTCFullYear()===y&&candidate.getUTCMonth()===mo-1&&candidate.getUTCDate()===day;
    if(valid&&candidate>now){start=candidate;break;}
   }
   if(!start){await send('❌ 유효한 미래 날짜를 입력해 주세요.');return true;}
   const pending=await db.query('SELECT 1 FROM hz_valorant_scrim_games WHERE room_id=$1 AND winner IS NULL LIMIT 1',[room]);
   if(pending.rowCount){await send('⛔ 진행 중인 내전을 먼저 종료하거나 초기화해 주세요.');return true;}
   await db.query('DELETE FROM hz_valorant_scrim_players WHERE room_id=$1',[room]);
   await db.query(`INSERT INTO hz_valorant_scrim_reservations(room_id,starts_at,created_by) VALUES($1,$2,$3)
     ON CONFLICT(room_id) DO UPDATE SET starts_at=$2,created_by=$3,created_at=NOW(),started_at=NULL,claimed_at=NULL`,[room,start,user]);
   await send('📅 NEXI | 내전 예약 완료\n시작: '+yMd(start)+' (한국시간)\n참가: !내전참여\n최대 10명 · 등록 정보 자동 적용');
   return true;
  }
  if(cmd==='!내전팀짜기'){
   const participants=await db.query('SELECT user_id,display_name,tier,rating,discord_name,riot_id FROM hz_valorant_scrim_players WHERE room_id=$1 ORDER BY joined_at,user_id',[room]);
   if(participants.rows.length<2||participants.rows.length>10){await send('❌ 내전 참가자가 2~10명이어야 합니다. 현재 '+participants.rows.length+'명\n!내전참여로 참가해 주세요.');return true;}
   const pending=await db.query('SELECT id FROM hz_valorant_scrim_games WHERE room_id=$1 AND winner IS NULL ORDER BY id DESC LIMIT 1',[room]);
   if(pending.rowCount){await send('⛔ 진행 중인 내전이 있습니다. !내전결과 공격 또는 수비로 먼저 종료하거나 !내전초기화를 이용해 주세요.');return true;}
   const players=participants.rows;
   const teams=choose(players);
   await db.query('INSERT INTO hz_valorant_scrim_games(room_id,team_a,team_b) VALUES($1,$2::jsonb,$3::jsonb)',
    [room,JSON.stringify(teams.a.map(p=>p.user_id)),JSON.stringify(teams.b.map(p=>p.user_id))]);
   await send(fold('⚔️ NEXI | 내전 팀 편성 ('+teams.a.length+' VS '+teams.b.length+')',
    '🔴 공격팀\n'+formatTeam(teams.a)+'\n━━━━━━━━━━━━━━\n🔵 수비팀\n'+formatTeam(teams.b)+
    '\n━━━━━━━━━━━━━━\n⚖️ 팀 티어 점수 차이: '+teams.delta+
    '\n※ 등록된 티어 기준 균형 배치 (실력 보증 아님)\n경기 종료: !내전결과 공격 또는 수비'));
   return true;
  }
  if(cmd==='!내전재편성'||cmd==='!내전선수교체'){
   if(!await isManager({roomId:room,userId:user,senderType,isBotAccount,isSuperAdmin,db})){
    await send('⛔ 내전 재편성·선수 교체는 관리자만 가능합니다.');return true;
   }
   const swaps=cmd==='!내전선수교체'?mentions(msg):[];
   if(cmd==='!내전선수교체'&&swaps.length!==2){
    await send('사용법: !내전선수교체 (서로 다른 선수 2명 멘션)');return true;
   }
   const client=typeof db.connect==='function'?await db.connect():null;
   if(!client)throw Error('내전 편성 변경용 트랜잭션을 시작하지 못했습니다.');
   let response;
   try{
    await client.query('BEGIN');
    const pending=await client.query('SELECT id,team_a,team_b FROM hz_valorant_scrim_games WHERE room_id=$1 AND winner IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE',[room]);
    if(!pending.rowCount)response='❌ 진행 중인 내전이 없습니다. !내전팀짜기로 먼저 편성해 주세요.';
    else{
     const game=pending.rows[0],a=typeof game.team_a==='string'?JSON.parse(game.team_a):game.team_a;
     const b=typeof game.team_b==='string'?JSON.parse(game.team_b):game.team_b;
     const ids=[...a,...b].map(String);
     if(ids.length<2||ids.length>10||Math.abs(a.length-b.length)>1||new Set(ids).size!==ids.length)throw Error('저장된 내전 팀 구성이 올바르지 않습니다.');
     let teamA=[...a].map(String),teamB=[...b].map(String),delta=null;
     if(cmd==='!내전선수교체'){
      const [first,second]=swaps.map(x=>x.id);
      if(!ids.includes(first)||!ids.includes(second))response='❌ 멘션한 두 선수 모두 현재 내전에 포함되어야 합니다.';
      else if((teamA.includes(first)&&teamA.includes(second))||(teamB.includes(first)&&teamB.includes(second)))
       response='❌ 공격·수비 각 팀에서 한 명씩 멘션해 주세요.';
      else{
       const arr1=teamA.includes(first)?teamA:teamB,arr2=teamA.includes(first)?teamB:teamA;
       arr1[arr1.indexOf(first)]=second;arr2[arr2.indexOf(second)]=first;
      }
     }else{
      const records=await client.query('SELECT user_id,tier,rating FROM hz_valorant_tier_profiles WHERE user_id=ANY($1::text[])',[ids]);
      const known=new Map(records.rows.map(x=>[String(x.user_id),x]));
      const missing=ids.filter(id=>!known.has(id));
      if(missing.length)response='❌ 티어 정보가 없는 참가자가 '+missing.length+'명 있습니다. 먼저 !티어등록이 필요합니다.';
      else{
       const players=ids.map(id=>({user_id:id,tier:known.get(id).tier,rating:Number(known.get(id).rating)}));
       const chosen=chooseDifferent(players,teamA);if(!chosen)throw Error('다른 팀 조합을 구성할 수 없습니다.');teamA=chosen.a.map(x=>x.user_id);teamB=chosen.b.map(x=>x.user_id);delta=chosen.delta;
      }
     }
     if(!response){
      await client.query('UPDATE hz_valorant_scrim_games SET team_a=$2::jsonb,team_b=$3::jsonb WHERE id=$1 AND winner IS NULL',
       [game.id,JSON.stringify(teamA),JSON.stringify(teamB)]);
      const names=await client.query('SELECT user_id,name FROM hz_members WHERE room_id=$1 AND user_id=ANY($2::text[])',[room,ids]);
      const n=new Map(names.rows.map(x=>[String(x.user_id),String(x.name)]));
      const updated=await client.query('SELECT user_id,tier FROM hz_valorant_tier_profiles WHERE user_id=ANY($1::text[])',[ids]);
      const tiers=new Map(updated.rows.map(x=>[String(x.user_id),x.tier]));
      const format=group=>group.map((uid,i)=>(i+1)+'. '+(n.get(uid)||uid)+' ('+(tiers.get(uid)||'미등록')+')').join('\n');
      response=fold(cmd==='!내전재편성'?'🔄 NEXI | 내전 팀 재편성':'🔁 NEXI | 내전 선수 교체',
       '🔴 공격팀\n'+format(teamA)+'\n━━━━━━━━━━━━━━\n🔵 수비팀\n'+format(teamB)+
       (delta===null?'':'\n⚖️ 티어 점수 차이: '+delta));
     }
    }
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK');throw error}
   finally{client.release()}
   await send(response);return true;
  }
  if(cmd==='!내전탈퇴'){
   await db.query('DELETE FROM hz_valorant_scrim_players WHERE room_id=$1 AND user_id=$2',[room,user]);
   await send('✅ 내전 참가 명단에서 탈퇴했습니다.');return true;
  }
  if(cmd==='!내전참가자'||cmd==='!내전밸런스'){
   const list=await db.query('SELECT user_id,display_name,tier,rating FROM hz_valorant_scrim_players WHERE room_id=$1 ORDER BY joined_at,user_id',[room]);
   const rows=list.rows;
   if(cmd==='!내전참가자'){await send(fold('🎮 NEXI | 내전 참가자 ('+rows.length+'/10)',rows.length?rows.map((p,i)=>(i+1)+'. '+p.display_name+' · '+p.tier).join('\n'):'참가자가 없습니다.\n!내전등록 후 !내전참여로 참여하세요.'));return true;}
   if(rows.length<2||rows.length>10){await send('❌ 팀 편성에는 참가자 2~10명이 필요합니다. 현재 '+rows.length+'명');return true;}
   const pending=await db.query('SELECT id FROM hz_valorant_scrim_games WHERE room_id=$1 AND winner IS NULL ORDER BY id DESC LIMIT 1',[room]);
   if(pending.rowCount){await send('⛔ 진행 중인 내전이 있습니다. !내전결과 A 또는 B로 먼저 종료해 주세요.');return true;}
   const balanced=true;
   const pairing=balanced?choose(rows):(()=>{
    const shuffled=[...rows];
    for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    return {a:shuffled.slice(0,5),b:shuffled.slice(5),delta:null};
   })();
   await db.query('INSERT INTO hz_valorant_scrim_games(room_id,team_a,team_b) VALUES($1,$2::jsonb,$3::jsonb)',
     [room,JSON.stringify(pairing.a.map(p=>p.user_id)),JSON.stringify(pairing.b.map(p=>p.user_id))]);
   await send(fold('⚔️ NEXI | '+pairing.a.length+'대'+pairing.b.length+' 내전 팀 편성',
    '🔵 A팀\n'+formatTeam(pairing.a)+'\n━━━━━━━━━━━━━━\n🔴 B팀\n'+formatTeam(pairing.b)+
    (balanced?'\n※ 참가자가 입력한 티어 점수 기준으로 균형을 맞췄습니다.':'\n※ 무작위 팀 편성입니다.')+
    '\n경기 종료 후 관리자: !내전결과 A 또는 B'));return true;
  }
  if(cmd==='!내전결과'){
   if(!await isManager({roomId:room,userId:user,senderType,isBotAccount,isSuperAdmin,db})){await send('⛔ 내전 결과 등록은 관리자만 가능합니다.');return true;}
   if(!/^(?:A|B|공격|수비)$/i.test(tail)){await send('사용법: !내전결과 공격 또는 !내전결과 수비 (A/B도 가능)');return true;}
   const r=await db.query(`UPDATE hz_valorant_scrim_games SET winner=$2,finished_at=NOW()
     WHERE id=(SELECT id FROM hz_valorant_scrim_games WHERE room_id=$1 AND winner IS NULL ORDER BY id DESC LIMIT 1)
     AND winner IS NULL RETURNING id`,[room,tail==='공격'?'A':tail==='수비'?'B':tail.toUpperCase()]);
   await send(r.rowCount?'✅ 내전 결과 등록: '+sideName(tail==='공격'?'A':tail==='수비'?'B':tail.toUpperCase())+'팀 승리':'❌ 진행 중인 내전이 없습니다.');return true;
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
   await db.query('DELETE FROM hz_valorant_scrim_reservations WHERE room_id=$1',[room]);
   await send('✅ 이번 내전 참가 명단을 초기화했습니다. 완료된 내전 순위는 유지됩니다.');return true;
  }
  if(cmd==='!듀오모집'){
   if(!tail||tail.length>100){await send('사용법: !듀오모집 (모집 내용, 100자 이하)\n예: !듀오모집 골드 경쟁전 마이크 가능');return true;}
   await db.query('DELETE FROM hz_valorant_duo_applications WHERE room_id=$1 AND owner_id=$2',[room,user]);
   await db.query(`INSERT INTO hz_valorant_duo_posts(room_id,user_id,display_name,description)
     VALUES($1,$2,$3,$4) ON CONFLICT(room_id,user_id)
     DO UPDATE SET display_name=$3,description=$4,created_at=NOW()`,[room,user,name,tail]);
   await send('✅ 듀오 모집 등록\n'+name+' · '+tail+'\n모집자 ID: '+user+'\n지원자는 이 메시지에 답장으로 !듀오신청 또는 !듀오신청 '+user+' 입력');return true;
  }
  if(cmd==='!듀오목록'){
   const r=await db.query("SELECT user_id,display_name,description FROM hz_valorant_duo_posts WHERE room_id=$1 AND created_at>NOW()-INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 15",[room]);
   await send(fold('👥 NEXI | 듀오 모집 목록',r.rowCount?r.rows.map((p,i)=>(i+1)+'. '+p.display_name+' · '+p.description+'\n   신청: !듀오신청 '+p.user_id).join('\n'):'진행 중인 듀오 모집이 없습니다.'));return true;
  }
  if(cmd==='!듀오신청'){
   let ownerId=tail;
   if(!ownerId){
    const reply=await recruit.resolve({msg,client,roomId:room,botId:client?.userId});
    if(reply?.kind==='party'){
     return require('./valorant-party').handle({text:'!파티참가 '+reply.owner,roomId:room,userId:user,
       userName:name,client,chat,send,db});
    }
    if(reply?.kind==='duo')ownerId=reply.owner;
   }
   if(!/^[1-9]\d+$/.test(ownerId)){await send('사용법: !듀오신청 (모집자 ID)\n또는 듀오 모집 메시지에 답장으로 !듀오신청을 입력해 주세요.');return true;}
   if(ownerId===user){await send('❌ 본인 모집글에는 신청할 수 없습니다.');return true;}
   const owner=await db.query("SELECT display_name FROM hz_valorant_duo_posts WHERE room_id=$1 AND user_id=$2 AND created_at>NOW()-INTERVAL '24 hours'",[room,ownerId]);
   if(!owner.rowCount){await send('❌ 해당 모집글이 없거나 24시간이 지났습니다.');return true;}
   const existing=await db.query('INSERT INTO hz_valorant_duo_applications(room_id,owner_id,applicant_id,applicant_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[room,ownerId,user,name]);
   if(!existing.rowCount){await send('이미 신청한 모집글입니다.');return true;}
   await send('✅ 듀오 신청 완료\n신청자: '+name);
   try{await recruit.alertOwner({chat,roomId:room,send,ownerId,ownerName:owner.rows[0].display_name,applicantName:name,kind:'duo'});}
   catch(err){console.warn('[DUO ALERT]',String(err?.code||'SEND_FAILED'));}
   return true;
  }
  if(cmd==='!듀오취소'){
   await db.query('DELETE FROM hz_valorant_duo_posts WHERE room_id=$1 AND user_id=$2',[room,user]);
   await db.query('DELETE FROM hz_valorant_duo_applications WHERE room_id=$1 AND owner_id=$2',[room,user]);
   await send('✅ 듀오 모집글을 삭제했습니다.');return true;
  }
 }catch(e){console.error('[NEXI VALORANT COMMUNITY]',String(e?.message||e).slice(0,220));await send('❌ 내전·파티 기능 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.');return true;}
 return true;
}
async function handleConfirmation(args){
 const text=String(args.text||'').trim();
 if(!/^(네|예|아니요|아니오)$/.test(text))return false;
 const key=String(args.roomId)+':'+String(args.userId),pending=pendingCorrections.get(key);
 if(!pending||Date.now()>pending.expires){
  pendingCorrections.delete(key);
  const join=pendingScrimJoins.get(key);
  if(!join||Date.now()>join.expires){pendingScrimJoins.delete(key);return false;}
  const ref=reference(args.msg);
  if(!ref||ref.userId&&args.client?.userId!=null&&String(ref.userId)!==String(args.client.userId))return false;
  pendingScrimJoins.delete(key);
  if(text==='아니요'||text==='아니오'){await args.send('✅ 내전 프로필만 저장했습니다. 참가하지 않습니다.');return true;}
  const db=args.db||getPool();
  await init(db);
  const profile=await db.query('SELECT tier,discord_name,riot_id FROM hz_valorant_scrim_profiles WHERE user_id=$1',[String(args.userId)]);
  if(!profile.rowCount||profile.rows[0].tier!==join.tier||profile.rows[0].discord_name!==join.discord||profile.rows[0].riot_id!==join.riot){await args.send('❌ 등록 정보가 변경되었습니다. 다시 !내전등록을 입력해 주세요.');return true;}
  const reservation=await db.query('SELECT starts_at,started_at FROM hz_valorant_scrim_reservations WHERE room_id=$1',[String(args.roomId)]);
  if(!reservation.rowCount||!reservation.rows[0].starts_at||new Date(reservation.rows[0].starts_at).getTime()<=Date.now()||reservation.rows[0].started_at){await args.send('❌ 현재 참가 가능한 예약 내전이 없습니다.');return true;}
  return handle({...args,db,text:'!내전참여'});
 }
 const ref=reference(args.msg);
 if(!ref)return false;
 if(ref.userId&&args.client?.userId!=null&&String(ref.userId)!==String(args.client.userId))return false;
 pendingCorrections.delete(key);
 if(text==='아니요'||text==='아니오'){await args.send('등록을 취소했습니다. 정확한 티어로 다시 입력해 주세요.');return true;}
 const full=[pending.tier.label,pending.discord,pending.riot].join('/');
 return handle({...args,text:pending.command+' '+full});
}
module.exports={COMMANDS,handle,handleConfirmation,rating,choose,chooseDifferent,init};
