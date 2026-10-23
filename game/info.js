'use strict';
const {getPool}=require('../shared/db');
const FOLD='\u200b'.repeat(1200);
const fmt=n=>Number(n||0).toLocaleString('ko-KR');
function format({id,name,bot,player={},balance=0,chat,link}) {
 const mention=`\u0002${id}\u0003${String(name).replace(/[\u0000-\u001f]/g,'')}\u0004`;
 const n=Math.max(1,Math.min(200,Number(player.level)||1));
 
const fields = [
  '┏━━━━━━━━━━━━━━━━━━━━━━',
  '┃ NEXUS | USER PROFILE',
  '┣━━━━━━━━━━━━━━━━━━━━━━',
  `┃ [ LV ] 레벨 · ${n} / 200`,
  `┃ [ COIN ] 코인 · ${bot ? '∞' : fmt(balance)}`,
  `┃ [ ID ] 아이디 · ${id}`,
  `┃ [ RANK ] 채팅 순위 · ${chat?.rank ? fmt(chat.rank) + '위' : '기록 없음'}`,
  `┃ [ CHAT ] 채팅량 · ${fmt(chat?.count)}회`,
  '┣━━━━━━━━━━━━━━━━━━━━━━',
  '┃ [ GAME ] 게임 기록',
  '┃',
  `┃ [ EXP ] 경험치 · ${fmt(player.xp)} / ${n >= 200 ? 0 : 100 + (n - 1) * 25}`,
  `┃ [ QUIZ ] 퀴즈 정답 · ${fmt(player.wins)}회`,
  `┃ [ FISH ] 물고기 · ${fmt(player.inventory?.length)}마리`,
  `┃ [ ROD ] 낚시대 · ${player.rod || '나무'} +${fmt(player.rodLevels?.[player.rod])}`,
  `┃ [ PET ] 보유 펫 · ${fmt(Object.keys(player.pets || {}).length)}종`,
  '┣━━━━━━━━━━━━━━━━━━━━━━',
  '┃ [ LINK ] 오픈프로필',
  `┃ ${link || '확인된 오픈프로필 링크 없음'}`,
  '┗━━━━━━━━━━━━━━━━━━━━━━'
];

 return `${mention}님의 프로필 정보\n${FOLD}\n${fields.join('\n')}`;
}
async function handle(ctx,client) {
 if(ctx.text!=='#정보')return false;
 const id=String(ctx.userId??ctx.msg?.sender?.id??'');
 if(!/^\d+$/.test(id)){await ctx.send('사용자 ID를 확인할 수 없습니다.');return true;}
 const db=getPool(),room=String(ctx.roomId),name=ctx.userName||ctx.msg?.sender?.name||id;
 if(!ctx.isBotAccount)await require('./economy').ensureLinked(room,id,name);
 // Read profile fields in parallel and use the link saved by profile observation,
 // avoiding a synchronous Kakao API lookup on every !정보 request.
 const [roomResult,walletResult,chatResult,profileResult]=await Promise.all([
   db.query('SELECT data FROM hz_rooms WHERE room_id=$1',[room]),
   db.query('SELECT balance FROM hz_wallets WHERE room_id=$1 AND user_id=$2',[room,id]),
   db.query(`SELECT count,
     (SELECT COUNT(*)+1 FROM gl_manage_chat_counts b WHERE b.room_id=a.room_id
      AND (b.count>a.count OR (b.count=a.count AND b.user_id<a.user_id))) AS rank
     FROM gl_manage_chat_counts a WHERE room_id=$1 AND user_id=$2`,[room,id]),
   db.query('SELECT open_profile_link FROM hz_members WHERE room_id=$1 AND user_id=$2',[room,id])
 ]);
 const player=roomResult.rows[0]?.data?.players?.[id]||{};
 const balance=walletResult.rows[0]?.balance||0;
 const chat=chatResult.rows[0];
 const saved=profileResult.rows[0]?.open_profile_link;
 const valid=v=>/^https:\/\/open\.kakao\.com\/o\/[A-Za-z0-9_-]+(?:[?#][^\s]*)?$/.test(v||'');
 const link=valid(saved)?saved:'';
 await ctx.send(format({id,name,bot:ctx.isBotAccount,player,balance,chat,link}));
 return true;
}
module.exports={format,handle};
