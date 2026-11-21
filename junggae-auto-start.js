'use strict';
// Windows PowerShell runner. Monitors explicitly chosen rooms ONLY and sends
// the existing junggae-start wording in the same room. No database or Railway.
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {matches}=require('./shared/junggae-rule');

const DEDUPE_MS=120000;
const ROOM_ID=/^[1-9]\d{7,24}$/;

function parseArgs(argv){
 const rooms=new Set();
 let auth=path.join(__dirname,'auth.json');
 let messageFile=path.join(__dirname,'junggae-start.txt');
 let dryRun=false;
 let discover=false;
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--room'||arg==='--rooms'){
   const value=argv[++i];
   if(!value)throw Error(arg+' 뒤에 감지할 채팅방 ID가 필요합니다.');
   for(const room of value.split(',')){
    const id=room.trim();
    if(!ROOM_ID.test(id))throw Error('채팅방 ID가 올바르지 않습니다: '+id);
    rooms.add(id);
   }
  }else if(arg==='--auth'){
   const value=argv[++i];
   if(!value)throw Error('--auth 뒤에 auth.json 경로가 필요합니다.');
   auth=path.resolve(value);
  }else if(arg==='--message-file'){
   const value=argv[++i];
   if(!value)throw Error('--message-file 뒤에 메시지 텍스트 파일 경로가 필요합니다.');
   messageFile=path.resolve(value);
  }else if(arg==='--dry-run')dryRun=true;
  else if(arg==='--discover')discover=true;
  else throw Error('알 수 없는 옵션: '+arg);
 }
 if(discover&&(rooms.size||dryRun))throw Error('--discover는 --room / --rooms / --dry-run과 함께 사용할 수 없습니다.');
 if(!rooms.size&&!discover)throw Error('방을 반드시 지정해야 합니다. 예: node junggae-auto-start.js --room 18496234145974738\nID 확인: node junggae-auto-start.js --discover');
 return {rooms,auth,messageFile,dryRun,discover};
}

function getMessage(file){
 const content=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').trim();
 if(!content)throw Error('준개 시작 메시지 파일이 비어 있습니다: '+file);
 if(content.length>3500)throw Error('준개 시작 메시지는 최대 3,500자까지 지원합니다.');
 return content;
}

function createWatcher({rooms,client,message,send,dryRun=false,now=Date.now,onEvent=()=>{}}){
 if(!(rooms instanceof Set)||!rooms.size||[...rooms].some(x=>!ROOM_ID.test(x)))
  throw Error('감지할 방 ID를 명시해 주세요.');
 if(typeof send!=='function')throw Error('send 함수가 필요합니다.');
 const recent=new Map();
 return async function receive(chat,msg){
  const room=String(msg?.room?.id??msg?.chatId??msg?.roomId??'');
  if(!rooms.has(room)||msg?.room?.isOpenChat===false)return false;
  const text=String(msg?.message?.text??msg?.text??'').trim();
  const sender=String(msg?.sender?.id??msg?.senderId??msg?.userId??'');
  if(!sender||sender===String(client?.userId??client?.user?.id??'')||!text)return false;
  let checked=msg;
  if(!Number(msg?.sender?.type)&&typeof client?._ensureMemberType==='function'){
   try{
    await client._ensureMemberType(room,sender);
    const type=client._resolveMemberType?.(room,sender);
    checked={...msg,sender:{...msg.sender,id:sender,type}};
   }catch(e){
    onEvent('skip','작성자 권한 확인 실패: '+String(e?.message||e));
    return false;
   }
  }
  if(!matches(text,checked))return false;
  const logId=String(msg?.message?.logId??msg?.logId??msg?.id??'');
  const fingerprint=logId||sender+':'+crypto.createHash('sha256').update(text).digest('hex');
  const key=room+':'+fingerprint;
  const time=now();
  for(const [k,t] of recent)if(time-t>=DEDUPE_MS)recent.delete(k);
  if(recent.has(key))return false;
  recent.set(key,time);
  if(recent.size>3000)recent.delete(recent.keys().next().value);
  onEvent('detected','준개 신청 감지: 방 '+room);
  if(dryRun){onEvent('dry-run','테스트 모드: 실제 카카오톡에는 전송하지 않았습니다.');return true;}
  try{
   const result=await send(chat,room,message);
   const status=result?.status??result?.body?.status;
   if(result===false||result?.success===false||result?.ok===false||
      (status!=null&&Number(status)!==0))
    throw Error('전송 거부'+(status==null?'':' (status '+status+')'));
   onEvent('sent','준개 시작 안내 전송 완료: 방 '+room);
   return true;
  }catch(error){
   // Allow a deliberate retry after a failed send, without affecting other rooms.
   recent.delete(key);
   onEvent('error','전송 실패: '+String(error?.message||error));
   return false;
  }
 };
}

