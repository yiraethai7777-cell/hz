'use strict';
const {getPool}=require('../shared/db');
const {ensureWallet}=require('./wallet');
const {link}=require('./economy');
const {RODS}=require('./data');
const {PLANT_MS,HARVEST_MS,settleHarvest,sendFarmCompletion}=require('./farm-timing');
const {exactBalance,gameplayBalance,formatAmount}=require('./farm-balance');
const FOLD='\u200b'.repeat(1200);
const CROPS=[
 ['당근','🥕',1,500,1000],['감자','🥔',2,1200,2500],['옥수수','🌽',3,2000,4000],['토마토','🍅',4,3000,6000],
 ['딸기','🍓',5,4500,9000],['포도','🍇',6,6500,13000],['수박','🍉',8,10000,20000],['파인애플','🍍',10,15000,30000]
].map(([name,emoji,minutes,price,sale])=>({name,emoji,minutes,price,sale}));
const EXPANSIONS=[0,100000,500000,2000000,5000000,10000000];
const fmt=n=>Number(n).toLocaleString('ko-KR');
function fail(message){const e=Error(message);e.userFacing=true;throw e;}
function integer(value,label){if(!/^[1-9]\d*$/.test(String(value||'')))fail(label+'은 1 이상의 정수로 입력해 주세요.');const n=Number(value);if(!Number.isSafeInteger(n))fail(label+'이 너무 큽니다.');return n;}
function crop(name){const c=CROPS.find(c=>c.name===name);if(!c)fail('존재하지 않는 작물입니다. #상점에서 씨앗 종류를 확인해 주세요.');return c;}
function cell(number,size){const n=integer(number,'칸 번호');if(n>size*size)fail(`칸 번호는 1~${size*size}까지입니다.`);return Math.floor((n-1)/size)+':'+((n-1)%size);}
function mention(id,name){return `\u0002${id}\u0003${String(name).replace(/[\u0000-\u001f]/g,'')}\u0004`;}
function shop(){return '🛒 카카오톡 게임 매니저 | 통합 상점\n낚시대 · 씨앗 통합 상점\n'+FOLD+'\n🎣 낚시대\n━━━━━━━━━━━━━━\n'+RODS.map(r=>`${r.name} · ${r.price?fmt(r.price)+'코인':'무료'}`).join('\n')+
 '\n\n🌱 씨앗\n━━━━━━━━━━━━━━\n'+CROPS.map(c=>`${c.emoji} ${c.name} · ${fmt(c.price)}코인\n   성장 ${c.minutes}분 · 수확 ${fmt(c.sale)}코인`).join('\n')+
 '\n\n🍀 행운 포션\n━━━━━━━━━━━━━━\n가격 · 40,000코인\n효과 · 10분간 낚시 행운 50% 상승\n└─ !ㄱㅁ행운\n\n🤖 자동낚시\n━━━━━━━━━━━━━━\n가격 · 50,000코인\n효과 · 5분간 20초마다 자동 낚시\n하루 최대 3회\n└─ !ㄱㅁ자동\n\n구매 안내\n└─ !낚시대ㄱㅁ (이름)\n└─ !씨앗ㄱㅁ (이름) (수량)\n└─ !농장\n└─ !농장정보';}
