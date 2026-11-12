'use strict';
const $=s=>document.querySelector(s);let csrf='',rooms=[],selected=null;
function feedback(text,error=false,target='#feedback'){const el=$(target);el.textContent=text;el.classList.toggle('error',error);}
async function api(path,method='GET',data){const response=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},body:data===undefined?undefined:JSON.stringify(data)});const result=await response.json();if(!response.ok){if(response.status===401&&path!=='/api/login'){$('#login-view').hidden=false;$('#admin-view').hidden=true;}const error=Error(result.error||'요청 실패');error.status=response.status;throw error;}return result;}
const format=n=>Number(n||0).toLocaleString('ko-KR');
function cell(row,text){const td=document.createElement('td');td.textContent=text;row.append(td);return td;}
function button(text,fn){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=text;b.addEventListener('click',()=>task(fn));return b;}
async function task(run){try{await run();}catch(e){feedback(e.message,true);}}
async function start(session){csrf=session.csrf;$('#invite-token').value='';$('#admin-name').textContent=session.user;$('#login-view').hidden=true;$('#admin-view').hidden=false;await loadRooms();await show('overview');}
$('#login-form').addEventListener('submit',async e=>{
 e.preventDefault();
 const button=e.submitter;button.disabled=true;
 const credentials={username:$('#username').value,password:$('#password').value};
 try{
  let masterFailed=false;
  try{
   const session=await api('/api/login','POST',credentials);
   $('#password').value='';
   await start(session);
  }catch(err){
   // Only try room-admin login for an actual credential rejection;
   // never mask a master dashboard/network error.
   if(err.status!==401)throw err;
   masterFailed=true;
  }
  if(masterFailed){
   const room=await api('/api/room-portal/login-from-admin','POST',credentials);
   $('#password').value='';
   location.assign(room.redirect);
  }
 }catch(err){feedback(err.message,true,'#login-feedback');}
 finally{button.disabled=false;}
});
$('#logout').addEventListener('click',()=>task(async()=>{await api('/api/logout','POST',{});csrf='';selected=null;$('#invite-token').value='';$('#admin-view').hidden=true;$('#login-view').hidden=false;}));
async function refreshFishEventMaster(){
 const room=$('#fishEventRoom').value;
 if(!room){$('#fishEventState').textContent='채팅방을 선택해 주세요.';return;}
 const d=await api('/api/admin/fishing-coin-event?'+new URLSearchParams({roomId:room}));
 const e=d.event;
 if(!e){$('#fishEventState').textContent='아직 진행한 이벤트가 없습니다.';return;}
 if(e.status==='active'){
  const seconds=Math.max(0,Math.ceil((new Date(e.ends_at).getTime()-Date.now())/1000));
  const leader=e.leader;
  $('#fishEventState').textContent='진행 중 · '+seconds+'초 남음 · 참가자 '+e.participants+'명'+
    (leader?' · 1위 '+leader.userName+' ('+leader.fishName+' '+leader.sizeCm+'cm)':'');
 }else $('#fishEventState').textContent=e.winner_id
  ?'종료 · '+e.winner_name+' ('+e.winning_fish+' '+e.winning_size+'cm) · 상금 100만 코인 지급 완료'
  :'종료 · 참가 기록이 없습니다.';
}
$('#fishEventRoom').addEventListener('change',()=>task(refreshFishEventMaster));
$('#checkFishEvent').addEventListener('click',()=>task(refreshFishEventMaster));
$('#startFishEvent').addEventListener('click',()=>task(async()=>{
 const room=$('#fishEventRoom').value;
 if(!room)throw Error('채팅방을 선택해 주세요.');
 if(!confirm('선택한 방에서 2분간 가장 큰 물고기 낚시 이벤트를 시작하고 우승자에게 100만 코인을 지급하시겠습니까?'))return;
 const button=$('#startFishEvent');button.disabled=true;
 try{
  await api('/api/admin/fishing-coin-event','POST',{roomId:room,confirm:true});
  await refreshFishEventMaster();
  feedback('🎉 해당 방에 코인 낚시 이벤트를 시작했습니다.');
 }finally{button.disabled=false;}
}));
const titles={overview:'대시보드',rooms:'채팅방 관리',blocks:'명령어 차단',users:'사용자·코인',promotion:'홍보 관리',notices:'공지사항',audit:'감사 기록','promo-members':'홍보 회원·초대'};
async function show(panel){document.querySelectorAll('[data-section]').forEach(el=>el.hidden=el.dataset.section!==panel);document.querySelectorAll('[data-panel]').forEach(el=>el.classList.toggle('selected',el.dataset.panel===panel));$('#panel-title').textContent=titles[panel];feedback('');if(panel==='promo-members'){await loadRooms();await loadPromoMembers();}if(panel==='overview')await overview();if(panel==='rooms'||panel==='promotion'||panel==='blocks')await loadRooms();if(panel==='blocks')await loadCommandBlocks();if(panel==='promotion')await loadCommonPromo();if(panel==='notices')await loadNotices();if(panel==='audit'){const d=await api('/api/admin/audit');$('#audit-records').textContent=d.records.map(r=>`${new Date(r.created_at).toLocaleString('ko-KR')} · ${r.actor} · ${r.action}\n${r.room_id||''} ${r.target_id||''}\n${JSON.stringify(r.detail)}`).join('\n\n')||'작업 기록 없음';}}
document.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>task(()=>show(b.dataset.panel))));
async function overview(){const d=await api('/api/admin/overview');$('#metrics').replaceChildren();for(const [label,value]of [['게임 사용자',d.users],['활성 게임방',d.active_rooms],['지갑 코인 합계',d.coins],['자동 홍보방',d.promotion_rooms]]){const box=document.createElement('div');box.className='metric';const p=document.createElement('p');p.textContent=label;const strong=document.createElement('strong');strong.textContent=format(value);box.append(p,strong);$('#metrics').append(box);}$('#daily-events').textContent=d.events.map(e=>`${e.kind}: ${e.n}회`).join(' · ')||'오늘 기록된 게임 활동 없음';$('#bot-info').textContent=`카카오톡 연결: ${d.bot.connected?'연결됨':'연결 끊김'}\n게임·DB 준비: ${d.bot.ready?'완료':'준비 중'}\n서버 가동: ${format(d.uptimeSeconds)}초\n${d.railwayStatus}\n최근 오류: ${d.errors.length?d.errors.join('\n'):'수집된 오류 없음'}`;}
let bulkKickPollToken=0;
function bulkKickDescription(job){
 if(!job||job.status==='unknown')return '이 서버에 기록된 일괄강퇴 작업이 없습니다.';
 const phase={running:'진행 중',completed:'작업 종료',failed:'실행 실패'}[job.status]||job.status;
 const skipped=job.skipped||{};
 const parts=[
  '상태: '+phase,
  '강퇴 대상: '+Number(job.attempted||0)+'명',
  '서버 성공 응답: '+Number(job.success||0)+'명',
  '결과 미확인: '+Number(job.unverified||0)+'명',
  '실패: '+Number(job.failed||0)+'명',
  '보호된 인원(관리자·봇 등): '+Number(skipped.protected||0)+'명',
  '역할 확인 불가 등으로 제외: '+(Number(skipped.unknownRole||0)+Number(skipped.invalid||0))+'명'
 ];
 if(job.error)parts.push('오류: '+job.error);
 if(job.errors?.length)parts.push('실패 사유: '+job.errors.join(', '));
 if(job.status==='completed'&&Number(job.attempted||0)===0)
  parts.push('강퇴할 일반 참여자가 확인되지 않았습니다. 강퇴 권한과 참가자 역할 정보를 확인해 주세요.');
 return parts.join('\n');
}
async function loadBulkKickStatus(roomId){
 const job=await api('/api/admin/bulk-kick/status?'+new URLSearchParams({roomId}));
 if($('#room-select').value===roomId)$('#bulk-kick-output').textContent=bulkKickDescription(job);
 return job;
}
async function pollBulkKick(roomId){
 const token=++bulkKickPollToken;
 for(let attempt=0;attempt<90;attempt++){
  if(token!==bulkKickPollToken)return;
  const job=await loadBulkKickStatus(roomId);
  if(job.status!=='running'){
   if($('#room-select').value===roomId){
    const ok=job.status==='completed'&&Number(job.success||0)>0;
    feedback(job.status==='failed'?'일괄강퇴 실패: '+job.error:
     ok?'일괄강퇴 실행 결과를 확인했습니다. 세부 결과를 아래에서 확인해 주세요.':
     '일괄강퇴가 종료됐으나 성공으로 확인된 강퇴가 없습니다. 아래 결과를 확인해 주세요.',!ok);
   }
   return;
  }
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
}
$('#bulk-kick-check').addEventListener('click',()=>task(async()=>{
 const roomId=$('#room-select').value;
 if(!roomId)throw Error('채팅방을 선택해 주세요.');
 await loadBulkKickStatus(roomId);
}));
$('#bulk-kick-run').addEventListener('click',async()=>{
 const roomId=$('#room-select').value;
 const room=rooms.find(r=>r.room_id===roomId);
 if(!roomId){feedback('채팅방을 선택해 주세요.',true);return;}
 if(!confirm('['+(room?.name||roomId)+'] 일반 참여자를 일괄강퇴합니다. 취소할 수 없습니다. 계속하시겠습니까?'))return;
 const button=$('#bulk-kick-run');button.disabled=true;
 try{
  const res=await api('/api/admin/bulk-kick','POST',{roomId,confirm:true});
  $('#bulk-kick-output').textContent=bulkKickDescription(res.job);
  feedback('일괄강퇴가 시작됐습니다. 실제 성공·실패 수는 아래에서 조회합니다.');
  void pollBulkKick(roomId).catch(error=>{
   if($('#room-select').value===roomId)feedback('진행 상태 조회 실패: '+error.message,true);
  });
 }catch(error){feedback(error.message,true);$('#bulk-kick-output').textContent='실행 요청 실패: '+error.message;}
 finally{button.disabled=false;}
});
async function loadRooms(){const d=await api('/api/admin/rooms');rooms=d.rooms;for(const selector of ['#room-select','#user-room','#promo-room','#room-admin-room','#fishEventRoom','#block-room']){const select=$(selector),before=select.value;select.replaceChildren();for(const room of rooms){const option=document.createElement('option');option.value=room.room_id;option.textContent=(room.name||'채팅방')+' · '+room.room_id;select.append(option);}if(rooms.some(r=>r.room_id===before))select.value=before;}$('#room-rows').replaceChildren();for(const room of rooms){const row=document.createElement('tr');cell(row,(room.name||'채팅방')+' · '+room.room_id);cell(row,room.game?'작동':'중지');cell(row,room.manage?'작동':'중지');cell(row,room.voice_enabled?'ON':'OFF');cell(row,'').append(button('선택',()=>{ $('#room-select').value=room.room_id;selectRoom();}));$('#room-rows').append(row);}selectRoom();selectPromo();renderPromoRooms();await loadRoomAdmins();await loadSuperAdmins();await refreshFishEventMaster();}
function selectRoom(){const room=rooms.find(r=>r.room_id===$('#room-select').value);if(!room)return;$('#flag-game').checked=room.game;$('#flag-manage').checked=room.manage;$('#flag-quiz').checked=room.quiz_enabled;$('#flag-fish').checked=room.fish_enabled;$('#flag-voice').checked=room.voice_enabled;}
function selectPromo(){$('#promo-logs').textContent='채팅방을 선택하고 전송 기록을 조회해 주세요.';}
async function loadRoomAdmins(){
 const room=$('#room-admin-room').value,list=$('#room-admin-list');list.replaceChildren();
 if(!room){list.textContent='선택할 채팅방이 없습니다.';return;}
 const data=await api('/api/admin/room-admins?'+new URLSearchParams({roomId:room}));
 if(!data.admins.length){list.textContent='지정된 관리자가 없습니다.';return;}
 for(const admin of data.admins){
  const row=document.createElement('div');row.className='notice-actions';
  const name=document.createElement('span');name.textContent='ID: '+admin.user_id;
  const remove=button('삭제',async()=>{
   if(!confirm('관리자 '+admin.user_id+'의 권한을 삭제할까요?'))return;
   await api('/api/admin/room-admins','POST',{roomId:room,userId:admin.user_id,action:'remove'});
   await loadRoomAdmins();feedback('방 관리자 권한을 삭제했습니다.');
  });row.append(name,remove);list.append(row);
 }
}
$('#room-admin-room').addEventListener('change',()=>task(loadRoomAdmins));
$('#room-admin-form').addEventListener('submit',e=>{e.preventDefault();task(async()=>{
 const room=$('#room-admin-room').value,userId=$('#room-admin-id').value.trim();
 if(!room||! /^[1-9][0-9]*$/.test(userId))throw Error('채팅방과 숫자 사용자 ID를 확인해 주세요.');
 await api('/api/admin/room-admins','POST',{roomId:room,userId,action:'add'});
 $('#room-admin-id').value='';await loadRoomAdmins();feedback('방 관리자를 추가했습니다.');
});});
async function loadSuperAdmins(){
 const room=$('#room-admin-room').value,list=$('#super-admin-list');list.replaceChildren();
 if(!room){list.textContent='선택할 채팅방이 없습니다.';return;}
 const result=await api('/api/admin/super-admins?'+new URLSearchParams({roomId:room}));
 if(!result.admins.length){list.textContent='최고관리자가 없습니다.';return;}
 for(const member of result.admins){
  const row=document.createElement('div');row.className='notice-actions';
  const name=document.createElement('span');name.textContent='👑 ID: '+member.user_id;
  const remove=button('삭제',async()=>{
   if(!confirm('최고관리자 '+member.user_id+'의 권한을 삭제할까요?'))return;
   await api('/api/admin/super-admins','POST',{roomId:room,userId:member.user_id,action:'remove'});
   await loadSuperAdmins();feedback('최고관리자 권한을 삭제했습니다.');
  });
  row.append(name,remove);list.append(row);
 }
}
$('#room-admin-room').addEventListener('change',()=>task(loadSuperAdmins));
$('#super-admin-form').addEventListener('submit',e=>{e.preventDefault();task(async()=>{
 const room=$('#room-admin-room').value,userId=$('#super-admin-id').value.trim();
 if(!room||!/^[1-9][0-9]*$/.test(userId))throw Error('채팅방과 숫자 사용자 ID를 확인해 주세요.');
 if(!confirm('사용자 '+userId+'에게 해당 방의 최고관리자 권한을 부여할까요?\n코인 지급과 관리 명령을 사용할 수 있습니다.'))return;
 await api('/api/admin/super-admins','POST',{roomId:room,userId,action:'add'});
 $('#super-admin-id').value='';await loadSuperAdmins();feedback('최고관리자를 추가했습니다.');
});});
$('#room-select').addEventListener('change',()=>{bulkKickPollToken++;selectRoom();$('#bulk-kick-output').textContent='선택한 방의 이전 실행 결과는 조회 버튼을 눌러 확인할 수 있습니다.';$('#voice-status-output').textContent='조회 버튼을 누르면 상태가 표시됩니다.';});$('#promo-room').addEventListener('change',selectPromo);
async function loadCommandBlocks(){
 const room=$('#block-room').value,list=$('#command-block-list');list.replaceChildren();
 if(!room){list.textContent='채팅방을 먼저 선택해 주세요.';return;}
 const data=await api('/api/admin/command-blocks?'+new URLSearchParams({roomId:room}));
 if(!data.blocks.length){list.textContent='차단된 사용자가 없습니다.';return;}
 for(const entry of data.blocks){
  const row=document.createElement('div');row.className='notice';
  const label=document.createElement('span');label.textContent=(entry.user_name||entry.user_id)+' · '+entry.user_id+(entry.reason?' · 사유: '+entry.reason:'');
  const undo=button('차단 해제',()=>task(async()=>{
   if(!confirm(entry.user_id+'님의 봇 명령어 차단을 해제하시겠습니까?'))return;
   await api('/api/admin/command-blocks','POST',{roomId:room,userId:entry.user_id,action:'unblock'});
   await loadCommandBlocks();feedback('차단이 해제되었습니다.');
  }));
  row.append(label,undo);list.append(row);
 }
}
$('#block-room').addEventListener('change',()=>task(loadCommandBlocks));
$('#command-block-form').addEventListener('submit',e=>{e.preventDefault();task(async()=>{
 const room=$('#block-room').value,user=$('#block-user').value.trim();
 if(!room||!/^[1-9]\\d{3,24}$/.test(user))throw Error('채팅방과 사용자 ID를 확인해 주세요.');
 await api('/api/admin/command-blocks','POST',{roomId:room,userId:user,
  userName:$('#block-name').value,reason:$('#block-reason').value,action:'block'});
 $('#block-user').value='';$('#block-name').value='';$('#block-reason').value='';
 await loadCommandBlocks();feedback('봇 명령어 차단을 저장했습니다.');
});});
$('#user-room').addEventListener('change',()=>{selected=null;$('#selected-user').textContent='사용자를 다시 검색해 주세요.';$('#user-detail').textContent='';$('#user-rows').replaceChildren();});
$('#room-form').addEventListener('submit',e=>{e.preventDefault();task(async()=>{await api('/api/admin/rooms','POST',{roomId:$('#room-select').value,flags:{game:$('#flag-game').checked,manage:$('#flag-manage').checked,quizEnabled:$('#flag-quiz').checked,fishEnabled:$('#flag-fish').checked,voiceRoomEnabled:$('#flag-voice').checked}});await loadRooms();feedback('방별 기능 설정을 저장했습니다.');});});
$('#voice-status-check').addEventListener('click',()=>task(async()=>{
 const roomId=$('#room-select').value;
 if(!roomId)throw Error('채팅방을 선택해 주세요.');
 const state=await api('/api/admin/voice-status?'+new URLSearchParams({roomId}));
 const lines=[
  '방별 보이스룸 기능: '+(state.enabled?'ON':'OFF'),
  '직접 VOX 인증 연동: '+(state.configured?'설정됨':'미구현 / 미연결'),
  'Railway 직접 VOX 상태 확인: '+(state.reachable?'응답 확인':'실서버 응답 미확인'),
  '기존 카카오톡 OAuth 정보: '+(state.kakaoCredentialsAvailable?'메모리 확인':'확인 불가'),
  '대상 방 오픈채팅 캐시: '+(state.kakaoOpenChatCached?'확인':'확인 불가'),
  '실행 계정 멤버 캐시: '+(state.kakaoMembershipCached?'확인':'확인 불가'),
  'VOX 서버 인증: '+(state.voxServerAuthenticated?'확인됨':'미검증'),
 ];
 if(state.reachable){
  lines.push('선택한 방의 로컬 VOX 세션: '+(state.localActive?'감지됨':'감지되지 않음'));
  if(state.localBusyOtherRoom)lines.push('다른 방에서 직접 VOX 음성 세션 사용 중');
 }
 lines.push('※ VOX 실서버 인증 및 생성은 아직 검증되지 않았습니다.');
 $('#voice-status-output').textContent=lines.join('\n');
}));
async function selectUser(user){const room=$('#user-room').value;const d=await api('/api/admin/user?'+new URLSearchParams({roomId:room,userId:user.user_id}));selected={room,id:user.user_id,name:user.user_name};$('#selected-user').textContent=`${user.user_name} · ${user.user_id}`;const p=d.player||{};$('#user-detail').textContent=`지갑: ${format(d.wallet.balance)}코인\n레벨: ${p.level||1} · XP ${p.xp||0}\n퀴즈 정답: ${p.wins||0}회\n\n보유 주식\n${d.stocks.map(h=>`${h.stock_name} ${h.quantity}주 · 원금 ${format(h.total_cost)}`).join('\n')||'없음'}\n\n물고기 인벤토리\n${(p.inventory||[]).map(f=>`${f.name} [${f.tier}] ${f.size}cm · ${format(f.value)}코인`).join('\n')||'없음'}\n\n펫\n${Object.entries(p.pets||{}).map(([n,l])=>`${n} +${l}`).join('\n')||'없음'}`;}
$('#user-search').addEventListener('submit',e=>{e.preventDefault();task(async()=>{selected=null;$('#selected-user').textContent='사용자를 선택해 주세요.';const d=await api('/api/admin/users?'+new URLSearchParams({roomId:$('#user-room').value,search:$('#user-keyword').value}));$('#user-rows').replaceChildren();for(const user of d.users){const row=document.createElement('tr');cell(row,user.user_name+' · '+user.user_id);cell(row,format(user.balance));cell(row,'').append(button('상세',()=>selectUser(user)));$('#user-rows').append(row);}feedback(`${d.users.length}명을 찾았습니다.`);});});
$('#coin-form').addEventListener('submit',e=>{e.preventDefault();task(async()=>{if(!selected)throw Error('사용자를 먼저 선택해 주세요.');const amount=Number($('#coin-amount').value)*Number($('#coin-kind').value);if(!Number.isSafeInteger(amount)||!amount||Math.abs(amount)>1e9)throw Error('수량을 확인해 주세요.');if(!confirm(`${selected.name} (${selected.id})\n${Math.abs(amount).toLocaleString()}코인을 ${amount>0?'지급':'회수'}합니다. 계속할까요?`))return;await api('/api/admin/coins','POST',{roomId:selected.room,userId:selected.id,amount,reason:$('#coin-reason').value,operationId:crypto.randomUUID(),confirm:true});await selectUser({user_id:selected.id,user_name:selected.name});feedback('코인 조정과 감사 기록 저장을 완료했습니다.');});});
async function promo(action,extra={}){await api('/api/admin/promotion','POST',{roomId:$('#promo-room').value,action,...extra});feedback('홍보 설정을 저장했습니다.');await loadRooms();}
async function loadCommonPromo(){const d=await api('/api/admin/promotion-message');$('#promo-message').value=d.message||'';}
function renderPromoRooms(){const list=$('#promo-room-list');list.replaceChildren();for(const room of rooms){const p=room.promotion||{},row=document.createElement('article');row.className='notice';const title=document.createElement('h3');title.textContent=room.name||'이름 확인 중';const toggle=button(p.enabled?'ON':'OFF',async()=>{toggle.disabled=true;try{await api('/api/admin/promotion','POST',{roomId:room.room_id,action:p.enabled?'stop':'start',minutes:Number(interval.value)});await loadRooms();feedback((room.name||'채팅방')+' 홍보를 '+(p.enabled?'껐습니다.':'켰습니다.'));}finally{toggle.disabled=false;}});toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(!!p.enabled));toggle.setAttribute('aria-label',(room.name||'채팅방')+' 홍보');toggle.className=p.enabled?'button lime':'secondary';title.append(' ',toggle);const interval=document.createElement('select');interval.setAttribute('aria-label',(room.name||'채팅방')+' 전송 간격');for(const [value,label]of [[20,'20분 · 매시 00·20·40분'],[30,'30분 · 매시 00·30분'],[60,'1시간 · 매시 00분']]){const option=document.createElement('option');option.value=value;option.textContent=label;interval.append(option);}interval.value=[20,30,60].includes(Number(p.minutes))?p.minutes:20;interval.addEventListener('change',()=>task(async()=>{interval.disabled=true;try{await api('/api/admin/promotion','POST',{roomId:room.room_id,action:'interval',minutes:Number(interval.value)});await loadRooms();feedback('전송 간격을 저장했습니다.');}catch(e){interval.value=[20,30,60].includes(Number(p.minutes))?p.minutes:20;throw e;}finally{interval.disabled=false;}}));row.append(title,interval,button('전송 기록',async()=>{$('#promo-room').value=room.room_id;await loadPromoLogs();}));list.append(row);}if(!rooms.length)list.textContent='봇에 연결된 채팅방이 없습니다.';}
$('#promo-auto-default').addEventListener('click',()=>task(async()=>{
 if(!confirm('현재 공통 홍보 문구를 카카오톡 매니저 기본 홍보문으로 교체하고 저장하시겠습니까?\n기존 저장 문구는 덮어씌워집니다.'))return;
 const button=$('#promo-auto-default');button.disabled=true;
 try{
  const d=await api('/api/admin/promotion-default');
  if(!d.message)throw Error('기본 홍보문을 불러올 수 없습니다.');
  await api('/api/admin/promotion-message','POST',{message:d.message});
  $('#promo-message').value=d.message;
  feedback('✅ 카카오톡 매니저 기본 홍보문을 저장했습니다. 이제 원하는 방의 홍보를 ON으로 켜시면 됩니다.');
 }finally{button.disabled=false;}
}));
$('#promo-form').addEventListener('submit',e=>{e.preventDefault();task(async()=>{await api('/api/admin/promotion-message','POST',{message:$('#promo-message').value});feedback('모든 방의 공통 홍보 문구를 저장했습니다. 다음 전송부터 적용됩니다.');});});
$('#promo-delete').addEventListener('click',()=>task(async()=>{if(!confirm('공통 문구를 삭제하고 운영자 봇의 모든 방 홍보를 OFF로 바꿀까요?'))return;await api('/api/admin/promotion-message','POST',{action:'delete',confirm:true});await loadCommonPromo();await loadRooms();feedback('공통 문구를 삭제하고 전체 방 홍보를 껐습니다.');}));
$('#promo-immediate').addEventListener('click',()=>task(async()=>{
 const roomId=$('#promo-room').value,room=rooms.find(r=>r.room_id===roomId);
 if(!roomId)throw Error('전송할 채팅방을 선택해 주세요.');
 if(!confirm((room?.name||'선택한 채팅방')+' ('+roomId+')에 홍보 문구를 지금 전송할까요?'))return;
 const button=$('#promo-immediate');button.disabled=true;
 try{
  const result=await api('/api/admin/promotion','POST',{roomId,action:'immediate',confirm:true});
  feedback(result.reason||(result.sent?'홍보 문구 전송 요청을 완료했습니다.':'홍보문을 전송하지 못했습니다.'),!result.sent);
  if(result.sent)await loadPromoLogs();
 }finally{button.disabled=false;}
}));
async function loadPromoLogs(){const d=await api('/api/admin/promotion/logs?roomId='+encodeURIComponent($('#promo-room').value));$('#promo-logs').textContent=(d.stats||[]).map(r=>r.status+': '+r.count+'회').join(' · ')+'\n\n'+(d.logs.map(r=>`${new Date(r.created_at).toLocaleString('ko-KR')} · ${r.status} ${r.detail}`).join('\n')||'전송 기록 없음');}
$('#promo-log-button').addEventListener('click',()=>task(loadPromoLogs));
function resetNotice(){$('#notice-form').reset();$('#notice-id').value='';}$('#notice-new').addEventListener('click',resetNotice);
async function loadNotices(){const d=await api('/api/admin/notices');$('#admin-notices').replaceChildren();for(const n of d.notices){const article=document.createElement('article');article.className='notice';const h=document.createElement('h3');h.textContent=(n.pinned?'📌 ':'')+n.title+(n.published?'':' (비공개)');const p=document.createElement('p');p.textContent=n.body;const actions=document.createElement('div');actions.className='notice-actions';actions.append(button('수정',()=>{$('#notice-id').value=n.id;$('#notice-title').value=n.title;$('#notice-body').value=n.body;$('#notice-pinned').checked=n.pinned;}),button('공개 중단',async()=>{if(confirm('이 공지를 공개 목록에서 숨길까요?')){await api('/api/admin/notices','DELETE',{id:n.id});await loadNotices();}}));article.append(h,p,actions);$('#admin-notices').append(article);}}
$('#notice-form').addEventListener('submit',e=>{e.preventDefault();task(async()=>{await api('/api/admin/notices','POST',{id:$('#notice-id').value||undefined,title:$('#notice-title').value,body:$('#notice-body').value,pinned:$('#notice-pinned').checked});resetNotice();await loadNotices();feedback('공개 사이트에 공지를 반영했습니다.');});});
async function loadPromoMembers(){const [invites,members]=await Promise.all([api('/api/admin/promo-invites'),api('/api/admin/promo-members')]);$('#invite-list').replaceChildren();for(const invite of invites.invites){const line=document.createElement('p');const expired=new Date(invite.expires_at)<=new Date();line.textContent=invite.label+' · '+(invite.used_at?'가입 완료':invite.revoked_at?'취소됨':expired?'만료됨' :'토큰 미사용')+' · '+new Date(invite.expires_at).toLocaleString('ko-KR');if(!invite.used_at&&!invite.revoked_at&&!expired)line.append(button('토큰 취소',async()=>{if(confirm(invite.label+' 님의 초대를 취소할까요?')){await api('/api/admin/promo-invites','DELETE',{id:invite.id});await loadPromoMembers();}}));$('#invite-list').append(line);}if(!invites.invites.length)$('#invite-list').textContent='발급된 초대가 없습니다.';
 $('#promo-member-list').replaceChildren();for(const member of members.members){const box=document.createElement('article');box.className='notice';const title=document.createElement('h3');title.textContent=member.display_name+' · '+member.username;const state=document.createElement('label');state.className='check-label';const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=member.enabled;state.append(enabled,document.createTextNode('계정 사용 허용'));const checks=document.createElement('p');checks.textContent='본인 카카오 계정의 전체 방을 사용합니다.';box.append(title,state,checks,button('회원 권한 저장',async()=>{if(!enabled.checked&&!confirm(member.display_name+' 님의 로그인을 중지하고 자동 홍보를 끌까요?'))return;await api('/api/admin/promo-members','POST',{id:member.id,enabled:enabled.checked,roomIds:[]});await loadPromoMembers();feedback('홍보 회원 권한을 저장했습니다.');}));$('#promo-member-list').append(box);}if(!members.members.length)$('#promo-member-list').textContent='가입한 홍보 회원이 없습니다.';}
