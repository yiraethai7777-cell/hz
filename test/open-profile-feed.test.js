'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
require('ts-node/register/transpile-only');
const {extractFeedPayload}=require('../src/utils/feed');
const {KakaoForgeClient}=require('../src/client/client');
const {joinNotice,leaveNotice}=require('../manage/leave-reply');
const uid='9007199254740993123';
function client(){
 const c=Object.create(KakaoForgeClient.prototype);
 Object.assign(c,{_memberProfileLinkIds:new Map(),_memberNames:new Map(),_memberTypes:new Map(),_memberProfileTypes:new Map(),_chatRooms:new Map(),_resolveChatId:x=>x,_touchMemberCache:()=>{}});
 return c;
}
test('feed JSON tolerates invisible outer padding without modifying member names or IDs',()=>{
 const feed=extractFeedPayload({message:'\u200b\u2060'+JSON.stringify({feedType:4,member:{userId:uid,nickName:'A\u200bB',pli:'123'}})+'\u200f'},[]);
 assert.equal(feed.member.userId,uid);assert.equal(feed.member.nickName,'A\u200bB');
 for(const message of ['홍길동님이 들어왔습니다.','홍길동님이 나갔습니다.'])assert.equal(extractFeedPayload({message},[]),null);
});
test('member feed retains pli before event refs discard profile fields',async()=>{
 const c=client();let event;
 c._resolveFeedAction=()=> 'leave';c._buildMemberEvent=(action,room,opts)=>opts;c._emitMemberEvent=(action,ev)=>{event=ev;};
 c._emitMemberEventsFromMessage({room:{id:'100'},sender:{id:uid,name:'A'},attachmentsRaw:[]},{feed:{member:{userId:uid,nickName:'A',pli:'123',ptp:16}}});
 assert.equal(c._memberProfileLinkIds.get('100:'+uid),'123');assert.deepEqual(event.memberIds,[uid]);
 c._carriage={member:async()=>{throw Error('departed member');},infoLink:async()=>({status:0,body:{ols:[{li:'123',lu:'\u200bhttps://open.kakao.com/o/abc\u2060'}]}})};
 assert.equal(await c.getUserOpenProfileLink('100',uid),'https://open.kakao.com/o/abc');
});
test('missing, mismatched and failed link responses never fabricate a URL',async()=>{
 const c=client();c._memberProfileLinkIds.set('100:'+uid,'123');
 for(const response of [
 {status:0,body:{ols:[]}},
 {status:'-1',body:{ols:[{li:'123',lu:'https://open.kakao.com/o/abc'}]}},
 {status:0,body:{ols:[{li:'456',lu:'https://open.kakao.com/o/abc'}]}},
 {status:0,body:{ols:[{li:'123',lu:'https://evil.example/o/abc'}]}},
 {status:0,body:{ols:[{li:'123',lu:'https://user@open.kakao.com/o/abc'}]}}
 ]){c._carriage={infoLink:async()=>response};assert.equal(await c.getUserOpenProfileLink('100',uid),'');}
 for(const notice of [joinNotice,leaveNotice]){
 const text=notice({name:'A',userId:uid});
 assert.equal(text.includes('https://open.kakao.com/'),false);
 assert.match(text,/오픈프로필 URL\s+확인 불가/);
 assert.equal(text.split('\u200b'.repeat(1200)).length,2);
 }
});
