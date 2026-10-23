'use strict';
const {getPool}=require('../shared/db');
const coin=require('./coin');
async function handle(ctx,client){
 const {text,roomId,userId,userName,send,msg}=ctx;
 if(/^#(?:치트|회수)(?:\s|$)/.test(text)){
  const owners=String(process.env.HZ_OWNER_IDS||process.env.HZ_OWNER_ID||'').split(/[\s,;]+/);
  if(!ctx.isBotAccount&&!owners.includes(String(userId))){await send('⛔ 최고 관리자만 사용할 수 있습니다.');return true;}
  try{
   const match=/^#(치트|회수)\s+(all|[1-9]\d*)\s+.+$/i.exec(text);if(!match||match[1]==='치트'&&match[2].toLowerCase()==='all')throw Error('사용법: !치트 (금액) (@멘션) 또는 !회수 (금액 또는 all) (@멘션)');
   if(!coin.messageKey(msg))throw Error('메시지 고유번호가 필요합니다.');
   const target=coin.mentionTarget(msg);
   await require('./economy').ensureLinked(String(roomId),target.id,target.name);
   let n;
   if(match[2].toLowerCase()==='all'){const r=await getPool().query('SELECT balance FROM hz_wallets WHERE room_id=$1 AND user_id=$2',[String(roomId),target.id]);n=coin.validAmount(r.rows[0]?.balance||0);}else n=coin.validAmount(match[2]);
   const r=await require('./admin-coins').adjust({room:String(roomId),user:target.id,name:target.name,actor:String(userId),amount:match[1]==='치트'?n:-n,operationId:'kakao:'+String(roomId)+':'+String(coin.messageKey(msg)||''),reason:match[1]});
   await send(`✅ ${target.name}님 코인 조정 완료\n잔액: ${Number(r.balance).toLocaleString('ko-KR')}코인`);
  }catch(e){await send('❌ '+e.message);}return true;
 }
 if(/^#송금(?:\s|$)/.test(text)){await require('./economy').ensureLinked(String(roomId),String(userId),userName);await coin.handleCoinCommand({...ctx,text:text.replace('#송금','#코인송금'),chat:ctx.chat});return true;}
 if(text==='#게임순위'){await send(await require('./wallet').coinRanking(String(roomId)));return true;}
 return false;
}
module.exports={handle};
