'use strict';
const {fold}=require('./valorant-more');

// Public cosmetic catalog: no Riot login, player ID, or account credentials are needed.
// The community Valorant-API exposes names/tiers/levels/chromas/images,
// but does NOT provide authoritative individual store prices or Radianite costs.
const API='https://valorant-api.com/v1/';
const TTL=6*60*60*1000;
const COOLDOWN=7000;
const MAX_CHARS=70;
let catalogCache=null,loading=null;
const last=new Map();

// Five-minute, per-user/per-room selection cache for ambiguous skin replies.
const selections=new Map(),CHOICES_HEADER='🔎 비슷한 스킨이 여러 개 있습니다.';
function selectionKey(room,user){return String(room??'')+':'+String(user??'');}
function logId(v){
 if(typeof v==='bigint')return v>0n?String(v):'';
 if(typeof v==='number')return Number.isSafeInteger(v)&&v>0?String(v):'';
 if(typeof v==='string')return /^[1-9]\d*$/.test(v)?v:'';
 if(v&&typeof v==='object'&&typeof v.toString==='function')return logId(v.toString());
 return '';
}
function receiptId(r){return logId(r?.body?.logId??r?.body?.chatLog?.logId??r?.logId??r?.chatLog?.logId);}
function quotedText(msg){
 const vals=[msg?.message?.attachment,msg?.raw?.chatLog?.attachment,msg?.raw?.chatlog?.attachment,
  msg?.raw?.attachment,msg?.message?.reply,msg?.reply];
 for(let a of vals){
  if(typeof a==='string'){
   try{a=require('lossless-json').parse(a);}catch{continue;}
  }
  if(!a||typeof a!=='object')continue;
  for(const o of [a.reply,a.quote,a.replyTo,a]){
   if(!o||typeof o!=='object')continue;
   for(const t of [o.src_message,o.srcMessage,o.src_msg,o.message,o.text])
    if(typeof t==='string'&&t.startsWith(CHOICES_HEADER.slice(0,-1)))return t;
  }
 }
 return '';
}
function quoteMatches(quote,original){
 if(!quote||!original)return false;
 if(quote===original)return true;
 // KakaoTalk may abbreviate a quoted message to the first line + "..."
 // even though the original suggestion contains the numbered list.
 const shortened=quote.replace(/(?:\.{3}|\u2026)\s*$/,'').trimEnd();
 return shortened.length>=CHOICES_HEADER.length-1&&original.startsWith(shortened);
}
async function originalMessageMatches({client,roomId,ref,body}){
 if(!ref?.log||typeof client?.fetchMessage!=='function')return false;
 try{
  const fetched=await client.fetchMessage(roomId,ref.log);
  const {info}=require('./reply-delete');
  const metadata=info(fetched);
  if(metadata.room!==String(roomId)||metadata.log!==ref.log||
     (client?.userId!=null&&metadata.author!==String(client.userId)))return false;
  const text=String(fetched?.message?.text??fetched?.text??'');
  return text===body;
 }catch(error){
  console.warn('[NEXI SKIN QUOTE FETCH]',String(error?.code||'FAILED'));
  return false;
 }
}
function recordSelection(room,user,choices,body,ack){
 for(const [key,item] of selections)if(item.expires<Date.now())selections.delete(key);
 selections.set(selectionKey(room,user),{choices,body,log:receiptId(ack),expires:Date.now()+300000});
 if(selections.size>500)selections.delete(selections.keys().next().value);
}