function createRoomDiscoverer({onRoom=()=>{}}={}){
 const seen=new Set();
 return function inspect(msg){
  const id=String(msg?.room?.id??msg?.chatId??msg?.roomId??'');
  if(!ROOM_ID.test(id)||msg?.room?.isOpenChat===false||seen.has(id))return false;
  seen.add(id);
  const name=String(msg?.room?.name??'방 이름 확인 불가').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,100);
  onRoom({id,name});
  return true;
 };
}

async function main(argv=process.argv.slice(2)){
 const options=parseArgs(argv);
 const message=options.discover?null:getMessage(options.messageFile);
 if(!fs.existsSync(options.auth))throw Error('카카오 인증 파일이 없습니다: '+options.auth+
  '\n동일 계정을 Railway와 PC에 동시에 연결하지 마세요. PC 전용 계정을 권장합니다.');
 const {createClient}=require('./dist');
 const client=createClient({authPath:options.auth,autoConnect:false,autoReconnect:true});
 const log=(type,text)=>{
  const output='[준개 자동 시작]['+type+'] '+text;
  if(type==='error')console.error(output);else console.log(output);
 };
 const send=(chat,room,body)=>{
  if(typeof chat?.sendText==='function')return chat.sendText(room,body);
  if(typeof client.chat?.sendText==='function')return client.chat.sendText(room,body);
  throw Error('카카오톡 메시지 전송 API를 찾지 못했습니다.');
 };
 if(options.discover){
  const inspect=createRoomDiscoverer({onRoom:({id,name})=>log('room','방 이름: '+name+' | 방 ID: '+id)});
  client.onMessage(async(chat,msg)=>{try{inspect(msg)}catch(e){log('error',String(e?.message||e))}});
  client.onReady(()=>log('ready','방 ID 확인 모드입니다. 원하는 준개방에 새 메시지를 보내거나 다른 참가자의 메시지를 확인하세요.'));
  log('start','방 ID 확인 모드: 채팅방 메시지는 읽지 않고 이름과 ID만 출력합니다. 카카오톡 메시지는 전송하지 않습니다.');
 }else{
  const receive=createWatcher({...options,client,message,send,onEvent:log});
  client.onMessage(async(chat,msg)=>{try{await receive(chat,msg)}catch(e){log('error',String(e?.message||e))}});
  client.onReady(()=>log('ready','연결 완료. 감지 방: '+[...options.rooms].join(', ')+
   (options.dryRun?' (테스트 모드 — 전송하지 않음)':'')));
  log('start','감지 방: '+[...options.rooms].join(', '));
  log('start','다른 방의 준개 신청은 무시합니다. 종료: Ctrl+C');
 }
 client.on('error',error=>log('error','연결 오류: '+String(error?.message||error)));
 await client.connect();
}

if(require.main===module)main().catch(error=>{console.error('준개 자동 시작 실행 실패:',String(error?.message||error));process.exitCode=1});
module.exports={parseArgs,getMessage,createWatcher,createRoomDiscoverer,main};
