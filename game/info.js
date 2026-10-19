'use strict';
const {getPool}=require('../shared/db');
const FOLD='\u200b'.repeat(1200);
const fmt=n=>Number(n||0).toLocaleString('ko-KR');
function format({id,name,bot,player={},balance=0,chat,link}) {
 const mention=`\u0002${id}\u0003${String(name).replace(/[\u0000-\u001f]/g,'')}\u0004`;
 const n=Math.max(1,Math.min(200,Number(player.level)||1));
 const fields=[
  '┏━━━━━━━━━━━━━━━━━━━━━━',
  '┃ NEXUS · 프로필 정보',
  '┣━━━━━━━━━━━━━━━━━━━━━━',
  `┃ ⭐ 레벨 · ${n} / 200`,
  `┃ 💰 코인 · ${bot?'∞':fmt(balance)}`,
  `┃ 🆔 아이디 · ${id}`,
  `┃ 🏆 채팅순위 · ${chat?.rank?fmt(chat.rank)+'위':'기록 없음'}`,
  `┃ 💬 채팅량 · ${fmt(chat?.count)}회`,
  '┣━━━━━━━━━━━━━━━━━━━━━━',
  '┃ 🎮 게임 기록',
  `┃ · 경험치 ${fmt(player.xp)} / ${n>=200?0:100+(n-1)*25}`,
  `┃ · 퀴즈 정답 ${fmt(player.wins)}회`,
  `┃ · 보유 물고기 ${fmt(player.inventory?.length)}마리`,
  `┃ · 낚시대 ${player.rod||'나무'} +${fmt(player.rodLevels?.[player.rod])}`,
  `┃ · 보유 펫 ${fmt(Object.keys(player.pets||{}).length)}종`,
  '┣━━━━━━━━━━━━━━━━━━━━━━',
  '┃ 🔗 오픈프로필',
  `┃ ${link||'확인된 오픈프로필 링크 없음'}`,
  '┗━━━━━━━━━━━━━━━━━━━━━━'
 ];
 return `👤 ${mention}님의 프로필 정보\n${FOLD}\n${fields.join('\n')}`;
}
async function handle(ctx,client) {
 if(ctx.text!=='!정보')return false;
 const id=String(ctx.userId??ctx.msg?.sender?.id??'');
 if(!/^\d+$/.test(id)){await ctx.send('사용자 ID를 확인할 수 없습니다.');return true;}
 const db=getPool(),room=String(ctx.roomId),name=ctx.userName||ctx.msg?.sender?.name||id;
 if(!ctx.isBotAccount)await require('./economy').ensureLinked(room,id,name);
 const player=(await db.query('SELECT data FROM hz_rooms WHERE room_id=$1',[room])).rows[0]?.data?.players?.[id]||{};
 const balance=(await db.query('SELECT balance FROM hz_wallets WHERE room_id=$1 AND user_id=$2',[room,id])).rows[0]?.balance||0;
 const chat=(await db.query(`SELECT count,
  (SELECT COUNT(*)+1 FROM gl_manage_chat_counts b WHERE b.room_id=a.room_id
   AND (b.count>a.count OR (b.count=a.count AND b.user_id<a.user_id))) AS rank
  FROM gl_manage_chat_counts a WHERE room_id=$1 AND user_id=$2`,[room,id])).rows[0];
 let link='';
 try{if(typeof client.getUserOpenProfileLink==='function')link=await client.getUserOpenProfileLink(room,id);}catch{}
 const valid=v=>/^https:\/\/open\.kakao\.com\/o\/[A-Za-z0-9_-]+(?:[?#][^\s]*)?$/.test(v||'');
 if(!valid(link))link='';
 if(!link){const r=await db.query('SELECT open_profile_link FROM hz_members WHERE room_id=$1 AND user_id=$2',[room,id]);const saved=r.rows[0]?.open_profile_link;if(valid(saved))link=saved;}
 await ctx.send(format({id,name,bot:ctx.isBotAccount,player,balance,chat,link}));
 return true;
}
module.exports={format,handle};
