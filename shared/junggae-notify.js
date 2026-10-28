'use strict';
const {getPool}=require('./db');
const recent=new Map();
let setup;
let singletonSetup;
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
function matches(input){
 const s=String(input||'').normalize('NFKC').trim();
 if(!s||s.startsWith('!')||s.startsWith('#'))return false;
 const compact=s.replace(/\s+/g,'');
 const roles=/구매자\s*[:：]/.test(s)&&/판매자\s*[:：]/.test(s);
 const mentionCount=(s.match(/@\S+/g)||[]).length;
 const request=/(?:준개|중개|ㅈㄱ)(?:ㅇ9|9|구함|구해|구합니다|요청|부탁|좀|$)/.test(compact);
 const price=/(?:^|[\s(（])\d+(?:\.\d+)?(?:만|원)?(?=$|[\s)）])/m.test(s);
 const item=/동타디|포세|승총|얼불수|아이템|템|구매|판매|거래/.test(s);
 return roles||(request&&(mentionCount>0||item||s.length<35))||(mentionCount>=2&&price&&item);
}
async function handle({client,chat,msg,roomId,text,isBotAccount,allowBotSubscription=false}){
 const id=String(roomId), sender=String(msg.sender?.id??msg.senderId??'');
 const watch=(process.env.JUNGGAE_WATCH_ROOM_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
 const roomName=String(msg?.room?.name??msg?.room?.title??'').normalize('NFKC').replace(/\s+/g,'').trim();
 const watchedByName=msg?.room?.isOpenChat===true&&roomName==='통합중걔방';
 const send=(room,body)=>typeof chat?.sendText==='function'?chat.sendText(room,body):client.sendText(room,body);
 if(/^!준개알람(?:받기|끄기)(?:\\s|$)/.test(text)){
   if(!isBotAccount)return true;
   const action=text.split(/\\s+/,1)[0];
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
 if((!watch.includes(id)&&!watchedByName)||isBotAccount||!matches(text))return false;
 const key=id+':'+String(msg.message?.logId??msg.logId??msg.id??sender+':'+text);
 const now=Date.now();
 for(const [k,t] of recent)if(now-t>120000)recent.delete(k);
 if(recent.has(key))return false;
 recent.set(key,now);
 try{
   const pool=await db();
   const {rows}=await pool.query('SELECT room_id,user_id,user_name FROM junggae_subscriptions WHERE room_id<>$1 ORDER BY room_id,user_id',[id]);
   const mention=typeof chat?.mention==='function'?chat.mention.bind(chat):typeof client?.mention==='function'?client.mention.bind(client):null;
   for(const receiver of rows){
     try{
       const marker=mention?.(receiver.user_id,receiver.user_name,receiver.room_id);
       if(typeof marker==='string'&&marker.startsWith('\\u0002')&&marker.includes('\\u0003')&&marker.endsWith('\\u0004'))
         await send(receiver.room_id,marker+' 준개감지');
       else console.warn('[JUNGGAE] real mention unavailable',receiver.room_id);
     }catch(e){console.error('[JUNGGAE] notify receiver failed',receiver.room_id,e);}
   }
 }catch(e){console.error('[JUNGGAE] detection:',e);}
 return false;
}
module.exports={handle,matches};
