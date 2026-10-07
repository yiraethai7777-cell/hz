"use strict";
const { Pool } = require("pg");

// HZ 통합 봇: 게임 + 출석 + 준개 + 관리
// 사용법: const { attachHZBot } = require("./hz-bot"); await attachHZBot(alreadyConnectedKakaoForgeClient);

const pool = new Pool({connectionString:process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? {rejectUnauthorized:false}:false});
const QUIZ_REWARD=10000, QUIZ_SECONDS=60, FISHING_COOLDOWN_SECONDS=60, FISHING_WAIT_MS=2000, QUIZ_XP=30, FISHING_XP=20, MAX_LEVEL=200;
const MORE="\u200b".repeat(500);
const RODS=[{name:"나무",price:0,luck:1},{name:"돌",price:20000,luck:1.2},{name:"철",price:100000,luck:1.5},{name:"구름",price:500000,luck:2},{name:"불",price:1500000,luck:3},{name:"우주",price:5000000,luck:5},{name:"천상",price:15000000,luck:8}];
const FISH_TABLE=[
{name:"멸치",tier:"일반",weight:1000,base:100,min:3,max:15},{name:"피라미",tier:"일반",weight:1000,base:150,min:5,max:25},{name:"붕어",tier:"일반",weight:1000,base:200,min:10,max:45},{name:"고등어",tier:"일반",weight:1000,base:250,min:15,max:60},{name:"잉어",tier:"일반",weight:1000,base:300,min:20,max:100},{name:"메기",tier:"일반",weight:1000,base:400,min:25,max:150},
{name:"무지개송어",tier:"희귀",weight:400,base:1000,min:20,max:90},{name:"연어",tier:"희귀",weight:400,base:1500,min:30,max:140},{name:"참돔",tier:"희귀",weight:400,base:2000,min:25,max:120},{name:"참치",tier:"희귀",weight:400,base:3000,min:80,max:400},{name:"황새치",tier:"희귀",weight:400,base:4000,min:100,max:500},
{name:"월광비늘어",tier:"영웅",weight:150,base:8000,min:30,max:180},{name:"수정지느러미어",tier:"영웅",weight:150,base:10000,min:40,max:250},{name:"심해유령어",tier:"영웅",weight:150,base:15000,min:80,max:600},{name:"폭풍가오리",tier:"영웅",weight:150,base:20000,min:150,max:1000},
{name:"황금용어",tier:"전설",weight:100,base:50000,min:200,max:1500},{name:"불사조잉어",tier:"전설",weight:100,base:80000,min:300,max:2000},{name:"별바다의 왕어",tier:"전설",weight:100,base:120000,min:500,max:3000},{name:"해룡",tier:"신화",weight:50,base:450000,min:1000,max:10000},{name:"레비아탄",tier:"신화",weight:50,base:700000,min:3000,max:30000}];
const QUIZZES = [
    ["일반", "대한민국의 수도는?", ["서울", "서울특별시"]],
    ["일반", "한글을 창제한 왕은?", ["세종", "세종대왕"]],
    ["일반", "대한민국의 국기 이름은?", ["태극기"]],
    ["일반", "대한민국의 화폐 단위는?", ["원", "원화"]],
    ["일반", "대한민국의 국가 이름은?", ["애국가"]],
    ["일반", "일본의 수도는?", ["도쿄", "동경"]],
    ["일반", "중국의 수도는?", ["베이징", "북경"]],
    ["일반", "프랑스의 수도는?", ["파리"]],
    ["일반", "영국의 수도는?", ["런던"]],
    ["일반", "미국의 수도는?", ["워싱턴", "워싱턴DC", "워싱턴D.C."]],
    ["일반", "이탈리아의 수도는?", ["로마"]],
    ["일반", "독일의 수도는?", ["베를린"]],
    ["일반", "캐나다의 수도는?", ["오타와"]],
    ["일반", "호주의 수도는?", ["캔버라"]],
    ["일반", "스페인의 수도는?", ["마드리드"]],
    ["일반", "태국의 수도는?", ["방콕"]],
    ["일반", "베트남의 수도는?", ["하노이"]],
    ["일반", "인도의 수도는?", ["뉴델리"]],
    ["일반", "브라질의 수도는?", ["브라질리아"]],
    ["일반", "이집트의 수도는?", ["카이로"]],
    ["일반", "그리스의 수도는?", ["아테네"]],
    ["일반", "러시아의 수도는?", ["모스크바"]],
    ["일반", "지구의 자연 위성은?", ["달"]],
    ["일반", "태양계에서 가장 큰 행성은?", ["목성"]],
    ["일반", "태양과 가장 가까운 행성은?", ["수성"]],
    ["일반", "우리가 사는 행성은?", ["지구"]],
    ["일반", "붉은 행성이라고 불리는 행성은?", ["화성"]],
    ["일반", "뚜렷한 고리로 유명한 행성은?", ["토성"]],
    ["일반", "태양계의 중심에 있는 별은?", ["태양"]],
    ["일반", "지구가 스스로 도는 운동은?", ["자전"]],
    ["일반", "지구가 태양 주위를 도는 운동은?", ["공전"]],
    ["일반", "물의 화학식은?", ["H2O", "H₂O"]],
    ["일반", "산소의 원소 기호는?", ["O"]],
    ["일반", "수소의 원소 기호는?", ["H"]],
    ["일반", "금의 원소 기호는?", ["Au"]],
    ["일반", "은의 원소 기호는?", ["Ag"]],
    ["일반", "철의 원소 기호는?", ["Fe"]],
    ["일반", "탄소의 원소 기호는?", ["C"]],
    ["일반", "질소의 원소 기호는?", ["N"]],
    ["일반", "헬륨의 원소 기호는?", ["He"]],
    ["일반", "식물이 빛을 이용해 양분을 만드는 작용은?", ["광합성"]],
    ["일반", "물이 표면에서 수증기로 변하는 현상은?", ["증발"]],
    ["일반", "수증기가 물방울로 변하는 현상은?", ["응결", "액화"]],
    ["일반", "거미의 다리는 몇 개?", ["8", "8개", "여덟", "여덟개"]],
    ["일반", "곤충의 다리는 몇 개?", ["6", "6개", "여섯", "여섯개"]],
    ["일반", "문어의 팔은 몇 개?", ["8", "8개", "여덟", "여덟개"]],
    ["일반", "개구리의 새끼는?", ["올챙이"]],
    ["일반", "1분은 몇 초?", ["60", "60초"]],
    ["일반", "1시간은 몇 분?", ["60", "60분"]],
    ["일반", "하루는 몇 시간?", ["24", "24시간"]],
    ["일반", "일주일은 며칠?", ["7", "7일", "칠일"]],
    ["일반", "1년은 몇 개월?", ["12", "12개월"]],
    ["일반", "윤년의 2월은 며칠까지?", ["29", "29일"]],
    ["일반", "1미터는 몇 센티미터?", ["100", "100cm", "100센티미터"]],
    ["일반", "1킬로미터는 몇 미터?", ["1000", "1000m", "1000미터", "1,000"]],
    ["일반", "1킬로그램은 몇 그램?", ["1000", "1000g", "1000그램", "1,000"]],
    ["일반", "7 + 8 = ?", ["15"]],
    ["일반", "25 - 9 = ?", ["16"]],
    ["일반", "6 × 7 = ?", ["42"]],
    ["일반", "8 × 9 = ?", ["72"]],
    ["일반", "81 ÷ 9 = ?", ["9"]],
    ["일반", "12 × 12 = ?", ["144"]],
    ["일반", "100의 절반은?", ["50"]],
    ["일반", "200의 10%는?", ["20"]],
    ["일반", "3의 제곱은?", ["9"]],
    ["일반", "2의 세제곱은?", ["8"]],
    ["일반", "삼각형의 내각의 합은?", ["180", "180도"]],
    ["일반", "사각형의 내각의 합은?", ["360", "360도"]],
    ["일반", "직각은 몇 도?", ["90", "90도"]],
    ["일반", "평각은 몇 도?", ["180", "180도"]],
    ["일반", "가장 작은 소수는?", ["2"]],
    ["일반", "초성 ㅂㄴㄴ / 길쭉하고 노란 과일", ["바나나"]],
    ["일반", "초성 ㅅㅂ / 속이 빨간 여름 과일", ["수박"]],
    ["일반", "초성 ㄸㄱ / 빨간 과일", ["딸기"]],
    ["일반", "초성 ㅍㄷ / 알이 송이로 달리는 과일", ["포도"]],
    ["일반", "초성 ㅂㅅㅇ / 털이 있는 과일", ["복숭아"]],
    ["일반", "초성 ㄱㅇㅇ / 야옹 하고 우는 동물", ["고양이"]],
    ["일반", "초성 ㄱㅇㅈ / 개의 새끼", ["강아지"]],
    ["일반", "초성 ㅋㄲㄹ / 코가 긴 동물", ["코끼리"]],
    ["일반", "초성 ㄱㄹ / 목이 긴 동물", ["기린"]],
    ["일반", "초성 ㅎㄹㅇ / 줄무늬가 있는 큰 고양잇과 동물", ["호랑이"]],
    ["일반", "영어 apple의 뜻은?", ["사과"]],
    ["일반", "영어 banana의 뜻은?", ["바나나"]],
    ["일반", "영어 cat의 뜻은?", ["고양이"]],
    ["일반", "영어 dog의 뜻은?", ["개", "강아지"]],
    ["일반", "영어 water의 뜻은?", ["물"]],
    ["일반", "영어 book의 뜻은?", ["책"]],
    ["일반", "영어 school의 뜻은?", ["학교"]],
    ["일반", "영어 sun의 뜻은?", ["태양", "해"]],
    ["일반", "영어 moon의 뜻은?", ["달"]],
    ["일반", "영어 star의 뜻은?", ["별"]],
    ["일반", "대한민국에서 가장 높은 산은?", ["한라산"]],
    ["일반", "서울을 가로지르는 대표적인 강은?", ["한강"]],
    ["일반", "세계에서 가장 큰 대양은?", ["태평양"]],
    ["일반", "세계에서 가장 높은 산은?", ["에베레스트", "에베레스트산"]],
    ["일반", "지구에서 가장 큰 대륙은?", ["아시아"]],
    ["일반", "피라미드로 유명한 나라는?", ["이집트"]],
    ["일반", "에펠탑이 있는 나라는?", ["프랑스"]],
    ["일반", "만리장성이 있는 나라는?", ["중국"]],
    ["일반", "후지산이 있는 나라는?", ["일본"]],
    ["일반", "21 + 4 = ?", ["25"]],
    ["일반", "22 + 5 = ?", ["27"]],
    ["일반", "23 + 6 = ?", ["29"]],
    ["일반", "24 + 7 = ?", ["31"]],
    ["일반", "25 + 8 = ?", ["33"]],
    ["일반", "26 + 9 = ?", ["35"]],
    ["일반", "27 + 10 = ?", ["37"]],
    ["일반", "28 + 11 = ?", ["39"]],
    ["일반", "29 + 12 = ?", ["41"]],
    ["일반", "30 + 13 = ?", ["43"]],
    ["일반", "31 + 14 = ?", ["45"]],
    ["일반", "32 + 15 = ?", ["47"]],
    ["일반", "33 + 16 = ?", ["49"]],
    ["일반", "34 + 17 = ?", ["51"]],
    ["일반", "35 + 18 = ?", ["53"]],
    ["일반", "36 + 19 = ?", ["55"]],
    ["일반", "37 + 3 = ?", ["40"]],
    ["일반", "38 + 4 = ?", ["42"]],
    ["일반", "39 + 5 = ?", ["44"]],
    ["일반", "40 + 6 = ?", ["46"]],
    ["일반", "41 + 7 = ?", ["48"]],
    ["일반", "42 + 8 = ?", ["50"]],
    ["일반", "43 + 9 = ?", ["52"]],
    ["일반", "44 + 10 = ?", ["54"]],
    ["일반", "45 + 11 = ?", ["56"]],
    ["일반", "46 + 12 = ?", ["58"]],
    ["일반", "47 + 13 = ?", ["60"]],
    ["일반", "48 + 14 = ?", ["62"]],
    ["일반", "49 + 15 = ?", ["64"]],
    ["일반", "50 + 16 = ?", ["66"]],
    ["일반", "51 + 17 = ?", ["68"]],
    ["일반", "52 + 18 = ?", ["70"]],
    ["일반", "53 + 19 = ?", ["72"]],
    ["일반", "54 + 3 = ?", ["57"]],
    ["일반", "55 + 4 = ?", ["59"]],
    ["일반", "56 + 5 = ?", ["61"]],
    ["일반", "57 + 6 = ?", ["63"]],
    ["일반", "58 + 7 = ?", ["65"]],
    ["일반", "59 + 8 = ?", ["67"]],
    ["일반", "60 + 9 = ?", ["69"]],
    ["일반", "61 + 10 = ?", ["71"]],
    ["일반", "62 + 11 = ?", ["73"]],
    ["일반", "63 + 12 = ?", ["75"]],
    ["일반", "64 + 13 = ?", ["77"]],
    ["일반", "65 + 14 = ?", ["79"]],
    ["일반", "66 + 15 = ?", ["81"]],
    ["일반", "67 + 16 = ?", ["83"]],
    ["일반", "68 + 17 = ?", ["85"]],
    ["일반", "69 + 18 = ?", ["87"]],
    ["일반", "70 + 19 = ?", ["89"]],
    ["일반", "62 - 6 = ?", ["56"]],
    ["일반", "64 - 7 = ?", ["57"]],
    ["일반", "66 - 8 = ?", ["58"]],
    ["일반", "68 - 9 = ?", ["59"]],
    ["일반", "70 - 10 = ?", ["60"]],
    ["일반", "72 - 11 = ?", ["61"]],
    ["일반", "74 - 12 = ?", ["62"]],
    ["일반", "76 - 13 = ?", ["63"]],
    ["일반", "78 - 14 = ?", ["64"]],
    ["일반", "80 - 15 = ?", ["65"]],
    ["일반", "82 - 16 = ?", ["66"]],
    ["일반", "84 - 17 = ?", ["67"]],
    ["일반", "86 - 5 = ?", ["81"]],
    ["일반", "88 - 6 = ?", ["82"]],
    ["일반", "90 - 7 = ?", ["83"]],
    ["일반", "92 - 8 = ?", ["84"]],
    ["일반", "94 - 9 = ?", ["85"]],
    ["일반", "96 - 10 = ?", ["86"]],
    ["일반", "98 - 11 = ?", ["87"]],
    ["일반", "100 - 12 = ?", ["88"]],
    ["일반", "102 - 13 = ?", ["89"]],
    ["일반", "104 - 14 = ?", ["90"]],
    ["일반", "106 - 15 = ?", ["91"]],
    ["일반", "108 - 16 = ?", ["92"]],
    ["일반", "110 - 17 = ?", ["93"]],
    ["일반", "3 × 5 = ?", ["15"]],
    ["일반", "4 × 8 = ?", ["32"]],
    ["일반", "5 × 11 = ?", ["55"]],
    ["일반", "6 × 4 = ?", ["24"]],
    ["일반", "7 × 7 = ?", ["49"]],
    ["일반", "8 × 10 = ?", ["80"]],
    ["일반", "9 × 3 = ?", ["27"]],
    ["일반", "10 × 6 = ?", ["60"]],
    ["일반", "11 × 9 = ?", ["99"]],
    ["일반", "12 × 2 = ?", ["24"]],
    ["일반", "2 × 5 = ?", ["10"]],
    ["일반", "3 × 8 = ?", ["24"]],
    ["일반", "4 × 11 = ?", ["44"]],
    ["일반", "5 × 4 = ?", ["20"]],
    ["일반", "6 × 7 = ?", ["42"]],
    ["일반", "7 × 10 = ?", ["70"]],
    ["일반", "8 × 3 = ?", ["24"]],
    ["일반", "9 × 6 = ?", ["54"]],
    ["일반", "10 × 9 = ?", ["90"]],
    ["일반", "11 × 2 = ?", ["22"]],
    ["일반", "12 × 5 = ?", ["60"]],
    ["일반", "2 × 8 = ?", ["16"]],
    ["일반", "3 × 11 = ?", ["33"]],
    ["일반", "4 × 4 = ?", ["16"]],
    ["일반", "5 × 7 = ?", ["35"]],








































































































































































































];

