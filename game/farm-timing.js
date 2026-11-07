'use strict';
// Planting and harvesting are persisted phases. Settlement is idempotent:
// removing paid plots and updating wallet happen in one transaction.
const PLANT_MS=5000;
const HARVEST_MS=5000;
const fmt=n=>Number(n).toLocaleString('ko-KR');
async function settleHarvest({pool,room,user,crops,now=Date.now}){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const roomRow=await db.query('SELECT data FROM hz_rooms WHERE room_id=$1 FOR UPDATE',[String(room)]);
  const farmRow=await db.query('SELECT plots FROM gl_farms WHERE room_id=$1 AND user_id=$2 FOR UPDATE',[String(room),String(user)]);
  if(!farmRow.rows.length){await db.query('COMMIT');return null;}
  const plots={...(farmRow.rows[0].plots||{})};
  const when=now();
  let count=0,coins=0;
  const detail=[];
  for(const [key,planted] of Object.entries(plots)){
   const deadline=Number(planted?.harvestReadyAt)||0;
   if(!deadline||deadline>when)continue;
   const crop=crops.find(x=>x.name===planted.crop);
   if(!crop)throw Error('Unknown crop awaiting harvest: '+planted.crop);
   count++;coins+=crop.sale;
   detail.push(crop.emoji+' '+crop.name);
   delete plots[key];
  }
  if(!count){await db.query('COMMIT');return null;}
  if(!Number.isSafeInteger(coins))throw Error('Unsafe harvest amount');
  const wallet=await db.query(
   'UPDATE hz_wallets SET balance=balance+$3::bigint WHERE room_id=$1 AND user_id=$2 AND balance+$3::bigint BETWEEN 0 AND 9007199254740991 RETURNING balance',
   [String(room),String(user),coins]);
  if(!wallet.rowCount)throw Error('Harvest wallet update failed');
  await db.query('UPDATE gl_farms SET plots=$3::jsonb,updated_at=NOW() WHERE room_id=$1 AND user_id=$2',
   [String(room),String(user),JSON.stringify(plots)]);
  await db.query('INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail) VALUES($1,$2,$3,$4,$5)',
   [String(room),String(user),'FARM_HARVEST',coins,'수확 완료 '+count+'개']);
  const data=roomRow.rows[0]?.data;
  if(data?.players?.[String(user)]){
   data.players[String(user)].points=Number(wallet.rows[0].balance);
   await db.query('UPDATE hz_rooms SET data=$2::jsonb,updated_at=NOW() WHERE room_id=$1',
    [String(room),JSON.stringify(data)]);
  }
  await db.query('COMMIT');
  return {count,coins,detail};
 }catch(error){
  await db.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{db.release();}
}
async function updateFarmMessage({ctx,receipt,text}){
 const chat=ctx.chat||ctx.client?.chat||ctx.client;
 const logId=receipt?.body?.logId??receipt?.logId;
 const edit=typeof chat?.editMessage==='function'
  ? chat.editMessage.bind(chat)
  :typeof ctx.client?.editMessage==='function'
   ?ctx.client.editMessage.bind(ctx.client):null;
 if(edit&&logId!=null&&String(logId)!=='0'){
  try{
   const response=await edit(ctx.roomId,logId,text);
   const status=response?.status??response?.body?.status;
   if(response!==false&&response?.success!==false&&
      (status==null||Number(status)===0))return 'edited';
   console.warn('[FARM EDIT]', 'rejected status='+String(status));
  }catch(error){
   console.warn('[FARM EDIT]',String(error?.message||error));
  }
 }
 // Preserve completion feedback even when the Kakao API cannot edit a message.
 await ctx.send(text);
 return 'fallback';
}
function harvestNotice({name,settled}){
 return '🌾 NEXI | 수확 완료\n'+String(name)+'님, 작물 '+settled.count+'개 수확 완료!\n💰 +'+fmt(settled.coins)+'코인 지급';
}
module.exports={PLANT_MS,HARVEST_MS,settleHarvest,updateFarmMessage,harvestNotice};
