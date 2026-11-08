'use strict';
const {getPool}=require('../shared/db'),{ensureWallet}=require('./wallet');
const {ORES,PICKS,LOCATIONS,state,odds,pick,owned}=require('./mining-rules');
const {normalize}=require('./command-text');
const COOLDOWN=20000,FOLD='\u200b'.repeat(1200);
async function init(pool=getPool()){
 await pool.query(`CREATE TABLE IF NOT EXISTS hz_mining_players(room_id TEXT NOT NULL,user_id TEXT NOT NULL,bag JSONB NOT NULL DEFAULT '{}'::jsonb,last_mined_at BIGINT,total_mined BIGINT NOT NULL DEFAULT 0,PRIMARY KEY(room_id,user_id));
 CREATE TABLE IF NOT EXISTS hz_mining_actions(room_id TEXT NOT NULL,message_id TEXT NOT NULL,user_id TEXT NOT NULL,command TEXT NOT NULL,result TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,message_id));
 ALTER TABLE hz_mining_players ADD COLUMN IF NOT EXISTS pick_level INTEGER NOT NULL DEFAULT 0 CHECK(pick_level BETWEEN 0 AND 5);
 ALTER TABLE hz_mining_players ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '광산입구';
 ALTER TABLE hz_mining_players ADD COLUMN IF NOT EXISTS owned_picks JSONB;
 UPDATE hz_mining_players SET owned_picks=(SELECT jsonb_agg(value ORDER BY value) FROM generate_series(0,pick_level) AS previous(value)) WHERE owned_picks IS NULL;
 ALTER TABLE hz_mining_players ALTER COLUMN owned_picks SET DEFAULT '[0]'::jsonb;
 ALTER TABLE hz_mining_players ALTER COLUMN owned_picks SET NOT NULL;`);
 console.log('[NEXI MINING SCHEMA] pick ownership ready');
}
function guide(p={}){const st=state(p),chances=odds(p);return '⛏ NEXI | 광산\n'+st.location.name+' · '+PICKS[st.level].name+' 곡괭이\n!채굴 · !채굴지 · !상점 곡괭이\n'+FOLD+'\n━━━━━\n20초마다 1~3개 채굴\n'+ORES.map((o,i)=>o.icon+' '+o.name+' · '+(chances[i]*100).toFixed(2)+'% · '+o.price.toLocaleString('ko-KR')+'코인/개').join('\n')+'\n!광물인벤 · !광물판매 전체';}
function createMining({pool=getPool(),random=Math.random,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),link=(room,user,name)=>require('./economy').ensureLinked(room,user,name)}={}){
 async function execute(ctx){
  const [command,...args]=normalize(ctx.text).split(/\s+/),room=String(ctx.roomId),user=String(ctx.userId);
  if(!/^[1-9]\d*$/.test(room)||!/^[1-9]\d*$/.test(user))throw Error('사용자와 채팅방을 확인할 수 없습니다.');
  const read=async()=>((await pool.query('SELECT * FROM hz_mining_players WHERE room_id=$1 AND user_id=$2',[room,user])).rows[0]||{bag:{},total_mined:0,pick_level:0,location:LOCATIONS[0].name});
  if(command==='#광산'&&!args.length)return guide(await read());
  if(command==='#곡괭이강화')return '곡괭이는 상점에서 구매합니다.\n!상점 곡괭이 · !곡괭이구매 돌';
  if(command==='#곡괭이'&&!args.length){const p=await read(),st=state(p);return '⛏ NEXI | 내 곡괭이\n장착 · '+PICKS[st.level].name+' 곡괭이\n보유 · '+owned(p).map(i=>PICKS[i].name).join(', ')+'\n!곡괭이구매 (이름) · !곡괭이장착 (이름)';}
  if(command==='#채굴지'&&!args.length){const st=state(await read());return '📍 NEXI | 채굴 장소\n현재 · '+st.location.name+'\n━━━━━\n'+LOCATIONS.map(l=>l.name+' · '+(st.level>=l.level?'이동 가능':PICKS[l.level].name+' 곡괭이 필요')).join('\n')+'\n!채굴지 깊은동굴\n깊은 장소일수록 희귀 광물 확률이 올라갑니다.';}
  if(command==='#광물인벤'&&!args.length){
   const r=await pool.query('SELECT * FROM hz_mining_players WHERE room_id=$1 AND user_id=$2',[room,user]),p=r.rows[0]||{bag:{},total_mined:0};
   let value=0n;const lines=ORES.map(o=>{const n=Number(p.bag[o.name]||0);value+=BigInt(n)*BigInt(o.price);return o.icon+' '+o.name+' · '+n.toLocaleString('ko-KR')+'개';});
   return '⛏ NEXI | 광물 인벤\n'+PICKS[state(p).level].name+' 곡괭이 · '+state(p).location.name+'\n'+FOLD+'\n'+lines.join('\n')+'\n━━━━━\n전체 판매가 · '+value.toLocaleString('ko-KR')+'코인\n누적 채굴 · '+BigInt(p.total_mined).toLocaleString('ko-KR')+'개\n!채굴 · !광물판매 전체';
  }
  if(!['#채굴','#광물판매','#곡괭이구매','#곡괭이장착','#채굴지'].includes(command))throw Error('사용법: !광산 · !채굴 · !광물인벤 · !광물판매 전체');
  if(command==='#채굴'&&args.length)throw Error('사용법: !채굴');
  for(let i=0;i<args.length;i++)args[i]=args[i].replace(/\*/g,'');
  const all=command==='#광물판매'&&(!args.length||args.length===1&&['전체','전부','all'].includes(args[0].toLowerCase())),selected=ORES.find(o=>o.name===args[0]);
  const targetPick=['#곡괭이구매','#곡괭이장착'].includes(command)?PICKS.findIndex(v=>v.name===args.join('').replace(/곡괭이$/,'').replace(/^다이아몬드$/,'다이아')):-1;
  if(['#곡괭이구매','#곡괭이장착'].includes(command)&&targetPick<0)throw Error('곡괭이 이름을 확인해 주세요. !상점 곡괭이');
  const destination=command==='#채굴지'?LOCATIONS.find(l=>l.name===args.join('')):null;
  if(command==='#채굴지'&&!destination)throw Error('이동할 장소를 확인해 주세요. !채굴지');
  if(command==='#광물판매'&&!all&&(!selected||args.length!==2||!/^[1-9]\d{0,8}$/.test(args[1])))throw Error('사용법: !광물판매 전체 또는 !광물판매 철광석 2');
  const message=ctx.messageId??(ctx.msg?require('./coin').messageKey(ctx.msg):null);if(!message)throw Error('메시지 번호를 확인할 수 없습니다. 다시 입력해 주세요.');
  if(['#광물판매','#곡괭이구매'].includes(command))await link(room,user,ctx.userName);
  const db=await pool.connect();try{
   await db.query('BEGIN');
   const claimed=await db.query('INSERT INTO hz_mining_actions(room_id,message_id,user_id,command) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING message_id',[room,String(message),user,command]);if(!claimed.rowCount)throw Error('이미 처리된 명령입니다.');
   await db.query('INSERT INTO hz_mining_players(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[room,user]);
   const p=(await db.query('SELECT * FROM hz_mining_players WHERE room_id=$1 AND user_id=$2 FOR UPDATE',[room,user])).rows[0],bag={...p.bag};let text;
   if(command==='#채굴'){
    const time=now();
    if(p.last_mined_at!==null&&time-Number(p.last_mined_at)<COOLDOWN)throw Error('⏳ 다음 채굴까지 '+Math.ceil((COOLDOWN-time+Number(p.last_mined_at))/1000)+'초 남았습니다.');
    const ore=pick(random,p),quantity=1+Math.min(2,Math.floor(random()*3));bag[ore.name]=(bag[ore.name]||0)+quantity;
    await db.query('UPDATE hz_mining_players SET bag=$3::jsonb,last_mined_at=$4,total_mined=total_mined+$5 WHERE room_id=$1 AND user_id=$2',[room,user,JSON.stringify(bag),String(time),quantity]);
    text='⛏ NEXI | 채굴 성공\n'+ore.icon+' '+ore.name+' × '+quantity+'\n'+(ore.tier>=3?'✨ 희귀 광맥을 발견했습니다!\n':'')+'📍 '+state(p).location.name+' · '+PICKS[state(p).level].name+' 곡괭이\n다음 채굴 20초 · !광물인벤';
   }else if(command==='#곡괭이구매'){
    const current=state(p).level,items=owned(p),item=PICKS[targetPick];if(items.includes(targetPick))throw Error('이미 보유한 곡괭이입니다. !곡괭이장착 '+item.name);
    await ensureWallet(db,room,user,ctx.userName||user);
    const debit=await db.query('UPDATE hz_wallets SET balance=balance-$3::numeric WHERE room_id=$1 AND user_id=$2 AND balance>=$3::numeric RETURNING balance',[room,user,item.cost]);if(!debit.rowCount)throw Error('구매 비용 '+BigInt(item.cost).toLocaleString('ko-KR')+'코인이 필요합니다.');
    await db.query('INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail) VALUES($1,$2,$3,$4,$5)',[room,user,'MINING_PICK_PURCHASE','-'+item.cost,'mining:'+String(message)]);
    items.push(targetPick);const equip=Math.max(current,targetPick);
    await db.query('UPDATE hz_mining_players SET pick_level=$3,owned_picks=$4::jsonb WHERE room_id=$1 AND user_id=$2',[room,user,equip,JSON.stringify(items.sort((a,b)=>a-b))]);
    text='⛏ NEXI | 곡괭이 구매 완료\n'+item.name+' 곡괭이 · '+BigInt(item.cost).toLocaleString('ko-KR')+'코인\n장착 · '+PICKS[equip].name+' 곡괭이'+(equip===targetPick?' (자동 장착)':'')+'\n!채굴 · !채굴지';
   }else if(command==='#곡괭이장착'){
    if(!owned(p).includes(targetPick))throw Error('보유하지 않은 곡괭이입니다. !상점 곡괭이');
    const location=LOCATIONS.find(l=>l.name===p.location&&l.level<=targetPick)||LOCATIONS[0];
    await db.query('UPDATE hz_mining_players SET pick_level=$3,location=$4 WHERE room_id=$1 AND user_id=$2',[room,user,targetPick,location.name]);
    text='⛏ '+PICKS[targetPick].name+' 곡괭이 장착\n📍 '+location.name;
   }else if(command==='#채굴지'){
    if(state(p).level<destination.level)throw Error(PICKS[destination.level].name+' 곡괭이를 장착하면 이동할 수 있습니다.');
    await db.query('UPDATE hz_mining_players SET location=$3 WHERE room_id=$1 AND user_id=$2',[room,user,destination.name]);text='📍 채굴 장소 변경 · '+destination.name+'\n!광산에서 현재 확률을 확인하세요.';
   }else{
    let coins=0n,total=0;for(const ore of all?ORES:[selected]){const owned=Number(bag[ore.name]||0),quantity=all?owned:Number(args[1]);if(owned<quantity)throw Error('보유 광물이 부족합니다.');coins+=BigInt(quantity)*BigInt(ore.price);total+=quantity;bag[ore.name]=owned-quantity;}
    if(!coins)throw Error('판매할 광물이 없습니다. !채굴로 광물을 모아 주세요.');
    await ensureWallet(db,room,user,ctx.userName||user);
    const credited=await db.query('UPDATE hz_wallets SET balance=balance+$3::numeric WHERE room_id=$1 AND user_id=$2 RETURNING balance',[room,user,String(coins)]);if(!credited.rowCount)throw Error('지갑 반영에 실패했습니다.');
    await db.query('INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail) VALUES($1,$2,$3,$4,$5)',[room,user,'MINERAL_SALE',String(coins),'mining:'+String(message)]);
    await db.query('UPDATE hz_mining_players SET bag=$3::jsonb WHERE room_id=$1 AND user_id=$2',[room,user,JSON.stringify(bag)]);
    text='🪙 NEXI | 광물 판매\n'+total.toLocaleString('ko-KR')+'개 판매 · +'+coins.toLocaleString('ko-KR')+'코인\n!정보에서 잔액을 확인하세요.';
   }
   await db.query('UPDATE hz_mining_actions SET result=$3 WHERE room_id=$1 AND message_id=$2',[room,String(message),text]);await db.query('COMMIT');return text;
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
 }
 return {execute,handle:async ctx=>{if(!/^#(?:광산|채굴|광물인벤|광물판매|곡괭이|곡괭이강화|곡괭이구매|곡괭이장착|채굴지)(?:\s|$)/.test(normalize(ctx.text)))return false;const started=Date.now();let result;try{result=await execute(ctx);}catch(e){console.warn('[NEXI MINING]',{command:ctx.text.split(/\s/)[0],code:e.code||'REJECTED',reason:e.code?undefined:e.message});result=e.code?'❌ 채굴 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.':'❌ '+e.message;}if(result.startsWith('⛏ NEXI | 채굴 성공\n'))await require('./mining-progress').send(ctx,result,wait);else await ctx.send(result);console.log('[NEXI MINING TIMING]',{elapsedMs:Date.now()-started});return true;}};
}
let service;module.exports={ORES,init,createMining,guide,handle:ctx=>(service||=createMining()).handle(ctx)};
