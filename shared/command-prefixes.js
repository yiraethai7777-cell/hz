'use strict';
const {getPool}=require('./db');
const cache=new Map();
function validate(input){
 if(!Array.isArray(input)||input.length<1||input.length>5)throw Error('접두사는 1~5개 지정해 주세요.');
 const a=input.map(v=>String(v).trim());
 if(a.some(v=>v.length<1||v.length>4||/[\s\u0000-\u001f]/.test(v)||v==='#'))throw Error('접두사는 공백 없이 1~4글자여야 하며 #은 사용할 수 없습니다.');
 if(new Set(a).size!==a.length)throw Error('중복 접두사는 사용할 수 없습니다.');
 // Prevent one prefix swallowing another: choose longest matching below.
 return a;
}
async function get(room){
 const key=String(room),existing=cache.get(key);
 if(existing&&Date.now()-existing.at<3000)return existing.value;
 const r=await getPool().query("SELECT data->'commandPrefixes' AS value FROM hz_rooms WHERE room_id=$1",[key]);
 let value=['!'];
 try{if(Array.isArray(r.rows[0]?.value))value=validate(r.rows[0].value);}catch{}
 cache.set(key,{at:Date.now(),value});
 return value;
}
async function set(room,values){
 const prefixes=validate(values);
 await getPool().query("INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object('commandPrefixes',$2::jsonb)) ON CONFLICT(room_id) DO UPDATE SET data=jsonb_set(hz_rooms.data,'{commandPrefixes}',$2::jsonb,true),updated_at=NOW()",[String(room),JSON.stringify(prefixes)]);
 cache.set(String(room),{at:Date.now(),value:prefixes});
 return prefixes;
}
function normalize(text,prefixes){
 const raw=String(text);
 // Longest prefix first. A configured prefix also matches commands that
 // would otherwise begin with an excluded ! prefix (e.g. !!).
 const matching=[...prefixes].sort((a,b)=>b.length-a.length).find(p=>raw.startsWith(p));
 if(matching)return {text:'!'+raw.slice(matching.length),blocked:false,used:true};
 // Legacy ! command is blocked when absent from this room's prefixes.
 return {text:raw,blocked:raw.startsWith('!')&&!prefixes.includes('!'),used:false};
}
module.exports={get,set,normalize,validate};
