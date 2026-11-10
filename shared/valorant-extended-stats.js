'use strict';
const {getPool}=require('./db');
const stats=require('./valorant-stats');
const saved=require('./valorant-account');
const {fold}=require('./valorant-more');
const COMMANDS=new Set(['!발로티어변동','!발로요원통계','!발로비교','!발로랭킹','!발로랭킹등록','!발로랭킹탈퇴']);
let schema=null;
const used=new Map();
function clean(x){return String(x??'').trim();}
function parseId(raw){return stats.parse('!발로전적 '+clean(raw));}
function accountInfo(row){return {name:row.name,tag:row.tag,region:row.region||'kr'};}
function path(target){return [target.region,'pc',encodeURIComponent(target.name),encodeURIComponent(target.tag)].join('/');}
function key(env){return clean(env.HENRIKDEV_API_KEY||env.VALORANT_API_KEY);}
async function init(db){
 if(!schema)schema=db.query(`CREATE TABLE IF NOT EXISTS hz_valorant_room_rankings(
 room_id TEXT NOT NULL,user_id TEXT NOT NULL,riot_name TEXT NOT NULL,riot_tag TEXT NOT NULL,
 region TEXT NOT NULL,tier_name TEXT,rank_score INTEGER,rr INTEGER,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id))`).catch(e=>{schema=null;throw e});
 await schema;
}
function findRankNumber(name){
 const order=['iron','bronze','silver','gold','platinum','diamond','ascendant','immortal','radiant'];
 const ko=['아이언','브론즈','실버','골드','플래티넘','다이아몬드','초월자','불멸','레디언트'];
 const s=clean(name).toLowerCase();
 let n=order.findIndex((x,i)=>s.includes(x)||s.includes(ko[i]));
 if(n<0)return null;
 const number=Number(s.match(/([123])(?:\s|$)/)?.[1]||1);
 return n*300+number*100;
}
function textAgent(agg){
 if(!agg?.rows.length)return '최근 조회 가능한 경쟁전 기록이 없습니다.';
 const rows=stats.topGroups(agg,'agent');
 return rows.map((g,i)=>(i+1)+'. '+g.name+' · '+g.games+'경기 · '+g.wins+'승 '+g.losses+'패'+
 (g.decided?' · 승률 '+(100*g.wins/g.decided).toFixed(1)+'%':' · 승률 확인 불가')+
 ' · K/D/A '+g.kills+'/'+g.deaths+'/'+g.assists).join('\n');
}
function summary(target,rank,agg){return target.name+'#'+target.tag+' · '+(rank?.current||'티어 정보 없음')+(rank?.rr!=null?' '+rank.rr+'RR':'')+
 '\n최근 경쟁전 '+(agg?.count||0)+'경기 · 승률 '+(agg?.winrate==null?'확인 불가':agg.winrate.toFixed(1)+'%')+
 '\nK/D/A '+(agg?agg.totalKills+'/'+agg.totalDeaths+'/'+agg.totalAssists:'확인 불가');}
