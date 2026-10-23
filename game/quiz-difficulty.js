'use strict';
// Stable tiers for the 370-question NEXUS bank. The easier tier favors familiar
// facts, vocabulary and small-number arithmetic; the challenge tier retains
// less familiar trivia and longer calculations.
function difficultyOf(quiz,index){
 const type=String(quiz?.[0]||''),question=String(quiz?.[1]||'');
 if(type==='수학'||/\d+\s*[+×x*\-÷/]\s*\d+/.test(question)){
  const parsed=/(\d+)\s*([+×x*\-÷/])\s*(\d+)/.exec(question);
  if(!parsed)return '도전';
  const x=Number(parsed[1]),y=Number(parsed[3]),op=parsed[2];
  if(op==='+'||op==='-')return Math.max(x,y)<=40?'쉬움':'도전';
  if(op==='×'||op==='x'||op==='*')return Math.max(x,y)<=10?'쉬움':'도전';
  return '도전';
 }
 if(index<16)return '쉬움';
 if(/^(영어 |초성 )/.test(question))return '쉬움';
 if(/(태양계|지구|달|태양|물의 화학식|산소의 원소|수소의 원소|곤충의 다리|거미의 다리|문어의 팔|광합성)/.test(question))return '쉬움';
 return '도전';
}
const cache=new WeakMap();
function pools(quizzes){
 if(cache.has(quizzes))return cache.get(quizzes);
 const result={'쉬움':[],'도전':[]};
 for(let i=0;i<quizzes.length;i++)result[difficultyOf(quizzes[i],i)].push(i);
 cache.set(quizzes,result);
 return result;
}
function next(d,quizzes,shuffle){
 const available=pools(quizzes);
 if(!d.quizDifficultyQueue?.length){
  // Three approachable questions for every two challenge questions,
  // in a shuffled order so difficulty does not follow a fixed pattern.
  d.quizDifficultyQueue=shuffle(['쉬움','쉬움','쉬움','도전','도전']);
 }
 const tier=d.quizDifficultyQueue.shift();
 if(!d.quizQueues||typeof d.quizQueues!=='object')d.quizQueues={};
 const choices=available[tier].length?available[tier]:available[tier==='쉬움'?'도전':'쉬움'];
 const key='difficulty:'+tier;
 if(!Array.isArray(d.quizQueues[key])||!d.quizQueues[key].length)
  d.quizQueues[key]=shuffle(choices.slice());
 // Avoid immediately repeating the previous question when refilling the pool.
 if(d.quizQueues[key].length>1&&d.quizQueues[key][0]===d.lastQuiz){
  const first=d.quizQueues[key].shift();d.quizQueues[key].push(first);
 }
 const i=d.quizQueues[key].shift();
 d.lastQuiz=i;
 return {i,q:quizzes[i],difficulty:tier};
}
module.exports={difficultyOf,pools,next};
