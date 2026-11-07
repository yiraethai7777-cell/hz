'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {init,createMining,ORES}=require('../game/mining');
async function fixture(run){
 const db=new PGlite();let queue=Promise.resolve();
 const pool={query:async(sql,args)=>{if(pool.fail?.(sql))throw Error('simulated write failure');const r=args?.length?await db.query(sql,args):(await db.exec(sql)).at(-1);return {...r,rowCount:r?.affectedRows??r?.rows?.length??0};},connect:async()=>{const before=queue;let release;queue=new Promise(r=>release=r);await before;return {query:pool.query,release};}};
 try{await pool.query('CREATE TABLE hz_wallets(room_id TEXT,user_id TEXT,user_name TEXT,balance NUMERIC NOT NULL DEFAULT 0 CHECK(balance>=0),signup_bonus_eligible BOOLEAN,PRIMARY KEY(room_id,user_id));CREATE TABLE hz_coin_logs(id BIGSERIAL PRIMARY KEY,room_id TEXT,user_id TEXT,type TEXT,amount NUMERIC,detail TEXT);');await init(pool);await run(pool);}finally{await db.close();}
}
let id=0;const c=(text,user='2000',room='1000')=>({text,roomId:room,userId:user,userName:user,messageId:String(++id)});
test('mining duplicates, cooldown, restart and owner/room isolation',()=>fixture(async pool=>{
 let time=100000;const service=()=>createMining({pool,now:()=>time,random:()=>0,link:async()=>{}}),ctx=c('#채굴');
 const results=await Promise.allSettled([service().execute(ctx),service().execute(ctx)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(service().execute(c('#채굴')),/다음 채굴/);
 assert.match(await service().execute(c('#광물인벤')),/석탄 · 1개/);
 assert.match(await service().execute(c('#광물인벤','3000')),/석탄 · 0개/);
 assert.match(await service().execute(c('#광물인벤','2000','1001')),/석탄 · 0개/);
 time+=20000;await service().execute(c('#채굴'));assert.match(await service().execute(c('#광물인벤')),/석탄 · 2개/);
 assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM hz_mining_actions')).rows[0].n,2);
}));
test('sale credits exact existing wallet once and rejects insufficient items',()=>fixture(async pool=>{
 const s=createMining({pool,random:()=>0,link:async()=>{}});await s.execute(c('#채굴'));
 await pool.query("INSERT INTO hz_wallets(room_id,user_id,user_name,balance) VALUES('1000','2000','test',900719925474099312345)");
 const sale=c('#광물판매 석탄 1');await s.execute(sale);await assert.rejects(s.execute(sale),/이미 처리/);
 assert.equal((await pool.query('SELECT balance FROM hz_wallets')).rows[0].balance,'900719925474099312445');
 await assert.rejects(s.execute(c('#광물판매 석탄 1')),/부족/);
 assert.equal((await pool.query('SELECT * FROM hz_coin_logs')).rows.length,1);
 assert.match(await s.execute(c('#광물인벤')),/석탄 · 0개/);
}));
test('coin-log failure rolls back wallet, bag and receipt; retry works',()=>fixture(async pool=>{
 const s=createMining({pool,random:()=>0,link:async()=>{}});await s.execute(c('#채굴'));const sale=c('#광물판매 전체');
 pool.fail=sql=>sql.startsWith('INSERT INTO hz_coin_logs');await assert.rejects(s.execute(sale),/simulated/);pool.fail=null;
 assert.equal((await pool.query('SELECT * FROM hz_wallets')).rows.length,0);assert.match(await s.execute(c('#광물인벤')),/석탄 · 1개/);
 await s.execute(sale);assert.equal((await pool.query('SELECT balance FROM hz_wallets')).rows[0].balance,'100');
}));
test('more than 100 digs are allowed and collection survives restart',()=>fixture(async pool=>{
 let time=100000;const factory=()=>createMining({pool,now:()=>time,random:()=>0,link:async()=>{}});
 for(let i=0;i<101;i++){await factory().execute(c('#채굴'));time+=20000;}
 assert.match(await factory().execute(c('#광물인벤')),/석탄 · 101개/);
}));
test('failed chat delivery keeps committed loot and replay cannot grant it twice',()=>fixture(async pool=>{
 const s=createMining({pool,random:()=>.999,link:async()=>{}}),ctx=c('#채굴');ctx.send=async()=>{throw Error('chat offline');};
 await assert.rejects(s.handle(ctx),/chat offline/);await assert.rejects(s.execute(ctx),/이미 처리/);
 assert.match(await s.execute(c('#광물인벤')),/고대수정 · 3개/);
 assert.equal(ORES.reduce((n,o)=>n+o.weight,0),100);
}));
test('invalid sale amounts and missing message IDs never mutate inventory',()=>fixture(async pool=>{
 const s=createMining({pool,link:async()=>{}});
 for(const text of ['#광물판매 석탄 -1','#광물판매 석탄 1.5','#광물판매 전체 extra','#채굴 100'])await assert.rejects(s.execute(c(text)),/사용법/);
 await assert.rejects(s.execute({...c('#채굴'),messageId:null}),/메시지 번호/);
 assert.equal((await pool.query('SELECT * FROM hz_mining_actions')).rows.length,0);
}));

test('progress edits one exact sent message after inventory commit',()=>fixture(async pool=>{
 const edits=[],waits=[],sent=[];const ctx=c('#채굴');ctx.send=async text=>{sent.push(text);return {body:{status:0,logId:'90071992547409931234'}};};ctx.chat={editMessage:async(room,log,text)=>{assert.equal((await pool.query('SELECT bag FROM hz_mining_players')).rows[0].bag['석탄'],1);edits.push({room,log,text});return {body:{status:0}};}};
 await createMining({pool,random:()=>0,wait:async ms=>waits.push(ms)}).handle(ctx);
 assert.deepEqual(sent,['⛏ NEXI | 광질중.']);assert.equal(edits.length,3);assert.equal(edits[0].text,'⛏ NEXI | 광질중..');assert.equal(edits[1].text,'⛏ NEXI | 광질중...');assert.match(edits[2].text,/채굴 성공/);assert.ok(edits.every(e=>e.log==='90071992547409931234'));assert.deepEqual(waits,[700,700,700]);
}));
test('rejected progress edit falls back to result without rolling back loot',()=>fixture(async pool=>{
 const sent=[],ctx=c('#채굴');ctx.send=async text=>{sent.push(text);return {body:{status:0,logId:'12345'}};};ctx.chat={editMessage:async()=>({status:-1})};
 const s=createMining({pool,random:()=>0,wait:async()=>{}});await s.handle(ctx);assert.equal(sent.length,2);assert.match(sent[1],/채굴 성공/);assert.match(await s.execute(c('#광물인벤')),/석탄 · 1개/);
}));
test('missing progress logId never edits the input message',async()=>{
 const sent=[],ctx={roomId:'1000',messageId:'original',send:async t=>{sent.push(t);return {status:0};},chat:{editMessage:()=>assert.fail('No confirmed outgoing logId')}};
 await require('../game/mining-progress').send(ctx,'result',async()=>{});assert.deepEqual(sent,['⛏ NEXI | 광질중.','result']);
});
