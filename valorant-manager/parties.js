'use strict';
const {command,tail,limit,clean}=require('./core');
const {cleanup}=require('./database');
async function handle(ctx){const {text,roomId,userId,userName,db,send,mention}=ctx,c=command(text),room=String(roomId),user=String(userId);
if(!['!파티등록','!파티목록','!파티참가','!파티종료'].includes(c))return false;
await cleanup(db);
if(c==='!파티등록'){const m=/^(\d+)\s+(\d+)\s+([^\n]{1,50})\n([\s\S]{1,120})$/.exec(tail(text));if(!m)return send('사용법: !파티등록 (현재 인원) (목표 인원) (티어대)\n(파티코드)');
const current=limit(m[1],1,20),target=limit(m[2],2,20),rank=clean(m[3]),code=clean(m[4]);if(!current||!target||current>target||!code)return send('❌ 인원 또는 파티코드를 확인해 주세요.');
const duplicate=await db.query('SELECT id FROM vs_parties WHERE room_id=$1 AND owner_id=$2 AND expires_at>NOW()',[room,user]);if(duplicate.rowCount)return send('❌ 이미 등록한 파티가 있습니다. !파티종료 후 등록해 주세요.');
const result=await db.query('INSERT INTO vs_parties(room_id,owner_id,owner_name,current_size,target_size,tier,code,members) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id,expires_at',[room,user,clean(userName).slice(0,40),current,target,rank,code,JSON.stringify([{id:user,name:clean(userName)}])]);
const p=result.rows[0];return send('✅ 파티 #'+p.id+' 등록\n👤 '+clean(userName)+'\n👥 '+current+'/'+target+'명\n🏅 '+rank+'\n⏰ 7시간 후 자동 만료\n참가: !파티참가 '+p.id+' (또는 이 메시지에 답장)')}
if(c==='!파티목록'){const r=await db.query('SELECT id,owner_name,current_size,target_size,tier FROM vs_parties WHERE room_id=$1 ORDER BY id DESC LIMIT 30',[room]);return send(r.rowCount?'🎮 파티 목록\n'+r.rows.map(p=>'#'+p.id+' '+p.owner_name+' · '+p.current_size+'/'+p.target_size+' · '+p.tier).join('\n'):'등록된 파티가 없습니다.')}
if(c==='!파티종료'){const r=await db.query('DELETE FROM vs_parties WHERE room_id=$1 AND owner_id=$2 RETURNING id',[room,user]);return send(r.rowCount?'✅ 파티 #'+r.rows[0].id+' 종료':'❌ 본인이 등록한 파티가 없습니다.')}
const id=limit(tail(text)||ctx.replyPartyNumber,1,Number.MAX_SAFE_INTEGER);if(!id)return send('사용법: !파티참가 (번호) 또는 등록 메시지에 답장으로 !파티참가');
const client=await db.connect();let output='',owner=null;try{await client.query('BEGIN');const r=await client.query('SELECT * FROM vs_parties WHERE room_id=$1 AND id=$2 AND expires_at>NOW() FOR UPDATE',[room,id]);if(!r.rowCount)output='❌ 해당 파티가 없거나 만료되었습니다.';else{const p=r.rows[0],members=Array.isArray(p.members)?p.members:JSON.parse(p.members);if(members.some(m=>m.id===user))output='이미 참가한 파티입니다.';else if(p.current_size>=p.target_size)output='❌ 정원이 가득 찼습니다.';else{members.push({id:user,name:clean(userName)});await client.query('UPDATE vs_parties SET current_size=current_size+1,members=$2::jsonb WHERE id=$1',[id,JSON.stringify(members)]);output='✅ 파티 #'+id+' 참가 완료 ('+(p.current_size+1)+'/'+p.target_size+')';owner={id:p.owner_id,name:p.owner_name,code:p.code}}}await client.query('COMMIT')}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
await send(output);if(owner){const tag=typeof mention==='function'?mention(owner.id,owner.name):'@'+owner.name;await send(tag+'님, '+clean(userName)+'님이 파티 #'+id+'에 참가했습니다.\n🔑 파티코드: '+owner.code)}return true}
module.exports={handle};