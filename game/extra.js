'use strict';
const {getPool}=require('../shared/db');
const prices=require('./prices');
const {isMember}=require('./members');
const coin=require('./coin');
async function handle(ctx,client){
 const {text,roomId,userId,userName,send,msg}=ctx;
 if(/^!(?:치트|회수)(?:\s|$)/.test(text)){
  const owners=String(process.env.HZ_OWNER_IDS||process.env.HZ_OWNER_ID||'').split(/[\s,;]+/);
  if(!ctx.isBotAccount&&!owners.includes(String(userId))){await send('⛔ 최고 관리자만 사용할 수 있습니다.');return true;}
  try{
   const match=/^!(치트|회수)\s+(all|[1-9]\d*)\s+.+$/i.exec(text);if(!match||match[1]==='치트'&&match[2].toLowerCase()==='all')throw Error('사용법: !치트 금액 @멘션 / !회수 금액 또는 all @멘션');
   if(!coin.messageKey(msg))throw Error('메시지 고유번호가 필요합니다.');
   const target=coin.mentionTarget(msg);
   await require('./economy').ensureLinked(String(roomId),target.id,target.name);
   let n;
   if(match[2].toLowerCase()==='all'){const r=await getPool().query('SELECT balance FROM hz_wallets WHERE room_id=$1 AND user_id=$2',[String(roomId),target.id]);n=coin.validAmount(r.rows[0]?.balance||0);}else n=coin.validAmount(match[2]);
   const r=await require('./admin-coins').adjust({room:String(roomId),user:target.id,name:target.name,actor:String(userId),amount:match[1]==='치트'?n:-n,operationId:'kakao:'+String(roomId)+':'+String(coin.messageKey(msg)||''),reason:match[1]});
   await send(`✅ ${target.name}님 코인 조정 완료\n잔액: ${Number(r.balance).toLocaleString('ko-KR')}코인`);
  }catch(e){await send('❌ '+e.message);}return true;
 }
 if(/^!송금(?:\s|$)/.test(text)){await require('./economy').ensureLinked(String(roomId),String(userId),userName);await coin.handleCoinCommand({...ctx,text:text.replace('!송금','!코인송금'),chat:ctx.chat});return true;}
 if(text==='!게임순위'){await send(await require('./wallet').coinRanking(String(roomId)));return true;}
 if(!/^!(주식시세|주식목록|주식보유순위|주식알림설정|주식알림해제|주식알림상태|내주식)(?:\s|$)/.test(text))return false;
 try{
  if(!await isMember(roomId,userId))throw Error('먼저 !게임가입을 입력해 주세요.');
  const [cmd,...args]=text.split(/\s+/);
  if(cmd==='!주식목록'){
   if(!['한국','미국'].includes(args[0]))throw Error('사용법: !주식목록 한국 / 미국');
   const korea=args[0]==='한국';await send(`📈 ${args[0]} 지원 종목 (시가총액 순위 아님)\n`+Object.entries(prices.STOCKS).filter(([,s])=>/\.(KS|KQ)$/.test(s)===korea).map(([n,s])=>`${n} · ${s}`).join('\n'));
  }else if(cmd==='!주식시세'){
   const q=await prices.getQuote(args.join(' '));await send(`📈 ${q.name} (${q.symbol})\n최근 시세: ${q.price.toLocaleString('ko-KR')} ${q.currency}\n시세 시각: ${new Date(q.quotedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}\n게임 내 가상 거래용 조회`);
  }else if(cmd==='!내주식'){
   const holdings=await require('./trading').getHoldings(String(roomId),String(userId));
   const values=await Promise.all(holdings.map(async h=>{
    const base=`${h.stock_name} (${h.symbol})\n보유 ${h.quantity}주 · 평균 매수가 ${Math.round(Number(h.total_cost)/h.quantity).toLocaleString('ko-KR')}코인`;
    try{const q=await prices.getQuote(h.symbol),fx=q.currency==='USD'?await prices.getExchangeRate():1;const value=Math.round(q.price*fx*h.quantity),gain=value-Number(h.total_cost),rate=Number(h.total_cost)?gain/Number(h.total_cost)*100:0;return `${base}\n평가액 ${value.toLocaleString('ko-KR')}코인 · 평가손익 ${gain.toLocaleString('ko-KR')} (${rate.toFixed(2)}%)\n시세 ${q.quotedAt}`;}catch{return base+'\n평가 시세 조회 실패 · 원금 기록은 유지됩니다.';}
   }));await send('📊 내 보유 주식\n'+(values.join('\n\n')||'보유 주식이 없습니다.'));
  }else if(cmd==='!주식보유순위'){
   const r=await getPool().query('SELECT w.user_name,sum(h.total_cost)::text AS cost FROM hz_stock_holdings h JOIN hz_wallets w USING(room_id,user_id) WHERE h.room_id=$1 GROUP BY h.user_id,w.user_name ORDER BY sum(h.total_cost) DESC LIMIT 10',[String(roomId)]);await send('🏆 주식 보유 순위 (매수원금 기준)\n'+(r.rows.map((r,i)=>`${i+1}. ${r.user_name}: ${Number(r.cost).toLocaleString('ko-KR')}코인`).join('\n')||'기록 없음'));
  }else if(cmd==='!주식알림설정'){
   if(args.length!==3||!['이상','이하'].includes(args[2])||!/^\d+(?:\.\d{1,2})?$/.test(args[1]))throw Error('사용법: !주식알림설정 종목 금액 이상/이하 (해당 종목 통화 기준)');
   const threshold=Number(args[1]);if(!Number.isSafeInteger(threshold)||threshold<=0||threshold>1e12)throw Error('알림 금액은 1~1조 정수입니다.');
   const r=await getPool().query('SELECT count(*)::int AS n FROM gl_stock_alerts WHERE room_id=$1 AND user_id=$2 AND enabled',[String(roomId),String(userId)]);if(r.rows[0].n>=10)throw Error('사용자별 알림은 최대 10개입니다.');
   const q=await prices.getQuote(args[0]);await getPool().query('INSERT INTO gl_stock_alerts(room_id,user_id,symbol,stock_name,threshold,direction) VALUES($1,$2,$3,$4,$5,$6)',[String(roomId),String(userId),q.symbol,q.name,threshold,args[2]==='이상'?'above':'below']);await send(`🔔 ${q.name} ${threshold} ${q.currency} ${args[2]} 알림 등록`);
  }else if(cmd==='!주식알림해제'){
   if(args[0]&& !/^\d+$/.test(args[0]))throw Error('사용법: !주식알림해제 [알림번호]');
   await getPool().query('UPDATE gl_stock_alerts SET enabled=FALSE WHERE room_id=$1 AND user_id=$2 AND ($3::bigint IS NULL OR id=$3)',[String(roomId),String(userId),args[0]||null]);await send('🔕 알림을 해제했습니다.');
  }else{
   const r=await getPool().query('SELECT id,stock_name,threshold,direction FROM gl_stock_alerts WHERE room_id=$1 AND user_id=$2 AND enabled ORDER BY id',[String(roomId),String(userId)]);await send('🔔 내 주식 알림\n'+(r.rows.map(a=>`${a.id}. ${a.stock_name} ${a.threshold} ${a.direction==='above'?'이상':'이하'}`).join('\n')||'등록된 알림 없음'));
  }
 }catch(e){await send('❌ '+e.message);}return true;
}
let busy=false;
async function tick(chat){if(busy||!chat)return;busy=true;try{
 const rows=await getPool().query("SELECT a.* FROM gl_stock_alerts a JOIN hz_rooms r USING(room_id) WHERE a.enabled AND r.data->>'game'='true' ORDER BY a.id LIMIT 200");
 const quotes=new Map();
 for(const a of rows.rows){
  try{
   if(!quotes.has(a.symbol))quotes.set(a.symbol,await prices.getQuote(a.symbol));const q=quotes.get(a.symbol);
   if(Date.now()-new Date(q.quotedAt).getTime()>15*60000)continue;
   if(a.direction==='above'?q.price<Number(a.threshold):q.price>Number(a.threshold))continue;
   const r=await getPool().query('UPDATE gl_stock_alerts SET enabled=FALSE WHERE id=$1 AND enabled RETURNING id',[a.id]);
   if(r.rowCount)await chat.sendText(a.room_id,`🔔 주식 알림 #${a.id}\n${a.stock_name}: ${q.price} ${q.currency}\n설정한 가격 조건에 도달했습니다.`);
  }catch(e){console.error('[GL 주식 알림]',e.message);}
 }
}finally{busy=false;}}
module.exports={handle,tick};
