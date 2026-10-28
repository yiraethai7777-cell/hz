'use strict';
const {getPool}=require('./db');
const recent=new Map();
const aiModule=require('./junggae-ai');
const ai=aiModule.createService(getPool);
let setup;
let singletonSetup;
let watchReady;
async function watchDb(){const p=await db();if(!watchReady)watchReady=p.query('CREATE TABLE IF NOT EXISTS junggae_watch_rooms (room_id TEXT PRIMARY KEY)').catch(e=>{watchReady=null;throw e});await watchReady;return p;}
let botRoomReady;
async function botRoomDb(){
 const p=await db();
 if(!botRoomReady)botRoomReady=p.query('CREATE TABLE IF NOT EXISTS junggae_bot_room (singleton_key INTEGER PRIMARY KEY CHECK(singleton_key=1), room_id TEXT NOT NULL)').catch(e=>{botRoomReady=null;throw e});
 await botRoomReady;
 return p;
}
async function db(){
  if(!setup) setup=getPool().query('CREATE TABLE IF NOT EXISTS junggae_subscriptions (room_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL, PRIMARY KEY(room_id,user_id))').catch(e=>{setup=null;throw e});
  await setup;return getPool();
}
async function singletonDb(){
 const pool=await db();
 if(!singletonSetup) singletonSetup=(async()=>{
   await pool.query('CREATE TABLE IF NOT EXISTS junggae_single_receiver (singleton_key INTEGER PRIMARY KEY CHECK(singleton_key=1), room_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL)');
   await pool.query('INSERT INTO junggae_single_receiver(singleton_key,room_id,user_id,user_name) SELECT 1,room_id,user_id,user_name FROM junggae_subscriptions ORDER BY room_id,user_id LIMIT 1 ON CONFLICT DO NOTHING');
 })().catch(e=>{singletonSetup=null;throw e});
 await singletonSetup;return pool;
}
const {matches}=require('./junggae-rule');
async function handle({client,chat,msg,roomId,text,isBotAccount,allowBotSubscription=false}){
 const id=String(roomId), sender=String(msg.sender?.id??msg.senderId??'');
 const send=(room,body)=>typeof chat?.sendText==='function'?chat.sendText(room,body):client.sendText(room,body);
 if(/^!준개(?:맞음|아님|학습검색)(?:\s|$)/.test(text)){
  try{
   const p=await botRoomDb();
   const r=await p.query('SELECT room_id FROM junggae_bot_room WHERE singleton_key=1');
   if(r.rows[0]?.room_id!==id){await send(roomId,'등록된 봇방에서만 사용할 수 있습니다.');return true;}
   const type=Number(msg.sender?.type);
   if(!isBotAccount&&type!==1&&type!==4&&!await require('./room-bot-admin').isRoomBotAdmin(id,sender,p)){
    await send(roomId,'봇방 관리자만 학습 피드백을 사용할 수 있습니다.');return true;
   }
   if(text.startsWith('!준개학습검색')){
    const query=text.replace(/^!준개학습검색\s*/,'').slice(0,80);
    const rows=await ai.examples(query);
    await send(roomId,rows.length?rows.map(x=>(x.label?'[준개] ':'[아님] ')+x.text.slice(0,250)).join('\n'):'저장된 예시가 없습니다.');return true;
   }
   if(text!=='!준개맞음'&&text!=='!준개아님'){await send(roomId,'알림에 답장으로 !준개맞음 또는 !준개아님 을 입력하세요.');return true;}
   const ref=require('../manage/targets').reference(msg);
   const ok=ref?.logId&&await ai.feedback(id,ref.logId,text==='!준개맞음',sender);
   await send(roomId,ok?'피드백 저장 완료. 현재 감지는 멘션 규칙을 사용합니다.':'준개 알림 또는 봇방에 새로 붙여 넣은 원문에 답장해 주세요.');
  }catch{console.warn('[JUNGGAE] feedback unavailable');await send(roomId,'학습 저장 실패. 잠시 후 다시 시도해 주세요.');}
  return true;
 }
 if(text==='!봇방등록'){

  try{
   const p=await botRoomDb();
   const result=await p.query('INSERT INTO junggae_bot_room(singleton_key,room_id) VALUES(1,$1) ON CONFLICT DO NOTHING RETURNING room_id',[id]);
   await send(roomId,result.rowCount?'봇방 등록 완료. 이 방에서 준개방등록 명령어를 사용할 수 있습니다.':'이미 봇방이 등록되어 있어 변경할 수 없습니다.');
  }catch(e){console.error('[JUNGGAE] bot room registration',e);await send(roomId,'봇방 등록 실패. Railway 로그를 확인해 주세요.');}
  return true;
 }
 if(/^!준개방(?:등록|삭제|목록)(?:\s|$)/.test(text)){
  try{const p=await botRoomDb();const r=await p.query('SELECT room_id FROM junggae_bot_room WHERE singleton_key=1');if(r.rows[0]?.room_id!==id){await send(roomId,'등록된 봇방에서만 사용할 수 있습니다.');return true;}}catch(e){console.error('[JUNGGAE] bot room check',e);return true;}
  const [cmd,arg]=text.split(/\s+/,2);
  if(cmd!=='!준개방목록'&&!/^\d{4,}$/.test(arg||'')){await send(roomId,'사용법: '+cmd+' (방ID)');return true;}
  try{
   const p=await watchDb();
   if(cmd==='!준개방등록'){await p.query('INSERT INTO junggae_watch_rooms(room_id) VALUES($1) ON CONFLICT DO NOTHING',[arg]);await send(roomId,'준개 감지방 등록 완료: '+arg);}
   else if(cmd==='!준개방삭제'){await p.query('DELETE FROM junggae_watch_rooms WHERE room_id=$1',[arg]);await send(roomId,'준개 감지방 삭제 완료: '+arg);}
   else{const {rows}=await p.query('SELECT room_id FROM junggae_watch_rooms ORDER BY room_id');await send(roomId,rows.length?rows.map(x=>x.room_id).join('\n'):'등록된 준개 감지방이 없습니다.');}
  }catch(e){console.error('[JUNGGAE] watch setup',e);await send(roomId,'감지방 설정 실패. Railway 로그 확인');}
  return true;
 }
 if(/^!준개알람(?:받기|끄기)(?:\s|$)/.test(text)){
   try{const p=await botRoomDb();const result=await p.query('SELECT room_id FROM junggae_bot_room WHERE singleton_key=1');if(result.rows[0]?.room_id!==id){await send(roomId,'등록된 봇방에서만 사용할 수 있습니다.');return true;}}catch(e){console.error('[JUNGGAE] bot room check',e);return true;}
   const action=text.split(/\s+/,1)[0];
   const mentions=require('../manage/targets').mentions(msg);
   if(!mentions.length){await send(roomId,'❌ 실제 멘션으로 대상을 지정해 주세요. 예: !준개알람받기 @닉네임');return true;}
   try{
     const pool=await db();
     let changed=0;
     for(const target of mentions){
       const result=action==='!준개알람받기'
        ?await pool.query('INSERT INTO junggae_subscriptions(room_id,user_id,user_name) VALUES($1,$2,$3) ON CONFLICT(room_id,user_id) DO UPDATE SET user_name=EXCLUDED.user_name',[id,target.id,target.name||target.id])
        :await pool.query('DELETE FROM junggae_subscriptions WHERE room_id=$1 AND user_id=$2',[id,target.id]);
       changed+=result.rowCount||0;
     }
     await send(roomId,(action==='!준개알람받기'?'🔔 준개 알림 등록':'🔕 준개 알림 해제')+' 완료: '+changed+'명');
   }catch(e){console.error('[JUNGGAE] subscription:',e);await send(roomId,'❌ 알림 설정 실패. Railway 로그를 확인해 주세요.');}
   return true;
 }
 // Persist bot-room originals too: paste a missed request here, then reply with feedback.
 if(!isBotAccount&&!aiModule.excluded(text)&&text.length<=4000){
  try{
   const p=await botRoomDb();const r=await p.query('SELECT room_id FROM junggae_bot_room WHERE singleton_key=1');
   const log=require('../manage/targets').exact(msg.message?.logId??msg.logId??msg.id);
   if(r.rows[0]?.room_id===id&&log)await ai.remember(id,String(log),text);
  }catch{console.warn('[JUNGGAE] sample storage unavailable');}
 }
 let watched=false;
 try{const p=await watchDb();const r=await p.query('SELECT 1 FROM junggae_watch_rooms WHERE room_id=$1',[id]);watched=r.rowCount>0;}catch(e){console.error('[JUNGGAE] watch lookup',e);return false;}
 if(!watched||isBotAccount)return false;
 if(!Number(msg.sender?.type)&&typeof client?._ensureMemberType==='function'){
  try{await client._ensureMemberType(roomId,sender);msg={...msg,sender:{...msg.sender,type:client._resolveMemberType?.(roomId,sender)}};}catch{return false;}
 }
 if(!matches(text,msg))return false;
 const key=id+':'+String(msg.message?.logId??msg.logId??msg.id??sender+':'+aiModule.hash(text));
 const now=Date.now();
 for(const [k,t] of recent)if(now-t>120000)recent.delete(k);
 if(recent.has(key))return false;
 recent.set(key,now);
 if(recent.size>3000)recent.delete(recent.keys().next().value);
 // Explicit mention rule is the sole detection criterion; no external AI call.
 try{
  const pool=await botRoomDb();
  const {rows}=await pool.query('SELECT s.room_id,s.user_id,s.user_name FROM junggae_subscriptions s JOIN junggae_bot_room b ON b.room_id=s.room_id WHERE s.room_id<>$1 ORDER BY s.room_id,s.user_id',[id]);
  const mention=typeof chat?.mention==='function'?chat.mention.bind(chat):typeof client?.mention==='function'?client.mention.bind(client):null;
  for(const receiver of rows){
   try{
    const marker=mention?.(receiver.user_id,receiver.user_name,receiver.room_id);
    const prefix=typeof marker==='string'&&marker.startsWith('\u0002')&&marker.includes('\u0003')&&marker.endsWith('\u0004')?marker:'@'+receiver.user_name;
    const result=await send(receiver.room_id,prefix+' 준개감지\n방: '+id+'\n'+text.slice(0,1000)+'\n답장: !준개맞음 / !준개아님');
    const log=require('../manage/targets').exact(result?.body?.logId);
    if(result?.status===0&&log)await ai.remember(receiver.room_id,String(log),text);
    else console.warn('[JUNGGAE] unconfirmed alert; feedback unavailable');
   }catch{console.warn('[JUNGGAE] receiver unavailable');}
  }
 }catch{console.warn('[JUNGGAE] detection storage unavailable');}
 return false;
}
module.exports={handle,matches};
