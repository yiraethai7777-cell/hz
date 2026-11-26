'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProfileWatch}=require('../manage/profile-watch'),{createCore}=require('../core'),{tableFor}=require('../database');
test('profile watch: opt in, baseline, rename, profile switch, photo, missing fields, off and restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-watch-')),out=[],keys=[];let w,at=0,rows=[{id:'3000',nickName:'이전',ptp:3,pli:'4000',opi:'https://k.kakaocdn.net/a'}],calls=0;
 try{
  const opts={dir,now:()=>at,botId:()=> '9000',listRooms:async()=>['1000'],fetchRoster:async()=>{calls++;return rows;},send:async(r,t)=>out.push(t),onPersist:k=>keys.push(k)};
  const core=createCore({send:opts.send});w=createProfileWatch(opts);w.register(core);
  const cmd=(text,u='9000')=>core.handle({roomId:'1000',userId:u,text,msg:{room:{isOpenChat:true},sender:{name:'봇'}}});
  const tick=async()=>{at+=16000;await w.tick();};
  await tick();assert.equal(calls,0);await cmd('-닉변감지 on','5000');assert.match(out.at(-1),/봇 계정/);
  await cmd('-닉변감지 on');await cmd('-프로필감지 on');const before=out.length;await tick();assert.equal(out.length,before);
  rows=[{...rows[0],nickName:'새이름'}];await tick();assert.match(out.at(-1),/이전 → 새이름/);
  rows=[{...rows[0],pli:'4001',opi:'https://k.kakaocdn.net/b'}];await tick();assert.match(out.at(-1),/오픈프로필, 프로필 사진 변경/);
  const n=out.length;rows=[{id:'3000',nickName:'새이름'}];await tick();assert.equal(out.length,n);
  await cmd('-닉변감지 off');await cmd('-프로필감지 off');const c=calls;await tick();assert.equal(calls,c);
  await cmd('-닉변감지 on');w.stop();w=createProfileWatch(opts);const next=createCore({send:opts.send});w.register(next);await tick();assert.equal(calls,c+1);assert.equal(tableFor(keys[0]),'duke_profile_watch_settings');
 }finally{w?.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
