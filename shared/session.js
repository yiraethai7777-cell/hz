"use strict";
// Persistent state is supplied explicitly; this module registers no client listener.
module.exports = function createFeatures(ctx) {
async function attachHZBot(client){
  ctx.globalClient=client;ctx.globalChat=client.chat||client;ctx.globalBotId=ctx.id(client.userId);await ctx.initDb();
  await require('../manage/leave-reply').init(ctx.pool);
  if(ctx.promoTimer)clearInterval(ctx.promoTimer);
  ctx.promoTimer=setInterval(()=>{ctx.promoTick().catch(e=>console.error("[HZ PROMO]",e));},10000);
  if(ctx.promoTimer.unref)ctx.promoTimer.unref();
  ctx.promoTick().catch(e=>console.error("[HZ PROMO]",e));
  if(ctx.autoFishTimer)clearInterval(ctx.autoFishTimer);ctx.autoFishTimer=setInterval(async()=>{if(ctx.autoFishBusy)return;ctx.autoFishBusy=true;try{await ctx.autoFishTick()}catch(e){console.error("[AUTO TICK]",e)}finally{ctx.autoFishBusy=false}},10000);if(ctx.autoFishTimer.unref)ctx.autoFishTimer.unref();

  if(ctx.quizExpiryTimer)clearInterval(ctx.quizExpiryTimer);
  ctx.quizExpiryTimer=setInterval(()=>{
    ctx.quizExpiryTick().catch(e=>console.error('[QUIZ EXPIRE]',e));
  },1000);
  if(ctx.quizExpiryTimer.unref)ctx.quizExpiryTimer.unref();
  ctx.quizExpiryTick().catch(e=>console.error('[QUIZ EXPIRE]',e));

  client.onMessage(async (...args)=>{
    try{
      const msg=args.length===1?args[0]:args[1];
      const chat=args.length===1?(client.chat||client):args[0];
      if(!msg?.room?.id)return;
      ctx.globalChat=chat;

      const rid=ctx.id(msg.room.id),rname=msg.room.name||"",uid=ctx.id(msg.sender?.id??msg.senderId),
        isSelf=uid===ctx.globalBotId,isAdmin=uid===ctx.globalBotId||ctx.OWNER_IDS.has(uid),text=String(msg.message?.text??msg.text??"").trim(),
        name=String(msg.sender?.name||uid);

      // Reply to game commands first. Member statistics and profile observation
      // run after the game response and cannot delay its delivery.
      const priorityGame=msg.__gameCommandFastPath===true &&
        /^#(?:퀴즈|정답|퀴즈정보|퀴즈순위|낚시|낚시정보|어망|인벤|물고기도감|물고기판매|낚시대구매|낚시장착|강화|보호권구매|보호권|구매행운|구매자동|펫뽑기|펫인벤|펫도감|펫기능|펫장착|펫강화)(?:\s|$)/.test(text);
      if(priorityGame){
        // One locked room read is sufficient; avoid a separate roomFlags query.
        const out=await ctx.withRoom(rid,rname,async(d,c)=>{
          if(!d.game||d.locked)return null;
          return ctx.handleGame(d,c,msg,isSelf);
        });
        if(out)await ctx.send(chat,rid,out);
      }

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
      let flags=await ctx.roomFlags(rid);
      if(text==="#내아이디"){
        if(!flags.manage||flags.locked)return;
        if(!ctx.isManagerType(msg.sender?.type)){
          await ctx.send(chat,rid,"⛔ 방장·부방장만 사용할 수 있습니다.");
          return;
        }
        await ctx.send(chat,rid,`🔎 내 계정 정보\n닉네임: ${name}\n사용자 ID: ${uid}`);
        return;
      }
      if(flags.manage&&!flags.locked&&!isSelf&&exactSender){
        const snapshot=typeof client.getUserProfileSnapshot==='function'?client.getUserProfileSnapshot(rid,uid):null;
        const received=ctx.extractProfile(msg.sender)||ctx.extractProfile(msg.raw?.sender);
        let openLink=ctx.findOpenProfileLink(msg.sender)||ctx.findOpenProfileLink(msg.raw?.sender)||undefined;
        if([1,2,4].includes(snapshot?.profileType))openLink='';
        else if(!priorityGame&&snapshot?.profileLinkId&&typeof client.getUserOpenProfileLink==='function'){
          try{const live=await client.getUserOpenProfileLink(rid,uid);if(live)openLink=live;}catch(e){console.error('[PROFILE LINK]',e.message);}
        }
        // Profile history lives in hz_members/hz_profiles, not in hz_rooms.
        // Avoid locking and re-writing the whole game room for every chat.
        const change=await ctx.profileObserve(ctx.pool,rid,uid,name,snapshot?.imageUrl||received?.url||'',openLink);
        if(change)await require('../manage/profile-alerts').sendNotice(ctx,chat,rid,change);
      }
      // Do not execute a priority game command twice after housekeeping.
      if(priorityGame)return;
      if(text==="#삭메기록켜기"||text==="#삭메기록끄기"){
        if(!flags.manage||flags.locked)return;
        if(!ctx.isManagerType(msg.sender?.type)){
          await ctx.send(chat,rid,"⛔ 방장·부방장만 사용할 수 있습니다.");
          return;
        }
        const on=text==="#삭메기록켜기";
        await ctx.pool.query('INSERT INTO gl_manage_rooms(room_id,enabled,deleted_enabled) VALUES($1,TRUE,$2) ON CONFLICT(room_id) DO UPDATE SET deleted_enabled=EXCLUDED.deleted_enabled',[rid,on]);
        await ctx.send(chat,rid,on?"🗑️ 삭제 감지가 켜졌습니다.":"⏹️ 삭제 감지가 꺼졌습니다.");
        return;
      }

      if(text==="#봇작동"){
        if(!isAdmin)return;
        const out=await ctx.withRoom(rid,rname,async d=>{d.locked=false;return "✅ 봇 잠금이 해제되었습니다.\n기존 게임·관리 작동 설정은 유지됩니다."});
        await ctx.send(chat,rid,out);return
      }

      if(flags.locked){
        if(isAdmin&&text==="#관리중지")return;
        return
      }

      if(!text.startsWith("#")){
        await ctx.autoSpamCheck(msg,chat,rid,uid,name,text,isSelf,flags);
        if(flags.game&&flags.quizEnabled&&require('../game/quiz').plainAnswer(flags.quiz,text)){
          const out=await ctx.withRoom(rid,rname,async(d,c)=>{
            if(!d.game||!d.quizEnabled||d.locked)return null;
            return ctx.handleGame(d,c,msg,isSelf);
          });
          if(out)await ctx.send(chat,rid,out);
        }
        return
      }

      // 홍보 명령어는 게임/관리 활성화 여부와 독립적으로 동작.
      if(false){
        if(!isAdmin){await ctx.send(chat,rid,"⛔ 최고 관리자만 홍보 설정을 변경할 수 있습니다.");return;}
        const cmd=text.split(/\s+/)[0], arg=text.slice(cmd.length).trim();
        const out=await ctx.withRoom(rid,rname,async d=>{
          const p=d.promo;
          if(cmd==="#홍보설정"){
            if(!arg)return "사용법: #홍보설정 (홍보할 문구)";
            if(arg.length>1000)return "홍보 문구는 1,000자 이하로 설정해 주세요.";
            p.message=arg;return "✅ 홍보 문구가 저장되었습니다.\n"+arg;
          }
          if(cmd==="#홍보시작"){
            if(!/^\d+$/.test(arg))return "사용법: #홍보시작 (분)\n예: #홍보시작 20";
            const m=Number(arg);
            if(!Number.isInteger(m)||m<5||m>120)return "홍보 간격은 5~120분으로 설정해 주세요.";
            if(!p.message)return "먼저 #홍보설정 (내용)으로 홍보 문구를 저장해 주세요.";
            p.minutes=m;p.enabled=true;p.stopReason="";
            p.sentTimes=[];
            // 이전 스케줄의 기록을 초기화하되 같은 슬롯 재전송은 방지.
            const now=Date.now(),slot=ctx.promoSlot(now,m);
            p.lastSlot=slot;
            const next=slot+m*60000;
            return `📢 자동 홍보 시작\n간격: ${m}분\n다음 홍보: ${new Date(next).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}\n도배 방지: ${p.antiSpam?"켜짐":"꺼짐"}`;
          }
          if(cmd==="#홍보중지"){p.enabled=false;p.stopReason="관리자가 중지";return "⏹️ 이 방의 자동 홍보가 중지되었습니다.";}
          if(cmd==="#도배방지"){p.antiSpam=true;return "🛡️ 홍보 도배 방지가 켜졌습니다. 10초 이내 3회 전송을 방지합니다.";}
          if(cmd==="#도배방지끄기"){p.antiSpam=false;return "⚠️ 홍보 도배 방지가 꺼졌습니다.";}
          if(cmd==="#도배방지확인")return `🛡️ 홍보 도배 방지: ${p.antiSpam?"켜짐":"꺼짐"}\n기준: 10초 이내 3회 전송`;
          return `📢 홍보 상태: ${p.enabled?"작동 중":"중지"}\n간격: ${p.minutes||"미설정"}분\n문구: ${p.message||"미설정"}\n도배 방지: ${p.antiSpam?"켜짐":"꺼짐"}${p.stopReason?"\n최근 중지 사유: "+p.stopReason:""}`;
        });
        await ctx.send(chat,rid,out);return;
      }

      if(text==="#초기화"||text==="#초기화확인"){
        if(!ctx.OWNER_IDS.has(uid)){await ctx.send(chat,rid,"⛔ 최고 관리자만 게임 초기화를 실행할 수 있습니다. HZ_OWNER_IDS 설정을 확인하세요.");return;}
        if(text==="#초기화"){
          await ctx.withRoom(rid,rname,async d=>{d.gameResetRequest={uid,expires:Date.now()+60000};});
          await ctx.send(chat,rid,"⚠️ 전체 방의 게임 데이터(코인, 레벨, 물고기, 펫, 강화, 보호권 등)를 초기화합니다.\n채팅순위(hz_chat_stats)와 출석 기록은 유지됩니다.\n60초 이내 !초기화확인 을 입력하세요.");return;
        }
        const valid=await ctx.withRoom(rid,rname,async d=>{const x=d.gameResetRequest;const ok=x&&x.uid===uid&&x.expires>Date.now();delete d.gameResetRequest;return !!ok;});
        if(!valid){await ctx.send(chat,rid,"⏰ 초기화 요청이 없거나 만료되었습니다. !초기화부터 입력하세요.");return;}
        await ctx.pool.query(`UPDATE hz_rooms SET data=jsonb_set(jsonb_set(jsonb_set(jsonb_set(data,'{players}','{}'::jsonb,true),'{quiz}','null'::jsonb,true),'{quizQueue}','[]'::jsonb,true),'{lastQuiz}','-1'::jsonb,true),updated_at=NOW()`);
        await ctx.send(chat,rid,"✅ 모든 방의 게임 데이터가 초기화되었습니다.\n📊 채팅순위·채팅 횟수·출석 기록은 그대로 유지됩니다.");return;
      }

      const control=["#퀴즈작동","#퀴즈중지","#낚시작동","#낚시중지","#게임작동","#게임중지","#관리작동","#관리중지"];
      if(control.includes(text)){
        if(!isAdmin)return;
        const out=await ctx.withRoom(rid,rname,async d=>{
          if(text==="#퀴즈작동"){d.quizEnabled=true;return "🧩 퀴즈 ON"}
          if(text==="#퀴즈중지"){d.quizEnabled=false;d.quiz=null;return "🧩 퀴즈 OFF"}
          if(text==="#낚시작동"){d.fishEnabled=true;return "🎣 낚시 ON"}
          if(text==="#낚시중지"){d.fishEnabled=false;return "🎣 낚시 OFF"}
          if(text==="#게임작동"){d.game=true;return "🎮 게임 기능이 작동되었습니다."}
          if(text==="#게임중지"){d.game=false;return "⏹️ 게임 기능이 중지되었습니다."}
          if(text==="#관리작동"){d.manage=true;return "🛡️ 관리 기능이 작동되었습니다."}
          if(text==="#관리중지"){d.manage=false;return "🛡️ 관리 기능이 중지되었습니다."}
        });
        await ctx.send(chat,rid,out);return
      }

      flags=await ctx.roomFlags(rid);
      const templateCommand=/^#(입장변경|퇴장변경)(?:\s|$)/.exec(text);
      if(templateCommand){
        if(!isAdmin&&!ctx.isOwnerType(msg.sender?.type)){
          await ctx.send(chat,rid,"⛔ 방장 또는 봇 계정만 변경할 수 있습니다.");return;
        }
        const field=templateCommand[1]==="입장변경"?"joinTemplate":"leaveTemplate";
        const content=text.slice(templateCommand[0].length).trim();
        if(!content){
          await ctx.send(chat,rid,`사용법: #${templateCommand[1]} (내용)\n사용 가능: (이름) (해시) (방이름) (날짜)\n기본 문구로 되돌리려면: #${templateCommand[1]} 기본`);return;
        }
        if(content.length>2000){await ctx.send(chat,rid,"문구는 2,000자 이하로 입력해 주세요.");return;}
        await ctx.withRoom(rid,rname,async d=>{d[field]=content==="기본"?null:content;});
        await ctx.send(chat,rid,content==="기본"?`✅ ${templateCommand[1]} 문구를 기본값으로 되돌렸습니다.`:`✅ ${templateCommand[1]} 문구가 저장되었습니다.\n\n미리보기:\n${ctx.formatMemberTemplate(content,{name:"홍길동",uid:"123456789",roomName:rname||"채팅방"})}`);
        return;
      }
      if(text==="#명령어"){await ctx.send(chat,rid,require('./help').formatCommandHelp(flags));return}

      if(text==="#송금"||text.startsWith("#송금 ")){
        if(!flags.game){await ctx.send(chat,rid,"🎮 이 방은 게임이 꺼져 있습니다.");return;}
        if(isSelf){return;}
        const match=/^#송금\s+(.+?)\s+([0-9]+)$/.exec(text);
        if(!match){await ctx.send(chat,rid,"사용법: #송금 @멘션 (포인트)\n예: #송금 @홍길동 10000");return;}
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

      if(/^#회수(?:\s|$)/.test(text)){
        if(!isAdmin||!flags.game)return;
        const mm=/^#회수\s+(all|[0-9]+)(?:\s|$)/i.exec(text);
        let t=ctx.targetFrom(msg,text);
        if(!mm||!t){await ctx.send(chat,rid,"사용법: !회수 (코인 또는 all) (@멘션)");return;}
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

      if(text.startsWith("#치트")){
        if(!isAdmin||!flags.game)return;
        const mm=/^#치트\s+([0-9]+)[\s\S]*$/.exec(text);
        let t=ctx.targetFrom(msg,text);
        if(!mm||!t){await ctx.send(chat,rid,"사용법: !치트 (코인) (@멘션)");return}
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
        if(flags.game)r=await ctx.handleGame(d,c,msg,isSelf);
        return r
      });
      if(out)await ctx.send(chat,rid,out)
    }catch(e){console.error("[GAME]",e)}
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

      const formatKST=value=>{
        if(!value)return '확인 불가';
        const date=new Date(value);
        if(!Number.isFinite(date.getTime()))return '확인 불가';
        return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
      };
      const stayTime=(start,end)=>{
        if(!start||!end)return '확인 불가';
        const sec=Math.floor((new Date(end)-new Date(start))/1000);
        if(!Number.isFinite(sec)||sec<0)return '확인 불가';
        const days=Math.floor(sec/86400),hours=Math.floor((sec%86400)/3600),mins=Math.floor((sec%3600)/60);
        return [days?`${days}일`:'',hours?`${hours}시간`:'',mins?`${mins}분`:''].filter(Boolean).join(' ')||'1분 미만';
      };

      for(let i=0;i<ids.length;i++){
        const uid=ctx.id(ids[i]),name=String(names[i]||uid);
        if(!uid)continue;
        await ctx.pool.query(`INSERT INTO hz_members(room_id,user_id,name,join_count,leave_count)
          VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(room_id,user_id) DO UPDATE SET
          name=EXCLUDED.name,
          join_count=hz_members.join_count+EXCLUDED.join_count,
          leave_count=hz_members.leave_count+EXCLUDED.leave_count,
          last_seen=NOW()`,
          [rid,uid,name,type==="join"?1:0,(type==="leave"||type==="kick")?1:0]);

        const eventMember=Array.isArray(ev.members)?ev.members[i]:
          (Array.isArray(ev.member?.members)?ev.member.members[i]:null);
        if(eventMember && ctx.id(eventMember.id??eventMember.userId)===uid)
          await ctx.saveOpenProfileLink(rid,uid,name,eventMember);

        const eventTime=new Date();
        await ctx.pool.query("INSERT INTO hz_events(room_id,user_id,name,event_type,meta) VALUES($1,$2,$3,$4,$5::jsonb)",
          [rid,uid,name,type,JSON.stringify({actorId:actorId||null,actorName:actorName||null,actorType:Number.isFinite(actorType)?actorType:null})]);

        if(type==="join"||type==="leave"){
          const roomName=String(ev.room?.name||f.name||'이 방');
          const q=await ctx.pool.query('SELECT join_count,leave_count,open_profile_link,last_profile_url FROM hz_members WHERE room_id=$1 AND user_id=$2',[rid,uid]);
          const data=q.rows[0]||{},joins=Number(data.join_count||0),leaves=Number(data.leave_count||0);
          const kickResult=await ctx.pool.query("SELECT COUNT(*)::integer AS count FROM hz_events WHERE room_id=$1 AND user_id=$2 AND event_type='kick'",[rid,uid]);
          const bans=Number(kickResult.rows[0]?.count||0);
          let profileLink=ctx.validOpenProfileLink(data.open_profile_link);
          if(typeof client.getUserOpenProfileLink==='function'){
            try{
              const live=await client.getUserOpenProfileLink(rid,uid);
              if(live){profileLink=ctx.validOpenProfileLink(live);await ctx.saveOpenProfileLink(rid,uid,name,{openProfileLink:live});}
            }catch(e){console.error('[MEMBER PROFILE]',e.message);}
          }
          let snapshot=null;
          if(typeof client.getUserProfileSnapshot==='function'){
            try{snapshot=client.getUserProfileSnapshot(rid,uid);}catch(e){console.error('[PROFILE SNAPSHOT]',e.message);}
          }
          let profileType=snapshot?.profileType;
          if(profileType==null&&typeof client.getUserOpenProfileType==='function'){
            try{profileType=client.getUserOpenProfileType(rid,uid);}catch(e){console.error('[PROFILE TYPE]',e.message);}
          }
          let profileName='확인 불가';
          if([1,2,4].includes(Number(profileType))){profileName='기본프로필';profileLink='';}
          else if(profileType!=null&&Number(profileType)!==0)profileName='오픈프로필';
          else if(profileLink)profileName='오픈프로필';
          const extracted=eventMember?ctx.extractProfile(eventMember):null;
          const imageUrl=snapshot?.imageUrl||extracted?.url||data.last_profile_url||'';
          const profileImage=typeof imageUrl==='string'&&/^https?:\/\//i.test(imageUrl)?imageUrl:'';
          const leaveReply=require('../manage/leave-reply');
          const template=type==='join'?f.joinTemplate:f.leaveTemplate;
          let customNotice=null;
          if(typeof template==='string'&&template.trim()){
            let warnings=0,warningReasons=[];
            if(template.includes('(경고횟수)')||template.includes('(경고사유)')){
              ({warnings,warningReasons}=await require('../manage/warning-summary').read(
                ctx.pool,rid,uid,{includeReasons:template.includes('(경고사유)')}));
            }
            const variables={name,userId:uid,joins,leaves,warnings,warningReasons,roomName,
              time:formatKST(eventTime),profileLink};
            if(type==='join'){
              customNotice=require('../manage/member-template').format(template,{
                name,uid,roomName,profileLink,client,roomId:rid,
                base:body=>leaveReply.renderMemberTemplate(body,variables)
              });
            }else{
              customNotice=leaveReply.renderMemberTemplate(template,variables);
            }
          }

          if(type==='join'){
            // joinNotice currently expects KakaoForge's numeric profile type.
            const output=customNotice??leaveReply.joinNotice({name,userId:uid,roomName,joins,leaves,time:formatKST(eventTime),profileLink,profileType,profileImage,bans});
            await ctx.send(ctx.globalChat,rid,output);
            // Rejoining also counts as returning for undelivered mentions.
            try{
              await require('../manage/mention-notify').deliver({
                db:ctx.pool,chat:ctx.globalChat,roomId:rid,userId:uid,userName:name,
                send:body=>ctx.send(ctx.globalChat,rid,body)
              });
            }catch(error){console.error('[MENTION JOIN DELIVERY]',error);}
          }
          if(type==='leave'){
            const lastJoin=await ctx.pool.query("SELECT created_at FROM hz_events WHERE room_id=$1 AND user_id=$2 AND event_type='join' ORDER BY id DESC LIMIT 1",[rid,uid]);
            const joinedAt=lastJoin.rows[0]?.created_at||null;
            const output=customNotice??leaveReply.leaveNotice({name,userId:uid,joins,leaves,time:formatKST(eventTime),joinedAt:joinedAt?formatKST(joinedAt):null,stay:stayTime(joinedAt,eventTime),profileLink,profileType:profileName,profileImage,bans});
            const result=await ctx.send(ctx.globalChat,rid,output);
            await leaveReply.record(ctx.pool,{roomId:rid,botId:ctx.globalBotId,userId:uid,name,result});
          }
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
            await ctx.send(ctx.globalChat,rid,`🚨 강퇴 감지\n대상: ${name}\n아이디: ${uid}\n실행자: ${actorName||"알 수 없음"}`);
          }

          if(actorId&&actorId!==ctx.globalBotId&&ctx.isSubManagerType(actorType)){
            const key=rid+":"+actorId,now=Date.now();
            const arr=(ctx.kickBurst.get(key)||[]).filter(t=>now-t<=60000);
            arr.push(now);ctx.kickBurst.set(key,arr);
            if(arr.length>=7){
              await ctx.withRoom(rid,ev.room?.name||"",async d=>{d.locked=true;d.game=false;d.manage=false});
              ctx.kickBurst.delete(key);
              await ctx.send(ctx.globalChat,rid,`🚨 테러 방어 작동\n\n${actorName}님이 60초 안에 7명을 강퇴했습니다.\n봇 기능을 잠갔습니다.\n\n🤖 봇 계정에서 #봇작동 입력 시 다시 작동합니다.`);
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
        const setting=await ctx.pool.query('SELECT deleted_enabled FROM gl_manage_rooms WHERE room_id=$1',[rid]);
        if(setting.rows[0]?.deleted_enabled!==true)return;
        const actor=ctx.pickDeleteActor(evt);
        await ctx.pool.query("INSERT INTO hz_deleted_messages(room_id,deleter_id,deleter_name,message_text,meta) VALUES($1,$2,$3,$4,$5::jsonb)",
          [rid,actor.id||null,actor.name||null,null,JSON.stringify({event:"delete"})]);
        await ctx.send(chat,rid,actor.name||actor.id
          ?`🗑️ ${actor.name||actor.id}님이 메시지를 삭제했습니다.`
          :'🗑️ 누군가 메시지를 삭제했습니다.');
      }catch(e){console.error("[HZ DELETE]",e)}
    });
  }
  return {botUserId:ctx.globalBotId}
}
return {attachHZBot};
};
