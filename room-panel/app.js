'use strict';
const $=s=>document.querySelector(s);const slug=new URLSearchParams(location.search).get('site')||'';let csrf='';
const names={manage:'관리 기능',mention:'멘션 감지',profile:'프로필 변경 감지',deleted:'메시지 삭제 감지',spam:'도배 감지'};
function note(s,error=false){$('#notice').textContent=s;$('#notice').className=error?'error':'';}
async function api(path,method='GET',body){
 const r=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method!=='GET'?{'x-csrf-token':csrf}:{})},...(method==='GET'?{}:{body:JSON.stringify(body||{})})});
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
 $('#joinTemplate').value=d.joinTemplate;$('#leaveTemplate').value=d.leaveTemplate;
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
$('#loginForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{
 const f=new FormData(e.currentTarget);const s=await api('/api/room-portal/login','POST',{site:slug,username:f.get('username'),password:f.get('password')});
 csrf=s.csrf;$('#login').hidden=true;$('#app').hidden=false;e.currentTarget.reset();await render();note('로그인되었습니다.');
});});
$('#logout').addEventListener('click',()=>task(async()=>{await api('/api/room-portal/logout','POST');csrf='';$('#app').hidden=true;$('#login').hidden=false;note('로그아웃되었습니다.');}));
$('#templateForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{await api('/api/room-portal/template','POST',{kind:'join',value:$('#joinTemplate').value});await api('/api/room-portal/template','POST',{kind:'leave',value:$('#leaveTemplate').value});note('입장·퇴장 문구를 저장했습니다.');});});
$('#warnForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{await api('/api/room-portal/warnings','POST',{userId:$('#userId').value,userName:$('#userName').value,reason:$('#reason').value});$('#reason').value='';await renderWarnings();note('경고를 지급했습니다.');});});
task(init);
