'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const crypto=require('node:crypto'),http=require('node:http');

test('PostgreSQL platform integration: preserve records, economy, trading, games, promotion and secure web',async t=>{
 const previousEnv={...process.env};process.env.DATABASE_URL='postgres://localhost/isolated_test';
 const {getPool}=require('../shared/db'),pool=getPool(),oldQuery=pool.query,oldConnect=pool.connect;
 const db=new PGlite();let queue=Promise.resolve();
 const query=async(sql,params)=>{
  const result=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);
  return {...result,rowCount:result?.rowCount??(result?.command==='SELECT'?result.rows.length:result?.affectedRows??result?.rows?.length??0)};
 };
 const adapter={query,connect:async()=>{const wait=queue;let unlock;queue=new Promise(resolve=>unlock=resolve);await wait;return {query,release:unlock};}};
 pool.query=query;pool.connect=adapter.connect;
 let server;
 try{
  const wallet=require('../game/wallet'),members=require('../game/members'),trading=require('../game/trading'),coin=require('../game/coin'),economy=require('../game/economy');
  await wallet.initWallet();await members.initMembers();await trading.initTrading();await coin.initCoinExtra();await economy.init();await require('../api/schema').init();
  const runtime=require('../shared/runtime').createRuntime({pool:adapter});await runtime.initDb();await require('../manage').init();
  runtime.globalBotId='9999';runtime.globalChat={sendText:async()=>{}};
  const oldFish={name:'천공해룡',tier:'신화',size:1111,value:4321,salePending:true};
  const room={name:'보존 테스트방',game:true,manage:true,quizEnabled:true,fishEnabled:true,jun:true,players:{'1001':{id:'1001',name:'기존사용자',points:700,level:12,xp:45,wins:5,inventory:[oldFish],pets:{'고양이':2},rods:['나무','돌'],rod:'돌',rodLevels:{돌:3}}}};
  await query('INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb)',['1',JSON.stringify(room)]);
  await query("CREATE TABLE hz_jun(id int PRIMARY KEY,detail text); INSERT INTO hz_jun VALUES(1,'historical record')");
  await wallet.ensureWallet(pool,'1','1001','기존사용자');await query('UPDATE hz_wallets SET balance=300 WHERE room_id=$1 AND user_id=$2',['1','1001']);

  await t.test('one-time economy merge and restart preserve all old records',async()=>{
   await economy.ensureLinked('1','1001','기존사용자');await economy.ensureLinked('1','1001','기존사용자');
   assert.equal(await wallet.getBalance('1','1001','기존사용자'),1000);
   const r=await query('SELECT data FROM hz_rooms WHERE room_id=$1',['1']),p=r.rows[0].data.players['1001'];
   assert.equal(p.level,12);assert.equal(p.xp,45);assert.deepEqual(p.inventory,[oldFish]);assert.deepEqual(p.pets,{'고양이':2});assert.equal(p.rodLevels.돌,3);assert.equal(r.rows[0].data.jun,true);
   await require('../shared/runtime').createRuntime({pool:adapter}).initDb();
   assert.equal((await query('SELECT * FROM hz_jun')).rowCount,1);
   assert.equal((await query("SELECT * FROM hz_coin_logs WHERE type='LEGACY_GAME_MERGE'")).rowCount,1);
  });
  await t.test('signup is idempotent; transfer duplicates cannot move money twice',async()=>{
   await members.joinGame('1','2001','신규');await members.joinGame('1','2001','신규');assert.equal(await wallet.getBalance('1','2001','신규'),100000);
   const input={roomId:'1',from:{id:'2001',name:'신규'},to:{id:'2002',name:'상대'},coins:1000,kind:'TRANSFER',messageId:'transfer-1'};
   await coin.transfer(input);await assert.rejects(()=>coin.transfer(input),/이미 처리/);
   assert.equal(await wallet.getBalance('1','2001','신규'),99000);assert.equal(await wallet.getBalance('1','2002','상대'),1000);
   for(const amount of [-1,0,'1.5','1e5',1000000001])assert.throws(()=>coin.validAmount(amount));
  });
  await t.test('coin commands parse spaced nicknames, enforce grant permission, mint for bot and reject duplicates',async()=>{
   const messages=[],chat={sendText:async(room,text)=>messages.push(text)};
   await wallet.ensureWallet(pool,'1','7001','송금자');
   await query('UPDATE hz_wallets SET balance=5000 WHERE room_id=$1 AND user_id=$2',['1','7001']);
   const msg={id:'cmd-transfer',sender:{id:'7001',name:'송금자'},mentions:[{userId:'9007199254740993123',name:'공백 닉네임'}]};
   const input={roomId:'1',chat,msg,text:'!코인송금 @공백 닉네임 1000'};
   assert.equal(await coin.handleCoinCommand(input),true);assert.match(messages.at(-1),/송금 완료/);
   assert.equal(await wallet.getBalance('1','7001','송금자'),4000);
   assert.equal(await wallet.getBalance('1','9007199254740993123','공백 닉네임'),1000);
   await coin.handleCoinCommand(input);assert.match(messages.at(-1),/이미 처리/);
   await coin.handleCoinCommand({...input,text:'!코인송금 @공백 닉네임 5000',msg:{...msg,id:'insufficient'}});assert.match(messages.at(-1),/코인이 부족/);
   await wallet.ensureWallet(pool,'1','8001','한도');await query('UPDATE hz_wallets SET balance=9007199254740991 WHERE room_id=$1 AND user_id=$2',['1','8001']);
   await coin.handleCoinCommand({...input,text:'!코인송금 @한도 1',msg:{...msg,id:'overflow',mentions:[{userId:'8001',name:'한도'}]}});assert.match(messages.at(-1),/잔액 한도/);
   assert.equal(await wallet.getBalance('1','7001','송금자'),4000);
   assert.equal(await wallet.getBalance('1','9007199254740993123','공백 닉네임'),1000);
   await coin.handleCoinCommand({...input,text:'!코인지급 @공백 닉네임 1000',msg:{...msg,id:'denied-grant'}});assert.match(messages.at(-1),/관리자만/);
   const bot={...msg,id:'bot-transfer',sender:{id:'9999',name:'GL'}};
   await coin.handleCoinCommand({...input,msg:bot,isBotAccount:true});assert.match(messages.at(-1),/송금 완료/);
   await coin.handleCoinCommand({...input,text:'!코인지급 @공백 닉네임 2000',msg:{...bot,id:'bot-grant'},isBotAccount:true});assert.match(messages.at(-1),/지급 완료/);
   assert.equal(await wallet.getBalance('1','9007199254740993123','공백 닉네임'),4000);
   assert.equal(await wallet.getBalance('1','9999','GL'),0);
   await coin.handleCoinCommand({...input,text:'!코인송금 @공백 닉네임 -1',msg:{...msg,id:'negative'}});assert.match(messages.at(-1),/1 이상의 정수/);
   await coin.handleCoinCommand({...input,text:'!코인송금 @송금자 1',msg:{...msg,id:'self',mentions:[{userId:'7001',name:'송금자'}]}});assert.match(messages.at(-1),/자기 자신/);
   assert.equal(await coin.handleCoinCommand({...input,text:'!코인'}),false);
  });
  await t.test('info uses wallet balance and the same chat ranking, and retired commands cannot reach stocks',async()=>{
   await query("INSERT INTO gl_manage_chat_counts(room_id,user_id,user_name,count) VALUES('1','7001','송금자',5),('1','7002','두번째',10)");
   const sent=[],ctx={text:'!정보',roomId:'1',userId:'7001',userName:'송금자',send:async text=>sent.push(text)};
   await require('../game/info').handle(ctx,{getUserOpenProfileLink:async()=> 'https://open.kakao.com/o/known'});
   assert.match(sent[0],/\u00027001\u0003송금자\u0004님의 프로필 정보/);
   assert.match(sent[0],/코인 · 4,000/);assert.match(sent[0],/채팅순위 · 2위/);assert.match(sent[0],/채팅량 · 5회/);assert.match(sent[0],/\/o\/known/);
   assert.equal([...sent[0]].filter(c=>c==='\u200b').length,1200);
   await require('../game/info').handle({...ctx,userId:'9999',isBotAccount:true},{});assert.match(sent.at(-1),/코인 · ∞/);
   const game=require('../game').createGame({});for(const text of ['!코인','!레벨','!내정보','!주식시간','!주식구매 삼성전자 1','!내주식','!주식알림설정 삼성전자 1 이상'])await game.message({text,msg:{},send:async()=>assert.fail('retired command responded')});
  });
  await t.test('stock buy/sell persist holdings; oversell and duplicate orders roll back',async()=>{
   const buy={roomId:'1',userId:'2001',userName:'신규',symbol:'TEST',stockName:'테스트',side:'BUY',quantity:2,priceKrw:100,messageId:'buy-1'};
   await trading.tradeStock(buy);await assert.rejects(()=>trading.tradeStock(buy),/이미 처리/);
   await trading.tradeStock({...buy,side:'SELL',quantity:1,priceKrw:150,messageId:'sell-1'});
   const h=await trading.getHoldings('1','2001');assert.equal(h[0].quantity,1);assert.equal(Number(h[0].total_cost),100);
   assert.equal(await wallet.getBalance('1','2001','신규'),98950);
   await assert.rejects(()=>trading.tradeStock({...buy,side:'SELL',quantity:99,messageId:'sell-fail'}),/부족/);
   assert.equal(await wallet.getBalance('1','2001','신규'),98950);
  });
  await t.test('competing orders cannot spend more than available coins',async()=>{
   await members.joinGame('1','2003','경합');await query('UPDATE hz_wallets SET balance=1000 WHERE room_id=$1 AND user_id=$2',['1','2003']);
   const input={roomId:'1',userId:'2003',userName:'경합',symbol:'RACE',stockName:'경합',side:'BUY',quantity:1,priceKrw:700};
   const results=await Promise.allSettled([trading.tradeStock({...input,messageId:'race-1'}),trading.tradeStock({...input,messageId:'race-2'})]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await wallet.getBalance('1','2003','경합'),300);
  });
  await t.test('400 quizzes in three categories; first correct answer wins once',async()=>{
   const questions=require('../game/data').QUIZZES;assert.equal(questions.length,400);assert.deepEqual([...new Set(questions.map(q=>q[0]))].sort(),['넌센스','수학','일반상식'].sort());
   const {answerMatches}=require('../game/quiz');assert.equal(answerMatches('-3','3'),false);assert.equal(answerMatches('1.5','15'),false);assert.equal(answerMatches('서울',' 서 울 '),true);
   await runtime.withRoom('1','',async d=>{d.quiz={kind:'수학',answers:['4'],question:'2+2?',expiresAt:Date.now()+60000};});
   const before=await wallet.getBalance('1','2001','신규');
   for(const [user,key]of [['2001','answer-1'],['2002','answer-2']])await runtime.withRoom('1','',async(d,c)=>runtime.handleGame(d,c,{room:{id:'1'},sender:{id:user,name:user},text:'!정답 4',id:key},false));
   assert.equal(await wallet.getBalance('1','2001','신규'),before+10000);
   assert.equal(await wallet.getBalance('1','2002','상대'),1000);
   const r=await query('SELECT data FROM hz_rooms WHERE room_id=$1',['1']);assert.equal(r.rows[0].data.quiz,null);assert.equal(r.rows[0].data.players['2001'].wins,1);
  });
  await t.test('fishing waits two seconds, persists inventory and logs wallet rewards',async()=>{
   const started=Date.now();let result;
   await runtime.withRoom('1','',async(d,c)=>{result=await runtime.handleGame(d,c,{room:{id:'1'},sender:{id:'2001',name:'신규'},text:'!낚시',id:'fish-1'},false);});
   assert.ok(Date.now()-started>=1900);assert.match(result,/낚시 결과/);assert.ok(!result.includes('사진'));
   const r=await query('SELECT data FROM hz_rooms WHERE room_id=$1',['1']);assert.equal(r.rows[0].data.players['2001'].inventory.length,1);
   assert.equal((await query("SELECT * FROM hz_coin_logs WHERE type='GAME_REWARD' AND detail='!낚시'")).rowCount,1);
  });
  await t.test('pet draw, duplicate request and maximum level preserve consistency',async()=>{
   const event={room:{id:'1'},sender:{id:'2001',name:'신규'},text:'!펫뽑기',id:'pet-1'};
   await runtime.withRoom('1','',async(d,c)=>runtime.handleGame(d,c,event,false));const balance=await wallet.getBalance('1','2001','신규');
   await runtime.withRoom('1','',async(d,c)=>runtime.handleGame(d,c,event,false));assert.equal(await wallet.getBalance('1','2001','신규'),balance);
   const p={level:199,xp:0};runtime.addXp(p,100000);assert.equal(p.level,200);
   const r=await query('SELECT data FROM hz_rooms WHERE room_id=$1',['1']);assert.equal(Object.keys(r.rows[0].data.players['2001'].pets).length,1);
  });
  await t.test('removed jun commands do not touch historical records or game flags',async()=>{
   const game=require('../game').createGame({});for(const text of ['!준개작동','!준개내역삭제 1','!준개 아이템 10','!전체준개내역'])await game.message({text,roomId:'1',msg:{},send:async()=>{throw Error('Removed command responded');}});
   assert.equal((await query('SELECT * FROM hz_jun')).rowCount,1);
   assert.ok(!require('../shared/help').formatCommandHelp({game:true,manage:true}).includes('준개'));
  });
  await t.test('promotion changes persist, duplicate delivery and stopped scheduling are blocked',async()=>{
   const promotion=require('../promotion'),messages=[];
   await promotion.configure('1','owner','content',{message:'테스트 홍보'});await promotion.configure('1','owner','start',{minutes:5});
   const chat={sendText:async(room,text)=>messages.push(text)};
   assert.equal(await promotion.deliver('1',chat,true),true);assert.equal(await promotion.deliver('1',chat,true),false);
   await promotion.configure('1','owner','stop',{});await promotion.tick(chat);assert.deepEqual(messages,['테스트 홍보']);
   assert.equal((await promotion.stats('1')).find(r=>r.status==='SENT').count,1);
  });
  await t.test('room settings remain independent across reconnect and restart',async()=>{
   await query('INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb)',['2',JSON.stringify({game:false,manage:false,players:{}})]);
   const game=require('../game').createGame({});await game.toggle({roomId:'2',text:'!게임작동',isBotAccount:true,send:async()=>{}});
   const rooms=(await query('SELECT room_id,data FROM hz_rooms ORDER BY room_id')).rows;assert.equal(rooms[0].data.game,true);assert.equal(rooms[1].data.game,true);assert.equal(rooms[1].data.manage,false);
   await game.toggle({roomId:'1',text:'!게임중지',isBotAccount:true,send:async()=>{}});assert.equal((await query('SELECT data FROM hz_rooms WHERE room_id=$1',['2'])).rows[0].data.game,true);
  });
  await t.test('secure REST API and public consent hide IDs and enforce session plus CSRF',async sub=>{
   const auth=require('../api/auth'),{status}=require('../api/routes');
   process.env.GL_ADMIN_USERNAME='testadmin';process.env.GL_ADMIN_PASSWORD_HASH=auth.hashPassword('isolated-test-password-long');process.env.GL_SESSION_SECRET=crypto.randomBytes(32).toString('hex');
   status.ready=true;status.connected=true;
   server=http.createServer(require('../api/server').handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
   const request=(route,options={})=>fetch(base+route,options);
   assert.equal((await request('/api/admin/rooms')).status,401);
   let ranking=await (await request('/api/public/rankings')).json();assert.equal(ranking.entries.length,0);
   await require('../game/privacy').command({text:'!랭킹공개 테스트별명',roomId:'1',userId:'2001',send:async()=>{}});
   ranking=await (await request('/api/public/rankings')).json();assert.equal(ranking.entries[0].alias,'테스트별명');assert.ok(!JSON.stringify(ranking).includes('2001'));assert.ok(!JSON.stringify(ranking).includes('user_id'));
   const rejected=await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username:'wrong-admin',password:'isolated-test-password-long'})});assert.equal(rejected.status,401);
   const logged=await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username:'testadmin',password:'isolated-test-password-long'})});assert.equal(logged.status,200);
   const cookie=logged.headers.get('set-cookie').split(';')[0],session=await logged.json();assert.ok(logged.headers.get('set-cookie').includes('HttpOnly'));assert.ok(logged.headers.get('set-cookie').includes('SameSite=Strict'));
   const noCsrf=await request('/api/admin/rooms',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify({roomId:'2',flags:{game:false}})});assert.equal(noCsrf.status,403);
   const headers={'Content-Type':'application/json',Origin:base,Cookie:cookie,'X-CSRF-Token':session.csrf};
   const changed=await request('/api/admin/rooms',{method:'POST',headers,body:JSON.stringify({roomId:'2',flags:{game:false}})});assert.equal(changed.status,200);
   assert.equal((await query('SELECT data FROM hz_rooms WHERE room_id=$1',['2'])).rows[0].data.game,false);
   const promoStats=await(await request('/api/admin/promotion/logs?roomId=1',{headers:{Cookie:cookie}})).json();assert.ok(promoStats.stats.some(row=>row.status==='SENT'&&row.count===1));
   const overview=await request('/api/admin/overview',{headers:{Cookie:cookie}});assert.equal(overview.status,200);
   const notice=await request('/api/admin/notices',{method:'POST',headers,body:JSON.stringify({title:'테스트 공지',body:'안전한 공개 공지',pinned:true})});assert.equal(notice.status,200);
   assert.equal((await(await request('/api/public/notices')).json()).notices[0].title,'테스트 공지');
   const details=await request('/api/admin/user?roomId=1&userId=2001',{headers:{Cookie:cookie}});assert.equal(details.status,200);
   const root=await request('/');assert.equal(root.status,200);assert.ok(root.headers.get('content-security-policy').includes("frame-ancestors 'none'"));assert.equal((await request('/package.json')).status,404);
   const adjust=()=>request('/api/admin/coins',{method:'POST',headers,body:JSON.stringify({roomId:'1',userId:'2001',amount:5,reason:'테스트',confirm:true,operationId:'web-test-op'})});
   assert.equal((await adjust()).status,200);assert.equal((await adjust()).status,400);
   await require('./promo-scenarios')({t:sub,request,headers,base,query,status});
   await require('./admin-promo-scenarios')({t:sub,request,headers,query});
   await request('/api/logout',{method:'POST',headers,body:'{}'});assert.equal((await request('/api/admin/rooms',{headers:{Cookie:cookie}})).status,401);
  });
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));pool.query=oldQuery;pool.connect=oldConnect;
  for(const k of Object.keys(process.env))if(!(k in previousEnv))delete process.env[k];Object.assign(process.env,previousEnv);await db.close();
 }
});
