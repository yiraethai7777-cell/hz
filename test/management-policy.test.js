'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function load(relative,dependencies={},globals={}) {
  const module={exports:{}};
  const context={
    module,exports:module.exports,
    require(name) {
      if(Object.hasOwn(dependencies,name))return dependencies[name];
      throw Error('Unexpected test import '+name+' from '+relative);
    },
    console,process:{env:{}},setTimeout,clearTimeout,setInterval,clearInterval,
    Date,Buffer,URL,Intl,...globals
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',relative),'utf8'),context,{filename:relative});
  return module.exports;
}

function managementFixture() {
  let enabled=true,deleted=false;
  const sent=[],kicks=[],queries=[];
  const db={
    async query(sql,values=[]) {
      queries.push(String(sql));
      if(String(sql).includes('SELECT COALESCE((SELECT enabled FROM gl_manage_rooms'))
        return {rows:[{enabled}],rowCount:1};
      if(String(sql).includes('SELECT deleted_enabled FROM gl_manage_rooms'))
        return {rows:[{deleted_enabled:deleted}],rowCount:1};
      if(String(sql).includes('INSERT INTO gl_manage_rooms(room_id,enabled,deleted_enabled)')){
        deleted=values[1];return {rows:[],rowCount:1};
      }
      if(String(sql).includes('SELECT attended_at FROM hz_new_attendance'))
        return {rows:[],rowCount:0};
      return {rows:[],rowCount:0};
    }
  };
  const management=load('manage/index.js',{
    '../shared/db':{getPool:()=>db},
    './attendance':{initAttendance:async()=>{},attend:async()=>'',attendanceRanking:async()=>''},
    './targets':{mentions:()=>[]},
    './leave-reply':{handle:async()=>false}
  });
  async function emit(text,role=2,bot=false) {
    const start=sent.length;
    let lookedUp=0;
    const result=await management.message({
      client:{},roomId:'1849',userId:bot?'9999':'1111',userName:'Tester',
      text,senderType:role,isBotAccount:bot,botId:'9999',
      msg:{room:{id:'1849',isOpenChat:true},sender:{id:bot?'9999':'1111',type:role},message:{text}},
      send:async value=>{sent.push(value);},
      kick:async id=>{kicks.push(String(id));},
      resolveTarget:async()=>{lookedUp++;return {id:'5555',name:'Target',type:2};}
    });
    return {result,replies:sent.slice(start),lookedUp};
  }
  return {management,emit,sent,kicks,queries,db,
    setEnabled(value){enabled=value;},getDeleted(){return deleted;}};
}

test('IDs are disabled when management is off',async()=>{
  const f=managementFixture();f.setEnabled(false);
  assert.equal((await f.emit('#내아이디',1)).result,false);
  assert.equal((await f.emit('#아이디 5555',1)).result,false);
  assert.equal(f.sent.length,0);
});

test('IDs require actual owner or submanager role, not bot-account bypass',async()=>{
  const f=managementFixture();
  for(const cmd of ['#내아이디','#아이디 5555']){
    const denied=await f.emit(cmd,2,true);
    assert.match(denied.replies[0],/방장·부방장만/);
    assert.equal(denied.lookedUp,0);
    for(const role of [1,4]){
      const allowed=await f.emit(cmd,role);
      assert.equal(allowed.result,true);
      assert.doesNotMatch(allowed.replies[0],/⛔/);
    }
  }
});

test('attendance check is available only to managers and bot account',async()=>{
  const f=managementFixture();
  assert.match((await f.emit('#출석확인 5555',2)).replies[0],/방장·부방장.*봇 계정/);
  assert.match((await f.emit('#출석확인 5555',1)).replies[0],/출석/);
  assert.match((await f.emit('#출석확인 5555',4)).replies[0],/출석/);
  assert.match((await f.emit('#출석확인 5555',2,true)).replies[0],/출석/);
});

test('management records are restricted even if listed as an admin',async()=>{
  const f=managementFixture();
  for(const command of ['#벤기록','#벤기록 5555','#관리로그']){
    const denied=await f.emit(command,2);
    assert.match(denied.replies[0],/방장·부방장/);
    assert.equal(denied.lookedUp,0);
    const allowed=await f.emit(command,4);
    assert.match(allowed.replies[0],/관리 기록/);
  }
});

