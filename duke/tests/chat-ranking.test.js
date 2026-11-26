'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCore}=require('../core'),{createActivity}=require('../manage/activity'),{createChatRanking}=require('../utility/chat-ranking');
test('chat rankings use shared room counts, top ten, folded pages, own rank and ties',async()=>{
 let at=0;const a=createActivity({botId:()=> '9000'}),out=[],core=createCore({send:async(r,t)=>out.push(t)});
 let log=10000;
 const chat=(r,u,name)=>a.chat({room:{isOpenChat:true},message:{type:1,logId:String(++log)},sender:{name}},{roomId:r,userId:u});
 for(let i=0;i<102;i++){const u=String(3000+i);chat('1000',u,'회원'+i);}
 chat('1000','3000','새이름');chat('1000','3001','회원1');chat('2000','3000','다른방');chat('1000','9000','봇');
 createChatRanking({list:a.list,now:()=>at}).register(core);
 const run=async(text)=>{at+=4000;await core.handle({text,roomId:'1000',userId:'3000',msg:{room:{isOpenChat:true},sender:{name:'새이름'}}});return out.at(-1);};
 const top=await run('-채팅순위');assert.match(top,/집계 인원 : 102명/);assert.match(top,/1위 \| 새이름 : 2회/);assert.match(top,/1위 \| 회원1 : 2회/);assert.equal(top.match(/위 \|/g).length,10);assert.match(top,/\u200b{1200}/);assert.doesNotMatch(top,/전체 순위 : -채팅순위전체/);assert.match(top,/▰{10}/);assert.doesNotMatch(top.split('\u200b'.repeat(1200))[0],/새이름/);
 const all=await run('-채팅순위전체');assert.match(all,/\u200b{1200}/);assert.equal(all.split('\n').filter(l=>/^\d+\. /.test(l)).length,100);
 assert.equal((await run('-채팅순위전체 2')).split('\n').filter(l=>/^\d+\. /.test(l)).length,2);
 assert.match(await run('-내채팅'),/현재 순위 : 1위 \/ 52명/);assert.match(out.at(-1),/전체 채팅량 : 2회/);
 assert.equal(a.list('2000').length,1);
 a.close();
});
