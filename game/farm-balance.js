'use strict';

// PostgreSQL NUMERIC returns exact decimal text. Never round an authoritative
// wallet amount through Number: admin grants may exceed Number.MAX_SAFE_INTEGER.
function exactBalance(raw){
 const value=String(raw??'');
 if(!/^\d+$/.test(value))throw Error('지갑 잔액 형식이 올바르지 않습니다.');
 const amount=BigInt(value);
 if(amount<0n)throw Error('지갑 잔액이 음수입니다.');
 return amount;
}
// The legacy game engine intentionally exposes only a bounded safe-number
// window; the full balance remains authoritative in hz_wallets (NUMERIC).
const GAMEPLAY_WINDOW=1000000000000n;
function gameplayBalance(raw){
 const balance=exactBalance(raw);
 return Number(balance>GAMEPLAY_WINDOW?GAMEPLAY_WINDOW:balance);
}
const formatAmount=value=>(typeof value==='bigint'?value:BigInt(String(value))).toLocaleString('ko-KR');
module.exports={exactBalance,gameplayBalance,formatAmount,GAMEPLAY_WINDOW};
