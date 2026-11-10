'use strict';
const $=s=>document.querySelector(s);let csrf='',rooms=[],portals=[];
const names={manage:'방 관리 ON/OFF',game:'게임 기능 ON/OFF',quiz:'퀴즈 기능 ON/OFF',fishing:'낚시 기능 ON/OFF',mention:'멘션 감지',profile:'프로필 변경 감지',deleted:'삭제 감지',spam:'도배 감지',templates:'입장·퇴장 문구 편집',warnings:'인원별 경고 및 내역',roles:'일반 관리자 지정 (최고관리자 제외)',prefixes:'명령어 접두사 변경',chatStats:'채팅순위·기록 관리',notes:'인원별 관리 메모',kick:'인원 개별 강퇴'};
function notice(t){$('#message').textContent=t;}
async function api(path,method='GET',body){const r=await fetch(path,{method,headers:{'Content-Type':'application/json',...(method==='GET'?{}:{'x-csrf-token':csrf})},...(method==='GET'?{}:{body:JSON.stringify(body)})});const x=await r.json();if(!r.ok)throw Error(x.error||'요청 실패');return x;}
async function task(fn){try{await fn();}catch(e){notice('❌ '+e.message);}}
function fill(p){
 $('#savedPassword').hidden=true;
 $('#room').value=p.room_id;$('#label').value=p.label;$('#username').value=p.username;$('#password').value='';$('#enabled').checked=p.enabled;
 for(const input of $('#permissions').querySelectorAll('input'))input.checked=!!p.permissions[input.value];
 scrollTo({top:0,behavior:'smooth'});notice('선택한 고객의 설정을 편집 중입니다. 비밀번호를 비워두면 유지됩니다.');
}
async function load(){
 const [a,b]=await Promise.all([api('/api/admin/rooms'),api('/api/admin/room-portals')]);rooms=a.rooms;portals=b.portals;
 const selected=$('#room').value;$('#room').replaceChildren();
 for(const r of rooms){const option=document.createElement('option');option.value=r.room_id;option.textContent=(r.name||'채팅방')+' · '+r.room_id;$('#room').append(option);}
 if(rooms.some(r=>r.room_id===selected))$('#room').value=selected;
 $('#permissions').replaceChildren();
 for(const [k,name] of Object.entries(names)){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=k;input.checked=!['roles','kick'].includes(k);label.append(input,' '+name);$('#permissions').append(label);}
 $('#list').replaceChildren();
 for(const p of portals){const box=document.createElement('div');box.className='card';const title=document.createElement('h3');title.textContent=p.label+' · '+p.room_name+' ('+p.room_id+')';
 const state=document.createElement('p');state.textContent=(p.enabled?'🟢 사용 중':'⚫ 중지됨')+' · 로그인 아이디: '+p.username;
 const pwState=document.createElement('p');pwState.textContent='비밀번호: 암호화되어 조회 불가 (재설정 가능)';
 const link=document.createElement('a');link.href='/room-panel?site='+encodeURIComponent(p.slug);link.textContent=location.origin+link.getAttribute('href');link.target='_blank';link.rel='noopener noreferrer';
 const button=document.createElement('button');button.textContent='설정 수정 / 기능 추가';button.addEventListener('click',()=>fill(p));
 const reset=document.createElement('button');reset.type='button';reset.textContent='새 비밀번호 발급 · 보기';reset.className='secondary';
 reset.addEventListener('click',()=>task(async()=>{
  if(!confirm(p.label+'의 비밀번호를 새로 발급하시겠습니까?\\n기존 비밀번호와 로그인 세션은 모두 무효화됩니다.'))return;
  reset.disabled=true;
  try{
   const result=await api('/api/admin/room-portal-password-reset','POST',{roomId:p.room_id});
   const credential=document.createElement('div');credential.className='credential-result';
   const userLine=document.createElement('p');userLine.textContent='로그인 아이디: '+result.username;
   const pwLine=document.createElement('p');
   const pwLabel=document.createElement('strong');pwLabel.textContent='새 비밀번호: ';
   const pwValue=document.createElement('code');pwValue.textContent=result.password;
   pwLine.append(pwLabel,pwValue);
   const copy=document.createElement('button');copy.type='button';copy.className='secondary';copy.textContent='아이디·비밀번호 복사';
   copy.addEventListener('click',()=>task(async()=>{
    await navigator.clipboard.writeText('아이디: '+result.username+'\\n비밀번호: '+result.password);
    notice('✅ 로그인 정보를 복사했습니다.');
   }));
   const warning=document.createElement('p');warning.className='muted';warning.textContent='새 비밀번호는 현재 화면에서만 확인할 수 있습니다. 새로고침 후에는 다시 표시되지 않습니다.';
   credential.append(userLine,pwLine,copy,warning);
   box.querySelector('.credential-result')?.remove();
   box.append(credential);
   notice('✅ 새 비밀번호가 발급되었습니다. 기존 비밀번호와 로그인 세션은 무효화되었습니다.');
  }finally{reset.disabled=false;}
 }));
 box.append(title,state,pwState,link,document.createElement('br'),button,' ',reset);$('#list').append(box);}
 if(!portals.length)$('#list').textContent='발급된 웹사이트가 없습니다.';
 $('#room').dispatchEvent(new Event('change'));
}
$('#showPassword').addEventListener('change',()=>{$('#password').type=$('#showPassword').checked?'text':'password';});
$('#room').addEventListener('change',()=>{const p=portals.find(x=>x.room_id===$('#room').value);if(p){fillFields(p);}else{$('#label').value='';$('#username').value='';$('#password').value='';$('#enabled').checked=true;for(const input of $('#permissions').querySelectorAll('input'))input.checked=true;}});
function fillFields(p){$('#label').value=p.label;$('#username').value=p.username;$('#password').value='';$('#enabled').checked=p.enabled;for(const input of $('#permissions').querySelectorAll('input'))input.checked=!!p.permissions[input.value];}
$('#create').addEventListener('submit',e=>{e.preventDefault();task(async()=>{
 const roomId=$('#room').value,exists=portals.some(p=>p.room_id===roomId);
 if(!exists&&$('#password').value.length<10)throw Error('새 고객의 비밀번호를 10자 이상 입력하세요.');
 const newlySetPassword=$('#password').value;
 const permissions=Object.fromEntries([...$('#permissions').querySelectorAll('input')].map(i=>[i.value,i.checked]));
 const result=await api('/api/admin/room-portals','POST',{roomId,label:$('#label').value,username:$('#username').value,password:$('#password').value,permissions,enabled:$('#enabled').checked,revokeSessions:$('#revoke').checked});
 await load();notice('✅ 저장 완료. 고객 주소: '+location.origin+result.url);
 if(newlySetPassword){const out=$('#savedPassword');out.hidden=false;out.replaceChildren();out.append('방금 설정한 새 비밀번호: ');const value=document.createElement('strong');value.textContent=newlySetPassword;out.append(value,' (이 페이지에서만 임시 표시되며, 다시 조회할 수 없습니다.)');}else{$('#savedPassword').hidden=true;}
});});
(async()=>{try{const s=await api('/api/session');if(!s.authenticated)throw Error('먼저 /admin에서 총관리자 로그인을 해주세요.');csrf=s.csrf;await load();}catch(e){notice('❌ '+e.message);}})();
