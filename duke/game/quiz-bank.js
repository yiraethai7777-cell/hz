'use strict';
const data={...require('./quiz-bank-core.json'),...require('./quiz-bank-culture.json')};
const CATEGORIES=Object.freeze(['수학','일반','코딩','영어','과학','역사','문학','노래']);
const DIFFICULTIES=new Set(['쉬움','보통','어려움']);
function normalizeAnswer(value){
 if(typeof value!=='string'||value.length>512)return '';
 let v=value.normalize('NFKC').trim().replace(/\s+/gu,'').toLowerCase().replace(/[!?~]+$/u,'');
 if(/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(v))v=v.replace(/,/g,'');
 if(/^[+-]?\d+(?:\.\d+)?$/.test(v)&&Number.isFinite(Number(v))&&Math.abs(Number(v))<=Number.MAX_SAFE_INTEGER)return String(Number(v));
 return v;
}
function makeHint(value){
 const a=String(value).trim(),n=normalizeAnswer(a);
 if(/^[+-]?\d+(?:\.\d+)?$/.test(n)){
  const v=Number(n),digits=n.replace(/^[+-]/,'').split('.')[0].length;
  return '정수 부분 '+digits+'자리'+(Number.isInteger(v)?' · '+(v%2===0?'짝수':'홀수'):' · 소수')+(v<0?' · 음수':'');
 }
 const chars=[...a.replace(/\s+/gu,'')],initials='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
 if(chars.length===1)return '정답은 한 글자입니다. '+(/[a-z]/i.test(chars[0])?'영문자입니다.':/[가-힣]/u.test(chars[0])?'한글입니다.':'문제의 조건을 확인해 보세요.');
 if(chars.some(c=>/[가-힣]/u.test(c)))return '초성 : '+[...a].map(c=>{const v=c.charCodeAt(0)-0xac00;return v>=0&&v<11172?initials[Math.floor(v/588)]:/\s/u.test(c)?' ':'□';}).join('');
 return '첫 글자 : '+chars[0]+' · 공백 제외 '+chars.length+'글자';
}
const seen=new Set(),BANK=Object.freeze(CATEGORIES.map((category,ci)=>{
 const rows=data[category];if(!Array.isArray(rows)||rows.length!==200)throw Error('quiz category must have 200 questions: '+category);
 return Object.freeze(rows.map((row,i)=>{
  const q=String(row.q).trim(),key=q.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  if(!q||seen.has(key)||!DIFFICULTIES.has(row.difficulty))throw Error('invalid or duplicate quiz '+q);
  seen.add(key);
  // Date input must be a complete date, not a partial number.
  const answers=q.startsWith('대한민국의 광복절은 몇 월')?['8월15일','8.15','8/15']:row.answers;
  if(!Array.isArray(answers)||!answers.length||answers.some(a=>!normalizeAnswer(a)))throw Error('invalid quiz answer '+q);
  return Object.freeze({id:ci*200+i,category,difficulty:row.difficulty,question:q,answers:Object.freeze([...answers]),hint:makeHint(answers[0]),answerKeys:new Set(answers.map(normalizeAnswer))});
 }));
}));
module.exports={BANK,CATEGORIES,normalizeAnswer};