test('both #kick and #k work; retired #벤 and #경고순위 no longer run',async()=>{
  const f=managementFixture();
  for(const cmd of ['#kick 5555','#k 5555']){
    const r=await f.emit(cmd,1);
    assert.equal(r.result,true);
    assert.match(r.replies.at(-1),/강퇴 요청 완료/);
  }
  assert.equal(f.kicks.length,2);
  assert.deepEqual(f.kicks,['5555','5555']);
  assert.equal((await f.emit('#벤 5555',1)).result,false);
  assert.equal((await f.emit('#경고순위',1)).result,false);
  assert.equal(f.kicks.length,2);
});

test('delete enabled flag persists and the deleted handler honors OFF',async()=>{
  const f=managementFixture();
  assert.match((await f.emit('#삭제감지켜기',1)).replies[0],/켜졌습니다/);
  assert.equal(f.getDeleted(),true);
  let replies=[];
  await f.management.deleted({roomId:'1849',userId:'5555',userName:'Target',send:async x=>replies.push(x)});
  assert.equal(replies.length,1);
  assert.match((await f.emit('#삭제감지끄기',4)).replies[0],/꺼졌습니다/);
  assert.equal(f.getDeleted(),false);
  await f.management.deleted({roomId:'1849',userId:'5555',userName:'Target',send:async x=>replies.push(x)});
  assert.equal(replies.length,1);
});

test('leave reply uses k and rejects a',async()=>{
  const db={
    async query(sql){
      if(String(sql).startsWith('SELECT target_id,target_name,state'))return {rows:[{target_id:'5555',target_name:'Target',state:'pending'}]};
      if(String(sql).includes("state='sending'"))return {rows:[{target_id:'5555'}]};
      return {rows:[],rowCount:1};
    }
  };
  const leave=load('manage/leave-reply.js',{'lossless-json':{parse:JSON.parse}});
  const sent=[],kicks=[];
  const ctx={text:'k',msg:{raw:{chatLog:{threadId:'88888'}}},roomId:'1849',
    userId:'1111',senderType:1,botId:'9999',
    send:async x=>sent.push(x),kick:async id=>kicks.push(id)};
  assert.equal(await leave.handle({...ctx,text:'a'},db),false);
  assert.equal(await leave.handle(ctx,db),true);
  assert.deepEqual(kicks,['5555']);
  assert.match(sent[0],/벤했습니다/);
  assert.match(leave.leaveNotice({name:'Target',userId:'5555',joins:1,leaves:1,time:'now'}),/답장으로 'k'/);
});

test('real delete-event listener observes disabled setting',async()=>{
  let deleted=false,deleteCallback=null;
  const sent=[];
  const pool={
    async query(sql){
      if(String(sql).includes('SELECT deleted_enabled'))return {rows:[{deleted_enabled:deleted}]};
      return {rows:[]};
    }
  };
  const ctx={
    pool,id:x=>String(x),initDb:async()=>{},promoTick:async()=>{},autoFishTick:async()=>{},
    roomFlags:async()=>({manage:true,game:false,locked:false}),
    pickDeleteRoom:()=> '1849',pickDeleteActor:()=>({id:'5555',name:'Target'}),
    send:async(chat,id,text)=>sent.push(text)
  };
  const client={
    userId:'9999',chat:{},onMessage(){},onJoin(){},onLeave(){},onKick(){},
    onDelete(cb){deleteCallback=cb;}
  };
  const session=load('shared/session.js',{'../manage/leave-reply':{init:async()=>{}}},
    {setInterval:()=>({unref(){}})});
  await session(ctx).attachHZBot(client);
  assert.equal(typeof deleteCallback,'function');
  await deleteCallback({room:{id:'1849'}});
  assert.equal(sent.length,0);
  deleted=true;
  await deleteCallback({room:{id:'1849'}});
  assert.equal(sent.length,1);
  deleted=false;
  await deleteCallback({room:{id:'1849'}});
  assert.equal(sent.length,1);
});

test('help excludes retired commands and documents replacements',()=>{
  const help=load('shared/help.js');
  const output=help.formatCommandHelp({manage:true,game:false},'관리');
  assert.match(output,/#kick 대상 \/ #k 대상/);
  assert.match(output,/퇴장 알림에 댓글 k/);
  assert.doesNotMatch(output,/#경고순위/);
  assert.doesNotMatch(output,/#프로필진단/);
  assert.doesNotMatch(output,/#벤 ID/);
});
