'use strict';
const fs=require('node:fs'),path=require('node:path');
const {format}=require('../core');
const STARTING_COINS=10000;
const id=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v)?v:'';
const clean=v=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,80).join('')||'사용자';
function createGameAccounts({dir,botId=()=>'',now=Date.now,onPersist=()=>{}}={}){
 if(!dir)throw Error('game data directory required');
 const root=path.join(dir,'game-accounts');fs.mkdirSync(root,{recursive:true,mode:0o700});
 function read(r){try{const data=JSON.parse(fs.readFileSync(path.join(root,r+'.json'),'utf8'));if(!data||!data.users||typeof data.users!=='object'||Array.isArray(data.users))throw Error('invalid game accounts');return data;}catch(e){if(e.code==='ENOENT')return {users:{}};throw e;}}
 function get(r,u){if(!id(r)||!id(u))return null;return read(r).users[u]??null;}
 function register(core){core.register({name:'게임가입',section:'GAME',description:'게임 계정 생성',execute:e=>{
  const r=id(e.roomId),u=id(e.userId),name=clean(e.msg?.sender?.name);
  if(!r||!u||e.msg?.room?.isOpenChat!==true)return format('GAME','오픈채팅방에서만 가입할 수 있습니다.');
  if(e.args.length)return format('GAME','사용법 : -게임가입');
  const data=read(r);
  if(Object.hasOwn(data.users,u))return format('GAME',name+'님은 이미 게임에 가입하셨습니다.');
  const account={joinedAt:now(),coins:STARTING_COINS,inventory:{}};
  data.users[u]=account;
  const file=path.join(root,r+'.json'),tmp=file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});fs.renameSync(tmp,file);onPersist('game-accounts/'+r+'.json');
  return format('GAME',name+'님의 게임 가입이 완료되었습니다.\n\n보유 코인 : '+account.coins.toLocaleString('ko-KR')+' 코인\n가입일 : '+new Date(account.joinedAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}));
 }});}
 return {register,get};
}
module.exports={createGameAccounts};