function n(v){return Number(v||0).toLocaleString("ko-KR")}
function norm(s){return String(s||"").toLowerCase().replace(/\s+/g,"").replace(/[.,!?~'\"·]/g,"")}
function levelNeed(l){return l>=MAX_LEVEL?0:100+(l-1)*25}
function addXp(p,x){if(p.level>=MAX_LEVEL)return 0;p.xp+=x;let up=0;while(p.level<MAX_LEVEL&&p.xp>=levelNeed(p.level)){p.xp-=levelNeed(p.level);p.level++;up++}if(p.level>=MAX_LEVEL)p.xp=0;return up}
function nowK(){return new Date().toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}
function dayK(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function id(v){return v===undefined||v===null?"":String(v)}

function blankRoom(name){
  return {name:name||"",game:false,manage:false,jun:false,locked:false,players:{},attendance:{},quiz:null,quizQueue:[],lastQuiz:-1}
}
function fixRoom(d,name){
  d=d&&typeof d==="object"?d:blankRoom(name);
  d.name=name||d.name||"";
  d.game=!!d.game; d.manage=!!d.manage; d.jun=!!d.jun; d.locked=!!d.locked;
  d.players=d.players||{}; d.attendance=d.attendance||{};
  d.quizQueue=Array.isArray(d.quizQueue)?d.quizQueue:[];
  return d
}
function player(d,uid,name){
  let p=d.players[uid];
  if(!p)p=d.players[uid]={id:uid,name,points:0,level:1,xp:0,wins:0,lastFish:0,inventory:[],rods:["나무"],rod:"나무"};
  p.name=name||p.name;
  p.inventory=Array.isArray(p.inventory)?p.inventory:[];
  p.rods=Array.isArray(p.rods)?p.rods:["나무"];
  return p
}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function nextQuiz(d){if(!d.quizQueue.length)d.quizQueue=shuffle(QUIZZES.map((_,i)=>i));const i=d.quizQueue.shift();d.lastQuiz=i;return {i,q:QUIZZES[i]}}
function fishPick(luck){const arr=FISH_TABLE.map(f=>({...f,w:f.weight*Math.pow(luck,({일반:0,희귀:.2,영웅:.45,전설:.75,신화:1.1}[f.tier]||0))}));let x=Math.random()*arr.reduce((s,f)=>s+f.w,0);for(const f of arr){x-=f.w;if(x<=0)return f}return arr[0]}
function fishValue(f,size,luck){return Math.min(1000000,Math.max(1,Math.round(f.base*(.65+.7*(size-f.min)/Math.max(1,f.max-f.min))*Math.min(1.5,Math.sqrt(luck)))))}

async function initDb(){await pool.query(`
CREATE TABLE IF NOT EXISTS hz_rooms(room_id TEXT PRIMARY KEY,data JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS hz_members(room_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT,join_count INT NOT NULL DEFAULT 0,leave_count INT NOT NULL DEFAULT 0,last_profile_url TEXT,last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS hz_events(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT,event_type TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),meta JSONB NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS hz_warnings(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,target_id TEXT NOT NULL,target_name TEXT,count INT NOT NULL,reason TEXT NOT NULL,issuer_id TEXT NOT NULL,issuer_name TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),deleted_at TIMESTAMPTZ,deleted_by TEXT);
CREATE TABLE IF NOT EXISTS hz_profiles(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,user_id TEXT NOT NULL,old_name TEXT,new_name TEXT,old_profile_url TEXT,new_profile_url TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS hz_jun(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,user_id TEXT NOT NULL,user_name TEXT,item_name TEXT NOT NULL,value NUMERIC NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS hz_chat_stats(room_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT,chat_count BIGINT NOT NULL DEFAULT 0,first_chat_at TIMESTAMPTZ,last_chat_at TIMESTAMPTZ,PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS hz_jun_permissions(room_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT,granted_by TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS hz_deleted_messages(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,deleter_id TEXT,deleter_name TEXT,message_text TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),meta JSONB NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX IF NOT EXISTS hz_events_user_idx ON hz_events(room_id,user_id,id DESC);
CREATE INDEX IF NOT EXISTS hz_warn_user_idx ON hz_warnings(room_id,target_id,id);
CREATE INDEX IF NOT EXISTS hz_profile_user_idx ON hz_profiles(room_id,user_id,id DESC);
CREATE INDEX IF NOT EXISTS hz_jun_user_idx ON hz_jun(room_id,user_id,id DESC);
CREATE INDEX IF NOT EXISTS hz_chat_rank_idx ON hz_chat_stats(room_id,chat_count DESC);
`)}

async function withRoom(rid,rname,fn){
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    await c.query("INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING",[rid,JSON.stringify(blankRoom(rname))]);
    const q=await c.query("SELECT data FROM hz_rooms WHERE room_id=$1 FOR UPDATE",[rid]);
    const d=fixRoom(q.rows[0].data,rname);
    const out=await fn(d,c);
    await c.query("UPDATE hz_rooms SET data=$2::jsonb,updated_at=NOW() WHERE room_id=$1",[rid,JSON.stringify(d)]);
    await c.query("COMMIT");
    return out
  }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
}
async function roomFlags(rid){const q=await pool.query("SELECT data FROM hz_rooms WHERE room_id=$1",[rid]);return q.rows[0]?fixRoom(q.rows[0].data):blankRoom()}
function isManagerType(t){return Number(t)===1||Number(t)===4}
function isOwnerType(t){return Number(t)===1}
function isSubManagerType(t){return Number(t)===4}

function rawMentions(msg){
  const out=[],seen=new Set();
  function walk(v,k=""){
    if(!v||typeof v!=="object")return;
    if(Array.isArray(v)){for(const x of v)walk(x,k);return}
    const looksMention=k.toLowerCase().includes("mention")||("userId" in v)||("user_id" in v)||("memberId" in v);
    if(looksMention){
      const u=id(v.userId??v.user_id??v.memberId??v.id);
      const nm=v.name??v.nickname??v.nickName??v.displayName??v.memberName??v.text??"";
      if(u&&!seen.has(u)){seen.add(u);out.push({id:u,name:String(nm).replace(/^@/,"")})}
    }
    for(const [a,b] of Object.entries(v))if(typeof b==="object")walk(b,a)
  }
  walk(msg.raw); walk(msg.attachmentsRaw,"mentions"); walk(msg.message,"mentions");
  return out
}
function targetFrom(msg,text){
  const ms=rawMentions(msg);
  if(ms.length)return ms[0];
  const parts=String(text).trim().split(/\s+/);
  const candidate=parts.find(x=>/^\d{4,}$/.test(x));
  return candidate?{id:candidate,name:""}:null
}
async function resolveTarget(c,rid,t){
  if(!t)return null;
  if(t.name && t.name!==t.id && !/^\d+$/.test(t.name))return t;
  const q=await c.query("SELECT name FROM hz_members WHERE room_id=$1 AND user_id=$2",[rid,t.id]);
  if(q.rows[0]?.name)return {...t,name:q.rows[0].name};
  const q2=await c.query("SELECT name FROM hz_chat_stats WHERE room_id=$1 AND user_id=$2",[rid,t.id]);
  return {...t,name:q2.rows[0]?.name||t.name||t.id}
}
async function commandTarget(c,rid,msg,text){
  // 명령문에 보이는 @닉네임을 DB의 실제 user_id와 먼저 연결한다.
  const m=String(text||"").match(/@([^\s]+)/);
  if(m){
    const wanted=m[1].trim();
    const q=await c.query("SELECT user_id,name FROM hz_members WHERE room_id=$1 AND name=$2 ORDER BY last_seen DESC LIMIT 2",[rid,wanted]);
    if(q.rows.length===1)return {id:id(q.rows[0].user_id),name:q.rows[0].name};
    const q2=await c.query("SELECT user_id,name FROM hz_chat_stats WHERE room_id=$1 AND name=$2 ORDER BY last_chat_at DESC LIMIT 2",[rid,wanted]);
    if(q2.rows.length===1)return {id:id(q2.rows[0].user_id),name:q2.rows[0].name};
  }
  let t=targetFrom(msg,text);
  return t?await resolveTarget(c,rid,t):null;
}

function deepFindUserId(v, preferReply=false){
  let found="";
  function walk(x,key="",depth=0){
    if(found||!x||typeof x!=="object"||depth>8)return;
    if(Array.isArray(x)){for(const y of x)walk(y,key,depth+1);return}
    const k=String(key||"").toLowerCase();
    const replyish=/reply|quote|refer|origin|source/.test(k);
    if(!preferReply||replyish){
      const u=id(x.userId??x.user_id??x.memberId??x.senderId??x.authorId??x.id);
      if(u && /^\d+$/.test(u)){found=u;return}
    }
    for(const [a,b] of Object.entries(x)){
      if(typeof b==="object")walk(b,a,depth+1);
      if(found)return;
    }
  }
  walk(v,"",0);
  return found;
}

function replyTargetFrom(msg){
  // 답장/인용 메시지 쪽 데이터만 우선 탐색한다.
  const roots=[
    msg.message?.reply, msg.message?.quote, msg.message?.reference,
    msg.reply, msg.quote, msg.reference,
    msg.attachmentsRaw?.reply, msg.attachmentsRaw?.quote,
    msg.raw?.reply, msg.raw?.quote, msg.raw?.reference
  ].filter(Boolean);
  for(const r of roots){
    const u=deepFindUserId(r,false);
    if(u)return {id:u,name:""};
  }
  return null;
}

async function idCommandTarget(c,rid,msg,text){
  // 1순위: 명령어의 @닉네임/숫자 ID
  let t=await commandTarget(c,rid,msg,text);
  if(t)return t;
  // 2순위: 답장한 원본 메시지 작성자
  t=replyTargetFrom(msg);
  return t?await resolveTarget(c,rid,t):null;
}

async function lastJoinAt(c,rid,uid){
  const q=await c.query(
    "SELECT created_at FROM hz_events WHERE room_id=$1 AND user_id=$2 AND event_type='join' ORDER BY id DESC LIMIT 1",
    [rid,uid]
  );
  return q.rows[0]?.created_at||null;
}

async function activeWarningCount(c,rid,uid){
  const q=await c.query("SELECT COALESCE(SUM(count),0)::int AS total FROM hz_warnings WHERE room_id=$1 AND target_id=$2 AND deleted_at IS NULL",[rid,uid]);
  return Number(q.rows[0]?.total||0);
}
function extractProfile(raw){
  let best=null;
  function walk(v){
    if(!v||typeof v!=="object")return;
    if(Array.isArray(v)){v.forEach(walk);return}
    const uid=id(v.userId??v.user_id??v.memberId??v.id);
    const name=v.nickName??v.nickname??v.name??v.displayName;
    const url=v.openProfileUrl??v.open_profile_url??v.profileUrl??v.fullProfileImageUrl??v.profileImageUrl;
    if(uid&&(name||url))best={id:uid,name:name?String(name):"",url:url?String(url):""};
    for(const x of Object.values(v))if(typeof x==="object")walk(x)
  }
  walk(raw);return best
}


async function hasJunPermission(c,rid,uid){
  if(uid===globalBotId)return true;
  const q=await c.query("SELECT 1 FROM hz_jun_permissions WHERE room_id=$1 AND user_id=$2 LIMIT 1",[rid,uid]);
  return !!q.rows[0];
}
function pickDeleteRoom(evt){
  return id(evt?.room?.id??evt?.roomId??evt?.chat?.room?.id??evt?.chat?.roomId??evt?.channelId);
}
function pickDeleteActor(evt){
  const a=evt?.actor??evt?.deleter??evt?.sender??evt?.user??evt?.member??null;
  if(!a)return {id:"",name:""};
  const uid=id(a.id??a.userId??a.user_id??a.memberId??a.senderId);
  return {id:uid,name:String(a.name??a.nickname??a.nickName??a.displayName??uid??"")};
}
function pickDeletedText(evt){
  const vals=[evt?.message?.text,evt?.chat?.text,evt?.deletedMessage?.text,evt?.deletedChat?.text,evt?.originalMessage?.text,evt?.originalChat?.text,evt?.text,evt?.content];
  for(const v of vals)if(typeof v==="string"&&v.trim())return v.trim();
  return "";
}

function gameHelp(){return "🎮 HZ GAME | 게임 명령어\n게임 명령어를 확인하려면 더보기\n"+MORE+"\n!퀴즈 - 퀴즈 시작\n!정답 (답) - 정답 제출\n!낚시 - 2초간 낚시 후 결과\n!낚시정보 - 낚시 정보\n!인벤 - 잡은 물고기 전체 확인\n!물고기 도감 - 전체 물고기\n!포인트 - 코인 확인\n!내정보 - 내 게임/채팅 정보\n!레벨 - 레벨 확인\n!게임순위 - 포인트 순위\n!채팅순위 - 채팅 횟수 TOP 10\n!상점 - 낚시대 상점\n!낚시대구매 (이름) - 구매\n!낚시장착 (이름) - 장착\n!출석 - 오늘 출석\n!출석확인 @(멘션) 또는 해시 - 출석 확인\n!출석순위 - 오늘 출석 순위\n!준개 (아이템) (값) - 권한 보유자만 기록 추가\n!준개내역 - 내 준개 기록\n!준개내역삭제 (번호) - 내 기록 삭제\n!전체준개내역 - 전체 기록\n\n🔐 봇 계정 전용\n!게임작동 / !게임중지\n!준개작동 / !준개중지\n!준개권한추가 @(멘션) 또는 해시\n!준개권한삭제 @(멘션) 또는 해시\n!준개권한목록\n!봇작동 - 테러 잠금 해제\n!치트 (코인) @(멘션) 또는 해시"}
function manageHelp(){return "🛡️ HZ BOT | 관리 명령어\n관리 명령어를 확인하려면 더보기\n"+MORE+"\n!경고 @(멘션) (개수) (이유)\n!경고삭제 @(멘션) (경고 번호)\n!경고내역 @(멘션) 또는 해시\n!입퇴장로그 @(멘션) 또는 해시\n!프로필로그 @(멘션) 또는 해시\n!벤 - 상대 메시지에 답장해서 벤\n!벤 @(멘션) 또는 해시도 가능\n!아이디 @(멘션) - 대상 ID(해시) 확인\n답장 후 !아이디 - 답장 대상 ID(해시) 확인\n\n🤖 자동 관리\n같은 메시지/이모티콘 4회 연속: 자동 경고 1개\n같은 메시지/이모티콘 10회 연속: 자동 벤\n누적 활성 경고 4개: 자동 벤\n메시지 삭제 감지: 삭제자 확인 가능 시 자동 경고 1개\n부방장 60초 내 7명 강퇴: 봇 잠금\n\n🔐 봇 계정 전용\n!관리작동 / !관리중지\n!봇작동 - 테러 잠금 해제"}
async function send(chat,rid,text){if(text)await chat.sendText(rid,text)}

async function profileObserve(c,rid,uid,name,url){
  if(!uid)return;
  const q=await c.query("SELECT name,last_profile_url FROM hz_members WHERE room_id=$1 AND user_id=$2",[rid,uid]);
  if(!q.rows.length){await c.query("INSERT INTO hz_members(room_id,user_id,name,last_profile_url) VALUES($1,$2,$3,$4)",[rid,uid,name||uid,url||null]);return null}
  const old=q.rows[0],changed=(name&&old.name&&name!==old.name)||(url&&old.last_profile_url&&url!==old.last_profile_url);
  await c.query("UPDATE hz_members SET name=COALESCE(NULLIF($3,''),name),last_profile_url=COALESCE(NULLIF($4,''),last_profile_url),last_seen=NOW() WHERE room_id=$1 AND user_id=$2",[rid,uid,name||"",url||""]);
  if(changed){
    await c.query("INSERT INTO hz_profiles(room_id,user_id,old_name,new_name,old_profile_url,new_profile_url) VALUES($1,$2,$3,$4,$5,$6)",[rid,uid,old.name,name||old.name,old.last_profile_url,url||old.last_profile_url]);
    return {oldName:old.name,newName:name||old.name,oldUrl:old.last_profile_url,newUrl:url||old.last_profile_url}
  }
  return null
}

async function addChatCount(rid,uid,name){
  if(!uid||uid===globalBotId)return;
  await pool.query(`INSERT INTO hz_chat_stats(room_id,user_id,name,chat_count,first_chat_at,last_chat_at)
    VALUES($1,$2,$3,1,NOW(),NOW())
    ON CONFLICT(room_id,user_id) DO UPDATE SET
      name=EXCLUDED.name,
      chat_count=hz_chat_stats.chat_count+1,
      last_chat_at=NOW()`,[rid,uid,name||uid])
}
async function chatInfo(rid,uid){
  const q=await pool.query(`SELECT name,chat_count,first_chat_at,last_chat_at,
    (SELECT COUNT(*)+1 FROM hz_chat_stats b WHERE b.room_id=a.room_id AND b.chat_count>a.chat_count) AS rank
    FROM hz_chat_stats a WHERE room_id=$1 AND user_id=$2`,[rid,uid]);
  if(!q.rows.length)return {count:0,rank:null,days:0,avg:0};
  const r=q.rows[0],count=Number(r.chat_count||0);
  const first=new Date(r.first_chat_at),last=new Date(r.last_chat_at);
  const days=Math.max(1,Math.floor((last-first)/86400000)+1);
  return {count,rank:Number(r.rank),days,avg:count/days}
}
async function chatRanking(rid){
  return (await pool.query("SELECT user_id,name,chat_count FROM hz_chat_stats WHERE room_id=$1 AND user_id<>$2 ORDER BY chat_count DESC,last_chat_at ASC LIMIT 10",[rid,globalBotId])).rows
}

const spamState=new Map();
const kickBurst=new Map();

function messageFingerprint(msg,text){
  if(text)return "T:"+norm(text);
  try{
    const m=msg.message??msg.attachmentsRaw??msg.raw;
    if(m)return "M:"+JSON.stringify(m)
  }catch(_){}
  return ""
}
async function kickMember(msg,targetId){
  if(!globalChat) throw new Error("KakaoForge chat 객체가 준비되지 않았습니다.");
  if(!targetId) throw new Error("강퇴 대상 memberId가 없습니다.");
  return globalChat.openChatKick(msg.room.id,targetId);
}
async function autoSpamCheck(msg,chat,rid,uid,name,text,isSelf,flags){
  if(isSelf||!flags.manage||flags.locked||isOwnerType(msg.sender?.type))return false;
  const fp=messageFingerprint(msg,text);
  if(!fp)return false;
  const key=rid+":"+uid,old=spamState.get(key);
  const cur=old&&old.fp===fp?{fp,count:old.count+1}:{fp,count:1};
  spamState.set(key,cur);

  if(cur.count===4){
    await pool.query("INSERT INTO hz_warnings(room_id,target_id,target_name,count,reason,issuer_id,issuer_name) VALUES($1,$2,$3,1,$4,$5,$6)",
      [rid,uid,name,"동일 메시지/이모티콘 4회 연속 도배",globalBotId,"HZ BOT"]);
    const wc=await activeWarningCount(pool,rid,uid);
    await send(chat,rid,`⚠️ ${name}님 자동 경고 1개\n이유: 동일 메시지/이모티콘 4회 연속 도배\n현재 경고: ${wc}/4`);
    if(wc>=4){
      try{
        await kickMember(msg,uid);
        await send(chat,rid,`🚫 ${name}님이 경고 4개에 도달하여 자동 벤 처리되었습니다.`);
      }catch(e){console.error("[HZ WARNING BAN]",e);await send(chat,rid,`⚠️ ${name}님이 경고 4개에 도달했지만 자동 벤에 실패했습니다.`)}
      spamState.delete(key);
      return true;
    }
  }
  if(cur.count===10){
    try{
      await kickMember(msg,uid);
      await send(chat,rid,`🚫 ${name}님을 자동 벤 처리했습니다.\n이유: 동일 메시지/이모티콘 10회 연속 도배`);
    }catch(e){
      console.error("[HZ AUTO BAN]",e);
      await send(chat,rid,`⚠️ ${name}님의 10회 연속 도배를 감지했지만 자동 벤에 실패했습니다.`)
    }
    spamState.delete(key);
    return true
  }
  return false
}

async function handleGame(d,c,msg,isSelf){
  const text=String(msg.message?.text??msg.text??"").trim(),uid=id(msg.sender?.id??msg.senderId),name=String(msg.sender?.name||uid),p=player(d,uid,name),now=Date.now();
  if(text==="!명령어")return null;

  if(text==="!퀴즈"){if(d.quiz&&d.quiz.expiresAt>now)return `이미 퀴즈가 진행 중입니다!\n\n🧩 ${d.quiz.kind} 퀴즈\nQ. ${d.quiz.question}`;const {q}=nextQuiz(d);d.quiz={kind:q[0],question:q[1],answers:q[2],expiresAt:now+QUIZ_SECONDS*1000};return `🧩 ${q[0]} 퀴즈\n\nQ. ${q[1]}\n\n⏱ 제한 시간: ${QUIZ_SECONDS}초\n💰 첫 정답자: ${n(QUIZ_REWARD)}코인\n⭐ 경험치: +${QUIZ_XP}\n\n답변: !정답 (답)`}
  let m=/^!정답(?:\s+([\s\S]+))?$/.exec(text);if(m){if(!d.quiz)return "진행 중인 퀴즈가 없습니다.";if(now>=d.quiz.expiresAt){const a=d.quiz.answers[0];d.quiz=null;return `⏰ 시간이 지났습니다.\n정답: ${a}`}if(!m[1])return "사용법: !정답 (답)";if(!d.quiz.answers.some(a=>norm(a)===norm(m[1])))return "❌ 오답입니다.";const a=d.quiz.answers[0];d.quiz=null;p.points+=QUIZ_REWARD;p.wins++;const up=addXp(p,QUIZ_XP);return `🎉 ${name}님 정답!\n정답: ${a}\n💰 +${n(QUIZ_REWARD)}코인\n⭐ +${QUIZ_XP} XP${up?`\n⬆️ 레벨 ${p.level}`:""}\n보유: ${n(p.points)}코인`}
  if(text==="!낚시"){const remain=FISHING_COOLDOWN_SECONDS-Math.floor((now-p.lastFish)/1000);if(remain>0)return `🎣 아직 낚시 준비 중입니다. ${remain}초 후 다시 시도하세요.`;p.lastFish=now;const rod=RODS.find(x=>x.name===p.rod)||RODS[0],f=fishPick(rod.luck),size=Math.round((f.min+Math.random()*(f.max-f.min))*10)/10,value=fishValue(f,size,rod.luck);await send(globalChat,msg.room.id,"🎣 낚시를 시작합니다...\n\n🌊 물결을 살피는 중...\n🎣 찌가 움직이기 시작합니다!");await sleep(FISHING_WAIT_MS);p.points+=value;p.inventory.push({name:f.name,tier:f.tier,size,value,at:Date.now()});const up=addXp(p,FISHING_XP);return `🎣 낚시 성공!\n\n🐟 ${f.name} [${f.tier}]\n📏 ${size}cm\n💰 +${n(value)}코인\n⭐ +${FISHING_XP} XP${up?`\n⬆️ 레벨 ${p.level}`:""}`}
  if(text==="!낚시정보")return `🎣 낚시 정보\n쿨타임 ${FISHING_COOLDOWN_SECONDS}초 · 결과 대기 ${FISHING_WAIT_MS/1000}초\n장착 낚시대: ${p.rod}\n잡은 물고기: ${p.inventory.length}마리`;
  if(text==="!인벤"){if(!p.inventory.length)return "🎒 인벤토리가 비어 있습니다.";return "🎒 내 물고기 인벤토리\n"+p.inventory.map((x,i)=>`#${i+1} ${x.name} [${x.tier}] · ${x.size}cm · ${n(x.value)}코인`).join("\n")}
  if(text==="!물고기 도감")return "📖 물고기 도감\n"+FISH_TABLE.map(x=>`[${x.tier}] ${x.name} · ${x.min}~${x.max}cm`).join("\n");

  if(text==="!내정보"){
    if(isSelf)return `🤖 HZ BOT\n💰 코인: ∞\n⭐ Lv.${p.level}`;
    const s=await chatInfo(msg.room.id,uid);
    return `👤 ${name}님의 정보\n\n🏆 채팅 순위: ${s.rank?s.rank+"위":"기록 없음"}\n💬 총 채팅: ${n(s.count)}회\n📅 활동 일수: ${n(s.days)}일\n📊 일평균: ${s.avg.toFixed(1)}회\n\n💰 ${n(p.points)}코인\n⭐ Lv.${p.level} (${p.xp}/${levelNeed(p.level)} XP)\n🧩 정답 ${p.wins}회\n🐟 ${p.inventory.length}마리`
  }
  if(text==="!포인트")return isSelf?"🤖 HZ BOT\n💰 코인: ∞":`💰 ${name}님의 코인: ${n(p.points)}`;
  if(text==="!레벨"||text==="!퀴즈점수")return `👤 ${name}\n⭐ Lv.${p.level} (${p.xp}/${levelNeed(p.level)} XP)\n🧩 정답 ${p.wins}회`;

  if(text==="!채팅순위"){const a=await chatRanking(msg.room.id);return "💬 채팅 순위 TOP 10\n\n"+(a.length?a.map((x,i)=>`${i+1}위 ${x.name||x.user_id} · ${n(x.chat_count)}회`).join("\n"):"아직 채팅 기록이 없습니다.")}
  if(text==="!게임순위"||text==="!퀴즈순위"){const a=Object.values(d.players).filter(x=>x.id!==globalBotId).sort((a,b)=>b.points-a.points).slice(0,10);return "🏆 게임 순위\n"+(a.length?a.map((x,i)=>`${i+1}등 ${x.name} · ${n(x.points)}코인`).join("\n"):"아직 기록이 없습니다.")}
  if(text==="!상점")return "🛒 낚시대 상점\n"+RODS.map(x=>`${x.name} 낚시대 · ${n(x.price)}코인${p.rods.includes(x.name)?" [보유]":""}`).join("\n");

  m=/^!낚시대구매\s+(.+)$/.exec(text);if(m){const r=RODS.find(x=>x.name===m[1].trim());if(!r)return "존재하지 않는 낚시대입니다.";if(p.rods.includes(r.name))return "이미 보유한 낚시대입니다.";if(p.points<r.price&&!isSelf)return "코인이 부족합니다.";if(!isSelf)p.points-=r.price;p.rods.push(r.name);return `✅ ${r.name} 낚시대를 구매했습니다.`}
  m=/^!낚시장착\s+(.+)$/.exec(text);if(m){const x=m[1].trim();if(!p.rods.includes(x))return "보유하지 않은 낚시대입니다.";p.rod=x;return `🎣 ${x} 낚시대를 장착했습니다.`}
  if(text==="!출석"){const k=dayK(),a=d.attendance[k]||(d.attendance[k]=[]),i=a.findIndex(x=>x.id===uid);if(i>=0)return `${name}님은 이미 출석했습니다. ${i+1}등`;a.push({id:uid,name,time:nowK()});return `✅ ${name}님 출석 완료!\n오늘 ${a.length}번째입니다.`}
  if(text==="!출석순위"){const a=d.attendance[dayK()]||[];return "📅 오늘의 출석 순위\n"+(a.length?a.slice(0,10).map((x,i)=>`${i+1}등 ${x.name} · ${x.time}`).join("\n"):"아직 출석자가 없습니다.")}
  if(text.startsWith("!출석확인")){let t=targetFrom(msg,text);if(!t)return "사용법: !출석확인 @(멘션) 또는 해시";t=await resolveTarget(c,msg.room.id,t);const a=d.attendance[dayK()]||[],i=a.findIndex(x=>x.id===t.id);return i<0?`${t.name||t.id}님은 오늘 출석하지 않았습니다.`:`${a[i].name}님 출석 완료 · ${i+1}등 · ${a[i].time}`}
  m=/^!준개\s+(.+?)\s+([0-9]+(?:\.[0-9]+)?)$/.exec(text);
  if(m){
    if(!await hasJunPermission(c,msg.room.id,uid))return "⛔ 준개 사용 권한이 없습니다.";
    const item=m[1].trim(),value=Number(m[2]);
    if(!item)return "사용법: !준개 (아이템) (값)";
    if(!Number.isFinite(value)||value<0)return "준개 값은 0 이상의 숫자로 입력해주세요.";
    await c.query("INSERT INTO hz_jun(room_id,user_id,user_name,item_name,value) VALUES($1,$2,$3,$4,$5)",
      [msg.room.id,uid,name,item,value]);
    return `✅ 준개 저장 완료\n👤 ${name}\n📦 ${item}\n💰 ${value}`;
  }
  if(text==="!준개내역"){const q=await c.query("SELECT id,item_name,value,created_at FROM hz_jun WHERE room_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 1000",[msg.room.id,uid]);if(!q.rows.length)return "📦 준개 기록이 없습니다.";const vals=q.rows.map(x=>Number(x.value)),best=q.rows.reduce((a,b)=>Number(a.value)>=Number(b.value)?a:b);return `📊 준개내역\n${MORE}\n🏆 최고 준개: ${best.item_name} · ${best.value}\n📦 총 준개: ${q.rows.length}개\n📊 평균: ${(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2)}\n\n`+q.rows.map((x,i)=>`#${q.rows.length-i} | ${x.item_name} | ${x.value}`).join("\n")}
  m=/^!준개내역삭제\s+(\d+)$/.exec(text);if(m){const q=await c.query("SELECT id FROM hz_jun WHERE room_id=$1 AND user_id=$2 ORDER BY id ASC",[msg.room.id,uid]),idx=Number(m[1])-1;if(idx<0||idx>=q.rows.length)return "해당 번호의 기록이 없습니다.";await c.query("DELETE FROM hz_jun WHERE id=$1",[q.rows[idx].id]);return `🗑️ 준개내역 #${m[1]} 삭제 완료`}
  if(text==="!전체준개내역"){const q=await c.query("SELECT id,user_name,item_name,value FROM hz_jun WHERE room_id=$1 ORDER BY id DESC LIMIT 1000",[msg.room.id]);return q.rows.length?"📊 전체 준개내역\n"+MORE+"\n"+q.rows.map(x=>`#${x.id} | ${x.user_name} | ${x.item_name} | ${x.value}`).join("\n"):"준개 기록이 없습니다."}
  return null
}

async function handleManage(d,c,msg,isSelf){
  const text=String(msg.message?.text??msg.text??"").trim(),uid=id(msg.sender?.id??msg.senderId),name=String(msg.sender?.name||uid);
  if(!isManagerType(msg.sender?.type)&&!isSelf)return null;
  let t=await commandTarget(c,msg.room.id,msg,text),m;

  m=/^!경고\s+[\s\S]*?\s+(\d+)\s+(.+)$/.exec(text);
  if(m){
    if(!t)return "실제 멘션 또는 해시로 대상을 지정해주세요.";
    const cnt=Number(m[1]);if(cnt<1||cnt>100)return "경고 개수는 1~100으로 입력해주세요.";
    if(t.id===globalBotId)return "봇 계정에는 경고를 줄 수 없습니다.";
    await c.query("INSERT INTO hz_warnings(room_id,target_id,target_name,count,reason,issuer_id,issuer_name) VALUES($1,$2,$3,$4,$5,$6,$7)",[msg.room.id,t.id,t.name||t.id,cnt,m[2],uid,name]);
    const wc=await activeWarningCount(c,msg.room.id,t.id);
    if(wc>=4){
      try{
        await kickMember(msg,t.id);
        return `🚫 ${t.name||t.id}님이 경고 ${wc}개에 도달하여 자동 벤 처리되었습니다.\n마지막 사유: ${m[2]}`;
      }catch(e){console.error("[HZ WARNING BAN]",e);return `⚠️ ${t.name||t.id}님 경고 ${wc}개\n벤 기준에 도달했지만 강퇴에 실패했습니다.`}
    }
    return `⚠️ ${t.name||t.id}님에게 경고 ${cnt}개 지급\n이유: ${m[2]}\n현재 경고: ${wc}/4`;
  }
  m=/^!경고삭제\s+[\s\S]*?\s+(\d+)\s*$/.exec(text);
  if(m){if(!t)return "실제 멘션 또는 해시로 대상을 지정해주세요.";const q=await c.query("SELECT id FROM hz_warnings WHERE room_id=$1 AND target_id=$2 AND deleted_at IS NULL ORDER BY id ASC",[msg.room.id,t.id]),i=Number(m[1])-1;if(i<0||i>=q.rows.length)return "해당 경고 번호가 없습니다.";await c.query("UPDATE hz_warnings SET deleted_at=NOW(),deleted_by=$2 WHERE id=$1",[q.rows[i].id,uid]);return `🗑️ ${t.name||t.id}님의 ${m[1]}번째 경고 기록을 삭제했습니다.`}
  if(text.startsWith("!경고내역")){if(!t)return "사용법: !경고내역 @(멘션) 또는 해시";const q=await c.query("SELECT count,reason,issuer_name,created_at FROM hz_warnings WHERE room_id=$1 AND target_id=$2 AND deleted_at IS NULL ORDER BY id ASC",[msg.room.id,t.id]),sum=q.rows.reduce((s,x)=>s+x.count,0);return `⚠️ ${t.name||t.id} 경고: 총 ${sum}개\n${MORE}\n`+(q.rows.length?q.rows.map((x,i)=>`#${i+1} +${x.count} | ${x.reason} | ${x.issuer_name||"?"} | ${new Date(x.created_at).toLocaleString("ko-KR")}`).join("\n"):"경고 기록 없음")}
  if(text.startsWith("!입퇴장로그")){
    if(!t)return "사용법: !입퇴장로그 @(멘션) 또는 해시";
    const a=await c.query("SELECT join_count,leave_count,name FROM hz_members WHERE room_id=$1 AND user_id=$2",[msg.room.id,t.id]);
    const q=await c.query("SELECT event_type,created_at,name,meta FROM hz_events WHERE room_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 500",[msg.room.id,t.id]);
    const r=a.rows[0]||{join_count:0,leave_count:0,name:t.name};
    const latestJoin=q.rows.find(x=>x.event_type==="join");
    const came=latestJoin?new Date(latestJoin.created_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"기록 없음";
    return `🚪 ${r.name||t.name||t.id} 입퇴장 로그\n입장 ${r.join_count}회 · 퇴장 ${r.leave_count}회\n🕒 최근 입장: ${came}\n${MORE}\n`+
      (q.rows.length?q.rows.map(x=>{
        const actor=x.meta?.actorName||x.meta?.actor||"";
        const label=x.event_type==="join"?"입장":x.event_type==="leave"?"퇴장":"강퇴";
        return `${label}${x.event_type==="kick"&&actor?` | 실행자: ${actor}`:""} | ${new Date(x.created_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}`
      }).join("\n"):"기록 없음")
  }
  if(text.startsWith("!프로필로그")){if(!t)return "사용법: !프로필로그 @(멘션) 또는 해시";const q=await c.query("SELECT * FROM hz_profiles WHERE room_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 300",[msg.room.id,t.id]);return `👤 ${t.name||t.id} 프로필 로그\n${MORE}\n`+(q.rows.length?q.rows.map(x=>`${new Date(x.created_at).toLocaleString("ko-KR")}\n닉네임: ${x.old_name||"?"} → ${x.new_name||"?"}\n프로필: ${x.old_profile_url||"확인 불가"} → ${x.new_profile_url||"확인 불가"}`).join("\n────────\n"):"변경 기록 없음")}
  if(text==="!아이디"||text.startsWith("!아이디 ")){
    const it=await idCommandTarget(c,msg.room.id,msg,text);
    if(!it)return "사용법: !아이디 @(멘션)\n또는 상대 메시지에 답장한 뒤 !아이디";
    return `🔎 아이디 확인\n👤 ${it.name||it.id}\nHash/ID: ${it.id}`;
  }
  if(text.startsWith("!벤")){
    const replyBan=replyTargetFrom(msg);
    if(replyBan)t=await resolveTarget(c,msg.room.id,replyBan);
    if(!t)return "사용법: 상대 메시지에 답장 후 !벤\n또는 !벤 @(멘션) / 해시";
    if(t.id===globalBotId)return "봇 계정은 벤할 수 없습니다.";
    try{
      await kickMember(msg,t.id);
      return `🚫 ${t.name||t.id}님을 벤 처리했습니다.`
    }catch(e){
      console.error("[HZ BAN]",e);
      return `❌ ${t.name||t.id}님 강퇴 요청에 실패했습니다.`
    }
  }
  return null
}

let globalClient=null,globalChat=null,globalBotId="";

async function attachHZBot(client){
  globalClient=client;globalChat=client.chat||client;globalBotId=id(client.userId);await initDb();

  client.onMessage(async (...args)=>{
    try{
      const msg=args.length===1?args[0]:args[1];
      const chat=args.length===1?(client.chat||client):args[0];
      if(!msg?.room?.id)return;
      globalChat=chat;

      const rid=id(msg.room.id),rname=msg.room.name||"",uid=id(msg.sender?.id??msg.senderId),
        isSelf=uid===globalBotId,text=String(msg.message?.text??msg.text??"").trim(),
        name=String(msg.sender?.name||uid);

      if(!isSelf)await addChatCount(rid,uid,name);

      let flags=await roomFlags(rid);

      if(text==="!봇작동"){
        if(!isSelf)return;
        const out=await withRoom(rid,rname,async d=>{d.locked=false;d.game=true;d.manage=true;d.jun=true;return "✅ 봇 잠금이 해제되었습니다.\n🎮 게임 ON\n🛡️ 관리 ON\n📦 준개 ON"});
        await send(chat,rid,out);return
      }

      if(flags.locked){
        if(isSelf&&text==="!관리중지")return;
        return
      }

      if(!text.startsWith("!")){
        await autoSpamCheck(msg,chat,rid,uid,name,text,isSelf,flags);
        if(flags.manage){
          const pr=extractProfile(msg.raw);
          if(pr)await withRoom(rid,rname,async(d,c)=>{
            const ch=await profileObserve(c,rid,pr.id,pr.name,pr.url);
            if(ch)await send(chat,rid,`👤 ${ch.newName}님이 프로필을 변경했습니다.\n${MORE}\n이전 닉네임: ${ch.oldName||"?"}\n현재 닉네임: ${ch.newName||"?"}\n이전 프로필: ${ch.oldUrl||"확인 불가"}\n현재 프로필: ${ch.newUrl||"확인 불가"}\n시간: ${nowK()}`)
          })
        }
        return
      }

      const control=["!게임작동","!게임중지","!관리작동","!관리중지","!준개작동","!준개중지"];
      if(control.includes(text)){
        if(!isSelf)return;
        const out=await withRoom(rid,rname,async d=>{
          if(text==="!게임작동"){d.game=true;return "🎮 게임 기능이 작동되었습니다."}
          if(text==="!게임중지"){d.game=false;return "⏹️ 게임 기능이 중지되었습니다."}
          if(text==="!관리작동"){d.manage=true;return "🛡️ 관리 기능이 작동되었습니다."}
          if(text==="!관리중지"){d.manage=false;return "🛡️ 관리 기능이 중지되었습니다."}
           if(text==="!준개작동"){d.jun=true;return "📦 준개 기능이 작동되었습니다."}
           if(text==="!준개중지"){d.jun=false;return "📦 준개 기능이 중지되었습니다."}
        });
        await send(chat,rid,out);return
      }

      flags=await roomFlags(rid);
      if(text==="!명령어"){if(flags.game||flags.jun)await send(chat,rid,gameHelp());if(flags.manage)await send(chat,rid,manageHelp());return}

      if(text==="!준개권한목록"){
        if(!isSelf)return;
        const q=await pool.query("SELECT user_id,name FROM hz_jun_permissions WHERE room_id=$1 ORDER BY created_at ASC",[rid]);
        await send(chat,rid,q.rows.length?"📦 준개 권한 목록\n"+q.rows.map((x,i)=>`${i+1}. ${x.name||x.user_id} (${x.user_id})`).join("\n"):"📦 준개 권한을 가진 사람이 없습니다.");
        return
      }
      if(text.startsWith("!준개권한추가")||text.startsWith("!준개권한삭제")){
        if(!isSelf)return;
        const out=await withRoom(rid,rname,async(d,c)=>{
          let t=await commandTarget(c,rid,msg,text);
          if(!t)return "사용법: !준개권한추가 @(멘션) 또는 해시\n삭제: !준개권한삭제 @(멘션) 또는 해시";
          if(text.startsWith("!준개권한추가")){
            await c.query(`INSERT INTO hz_jun_permissions(room_id,user_id,name,granted_by) VALUES($1,$2,$3,$4)
              ON CONFLICT(room_id,user_id) DO UPDATE SET name=EXCLUDED.name,granted_by=EXCLUDED.granted_by`,
              [rid,t.id,t.name||t.id,globalBotId]);
            return `✅ ${t.name||t.id}님에게 준개 권한을 부여했습니다.`;
          }
          await c.query("DELETE FROM hz_jun_permissions WHERE room_id=$1 AND user_id=$2",[rid,t.id]);
          return `🗑️ ${t.name||t.id}님의 준개 권한을 삭제했습니다.`;
        });
        await send(chat,rid,out);return
      }

      if(text.startsWith("!치트")){
        if(!isSelf||!flags.game)return;
        const mm=/^!치트\s+([0-9]+)[\s\S]*$/.exec(text);
        let t=targetFrom(msg,text);
        if(!mm||!t){await send(chat,rid,"사용법: !치트 (코인) @(멘션) 또는 해시");return}
        const amount=Number(mm[1]);
        if(!Number.isSafeInteger(amount)||amount<1||amount>1000000000000){await send(chat,rid,"지급 코인은 1~1,000,000,000,000 범위로 입력해주세요.");return}
        const out=await withRoom(rid,rname,async(d,c)=>{t=await resolveTarget(c,rid,t);const p=player(d,t.id,t.name||t.id);p.points+=amount;return `💰 치트 지급 완료\n👤 ${p.name}\n💵 +${n(amount)}코인\n💰 현재 ${n(p.points)}코인\n🤖 봇 잔액: ∞`});
        await send(chat,rid,out);return
      }

      const out=await withRoom(rid,rname,async(d,c)=>{
        let r=null;
        if(flags.manage)r=await handleManage(d,c,msg,isSelf);
        if(r)return r;
        const isJunCommand=/^!(?:준개(?:\s|내역|내역삭제|$)|전체준개내역)/.test(text);
        if(isJunCommand){
          if(!flags.jun)return null;
          r=await handleGame(d,c,msg,isSelf);
          return r;
        }
        if(flags.game)r=await handleGame(d,c,msg,isSelf);
        return r
      });
      if(out)await send(chat,rid,out)
    }catch(e){console.error("[HZ BOT]",e)}
  });

  const memberEvent=type=>async ev=>{
    try{
      const rid=id(ev.room?.id);if(!rid)return;
      const f=await roomFlags(rid);if(!f.manage||f.locked)return;

      const ids=ev.member?.ids||ev.members?.map(x=>x.id)||[];
      const names=ev.member?.names||ev.members?.map(x=>x.name)||[];
      const actorId=id(ev.actor?.id??ev.actor?.userId??ev.actor?.memberId);
      const actorName=String((ev.actor?.name??ev.actor?.nickname??ev.actor?.nickName??actorId)||"알 수 없음");
      const actorType=Number(ev.actor?.type);

      for(let i=0;i<ids.length;i++){
        const uid=id(ids[i]),name=String(names[i]||uid);
        await pool.query(`INSERT INTO hz_members(room_id,user_id,name,join_count,leave_count)
          VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(room_id,user_id) DO UPDATE SET
          name=EXCLUDED.name,
          join_count=hz_members.join_count+EXCLUDED.join_count,
          leave_count=hz_members.leave_count+EXCLUDED.leave_count,
          last_seen=NOW()`,
          [rid,uid,name,type==="join"?1:0,(type==="leave"||type==="kick")?1:0]);

        await pool.query("INSERT INTO hz_events(room_id,user_id,name,event_type,meta) VALUES($1,$2,$3,$4,$5::jsonb)",
          [rid,uid,name,type,JSON.stringify({actorId:actorId||null,actorName:actorName||null,actorType:Number.isFinite(actorType)?actorType:null})]);

        if(type==="join"){
          const q=await pool.query("SELECT join_count,leave_count FROM hz_members WHERE room_id=$1 AND user_id=$2",[rid,uid]);
          const joins=Number(q.rows[0]?.join_count||0);
          const leaves=Number(q.rows[0]?.leave_count||0);
          const roomName=String(ev.room?.name||"이 방");
          const greeting=joins<=1
            ? `👋 안녕하세요, ${name}님!\n${roomName}에 오신 걸 환영합니다 🎉\n\n즐겁게 활동해 주세요!`
            : `👋 다시 오셨네요, ${name}님!\n${roomName}에 오신 걸 환영합니다 🎉\n\n즐겁게 활동해 주세요!`;
          await send(globalChat,rid,`${greeting}\n\n🕒 입장 시간: ${nowK()}\n🚪 입장 ${joins}회 · 퇴장 ${leaves}회`)
        }

        if(type==="kick"){
          await send(globalChat,rid,`🚨 강퇴 감지\n\n👮 실행자: ${actorName||"알 수 없음"}\n🚫 대상: ${name}\n🕒 시간: ${nowK()}`);

          if(actorId&&actorId!==globalBotId&&isSubManagerType(actorType)){
            const key=rid+":"+actorId,now=Date.now();
            const arr=(kickBurst.get(key)||[]).filter(t=>now-t<=60000);
            arr.push(now);kickBurst.set(key,arr);
            if(arr.length>=7){
              await withRoom(rid,ev.room?.name||"",async d=>{d.locked=true;d.game=false;d.manage=false});
              kickBurst.delete(key);
              await send(globalChat,rid,`🚨 테러 방어 작동\n\n${actorName}님이 60초 안에 7명을 강퇴했습니다.\n봇 기능을 잠갔습니다.\n\n🤖 봇 계정에서 !봇작동 입력 시 다시 작동합니다.`);
              return
            }
          }
        }
      }
    }catch(e){console.error("[HZ MEMBER]",e)}
  };

  client.onJoin(memberEvent("join"));
  client.onLeave(memberEvent("leave"));
  client.onKick(memberEvent("kick"));

  if(typeof client.onDelete==="function"){
    client.onDelete(async (...args)=>{
      try{
        const evt=args.length===1?args[0]:args[1];
        const chat=args.length===1?(client.chat||client):args[0];
        if(!evt)return;
        const rid=pickDeleteRoom(evt); if(!rid)return;
        const flags=await roomFlags(rid); if(!flags.manage||flags.locked)return;
        const actor=pickDeleteActor(evt), deletedText=pickDeletedText(evt);
        await pool.query("INSERT INTO hz_deleted_messages(room_id,deleter_id,deleter_name,message_text,meta) VALUES($1,$2,$3,$4,$5::jsonb)",
          [rid,actor.id||null,actor.name||null,deletedText||null,JSON.stringify({event:"delete"})]);
        await send(chat,rid,`🗑️ 메시지 삭제 감지\n\n👤 삭제자: ${actor.name||actor.id||"확인 불가"}\n💬 삭제된 내용: ${deletedText||"내용 확인 불가"}\n🕒 시간: ${nowK()}`);
        if(actor.id&&actor.id!==globalBotId){
          await pool.query("INSERT INTO hz_warnings(room_id,target_id,target_name,count,reason,issuer_id,issuer_name) VALUES($1,$2,$3,1,$4,$5,$6)",
            [rid,actor.id,actor.name||actor.id,"메시지 삭제",globalBotId,"HZ BOT"]);
          const wc=await activeWarningCount(pool,rid,actor.id);
          await send(chat,rid,`⚠️ ${actor.name||actor.id}님 자동 경고 1개\n이유: 메시지 삭제\n현재 경고: ${wc}/4`);
          if(wc>=4){
            try{await globalChat.openChatKick(rid,actor.id);await send(chat,rid,`🚫 ${actor.name||actor.id}님이 경고 ${wc}개에 도달하여 자동 벤 처리되었습니다.`)}
            catch(e){console.error("[HZ DELETE WARNING BAN]",e);await send(chat,rid,`⚠️ ${actor.name||actor.id}님이 경고 ${wc}개에 도달했지만 자동 벤에 실패했습니다.`)}
          }
        }
      }catch(e){console.error("[HZ DELETE]",e)}
    });
  }
  return {botUserId:globalBotId}
}

module.exports={attachHZBot,initDb};
