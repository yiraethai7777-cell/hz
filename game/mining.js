'use strict';
const {getPool}=require('../shared/db'),{ensureWallet}=require('./wallet');
const ORES=Object.freeze([
 {name:'석탄',icon:'🪨',weight:45,price:100},{name:'철광석',icon:'⚙️',weight:30,price:250},
 {name:'금광석',icon:'🟡',weight:15,price:700},{name:'에메랄드',icon:'🟢',weight:7,price:1800},
 {name:'다이아몬드',icon:'💎',weight:2,price:5000},{name:'고대수정',icon:'🔮',weight:1,price:15000}
]);
const COOLDOWN=20000,FOLD='\u200b'.repeat(1200);
function pick(random){let roll=random()*100;for(const ore of ORES){roll-=ore.weight;if(roll<0)return ore;}return ORES.at(-1);}
async function init(pool=getPool()){
 await pool.query(`CREATE TABLE IF NOT EXISTS hz_mining_players(room_id TEXT NOT NULL,user_id TEXT NOT NULL,bag JSONB NOT NULL DEFAULT '{}'::jsonb,last_mined_at BIGINT,total_mined BIGINT NOT NULL DEFAULT 0,PRIMARY KEY(room_id,user_id));
 CREATE TABLE IF NOT EXISTS hz_mining_actions(room_id TEXT NOT NULL,message_id TEXT NOT NULL,user_id TEXT NOT NULL,command TEXT NOT NULL,result TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,message_id));`);
}
function guide(){return '⛏ NEXI | 광산\n!채굴 · !광물인벤 · !광물판매 전체\n'+FOLD+'\n━━━━━\n20초마다 1~3개 채굴 · 하루 한도 없음\n'+ORES.map(o=>o.icon+' '+o.name+' · '+o.weight+'% · '+o.price.toLocaleString('ko-KR')+'코인/개').join('\n')+'\n!광물판매 철광석 2 로 일부 판매도 가능합니다.';}
function createMining({pool=getPool(),random=Math.random,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),link=(room,user,name)=>require('./economy').ensureLinked(room,user,name)}={}){
 async function execute(ctx){
  const [command,...args]=ctx.text.trim().split(/\s+/),room=String(ctx.roomId),user=String(ctx.userId);
  if(!/^[1-9]\d*$/.test(room)||!/^[1-9]\d*$/.test(user))throw Error('사용자와 채팅방을 확인할 수 없습니다.');
  if(command==='#광산'&&!args.length)return guide();
  if(command==='#광물인벤'&&!args.length){
   const r=await pool.query('SELECT bag,total_mined FROM hz_mining_players WHERE room_id=$1 AND user_id=$2',[room,user]),p=r.rows[0]||{bag:{},total_mined:0};
   let value=0n;const lines=ORES.map(o=>{const n=Number(p.bag[o.name]||0);value+=BigInt(n)*BigInt(o.price);return o.icon+' '+o.name+' · '+n.toLocaleString('ko-KR')+'개';});
   return '⛏ NEXI | 광물 인벤\n'+lines.join('\n')+'\n━━━━━\n전체 판매가 · '+value.toLocaleString('ko-KR')+'코인\n누적 채굴 · '+BigInt(p.total_mined).toLocaleString('ko-KR')+'개\n!채굴 · !광물판매 전체';
  }
  if(!['#채굴','#광물판매'].includes(command))throw Error('사용법: !광산 · !채굴 · !광물인벤 · !광물판매 전체');
  if(command==='#채굴'&&args.length)throw Error('사용법: !채굴');
  const all=command==='#광물판매'&&args[0]==='전체'&&args.length===1,selected=ORES.find(o=>o.name===args[0]);
  if(command==='#광물판매'&&!all&&(!selected||args.length!==2||!/^[1-9]\d{0,8}$/.test(args[1])))throw Error('사용법: !광물판매 전체 또는 !광물판매 철광석 2');
  const message=ctx.messageId??(ctx.msg?require('./coin').messageKey(ctx.msg):null);if(!message)throw Error('메시지 번호를 확인할 수 없습니다. 다시 입력해 주세요.');
  if(command==='#광물판매')await link(room,user,ctx.userName);
  const db=await pool.connect();try{
   await db.query('BEGIN');
   const claimed=await db.query('INSERT INTO hz_mining_actions(room_id,message_id,user_id,command) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING message_id',[room,String(message),user,command]);if(!claimed.rowCount)throw Error('이미 처리된 명령입니다.');
   await db.query('INSERT INTO hz_mining_players(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[room,user]);
   const p=(await db.query('SELECT * FROM hz_mining_players WHERE room_id=$1 AND user_id=$2 FOR UPDATE',[room,user])).rows[0],bag={...p.bag};let text;
   if(command==='#채굴'){
    const time=now();
    if(p.last_mined_at!==null&&time-Number(p.last_mined_at)<COOLDOWN)throw Error('⏳ 다음 채굴까지 '+Math.ceil((COOLDOWN-time+Number(p.last_mined_at))/1000)+'초 남았습니다.');
    const ore=pick(random),quantity=1+Math.min(2,Math.floor(random()*3));bag[ore.name]=(bag[ore.name]||0)+quantity;
    await db.query('UPDATE hz_mining_players SET bag=$3::jsonb,last_mined_at=$4,total_mined=total_mined+$5 WHERE room_id=$1 AND user_id=$2',[room,user,JSON.stringify(bag),String(time),quantity]);
    text='⛏ NEXI | 채굴 성공\n'+ore.icon+' '+ore.name+' × '+quantity+'\n'+(ore.weight<=2?'✨ 희귀 광맥을 발견했습니다!\n':'')+'다음 채굴 20초 · 하루 한도 없음\n!광물인벤 · !광물판매 전체';
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
 return {execute,handle:async ctx=>{if(!/^#(?:광산|채굴|광물인벤|광물판매)(?:\s|$)/.test(ctx.text))return false;const started=Date.now();let result;try{result=await execute(ctx);}catch(e){console.warn('[NEXI MINING]',{command:ctx.text.split(/\s/)[0],code:e.code||'REJECTED'});result=e.code?'❌ 채굴 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.':'❌ '+e.message;}if(result.startsWith('⛏ NEXI | 채굴 성공\n'))await require('./mining-progress').send(ctx,result,wait);else await ctx.send(result);console.log('[NEXI MINING TIMING]',{elapsedMs:Date.now()-started});return true;}};
}
let service;module.exports={ORES,init,createMining,handle:ctx=>(service||=createMining()).handle(ctx)};
