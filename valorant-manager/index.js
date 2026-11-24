'use strict';
// VALORANT SCHOOL command implementations are copied verbatim to this
// isolated directory. The Manager controls authorization and presentation.
const {getPool}=require('../shared/db');
const store=require('./database');
const nexiDb=require('./nexi-valorant/db');
const nexiStats=require('./nexi-valorant/valorant-stats');
const nexiAccount=require('./nexi-valorant/valorant-account');
const nexiExtended=require('./nexi-valorant/valorant-extended-stats');
const nexiSkin=require('./nexi-valorant/valorant-skin');
const nexiGuides=require('./nexi-valorant/valorant-guides');
const nexiMusic=require('./nexi-valorant/valorant-champions-music');
const schoolGuides=require('./guides');
const scrims=require('./scrims');
const scrimNoShow=require('./scrim-no-show');
const scrimPromo=require('./scrim-promo');
const parties=require('./parties');
const duos=require('./duos');
const images=require('./images');
const replies=require('./replies');
const SCHOOL_ONLY=new Set(['!발로랭킹','!발로랭킹등록','!발로랭킹탈퇴',
 '!스킨비교','!내전선수교체','!내전결과']);
const COMMANDS=new Set([
 ...nexiStats.COMMANDS,...nexiAccount.COMMANDS,...nexiExtended.COMMANDS,
 ...nexiGuides.COMMANDS,...scrims.COMMANDS,...duos.COMMANDS,
 '!파티등록','!파티참가','!파티종료','!파티목록',
 '!스킨','!조준점','!챔스노래'
].filter(x=>!SCHOOL_ONLY.has(x)));
let initialization=null;
const HELP=[
 '🎯 카카오톡 매니저 | VALORANT 명령어',
 '━━━━━━━━━━━━━━',
 '📊 전적 · 계정',
 '!발로전적 닉#태그 / !티어 닉#태그',
 '!전적 / !최근전적 / !승률 / !헤드샷',
 '!발로저장 닉#태그 / !발로전적확인',
 '!발로전적확인 1,2 / !발로삭제 번호',
 '!발로티어변동 / !발로요원통계 / !발로비교',
 '',
 '🎨 요원 · 스킨 · 맵',
 '!스킨 스킨명 / !스킨가격 / !스킨색상',
 '!요원 제트 / !랜덤요원',
 '!맵 어센트 / !랜덤맵 / !무기 밴달',
 '!조준점 점 / !조준점 십자가 / !조준점 전체',
 '!챔스노래 2024',
 '',
 '👥 파티 · 듀오',
 '!파티등록 / !파티목록 / !파티참가 / !파티종료',
 '!듀오모집 / !듀오목록 / !듀오신청',
 '!듀오취소 / !듀오종료',
 '',
 '📅 내전',
 '!내전등록 / !내전예약 / !내전시간',
 '!내전참여 / !후보참여 / !내전참가자',
 '!내전탈퇴 / !내전팀짜기 / !내전재편성',
 '!내전밸런스 / !내전초기화',
 '!내전홍보 30 / !내전홍보끄기',
 '!불참 @대상 / !노쇼내역 / !불참취소 @대상',
 '',
 '━━━━━━━━━━━━━━',
 '※ 방별 게임 ON, 사용 기간, 관리자 권한에 따릅니다.',
 '※ 전적 조회는 외부 API 연결 상태에 따라 제한됩니다.'
].join('\n');
function formatAnswer(value,command=''){
 const raw=String(value??'');
 if(!raw)return raw;
 if(['!랜덤요원','!랜덤맵'].includes(command))return raw;
 // Keep first-line identifiers intact: KakaoTalk reply detection relies on them.
 if(raw.startsWith('🔎 비슷한 스킨이 여러 개 있습니다.'))return raw;
 if(raw.startsWith('🎯 저장한 발로란트 계정'))
  return raw.replace('\n','\n✦ 카카오톡 매니저 | VALORANT\n');
 let body=raw.replace(/VALORANT SCHOOL\s*\|/g,'카카오톡 매니저 | VALORANT ·')
  .replace(/NEXI\s*\|/gi,'카카오톡 매니저 | VALORANT ·')
  .replace(/VALORANT SCHOOL/g,'카카오톡 매니저 | VALORANT');
 if(!body.includes('카카오톡 매니저')&&!body.startsWith('사용법:')&&
    !body.startsWith('❌')&&!body.startsWith('⏳')&&!body.startsWith('⚙️'))
  body='🎯 카카오톡 매니저 | VALORANT\n━━━━━━━━━━━━━━\n'+body;
 return body;
}
async function init(){
 if(!initialization){
  initialization=(async()=>{
   const db=getPool();
   await store.migrate(db);
   await scrimNoShow.init(db);
   await scrimPromo.init(db);
   nexiDb.bindPool(db);
   return true;
  })().catch(e=>{initialization=null;throw e;});
 }
 return initialization;
}
function enabledFromRoom(room){
 // Old issued rooms previously ran Valorant under game ON.
 // Once explicitly set, the separate Valorant switch takes precedence.
 return room?.valorant_enabled==='true'||
  (room?.valorant_enabled==null&&room?.game==='true');
}
function command(text){return String(text||'').trim().split(/\s+/,1)[0];}
function isReply(msg){
 return [Number(msg?.message?.type),Number(msg?.type),Number(msg?.raw?.chatLog?.type)].includes(26)
  ||Boolean(msg?.message?.reply);
}
function shouldHandle(text,msg){
 const c=command(text),raw=String(text||'').trim();
 return COMMANDS.has(c)||(/^[1-5](?:\s*,\s*[1-5]){0,2}$/.test(raw)&&isReply(msg));
}
async function handle({text,client,chat,msg,roomId,userId,userName,isBotAccount=false,isSuperAdmin=false,send}={}){
 if(!shouldHandle(text,msg))return false;
 const raw=String(text??'').trim(),sourceCommand=command(raw);
 try{
  await init();
  const quote=await replies.resolveReply({chat:chat||client,msg,roomId,botId:client?.userId}).catch(()=>null);
  const selected=quote?.type==='accounts'&&/^[1-9](?:\s*,\s*[1-9]){0,2}$/.test(raw)
   ?'!발로전적확인 '+raw:raw;
  const cmd=command(selected);
  const db=getPool();
  const deliver=async value=>send(formatAnswer(value,cmd));
  if(cmd==='!발로명령어'){await send(HELP);return true;}
  const picture=async url=>images.sendRemotePhoto(client,roomId,url);
  const ctx={text:selected,roomId,userId,userName,db,client,chat,msg,
   isSelf:isBotAccount,isBotAccount,isSuperAdmin,send:deliver,
   env:process.env,replyPartyNumber:quote?.type==='party'?quote.number:null,
   replyDuoNumber:quote?.type==='duo'?quote.number:null,
   replyToBotList:quote?.type==='accounts',replyToBotScrim:quote?.type==='scrim-registration',
   mention:(id,name)=>{try{return chat?.mention?.(String(id),String(name),roomId)||'@'+name}catch{return '@'+name}},
   sendImage:picture,sendImages:async urls=>{for(const u of urls)await picture(u)},
   sendImageBuffer:async (buffer,ext='png')=>images.sendPhotoBuffer(client,roomId,buffer,ext)};
  if(await nexiSkin.handleReply({...ctx,sendImage:undefined}))return true;
  if(await nexiSkin.handle({...ctx,sendImage:undefined}))return true;
  if(nexiStats.COMMANDS.has(cmd))return !!await nexiStats.handle(ctx);
  if(nexiAccount.COMMANDS.has(cmd))return !!await nexiAccount.handle(ctx);
  if(nexiExtended.COMMANDS.has(cmd)&&!SCHOOL_ONLY.has(cmd))
   return !!await nexiExtended.handle(ctx);
  if(['!요원','!랜덤요원','!맵','!랜덤맵','!조준점'].includes(cmd))
   return !!await schoolGuides.handle(ctx);
  if(nexiGuides.COMMANDS.has(cmd)&&!SCHOOL_ONLY.has(cmd))
   return !!await nexiGuides.handle(ctx);
  if(await nexiMusic.handle(ctx))return true;
  if(await scrims.handleReply(ctx))return true;
  if(scrims.COMMANDS.has(cmd)&&!SCHOOL_ONLY.has(cmd))return !!await scrims.handle(ctx);
  if(['!파티등록','!파티참가','!파티종료','!파티목록'].includes(cmd))
   return !!await parties.handle(ctx);
  if(duos.COMMANDS.has(cmd))return !!await duos.handle(ctx);
  return false;
 }catch(error){
  console.warn('[MANAGER VALORANT]',String(error?.code||error?.message||error).slice(0,160));
  await send('❌ 발로란트 명령을 처리하지 못했습니다. 관리자에게 서버 로그 확인을 요청해 주세요.');
  return true;
 }
}
async function tick(client){
 if(!client||client.connected!==true||typeof client.getKnownChatRooms!=='function')return;
 await init();
 const db=getPool(),known=client.getKnownChatRooms().map(r=>String(r.id||''))
  .filter(x=>/^[1-9]\d{3,24}$/.test(x));
 if(!known.length)return;
 const result=await db.query(
  "SELECT r.room_id FROM hz_rooms r "+
  "LEFT JOIN gl_room_subscriptions s USING(room_id) "+
  "LEFT JOIN gl_room_subscription_legacy l USING(room_id) "+
  "WHERE r.room_id=ANY($1::text[]) "+
  "AND COALESCE((r.data->>'botEnabled')::boolean,TRUE) "+
  "AND COALESCE((r.data->>'valorantEnabled')::boolean,(r.data->>'game')::boolean,FALSE) "+
  "AND ( (s.room_id IS NOT NULL AND s.status='active' AND s.expires_at>NOW()) "+
  "OR (s.room_id IS NULL AND l.room_id IS NOT NULL))",
  [known]);
 const channel=client.chat||client,senders=new Map();
 for(const row of result.rows)senders.set(String(row.room_id),value=>
  channel.sendText(row.room_id,formatAnswer(value,'!내전홍보')));
 await scrims.processDue(db,senders);
 await scrimPromo.processDue(db,senders);
 await store.cleanup(db);
}
module.exports={COMMANDS,SCHOOL_ONLY,HELP,formatAnswer,enabledFromRoom,shouldHandle,handle,init,tick};