'use strict';
const {getPool}=require('../shared/db');
async function command(ctx){
 const [cmd,...args]=ctx.text.split(/\s+/);if(!['#랭킹공개','#랭킹비공개'].includes(cmd))return false;
 if(!ctx.userId){await ctx.send('사용자 ID를 확인할 수 없습니다.');return true;}
 if(cmd==='#랭킹비공개'){await getPool().query('UPDATE gl_public_profiles SET consent=FALSE,updated_at=NOW() WHERE room_id=$1 AND user_id=$2',[String(ctx.roomId),String(ctx.userId)]);await ctx.send('🔒 웹 랭킹을 비공개로 변경했습니다.');return true;}
 const alias=args.join(' ').trim();if(!alias||alias.length>24||/[\x00-\x1f]/.test(alias)){await ctx.send('사용법: !랭킹공개 (공개용별명, 1~24자)\n웹사이트 랭킹에 별명과 게임 점수가 표시됩니다. 고유 ID는 공개하지 않습니다.');return true;}
 await getPool().query('INSERT INTO gl_public_profiles(room_id,user_id,alias,consent) VALUES($1,$2,$3,TRUE) ON CONFLICT(room_id,user_id) DO UPDATE SET alias=$3,consent=TRUE,updated_at=NOW()',[String(ctx.roomId),String(ctx.userId),alias]);
 await ctx.send(`🌐 공개용 별명 '${alias}'으로 웹 랭킹 공개에 동의했습니다.\n취소: !랭킹비공개`);return true;
}
module.exports={command};
