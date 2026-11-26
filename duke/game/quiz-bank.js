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
const seen=new Set(),BANK=Object.freeze(CATEGORIES.map((category,ci)=>{
 const rows=data[category];if(!Array.isArray(rows)||rows.length!==200)throw Error('quiz category must have 200 questions: '+category);
 return Object.freeze(rows.map((row,i)=>{
  const q=String(row.q).trim(),key=q.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  if(!q||seen.has(key)||!DIFFICULTIES.has(row.difficulty))throw Error('invalid or duplicate quiz '+q);
  seen.add(key);
  // Date input must be a complete date, not a partial number.
  const answers=q.startsWith('대한민국의 광복절은 몇 월')?['8월15일','8.15','8/15']:row.answers;
  if(!Array.isArray(answers)||!answers.length||answers.some(a=>!normalizeAnswer(a)))throw Error('invalid quiz answer '+q);
  return Object.freeze({id:ci*200+i,category,difficulty:row.difficulty,question:q,answers:Object.freeze([...answers]),answerKeys:new Set(answers.map(normalizeAnswer))});
 }));
}));
module.exports={BANK,CATEGORIES,normalizeAnswer};
