'use strict';
const {fold}=require('./valorant-more');
const skin=require('./valorant-skin');
const COMMANDS=new Set(['!발로명령어','!요원','!랜덤요원','!맵','!랜덤맵','!무기','!조준점','!스킨비교','!스킨색상','!스킨가격']);
const cached=new Map();
const last=new Map();
function clean(s){return String(s??'').trim().slice(0,100);}
function match(q,items){const search=clean(q).toLocaleLowerCase('ko-KR');return items.find(x=>String(x.displayName||'').toLocaleLowerCase('ko-KR')===search)||items.find(x=>String(x.displayName||'').toLocaleLowerCase('ko-KR').includes(search));}
async function data(kind,{fetcher=globalThis.fetch}={}){
 if(fetcher===globalThis.fetch&&cached.get(kind)?.expires>Date.now())return cached.get(kind).data;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);timer.unref?.();
 try{
  const url='https://valorant-api.com/v1/'+kind+'?language=ko-KR';
  const response=await fetcher(url,{headers:{Accept:'application/json'},signal:controller.signal});
  if(!response.ok)throw Error('공개 발로란트 데이터 API 오류');
  const result=await response.json();
  if(!Array.isArray(result?.data))throw Error('공개 데이터 형식 오류');
  if(fetcher===globalThis.fetch){cached.set(kind,{expires:Date.now()+3600000,data:result.data});if(cached.size>12)cached.delete(cached.keys().next().value);}
  return result.data;
 }finally{clearTimeout(timer);}
}
const pct=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('ko-KR'):'확인 불가';
const noInfo='공개 데이터에 정보가 없습니다.';
function abilityLines(a){return (Array.isArray(a)?a:[]).filter(x=>x?.displayName).map(x=>'• '+clean(x.displayName)+' ('+clean(x.slot)+')\n  '+clean(x.description).slice(0,300));}
function skinLine(x){const price=skin.pricing(x),v=skin.variants(x);return '🔫 '+x.name+'\n💎 '+price.tier+' · '+price.price+'\n🎨 색상 '+v.chromas.length+'종 · 강화 '+v.levels.length+'단계';}
function findSkin(query,items){const result=skin.matchSkin(query,items);return result.skin||result.choices?.[0]&&result.choices[0].score>=.82?result.skin||result.choices[0]:null;}
async function handle({text,userId,send,fetcher=globalThis.fetch}){
 const command=String(text||'').split(/\s+/)[0];if(!COMMANDS.has(command))return false;
 const tail=String(text).slice(command.length).trim();
 if(command==='!발로명령어'){
  await send(fold('🎯 NEXI | VALORANT 명령어',
   '🔍 전적 · 통계\n!발로전적 닉#태그 / !발로전적확인 / !발로저장 닉#태그\n!발로티어변동 [닉#태그] / !발로요원통계 [닉#태그]\n!발로비교 상대닉#태그 (또는 닉#태그 | 닉#태그)\n!발로랭킹 / !발로랭킹등록 / !발로랭킹탈퇴\n━━━━━━━━━━━━━━\n🎨 스킨 · 가이드\n!스킨 이름 / !스킨비교 스킨1 | 스킨2\n!스킨색상 이름 / !스킨가격 이름\n!요원 이름 / !랜덤요원 / !맵 이름 / !랜덤맵\n!무기 이름 / !조준점 코드\n━━━━━━━━━━━━━━\n⚔️ 내전 · 듀오\n!내전참가 티어 / !내전탈퇴 / !내전참가자\n!내전팀짜기 / !내전밸런스\n!내전결과 A 또는 B / !내전순위 / !내전초기화\n!듀오모집 내용 / !듀오목록 / !듀오신청 모집자ID / !듀오취소\n※ 해당 방에서 !발로on 설정이 필요합니다.'));
  return true;
 }

 const key=String(userId||'')+':'+command,now=Date.now();
 if(now-(last.get(key)||0)<3500){await send('⏳ 잠시 후 다시 검색해 주세요.');return true;}
 last.set(key,now);if(last.size>1000)last.delete(last.keys().next().value);
 try{
  if(command==='!조준점'){
   if(!tail){await send('🎯 사용법: !조준점 (발로란트 조준점 코드)\n설정 → 조준점 → 프로필 코드 가져오기에 붙여 넣으세요.');return true;}
   if(tail.length>180||!/^[0-9;sPcahtfdmlorA-Z.-]+$/i.test(tail)){await send('❌ 조준점 코드 형식을 확인해 주세요.');return true;}
   await send('🎯 NEXI | 조준점 코드\n'+tail+'\n발로란트 설정 → 조준점 → 프로필 코드 가져오기에 붙여 넣으세요.');return true;
  }
  if(command.startsWith('!스킨')){
   if(!tail){await send('사용법: '+command+(command==='!스킨비교'?' (스킨1) | (스킨2)':' (스킨 이름)'));return true;}
   const items=await skin.catalog(fetcher);
   if(command==='!스킨비교'){
    const parts=tail.split(/\s*\|\s*/).map(clean);
    if(parts.length!==2||parts.some(p=>p.length<2)){await send('사용법: !스킨비교 프라임 밴달 | 약탈자 밴달');return true;}
    const found=parts.map(p=>findSkin(p,items));
    if(found.some(x=>!x)){await send('❌ 비교할 스킨을 찾지 못했습니다. 무기 이름까지 입력해 주세요.');return true;}
    await send(fold('🎨 NEXI | 스킨 비교',found.map((s,i)=>(i+1)+'. '+skinLine(s)).join('\n━━━━━━━━━━━━━━\n')+'\n※ VP는 등급 일반가이며 개별 상점 가격이 아닐 수 있습니다.'));return true;
   }
   const x=findSkin(tail,items);
   if(!x){await send('❌ 해당 스킨을 찾지 못했습니다. 무기 이름까지 입력해 주세요.');return true;}
   const v=skin.variants(x);
   if(command==='!스킨가격')await send(fold('💰 NEXI | 스킨 가격\n'+x.name,skinLine(x)+'\n※ 정확한 개별 VP 가격은 공개 API에서 제공되지 않을 수 있습니다.'));
   else await send(fold('🎨 NEXI | 스킨 색상\n'+x.name,'색상 '+v.chromas.length+'종\n'+(v.chromas.map((c,i)=>(i+1)+'. '+clean(c.displayName)+(c.fullRender?'\n'+c.fullRender:'')).join('\n')||noInfo)));
   return true;
  }
  if(command==='!요원'||command==='!랜덤요원'){
   if(command==='!요원'&&!tail){await send('사용법: !요원 제트');return true;}
   const items=(await data('agents',{fetcher})).filter(x=>x.isPlayableCharacter!==false&&x.displayName);
   const x=command==='!랜덤요원'?items[Math.floor(Math.random()*items.length)]:match(tail,items);
   if(!x){await send('❌ 해당 요원을 찾지 못했습니다.');return true;}
   await send(fold('🎭 NEXI | 요원\n'+x.displayName,'역할: '+clean(x.role?.displayName||'미확인')+'\n'+(clean(x.description)||noInfo)+'\n━━━━━━━━━━━━━━\n'+abilityLines(x.abilities).join('\n')+'\n이미지: '+(x.fullPortrait||x.displayIcon||'없음')));return true;
  }
  if(command==='!맵'||command==='!랜덤맵'){
   if(command==='!맵'&&!tail){await send('사용법: !맵 어센트');return true;}
   const items=(await data('maps',{fetcher})).filter(x=>x.displayName&&x.displayIcon);
   const x=command==='!랜덤맵'?items[Math.floor(Math.random()*items.length)]:match(tail,items);
   if(!x){await send('❌ 해당 맵을 찾지 못했습니다.');return true;}
   await send(fold('🗺️ NEXI | 맵\n'+x.displayName,'좌표/지역: '+clean(x.coordinates||'정보 없음')+'\n설명: '+clean(x.narrativeDescription||x.tacticalDescription||'공식 설명 없음')+'\n미니맵: '+(x.displayIcon||'없음')+'\n※ 현재 경쟁전 맵 풀과는 다를 수 있습니다.'));return true;
  }
  if(command==='!무기'){
   if(!tail){await send('사용법: !무기 밴달');return true;}
   const items=(await data('weapons',{fetcher})).filter(x=>x.displayName),x=match(tail,items);
   if(!x){await send('❌ 해당 무기를 찾지 못했습니다.');return true;}
   const stats=x.weaponStats||{},damage=Array.isArray(stats.damageRanges)?stats.damageRanges:[];
   await send(fold('🔫 NEXI | 무기\n'+x.displayName,
    '가격: '+pct(x.shopData?.cost)+' 크레딧\n탄창: '+pct(stats.magazineSize)+'발\n발사속도: '+pct(stats.fireRate)+'발/초'+
    '\n━━━━━━━━━━━━━━\n'+(damage.map(d=>d.rangeStartMeters+'~'+d.rangeEndMeters+'m · 머리 '+pct(d.headDamage)+' / 몸 '+pct(d.bodyDamage)+' / 다리 '+pct(d.legDamage)).join('\n')||noInfo)+
    '\n이미지: '+(x.displayIcon||'없음')));return true;
  }
 }catch(e){console.warn('[VALORANT GUIDE]',String(e?.message||e).slice(0,140));await send('❌ 발로란트 공개 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');return true;}
 return true;
}
module.exports={COMMANDS,handle,data,findSkin,match};
