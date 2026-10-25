'use strict';

const {getPool}=require('./db');
const DEFAULTS=Object.freeze({
  speedMs:35,
  announcement:'',
  winMessage:'🎉 축하합니다!\n{멘션}님이 카운트 도전에 성공했습니다!',
  earlyMessage:'🚫 탈락!\n{멘션}님은 카운트 시작 전에 답장했습니다.',
  timeoutMessage:'⌛ 시간 초과!\n{멘션}님이 카운트 종료까지 답장하지 않았습니다.'
});
const COLUMNS={speedMs:'speed_ms',announcement:'announcement',
  winMessage:'win_message',earlyMessage:'early_message',timeoutMessage:'timeout_message'};
const COMMANDS={'!이벤공지작성':'announcement','!이벤당첨문구':'winMessage',
  '!이벤탈락문구':'earlyMessage','!이벤시간초과문구':'timeoutMessage'};
const init=new WeakMap();

function validateRoom(roomId) {
  const id=String(roomId??'');
  if(!/^[1-9]\d*$/.test(id))throw Error('올바른 채팅방 ID가 필요합니다.');
  return id;
}
function checkSpeed(value) {
  const v=String(value??'').trim();
  if(!/^\d+$/.test(v))throw Error('숫자로 입력해 주세요. 예: !이벤속도 500');
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<35||n>10000)
    throw Error('35~10000ms 범위로 설정해 주세요.');
  return n;
}
function cleanText(value,max=1000) {
  const s=String(value??'').replace(/\r\n?/g,'\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g,'').trim();
  if(!s)throw Error('내용을 입력해 주세요.');
  if(s.length>max)throw Error('내용은 최대 '+max+'자입니다.');
  return s;
}
function render(template,{name='',mention='',count=0}={},forceMention=false) {
  const cleanName=String(name||'참가자').replace(/[\u0002\u0003\u0004]/g,'');
  const raw=String(template||'');
  const hasMention=/\{(?:멘션|mention)\}/i.test(raw);
  const formatted=raw.replace(/\{(?:멘션|mention)\}/gi,()=>mention||'@'+cleanName)
    .replace(/\{(?:닉네임|name)\}/gi,()=>cleanName)
    .replace(/\{(?:인원|count)\}/gi,()=>String(count));
  return forceMention && mention && !hasMention ? mention+'\n'+formatted : formatted;
}
async function ensureTable(pool) {
  let p=init.get(pool);
  if(!p){
    const ddl="CREATE TABLE IF NOT EXISTS hz_event_room_settings ("+
      "room_id TEXT PRIMARY KEY,"+
      "speed_ms INTEGER NOT NULL DEFAULT 35,"+
      "announcement TEXT NOT NULL DEFAULT '',"+
      "win_message TEXT NOT NULL DEFAULT '',"+
      "early_message TEXT NOT NULL DEFAULT '',"+
      "timeout_message TEXT NOT NULL DEFAULT '',"+
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";
    p=pool.query(ddl).catch(e=>{init.delete(pool);throw e;});
    init.set(pool,p);
  }
  await p;
}
async function load(roomId,{pool}={}) {
  const id=validateRoom(roomId);
  // Development/test environments without Postgres can use safe defaults.
  if(!pool&&!process.env.DATABASE_URL)return {...DEFAULTS};
  pool=pool||getPool();
  await ensureTable(pool);
  const res=await pool.query(
    'SELECT speed_ms,announcement,win_message,early_message,timeout_message FROM hz_event_room_settings WHERE room_id=$1',[id]);
  const row=res.rows[0];
  if(!row)return {...DEFAULTS};
  const v=Number(row.speed_ms);
  return {
    speedMs:Number.isSafeInteger(v)&&v>=35&&v<=10000?v:DEFAULTS.speedMs,
    announcement:String(row.announcement||''),
    winMessage:String(row.win_message||DEFAULTS.winMessage),
    earlyMessage:String(row.early_message||DEFAULTS.earlyMessage),
    timeoutMessage:String(row.timeout_message||DEFAULTS.timeoutMessage)
  };
}
async function save(roomId,field,value,{pool}={}) {
  const id=validateRoom(roomId),column=COLUMNS[field];
  if(!column)throw Error('알 수 없는 설정입니다.');
  const result=field==='speedMs'?checkSpeed(value):cleanText(value,field==='announcement'?2000:1000);
  pool=pool||getPool();
  await ensureTable(pool);
  await pool.query('INSERT INTO hz_event_room_settings (room_id,'+column+') VALUES ($1,$2) '+
    'ON CONFLICT (room_id) DO UPDATE SET '+column+'=EXCLUDED.'+column+',updated_at=NOW()',[id,result]);
  return result;
}
async function reset(roomId,field,{pool}={}) {
  const id=validateRoom(roomId),column=COLUMNS[field];
  if(!column)throw Error('알 수 없는 설정입니다.');
  pool=pool||getPool();
  await ensureTable(pool);
  await pool.query('INSERT INTO hz_event_room_settings (room_id) VALUES ($1) ON CONFLICT DO NOTHING',[id]);
  await pool.query('UPDATE hz_event_room_settings SET '+column+'=$2,updated_at=NOW() WHERE room_id=$1',[id,DEFAULTS[field]]);
}
async function reply(client,send,text) {
  if(client?.connected===false)return;
  try{await send(text);}catch(e){console.warn('[이벤 설정] 전송 실패:',String(e?.message||e));}
}
const HELP=[
  '⚙️ APEX 이벤트 설정','━━━━━━━━━━━━━━',
  '!이벤트시작 — APEX 참가자만 추첨',
  '!이벤시작랜덤방 — APEX 조건 없이 전체 참가자 추첨',
  '!이벤트중지 — 진행 중인 반복 이벤트 종료',
  '!이벤설정 — 설정 확인','!이벤속도 500 — 카운트 대기(ms)',
  '!이벤공지작성 내용 — 이벤트 공지 저장',
  '!이벤공지 — 작성한 공지 전송',
  '!이벤당첨문구 내용 — 성공 문구',
  '!이벤탈락문구 내용 — 조기 답변 문구',
  '!이벤시간초과문구 내용 — 시간 초과 문구',
  '!이벤초기화 당첨|탈락|시간초과|공지|속도',
  '━━━━━━━━━━━━━━','문구 변수: {멘션} {닉네임} {인원}',
  '설정 속도: 35~10000ms (카카오 자체 전송 간격 별도)',
  '문구에 줄바꿈을 넣을 수 있습니다.'
].join('\n');
async function handle({client,roomId,msg,text,send,roomBotAdmin=false,store={load,save,reset}}) {
  const str=String(text??'').trim();
  const commands=['!이벤설정','!이벤속도','!이벤공지작성','!이벤공지',
    '!이벤당첨문구','!이벤탈락문구','!이벤시간초과문구','!이벤초기화'];
  const command=commands.find(p=>str===p||str.startsWith(p+' ')||str.startsWith(p+'\n'));
  if(!command)return false;
  if(msg?.room?.isOpenChat!==true) {
    await reply(client,send,'오픈채팅방에서만 설정할 수 있습니다.');return true;
  }
  if(!roomBotAdmin&&![1,4].includes(Number(msg?.sender?.type))) {
    await reply(client,send,'방장 또는 부방장만 설정할 수 있습니다.');return true;
  }
  const value=str.slice(command.length).trim();
  try{
    if(command==='!이벤설정') {
      const cur=await store.load(roomId);
      await reply(client,send,HELP+'\n\n현재 속도: '+cur.speedMs+'ms'+
        '\n공지: '+(cur.announcement?'설정됨':'없음')+
        '\n당첨 문구: '+cur.winMessage+'\n탈락 문구: '+cur.earlyMessage+
        '\n시간 초과 문구: '+cur.timeoutMessage);
    } else if(command==='!이벤공지') {
      const cur=await store.load(roomId);
      await reply(client,send,cur.announcement?'📢 APEX 이벤트 공지\n━━━━━━━━━━━━━━\n'+cur.announcement:
        '저장된 공지가 없습니다. !이벤공지작성 내용 으로 작성하세요.');
    } else if(command==='!이벤초기화') {
      const mapping={당첨:'winMessage',탈락:'earlyMessage',시간초과:'timeoutMessage',
        공지:'announcement',속도:'speedMs'};
      if(!mapping[value])throw Error('초기화 항목은 당첨, 탈락, 시간초과, 공지, 속도입니다.');
      await store.reset(roomId,mapping[value]);
      await reply(client,send,'✅ '+value+' 설정이 초기화되었습니다.');
    } else if(command==='!이벤속도') {
      const n=await store.save(roomId,'speedMs',value);
      await reply(client,send,'✅ 카운트 대기를 '+n+'ms로 설정했습니다.\n카카오톡 전송 속도는 별도 적용됩니다.');
    } else {
      const field=COMMANDS[command];
      const name={announcement:'시작 공지',winMessage:'당첨 문구',
        earlyMessage:'조기 탈락 문구',timeoutMessage:'시간 초과 문구'}[field];
      const valueSaved=await store.save(roomId,field,value);
      await reply(client,send,'✅ '+name+' 저장 완료\n━━━━━━━━━━━━━━\n'+valueSaved);
    }
  }catch(e) {
    console.error('[이벤 설정] 오류:',String(e?.message||e));
    await reply(client,send,'❌ 설정 실패: '+String(e?.message||e));
  }
  return true;
}
module.exports={DEFAULTS,checkSpeed,cleanText,render,load,save,reset,handle,HELP};
