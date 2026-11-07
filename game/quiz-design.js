'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {renderAsync}=require('@resvg/resvg-js');
const esc=x=>String(x??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const fonts=['NotoSansKR-Regular.ttf','NotoSansKR-ExtraBold.ttf'].map(n=>path.join(__dirname,'../manage/attendance-image/assets',n));
function questionText(q,{reward=10000,xp=30,now=Date.now(),active=false}={}){
 return 'NEXI | QUIZ\n'+(active?'진행 중인 퀴즈':'오늘의 도전')+'\n\nQ. '+q.question+'\n\n'+
 '과목 · '+q.kind+'   /   난이도 · '+(q.difficulty||'혼합')+'\n'+
 '남은 시간 · '+Math.max(0,Math.ceil((q.expiresAt-now)/1000))+'초\n'+
 '정답 보상 · '+Number(reward).toLocaleString('ko-KR')+'코인   /   +'+xp+' XP\n\n'+
 '정답을 채팅에 입력하세요.\n!정답 (답) 명령어도 사용할 수 있어요.\n첫 번째 정답자에게 보상이 지급됩니다.';
}
function wrap(text,limit=27){const lines=[];let line='',width=0;for(const c of String(text)){const w=c.codePointAt(0)>255?1:.55;if(c==='\n'||width+w>limit){lines.push(line);line='';width=0;if(c==='\n')continue;}line+=c;width+=w;}lines.push(line);return lines;}
function svg(text){
 const parts=String(text).split('\n'),body=parts.slice(2).join('\n').trim().split('\n\n'),question=wrap(body[0]),meta=wrap(body[1],38),guide=wrap(body.slice(2).join('\n'),38);
 const metaY=210+question.length*49,height=metaY+meta.length*36+guide.length*34+160;
 return '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="'+height+'"><rect width="1000" height="'+height+'" rx="30" fill="#0b1526"/><g font-family="Noto Sans KR"><text x="56" y="70" font-size="27" font-weight="800" fill="#63e4cc">NEXI / QUIZ</text><text x="56" y="119" font-size="22" fill="#99acc5">'+esc(parts[1])+'</text><rect x="56" y="151" width="58" height="5" rx="2" fill="#63e4cc"/>'+question.map((l,i)=>'<text x="56" y="'+(214+i*49)+'" font-size="34" font-weight="800" fill="#eff6ff">'+esc(l)+'</text>').join('')+'<rect x="40" y="'+metaY+'" width="920" height="'+(meta.length*36+42)+'" rx="20" fill="#172b43"/>'+meta.map((l,i)=>'<text x="64" y="'+(metaY+44+i*36)+'" font-size="24" fill="#eff6ff">'+esc(l)+'</text>').join('')+guide.map((l,i)=>'<text x="56" y="'+(metaY+meta.length*36+94+i*34)+'" font-size="23" fill="#99acc5">'+esc(l)+'</text>').join('')+'</g></svg>';
}
async function sendImage(client,room,text){
 if(!client?.connected||!client.sendPhoto)return false;
 let dir;const started=Date.now();
 try{const image=await renderAsync(svg(text),{font:{fontFiles:fonts,loadSystemFonts:false,defaultFontFamily:'Noto Sans KR'}});dir=await fs.mkdtemp(path.join(os.tmpdir(),'nexi-quiz-'));const file=path.join(dir,'quiz.png');await fs.writeFile(file,image.asPng());const result=await client.sendPhoto(String(room),file,{filename:'quiz.png',mime:'image/png',width:1000,height:image.height});if(!result?.complete||Number(result.complete.status)!==0)throw Error('Photo unconfirmed');return true;}
 catch(e){console.warn('[NEXI QUIZ IMAGE]',e.message);return false;}
 finally{if(dir)await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});console.log('[NEXI QUIZ TIMING]',{elapsedMs:Date.now()-started});}
}
module.exports={questionText,svg,wrap,sendImage};
