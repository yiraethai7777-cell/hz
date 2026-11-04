'use strict';
const {getPool}=require('./db');
const {fold}=require('./valorant-more');
const recruit=require('./valorant-recruit-reply');
const COMMANDS=new Set(['!파티모집','!파티참가','!파티퇴장','!파티목록','!파티종료','!파티정보']);
let schema=null;
async function init(db){
 if(!schema)schema=(async()=>{
  await db.query(`CREATE TABLE IF NOT EXISTS hz_valorant_parties(
   room_id TEXT NOT NULL,owner_id TEXT NOT NULL,owner_name TEXT NOT NULL,
   capacity INTEGER NOT NULL CHECK(capacity IN (2,3,5)),
   description TEXT NOT NULL DEFAULT '',members JSONB NOT NULL DEFAULT '[]'::jsonb,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   PRIMARY KEY(room_id,owner_id))`);
 })().catch(e=>{schema=null;throw e});
 await schema;
}
function id(v){const x=String(v||'');return /^[1-9]\d+$/.test(x)?x:'';}
function safeName(x){return String(x||'참가자').replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,35);}
function array(raw){const a=typeof raw==='string'?JSON.parse(raw):raw;return Array.isArray(a)?a:[];}
function validSize(raw){return /^(2|3|5)$/.test(String(raw||''))?Number(raw):null;}
function membersOf(row){
 const members=array(row.members).filter(x=>id(x.id)).map(x=>({id:id(x.id),name:safeName(x.name)}));
 if(!members.some(x=>x.id===row.owner_id))members.unshift({id:row.owner_id,name:safeName(row.owner_name)});
 return [...new Map(members.map(x=>[x.id,x])).values()];
}
function item(row){const members=membersOf(row);return safeName(row.owner_name)+'님의 '+row.capacity+'인 파티 ('+members.length+'/'+row.capacity+')'+(row.description?' · '+row.description:'');}
async function handle({text,msg,client,chat,roomId,userId,userName,send,db=getPool()}){
 const cmd=String(text||'').trim().split(/\s+/)[0];if(!COMMANDS.has(cmd))return false;
 const room=id(roomId),user=id(userId),name=safeName(userName);
 if(!room||!user){await send('❌ 사용자 또는 방 ID를 확인하지 못했습니다.');return true;}
 const tail=String(text).trim().slice(cmd.length).trim();
 try{
  await init(db);
  if(cmd==='!파티모집'){
   const m=/^(2|3|5)(?:\s+([\s\S]{1,100}))?$/.exec(tail);
   if(!m){await send('사용법: !파티모집 (2/3/5) (내용)\n예: !파티모집 5 경쟁전 골드 마이크 가능');return true;}
   const size=validSize(m[1]),desc=(m[2]||'').trim();
   const duplicate=await db.query("SELECT owner_id FROM hz_valorant_parties WHERE room_id=$1 AND members @> $2::jsonb AND owner_id<>$3 LIMIT 1",
     [room,JSON.stringify([{id:user}]),user]);
   if(duplicate.rowCount){await send('❌ 다른 파티에 참가 중입니다. 먼저 !파티퇴장 또는 해당 파티 종료를 요청해 주세요.');return true;}
   const existing=await db.query('SELECT members FROM hz_valorant_parties WHERE room_id=$1 AND owner_id=$2',[room,user]);
   if(existing.rowCount&&membersOf({...existing.rows[0],owner_id:user,owner_name:name}).length>size){
    await send('❌ 현재 참가 인원보다 작은 크기로 변경할 수 없습니다.');return true;
   }
   const members=existing.rowCount?membersOf({...existing.rows[0],owner_id:user,owner_name:name}):[{id:user,name}];
   await db.query(`INSERT INTO hz_valorant_parties(room_id,owner_id,owner_name,capacity,description,members)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT(room_id,owner_id) DO UPDATE SET owner_name=$3,capacity=$4,
     description=$5,members=$6::jsonb,created_at=NOW()`,
    [room,user,name,size,desc,JSON.stringify(members)]);
   await send('✅ '+item({owner_id:user,owner_name:name,capacity:size,description:desc,members})+
    '\n신청: !파티참가 '+user+'\n종료: !파티종료');return true;
  }
  if(cmd==='!파티목록'){
   const q=await db.query("SELECT owner_id,owner_name,capacity,description,members FROM hz_valorant_parties WHERE room_id=$1 AND created_at>NOW()-INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 15",[room]);
   await send(fold('👥 NEXI | 발로란트 파티 모집',q.rowCount?q.rows.map((p,i)=>(i+1)+'. '+item(p)+'\n   참가: !파티참가 '+p.owner_id).join('\n'):'모집 중인 파티가 없습니다.\n!파티모집 2/3/5 (내용)으로 생성하세요.'));return true;
  }
  if(cmd==='!파티정보'){
   const target=tail?id(tail):user;
   if(!target){await send('사용법: !파티정보 (모집자 ID, 생략 가능)');return true;}
   const q=await db.query('SELECT owner_id,owner_name,capacity,description,members FROM hz_valorant_parties WHERE room_id=$1 AND owner_id=$2',[room,target]);
   if(!q.rowCount){await send('❌ 모집 중인 파티가 없습니다.');return true;}
   const p=q.rows[0],members=membersOf(p);
   await send(fold('👥 NEXI | 파티 정보\n'+item(p),members.map((x,i)=>(i+1)+'. '+x.name+(x.id===p.owner_id?' [모집자]':'')).join('\n')));return true;
  }
  if(cmd==='!파티종료'){
   const q=await db.query('DELETE FROM hz_valorant_parties WHERE room_id=$1 AND owner_id=$2 RETURNING owner_id',[room,user]);
   await send(q.rowCount?'✅ 파티 모집을 종료했습니다.':'❌ 본인이 개설한 파티가 없습니다.');return true;
  }
  // Lock party row to enforce capacity and prevent lost updates when users join at once.
  if(cmd==='!파티참가'||cmd==='!파티퇴장'){
   let ownerId=tail;
   if(cmd==='!파티참가'&&!ownerId){const reply=await recruit.resolve({msg,client,roomId:room,botId:client?.userId});if(reply?.kind==='party')ownerId=reply.owner;}
   if(cmd==='!파티참가'&&!id(ownerId)){await send('사용법: !파티참가 (모집자 ID) 또는 파티 모집 메시지에 답장으로 !파티참가');return true;}
   const client=typeof db.connect==='function'?await db.connect():null;
   if(!client)throw Error('파티 변경을 위한 트랜잭션을 사용할 수 없습니다.');
   let response='',notification=null;
   try{
    await client.query('BEGIN');
    if(cmd==='!파티참가')await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[room+':'+user]);
    const find=cmd==='!파티참가'
     ?await client.query("SELECT * FROM hz_valorant_parties WHERE room_id=$1 AND owner_id=$2 AND created_at>NOW()-INTERVAL '24 hours' FOR UPDATE",[room,ownerId])
     :await client.query('SELECT * FROM hz_valorant_parties WHERE room_id=$1 AND members @> $2::jsonb LIMIT 1 FOR UPDATE',[room,JSON.stringify([{id:user}])]);
    if(!find.rowCount)response='❌ 해당 파티가 없거나 참가 중인 파티가 없습니다.';
    else{
     const party=find.rows[0],members=membersOf(party);
     if(cmd==='!파티참가'){
      const prior=await client.query('SELECT owner_id FROM hz_valorant_parties WHERE room_id=$1 AND members @> $2::jsonb AND owner_id<>$3 LIMIT 1',[room,JSON.stringify([{id:user}]),party.owner_id]);
      if(prior.rowCount)response='❌ 이미 다른 파티에 참가 중입니다.';
      else if(members.some(x=>x.id===user))response='이미 참가한 파티입니다.';
      else if(members.length>=party.capacity)response='❌ 파티 정원이 가득 찼습니다.';
      else{
       members.push({id:user,name});
       await client.query('UPDATE hz_valorant_parties SET members=$3::jsonb WHERE room_id=$1 AND owner_id=$2',[room,party.owner_id,JSON.stringify(members)]);
       response='✅ '+name+'님 파티 참가 완료 ('+members.length+'/'+party.capacity+')';
       notification={ownerId:party.owner_id,ownerName:party.owner_name};
      }
     }else if(user===party.owner_id)response='❌ 모집자는 !파티종료로 파티를 종료해야 합니다.';
     else{
      const next=members.filter(x=>x.id!==user);
      await client.query('UPDATE hz_valorant_parties SET members=$3::jsonb WHERE room_id=$1 AND owner_id=$2',[room,party.owner_id,JSON.stringify(next)]);
      response='✅ 파티에서 퇴장했습니다. ('+next.length+'/'+party.capacity+')';
     }
    }
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK');throw error;}
   finally{client.release();}
   await send(response);
   if(notification)try{await recruit.alertOwner({chat,roomId:room,send,ownerId:notification.ownerId,ownerName:notification.ownerName,applicantName:name,kind:'party'});}catch(error){console.warn('[PARTY ALERT]',String(error?.code||'SEND_FAILED'));}
   return true;
  }
 }catch(error){console.error('[VALORANT PARTY]',String(error?.message||error).slice(0,180));await send('❌ 파티 기능 처리에 실패했습니다.');return true;}
 return true;
}
module.exports={COMMANDS,handle,validSize,membersOf};
