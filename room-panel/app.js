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
 csrf=s.csrf;$('#login').hidden=true;$('#app').hidden=false;await render();
}
$('#loginForm').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;task(async()=>{
 const f=new FormData(form);const s=await api('/api/room-portal/login','POST',{site:slug,username:f.get('username'),password:f.get('password')});
 csrf=s.csrf;$('#login').hidden=true;$('#app').hidden=false;form.reset();await render();note('로그인되었습니다.');
});});
$('#logout').addEventListener('click',()=>task(async()=>{await api('/api/room-portal/logout','POST');csrf='';$('#app').hidden=true;$('#login').hidden=false;note('로그아웃되었습니다.');}));
$('#templateForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{await api('/api/room-portal/template','POST',{kind:'join',value:$('#joinTemplate').value});await api('/api/room-portal/template','POST',{kind:'leave',value:$('#leaveTemplate').value});note('입장·퇴장 문구를 저장했습니다.');});});
$('#warnForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{await api('/api/room-portal/warnings','POST',{userId:$('#userId').value,userName:$('#userName').value,reason:$('#reason').value});$('#reason').value='';await renderWarnings();note('경고를 지급했습니다.');});});
$('#accountForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{
 await api('/api/room-portal/account','POST',{username:$('#newUsername').value,currentPassword:$('#currentPassword').value,newPassword:$('#newPassword').value});
 csrf='';$('#app').hidden=true;$('#login').hidden=false;$('#accountForm').reset();note('계정 정보가 변경되었습니다. 새 아이디와 비밀번호로 다시 로그인해 주세요.');
});});
let currentMembers=[],canEditMemberRoles=false;
function memberTab(show){
 $('#settingsView').hidden=show;
 $('#membersView').hidden=!show;
 $('#tabSettings').className=show?'secondary':'';
 $('#tabMembers').className=show?'':'secondary';
}
function drawMembers(){
 const list=$('#memberList');list.replaceChildren();
 const term=$('#memberSearch').value.trim().toLowerCase();
 const visible=currentMembers.filter(m=>(m.name+' '+m.id).toLowerCase().includes(term));
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
  if(canEditMemberRoles&&!m.roomRole){
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
  wrap.append(info);list.append(wrap);
 }
 if(!visible.length)list.textContent='검색 결과가 없습니다.';
}
async function loadMembers(){
 const d=await api('/api/room-portal/members');
 currentMembers=d.members||[];canEditMemberRoles=!!d.canEditRoles;
 $('#memberCount').textContent=d.count+'명';
 $('#memberChecked').textContent='마지막 조회: '+new Date(d.checkedAt).toLocaleString('ko-KR');
 drawMembers();
}
$('#tabSettings').addEventListener('click',()=>memberTab(false));
$('#tabMembers').addEventListener('click',()=>task(async()=>{memberTab(true);await loadMembers();}));
$('#reloadMembers').addEventListener('click',()=>task(loadMembers));
$('#memberSearch').addEventListener('input',drawMembers);
task(init);
