'use strict';
const { handleExtraMessage } = require('./help');
const gameAliases=require('../game/command-aliases');

const recentMessages=new Map();
const observedOpenRooms=new Set();
const MAX_ROOMS=100, MAX_MESSAGES=250;
function rememberMessage(roomId,msg,text){
 if(/^!가리기(?:\s|$)/.test(text))return;
 const log=String(msg?.message?.logId??msg?.raw?.chatLog?.logId??msg?.logId??msg?.id??'');
 if(!/^[1-9]\d*$/.test(log))return;
 const room=String(roomId);
 let entries=recentMessages.get(room);
 if(!entries){entries=[];recentMessages.set(room,entries);}
 if(entries.some(item=>item.log===log))return;
 entries.push({log,msg});
 if(entries.length>MAX_MESSAGES)entries.shift();
 if(recentMessages.size>MAX_ROOMS)recentMessages.delete(recentMessages.keys().next().value);
}
function blindResponse(result){
 if(result===false)return 'rejected';
 if(result==null)return 'unverified';
 // LOCO packet status=0 means the packet arrived, NOT that BLIND succeeded.
 // Kakao's actual business-level result lives in body.status.
 for(const envelope of [result?.body,result?.complete?.body,result?.result?.body]){
  if(envelope&&envelope.status!=null){
   const code=Number(envelope.status);
   if(Number.isFinite(code))return code===0?'accepted':'rejected';
  }
 }
 for(const value of [result?.complete?.status,result?.result?.status,result?.status]){
  if(value==null)continue;
  const code=Number(value);
  if(Number.isFinite(code))return code===0?'unverified':'rejected';
 }
 if(result?.success===false||result?.ok===false)return 'rejected';
 if(result?.success===true||result?.ok===true)return 'accepted';
 return 'unverified';
}
async function blindRecent({client,chat,roomId,count,send}){
 const entries=recentMessages.get(String(roomId))||[];
 const targets=entries.slice(-count).reverse();
 if(!targets.length){await send('❌ 최근 감지된 메시지가 없습니다. 봇이 실행된 이후의 메시지만 가릴 수 있습니다.');return;}
 const blind=typeof chat?.openChatBlind==='function'?chat.openChatBlind.bind(chat):
   typeof client?.openChatBlind==='function'?client.openChatBlind.bind(client):null;
 if(!blind){await send('❌ KakaoForge 메시지 가리기 API를 사용할 수 없습니다.');return;}
 let accepted=0,unverified=0,failed=0,skipped=0;
 const errors=[];
 for(let position=0;position<targets.length;position++){
  const item=targets[position];
  try{
   const result=await blind(roomId,item.msg,{report:false});
   const state=blindResponse(result);
   let response='';
   try{response=JSON.stringify(result,(_,v)=>typeof v==='bigint'?String(v):v)||String(result);}catch{response=String(result);}
   console.log('[NEXI BULK BLIND RESPONSE]',JSON.stringify({state,response:response.slice(0,280)}));
   if(state==='accepted'){
    accepted++;
    const i=entries.indexOf(item);if(i>=0)entries.splice(i,1);
   }else if(state==='unverified')unverified++;
   else{
    failed++;
    const reason=String(result?.body?.errMsg||result?.body?.status||'서버에서 요청을 거부했습니다.').slice(0,120);
    if(errors.length<3)errors.push(reason);
    // Kakao server denied the moderator action. Further messages in the same
    // command cannot override server-side privileges, so avoid repeated failures.
    if(Number(result?.body?.status)===-500&&/차단할 수 없습니다/.test(reason)){
      skipped=targets.length-position-1;
      break;
    }
   }
  }catch(error){
   failed++;
   const message=String(error?.code||error?.message||error);
   if(errors.length<3)errors.push(message.slice(0,120));
   console.warn('[NEXI BULK BLIND]',message);
  }
 }
 await send('🫥 NEXI | 메시지 가리기 요청 결과\n'+
  '📨 서버 요청 수락: '+accepted+'개\n'+
  '❔ 처리 확인 불가: '+unverified+'개\n'+
  '❌ 요청 실패: '+failed+'개\n'+
  (skipped?'⏭️ 서버 권한 거부로 중단: '+skipped+'개\n':'')+
  '※ 요청 수락은 화면에서 실제로 가려졌다는 의미가 아닙니다.'+
  (errors.length?'\n오류: '+errors.join(' / '):'')+
  (targets.length<count?'\nℹ️ 감지된 메시지 '+targets.length+'개만 처리했습니다.':''));
}

