'use strict';
const $=s=>document.querySelector(s);
const demos={fishing:['!낚시','⌁','신화의 바다에서 건져 올린 한 마리.','천공해룡\n신화 · 1,240cm','20종의 물고기 · 기다림 없이 바로 낚시'],quiz:['!퀴즈','?','유형: 일반상식','대한민국의 수도는\n어디일까요?','60초 · 첫 정답자 보상 10,000코인'],farm:['!농장','✳','나만의 작은 농장','🟫 🌱 🥕\n🌿 🟫 🌱\n🟫 🟫 🟫','8종의 작물 · 최대 8×8 확장']};
document.querySelectorAll('[data-demo]').forEach(button=>button.addEventListener('click',()=>{const d=demos[button.dataset.demo];$('#demo-command').textContent=d[0];$('.demo-icon').textContent=d[1];$('.console-output p').textContent=d[2];$('.console-output h2').textContent=d[3];$('.console-caption').textContent=d[4];document.querySelectorAll('[data-demo]').forEach(b=>b.classList.toggle('selected',b===button));}));
async function api(path){const r=await fetch(path,{credentials:'same-origin'}),d=await r.json();if(!r.ok)throw Error(d.error||'정보를 불러오지 못했습니다.');return d;}
function empty(target,text){target.replaceChildren();const p=document.createElement('p');p.className='empty';p.textContent=text;target.append(p);}
async function loadRank(kind='coin'){
 const target=$('#ranking-rows');empty(target,'공개된 기록을 불러오는 중입니다.');
 $('#score-label').textContent={coin:'코인',level:'레벨',quiz:'정답 횟수',fishing:'보유 물고기'}[kind];
 try{const data=await api('/api/public/rankings?kind='+kind);if(!data.entries.length){empty(target,'아직 공개된 기록이 없습니다. 첫 번째 플레이어가 되어보세요.');return;}target.replaceChildren();for(const entry of data.entries){const row=document.createElement('div');row.className='rank-row';for(const value of [String(entry.rank).padStart(2,'0'),entry.alias,Number(entry.score).toLocaleString('ko-KR')]){const cell=document.createElement('span');cell.textContent=value;row.append(cell);}target.append(row);}}catch(e){empty(target,e.message);}
}
document.querySelectorAll('[data-rank]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-rank]').forEach(b=>b.classList.toggle('selected',b===button));loadRank(button.dataset.rank);}));
api('/api/public/config').then(d=>{const status=$('#bot-status');status.textContent=d.online?'NEXUS · ONLINE':'KAKAOTALK GAME COMPANION';if(d.openchatUrl){$('#join-link').href=d.openchatUrl;$('#join-link').target='_blank';$('#join-link').rel='noopener noreferrer';$('#join-link').textContent='카카오톡에서 시작하기 ↗';}}).catch(()=>{});
api('/api/public/notices').then(d=>{const target=$('#notice-list');if(!d.notices.length){empty(target,'등록된 공지사항이 없습니다.');return;}target.replaceChildren();for(const item of d.notices){const article=document.createElement('article');article.className='notice';const time=document.createElement('time');time.textContent=(item.pinned?'📌 중요 · ':'')+new Date(item.created_at).toLocaleDateString('ko-KR');const h=document.createElement('h3');h.textContent=item.title;const p=document.createElement('p');p.textContent=item.body;article.append(time,h,p);target.append(article);}}).catch(e=>empty($('#notice-list'),e.message));
loadRank();
