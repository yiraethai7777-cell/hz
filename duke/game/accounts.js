'use strict';
const fs=require('node:fs'),path=require('node:path');
const {format,fold}=require('../core'),{mentions,reference}=require('../manage/targets');
const STARTING_COINS=10000,LINE='━━━━━━━━━━━━━━',MAX_ROOMS=64,MAX_RECEIPTS=2048;
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
const clean=v=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,80).join('');
const num=v=>v.toLocaleString('ko-KR'),validCoins=v=>Number.isSafeInteger(v)&&v>=0;
function createGameAccounts({dir,now=Date.now,onPersist=()=>{},getName=()=>'',fetchMessage=async()=>null,canHandle=()=>true}={}){
 if(!dir)throw Error('game data directory required');
 const root=path.join(dir,'game-accounts'),cache=new Map();fs.mkdirSync(root,{recursive:true,mode:0o700});
 function remember(r,data){cache.delete(r);cache.set(r,{data,ranks:null});while(cache.size>MAX_ROOMS)cache.delete(cache.keys().next().value);return cache.get(r);}
 function read(r){
  if(cache.has(r)){const entry=cache.get(r);cache.delete(r);cache.set(r,entry);return entry;}
  let data;try{data=JSON.parse(fs.readFileSync(path.join(root,r+'.json'),'utf8'));if(!data||!data.users||typeof data.users!=='object'||Array.isArray(data.users))throw Error('invalid game accounts');}catch(e){if(e.code!=='ENOENT')throw e;data={users:{}};}
  return remember(r,data);
 }
 function save(r,data){const file=path.join(root,r+'.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});fs.renameSync(tmp,file);remember(r,data);onPersist('game-accounts/'+r+'.json');}
 function get(r,u){if(!id(r)||!id(u))return null;const a=read(r).data.users[u];return a?structuredClone(a):null;}
 function nameOf(r,u,a,preferred){return clean(preferred||getName(r,u)||a?.name)||'이름 미확인';}
 function ranks(entry){if(entry.ranks)return entry.ranks;const rows=Object.entries(entry.data.users).filter(([u,a])=>id(u)&&validCoins(a?.coins)).map(([u,a])=>({id:u,coins:a.coins,name:a.name})).sort((a,b)=>b.coins-a.coins||a.id.localeCompare(b.id));let rank=0,prev=null;for(let i=0;i<rows.length;i++){if(rows[i].coins!==prev)rank=i+1;rows[i].rank=rank;prev=rows[i].coins;}return entry.ranks=rows;}
 const error=s=>format('GAME',s),usage='사용법 : -송금 @유저 금액\n또는 대상 메시지에 답장으로 -송금 금액';
 function scope(e){return id(e.roomId)&&id(e.userId)&&e.msg?.room?.isOpenChat===true;}
 function join(e){
  const r=e.roomId,u=e.userId,name=nameOf(r,u,null,e.msg?.sender?.name);
  if(e.args.length)return error('사용법 : -게임가입');
  const data=read(r).data;if(Object.hasOwn(data.users,u))return error(name+'님은 이미 게임에 가입하셨습니다.');
  const account={joinedAt:now(),coins:STARTING_COINS,inventory:{},name};
  save(r,{...data,users:{...data.users,[u]:account}});
  return format('GAME',name+'님의 게임 가입이 완료되었습니다.\n\n보유 코인 : '+num(account.coins)+' 코인\n가입일 : '+new Date(account.joinedAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}));
 }
 function wallet(e){
  if(e.args.length)return error('사용법 : -지갑');
  const r=e.roomId,u=e.userId,entry=read(r),a=entry.data.users[u];
  if(!a)return error('먼저 -게임가입을 해주세요.');if(!validCoins(a.coins))return error('잔액을 확인할 수 없습니다.');
  const rank=ranks(entry).find(v=>v.id===u)?.rank;
  return format('WALLET',nameOf(r,u,a,e.msg?.sender?.name)+'님의 지갑\n\n보유 코인 : '+num(a.coins)+' 코인\n재산 순위 : '+rank+'위\n'+LINE);
 }
 function ranking(e){
  if(e.args.length)return error('사용법 : -코인순위');
  const r=e.roomId,rows=ranks(read(r));
  if(!rows.length)return format('RANKING','아직 게임 가입자가 없습니다.');
  const top=rows.slice(0,10),max=top[0].coins;
  const graph=v=>{const n=max?Math.min(10,Math.max(v.coins?1:0,Math.round(v.coins/max*10))):0;return '▰'.repeat(n)+'▱'.repeat(10-n);};
  return fold(format('RANKING','코인 순위 TOP 10\n가입 인원 : '+num(rows.length)+'명'),LINE+'\n[ TOP 10 ]\n\n'+top.map(v=>v.rank+'위 | '+nameOf(r,v.id,v)+' : '+num(v.coins)+' 코인\n'+graph(v)).join('\n\n')+'\n'+LINE);
 }
 async function transfer(e){
  const r=e.roomId,u=e.userId;
  const rawAmount=e.args.at(-1);if(!rawAmount||!/^[1-9]\d{0,15}$/.test(rawAmount))return error(usage);
  const amount=Number(rawAmount);if(!validCoins(amount)||!amount)return error('송금 금액은 양의 정수만 가능합니다.');
  const log=id(e.msg?.message?.logId??e.msg?.logId??e.msg?.raw?.chatLog?.logId);if(!log)return error('송금 요청 ID를 확인할 수 없습니다.');
  const tagged=mentions(e.msg),ref=reference(e.msg);
  let target,name='';
  if(tagged.length===1&&!ref&&e.args.length>=2&&e.args[0].startsWith('@')){target=id(tagged[0].id);name=tagged[0].name;}
  else if(!tagged.length&&ref?.logId&&e.args.length===1){
   let msg;try{msg=await fetchMessage(r,ref.logId);}catch{return error('답장 대상을 확인할 수 없습니다.');}
   if(id(msg?.room?.id??msg?.chatId)!==r||id(msg?.message?.logId??msg?.logId)!==ref.logId)return error('답장 대상을 확인할 수 없습니다.');
   target=id(msg?.sender?.id??msg?.senderId);name=msg?.sender?.name||'';
   if(ref.userId&&ref.userId!==target)return error('답장 대상을 확인할 수 없습니다.');
  }else return error(usage);
  if(!target)return error('받는 사람을 확인할 수 없습니다.');
  if(target===u)return error('자기 자신에게 송금할 수 없습니다.');
  // Recheck power and read latest balances after any asynchronous reply lookup.
  if(!canHandle(e))return null;
  const data=read(r).data,receipt=data.transfers??{};
  if(Object.hasOwn(receipt,log))return null;
  const from=data.users[u],to=data.users[target];
  if(!from)return error('먼저 -게임가입을 해주세요.');
  if(!to)return error('받는 사람이 게임에 가입하지 않았습니다.');
  if(!validCoins(from.coins)||!validCoins(to.coins))return error('잔액을 확인할 수 없습니다.');
  if(from.coins<amount)return error('보유 코인이 부족합니다.\n보유 코인 : '+num(from.coins)+' 코인');
  if(!validCoins(to.coins+amount))return error('받는 사람의 코인 한도를 초과합니다.');
  const fromName=nameOf(r,u,from,e.msg?.sender?.name),toName=nameOf(r,target,to,name);
  const remaining=from.coins-amount;
  // One atomic file replacement holds both balances and the replay receipt.
  const receipts={...receipt,[log]:{from:u,to:target,amount,at:now()}};
  const keys=Object.keys(receipts);for(const key of keys.slice(0,Math.max(0,keys.length-MAX_RECEIPTS)))delete receipts[key];
  save(r,{...data,users:{...data.users,[u]:{...from,coins:remaining,name:fromName},[target]:{...to,coins:to.coins+amount,name:toName}},transfers:receipts});
  return format('TRANSFER','송금이 완료되었습니다.\n\n보낸 사람 : '+fromName+'\n받는 사람 : '+toName+'\n송금 금액 : '+num(amount)+' 코인\n남은 잔액 : '+num(remaining)+' 코인\n'+LINE);
 }
 function register(core){for(const [name,description,fn] of [['게임가입','게임 계정 생성',join],['지갑','보유 코인 및 재산 순위',wallet],['송금','코인 송금 (멘션 / 답장)',transfer],['코인순위','현재 방 코인 순위 TOP 10',ranking]])core.register({name,section:'GAME',description,execute:e=>scope(e)?fn(e):error('오픈채팅방에서만 사용할 수 있습니다.')});}
 return {register,get};
}
module.exports={createGameAccounts};
