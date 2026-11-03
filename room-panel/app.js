'use strict';
const $=s=>document.querySelector(s);const slug=new URLSearchParams(location.search).get('site')||'';let csrf='';
const names={manage:'관리 기능',mention:'멘션 감지',profile:'프로필 변경 감지',deleted:'메시지 삭제 감지',spam:'도배 감지'};
function note(s,error=false){$('#notice').textContent=s;$('#notice').className=error?'error':'';}
async function api(path,method='GET',body){
 const scopedPath=path.startsWith('/api/room-portal/')?path+(path.includes('?')?'&':'?')+'site='+encodeURIComponent(slug):path;
 const r=await fetch(scopedPath,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method!=='GET'?{'x-csrf-token':csrf}:{})},...(method==='GET'?{}:{body:JSON.stringify(body||{})})});
 const data=await r.json();if(!r.ok)throw Error(data.error||'요청 실패');return data;
}
async function task(fn){try{note('');await fn();}catch(e){note(e.message,true);}}
async function render(){
 const d=await api('/api/room-portal/settings');$('#subtitle').textContent=d.label+' · '+d.roomName;
 const list=$('#features');list.replaceChildren();
 for(const [key,label] of Object.entries(names)){
  if(!d.permissions[key])continue;
  const row=document.createElement('label');row.className='feature';const span=document.createElement('span');span.textContent=label;
  const input=document.createElement('input');input.type='checkbox';input.checked=d.flags[key];
  input.addEventListener('change',()=>task(async()=>{input.disabled=true;try{await api('/api/room-portal/feature','POST',{feature:key,enabled:input.checked});note(label+' 설정이 저장되었습니다.');}catch(e){input.checked=!input.checked;throw e;}finally{input.disabled=false;}}));
  row.append(span,input);list.append(row);
 }
 if(!list.children.length)list.textContent='현재 사용할 수 있는 기능이 없습니다.';
 $('#templates').hidden=!d.permissions.templates;$('#warningPanel').hidden=!d.permissions.warnings;
 $('#prefixPanel').hidden=!d.permissions.prefixes;$('#tabRanks').hidden=!d.permissions.chatStats;
 canWarnMembers=!!d.permissions.warnings;$('#prefixInput').value=(d.prefixes||['!']).join(', ');
 $('#newUsername').value=d.username||'';$('#joinTemplate').value=d.joinTemplate;$('#leaveTemplate').value=d.leaveTemplate;
 if(d.permissions.warnings)await renderWarnings();
}
async function renderWarnings(){
 const d=await api('/api/room-portal/warnings');const list=$('#warnings');list.replaceChildren();
 for(const u of d.warnings){
  const wrap=document.createElement('div');wrap.className='warn';
  const head=document.createElement('strong');head.textContent=u.user_name+' · '+u.user_id+' · 경고 '+u.count+'회';wrap.append(head);
  for(const w of u.details){
   const row=document.createElement('div');row.className='feature';const title=document.createElement('span');title.textContent='#'+w.id+' '+w.reason+' · '+new Date(w.created_at).toLocaleString('ko-KR');
   const btn=document.createElement('button');btn.textContent='삭제';btn.className='secondary';btn.addEventListener('click',()=>task(async()=>{
    if(!confirm('이 경고를 삭제하시겠습니까?'))return;
    await api('/api/room-portal/warnings','DELETE',{warningId:w.id});await renderWarnings();note('경고가 삭제되었습니다.');
   }));row.append(title,btn);wrap.append(row);
  }list.append(wrap);
 }
 if(!d.warnings.length)list.textContent='현재 경고가 없습니다.';
}
async function init(){
 if(!slug){note('발급받은 웹사이트 주소로 접속해 주세요.',true);return;}
 const s=await api('/api/room-portal/session');if(!s.authenticated)return;
 csrf=s.csrf;$('#login').hidden=true;$('#app').hidden=false;await render();await openInitialTab();
}
$('#loginForm').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;task(async()=>{
 const f=new FormData(form);const s=await api('/api/room-portal/login','POST',{site:slug,username:f.get('username'),password:f.get('password')});
 csrf=s.csrf;$('#login').hidden=true;$('#app').hidden=false;form.reset();await render();await openInitialTab();note('로그인되었습니다.');
});});
$('#logout').addEventListener('click',()=>task(async()=>{await api('/api/room-portal/logout','POST');csrf='';$('#app').hidden=true;$('#login').hidden=false;note('로그아웃되었습니다.');}));
$('#templateForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{await api('/api/room-portal/template','POST',{kind:'join',value:$('#joinTemplate').value});await api('/api/room-portal/template','POST',{kind:'leave',value:$('#leaveTemplate').value});note('입장·퇴장 문구를 저장했습니다.');});});
$('#warnForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{await api('/api/room-portal/warnings','POST',{userId:$('#userId').value,userName:$('#userName').value,reason:$('#reason').value,count:Number($('#warnCount').value)});$('#reason').value='';await renderWarnings();note('경고를 지급했습니다.');});});
$('#accountForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{
 await api('/api/room-portal/account','POST',{username:$('#newUsername').value,currentPassword:$('#currentPassword').value,newPassword:$('#newPassword').value});
 csrf='';$('#app').hidden=true;$('#login').hidden=false;$('#accountForm').reset();note('계정 정보가 변경되었습니다. 새 아이디와 비밀번호로 다시 로그인해 주세요.');
});});
let currentMembers=[],canEditMemberRoles=false,canWarnMembers=false,rankings=[];
function switchTab(tab){
 $('#settingsView').hidden=tab!=='settings';
 $('#membersView').hidden=tab!=='members';
 $('#ranksView').hidden=tab!=='ranks';
 $('#tabSettings').className=tab==='settings'?'':'secondary';
 $('#tabMembers').className=tab==='members'?'':'secondary';
 $('#tabRanks').className=tab==='ranks'?'':'secondary';
 history.replaceState(null,'',location.pathname+location.search+(tab==='ranks'?'#ranks':tab==='members'?'#members':''));
}
function drawMembers(){
 const list=$('#memberList');list.replaceChildren();
 const term=$('#memberSearch').value.trim().toLowerCase();
 const visible=currentMembers.filter(m=>(m.name+' '+m.id).toLowerCase().includes(term));
 const staffHeading=document.createElement('h3');staffHeading.className='memberGroupTitle';
 const staffList=document.createElement('div');
 const regularHeading=document.createElement('h3');regularHeading.className='memberGroupTitle';
 const regularList=document.createElement('div');
 list.append(staffHeading,staffList,regularHeading,regularList);
 for(const m of visible){
  const wrap=document.createElement('div');wrap.className='memberCard';
  if(m.imageUrl&&/^https:\/\//.test(m.imageUrl)){
   const pic=document.createElement('img');pic.className='memberAvatar';pic.alt=m.name+' 프로필 사진';pic.src=m.imageUrl;pic.loading='lazy';pic.referrerPolicy='no-referrer';wrap.append(pic);
  }
  const info=document.createElement('div');info.className='memberInfo';
  const name=document.createElement('strong');name.textContent=m.name;info.append(name);
  const id=document.createElement('div');id.className='muted';id.textContent='ID: '+m.id;info.append(id);
  const roles=document.createElement('div');roles.className='memberRoles';
  for(const label of [m.roomRole,m.superAdmin?'👑 최고관리자':'',m.admin?'🛡️ 관리자':''].filter(Boolean)){
   const badge=document.createElement('span');badge.className='roleTag';badge.textContent=label;roles.append(badge);
  }
  if(roles.children.length)info.append(roles);
  if(canEditMemberRoles){
   const row=document.createElement('div');row.className='memberActions';
   for(const [role,label,enabled] of [['admin','관리자',m.admin],['superAdmin','최고관리자',m.superAdmin]]){
    const btn=document.createElement('button');btn.type='button';btn.className=enabled?'secondary':'';
    btn.textContent=label+' '+(enabled?'삭제':'추가');
    btn.addEventListener('click',()=>task(async()=>{
     if(!confirm(m.name+'님의 '+label+' 권한을 '+(enabled?'삭제':'추가')+'하시겠습니까?'))return;
     btn.disabled=true;
     try{await api('/api/room-portal/member-role','POST',{userId:m.id,role,enabled:!enabled});await loadMembers();note('관리자 설정을 저장했습니다.');}
     finally{btn.disabled=false;}
    }));
    row.append(btn);
   }
   info.append(row);
  }
  if(canWarnMembers){
   const warnRow=document.createElement('div');warnRow.className='memberActions';
   const warnBtn=document.createElement('button');warnBtn.type='button';warnBtn.textContent='⚠️ 경고 지급';
   warnBtn.addEventListener('click',()=>task(async()=>{
    const reason=prompt(m.name+'님에게 지급할 경고 사유를 입력하세요.');
    if(reason==null)return;
    if(!reason.trim())throw Error('경고 사유를 입력해야 합니다.');
    const countText=prompt('지급할 경고 개수 (1~10)', '1');
    if(countText==null)return;
    const count=Number(countText);
    if(!Number.isInteger(count)||count<1||count>10)throw Error('경고 개수는 1~10개여야 합니다.');
    if(!confirm(m.name+'님에게 경고 '+count+'개를 지급하시겠습니까?'))return;
    warnBtn.disabled=true;
    try{await api('/api/room-portal/warnings','POST',{userId:m.id,userName:m.name,reason:reason.trim(),count});note(m.name+'님에게 경고 '+count+'개를 지급했습니다.');}
    finally{warnBtn.disabled=false;}
   }));
   warnRow.append(warnBtn);info.append(warnRow);
  }
  wrap.append(info);
  (m.roomRole||m.superAdmin||m.admin?staffList:regularList).append(wrap);
 }
 const staffCount=staffList.children.length,regularCount=regularList.children.length;
 staffHeading.textContent='👑 관리자 인원 · '+staffCount+'명';
 regularHeading.textContent='👥 일반 인원 · '+regularCount+'명';
 if(!staffCount)staffList.textContent='표시할 관리자가 없습니다.';
 if(!regularCount)regularList.textContent='표시할 일반 인원이 없습니다.';
}
async function loadMembers(){
 const d=await api('/api/room-portal/members');
 currentMembers=(d.members||[]).sort((a,b)=>{
  const role=m=>m.roomRole==='방장'?0:m.roomRole==='부방장'?1:m.superAdmin?2:m.admin?3:4;
  return role(a)-role(b)||a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id);
 });canEditMemberRoles=!!d.canEditRoles;
 $('#memberCount').textContent=d.count+'명';
 $('#memberChecked').textContent='마지막 조회: '+new Date(d.checkedAt).toLocaleString('ko-KR');
 drawMembers();
}
async function openInitialTab(){
 if(location.hash==='#members'){switchTab('members');await loadMembers();}
 else if(location.hash==='#ranks'&&!$('#tabRanks').hidden){switchTab('ranks');await loadRanks();}
 else switchTab('settings');
}
$('#tabSettings').addEventListener('click',()=>switchTab('settings'));
$('#tabMembers').addEventListener('click',()=>task(async()=>{switchTab('members');await loadMembers();}));
$('#tabRanks').addEventListener('click',()=>task(async()=>{switchTab('ranks');await loadRanks();}));
$('#prefixForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{
 const prefixes=$('#prefixInput').value.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean);
 const d=await api('/api/room-portal/prefixes','POST',{prefixes});
 $('#prefixInput').value=d.prefixes.join(', ');
 note('명령어 접두사가 '+d.prefixes.join(' / ')+'로 변경되었습니다.');
});});
function confirmTwice(target){
 if(!confirm(target+' 기록을 삭제하시겠습니까? (1/2)'))return false;
 return confirm(target+' 기록이 영구 삭제됩니다. 정말 진행하시겠습니까? (2/2)');
}
async function loadRanks(){
 const d=await api('/api/room-portal/chat-stats');
 rankings=d.rankings||[];
 const top=$('#rankTop');top.replaceChildren();
 for(const r of rankings.slice(0,10)){
  const line=document.createElement('div');line.className='rankRow';
  const n=document.createElement('span');n.textContent=r.rank+'위 · '+r.user_name;
  const count=document.createElement('strong');count.textContent=Number(r.count).toLocaleString('ko-KR')+'회';
  line.append(n,count);top.append(line);
 }
 if(!rankings.length)top.textContent='채팅 기록이 없습니다.';
 $('#ranksSummary').textContent=(d.roomName||'채팅방')+' · 방 ID '+d.roomId+' · 기록된 사용자 '+rankings.length+'명 · 마지막 조회 '+new Date(d.checkedAt).toLocaleString('ko-KR');
 drawRanks();
}
function drawRanks(){
 const area=$('#rankList');area.replaceChildren();
 const filter=$('#rankSearch').value.trim().toLowerCase();
 const shown=rankings.filter(r=>(r.user_name+' '+r.user_id).toLowerCase().includes(filter));
 for(const r of shown){
  const row=document.createElement('div');row.className='rankRow';
  const details=document.createElement('div');details.className='rankDetails';
  const title=document.createElement('strong');title.textContent=r.rank+'위 · '+r.user_name;
  const sub=document.createElement('div');sub.className='muted';sub.textContent='ID: '+r.user_id+' · 채팅 '+Number(r.count).toLocaleString('ko-KR')+'회';
  details.append(title,sub);
  const btn=document.createElement('button');btn.type='button';btn.className='danger';btn.textContent='기록 삭제';
  btn.addEventListener('click',()=>task(async()=>{
   if(!confirmTwice(r.user_name+'('+r.user_id+')님의 채팅'))return;
   await api('/api/room-portal/chat-stats','DELETE',{action:'user',userId:r.user_id,confirmation:'DELETE_CONFIRMED_TWICE'});
   await loadRanks();note('해당 사용자의 채팅 기록을 삭제했습니다.');
  }));
  row.append(details,btn);area.append(row);
 }
 if(!shown.length)area.textContent='표시할 채팅 기록이 없습니다.';
}
$('#reloadRanks').addEventListener('click',()=>task(loadRanks));
$('#rankSearch').addEventListener('input',drawRanks);
$('#resetRanks').addEventListener('click',()=>task(async()=>{
 if(!confirmTwice('이 방의 모든 채팅순위'))return;
 await api('/api/room-portal/chat-stats','DELETE',{action:'all',confirmation:'DELETE_CONFIRMED_TWICE'});
 await loadRanks();note('이 방의 채팅순위 기록을 전체 초기화했습니다.');
}));
$('#reloadMembers').addEventListener('click',()=>task(loadMembers));
$('#memberSearch').addEventListener('input',drawMembers);
task(init);