const ALIASES=[
 ['싱귤래리티','singularity'],['싱귤라리티','singularity'],['싱귤','singularity'],['싱굴','singularity'],
 ['약탈자','reaver'],['약탈','reaver'],['리버','reaver'],['프라임','prime'],['용','elderflame'],
 ['포세이큰','forsaken'],['아이온','ion'],['혼돈','chaos'],['혼서','chaos'],
 ['스펙트럼','spectrum'],['챔피언스','champions'],['오니','oni'],
 ['밴달','vandal'],['벤달','vandal'],['반달','vandal'],['벤덜','vandal'],['팬텀','phantom'],['펜텀','phantom'],
 ['오퍼레이터','operator'],['오퍼','operator'],['마샬','marshal'],['마셜','marshal'],
 ['클래식','classic'],['고스트','ghost'],['셰리프','sheriff'],['쉐리프','sheriff'],
 ['저지','judge'],['버키','bucky'],['스펙터','spectre'],['스펙타','spectre'],
 ['아레스','ares'],['오딘','odin'],['프렌지','frenzy'],['프렌지','frenzy'],
 ['불독','bulldog'],['가디언','guardian'],['스팅어','stinger'],
 ['쇼티','shorty'],['아웃로','outlaw'],['아웃로우','outlaw'],
 ['칼','melee'],['근접','melee'],['나이프','melee'],
];
const SORTED=[...ALIASES].sort((a,b)=>b[0].length-a[0].length);
const tierPrices=[
 [/select/i,{range:'875 VP',name:'셀렉트'}],
 [/deluxe/i,{range:'1,275 VP',name:'디럭스'}],
 [/premium/i,{range:'1,775 VP',name:'프리미엄'}],
 [/exclusive/i,{range:'2,175 VP 이상 (상품별 상이)',name:'익스클루시브'}],
 [/ultra/i,{range:'2,475 VP 이상 (상품별 상이)',name:'울트라'}],
];
const effectMap={
 VFX:'시각 효과',Animation:'애니메이션',Finisher:'마무리 연출',
 KillBanner:'킬 배너',KillCounter:'킬 카운터',
 Voiceover:'사운드/보이스',SoundEffects:'사운드 효과'
};
function clean(value,max=MAX_CHARS){
 return String(value??'').normalize('NFKC')
  .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ')
  .replace(/\s+/g,' ').trim().slice(0,max);
}
function canonical(value){
 let s=clean(value,120).toLowerCase();
 for(const [a,b] of SORTED){
  // Match aliases in Korean text and leave the already-translated Latin intact.
  if(s.includes(a))s=s.split(a).join(b);
 }
 return s.replace(/[^a-z0-9가-힣]/g,'');
}
function distance(a,b){
 if(a===b)return 0;
 if(Math.abs(a.length-b.length)>Math.max(3,Math.floor(Math.max(a.length,b.length)*.5)))return Math.max(a.length,b.length);
 const row=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  let prev=row[0];row[0]=i;
  for(let j=1;j<=b.length;j++){
   const old=row[j];
   row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
   prev=old;
  }
 }
 return row[b.length];
}
function score(query,label){
 if(!query||!label)return 0;
 if(query===label)return 1;
 if(label.startsWith(query))return .88+Math.min(query.length/label.length,.1);
 if(label.includes(query))return .83+Math.min(query.length/label.length,.1);
 if(query.startsWith(label))return .75;
 const dist=distance(query,label),max=Math.max(query.length,label.length);
 return Math.max(0,1-dist/max)*.85;
}
function rankSkins(query,skins,limit=6){
 const needle=canonical(query);
 if(!needle)return [];
 return skins.map(skin=>{
  const s=Math.max(...[skin.name,skin.englishName,...(skin.aliases||[])].map(x=>score(needle,canonical(x))));
  return {...skin,score:s};
 }).filter(x=>x.score>=.47).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).slice(0,limit);
}
function matchSkin(query,skins){
 const results=rankSkins(query,skins);
 if(!results.length)return {skin:null,choices:[]};
 const first=results[0],second=results[1];
 // A collection name like "싱귤" is ambiguous among multiple weapons.
 if(first.score>=.70&&(!second||first.score-second.score>=.055))return {skin:first,choices:results};
 if(first.score===1&&second?.score<1)return {skin:first,choices:results};
 return {skin:null,choices:results};
}
function getJson(url,fetcher=globalThis.fetch){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),9500);
 if(timer.unref)timer.unref();
 return Promise.resolve().then(async()=>{
  const res=await fetcher(url,{headers:{Accept:'application/json','User-Agent':'NEXI-Skin/1.0'},signal:controller.signal,redirect:'error'});
  if(!res.ok)throw Error('스킨 API 오류: HTTP '+res.status);
  const data=await res.json();
  if(!data||!Array.isArray(data.data))throw Error('스킨 데이터 형식이 올바르지 않습니다.');
  return data.data;
 }).finally(()=>clearTimeout(timer));
}
async function downloadCatalog(fetcher=globalThis.fetch){
 const urls=[
  API+'weapons/skins?language=ko-KR',
  API+'weapons/skins?language=en-US',
  API+'contenttiers?language=en-US'
 ];
 const results=await Promise.allSettled(urls.map(url=>getJson(url,fetcher)));
 const ko=results[0].status==='fulfilled'?results[0].value:[];
 const en=results[1].status==='fulfilled'?results[1].value:[];
 const tiers=results[2].status==='fulfilled'?results[2].value:[];
 if(!ko.length&&!en.length)throw Error('스킨 목록을 불러오지 못했습니다.');
 const korean=new Map(ko.filter(x=>x?.uuid).map(x=>[x.uuid,x]));
 const english=new Map(en.filter(x=>x?.uuid).map(x=>[x.uuid,x]));
 const tierMap=new Map(tiers.filter(x=>x?.uuid).map(t=>[t.uuid,t.displayName]));
 const skins=[];
 for(const id of new Set([...korean.keys(),...english.keys()])){
  const localized=korean.get(id),international=english.get(id);
  const data=localized||international;
  if(!data?.displayName||!data?.uuid)continue;
  skins.push({
   uuid:id,
   name:clean(localized?.displayName||international.displayName,120),
   englishName:clean(international?.displayName||localized?.displayName,120),
   data,english:international||data,
   tier:clean(tierMap.get(data.contentTierUuid)||'',100)
  });
 }
 if(!skins.length)throw Error('검색 가능한 스킨이 없습니다.');
 return skins;
}
async function catalog(fetcher=globalThis.fetch){
 if(fetcher!==globalThis.fetch)return downloadCatalog(fetcher); // Isolate injected/test data.
 if(catalogCache&&catalogCache.expires>Date.now())return catalogCache.items;
 if(loading)return loading;
 loading=downloadCatalog(fetcher).then(items=>{
  catalogCache={expires:Date.now()+TTL,items};return items;
 }).catch(error=>{
  if(catalogCache)return catalogCache.items;
  throw error;
 }).finally(()=>{loading=null;});
 return loading;
}
function pricing(skin){
 const title=skin.tier||'등급 미확인';
 const melee=/\/Melee\//i.test(skin.data?.assetPath||'')||/\b(?:melee|knife|karambit|axe|dagger|blade|sword|hammer|katana|kukri|fan|gauntlets|baton|claw)\b|근접|칼/i.test(skin.englishName);
 const tier=tierPrices.find(([re])=>re.test(title));
 if(melee)return {tier:tier?.[1]?.name||title,price:'개별 가격 확인 필요',notice:'근접무기는 같은 등급이어도 VP 가격이 다를 수 있습니다.'};
 return {
  tier:tier?.[1]?.name||title,
  price:tier?tier[1].range+' (등급 일반가)':'개별 가격 확인 필요',
  notice:'정확한 개별 가격은 공개 스킨 API에서 제공하지 않습니다. 게임 내 상점 가격을 확인해 주세요.'
 };
}
function safeMedia(url){
 try{
  const parsed=new URL(String(url||''));
  if(parsed.protocol!=='https:'||parsed.hostname!=='media.valorant-api.com')return '';
  if(!/^\/(?:weaponskins|weaponskinlevels|weaponskinchromas|streamedvideos)\//.test(parsed.pathname))return '';
  return parsed.href;
 }catch{return '';}
}
function safeVideo(url){
 try{
  const parsed=new URL(String(url||''));
  if(parsed.protocol!=='https:')return '';
  if(parsed.hostname==='valorant.dyn.riotcdn.net'&&/^\/x\/videos\/.+\.mp4$/i.test(parsed.pathname))return parsed.href;
  if(parsed.hostname==='media.valorant-api.com'&&/^\/streamedvideos\/.+\.mp4$/i.test(parsed.pathname))return parsed.href;
  return '';
 }catch{return '';}
}
function effects(levels){
 const items=[];
 for(let i=0;i<levels.length;i++){
  const raw=clean(levels[i]?.levelItem,90);
  const suffix=raw.split('::').pop();
  if(raw&&suffix&&suffix!=='None')items.push('Lv.'+(i+1)+' '+(effectMap[suffix]||suffix));
 }
 return items;
}
function variants(skin){
 const data=skin.data||{};
 const levels=Array.isArray(data.levels)?data.levels:[];
 const chromas=Array.isArray(data.chromas)?data.chromas:[];
 const base=safeMedia(levels[0]?.displayIcon)||safeMedia(data.displayIcon)||safeMedia(chromas[0]?.fullRender)||'';
 const max=safeMedia(levels.at(-1)?.displayIcon)||'';
 const baseEntry=base?{label:'기본형 / Lv.1',url:base}:null;
 const maxEntry=max&&max!==base?{label:'최종 단계 제공 이미지 / Lv.'+levels.length,url:max}:null;
 const colors=chromas.map((ch,i)=>({
  label:'색상 '+(i+1)+(i===0?' · 기본':'')+(ch?.displayName?' · '+clean(ch.displayName,18):''),
  name:clean(ch?.displayName,85),
  url:safeMedia(ch?.fullRender)||safeMedia(ch?.displayIcon)||''
 })).filter(x=>x.url);
 const entries=[baseEntry,maxEntry,...colors].filter(Boolean);
 const seen=new Set();
 const photos=entries.filter(x=>{if(seen.has(x.url))return false;seen.add(x.url);return true;}).slice(0,8);
 // Collect independently published video assets by level, not just the last one.
 // The level-1 asset is the ONLY video we may label "unupgraded".
 const seenVideos=new Set();
 const videoEntries=[];
 const baseVideo=safeVideo(levels[0]?.streamedVideo);
 if(baseVideo){seenVideos.add(baseVideo);videoEntries.push({label:'기본형 (Lv.1)',url:baseVideo});}
 for(let i=1;i<levels.length;i++){
  const url=safeVideo(levels[i]?.streamedVideo);
  if(!url||seenVideos.has(url))continue;
  seenVideos.add(url);
  videoEntries.push({label:'업그레이드 (Lv.'+(i+1)+')',url});
 }
 for(let i=0;i<chromas.length;i++){
  const url=safeVideo(chromas[i]?.streamedVideo);
  if(!url||seenVideos.has(url))continue;
  seenVideos.add(url);
  videoEntries.push({label:'색상 '+(i+1)+' 영상',url});
 }
 return {
  levels,chromas,photos,baseImage:base,hasDistinctUpgrade:!!maxEntry,
  baseVideo,
  videoEntries,
  previewVideo:videoEntries.find(v=>v.label.startsWith('업그레이드'))?.url||videoEntries[0]?.url||'',
  effectNames:effects(levels)
 };
}
function explain(skin){
 const price=pricing(skin),variant=variants(skin);
 const levelCount=variant.levels.length;
 const colorLines=variant.chromas.map((item,i)=>{
  const name=clean(item.displayName,72);
  return '  '+(i+1)+'. '+(name||('색상 '+(i+1)));
 });
 // Keep only the title and skin name in the KakaoTalk message preview.
 const header='🎨 NEXI | 발로란트 스킨 도감\n🔫 '+skin.name;
 const lines=[
  '━━━━━━━━━━━━━━',
  skin.name!==skin.englishName?'🇺🇸 '+skin.englishName:'',
  '💎 등급: '+price.tier,
  '💰 VP 가격: '+price.price,
  '⚡ 업그레이드: '+(levelCount?levelCount+'단계 (기본 Lv.1 포함)':'정보 없음'),
  '🪄 업그레이드 효과: '+(variant.effectNames.length?variant.effectNames.join(' · '):'상세 정보 미제공'),
  '🎨 색상: '+variant.chromas.length+'종',
  ...colorLines.slice(0,12),
  '🖼️ 기본형 / 업그레이드 / 색상별 외형: 사진 참조',
  '🎬 기본형 (Lv.1): '+(variant.baseVideo||'공개 영상 없음'),
  ...(variant.videoEntries.filter(v=>v.label!=='기본형 (Lv.1)').length?
   variant.videoEntries.filter(v=>v.label!=='기본형 (Lv.1)').map(v=>'🎬 '+v.label+': '+v.url):
   ['🎬 업그레이드 영상: 공개 영상 없음'])
 ].filter(Boolean);
 return {text:fold(header,lines.join('\n')),...variant};
}
function usage(){
 return '🎨 NEXI | 스킨 검색\n사용법: !스킨 (스킨 이름)\n예: !스킨 싱귤 밴달\n예: !스킨 프라임 팬텀';
}
function imageFallback(info){
 const lines=[];
 for(const item of info.photos.slice(0,6))lines.push('• '+item.label+'\n'+item.url);
 return '⚠️ 스킨 비교 사진을 전송하지 못했습니다. 원본 이미지 링크를 확인해 주세요.\n'+
  (lines.length?lines.join('\n'):'공개된 스킨 이미지가 없습니다.');
}
async function sendResult({skin,client,roomId,send,fetcher,sendImage}){
 const info=explain(skin);
 await send(info.text);
 if(info.photos.length){
  try{
   const action=sendImage||require('./valorant-skin-image').sendPreview;
   await action({client,roomId,skin,photos:info.photos,fetcher});
  }catch(error){
   console.warn('[NEXI SKIN PHOTO]',clean(error?.message,140));
   await send(imageFallback(info));
  }
 }else await send('🖼️ 공개 API에 등록된 스킨 이미지가 없습니다.');
}
async function handleReply({msg,text,client,roomId,userId,send,fetcher=globalThis.fetch,sendImage}){
 if(!/^[1-5]$/.test(String(text??'').trim()))return false;
 const key=selectionKey(roomId,userId),entry=selections.get(key);
 if(!entry){
  console.log('[NEXI SKIN REPLY]',JSON.stringify({pending:false}));
  return false;
 }
 if(entry.expires<Date.now()){selections.delete(key);return false;}
 const {reference}=require('./reply-delete');
 const ref=reference(msg);
 const quote=quotedText(msg);
 const bot=String(client?.userId??'');
 const author=String(ref?.author??'');
 const matchedQuote=quoteMatches(quote,entry.body);
 console.log('[NEXI SKIN REPLY]',JSON.stringify({
  pending:true,ref:!!ref,bot:!!bot,author:!!author,receipt:!!entry.log,
  matchedQuote,quoted:!!quote,replyType:Number(msg?.message?.type??msg?.type)===26
 }));
 if(!ref)return false;
 if(entry.log&&ref.log!==entry.log)return false;
 // Verify the exact source message by its Kakao log ID when available. Without
 // a send receipt, accept Kakao's abbreviated quotation from the current list.
 // An unrelated quoted bot message or other user's pending search is not valid.
 const verifiedByMessage=(!matchedQuote||!author||(bot&&author!==bot))
  ?await originalMessageMatches({client,roomId,ref,body:entry.body}):false;
 if(author&&bot&&author!==bot&&!verifiedByMessage)return false;
 if(!entry.log&&!verifiedByMessage&&!matchedQuote)return false;
 if(!entry.log&&!verifiedByMessage&&!author)return false;
 const index=Number(String(text).trim())-1;
 if(index>=entry.choices.length){
  await send('❌ 목록에 있는 번호를 입력해 주세요. (1~'+entry.choices.length+')');
  return true;
 }
 selections.delete(key);
 try{
  await sendResult({skin:entry.choices[index],client,roomId,send,fetcher,sendImage});
 }catch(error){
  console.warn('[NEXI SKIN CHOICE]',clean(error?.message,140));
  await send('❌ 스킨 정보를 전송하지 못했습니다. 다시 검색해 주세요.');
 }
 return true;
}
async function handle({text,client,roomId,userId,send,fetcher=globalThis.fetch,sendImage}){
 if(!/^!스킨(?:\s|$)/.test(String(text||'')))return false;
 const rawQuery=String(text).replace(/^!스킨(?:\s|$)/,'').trim();
 const query=clean(rawQuery);
 if(!query){await send(usage());return true;}
 if(rawQuery.length>MAX_CHARS||query.length<2){await send('❌ 스킨 이름은 2~70자 사이로 입력해 주세요.');return true;}
 const who=String(userId??'');
 const now=Date.now(),old=last.get(who)||0;
 if(who&&now-old<COOLDOWN){await send('⏳ 스킨 검색은 '+Math.ceil((COOLDOWN-(now-old))/1000)+'초 후 다시 이용할 수 있습니다.');return true;}
 if(who){last.set(who,now);if(last.size>600)last.delete(last.keys().next().value);}
 try{
  const available=await catalog(fetcher);
  const found=matchSkin(query,available);
  if(!found.skin){
   const choices=found.choices.slice(0,5);
   if(choices.length){
    const body=CHOICES_HEADER+'\n원하는 스킨 이름을 더 정확히 입력하거나 이 메시지에 답장으로 번호를 보내주세요.\n'+choices.map((x,i)=>(i+1)+'. '+x.name).join('\n');
    const ack=await send(body);
    recordSelection(roomId,userId,choices,body,ack);
   }else{
    selections.delete(selectionKey(roomId,userId));
    await send('❌ 검색 결과가 없습니다. 다른 이름으로 입력해 주세요.');
   }
   return true;
  }
  selections.delete(selectionKey(roomId,userId));
  await sendResult({skin:found.skin,client,roomId,send,fetcher,sendImage});
 }catch(error){
  console.warn('[NEXI SKIN]',clean(error?.message,140));
  await send('❌ 스킨 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
 }
 return true;
}
module.exports={handle,handleReply,sendResult,canonical,score,rankSkins,matchSkin,downloadCatalog,catalog,pricing,variants,explain,safeMedia,safeVideo,usage};
