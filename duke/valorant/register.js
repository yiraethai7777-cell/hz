'use strict';
const stats=require('./valorant-stats');
const {createSavedAccounts,MAX_SAVED}=require('./saved-accounts');
const {format}=require('../core');
function registerValorant(core,{env=process.env,fetcher,dir,onPersist}={}){
 const accounts=createSavedAccounts({dir,onPersist});
 const reply=body=>format('VALORANT',body);
 core.register({name:'발로전적',section:'VALORANT',description:'닉네임#태그 [서버] 또는 저장 번호 · 개인 2분 쿨타임',execute:async e=>{
  let input=e.args.join(' ');
  if(e.args.length===1&&/^\d+$/.test(input)){
   try{
    const account=accounts.list(e.userId)[Number(input)-1];
    if(!account)return reply('저장된 계정 번호를 확인해 주세요. (-발로저장)');
    input=account.name+'#'+account.tag+' '+account.region;
   }catch{return reply('저장된 계정을 불러오지 못했습니다.');}
  }
  let response;
  await stats.handle({text:'!발로전적 '+input,roomId:e.roomId,userId:e.userId,env,fetcher,send:async text=>{response=String(text).replaceAll('!발로전적','-발로전적');}});
  return response;
 }});
 core.register({name:'발로저장',section:'VALORANT',description:'닉네임#태그 [서버] · 계정 저장 / 저장 목록',execute:async e=>{
  const input=e.args.join(' ').trim();
  if(!input){
   try{
    const rows=accounts.list(e.userId);
    return reply(rows.length?'저장된 계정 ('+rows.length+'/'+MAX_SAVED+')\n\n'+rows.map((r,i)=>(i+1)+'. '+r.name+'#'+r.tag+' · '+r.region.toUpperCase()).join('\n')+'\n\n조회 : -발로전적 번호':'저장된 계정이 없습니다.\n사용법 : -발로저장 닉네임#태그 [서버]');
   }catch{return reply('저장된 계정을 불러오지 못했습니다.');}
  }
  const target=stats.parse('!발로전적 '+input);
  if(!target||target.usage||target.error)return reply((target?.error||'Riot ID를 입력해 주세요.')+'\n사용법 : -발로저장 닉네임#태그 [서버]');
  try{
   const saved=accounts.save(e.userId,target);
   if(saved.full)return reply('계정은 최대 '+MAX_SAVED+'개까지 저장할 수 있습니다.');
   return reply((saved.already?'이미 저장된 계정입니다.':'계정을 저장하였습니다.')+'\n\n'+saved.index+'. '+target.name+'#'+target.tag+' · '+target.region.toUpperCase()+'\n저장 계정 : '+saved.count+'/'+MAX_SAVED+'개');
  }catch{return reply('계정을 저장하지 못했습니다.');}
 }});
}
module.exports={registerValorant};
