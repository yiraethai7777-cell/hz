'use strict';
// NEXI Pokémon: persistent exploration, capture, inventory and Pokédex info.
// Each room/user has isolated state. State changes and caught records are atomic.
const {getPool}=require('../shared/db');
const {BY_ID,BY_NAME,pickSpecies,catchChance,difficulty}=require('./pokemon-data');
const {sendCard}=require('./pokemon-image');
const MORE='\u200b'.repeat(1200);
const EXPLORE_SECONDS=60;
const EXPLORE_COOLDOWN_MS=20000;
const DAILY_BALLS=5;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const dayKey=ms=>new Date(ms).toISOString().slice(0,10);
const number=x=>Number(x).toLocaleString('ko-KR');
function userError(text){const error=new Error(text);error.userFacing=true;throw error;}
function identity(ctx){
 const room=String(ctx.roomId??''),user=String(ctx.userId??'');
 if(!/^\d+$/.test(room)||!/^\d+$/.test(user))userError('채팅방 또는 사용자 정보를 확인할 수 없습니다.');
 return {room,user,name:String(ctx.userName||'트레이너').slice(0,36)};
}
function formatEncounter({pokemon,level,balls}){
 return '⚡ NEXI | 야생 포켓몬 발견!\n\n'+
  '야생 '+pokemon.name+'가 나타났습니다!\n'+
  '📖 도감번호 · No.'+String(pokemon.id).padStart(3,'0')+'\n'+
  '✨ 타입 · '+pokemon.type+'\n'+
  '⭐ 레벨 · Lv.'+level+'\n'+
  '🎯 포획 난이도 · '+difficulty(pokemon)+'\n'+
  '⏳ 포획 가능 시간 · 60초\n'+
  '🎒 몬스터볼 · '+balls+'개 보유\n\n'+
  '👉 !포획 으로 잡아보세요!';
}
function formatCapture({pokemon,level,iv,balls,success}){
 if(!success)return '💨 NEXI | 포획 실패\n'+pokemon.name+'이(가) 몬스터볼에서 빠져나갔습니다.\n🎒 남은 몬스터볼 · '+balls+'개\n🔎 !탐색으로 다시 도전하세요.';
 return '✅ NEXI | 포획 성공!\n'+pokemon.name+' · Lv.'+level+
  '\n🎯 개체값 · '+iv+'%\n🎒 남은 몬스터볼 · '+balls+
  '개\n📦 !인벤에서 확인할 수 있습니다.';
}
function createPokemon({pool=getPool(),now=Date.now,random=Math.random,sleep=wait,photo=sendCard}={}){
 async function init(){
  await pool.query(`CREATE TABLE IF NOT EXISTS gl_pokemon_players(
   room_id TEXT NOT NULL,user_id TEXT NOT NULL,
   balls INTEGER NOT NULL DEFAULT 5 CHECK(balls>=0),
   daily_marker TEXT NOT NULL DEFAULT '',
   encounter_no INTEGER,encounter_level INTEGER,encounter_until TIMESTAMPTZ,
   last_explore_at TIMESTAMPTZ,
   PRIMARY KEY(room_id,user_id));`);
  await pool.query(`CREATE TABLE IF NOT EXISTS gl_pokemon_catches(
   id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,user_id TEXT NOT NULL,
   pokemon_no INTEGER NOT NULL,level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 100),
   iv INTEGER NOT NULL CHECK(iv BETWEEN 0 AND 100),
   caught_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await pool.query(`CREATE INDEX IF NOT EXISTS gl_pokemon_catches_owner
   ON gl_pokemon_catches(room_id,user_id,id DESC);`);
  await pool.query(`CREATE TABLE IF NOT EXISTS gl_pokemon_actions(
   room_id TEXT NOT NULL,message_id TEXT NOT NULL,
   action TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   PRIMARY KEY(room_id,message_id));`);
 }
 async function withPlayer(ctx,action){
  const {room,user,name}=identity(ctx);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const current=now(),today=dayKey(current);
   await db.query('INSERT INTO gl_pokemon_players(room_id,user_id,daily_marker) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
    [room,user,today]);
   const selected=await db.query('SELECT * FROM gl_pokemon_players WHERE room_id=$1 AND user_id=$2 FOR UPDATE',[room,user]);
   const p=selected.rows[0];
   if(!p)throw Error('Pokemon account missing');
   if(p.daily_marker!==today){
    // Refresh up to five daily free balls, keeping any excess for future shop items.
    p.balls=Math.max(DAILY_BALLS,Number(p.balls));
    p.daily_marker=today;
    await db.query('UPDATE gl_pokemon_players SET balls=$3,daily_marker=$4 WHERE room_id=$1 AND user_id=$2',
     [room,user,p.balls,today]);
   }
   if(action==='explore'||action==='capture'){
    const id=ctx.messageId??require('./coin').messageKey(ctx.msg||{});
    if(id==null)userError('메시지 고유번호를 확인하지 못했습니다. 다시 시도해 주세요.');
    const claimed=await db.query('INSERT INTO gl_pokemon_actions(room_id,message_id,action) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING message_id',
     [room,String(id),action]);
    if(!claimed.rowCount)userError('이미 처리된 명령어입니다.');
   }
   let output;
   if(action==='explore'){
    const until=p.encounter_until?new Date(p.encounter_until).getTime():0;
    if(p.encounter_no&&until>current){
     const pokemon=BY_ID.get(Number(p.encounter_no));
     output={kind:'already',text:'🔎 이미 야생 '+(pokemon?.name||'포켓몬')+'을(를) 발견했습니다.\n⏳ 남은 시간 · '+Math.ceil((until-current)/1000)+'초\n👉 !포획으로 잡아보세요!'};
    }else{
     const last=p.last_explore_at?new Date(p.last_explore_at).getTime():0;
     const remaining=EXPLORE_COOLDOWN_MS-(current-last);
     if(last>0&&remaining>0)output={kind:'cooldown',text:'🔎 탐색 준비 중입니다. '+Math.ceil(remaining/1000)+'초 후 다시 시도해 주세요.'};
     else{
      const pokemon=pickSpecies(random),level=Math.floor(random()*16)+5;
      await db.query('UPDATE gl_pokemon_players SET encounter_no=$3,encounter_level=$4,encounter_until=$5,last_explore_at=$6 WHERE room_id=$1 AND user_id=$2',
       [room,user,pokemon.id,level,new Date(current+EXPLORE_SECONDS*1000),new Date(current)]);
      output={kind:'explore',pokemon,level,balls:Number(p.balls),text:formatEncounter({pokemon,level,balls:Number(p.balls)})};
     }
    }
   }else if(action==='capture'){
    const until=p.encounter_until?new Date(p.encounter_until).getTime():0;
    if(!p.encounter_no||until<=current){
     if(p.encounter_no)await db.query('UPDATE gl_pokemon_players SET encounter_no=NULL,encounter_level=NULL,encounter_until=NULL WHERE room_id=$1 AND user_id=$2',[room,user]);
     output={kind:'none',text:'🌳 포획할 야생 포켓몬이 없습니다.\n먼저 !탐색을 입력해 주세요.'};
    }else if(Number(p.balls)<=0){
     output={kind:'no-balls',text:'🎒 몬스터볼이 없습니다.\n매일 무료 몬스터볼 5개가 보충됩니다.'};
    }else{
     const pokemon=BY_ID.get(Number(p.encounter_no));
     if(!pokemon)throw Error('Pokemon encounter roster missing');
     const level=Number(p.encounter_level),balls=Number(p.balls)-1;
     const success=random()<catchChance(pokemon,level);
     const iv=Math.floor(random()*51)+50;
     await db.query('UPDATE gl_pokemon_players SET balls=$3,encounter_no=NULL,encounter_level=NULL,encounter_until=NULL WHERE room_id=$1 AND user_id=$2',
      [room,user,balls]);
     if(success)await db.query('INSERT INTO gl_pokemon_catches(room_id,user_id,pokemon_no,level,iv) VALUES($1,$2,$3,$4,$5)',
      [room,user,pokemon.id,level,iv]);
     output={kind:'capture',pokemon,level,balls,success,iv,text:formatCapture({pokemon,level,balls,iv,success})};
    }
   }else throw Error('Unsupported Pokemon action');
   await db.query('COMMIT');
   return output;
  }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
  finally{db.release();}
 }
 async function inventory(ctx){
  const {room,user}=identity(ctx);
  const data=await pool.query('SELECT pokemon_no,level,iv FROM gl_pokemon_catches WHERE room_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 100',[room,user]);
  const count=await pool.query('SELECT COUNT(*)::integer AS total FROM gl_pokemon_catches WHERE room_id=$1 AND user_id=$2',[room,user]);
  const player=await pool.query('SELECT balls,daily_marker FROM gl_pokemon_players WHERE room_id=$1 AND user_id=$2',[room,user]);
  const balls=player.rows[0]?Math.max(Number(player.rows[0].balls),player.rows[0].daily_marker===dayKey(now())?0:DAILY_BALLS):DAILY_BALLS;
  const rows=data.rows.map((x,i)=>{
   const pokemon=BY_ID.get(Number(x.pokemon_no));
   return (i+1)+'. '+(pokemon?.name||'No.'+x.pokemon_no)+' · Lv.'+x.level+' · 개체값 '+x.iv+'%';
  });
  const total=Number(count.rows[0]?.total||0);
  return '🎒 NEXI | 포켓몬 인벤\n📦 보유 포켓몬 · '+number(total)+'마리\n⚪ 몬스터볼 · '+balls+'개\n'+
   (rows.length?MORE+'\n'+rows.join('\n')+
    (total>rows.length?'\n…최근 100마리까지만 표시됩니다.':''):'\n아직 잡은 포켓몬이 없습니다.\n!탐색으로 발견해 보세요.');
 }
 async function info(ctx,name){
  const pokemon=BY_NAME.get(name);
  if(!pokemon)return {error:'📖 등록된 포켓몬 이름을 찾을 수 없습니다.\n예: !포켓봇정보 피카츄'};
  const {room,user}=identity(ctx);
  const caught=await pool.query('SELECT COUNT(*)::integer AS total FROM gl_pokemon_catches WHERE room_id=$1 AND user_id=$2 AND pokemon_no=$3',
   [room,user,pokemon.id]);
  const owned=Number(caught.rows[0]?.total||0);
  return {pokemon,owned,text:'📖 NEXI | 포켓몬 정보\n'+pokemon.name+' · No.'+String(pokemon.id).padStart(3,'0')+
   '\n✨ 타입 · '+pokemon.type+'\n⭐ 희귀도 · '+pokemon.rarity+
   '\n🎯 포획 난이도 · '+difficulty(pokemon)+'\n🎒 내가 보유한 수 · '+owned+'마리'};
 }
 async function photoOrText(ctx,client,pokemon,fields,text){
  // Show the encounter details immediately; only the unmodified sprite is uploaded.
  // No generated card, rendering delay, or duplicate fallback message.
  await ctx.send(text);
  try{
   await photo({client,roomId:ctx.roomId,pokemon,...fields});
  }catch(error){
   console.warn('[NEXI POKEMON PHOTO]',String(error?.message||error));
  }
 }
 async function updateProgress(ctx,receipt,text){
  const edit=typeof ctx.chat?.editMessage==='function'?
   ctx.chat.editMessage.bind(ctx.chat):
   typeof ctx.client?.chat?.editMessage==='function'?
    ctx.client.chat.editMessage.bind(ctx.client.chat):
    typeof ctx.client?.editMessage==='function'?ctx.client.editMessage.bind(ctx.client):null;
  const logId=receipt?.body?.logId??receipt?.logId;
  if(edit&&logId!=null&&String(logId)!=='0'){
   try{
    const result=await edit(ctx.roomId,logId,text);
    if(result!==false&&result?.success!==false&&Number(result?.status??result?.body?.status??0)===0)return;
   }catch(error){console.warn('[NEXI POKEMON EDIT]',String(error?.message||error));}
  }
  await ctx.send(text);
 }
 async function handle(ctx,client){
  const text=String(ctx.text||'').trim(),command=text.split(/\s+/,1)[0];
  try{
   if(command==='#탐색'){
    if(text!=='#탐색'){await ctx.send('사용법: !탐색');return true;}
    const result=await withPlayer(ctx,'explore');
    if(result.kind!=='explore'){await ctx.send(result.text);return true;}
    await photoOrText(ctx,client,result.pokemon,{level:result.level,balls:result.balls,mode:'explore'},result.text);
    return true;
   }
   if(command==='#포획'){
    if(text!=='#포획'){await ctx.send('사용법: !포획');return true;}
    const result=await withPlayer(ctx,'capture');
    if(result.kind!=='capture'){await ctx.send(result.text);return true;}
    if(result.success)await photoOrText(ctx,client,result.pokemon,{level:result.level,balls:result.balls,iv:result.iv,mode:'caught'},result.text);
    else await ctx.send(result.text);
    return true;
   }
   if(command==='#포켓봇정보'||command==='#포켓몬정보'){
    const name=text.slice(command.length).trim();
    if(!name){await ctx.send('사용법: !포켓봇정보 (포켓몬 이름)\n예: !포켓봇정보 피카츄');return true;}
    const result=await info(ctx,name);
    if(result.error){await ctx.send(result.error);return true;}
    await photoOrText(ctx,client,result.pokemon,{level:1,owned:result.owned,mode:'info'},result.text);
    return true;
   }
   return false;
  }catch(error){
   if(!error.userFacing)console.error('[NEXI POKEMON]',String(error?.message||error));
   await ctx.send(error.userFacing?'❌ '+error.message:'❌ 포켓몬 처리 중 오류가 발생했습니다.');
   return true;
  }
 }
 return {init,withPlayer,inventory,info,handle};
}
let instance;
const service=()=>instance||=(createPokemon());
module.exports={createPokemon,init:()=>service().init(),
 handle:(ctx,client)=>service().handle(ctx,client),
 inventory:ctx=>service().inventory(ctx),formatEncounter,formatCapture,EXPLORE_SECONDS};
