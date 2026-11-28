'use strict';
const stats=require('./valorant-stats');
function registerValorant(core,{env=process.env,fetcher}={}){
 core.register({name:'발로전적',section:'VALORANT',description:'닉네임#태그 [서버] · 전적 조회 (개인 2분 쿨타임)',execute:async e=>{
  let response;
  await stats.handle({text:'!발로전적 '+e.args.join(' '),roomId:e.roomId,userId:e.userId,env,fetcher,send:async text=>{response=String(text).replaceAll('!발로전적','-발로전적');}});
  return response;
 }});
}
module.exports={registerValorant};
