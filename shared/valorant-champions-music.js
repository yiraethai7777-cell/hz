'use strict';
// Verified official VALORANT YouTube uploads. Share links, never download,
// rip, rehost or upload the copyrighted music as a separate audio file.
const ANTHEMS=Object.freeze({
  2021:Object.freeze({title:'Die For You',artist:'Grabbitz',youtube:'https://www.youtube.com/watch?v=h7MYJghRWt0'}),
  2022:Object.freeze({title:'Fire Again',artist:'Ashnikko',youtube:'https://www.youtube.com/watch?v=DqgK4llE1cw'}),
  2023:Object.freeze({title:'Ticking Away',artist:'Grabbitz & bbno$',youtube:'https://www.youtube.com/watch?v=CdZN8PI3MqM'}),
  2024:Object.freeze({title:'SUPERPOWER',artist:'JULIE & NATTY (KISS OF LIFE), Mark Tuan',youtube:'https://www.youtube.com/watch?v=DX4BE9GmpH4'}),
  2025:Object.freeze({title:'Last Shot',artist:'templuv & 347aidan',youtube:'https://www.youtube.com/watch?v=cLx3tyzht3Y'}),
  2026:Object.freeze({title:'If The Sun Burns Out Tonight',artist:'Grabbitz, Oli Sykes & Courtney LaPlante',youtube:'https://www.youtube.com/watch?v=x8jAY2CoOBg'})
});
const COMMAND='!챔스노래';
const YEARS=Object.keys(ANTHEMS);
function format(year){
 const song=ANTHEMS[year];
 if(!song)return null;
 return '🏆 NEXI | VALORANT CHAMPIONS '+year+'\n'+
  '🎵 '+song.title+'\n'+
  '🎤 '+song.artist+'\n'+
  '▶️ 공식 뮤직비디오\n'+song.youtube;
}
async function handle({text,send}){
 const input=String(text||'').trim();
 if(!new RegExp('^'+COMMAND+'(?:\\s|$)').test(input))return false;
 const tail=input.slice(COMMAND.length).trim();
 if(!/^20\d{2}$/.test(tail)||!ANTHEMS[tail]){
  await send('🏆 NEXI | 챔피언스 공식 주제곡\n'+
   '사용법: !챔스노래 (년도)\n'+
   '지원 연도: '+YEARS.join(' / ')+'\n'+
   '예: !챔스노래 2024');
  return true;
 }
 await send(format(tail));
 return true;
}
module.exports={ANTHEMS,YEARS,COMMAND,format,handle};
