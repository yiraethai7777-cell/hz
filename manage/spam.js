'use strict';
const versions=new Map();
function reset(room){const key=String(room);versions.set(key,(versions.get(key)||0)+1);}
function clean(value){
 if(typeof value==='bigint')return value.toString();
 if(Array.isArray(value))return value.map(clean);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.keys(value).sort().filter(k=>!/^(log_?id|message_?id|timestamp|sentAt|createdAt)$/i.test(k)).map(k=>[k,clean(value[k])]));
}
function fingerprint(msg,text){
 const type=Number(msg.message?.type??msg.type??1);
 if([12,20,25].includes(type)){
  let attachment=msg.attachmentsRaw;
  if(!attachment?.length)attachment=msg.raw?.chatLog?.attachment??msg.raw?.attachment;
  if(typeof attachment==='string'){try{attachment=JSON.parse(attachment);}catch{return '';}}
  if(!attachment||(Array.isArray(attachment)&&!attachment.length))return '';
  return 'E:'+type+':'+JSON.stringify(clean(attachment));
 }
 const value=String(text||'').normalize('NFKC').trim();
 return [1,26].includes(type)&&value?'T:'+value:'';
}
async function check(ctx,msg,chat,rid,uid,name,text,isSelf,flags){
 const room=String(rid),user=String(uid),key=room+':'+user;
 if(isSelf||Number(msg.sender?.type)===8||ctx.isOwnerType(msg.sender?.type)||!flags.manage||flags.locked){ctx.spamState.delete(key);return false;}
 const settings=await ctx.pool.query('SELECT spam_enabled FROM gl_manage_rooms WHERE room_id=$1',[room]);
 if(settings.rows[0]?.spam_enabled===false){ctx.spamState.delete(key);return false;}
 const fp=fingerprint(msg,text);
 if(!fp){ctx.spamState.delete(key);return false;}
 const revision=versions.get(room)||0,old=ctx.spamState.get(key);
 const messageId=msg.id??msg.message?.id??msg.logId;
 const seen=old?.revision===revision?(old.seen||[]):[];
 if(messageId!=null&&seen.includes(String(messageId)))return false;
 const cur={fp,revision,count:old?.revision===revision&&old.fp===fp?old.count+1:1,
  seen:messageId==null?seen:[...seen,String(messageId)].slice(-20)};
 ctx.spamState.set(key,cur);
 if(cur.count===4){
  await ctx.pool.query('INSERT INTO gl_manage_warnings(room_id,user_id,user_name,reason,issuer_id) VALUES($1,$2,$3,$4,$5)',[room,user,name,'동일 글·이모티콘 4회 연속 도배',String(ctx.globalBotId)]);
  await ctx.pool.query("INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,'AUTO_WARNING',$4)",[room,String(ctx.globalBotId),user,'동일 글·이모티콘 4회 연속: 경고 1개']);
  await ctx.send(chat,room,`⚠️ ${name}님에게 경고 1개를 부여했습니다.\n이유: 동일 글·이모티콘 4회 연속 도배`);
 }
 if(cur.count===10){
  try{
   await ctx.kickMember(msg,user);
   await ctx.pool.query("INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,'AUTO_BAN',$4)",[room,String(ctx.globalBotId),user,'동일 글·이모티콘 10회 연속 도배']);
   await ctx.send(chat,room,`🚫 ${name}님을 벤했습니다.\n이유: 동일 글·이모티콘 10회 연속 도배`);
  }catch(e){await ctx.send(chat,room,`⚠️ ${name}님의 10회 연속 도배를 감지했지만 벤에 실패했습니다.\n봇의 방장·부방장 권한을 확인해 주세요.`);console.error('[GL AUTO BAN]',e.message);}
  ctx.spamState.delete(key);return true;
 }
 return false;
}
module.exports={check,fingerprint,reset};
