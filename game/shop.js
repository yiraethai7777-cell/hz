'use strict';
const {PICKS,state}=require('./mining-rules');
const FOLD='\u200b'.repeat(1200),fmt=n=>BigInt(n).toLocaleString('ko-KR');
function format(category,p={}){
 const st=state(p),next=PICKS[st.level+1],header='🛒 NEXI | 상점\n';
 if(!category)return header+'⛏ 곡괭이 · 🎣 낚싯대 · 🌱 씨앗 · 🧰 소모품\n'+FOLD+'\n━━━━━\n!상점 곡괭이\n!상점 낚싯대\n!상점 씨앗\n!상점 소모품\n━━━━━\n내 곡괭이 · '+PICKS[st.level].name+' +'+st.level+'\n'+(next?'다음 강화 · '+fmt(next.cost)+'코인\n!곡괭이강화':'곡괭이 최고 단계')+'\n!채굴지로 채굴 장소를 선택하세요.';
 if(category==='곡괭이')return header+'⛏ 곡괭이 강화\n현재 · '+PICKS[st.level].name+' +'+st.level+'\n'+FOLD+'\n━━━━━\n'+PICKS.map((v,i)=>'+'+i+' '+v.name+' · '+(i?fmt(v.cost)+'코인':'기본 지급')+(i===st.level?' [현재]':'')).join('\n')+'\n━━━━━\n단계가 높을수록 희귀 광물 확률이 증가합니다.\n표시된 가격은 바로 이전 단계에서 강화하는 비용입니다.\n강화는 성공 확정 · !곡괭이강화\n+2 깊은동굴 / +4 수정지대 해금';
 if(['낚싯대','낚시대'].includes(category))return header+'🎣 낚싯대\n'+FOLD+'\n━━━━━\n'+require('./data').RODS.map(r=>r.name+' · '+(r.price?fmt(r.price)+'코인':'무료')).join('\n')+'\n━━━━━\n!낚시대ㄱㅁ (이름)\n!낚시장착 (이름)';
 if(category==='씨앗')return header+'🌱 씨앗\n'+FOLD+'\n━━━━━\n'+require('./farm').CROPS.map(c=>c.emoji+' '+c.name+' · '+fmt(c.price)+'코인\n성장 '+c.minutes+'분 · 수확 '+fmt(c.sale)+'코인').join('\n')+'\n━━━━━\n!씨앗ㄱㅁ (이름) (수량)\n!농장';
 if(category==='소모품')return header+'🧰 소모품\n'+FOLD+'\n━━━━━\n🍀 행운 포션 · 40,000코인\n10분간 낚시 행운 50% 상승\n!ㄱㅁ행운\n\n🤖 자동낚시 · 50,000코인\n5분간 자동 낚시 · 하루 3회\n!ㄱㅁ자동\n\n🛡 보호권 · 100,000코인\n낚싯대 파괴 시 복구 · 하루 5개\n!보호권ㄱㅁ (수량)';
 throw Error('사용법: !상점 [곡괭이/낚싯대/씨앗/소모품]');
}
function createShop({pool=require('../shared/db').getPool()}={}){return {handle:async ctx=>{
 const parts=require('./command-text').normalize(ctx.text).split(/\s+/);if(parts[0]!=='#상점')return false;
 let text;try{if(parts.length>2)throw Error('사용법: !상점 [곡괭이/낚싯대/씨앗/소모품]');const r=await pool.query('SELECT pick_level,location FROM hz_mining_players WHERE room_id=$1 AND user_id=$2',[String(ctx.roomId),String(ctx.userId)]);text=format(parts[1],r.rows[0]);}catch(e){text=e.code?'상점 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.':e.message;console.warn('[NEXI SHOP]',e.code||'REJECTED');}await ctx.send(text);return true;
 }};}
let service;module.exports={format,createShop,handle:ctx=>(service||=createShop()).handle(ctx)};
