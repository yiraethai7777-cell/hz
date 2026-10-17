"use strict";
// Persistent state is supplied explicitly; this module registers no client listener.
module.exports = function createFeatures(ctx) {
async function attachHZBot(client){
  ctx.globalClient=client;ctx.globalChat=client.chat||client;ctx.globalBotId=ctx.id(client.userId);await ctx.initDb();
  if(ctx.promoTimer)clearInterval(ctx.promoTimer);
  ctx.promoTimer=setInterval(()=>{ctx.promoTick().catch(e=>console.error("[HZ PROMO]",e));},10000);
  if(ctx.promoTimer.unref)ctx.promoTimer.unref();
  ctx.promoTick().catch(e=>console.error("[HZ PROMO]",e));
  if(ctx.autoFishTimer)clearInterval(ctx.autoFishTimer);ctx.autoFishTimer=setInterval(async()=>{if(ctx.autoFishBusy)return;ctx.autoFishBusy=true;try{await ctx.autoFishTick()}catch(e){console.error("[GL AUTO TICK]",e)}finally{ctx.autoFishBusy=false}},10000);if(ctx.autoFishTimer.unref)ctx.autoFishTimer.unref();

  client.onMessage(async (...args)=>{
    try{
      const msg=args.length===1?args[0]:args[1];
      const chat=args.length===1?(client.chat||client):args[0];
      if(!msg?.room?.id)return;
      ctx.globalChat=chat;

      const rid=ctx.id(msg.room.id),rname=msg.room.name||"",uid=ctx.id(msg.sender?.id??msg.senderId),
        isSelf=uid===ctx.globalBotId,isAdmin=uid===ctx.globalBotId||ctx.OWNER_IDS.has(uid),text=String(msg.message?.text??msg.text??"").trim(),
        name=String(msg.sender?.name||uid);

      const exactSender=ctx.senderExactId(msg);
      if(exactSender && !isSelf){
        const mentionFlags=await ctx.roomFlags(rid);
        if(mentionFlags.manage&&!mentionFlags.locked)await ctx.processMentionAlerts(chat,rid,msg,exactSender,name);
      }
      if(!isSelf)await ctx.addChatCount(rid,uid,name);
      if(!isSelf){
        // Only inspect the sender object; message attachments may describe another person.
        await ctx.saveOpenProfileLink(rid,uid,name,msg.sender);
        // Some KakaoForge versions expose sender profile fields in raw sender.
        await ctx.saveOpenProfileLink(rid,uid,name,msg.raw?.sender);
      }
      if(text==="!프로필진단"){
        await ctx.send(chat,rid,ctx.profileDiagnostic(msg));
        return;
      }
      if(text==="!내아이디"){await ctx.send(chat,rid,`🔎 내 계정 정보\n닉네임: ${name}\n사용자 ID: ${uid}`);return;}

      let flags=await ctx.roomFlags(rid);
      if(text==="!삭메기록켜기"||text==="!삭메기록끄기"){
        if(!isAdmin)return;
        const enabled=text==="!삭메기록켜기";
        await ctx.withRoom(rid,rname,async d=>{d.deleteCacheEnabled=enabled});
        if(!enabled)await ctx.pool.query("DELETE FROM hz_message_cache WHERE room_id=$1",[rid]);
        await ctx.send(chat,rid,enabled
          ?"📢 삭제 메시지 기록 안내\n이 방에서 새로 수신한 일반 텍스트 메시지를 최대 24시간 동안 임시 보관하고, 삭제 감지 시 원문 확인에 사용할 수 있습니다. 메시지 ID가 연결되지 않으면 원문을 표시할 수 없습니다."
          :"🔒 삭제 메시지 원문 임시 기록을 중지하고 기존 임시 기록을 삭제했습니다.");
        return;
      }
      if(flags.deleteCacheEnabled && !isSelf && !text.startsWith("!"))await ctx.saveDeleteCache(rid,msg,text);

      if(text==="!봇작동"){
        if(!isAdmin)return;
        const out=await ctx.withRoom(rid,rname,async d=>{d.locked=false;return "✅ 봇 잠금이 해제되었습니다.\n기존 게임·관리·준개 작동 설정은 유지됩니다."});
        await ctx.send(chat,rid,out);return
      }

      if(flags.locked){
        if(isAdmin&&text==="!관리중지")return;
        return
      }

      if(!text.startsWith("!")){
        await ctx.autoSpamCheck(msg,chat,rid,uid,name,text,isSelf,flags);
        if(flags.manage){
          const pr=ctx.extractProfile(msg.raw);
          if(pr)await ctx.withRoom(rid,rname,async(d,c)=>{
            const ch=await ctx.profileObserve(c,rid,pr.id,pr.name,pr.url);
            if(ch)await ctx.send(chat,rid,`👤 ${ch.newName}님이 프로필을 변경했습니다.\n${ctx.MORE}\n이전 닉네임: ${ch.oldName||"?"}\n현재 닉네임: ${ch.newName||"?"}\n이전 프로필: ${ch.oldUrl||"확인 불가"}\n현재 프로필: ${ch.newUrl||"확인 불가"}\n시간: ${ctx.nowK()}`)
          })
        }
        return
      }

      // 홍보 명령어는 게임/준개/관리 활성화 여부와 독립적으로 동작.
      if(/^!(홍보설정|홍보시작|홍보중지|홍보확인|도배방지|도배방지끄기|도배방지확인)(?:\s|$)/.test(text)){
        if(!isAdmin){await ctx.send(chat,rid,"⛔ 최고 관리자만 홍보 설정을 변경할 수 있습니다.");return;}
        const cmd=text.split(/\s+/)[0], arg=text.slice(cmd.length).trim();
        const out=await ctx.withRoom(rid,rname,async d=>{
          const p=d.promo;
          if(cmd==="!홍보설정"){
            if(!arg)return "사용법: !홍보설정 (홍보할 문구)";
            if(arg.length>1000)return "홍보 문구는 1,000자 이하로 설정해 주세요.";
            p.message=arg;return "✅ 홍보 문구가 저장되었습니다.\n"+arg;
          }
          if(cmd==="!홍보시작"){
            if(!/^\d+$/.test(arg))return "사용법: !홍보시작 (분)\n예: !홍보시작 20";
            const m=Number(arg);
            if(!Number.isInteger(m)||m<5||m>120)return "홍보 간격은 5~120분으로 설정해 주세요.";
            if(!p.message)return "먼저 !홍보설정 (내용)으로 홍보 문구를 저장해 주세요.";
            p.minutes=m;p.enabled=true;p.stopReason="";
            p.sentTimes=[];
            // 이전 스케줄의 기록을 초기화하되 같은 슬롯 재전송은 방지.
            const now=Date.now(),slot=ctx.promoSlot(now,m);
            p.lastSlot=slot;
            const next=slot+m*60000;
            return `📢 자동 홍보 시작\n간격: ${m}분\n다음 홍보: ${new Date(next).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}\n도배 방지: ${p.antiSpam?"켜짐":"꺼짐"}`;
          }
          if(cmd==="!홍보중지"){p.enabled=false;p.stopReason="관리자가 중지";return "⏹️ 이 방의 자동 홍보가 중지되었습니다.";}
          if(cmd==="!도배방지"){p.antiSpam=true;return "🛡️ 홍보 도배 방지가 켜졌습니다. 10초 이내 3회 전송을 방지합니다.";}
          if(cmd==="!도배방지끄기"){p.antiSpam=false;return "⚠️ 홍보 도배 방지가 꺼졌습니다.";}
          if(cmd==="!도배방지확인")return `🛡️ 홍보 도배 방지: ${p.antiSpam?"켜짐":"꺼짐"}\n기준: 10초 이내 3회 전송`;
          return `📢 홍보 상태: ${p.enabled?"작동 중":"중지"}\n간격: ${p.minutes||"미설정"}분\n문구: ${p.message||"미설정"}\n도배 방지: ${p.antiSpam?"켜짐":"꺼짐"}${p.stopReason?"\n최근 중지 사유: "+p.stopReason:""}`;
        });
        await ctx.send(chat,rid,out);return;
      }

      if(text==="!초기화"||text==="!초기화확인"){
        if(!ctx.OWNER_IDS.has(uid)){await ctx.send(chat,rid,"⛔ 최고 관리자만 게임 초기화를 실행할 수 있습니다. HZ_OWNER_IDS 설정을 확인하세요.");return;}
        if(text==="!초기화"){
          await ctx.withRoom(rid,rname,async d=>{d.gameResetRequest={uid,expires:Date.now()+60000};});
          await ctx.send(chat,rid,"⚠️ 전체 방의 게임 데이터(코인, 레벨, 물고기, 펫, 강화, 보호권 등)를 초기화합니다.\n채팅순위(hz_chat_stats)와 출석 기록은 유지됩니다.\n60초 이내 !초기화확인 을 입력하세요.");return;
        }
        const valid=await ctx.withRoom(rid,rname,async d=>{const x=d.gameResetRequest;const ok=x&&x.uid===uid&&x.expires>Date.now();delete d.gameResetRequest;return !!ok;});
        if(!valid){await ctx.send(chat,rid,"⏰ 초기화 요청이 없거나 만료되었습니다. !초기화부터 입력하세요.");return;}
        await ctx.pool.query(`UPDATE hz_rooms SET data=jsonb_set(jsonb_set(jsonb_set(jsonb_set(data,'{players}','{}'::jsonb,true),'{quiz}','null'::jsonb,true),'{quizQueue}','[]'::jsonb,true),'{lastQuiz}','-1'::jsonb,true),updated_at=NOW()`);
        await ctx.send(chat,rid,"✅ 모든 방의 게임 데이터가 초기화되었습니다.\n📊 채팅순위·채팅 횟수·출석 기록은 그대로 유지됩니다.");return;
      }

      const control=["!퀴즈작동","!퀴즈중지","!낚시작동","!낚시중지","!게임작동","!게임중지","!관리작동","!관리중지","!준개작동","!준개중지"];
      if(control.includes(text)){
        if(!isAdmin)return;
        const out=await ctx.withRoom(rid,rname,async d=>{
          if(text==="!퀴즈작동"){d.quizEnabled=true;return "🧩 퀴즈 ON"}
          if(text==="!퀴즈중지"){d.quizEnabled=false;d.quiz=null;return "🧩 퀴즈 OFF"}
          if(text==="!낚시작동"){d.fishEnabled=true;return "🎣 낚시 ON"}
          if(text==="!낚시중지"){d.fishEnabled=false;return "🎣 낚시 OFF"}
          if(text==="!게임작동"){d.game=true;return "🎮 게임 기능이 작동되었습니다."}
          if(text==="!게임중지"){d.game=false;return "⏹️ 게임 기능이 중지되었습니다."}
          if(text==="!관리작동"){d.manage=true;return "🛡️ 관리 기능이 작동되었습니다."}
          if(text==="!관리중지"){d.manage=false;return "🛡️ 관리 기능이 중지되었습니다."}
           if(text==="!준개작동"){d.jun=true;d.game=false;return "📦 준개 기능이 작동되었습니다.\n🎮 게임 기능은 꺼졌습니다.\n🛡️ 관리 기능 설정은 유지됩니다."}
           if(text==="!준개중지"){d.jun=false;return "📦 준개 기능이 중지되었습니다."}
        });
        await ctx.send(chat,rid,out);return
      }

      flags=await ctx.roomFlags(rid);
      const templateCommand=/^!(입장변경|퇴장변경)(?:\s|$)/.exec(text);
      if(templateCommand){
        if(!isAdmin&&!ctx.isOwnerType(msg.sender?.type)){
          await ctx.send(chat,rid,"⛔ 방장 또는 봇 계정만 변경할 수 있습니다.");return;
        }
        const field=templateCommand[1]==="입장변경"?"joinTemplate":"leaveTemplate";
        const content=text.slice(templateCommand[0].length).trim();
        if(!content){
          await ctx.send(chat,rid,`사용법: !${templateCommand[1]} (내용)\n사용 가능: (이름) (해시) (방이름) (날짜)\n기본 문구로 되돌리려면: !${templateCommand[1]} 기본`);return;
        }
        if(content.length>2000){await ctx.send(chat,rid,"문구는 2,000자 이하로 입력해 주세요.");return;}
        await ctx.withRoom(rid,rname,async d=>{d[field]=content==="기본"?null:content;});
        await ctx.send(chat,rid,content==="기본"?`✅ ${templateCommand[1]} 문구를 기본값으로 되돌렸습니다.`:`✅ ${templateCommand[1]} 문구가 저장되었습니다.\n\n미리보기:\n${ctx.formatMemberTemplate(content,{name:"홍길동",uid:"123456789",roomName:rname||"채팅방"})}`);
        return;
      }
      if(text==="!명령어"){if(flags.game)await ctx.send(chat,rid,ctx.gameHelp());if(flags.jun)await ctx.send(chat,rid,ctx.junHelp());if(flags.manage)await ctx.send(chat,rid,ctx.manageHelp());if(isAdmin)await ctx.send(chat,rid,"📢 자동 홍보\n!홍보설정 (내용)\n!홍보시작 (분)\n!홍보중지 / !홍보확인\n!도배방지 / !도배방지끄기 / !도배방지확인");return}

      if(text==="!준개권한목록"){
        if(!isAdmin)return;
        const q=await ctx.pool.query(`SELECT p.user_id,COALESCE(m.name,cs.name,p.name,p.user_id) AS display_name
          FROM hz_jun_permissions p
          LEFT JOIN hz_members m ON m.room_id=p.room_id AND m.user_id=p.user_id
          LEFT JOIN hz_chat_stats cs ON cs.room_id=p.room_id AND cs.user_id=p.user_id
          WHERE p.room_id=$1 ORDER BY p.created_at ASC`,[rid]);
        await ctx.send(chat,rid,q.rows.length?"📦 준개 권한 목록\n"+q.rows.map((x,i)=>`${i+1}. 👤 ${x.display_name}\n   🆔 ${x.user_id}`).join("\n"):"📦 준개 권한을 가진 사람이 없습니다.");
        return;
      }
      if(/^!준개권한(?:추가|삭제)(?:\s|$)/.test(text)){
        if(!isAdmin)return;
        const isAdd=text.startsWith("!준개권한추가");
        const argument=text.replace(/^!준개권한(?:추가|삭제)/,"").trim();
        if(!argument){await ctx.send(chat,rid,"사용법: !준개권한추가 @닉네임 또는 카카오 사용자 ID\n!준개권한삭제 @닉네임 또는 카카오 사용자 ID");return;}
        const out=await ctx.withRoom(rid,rname,async(d,c)=>{
          const t=await ctx.junPermissionTarget(c,rid,msg,argument);
          if(t.error)return t.error;
          if(isAdd){
            await c.query(`INSERT INTO hz_jun_permissions(room_id,user_id,name,granted_by) VALUES($1,$2,$3,$4)
              ON CONFLICT(room_id,user_id) DO UPDATE SET name=EXCLUDED.name,granted_by=EXCLUDED.granted_by`,
              [rid,t.id,t.name,ctx.globalBotId]);
            const check=await c.query("SELECT 1 FROM hz_jun_permissions WHERE room_id=$1 AND user_id=$2",[rid,t.id]);
            if(!check.rowCount)return "❌ 권한 저장을 확인하지 못했습니다.";
            return `✅ 준개 권한 추가 완료\n👤 ${t.name}\n🆔 ${t.id}`;
          }
          const removed=await c.query("DELETE FROM hz_jun_permissions WHERE room_id=$1 AND user_id=$2 RETURNING user_id",[rid,t.id]);
          return removed.rowCount?`🗑️ 준개 권한 삭제 완료\n👤 ${t.name}\n🆔 ${t.id}`:"해당 사용자는 준개 권한 목록에 없습니다.";
        });
        await ctx.send(chat,rid,out);return;
      }

      if(text==="!송금"||text.startsWith("!송금 ")){
        if(!flags.game){await ctx.send(chat,rid,"🎮 이 방은 게임이 꺼져 있습니다.");return;}
        if(isSelf){return;}
        const match=/^!송금\s+(.+?)\s+([0-9]+)$/.exec(text);
        if(!match){await ctx.send(chat,rid,"사용법: !송금 @멘션 (포인트)\n예: !송금 @홍길동 10000");return;}
        const amount=Number(match[2]);
        if(!Number.isSafeInteger(amount)||amount<1||amount>1000000000000){await ctx.send(chat,rid,"❌ 송금 금액은 1~1조 포인트의 정수여야 합니다.");return;}
        const result=await ctx.withRoom(rid,rname,async(d,c)=>{
          const mentionList=ctx.rawMentions(msg).filter(x=>ctx.safeUserId(x.id));
          if(mentionList.length!==1)return "❌ 받을 사람 한 명을 실제 카카오톡 멘션으로 지정해 주세요.";
          const target=await ctx.resolveTarget(c,rid,mentionList[0]);
          if(!target||!target.id)return "❌ 멘션한 사용자를 확인할 수 없습니다.";
          if(target.id===uid)return "❌ 자기 자신에게는 송금할 수 없습니다.";
          if(target.id===ctx.globalBotId)return "❌ 봇에게는 송금할 수 없습니다.";
          const sender=ctx.player(d,uid,name);
          if(sender.points<amount)return `💰 포인트 부족\n보유: ${ctx.n(sender.points)}P / 송금: ${ctx.n(amount)}P`;
          const receiver=ctx.player(d,target.id,target.name||target.id);
          sender.points-=amount;
          receiver.points+=amount;
          return `💸 송금 완료!\n보낸 사람: ${sender.name}\n받는 사람: ${receiver.name}\n송금액: ${ctx.n(amount)}P\n남은 포인트: ${ctx.n(sender.points)}P`;
        });
        await ctx.send(chat,rid,result);return;
      }

      if(/^!회수(?:\s|$)/.test(text)){
        if(!isAdmin||!flags.game)return;
        const mm=/^!회수\s+(all|[0-9]+)(?:\s|$)/i.exec(text);
        let t=ctx.targetFrom(msg,text);
        if(!mm||!t){await ctx.send(chat,rid,"사용법: !회수 (코인/all) @(멘션) 또는 해시");return;}
        const all=mm[1].toLowerCase()==="all";
        const amount=all?null:Number(mm[1]);
        if(!all&&(!Number.isSafeInteger(amount)||amount<1||amount>1000000000000)){
          await ctx.send(chat,rid,"회수 코인은 1~1,000,000,000,000 범위로 입력해주세요.");return;
        }
        const out=await ctx.withRoom(rid,rname,async(d,c)=>{
          t=await ctx.resolveTarget(c,rid,t);
          if(!t||!t.id)return "❌ 회수 대상을 찾을 수 없습니다.";
          if(t.id===ctx.globalBotId)return "❌ 봇 계정의 포인트는 회수할 수 없습니다.";
          const p=ctx.player(d,t.id,t.name||t.id);
          const balance=Math.max(0,Number(p.points)||0);
          const taken=all?balance:Math.min(balance,amount);
          p.points=balance-taken;
          return `💰 포인트 회수 완료\n👤 대상: ${p.name}\n💸 회수 포인트: ${ctx.n(taken)}P\n💰 남은 포인트: ${ctx.n(p.points)}P${taken===0?"\nℹ️ 회수할 포인트가 없습니다.":""}`;
        });
        await ctx.send(chat,rid,out);return;
      }

      if(text.startsWith("!치트")){
        if(!isAdmin||!flags.game)return;
        const mm=/^!치트\s+([0-9]+)[\s\S]*$/.exec(text);
        let t=ctx.targetFrom(msg,text);
        if(!mm||!t){await ctx.send(chat,rid,"사용법: !치트 (코인) @(멘션) 또는 해시");return}
        const amount=Number(mm[1]);
        if(!Number.isSafeInteger(amount)||amount<1||amount>1000000000000){await ctx.send(chat,rid,"지급 코인은 1~1,000,000,000,000 범위로 입력해주세요.");return}
        const out=await ctx.withRoom(rid,rname,async(d,c)=>{t=await ctx.resolveTarget(c,rid,t);const p=ctx.player(d,t.id,t.name||t.id);p.points+=amount;return `💰 치트 지급 완료\n👤 ${p.name}\n💵 +${ctx.n(amount)}코인\n💰 현재 ${ctx.n(p.points)}코인\n🤖 봇 잔액: ∞`});
        await ctx.send(chat,rid,out);return
      }

      const out=await ctx.withRoom(rid,rname,async(d,c)=>{
        let r=null;
        if(flags.manage){
          r=await ctx.handleManageStats(d,c,msg);
          if(!r)r=await ctx.handleManage(d,c,msg,isAdmin);
        }
        if(r)return r;
        const isJunCommand=/^!(?:준개(?:\s|내역|내역삭제|$)|전체준개내역)/.test(text);
        if(isJunCommand){
          if(!flags.jun)return null;
          r=await ctx.handleGame(d,c,msg,isSelf);
          return r;
        }
        if(flags.game)r=await ctx.handleGame(d,c,msg,isSelf);
        return r
      });
      if(out)await ctx.send(chat,rid,out)
    }catch(e){console.error("[HZ BOT]",e)}
  });

  const memberEvent=type=>async ev=>{
    try{
      const rid=ctx.id(ev.room?.id);if(!rid)return;
      const f=await ctx.roomFlags(rid);if(!f.manage||f.locked)return;

      const ids=ev.member?.ids||ev.members?.map(x=>x.id)||[];
      const names=ev.member?.names||ev.members?.map(x=>x.name)||[];
      const actorId=ctx.id(ev.actor?.id??ev.actor?.userId??ev.actor?.memberId);
      const actorName=String((ev.actor?.name??ev.actor?.nickname??ev.actor?.nickName??actorId)||"알 수 없음");
      const actorType=Number(ev.actor?.type);

      for(let i=0;i<ids.length;i++){
        const uid=ctx.id(ids[i]),name=String(names[i]||uid);
        await ctx.pool.query(`INSERT INTO hz_members(room_id,user_id,name,join_count,leave_count)
          VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(room_id,user_id) DO UPDATE SET
          name=EXCLUDED.name,
          join_count=hz_members.join_count+EXCLUDED.join_count,
          leave_count=hz_members.leave_count+EXCLUDED.leave_count,
          last_seen=NOW()`,
          [rid,uid,name,type==="join"?1:0,(type==="leave"||type==="kick")?1:0]);

        // Collect profile links when the event includes an individual member object.
        const eventMember=Array.isArray(ev.members)?ev.members[i]:
          (Array.isArray(ev.member?.members)?ev.member.members[i]:null);
        if(eventMember && ctx.id(eventMember.id??eventMember.userId)===uid)
          await ctx.saveOpenProfileLink(rid,uid,name,eventMember);

        await ctx.pool.query("INSERT INTO hz_events(room_id,user_id,name,event_type,meta) VALUES($1,$2,$3,$4,$5::jsonb)",
          [rid,uid,name,type,JSON.stringify({actorId:actorId||null,actorName:actorName||null,actorType:Number.isFinite(actorType)?actorType:null})]);

        if(type==="join"){
          // DB에 저장된 ID가 일치할 때만 재입장 자동 강퇴 시도.
          // 부정확한 숫자 ID로 엉뚱한 사용자를 강퇴하지 않도록 검사.
          const exactJoinId=ctx.safeUserId(ids[i]);
          if(exactJoinId && exactJoinId===uid && uid!==ctx.globalBotId){
            const banned=await ctx.pool.query("SELECT name FROM hz_ban_registry WHERE room_id=$1 AND user_id=$2",[rid,uid]);
            if(banned.rows.length){
              try{
                if(!ctx.globalChat||typeof ctx.globalChat.openChatKick!=="function")throw new Error("openChatKick 기능 없음");
                const result=await ctx.globalChat.openChatKick(rid,uid);
                console.log("[GL AUTO BAN]",JSON.stringify({roomId:rid,userId:uid,result:result===undefined?"undefined":result}));
                if(result===false||result?.success===false||result?.ok===false||result?.status==="error")throw new Error("강퇴 API가 실패를 반환했습니다");
                await ctx.send(ctx.globalChat,rid,`⏳ 자동 벤 요청\n대상: ${name}\n아이디: ${uid}`);
              }catch(e){
                console.error("[GL AUTO BAN FAILED]",e);
                await ctx.send(ctx.globalChat,rid,`⚠️ 재입장 자동 강퇴 실패\n대상: ${name}\n봇의 방장/부방장 권한과 Railway 로그를 확인해 주세요.`);
              }
              continue;
            }
          }else{
            console.warn("[GL AUTO BAN] 입장 이벤트의 사용자 ID가 안전하지 않아 자동 강퇴를 생략했습니다.");
          }
          const q=await ctx.pool.query("SELECT join_count,leave_count FROM hz_members WHERE room_id=$1 AND user_id=$2",[rid,uid]);
          const joins=Number(q.rows[0]?.join_count||0);
          const leaves=Number(q.rows[0]?.leave_count||0);
          const roomName=String(ev.room?.name||"이 방");
          const greeting=joins<=1
            ? `👋 안녕하세요, ${name}님!\n${roomName}에 오신 걸 환영합니다 🎉\n\n즐겁게 활동해 주세요!`
            : `👋 다시 오셨네요, ${name}님!\n${roomName}에 오신 걸 환영합니다 🎉\n\n즐겁게 활동해 주세요!`;
          const output = `${f.joinTemplate
            ? ctx.formatMemberTemplate(f.joinTemplate, {name, uid, roomName})
            : greeting}\n\n🕒 입장 시간: ${ctx.nowK()}\n🚪 입장 ${joins}회 · 퇴장 ${leaves}회`;
          await ctx.send(ctx.globalChat,rid,output)
        }

        if(type==="leave"){
          const roomName=String(ev.room?.name||f.name||"이 방");
          const output=(f.leaveTemplate?ctx.formatMemberTemplate(f.leaveTemplate,{name,uid,roomName}):`👋 ${name}님이 퇴장했습니다.\n🕒 ${ctx.nowK()}`)+`\n사용자 ID: ${uid}`;
          await ctx.send(ctx.globalChat,rid,output);
        }

        if(type==="kick"){
          const key=rid+":"+uid;
          const pending=ctx.pendingManualKicks.get(key);
          if(pending){
            pending.confirmed=true;
            if(pending.timer)clearTimeout(pending.timer);
            ctx.pendingManualKicks.delete(key);
            await ctx.send(ctx.globalChat,rid,`🚫 벤 완료\n대상: ${pending.name}\n아이디: ${uid}`);
          }
          if(!pending){
            const registered=await ctx.pool.query("SELECT 1 FROM hz_ban_registry WHERE room_id=$1 AND user_id=$2",[rid,uid]);
            if(registered.rows.length&&actorId===ctx.globalBotId)await ctx.send(ctx.globalChat,rid,`🚫 자동 벤 완료\n대상: ${name}\n아이디: ${uid}`);
            else await ctx.send(ctx.globalChat,rid,`🚨 강퇴 감지\n대상: ${name}\n아이디: ${uid}\n실행자: ${actorName||"알 수 없음"}`);
          }

          if(actorId&&actorId!==ctx.globalBotId&&ctx.isSubManagerType(actorType)){
            const key=rid+":"+actorId,now=Date.now();
            const arr=(ctx.kickBurst.get(key)||[]).filter(t=>now-t<=60000);
            arr.push(now);ctx.kickBurst.set(key,arr);
            if(arr.length>=7){
              await ctx.withRoom(rid,ev.room?.name||"",async d=>{d.locked=true;d.game=false;d.manage=false});
              ctx.kickBurst.delete(key);
              await ctx.send(ctx.globalChat,rid,`🚨 테러 방어 작동\n\n${actorName}님이 60초 안에 7명을 강퇴했습니다.\n봇 기능을 잠갔습니다.\n\n🤖 봇 계정에서 !봇작동 입력 시 다시 작동합니다.`);
              return
            }
          }
        }
      }
    }catch(e){console.error("[HZ MEMBER]",e)}
  };

  client.onJoin(memberEvent("join"));
  client.onLeave(memberEvent("leave"));
  client.onKick(memberEvent("kick"));

  if(typeof client.onDelete==="function"){
    client.onDelete(async (...args)=>{
      try{
        const evt=args.length===1?args[0]:args[1];
        const chat=args.length===1?(client.chat||client):args[0];
        if(!evt)return;
        const rid=ctx.pickDeleteRoom(evt); if(!rid)return;
        const flags=await ctx.roomFlags(rid); if(!flags.manage||flags.locked)return;
        const actor=ctx.pickDeleteActor(evt), mid=ctx.deletedMessageId(evt);
        const deletedText=ctx.pickDeletedText(evt)||(flags.deleteCacheEnabled?await ctx.lookupDeleteCache(rid,mid):"");
        await ctx.pool.query("INSERT INTO hz_deleted_messages(room_id,deleter_id,deleter_name,message_text,meta) VALUES($1,$2,$3,$4,$5::jsonb)",
          [rid,actor.id||null,actor.name||null,deletedText||null,JSON.stringify({event:"delete",matchedById:!!mid&&!!deletedText})]);
        await ctx.send(chat,rid,`🗑️ 메시지 삭제 감지\n\n👤 삭제자: ${actor.name||actor.id||"확인 불가"}\n💬 삭제된 내용: ${deletedText||"내용 확인 불가"}\n🕒 시간: ${ctx.nowK()}`);
        if(actor.id&&actor.id!==ctx.globalBotId){
          await ctx.pool.query("INSERT INTO hz_warnings(room_id,target_id,target_name,count,reason,issuer_id,issuer_name) VALUES($1,$2,$3,1,$4,$5,$6)",
            [rid,actor.id,actor.name||actor.id,"메시지 삭제",ctx.globalBotId,"GL BOT"]);
          const wc=await ctx.activeWarningCount(ctx.pool,rid,actor.id);
          await ctx.send(chat,rid,`⚠️ ${actor.name||actor.id}님 자동 경고 1개\n이유: 메시지 삭제\n현재 경고: ${wc}/4`);
          if(wc>=4){
            try{await ctx.globalChat.openChatKick(rid,actor.id);await ctx.send(chat,rid,`🚫 ${actor.name||actor.id}님이 경고 ${wc}개에 도달하여 자동 벤 처리되었습니다.`)}
            catch(e){console.error("[HZ DELETE WARNING BAN]",e);await ctx.send(chat,rid,`⚠️ ${actor.name||actor.id}님이 경고 ${wc}개에 도달했지만 자동 벤에 실패했습니다.`)}
          }
        }
      }catch(e){console.error("[HZ DELETE]",e)}
    });
  }
  return {botUserId:ctx.globalBotId}
}
return {attachHZBot};
};