function attachRouter(client, { game, management, ready = Promise.resolve() }) {
  require('./unicode-output').install(client);
  require('./reply-delete').install(client);
  client.onMessage(async (...args) => {
    let msg = args.length === 1 ? args[0] : args[1];
    const chat = args.length === 1 ? (client.chat || client) : args[0];
    if (msg?.room?.id == null) return;
    const receivedAt=Date.now();
    let text = String(msg.message?.text ?? msg.text ?? '').trim();
    const roomId = msg.room.id;
    const senderId = msg.sender?.id ?? msg.senderId;
    if(msg.room?.isOpenChat===true)observedOpenRooms.add(String(roomId));
    else if(msg.room?.isOpenChat===false)observedOpenRooms.delete(String(roomId));
    const isBotAccount = client.userId != null && String(client.userId) !== '0' &&
      senderId != null && String(client.userId) === String(senderId);
    try {
      // Global 30-second maintenance pause: no commands or passive handling.
      const maintenance={active:()=>Date.now()<(global.__nexiPauseUntil||0),start:ms=>{global.__nexiPauseUntil=Date.now()+ms;}};
      if(text==='!봇재부팅'){
        if(!isBotAccount)return;
        if(maintenance.active())return;
        const pool=require('./db').getPool();
        const rooms=await pool.query("SELECT r.room_id FROM hz_rooms r LEFT JOIN gl_manage_rooms m ON m.room_id=r.room_id WHERE COALESCE(r.data->>'botEnabled','true')<>'false' AND (COALESCE((r.data->>'game')::boolean,false)=true OR COALESCE(m.enabled,(r.data->>'manage')::boolean,false)=true)");
        const targets=[...new Set(rooms.rows.map(row=>String(row.room_id)))].filter(id=>/^\d+$/.test(id)&&observedOpenRooms.has(id));
        maintenance.start(30000);
        const pauseEnd=global.__nexiPauseUntil;
        const broadcast=async body=>{
          const results=await Promise.allSettled(targets.map(id=>chat.sendText(id,body)));
          results.forEach((result,index)=>{if(result.status==='rejected')console.warn('[BOT RESTART BROADCAST]',targets[index],String(result.reason?.message||result.reason));});
        };
        await broadcast('🔄 봇 재부팅을 시작합니다.');
        setTimeout(()=>{
          if(global.__nexiPauseUntil!==pauseEnd)return;
          void broadcast('✅ 봇 재부팅이 끝났습니다.');
        },Math.max(0,pauseEnd-Date.now()));
        return;
      }
      if(maintenance.active())return;
      // Global per-room kill switch. Skip every handler and cache while OFF;
      // only !봇켜기 can revive the room (authorization checked below).
      const power=await require('./db').getPool().query(
        "SELECT data->>'botEnabled' AS enabled, data->>'ardenClan' AS arden_clan FROM hz_rooms WHERE room_id=$1",
        [String(roomId)]);
      if(!isBotAccount&&power.rows[0]?.enabled==='false'&&text!=='!봇켜기')return;
      rememberMessage(roomId,msg,text);
      // Normalize configured room prefix before ALL commands and event handlers.
      const prefixConfig=require('./command-prefixes');
      const prefixResult=prefixConfig.normalize(text,await prefixConfig.get(roomId));
      if(prefixResult.blocked&&!isBotAccount){
        // Old ! commands must never invoke a handler; preserve chat counts.
        await ready;
        await management.message({client,roomId,userId:senderId??'',userName:msg.sender?.name||'알 수 없음',
          text:'',msg,send:body=>chat.sendText(roomId,body),senderType:msg.sender?.type,botId:client.userId,isBotAccount});
        return;
      }
      if(prefixResult.used){
        text=prefixResult.text;
        msg={...msg,text,message:{...(msg.message||{}),text}};
      }
      // Room-scoped command blocks: ignore this user's bot commands silently.
      // Ordinary conversation remains visible and can still count toward chat stats.
      const blocks=require('./command-blocks');
      if(!isBotAccount&&senderId!=null){
        try{
          if(await blocks.blocked(roomId,senderId)){
            // Non-command chat is still counted, but no game/quiz/command handler sees it.
            if(!blocks.commandLike(text)){
              await ready;
              await management.message({client,roomId,userId:senderId,userName:msg.sender?.name||'알 수 없음',
                text:'',msg,send:body=>chat.sendText(roomId,body),senderType:msg.sender?.type,botId:client.userId,isBotAccount});
            }
            return;
          }
        }catch(error){
          console.error('[COMMAND BLOCK CHECK]',String(error?.code||error?.message||error));
          // If the block database is temporarily unavailable, do not bypass a block.
          return;
        }
      }
      // Per-room bot power switch. Only these two commands can pass while OFF.
      if(text==='!봇켜기'||text==='!봇끄기'){
        await ready;
        const context={client,roomId,userId:senderId??'',userName:msg.sender?.name||'알 수 없음',
          text,msg,senderType:msg.sender?.type,botId:client.userId,isBotAccount,
          send:body=>chat.sendText(roomId,body)};
        try{await require('../manage/commands-v2').handle(context);}
        catch(error){
          console.error('[BOT POWER COMMAND]',String(error?.message||error));
          await chat.sendText(roomId,'❌ 봇 설정 변경에 실패했습니다.');
        }
        return;
      }
      // Room power was checked before all listeners, message tracking and prefixes.
      // Scoped superadmin authorization does not change the Kakao sender identity.
      let isSuperAdmin=false;
      if(text.startsWith('!')&&senderId!=null&&!isBotAccount){
        try{isSuperAdmin=await require('./super-admin').isSuperAdmin(roomId,senderId);}
        catch(error){console.warn('[SUPER ADMIN CHECK]',String(error?.code||'DB_ERROR'));}
      }
      // Isolate the ARDEN design for concurrent messages from different rooms.
      await require('./arden-style').scope({
        roomId,text,active:power.rows[0]?.arden_clan==='true'
      },async()=>{
      // ARDEN room membership gate: intercept before every game, attendance,
      // reply/confirmation, admin/help and event command handler.
      if(await require('./arden-clan').handle({
        client,chat,msg,roomId,userId:senderId,userName:msg.sender?.name||'알 수 없음',
        text,isBotAccount,isSuperAdmin,active:power.rows[0]?.arden_clan==='true',
        management,ready
      }))return;
      // Bot-account-only, bounded repeated announcements. This is intercepted
      // before game and management handlers so it never runs twice.
      if(/^!도배(?:시작|중지)(?=\s|$)/.test(text)){
        await require('./repeat-broadcast').handle({
          text,roomId,isBotAccount,send:body=>chat.sendText(roomId,body)
        });
        return;
      }
      if(/^!가리기(?:\s|$)/.test(text)){
        let canBlind=isBotAccount||isSuperAdmin||[1,4].includes(Number(msg.sender?.type));
        if(!canBlind&&senderId!=null){
          try{canBlind=await require('./room-bot-admin').isRoomBotAdmin(roomId,senderId);}
          catch(error){console.warn('[NEXI BLIND AUTH]',String(error?.code||'DB_ERROR'));}
        }
        if(!canBlind){
          await chat.sendText(roomId,'⛔ 방장·부방장·관리자·최고관리자 또는 봇 계정만 사용할 수 있습니다.');
          return;
        }
        const m=/^!가리기\s+([1-9]\d*)$/.exec(text);
        const count=m?Number(m[1]):NaN;
        if(!Number.isSafeInteger(count)||count<1||count>100){
          await chat.sendText(roomId,'사용법: !가리기 (개수) · 1~100개');
          return;
        }
        await blindRecent({client,chat,roomId,count,send:body=>chat.sendText(roomId,body)});
        return;
      }
      // A single global bot-room claim, assigned to the first valid Kakao user.
      // The unique singleton row serializes concurrent claims across all rooms.
      if(text==='!봇방'||text==='!봇방지정'||text==='!봇방상태'||text==='!봇방해제'){
        try{
          const pool=require('./db').getPool();
          if(text==='!봇방상태'){
            const result=await pool.query("SELECT room_id FROM hz_bot_room_claims WHERE singleton=1").catch(async error=>{
              if(error.code==='42P01')return {rows:[]};
              throw error;
            });
            const claimed=String(result.rows[0]?.room_id||'');
            await chat.sendText(roomId,claimed
              ?(claimed===String(roomId)?'🤖 NEXI | 이 방이 지정된 봇방입니다.':'🤖 NEXI | 다른 채팅방이 이미 봇방으로 지정되어 있습니다.')
              :'🤖 NEXI | 아직 지정된 봇방이 없습니다.');
            return;
          }
          if(text==='!봇방해제'){
            await chat.sendText(roomId,'⛔ 봇방은 최초 1회만 지정할 수 있으며 지정 해제를 지원하지 않습니다.');
            return;
          }
          const room=String(roomId),user=String(senderId??'');
          const valid=require('./super-admin').valid;
          if(!valid(room)||!valid(user)){
            await chat.sendText(roomId,'❌ 카카오톡 사용자와 채팅방 ID를 확인할 수 없습니다. 다시 시도해 주세요.');
            return;
          }
          const db=await pool.connect();
          let claimed=false;
          try{
            await db.query('BEGIN');
            await db.query("CREATE TABLE IF NOT EXISTS hz_bot_room_claims (singleton SMALLINT PRIMARY KEY CHECK(singleton=1),room_id TEXT NOT NULL,owner_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
            await require('./super-admin').init(db,false);
            const claim=await db.query("INSERT INTO hz_bot_room_claims(singleton,room_id,owner_id) SELECT 1,$1,$2 WHERE NOT EXISTS (SELECT 1 FROM hz_rooms WHERE data->>'botRoom'='true' AND room_id<>$1) ON CONFLICT DO NOTHING RETURNING owner_id",[room,user]);
            if(claim.rowCount){
              await db.query("INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object('botRoom',true,'game',true,'manage',true,'valorant',true,'quizEnabled',true,'fishEnabled',true,'locked',false)) ON CONFLICT(room_id) DO UPDATE SET data=hz_rooms.data||EXCLUDED.data,updated_at=NOW()",[room]);
              await db.query("INSERT INTO gl_manage_rooms(room_id,enabled) VALUES($1,TRUE) ON CONFLICT(room_id) DO UPDATE SET enabled=TRUE",[room]);
              await db.query("INSERT INTO hz_super_admins(room_id,user_id,granted_by) VALUES($1,$2,$2) ON CONFLICT DO NOTHING",[room,user]);
              claimed=true;
            }
            await db.query('COMMIT');
          }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
          await chat.sendText(roomId,claimed
            ?'✅ NEXI | 봇방 최초 지정 완료!\n🎮 게임·낚시·퀴즈·관리·발로란트 활성화\n🛡️ 지정한 사용자가 이 방의 최고관리자로 등록되었습니다.'
            :'⛔ 봇방은 최초 1회만 지정할 수 있습니다. 이미 지정된 봇방이 있습니다.');
        }catch(error){
          console.error('[NEXI BOT ROOM]',String(error?.message||error));
          await chat.sendText(roomId,'❌ 봇방 설정에 실패했습니다. 데이터베이스를 확인해 주세요.');
        }
        return;
      }
      // VALORANT is OFF by default in each room; only this bot account may toggle it.
      // This switch is independent of the game and management flags.
      if(text==='!발로on'||text==='!발로off'){
        try{
          await require('./valorant-settings').handle({
            text,roomId,isBotAccount,isSuperAdmin,send:body=>chat.sendText(roomId,body)
          });
        }catch(error){
          console.error('[VALORANT SWITCH]',String(error?.message||error));
          await chat.sendText(roomId,'❌ 발로란트 설정을 저장하지 못했습니다. 데이터베이스를 확인해 주세요.');
        }
        return;
      }
      // A numbered reply to the bot's own ambiguous !스킨 list selects that skin.
      // Never intercept ordinary 1-5 messages or replies to unrelated messages.
      if(/^[1-5]$/.test(text)&&require('./valorant-skin').isSkinReply(msg)){
        let enabled=false;
        try{enabled=await require('./valorant-settings').isEnabled(roomId);}
        catch(error){console.error('[VALORANT SKIN REPLY GATE]',String(error?.code||'DB_ERROR'));}
        if(enabled||isBotAccount){
          const handled=await require('./valorant-skin').handleReply({
            msg,text,client,roomId,userId:senderId,
            send:body=>chat.sendText(roomId,body)
          });
          if(handled)return;
        }
      }
      if(/^(네|예|아니요|아니오)$/.test(text)){
        const enabled=await require('./valorant-settings').isEnabled(roomId).catch(()=>false);
        if(enabled||isBotAccount){
          const handled=await require('./valorant-community').handleConfirmation({
            text,msg,client,chat,roomId,userId:senderId,userName:msg.sender?.name||'참가자',
            senderType:msg.sender?.type,isBotAccount,isSuperAdmin,
            send:body=>chat.sendText(roomId,body)
          });
          if(handled)return;
        }
      }
      // Extended Valorant commands share the same per-room OFF-by-default switch.
      const newValorantCommand=text.split(/\s+/)[0];
      if(/^(?:!발로명령어|!요원|!랜덤요원|!맵|!랜덤맵|!무기|!조준점|!스킨비교|!스킨색상|!스킨가격|!발로티어변동|!발로요원통계|!발로비교|!발로랭킹|!발로랭킹등록|!발로랭킹탈퇴|!티어등록|!내전예약|!내전등록|!내전참여|!내전참가|!내전탈퇴|!내전참가자|!내전팀짜기|!내전재편성|!내전선수교체|!내전밸런스|!내전결과|!내전순위|!내전초기화|!듀오모집|!듀오목록|!듀오신청|!듀오취소|!파티모집|!파티참가|!파티퇴장|!파티목록|!파티종료|!파티정보)(?=\s|$)/.test(text)){
        const valGuide=require('./valorant-guides');
        const valStats=require('./valorant-extended-stats');
        const valCommunity=require('./valorant-community');
        const valParty=require('./valorant-party');
        let enabled=false;
        try{enabled=await require('./valorant-settings').isEnabled(roomId);}
        catch(error){console.error('[VALORANT EXTENSION SWITCH]',String(error?.code||'DB_ERROR'));return;}
        if(!enabled&&!isBotAccount)return;
        const args={text,msg,client,chat,roomId,userId:senderId,userName:msg.sender?.name||'참가자',
          senderType:msg.sender?.type,isBotAccount,isSuperAdmin,
          send:body=>chat.sendText(roomId,body)};
        if(valGuide.COMMANDS.has(newValorantCommand))await valGuide.handle(args);
        else if(valStats.COMMANDS.has(newValorantCommand))await valStats.handle(args);
        else if(valCommunity.COMMANDS.has(newValorantCommand))await valCommunity.handle(args);
        else if(valParty.COMMANDS.has(newValorantCommand))await valParty.handle(args);
        return;
      }
      // Gate EVERY Valorant-related command before contacting external APIs.
      if(/^(?:!스킨|!발로전적|!전적|!티어|!최근전적|!승률|!헤드샷|!발로저장|!발로전적확인|!발로삭제|!챔스노래|!발로승인|!발로승인해제)(?=\s|$)/.test(text)){
        let enabled=false;
        try{
          enabled=await require('./valorant-settings').isEnabled(roomId);
        }catch(error){
          // Fail closed if PostgreSQL is unavailable.
          console.error('[VALORANT SWITCH CHECK]',String(error?.message||error));
          return;
        }
        if(!enabled&&!isBotAccount)return; // Bot owner bypasses per-room feature toggle.
        if(/^!(?:발로승인|발로승인해제)(?=\s|$)/.test(text)){
          await require('./valorant-approvals').handle({
            text,isBotAccount,isSuperAdmin,userId:senderId,send:body=>chat.sendText(roomId,body)
          });
        }else if(/^!스킨(?=\s|$)/.test(text)){
          await require('./valorant-skin').handle({
            text,client,roomId,userId:senderId,
            send:body=>chat.sendText(roomId,body)
          });
        }else if(/^!챔스노래(?=\s|$)/.test(text)){
          await require('./valorant-champions-music').handle({
            text,send:body=>chat.sendText(roomId,body)
          });
        }else if(/^!(?:발로저장|발로전적확인|발로삭제)(?=\s|$)/.test(text)){
          await require('./valorant-account').handle({
            text,roomId,userId:senderId,
            send:body=>chat.sendText(roomId,body)
          });
        }else{
          await require('./valorant-stats').handle({
            text,roomId,userId:senderId,
            send:body=>chat.sendText(roomId,body)
          });
        }
        return;
      }
      // The public support link is available even before the game/DB initializes.
      if(text==='!문의방'){
        await handleExtraMessage(client,msg);
        return;
      }
      // Reply "삭제" to a bot-authored message: true DELETEMSG, never BLIND.
      const replyDelete=require('./reply-delete');
      replyDelete.observe(msg,client.userId);
      if((text==='삭제'||text==='!삭제')&&!isBotAccount){
        await ready;
        if(await replyDelete.handle({client,chat,msg,roomId,senderId,text,isBotAccount}))return;
      }
      // Intermediary alert commands and passive monitoring. Detection never replies in the watched room.
      const junggae = require('./junggae-notify');
      if (/^!준개감지(?:on|off|상태)$/.test(text)||text==='!봇방등록'||/^!(?:준개방(?:등록|삭제|목록)|준개알람(?:받기|끄기)|준개(?:맞음|아님|학습검색))(?:\s|$)/.test(text)) {
        await junggae.handle({client,chat,msg,roomId,text,isBotAccount,allowBotSubscription:true});
        return;
      }
      void junggae.handle({client,chat,msg,roomId,text,isBotAccount})
        .catch(error => console.error('[JUNGGAE] alert error:', error));
      // Voice-room help/status must remain responsive even if unrelated
      // game/database initialization is still pending or has failed.
      if (/^[#!]?(?:보룸켜기|보룸시작|보룸끄기|보룸종료|보룸상태|보룸감지시작|보룸감지종료|보룸감지|보룸명령어|보이스룸켜기|보이스룸시작|보이스룸끄기|보이스룸종료|보이스룸상태|보이스룸감지시작|보이스룸감지종료|보이스룸감지|보이스룸명령어)(?=$|\s|[.!。])/.test(text)) {
        console.log('[보이스룸] 명령 수신:', JSON.stringify({
          roomId: String(roomId),
          command: text.split(/\s/,1)[0],
          senderType: msg.sender?.type == null ? 'unknown' : String(msg.sender.type),
          connected: client.connected !== false,
          sameAsBotAccount: isBotAccount
        }));
        const sendVoiceReply = async body => {
          const len = String(body).length;
          const target = String(roomId);
          console.log('[보이스룸] 응답 전송 시작:', JSON.stringify({
            roomId: target, chars: len,
            method: typeof chat?.sendText === 'function' ? 'chat.sendText' :
              typeof client?.sendText === 'function' ? 'client.sendText' : 'missing'
          }));
          try {
            let result;
            if (typeof chat?.sendText === 'function') {
              result = await chat.sendText(roomId, body);
            } else if (typeof client?.sendText === 'function') {
              result = await client.sendText(roomId, body);
            } else {
              throw Error('KakaoForge sendText 함수가 없습니다.');
            }
            const status = result?.status;
            const logId = result?.body?.logId;
            console.log('[보이스룸] 응답 전송 결과:', JSON.stringify({
              roomId: target, status: status ?? 'unknown',
              ackLogId: logId == null ? null : String(logId)
            }));
            // The KakaoForge WRITE implementation accepts only status 0
            // with a returned body.logId as a confirmed message send.
            if (status !== 0 || !logId) {
              throw Error('카카오톡 WRITE 응답 확인 불가 (status=' +
                String(status ?? 'unknown') + ', logId=' + (logId ? 'present' : 'missing') + ')');
            }
            return result;
          } catch (sendError) {
            console.error('[보이스룸] 응답 전송 오류:', String(sendError?.message || sendError));
            throw sendError;
          }
        };
        try {
          await require('./voice-room').handle({
            client, roomId, msg, text, send: sendVoiceReply
          });
        } catch (error) {
          console.error('[보이스룸] 명령어 처리 오류:', error);
          try {
            await sendVoiceReply(
              '❌ 보이스룸 명령어 처리 중 오류가 발생했습니다. Railway 로그를 확인해 주세요.');
          } catch (sendError) {
            console.error('[보이스룸] 오류 안내 전송 실패:', sendError);
          }
        }
        return;
      }
      // Old ! game toggles are retired; do not forward them to legacy handlers.
      if (text === '!게임작동' || text === '!게임중지') {
        await chat.sendText(roomId,'⚠️ 게임 ON/OFF 명령어가 변경되었습니다. !게임on / !게임off');
        return;
      }
      // Game commands now use !. Drop retired # game commands before any legacy listeners.
      if (gameAliases.isRetiredLegacyCommand(text)) return;
      // Retired # management aliases must not reach the old HZ handler.
      // Keep legacy #내아이디/#아이디/#출석확인 permission rules unchanged.
      if (/^#(?:출석|출석순위|채팅순위|채팅순위전체|채팅정보|경고|경고내역|경고삭제|경고초기화|kick|k|내풀|벤해제|벤기록|관리로그|입퇴장로그|입장변경|퇴장변경|프로필로그|관리작동|관리중지|관리자추가|관리자삭제|도배감지켜기|도배감지끄기|삭제감지켜기|삭제감지끄기)(?=$|\s)/.test(text))return;
      // Manual KakaoTalk notice status/registration commands were retired.
      // Actual room notice registration is available only via scheduled commands.
      if (/^#이벤공지(?:상태|등록)(?=$|\s)/.test(text)) return;
      // All APEX event commands now use !. Retire old # event aliases.
      if (/^#이벤(?:설정|속도|공지작성|공지|당첨문구|탈락문구|시간초과문구|초기화|인원테스트|추첨테스트|진행테스트)(?=$|\s)/.test(text)) return;
      // Hide off-turn messages only while a live event is awaiting the
      // currently selected person. Never substitute deleteMessage for BLIND.
      // Permission is scoped to this room and never changes the sender identity.
      let roomBotAdmin=isSuperAdmin;
      if(!roomBotAdmin&&/^!(?:게임on|게임off|이벤트시작|이벤트중지|이벤)/.test(text)&&!isBotAccount){
        try{roomBotAdmin=await require('./room-bot-admin').isRoomBotAdmin(roomId,senderId);}
        catch(error){console.warn('[ROOM ADMIN] 권한 조회 실패:',String(error?.message||error));}
      }
      const eventHandler=require('./event-reaction-test');
      const hideOffTurn=eventHandler.shouldBlind({roomId,senderId,text,isBotAccount,msg,roomBotAdmin});
      eventHandler.receive({roomId,senderId,text,isBotAccount});
      if(hideOffTurn){
        const blind=typeof chat?.openChatBlind==='function'
          ? chat.openChatBlind.bind(chat)
          : typeof client?.openChatBlind==='function'
            ? client.openChatBlind.bind(client):null;
        if(!blind){
          console.warn('[EVENT BLIND] KakaoForge openChatBlind unavailable:',String(roomId));
          return;
        }
        try {
          // Use the actual MessageEvent: KakaoForge BLIND needs the original
          // log, author ID, openLinkId and chatLogInfo (not just a text string).
          const result=await blind(roomId,msg,{report:false});
          if(result===false||result?.success===false||result?.ok===false||
            (typeof result?.status==='number'&&result.status!==0))
            throw Error('BLIND response rejected: status='+String(result?.status));
        }catch(error){
          console.error('[EVENT BLIND] 가리기 실패:',String(roomId),
            String(msg?.message?.logId??msg?.message?.id??msg?.logId??msg?.id??''),
            String(error?.message||error));
        }
        return;
      }
      await ready;
      // Public ping. Prefix normalization already applied at the top of the router.
       if(text==='!핑'){
         const elapsed=Math.max(0,Date.now()-receivedAt);
         await chat.sendText(roomId,'🏓 퐁! NEXI 정상 작동 중\n⏱️ 명령 처리: '+elapsed+'ms');
         return;
       }
       // Serve the (static) game help before management and event pipelines.
      if(text==='!게임명령어'){
        await handleExtraMessage(client,msg);
        return;
      }
      
      const context = {
  client,
  roomId,
  userId: senderId ?? '',
  userName: msg.sender?.name || '알 수 없음',
  messageId: msg.id ?? msg.message?.id ?? null,
  text,
  isBotAccount,
  isSuperAdmin,
  roomBotAdmin,
  senderType: msg.sender?.type,
  botId: client.userId,
  msg,
  resolveTarget: () => require('../manage/targets').resolve({msg,text,roomId,client,db:require('./db').getPool()}),
  unban: typeof client.openChatUnkick === 'function' ? target => client.openChatUnkick(roomId,String(target)) : undefined,
  kick: async target => {
    const id = String(target);
    if (!/^\d{4,}$/.test(id)) throw new Error('정확한 카카오 사용자 ID를 입력해 주세요.');
    if (id === String(client.userId) || id === String(senderId))
      throw new Error('봇 또는 명령 실행자 본인은 내보낼 수 없습니다.');
    if (typeof client.openChatKick !== 'function') throw new Error('내보내기 API를 사용할 수 없습니다.');
    const result = await client.openChatKick(roomId, id);
    console.log('[KICK API]', JSON.stringify({ roomId: String(roomId), targetId: id, result }));
    if (result === false || result?.success === false || result?.ok === false ||
        result?.status === 'error' || (typeof result?.status === 'number' && result.status !== 0))
      throw new Error('내보내기 요청 실패: ' + JSON.stringify(result));
    return result;
  },
  send: body => chat.sendText(roomId, body)
};
      if (text === '!방인원 체크') {
        if (await require('./room-members-command').handle({text,roomId,client,send:context.send})) return;
      }
      if (text.startsWith('!') || text === 'ㅊㅅ') {
        try {
          if (await require('../manage/commands-v2').handle(context)) return;
        } catch (error) {
          console.error('[MANAGE COMMAND ERROR]', error);
          try { await context.send(text.split(/\s+/,1)[0]==='!벤해제'?'❌ 벤해제에 실패했습니다.':'❌ 관리 명령 처리에 실패했습니다.'); }
          catch (sendError) { console.error('[MANAGE SEND ERROR]', sendError); }
          return;
        }
      }
      if (text === '!타자게임') {
        await game.message({...context,msg,chat});
        return;
      }
      if (text === "!테스트") {
        await require("../manage/attendance-image/command")
          .handleTest(client, context);
        return;
      }
      
if(gameAliases.isGameCommand(text) && text!=='!게임on' && text!=='!게임off'){
  const started=Date.now();
  await game.message({...context,msg,chat});
  const elapsed=Date.now()-started;
  if(elapsed>=800)console.warn('[GAME COMMAND SLOW]',{command:text.split(/\s+/,1)[0],elapsedMs:elapsed});
  // Preserve management chat-count statistics without delaying the game reply.
  // This path cannot invoke management commands: aliases are game-only.
  Promise.resolve().then(()=>management.message(context))
    .catch(error=>console.error('[GAME CHAT COUNT]',error));
  return;
}

if (await require('./event-settings').handle({
  client,roomId,msg,text,send:context.send,roomBotAdmin
})) return;

if (text === '!이벤인원테스트') {
  await require('./event-member-test').handle({client, roomId, msg, roomBotAdmin, send: context.send});
  return;
}

if (text === '!이벤추첨테스트') {
  await require('./event-draw-test').handle({
    client, roomId, msg, send: context.send,roomBotAdmin,
    mention: (id, name) => {
      if (typeof chat?.mention !== 'function') return null;
      return chat.mention(id, name, roomId);
    }
  });
  return;
}

      if (['!이벤시작','!이벤트시작','!이벤시작랜덤방','!이벤종료','!이벤트중지'].includes(text)) {
        const event=require('./event-reaction-test');
        const commandArgs={
          client,roomId,msg,roomBotAdmin,isBotAccount,send:context.send,
          mention:(id,name)=>typeof chat?.mention==='function'
            ?chat.mention(id,name,roomId):null
        };
        if(text==='!이벤시작'||text==='!이벤트시작'||text==='!이벤시작랜덤방')await event.startUntilWinner({...commandArgs,randomRoom:text==='!이벤시작랜덤방'});
        else await event.stopUntilWinner(commandArgs);
        return;
      }

      if (text === '!이벤진행테스트') {
        await require('./event-reaction-test').start({
          client, roomId, msg, send: context.send,roomBotAdmin,
          mention: (id, name) => typeof chat?.mention === 'function' ? chat.mention(id, name, roomId) : null
        });
        return;
      }

      // Alternate room-game interface. Uses the existing game engine and data.
      const roomGameAliases={'!출항':'!낚시','!조황':'!낚시정보','!수조':'!어망','!가방':'!인벤','!도전':'!퀴즈','!제출':'!정답','!명예의전당':'!퀴즈순위','!교환소':'!상점','!어류도감':'!물고기도감','!입문':'!게임가입','!놀이정보':'!게임정보'};
      const roomGameStyle=body=>{
        let out=String(body);
        const replacements=[[/NEXI/g,'🎲 플레이존'],[/낚시 성공/g,'포획 성공'],[/낚시 실패/g,'포획 실패'],[/낚시정보/g,'조황'],[/물고기도감/g,'어류도감'],[/퀴즈순위/g,'명예의전당'],[/퀴즈/g,'도전 문제'],[/정답/g,'제출 답안'],[/어망/g,'수조'],[/인벤/g,'가방'],[/상점/g,'교환소'],[/!낚시/g,'!출항'],[/!퀴즈/g,'!도전'],[/!정답/g,'!제출'],[/!어망/g,'!수조'],[/!인벤/g,'!가방'],[/!상점/g,'!교환소']];
        for(const [pattern,replacement] of replacements)out=out.replace(pattern,replacement);
        return '🎲 플레이존 | '+out;
      };
      if(text==='!방게임시작'||text==='!방게임종료'){
        if(!isBotAccount&&!roomBotAdmin&&!isSuperAdmin){await context.send('⛔ 방게임 설정 권한이 없습니다.');return;}
        const on=text==='!방게임시작';
        await game.toggle({...context,text:on?'!게임on':'!게임off',send:async()=>{}});
        await require('./db').getPool().query("INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object('roomGame',$2::boolean)) ON CONFLICT(room_id) DO UPDATE SET data=jsonb_set(hz_rooms.data,'{roomGame}',to_jsonb($2::boolean),true),updated_at=NOW()",[String(roomId),on]);
        await context.send(on?'🎲 놀이방이 열렸습니다! 게임을 시작해 보세요.':'🎲 놀이방을 종료했습니다.');return;
      }
      if(text==='!방게임명령어'){
        await context.send('🎲 플레이존 | 이용 안내\n!방게임시작 / !방게임종료\n!입문 · !놀이정보\n🐟 !출항 · !조황 · !수조 · !가방 · !어류도감\n🧠 !도전 · !제출 · !명예의전당\n🛒 !교환소');return;
      }
      const roomGameToken=text.split(/\s+/,1)[0];
      if(roomGameAliases[roomGameToken]){
        const state=await require('./db').getPool().query("SELECT data->>'roomGame' AS active FROM hz_rooms WHERE room_id=$1",[String(roomId)]);
        if(!isBotAccount&&state.rows[0]?.active!=='true')return;
        const translated=roomGameAliases[roomGameToken]+text.slice(roomGameToken.length);
        await game.message({...context,text:translated,chat,msg,send:body=>context.send(roomGameStyle(body))});return;
      }
      if (text === '!게임on' || text === '!게임off') {
        await game.toggle(context);
        return;
      }

      if (!gameAliases.isGameCommand(text) && await management.message(context)) return;
      if (text !== '#주식시간' && await handleExtraMessage(client, ...args)) return;
      if (/^#출석(?:확인|순위)?(?:\s|$)/.test(text)) return;
      await game.message({ ...context, msg, chat });
      }); // ARDEN output scope
    } catch (err) { console.error('[HZ NEW] 메시지 처리 실패:', err); }
  });
}
module.exports = { attachRouter };
