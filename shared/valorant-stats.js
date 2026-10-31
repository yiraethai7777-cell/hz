'use strict';

// NEXI VALORANT lookup. Uses HenrikDev's API; no Riot credentials are collected.
// Only operator-approved Riot IDs (PostgreSQL or legacy environment allowlist)
// may be requested. Merely saving a Riot ID never constitutes approval.
const COMMANDS=new Set(['!발로전적','!전적','!티어','!최근전적','!승률','!헤드샷']);
const {fold}=require('./valorant-more');
const REGIONS=new Set(['kr','ap','eu','na','br','latam']);
const TTL=120000;
const COOLDOWN=12000;
const RECENT_MATCH_LIMIT=20;
const REQUEST_LIMIT=24; // HenrikDev basic keys currently allow 30/minute.
const cached=new Map(),pending=new Map(),lastUsed=new Map(),requestTimes=[];
const rankKorean=[
 ['Radiant','레디언트'],['Immortal','불멸'],['Ascendant','초월자'],
 ['Diamond','다이아몬드'],['Platinum','플래티넘'],['Gold','골드'],
 ['Silver','실버'],['Bronze','브론즈'],['Iron','아이언'],
 ['Unranked','언랭크'],['Unrated','언랭크']
];
function clean(v){return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]/g,' ').trim();}
function identity(name,tag){return (clean(name)+'#'+clean(tag)).normalize('NFC').toLocaleLowerCase('en-US');}
function allowedPlayers(env=process.env){
 const raw=String(env.VALORANT_APPROVED_PLAYERS||'');
 return new Set(raw.split(/[\n,;]/).map(v=>v.trim()).filter(Boolean)
   .map(v=>{const p=v.lastIndexOf('#');return p>0?identity(v.slice(0,p),v.slice(p+1)):'';})
   .filter(Boolean));
}
function parse(text){
 const trimmed=String(text||'').trim();
 const cmd=trimmed.split(/\s+/,1)[0];
 if(!COMMANDS.has(cmd))return null;
 const tail=trimmed.slice(cmd.length).trim();
 if(!tail)return {cmd,usage:true};
 const match=/^(.+)#([^#\s]+?)(?:\s+(kr|ap|eu|na|br|latam))?$/i.exec(tail);
 if(!match)return {cmd,error:'Riot ID는 닉네임#태그 형식으로 입력해 주세요.'};
 const name=clean(match[1]),tag=clean(match[2]),region=(match[3]||'kr').toLowerCase();
 if(!name||name.length>32||tag.length>10||name.includes('#')||
    /[\u0000-\u001f\u007f]/.test(name+tag)||
    !REGIONS.has(region))return {cmd,error:'Riot ID 또는 서버 지역이 올바르지 않습니다.'};
 return {cmd,name,tag,region,player:identity(name,tag)};
}
function number(v){
 if(v===undefined||v===null||v==='')return null;
 const x=Number(v);
 return Number.isFinite(x)&&x>=0?x:null;
}
function fmt(v){return v==null?'확인 불가':Number(v).toLocaleString('ko-KR');}
function rank(v){
 const text=clean(typeof v==='string'?v:v?.name??v?.patched);
 if(!text)return '정보 없음';
 let result=text;
 for(const [from,to] of rankKorean){if(new RegExp('^'+from+'\\b','i').test(result)){result=result.replace(new RegExp('^'+from+'\\b','i'),to);break;}}
 return result;
}
function mmr(data){
 if(!data||typeof data!=='object')return {current:'정보 없음',peak:'정보 없음',rr:null};
 const current=data.current||data;
 return {
  current:rank(current.tier??data.currenttierpatched),
  peak:rank(data.peak?.tier??data.highest_rank?.patched),
  rr:number(current.rr??data.ranking_in_tier),
  placement:number(current.leaderboard_placement),
  season:data.seasonal?.[0]?.season?.short||null
 };
}
function playerOf(match,name,tag,puuid){
 const all=Array.isArray(match?.players)?match.players:
   Array.isArray(match?.players?.all_players)?match.players.all_players:[];
 const target=identity(name,tag);
 return all.find(p=>puuid&&clean(p.puuid??p.player_id)===puuid)||
   all.find(p=>identity(p.name??p.player_name,p.tag??p.tagline)===target)||
   null;
}
function winner(teams,team){
 if(!team)return null;
 const wanted=clean(typeof team==='string'?team:team.id??team.team_id).toLowerCase();
 if(!wanted)return null;
 let t=null;
 if(Array.isArray(teams))t=teams.find(x=>clean(x.team_id??x.id??x.team).toLowerCase()===wanted);
 else if(teams&&typeof teams==='object')t=Object.entries(teams).find(([k])=>k.toLowerCase()===wanted)?.[1]||null;
 if(!t)return null;
 if(typeof t.won==='boolean')return t.won;
 if(typeof t.has_won==='boolean')return t.has_won;
 if(typeof t.hasWon==='boolean')return t.hasWon;
 const wins=number(t.rounds?.won??t.rounds_won),losses=number(t.rounds?.lost??t.rounds_lost);
 if(wins!=null&&losses!=null)return wins>losses?true:wins<losses?false:null;
 return null;
}
function shots(player,match){
 const s=player?.stats||{};
 const direct=number(s.headshot_percentage??s.headshot_percent??s.headshotPercentage);
 if(direct!=null&&direct<=100)return {value:direct,head:null,total:null};
 const head=number(s.headshots??s.shots?.head??s.damage?.headshots);
 const body=number(s.bodyshots??s.shots?.body??s.damage?.bodyshots);
 const leg=number(s.legshots??s.shots?.leg??s.damage?.legshots);
 if(head!==null&&body!==null&&leg!==null&&head+body+leg>0)
  return {value:100*head/(head+body+leg),head,total:head+body+leg};
 // On v4 schemas where the shots appear only in per-round damage events,
 // accumulate only this exact player's damage, never the entire lobby's.
 const puuid=clean(player?.puuid??player?.player_id);
 let h=0,b=0,l=0,observed=false;
 if(puuid&&Array.isArray(match?.rounds))for(const round of match.rounds){
  for(const event of (round.damage_events||round.damage||[])){
   const attacker=clean(event.attacker?.puuid??event.attacker_puuid??event.player_puuid);
   if(attacker!==puuid)continue;
   const a=number(event.headshots),c=number(event.bodyshots),d=number(event.legshots);
   if(a!=null&&c!=null&&d!=null){h+=a;b+=c;l+=d;observed=true;}
  }
 }
 return observed&&h+b+l>0?{value:100*h/(h+b+l),head:h,total:h+b+l}:null;
}
function matchInfo(match,name,tag,puuid){
 const player=playerOf(match,name,tag,puuid);
 if(!player)return null;
 const stats=player.stats||{};
 const team=player.team_id??player.team??player.teamId;
 const result=winner(match.teams,team);
 const agent=clean(player.agent?.name??player.character?.name??player.character??player.agent) || '요원 미확인';
 const rawMode=clean(match.metadata?.mode?.name??match.metadata?.mode?.id??match.metadata?.mode??match.metadata?.queue?.name);
 const modeName={competitive:'경쟁전',unrated:'일반전',deathmatch:'데스매치',team_deathmatch:'팀 데스매치',swiftplay:'신속 플레이',spikerush:'스파이크 러시',spike_rush:'스파이크 러시',escalation:'에스컬레이션',replication:'복제전',snowballfight:'눈싸움',premier:'프리미어'}[rawMode.toLowerCase()]||rawMode||'모드 미확인';
 const map=clean(match.metadata?.map?.name??match.metadata?.map??match.map?.name) || '맵 미확인';
 const kills=number(stats.kills),deaths=number(stats.deaths),assists=number(stats.assists);
 const hit=shots(player,match);
 return {result,agent,map,mode:modeName,kills,deaths,assists,hit};
}
function aggregate(matches,name,tag,puuid){
 const rows=(Array.isArray(matches)?matches:[]).map(m=>matchInfo(m,name,tag,puuid)).filter(Boolean);
 const known=rows.filter(x=>x.result!==null);
 const wins=known.filter(x=>x.result===true).length;
 const losses=known.filter(x=>x.result===false).length;
 const shotsAggregate=rows.filter(x=>x.hit?.total).reduce((a,x)=>({h:a.h+x.hit.head,t:a.t+x.hit.total}),{h:0,t:0});
 const withHit=rows.filter(x=>x.hit?.value!=null);
 const hs=shotsAggregate.t?100*shotsAggregate.h/shotsAggregate.t:
   withHit.length===rows.length&&rows.length?
     withHit.reduce((sum,x)=>sum+x.hit.value,0)/withHit.length:null;
 const totals=rows.reduce((a,x)=>({k:a.k+(x.kills||0),d:a.d+(x.deaths||0),a:a.a+(x.assists||0)}),{k:0,d:0,a:0});
 return {rows,wins,losses,count:rows.length,decided:known.length,
  winrate:known.length?100*wins/known.length:null,hs,
  totalKills:totals.k,totalDeaths:totals.d,totalAssists:totals.a};
}
function percent(v){return v===null?'확인 불가':v.toFixed(1)+'%';}
function kda(row){return [row.kills,row.deaths,row.assists].map(fmt).join('/');}
function lines(stats,limit=RECENT_MATCH_LIMIT){
 if(!stats.rows.length)return '경쟁전 기록이 없습니다.';
 return stats.rows.slice(0,limit).map((row,i)=>{
  const outcome=row.result===null?'➖ 결과 미확인':row.result?'🟢 승리':'🔴 패배';
  return (i+1)+'. '+outcome+' · ['+(row.mode||'모드 미확인')+'] '+row.map+'\n   '+row.agent+' · K/D/A '+kda(row);
 }).join('\n');
}
function format(cmd,target,ranked,stats,recent=null){
 const id=target.name+'#'+target.tag;
 // First two lines remain visible; the rest is behind KakaoTalk's native 더보기.
 const header='🎯 NEXI | VALORANT\n👤 '+id+' · '+target.region.toUpperCase()+' 서버';
 const divider='━━━━━━━━━━━━━━';
 const tier='🏅 현재 티어: '+(ranked?.current??'조회 실패')+
  '\n💎 RR: '+(ranked?.rr!=null?ranked.rr:'확인 불가')+
  '\n🏆 최고 티어: '+(ranked?.peak??'조회 실패');
 const record=stats?
  '📊 최근 경쟁전 '+stats.count+'경기\n🎮 승패: '+stats.wins+'승 '+stats.losses+'패'+
  (stats.decided!==stats.count?' (결과 미확인 '+(stats.count-stats.decided)+')':'')+
  '\n📈 승률: '+percent(stats.winrate)+
  '\n🎯 헤드샷률: '+percent(stats.hs)+
  '\n⚔️ K/D/A 합계: '+fmt(stats.totalKills)+'/'+fmt(stats.totalDeaths)+'/'+fmt(stats.totalAssists):
  '📊 최근 경기 정보를 조회하지 못했습니다.';
 if(cmd==='!티어')return fold(header,divider+'\n'+tier);
 if(cmd==='!승률')return fold(header,divider+'\n'+(stats?
  '📈 최근 경쟁전 '+stats.count+'경기 승률: '+percent(stats.winrate)+
  '\n승패: '+stats.wins+'승 '+stats.losses+'패':'경쟁전 기록을 확인할 수 없습니다.'));
 if(cmd==='!헤드샷')return fold(header,divider+'\n'+(stats?
  '🎯 최근 경쟁전 헤드샷률: '+percent(stats.hs)+'\n조회 경기: '+stats.count+'경기':
  '경쟁전 기록을 확인할 수 없습니다.'));
 if(cmd==='!최근전적')return fold(header,divider+'\n📋 최근 경기 (최대 20경기 · 전체 모드)\n'+
  (recent?lines(recent):'조회 실패'));
 return fold(header,divider+'\n'+tier+'\n'+divider+'\n'+record+
  '\n'+divider+'\n📋 최근 경기 (최대 20경기 · 전체 모드)\n'+
  (recent?lines(recent):'조회 실패'));
}
function trimMaps(map,max=200){
 while(map.size>max)map.delete(map.keys().next().value);
}
function apiKey(env=process.env){return String(env.HENRIKDEV_API_KEY||env.VALORANT_API_KEY||'').trim();}
// Tracker Network presents only the player's self-published, public profile.
// Construct a link; NEVER scrape or request unconsented match data.
function publicProfileUrl(target){
 return 'https://tracker.gg/valorant/profile/riot/'+
  encodeURIComponent(target.name+'#'+target.tag)+'/overview';
}
async function apiRequest(path,fetcher=globalThis.fetch,key=apiKey()){
 const now=Date.now();
 while(requestTimes.length&&now-requestTimes[0]>60000)requestTimes.shift();
 if(requestTimes.length>=REQUEST_LIMIT)throw Object.assign(Error('일시적으로 조회가 많습니다. 1분 후 다시 시도해 주세요.'),{code:'LIMIT'});
 requestTimes.push(now);
 if(typeof fetcher!=='function')throw Object.assign(Error('HTTP 조회 기능을 사용할 수 없습니다.'),{code:'FETCH'});
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),9000);
 if(timer.unref)timer.unref();
 try {
  const response=await fetcher('https://api.henrikdev.xyz'+path,{
   method:'GET',signal:controller.signal,
   headers:{Authorization:key,Accept:'application/json','User-Agent':'NEXI-VALORANT/1.0'}
  });
  if(!response.ok){
   const code=response.status;
   const userMessage=code===404?'계정을 찾지 못했거나 해당 전적이 공개되지 않았습니다.':
    code===401||code===403?'전적 API 인증 또는 접근 권한을 확인해 주세요.':
    code===429?'전적 API 요청 제한에 도달했습니다. 잠시 후 다시 시도해 주세요.':
    code>=500?'전적 서버에서 일시적인 문제가 발생했습니다.':'전적 서버 응답을 처리하지 못했습니다.';
   throw Object.assign(Error(userMessage),{code:'HTTP_'+code});
  }
  const result=await response.json();
  if(result?.status&&result.status!==200)
   throw Object.assign(Error('전적 서비스가 유효한 데이터를 반환하지 않았습니다.'),{code:'API_STATUS'});
  if(!result||result.data===undefined||result.data===null)
   throw Object.assign(Error('조회 가능한 전적이 없습니다.'),{code:'EMPTY'});
  return result.data;
 }catch(error){
  if(error?.name==='AbortError')throw Object.assign(Error('전적 조회 시간이 초과되었습니다.'),{code:'TIMEOUT'});
  if(error?.code)throw error;
  throw Object.assign(Error('전적 API에 연결할 수 없습니다.'),{code:'NETWORK'});
 }finally{clearTimeout(timer);}
}
async function get(path,options={}){
 const key=path;
 const old=cached.get(key);
 if(old&&old.expires>Date.now())return old.data;
 if(pending.has(key))return pending.get(key);
 const job=apiRequest(path,options.fetcher,options.key).then(data=>{
  cached.set(key,{data,expires:Date.now()+TTL});
  trimMaps(cached);
  return data;
 }).finally(()=>pending.delete(key));
 pending.set(key,job);
 return job;
}
async function lookup(target,cmd,options={}){
 const path=[target.region,'pc',encodeURIComponent(target.name),encodeURIComponent(target.tag)].join('/');
 const needMmr=cmd==='!티어'||cmd==='!전적'||cmd==='!발로전적';
 const needCompetitive=cmd==='!전적'||cmd==='!발로전적'||cmd==='!승률'||cmd==='!헤드샷';
 const needRecent=cmd==='!전적'||cmd==='!발로전적'||cmd==='!최근전적';
 const jobs=[];
 if(needMmr)jobs.push(get('/valorant/v3/mmr/'+path,options));
 if(needCompetitive)jobs.push(get('/valorant/v4/matches/'+path+'?mode=competitive&size='+RECENT_MATCH_LIMIT,options));
 if(needRecent)jobs.push(get('/valorant/v4/matches/'+path+'?size='+RECENT_MATCH_LIMIT,options));
 const responses=await Promise.allSettled(jobs);
 let mmrData=null,competitiveData=null,recentData=null,index=0;
 const mmrOutcome=needMmr?responses[index++]:null;
 const competitiveOutcome=needCompetitive?responses[index++]:null;
 const recentOutcome=needRecent?responses[index++]:null;
 if(mmrOutcome?.status==='fulfilled')mmrData=mmrOutcome.value;
 if(competitiveOutcome?.status==='fulfilled')competitiveData=competitiveOutcome.value;
 if(recentOutcome?.status==='fulfilled')recentData=recentOutcome.value;
 if(!mmrData&&!competitiveData&&!recentData)
  throw (recentOutcome?.reason||competitiveOutcome?.reason||mmrOutcome?.reason||Error('조회 가능한 데이터가 없습니다.'));
 const ranked=mmrData?mmr(mmrData):null;
 const puuid=clean(mmrData?.account?.puuid);
 const stats=competitiveData?aggregate(competitiveData,target.name,target.tag,puuid):null;
 const recent=recentData?aggregate(recentData,target.name,target.tag,puuid):null;
 return format(cmd,target,ranked,stats,recent);
}
async function handle({text,roomId,userId,send,env=process.env,fetcher,db}){
 const target=parse(text);
 if(!target)return false;
 const usage='사용법: '+target.cmd+' 닉네임#태그 [서버]\n예: '+target.cmd+' Player#KR1\n서버: kr(기본) / ap / na / eu';
 if(target.usage||target.error){await send(target.error?'❌ '+target.error+'\n'+usage:usage);return true;}
 // Check both the original Railway allowlist and operator-managed DB entries.
 // A saved account is not authorization, and a failed DB query must never allow API access.
 let approved=false;
 try{
  approved=await require('./valorant-approvals').isApproved(target,{env,db});
 }catch(error){
  console.warn('[NEXI VALORANT APPROVAL CHECK]',String(error?.code||'DB_ERROR'));
  await send('❌ 전적 조회 허용 목록을 확인할 수 없습니다. 데이터베이스를 확인해 주세요.');
  return true;
 }
 if(!approved){
  await send('🔎 전적 공개 동의가 확인되지 않은 계정입니다.\n'+
   '외부 사이트에서 공개된 경우 아래 링크에서 확인할 수 있습니다.\n'+
   publicProfileUrl(target));
  return true;
 }
 const key=apiKey(env);
 if(!key){await send('⚙️ 발로란트 전적 API가 아직 설정되지 않았습니다.\n운영자가 Railway에 HENRIKDEV_API_KEY를 등록해야 합니다.');return true;}
 const user=clean(userId),last=lastUsed.get(user)||0,now=Date.now();
 if(user&&now-last<COOLDOWN){await send('⏳ 전적 조회는 '+Math.ceil((COOLDOWN-(now-last))/1000)+'초 후 다시 이용할 수 있습니다.');return true;}
 if(user){lastUsed.set(user,now);trimMaps(lastUsed,1000);}
 try{
  await send(await lookup(target,target.cmd,{fetcher,key}));
 }catch(error){
  console.warn('[NEXI VALORANT]',String(error?.code||'LOOKUP_FAILED'));
  await send('❌ '+clean(error?.message||'전적 조회에 실패했습니다.'));
 }
 return true;
}
module.exports={handle,parse,allowedPlayers,apiRequest,lookup,aggregate,matchInfo,mmr,format,COMMANDS};