$('#invite-copy').addEventListener('click',async()=>{const input=$('#invite-token');if(!input.value){feedback('먼저 회원 이름을 입력해 토큰을 발급해 주세요.',true);return;}try{await navigator.clipboard.writeText(input.value);feedback('회원가입 전용 토큰을 복사했습니다. 해당 회원에게만 전달해 주세요.');}catch{input.focus();input.select();feedback('토큰을 선택했습니다. Ctrl+C로 복사해 주세요.');}});
$('#invite-form').addEventListener('submit',e=>{e.preventDefault();task(async()=>{const roomIds=[];if(!confirm($('#invite-label').value+' 님의 1회용 홍보 회원가입 토큰을 발급하시겠습니까?'))return;const d=await api('/api/admin/promo-invites','POST',{label:$('#invite-label').value,hours:Number($('#invite-hours').value),roomIds});$('#invite-token').value=d.invite.token;await loadPromoMembers();feedback('회원가입 토큰을 발급했습니다. 토큰은 한 번만 표시되므로 지금 복사해 회원에게 전달하세요.');});});
api('/api/session').then(s=>{if(s.authenticated)return start(s);if(!s.configured)feedback('운영자 계정 설정이 아직 완료되지 않았습니다. 서비스 운영자에게 문의해 주세요.',true,'#login-feedback');}).catch(e=>feedback(e.message,true,'#login-feedback'));
