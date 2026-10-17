'use strict';
const {getPool}=require('../shared/db');
const {transaction,audit}=require('../shared/store');
const {ensureWallet}=require('./wallet');
const {ensureLinked}=require('./economy');
async function adjust({room,user,name,actor,amount,operationId,reason='관리자 조정'}){
 if(!Number.isSafeInteger(amount)||amount===0||Math.abs(amount)>1e9)throw Error('조정 금액은 1~10억 코인입니다.');
 if(!/^[\w:-]{1,160}$/.test(String(operationId||'')))throw Error('요청 고유번호가 필요합니다.');
 await ensureLinked(room,user,name);
 return transaction(async db=>{
  const r=await db.query('INSERT INTO gl_admin_operations(operation_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING operation_id',[operationId]);
  if(!r.rowCount)throw Error('이미 처리된 요청입니다.');
  await ensureWallet(db,String(room),String(user),name||'알 수 없음');
  const result=await db.query('UPDATE hz_wallets SET balance=balance+$3 WHERE room_id=$1 AND user_id=$2 AND balance+$3>=0 AND balance+$3<=$4 RETURNING balance',[String(room),String(user),amount,Number.MAX_SAFE_INTEGER]);
  if(!result.rowCount)throw Error('잔액이 부족하거나 안전한 코인 한도를 초과합니다.');
  await db.query('INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail) VALUES($1,$2,$3,$4,$5)',[String(room),String(user),amount>0?'ADMIN_GRANT':'ADMIN_RECLAIM',amount,reason]);
  await audit(db,actor,'COIN_ADJUST',String(room),String(user),{amount,reason,operationId});
  return {balance:String(result.rows[0].balance)};
 });
}
module.exports={adjust};

