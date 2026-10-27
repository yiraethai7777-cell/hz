'use strict';
const {getPool}=require('./db');
const recent=new Map();
let setup;
async function db(){
  if(!setup) setup=getPool().query('CREATE TABLE IF NOT EXISTS junggae_subscriptions (room_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL, PRIMARY KEY(room_id,user_id))').catch(e=>{setup=null;throw e});
  await setup;return getPool();
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
async function handle({client,chat,msg,roomId,text,isBotAccount}){
 const id=String(roomId), sender=String(msg.sender?.id??msg.senderId??'');
 const watch=(process.env.JUNGGAE_WATCH_ROOM_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
 const send=(room,body)=>typeof chat?.sendText==='function'?chat.sendText(room,body):client.sendText(room,body);
 if(text==='!알람받기'||text==='!알람끄기'){
   if(isBotAccount||!sender)return true;
   try{
     const pool=await db();
     if(text==='!알람받기'){
       await pool.query('INSERT INTO junggae_subscriptions(room_id,user_id,user_name) VALUES($1,$2,$3) ON CONFLICT(room_id,user_id) DO UPDATE SET user_name=EXCLUDED.user_name',[id,sender,String(msg.sender?.name||'사용자')]);
       await send(roomId,'🔔 준개 알림 등록 완료');
     }else{
       await pool.query('DELETE FROM junggae_subscriptions WHERE room_id=$1 AND user_id=$2',[id,sender]);
       await send(roomId,'🔕 준개 알림 해제 완료');
     }
   }catch(e){console.error('[JUNGGAE] subscription:',e);await send(roomId,'알림 설정 실패. Railway 로그를 확인해 주세요.');}
   return true;
 }
 if(!watch.includes(id)||isBotAccount||!matches(text))return false;
 const key=id+':'+String(msg.message?.logId??msg.logId??msg.id??sender+':'+text);
 const now=Date.now();
 for(const [k,t] of recent)if(now-t>120000)recent.delete(k);
 if(recent.has(key))return false;
 recent.set(key,now);
 try{
   const pool=await db();
   const {rows}=await pool.query('SELECT room_id,user_id,user_name FROM junggae_subscriptions');
   const byRoom=new Map();
   for(const row of rows){
     if(row.room_id===id)continue;
     if(!byRoom.has(row.room_id))byRoom.set(row.room_id,[]);
     byRoom.get(row.room_id).push(row);
   }
   for(const [target,users] of byRoom){
     const mention=typeof chat?.mention==='function'?chat.mention.bind(chat):typeof client?.mention==='function'?client.mention.bind(client):null;
     if(!mention){console.warn('[JUNGGAE] mention unavailable');break;}
     const tags=users.map(u=>mention(u.user_id,u.user_name,target)).filter(x=>typeof x==='string'&&x.startsWith('\u0002')&&x.includes('\u0003')&&x.endsWith('\u0004'));
     if(!tags.length)continue;
     try{await send(target,tags.join(' ')+' 준개감지');}
     catch(e){console.error('[JUNGGAE] send:',e);}
   }
 }catch(e){console.error('[JUNGGAE] detection:',e);}
 return false;
}
module.exports={handle,matches};