function formatFarm(f,user,now){
 const size=f.level+2;let empty=0,planting=0,growing=0,harvesting=0,ready=0;const rows=[];
 for(let r=0;r<size;r++){
  const line=[];for(let col=0;col<size;col++){
   const planted=f.plots[r+':'+col];if(!planted){empty++;line.push('🟫');continue;}
   const c=crop(planted.crop),elapsed=now-planted.plantedAt;
   if(Number(planted.harvestReadyAt)>0){harvesting++;line.push('🌾');}
   else if(now<planted.plantedAt){planting++;line.push('🪴');}
   else if(elapsed>=c.minutes*60000){ready++;line.push(c.emoji);}
   else{growing++;line.push(elapsed>=c.minutes*30000?'🌿':'🌱');}
  }rows.push(line.join(' '));
 }
 const seeds=CROPS.filter(c=>f.seeds[c.name]>0).map(c=>`${c.emoji} ${c.name} ${fmt(f.seeds[c.name])}개`).join(' · ')||'없음';
 return `🌾 카카오톡 게임 매니저 | 농장\n👤 ${mention(user.id,user.name)}님\n${FOLD}\n농장\n━━━━━━━━━━━━━━\nFarm Lv.${f.level} | ${size}×${size}\n\n${rows.join('\n')}\n\n━━━━━━━━━━━━━━\n빈 땅: ${empty}칸\n심는 중: ${planting}칸\n재배 중: ${growing}칸\n수확 중: ${harvesting}칸\n수확 가능: ${ready}칸\n\n🎒 보유 씨앗\n${seeds}\n\n└─ !심기 (번호 또는 all) (작물이름)\n└─ !수확 (번호)\n└─ !전체수확\n└─ !농장확장\n칸 번호는 왼쪽 위부터 가로 순서입니다.`;
}
function createFarm({pool,now=Date.now,schedule=(task,delay)=>setTimeout(task,delay),autoRecover=true}){
 let recoverTimer=null;
 function defer(ms,task){
  const handle=schedule(()=>Promise.resolve().then(task).catch(e=>console.error('[FARM TIMER]',String(e?.message||e))),ms);
  if(typeof handle?.unref==='function')handle.unref();
 }
 const settle=(room,user)=>settleHarvest({pool,room,user,crops:CROPS,now});
 async function recover(){
  const pending=await pool.query("SELECT room_id,user_id FROM gl_farms WHERE plots::text LIKE '%harvestReadyAt%' LIMIT 200");
  for(const row of pending.rows)await settle(row.room_id,row.user_id);
 }

 async function init(){
  await pool.query(`CREATE TABLE IF NOT EXISTS gl_farms(
  room_id TEXT NOT NULL,user_id TEXT NOT NULL,level INTEGER NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 6),
  seeds JSONB NOT NULL DEFAULT '{}'::jsonb,plots JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id));`);
  if(autoRecover&&!recoverTimer){
   recoverTimer=setInterval(()=>recover().catch(error=>console.error('[FARM RECOVERY]',String(error?.message||error))),5000);
   if(typeof recoverTimer.unref==='function')recoverTimer.unref();
   await recover();
  }
 }
 async function run(ctx){
  const original=String(ctx.text||'').trim();
  const text=original.startsWith('!')?'#'+original.slice(1).replace(/ㄱㅁ/g,'구매'):original;
  const parts=text.split(/\s+/),cmd=parts[0];
  if(cmd==='#상점'){if(parts.length!==1)fail('사용법: !상점');return mention(ctx.userId,ctx.userName||ctx.userId)+'님, 통합 상점입니다.\n'+shop();}
  const room=String(ctx.roomId),user=String(ctx.userId),name=String(ctx.userName||user);
  if(!/^\d+$/.test(room)||!/^\d+$/.test(user))fail('채팅방과 사용자 ID를 확인할 수 없습니다.');
  await settle(room,user); // Reconcile matured harvests before reading current farm state.
  const readonly=['#농장','#농장정보'].includes(cmd);
if(!['#농장','#농장정보','#농장확장','#씨앗구매','#심기','#수확','#전체수확'].includes(cmd))fail('지원하지 않는 농장 명령어입니다.');
if(['#농장','#농장정보','#농장확장','#전체수확'].includes(cmd)&&parts.length!==1)fail('사용법: !'+cmd.slice(1));
  if(!readonly&&ctx.messageId==null)fail('메시지 고유번호를 확인할 수 없어 처리를 중단했습니다.');
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const roomRow=await db.query('SELECT data FROM hz_rooms WHERE room_id=$1 FOR UPDATE',[room]);
   if(!roomRow.rows[0]?.data?.game)fail('이 방의 게임 기능이 꺼져 있습니다.');
   const data=roomRow.rows[0].data,p=data.players?.[user];let balance=0n;
   if(!readonly){
    const claimed=await db.query("INSERT INTO hz_coin_operations(room_id,message_id,operation) VALUES($1,$2,'FARM') ON CONFLICT DO NOTHING RETURNING message_id",[room,String(ctx.messageId)]);
    if(!claimed.rowCount)fail('이미 처리된 명령어입니다.');
    if(p&&!ctx.isBotAccount)await link(db,room,user,p);else await ensureWallet(db,room,user,name);
    const wallet=await db.query('SELECT balance FROM hz_wallets WHERE room_id=$1 AND user_id=$2 FOR UPDATE',[room,user]);
    if(!wallet.rows.length)fail('코인 지갑을 찾을 수 없습니다.');
    balance=exactBalance(wallet.rows[0].balance);
   }
   await db.query('INSERT INTO gl_farms(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[room,user]);
   const f=(await db.query('SELECT level,seeds,plots FROM gl_farms WHERE room_id=$1 AND user_id=$2 FOR UPDATE',[room,user])).rows[0];
   f.seeds={...f.seeds};f.plots={...f.plots};const size=f.level+2,time=now();let delta=0,result='';const jobs=[];
   function spend(cost){if(!ctx.isBotAccount&&balance<BigInt(cost))fail(`코인이 부족합니다. 필요 ${fmt(cost)}코인 · 보유 ${formatAmount(balance)}코인`);if(!ctx.isBotAccount)delta-=cost;}
   if(cmd==='#농장')result=formatFarm(f,{id:user,name},time);
   if(cmd==='#농장정보')result=`🌾 ${mention(user,name)}님의 농장 정보\n${FOLD}\n농장\nFarm Lv.${f.level} | ${size}×${size} · ${size*size}칸\n${f.level<6?'다음 확장: '+(size+1)+'×'+(size+1)+' · '+fmt(EXPANSIONS[f.level])+'코인':'최대 크기입니다.'}\n칸 번호는 왼쪽 위부터 가로 순서입니다.\n!농장확장으로 한 단계씩 확장합니다.`;
   if(cmd==='#씨앗구매'){
    if(parts.length!==3)fail('사용법: !씨앗ㄱㅁ (이름) (수량)');
    const c=crop(parts[1]),quantity=integer(parts[2],'수량'),cost=c.price*quantity,total=(f.seeds[c.name]||0)+quantity;
    if(!Number.isSafeInteger(cost)||!Number.isSafeInteger(total))fail('구매 수량이 너무 큽니다.');
    spend(cost);f.seeds[c.name]=total;result=`🌱 ${c.name} 씨앗 ${fmt(quantity)}개를 구매했습니다.\n사용 코인: ${fmt(cost)}코인\n보유 씨앗: ${fmt(total)}개`;
   }
   
   
   if(cmd==='#심기'){
    if(parts.length<3)
      fail('사용법: !심기 (번호 또는 all) (작물이름)');

    const c=crop(parts[parts.length-1]);
    const isAll=parts[1].toLowerCase()==='all';

    let numbers;
    let keys;

    if(isAll){
      if(parts.length!==3)
        fail('사용법: !심기 (all) (작물이름)');

      numbers=[];
      keys=[];

      for(let n=1;n<=size*size;n++){
        const key=cell(n,size);
        if(!f.plots[key]){
          numbers.push(String(n));
          keys.push(key);
        }
      }

      if(!keys.length)
        fail('농장에 빈칸이 없습니다.');
    }else{
      numbers=parts.slice(1,-1);
      keys=numbers.map(n=>cell(n,size));

      if(new Set(keys).size!==keys.length)
        fail('같은 칸 번호를 중복 입력할 수 없습니다.');

      for(let i=0;i<keys.length;i++){
        if(f.plots[keys[i]])
          fail(`${numbers[i]}번 칸에는 이미 작물이 있습니다.`);
      }
    }

    const owned=Number(f.seeds[c.name]||0);

    if(!Number.isSafeInteger(owned)||owned<=0)
      fail(`${c.name} 씨앗이 없습니다. !씨앗ㄱㅁ로 구매해 주세요.`);

    if(isAll){
      keys=keys.slice(0,owned);
      numbers=numbers.slice(0,owned);
    }else if(owned<keys.length){
      fail(`${c.name} 씨앗이 부족합니다.\n필요: ${keys.length}개\n보유: ${fmt(owned)}개`);
    }

    for(const key of keys){
      // Planting occupies the plot immediately; growth starts after planting finishes.
      f.plots[key]={crop:c.name,plantedAt:time+PLANT_MS};
    }
    f.seeds[c.name]=owned-keys.length;
    const details=(isAll?FOLD+'\n':'')+'━━━━━━━━━━━━━━━━━━\n'+
      '📍 심은 위치 · '+numbers.join(', ')+'번\n'+
      '🎒 남은 씨앗 · '+fmt(f.seeds[c.name])+'개';
    result='🌱 카카오톡 게임 매니저 | 심기\n'+c.emoji+' '+c.name+' '+keys.length+'칸을 심는 중입니다…\n'+
      '⏳ 5초 후 완료\n'+details;
    const completed='🌱 카카오톡 게임 매니저 | 심기\n✅ '+c.emoji+' '+c.name+' '+keys.length+'칸 '+(isAll?'전부 ':'')+'심었습니다!\n'+
      '🌿 성장 시간 · '+c.minutes+'분\n'+details;
    jobs.push({type:'plant',room,user,completedText:completed});
   }


   if(cmd==='#수확'||cmd==='#전체수확'){
    if(cmd==='#수확'&&parts.length!==2)fail('사용법: !수확 (번호)');
    const keys=cmd==='#수확'?[cell(parts[1],size)]:Object.keys(f.plots);
    let count=0,coins=0;const harvested=[];
    for(const key of keys){
     const planted=f.plots[key];
     if(!planted){if(cmd==='#수확')fail('빈 땅입니다.');continue;}
     if(Number(planted.harvestReadyAt)>0){
      if(cmd==='#수확')fail('이미 수확 중입니다. 5초 후 자동으로 완료됩니다.');
      continue;
     }
     if(time<planted.plantedAt){
      if(cmd==='#수확')fail('아직 씨앗을 심는 중입니다. 남은 시간: '+Math.ceil((planted.plantedAt-time)/1000)+'초');
      continue;
     }
     const c=crop(planted.crop),remaining=planted.plantedAt+c.minutes*60000-time;
     if(remaining>0){
      if(cmd==='#수확')fail('아직 성장 중입니다. 남은 시간: '+Math.ceil(remaining/1000)+'초');
      continue;
     }
     // The crop is reserved for harvesting; payout is made after five seconds.
     planted.harvestReadyAt=time+HARVEST_MS;
     count++;coins+=c.sale;
     harvested.push(c.emoji+' '+c.name+' · '+fmt(c.sale)+'코인');
    }
    const isAll=cmd==='#전체수확';
    const details='\n'+FOLD+'\n━━━━━━━━━━━━━━━━━━\n'+
      harvested.join('\n')+'\n💰 지급 예정 · '+fmt(coins)+'코인';
    if(count){
      const completion='🌾 카카오톡 게임 매니저 | 수확\n✅ '+count+'개 '+(isAll?'전부 ':'')+'수확 완료!\n💰 +'+fmt(coins)+'코인 지급'+details;
      jobs.push({type:'harvest',room,user,count,coins,completedText:completion});
      result='🌾 카카오톡 게임 매니저 | 수확\n🌿 작물 '+count+'개를 수확 중입니다…\n⏳ 5초 후 완료'+details;
    }else result='🌱 아직 수확 가능한 작물이 없습니다.';
   }
   if(cmd==='#농장확장'){
    if(f.level>=6)fail('이미 최대 크기 8×8 농장입니다.');const cost=EXPANSIONS[f.level];spend(cost);f.level++;
    result=`🌾 농장을 Lv.${f.level} · ${f.level+2}×${f.level+2}로 확장했습니다.\n사용 코인: ${fmt(cost)}코인\n기존 작물은 같은 위치에 유지됩니다.`;
   }
   if(delta){
    const updated=await db.query('UPDATE hz_wallets SET balance=balance+$3::numeric WHERE room_id=$1 AND user_id=$2 AND balance+$3::numeric>=0 RETURNING balance',[room,user,String(delta)]);
    if(!updated.rowCount)fail('코인 지갑을 변경할 수 없습니다.');balance=exactBalance(updated.rows[0].balance);
    await db.query('INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail) VALUES($1,$2,$3,$4,$5)',[room,user,delta>0?'FARM_HARVEST':'FARM_SPEND',delta,text]);
   }
   if(!readonly){
    await db.query('UPDATE gl_farms SET level=$3,seeds=$4::jsonb,plots=$5::jsonb,updated_at=NOW() WHERE room_id=$1 AND user_id=$2',[room,user,f.level,JSON.stringify(f.seeds),JSON.stringify(f.plots)]);
    if(p&&!ctx.isBotAccount){p.points=gameplayBalance(balance);await db.query('UPDATE hz_rooms SET data=$2::jsonb,updated_at=NOW() WHERE room_id=$1',[room,JSON.stringify(data)]);}
   }
   await db.query('COMMIT');
   if(jobs.length&&typeof ctx.onCommittedJobs==='function')ctx.onCommittedJobs(jobs);
   return result;
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }
 function scheduleCompletion({ctx,job}){
  if(!job?.completedText)return;
  const duration=job.type==='harvest'?HARVEST_MS:PLANT_MS;
  defer(duration,async()=>{
   if(job.type==='harvest')await settle(job.room,job.user);
   await sendFarmCompletion({ctx,text:job.completedText});
  });
 }
 return {init,run,scheduleCompletion};
}
let instance;const service=()=>instance ||= createFarm({pool:getPool()});
async function init(){await service().init();}
async function handle(ctx){
 if(!/^#(?:농장|농장정보|농장확장|상점|씨앗구매|심기|수확|전체수확)(?:\s|$)/.test(ctx.text))return false;
 let committedJobs=[];
 try{
  const response=await service().run({...ctx,
   messageId:ctx.messageId??require('./coin').messageKey(ctx.msg||{}),
   onCommittedJobs:jobs=>{committedJobs=jobs;}
  });
  await ctx.send(response);
  for(const job of committedJobs)service().scheduleCompletion({ctx,job});
 }catch(e){
  if(!e.userFacing)console.error('[FARM]',String(e?.message||e));
  await ctx.send('❌ '+(e.userFacing?e.message:'농장 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.'));
 }
 return true;
}
module.exports={createFarm,CROPS,EXPANSIONS,shop,formatFarm,init,handle};
