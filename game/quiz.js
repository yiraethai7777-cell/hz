'use strict';
function answerMatches(expected,actual){
 const normalize=s=>String(s).normalize('NFKC').trim().replace(/\s+/g,'').toLowerCase();
 const a=normalize(expected),b=normalize(actual),numeric=/^[+-]?\d+(?:\.\d+)?$/;
 if(numeric.test(a))return numeric.test(b)&&Number.isFinite(Number(b))&&Number(a)===Number(b);
 return a.replace(/[!?~]+$/,'')===b.replace(/[!?~]+$/,'');
}
function plainAnswer(quiz,text,now=Date.now()){
 const value=String(text||'').trim();
 return !!(value&&!value.startsWith('!')&&quiz&&quiz.kind!=='넌센스'&&now<quiz.expiresAt&&
  Array.isArray(quiz.answers)&&quiz.answers.some(answer=>answerMatches(answer,value)));
}
module.exports={answerMatches,plainAnswer};