function historyText(rows){
 if(!rows.length)return '최근 RR 변동 기록이 없습니다.';
 return rows.slice(0,15).map((r,i)=>{
  const delta=Number(r.mmr_change_to_last_game??r.rr_change??r.rrChange);
  const rr=Number(r.ranking_in_tier??r.rr);
  const tier=clean(r.currenttier_patched??r.tier?.name??r.current_tier?.name)||'티어 미확인';
  return (i+1)+'. '+tier+' · '+(Number.isFinite(delta)?(delta>=0?'+':'')+delta+' RR':'증감 미확인')+
    (Number.isFinite(rr)?' · '+rr+' RR':'');
 }).join('\n');
}
async function obtain(target,type,auth,fetcher){
 const suffix=path(target);
 if(type==='history')return stats.apiRequest('/valorant/v2/mmr-history/'+suffix,fetcher,auth);
 if(type==='mmr')return stats.apiRequest('/valorant/v3/mmr/'+suffix,fetcher,auth);
 return stats.apiRequest('/valorant/v4/matches/'+suffix+'?mode=competitive&size=20',fetcher,auth);
}
async function resolve(arg,userId,db){
 if(arg){const result=parseId(arg);if(result?.error||result?.usage)throw Error('Riot ID는 닉네임#태그 [서버] 형식으로 입력해 주세요.');return result;}
 const record=await saved.load({userId,db});
 if(!record)throw Error('!발로저장 닉네임#태그로 계정을 먼저 저장하거나 Riot ID를 입력해 주세요.');
 return accountInfo(record);
}
async function handle({text,roomId,userId,send,db=getPool(),fetcher=globalThis.fetch,env=process.env}){
 const cmd=clean(text).split(/\s+/)[0];if(!COMMANDS.has(cmd))return false;
 const tail=clean(text).slice(cmd.length).trim();
 const user=clean(userId),room=clean(roomId);
 if(!/^[1-9]\d+$/.test(user)||!/^[1-9]\d+$/.test(room)){await send('❌ 사용자 또는 채팅방 ID를 확인할 수 없습니다.');return true;}
 try{
  if(cmd==='!발로랭킹탈퇴'){
   await init(db);await db.query('DELETE FROM hz_valorant_room_rankings WHERE room_id=$1 AND user_id=$2',[room,user]);
   await send('✅ 이 방의 발로란트 전적 랭킹에서 탈퇴했습니다.');return true;
  }
  if(cmd==='!발로랭킹'){
   await init(db);
   const result=await db.query('SELECT riot_name,riot_tag,tier_name,rr,updated_at FROM hz_valorant_room_rankings WHERE room_id=$1 AND rank_score IS NOT NULL ORDER BY rank_score DESC,rr DESC,updated_at DESC LIMIT 10',[room]);
   await send(fold('🏆 카카오톡 게임 매니저 | 방 발로란트 랭킹',
     result.rowCount?result.rows.map((r,i)=>(i+1)+'. '+r.riot_name+'#'+r.riot_tag+' · '+r.tier_name+' '+r.rr+'RR').join('\n')+
     '\n※ 참가자가 직접 등록한 티어 스냅샷 순위이며, 실시간 전체 인원 순위는 아닙니다.':'등록된 전적이 없습니다.\n!발로저장 후 !발로랭킹등록으로 참가해 주세요.'));return true;
  }
  const auth=key(env);
  if(!auth){await send('⚙️ 전적 API를 사용하려면 HENRIKDEV_API_KEY가 필요합니다.');return true;}
  const time=Date.now(),rateKey=room+':'+user;
  if(time-(used.get(rateKey)||0)<12000){await send('⏳ 전적 조회는 12초 후 다시 시도해 주세요.');return true;}
  used.set(rateKey,time);if(used.size>1000)used.delete(used.keys().next().value);
  if(cmd==='!발로비교'){
   const parts=tail.split(/\s*\|\s*/);
   if(parts.length>2){await send('사용법: !발로비교 상대닉#태그 또는 !발로비교 닉#태그 | 닉#태그');return true;}
   const first=parts.length===2?await resolve(parts[0],user,db):await resolve('',user,db);
   const second=await resolve(parts.length===2?parts[1]:tail,user,db);
   const responses=await Promise.allSettled([obtain(first,'mmr',auth,fetcher),obtain(first,'matches',auth,fetcher),obtain(second,'mmr',auth,fetcher),obtain(second,'matches',auth,fetcher)]);
   const mmr1=responses[0].status==='fulfilled'?stats.mmr(responses[0].value):null;
   const matches1=responses[1].status==='fulfilled'?stats.aggregate(responses[1].value,first.name,first.tag,''):null;
   const mmr2=responses[2].status==='fulfilled'?stats.mmr(responses[2].value):null;
   const matches2=responses[3].status==='fulfilled'?stats.aggregate(responses[3].value,second.name,second.tag,''):null;
   if(!mmr1&&!matches1&&!mmr2&&!matches2)throw Error('비교에 필요한 공개 전적을 조회하지 못했습니다.');
   await send(fold('⚔️ 카카오톡 게임 매니저 | 발로란트 전적 비교',summary(first,mmr1,matches1)+'\n━━━━━━━━━━━━━━\n'+summary(second,mmr2,matches2)+'\n※ 최근 경쟁전 최대 20경기 기준'));return true;
  }
  const target=await resolve(cmd==='!발로랭킹등록'?'':tail,user,db);
  if(cmd==='!발로티어변동'){
   const history=await obtain(target,'history',auth,fetcher);
   const rows=Array.isArray(history)?history:Array.isArray(history?.history)?history.history:[];
   await send(fold('📈 카카오톡 게임 매니저 | 티어 변동\n'+target.name+'#'+target.tag,historyText(rows)));return true;
  }
  if(cmd==='!발로요원통계'){
   const matches=await obtain(target,'matches',auth,fetcher),agg=stats.aggregate(matches,target.name,target.tag,'');
   await send(fold('🎭 카카오톡 게임 매니저 | 요원별 경쟁전 통계\n'+target.name+'#'+target.tag,textAgent(agg)));return true;
  }
  if(cmd==='!발로랭킹등록'){
   if(tail){await send('사용법: !발로랭킹등록 (사전에 !발로저장 필요)');return true;}
   const raw=await obtain(target,'mmr',auth,fetcher),rank=stats.mmr(raw),score=findRankNumber(rank.current);
   if(score==null){await send('❌ 현재 티어가 확인되지 않아 랭킹에 등록하지 않았습니다.');return true;}
   await init(db);
   await db.query(`INSERT INTO hz_valorant_room_rankings(room_id,user_id,riot_name,riot_tag,region,tier_name,rank_score,rr)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(room_id,user_id) DO UPDATE SET riot_name=$3,riot_tag=$4,region=$5,tier_name=$6,rank_score=$7,rr=$8,updated_at=NOW()`,
   [room,user,target.name,target.tag,target.region,rank.current,score,rank.rr??0]);
   await send('✅ '+target.name+'#'+target.tag+' · '+rank.current+' '+(rank.rr??'?')+'RR\n이 방 전적 랭킹에 등록했습니다. 갱신하려면 다시 !발로랭킹등록을 사용하세요.');return true;
  }
 }catch(e){console.warn('[VALORANT EXTENDED STATS]',String(e?.code||e?.message||e).slice(0,160));await send('❌ '+(clean(e?.message)||'전적 데이터를 조회하지 못했습니다.'));return true;}
 return true;
}
module.exports={COMMANDS,handle,findRankNumber,historyText,textAgent};
