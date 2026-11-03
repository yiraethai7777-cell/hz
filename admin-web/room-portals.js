'use strict';
const $=s=>document.querySelector(s);let csrf='',rooms=[],portals=[];
const names={manage:'관리 ON/OFF',mention:'멘션 감지',profile:'프로필 변경 감지',deleted:'메시지 삭제 감지',spam:'도배 감지',templates:'입장·퇴장 메시지',warnings:'경고 내역·지급·삭제',roles:'관리자·최고관리자 추가/삭제'};
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
 for(const [k,name] of Object.entries(names)){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=k;input.checked=k!=='roles';label.append(input,' '+name);$('#permissions').append(label);}
 $('#list').replaceChildren();
 for(const p of portals){const box=document.createElement('div');box.className='card';const title=document.createElement('h3');title.textContent=p.label+' · '+p.room_name+' ('+p.room_id+')';
 const state=document.createElement('p');state.textContent=(p.enabled?'🟢 사용 중':'⚫ 중지됨')+' · 로그인 아이디: '+p.username;
 const pwState=document.createElement('p');pwState.textContent='비밀번호: 암호화되어 조회 불가 (재설정 가능)';
 const link=document.createElement('a');link.href='/room-panel?site='+encodeURIComponent(p.slug);link.textContent=location.origin+link.getAttribute('href');link.target='_blank';link.rel='noopener noreferrer';
 const button=document.createElement('button');button.textContent='설정 수정 / 기능 추가';button.addEventListener('click',()=>fill(p));box.append(title,state,pwState,link,document.createElement('br'),button);$('#list').append(box);}
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
