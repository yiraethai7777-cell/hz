'use strict';
const {performance}=require('node:perf_hooks');
const {createMetrics,createCounter}=require('./metrics');
const PREFIX='-',VERSION=require('./package.json').version,LINE='━━━━━━━━━━━━━━',FOLD='\u200b'.repeat(1200);
function format(section,body){return '♛ 𝗗𝗨𝗞𝗘 | '+section+'\n'+LINE+'\n'+body;}
function bar(p){if(!Number.isFinite(p))return '측정 대기';const n=Math.round(Math.min(100,Math.max(0,p))/10);return '▰'.repeat(n)+'▱'.repeat(10-n);}
function uptime(seconds){return Math.floor(seconds/86400)+'일 '+Math.floor(seconds/3600)%24+'시간 '+Math.floor(seconds/60)%60+'분 '+seconds%60+'초';}
const mb=n=>Math.round(n/1048576),count=n=>Number.isSafeInteger(n)?n.toLocaleString('ko-KR')+'회':'미연동';
// Monotonic elapsed time from SDK message receipt to command recognition.
function formatRecognition(receivedAt,recognizedAt){
 const delta=recognizedAt-receivedAt;
 if(!Number.isFinite(delta)||delta<0)return '측정 실패';
 if(delta<1)return delta.toFixed(3)+'ms';
 return Math.round(delta)+'ms';
}
function createCore({send,logger=console,allowedRooms=null,now=Date.now,clock=()=>performance.now(),metrics=createMetrics(),counter=createCounter({now}),getStatus=()=>({}),website='제작 예정'}={}){
 if(typeof send!=='function')throw new TypeError('send required');const commands=new Map(),started=now();let lastAck=null;
 function register({name,section='SYSTEM',description='',execute}){if(!/^[\p{L}\p{N}]+$/u.test(name)||typeof execute!=='function'||commands.has(name))throw Error('Invalid or duplicate command');commands.set(name,{name,section,description,execute});}
 register({name:'도움말',description:'명령어 안내',execute:()=>format('COMMAND','[ 기본 명령어 ]\n\n'+[...commands.values()].map(c=>PREFIX+c.name+' : '+c.description).join('\n')+'\n\n'+LINE+'\nDUKE SYSTEM v'+VERSION)});
 register({name:'핑',description:'봇 응답 확인',execute:({recognitionDelay})=>format('SYSTEM','상태 : ONLINE\n응답 : '+recognitionDelay+'\n'+LINE)});
 register({name:'봇정보',description:'봇 정보 확인',execute:()=>format('INFORMATION','봇 이름 : 듀크봇 (DUKE)\n버전 : v'+VERSION+'\n접두사 : -\n개발 언어 : Node.js\n개발 상태 : 개발 중\n\n'+LINE+'\n[ 공식 링크 ]\n\n제작자 : 듀크\n제작자 오픈프로필 :\nhttps://open.kakao.com/o/sUBJvGYi\n\n공식 웹사이트 : '+website+'\n\n'+LINE+'\nDUKE © SYSTEM')});
 register({name:'봇상태',description:'시스템 및 서버 상태 확인',execute:async()=>{const s=await getStatus(),m=metrics.sample(),c=counter.get(),p=m.limit?100*m.used/m.limit:null;const conn=s.kakaoConnected===true?'정상':s.kakaoConnected===false?'미연결':'미확인';const summary=format('STATUS','서버 상태 : ONLINE\n시스템 상태 : '+(s.kakaoConnected===true?'정상':'연결 미확인')+'\n버전 : v'+VERSION);return summary+FOLD+'\n\n'+LINE+'\n[ 시스템 상태 ]\n\n서버 상태 : ONLINE\n데이터베이스 : '+(s.database??'미연결')+'\n카카오톡 연결 : '+conn+'\n관리 시스템 : '+(s.manage??'개발 예정')+'\n게임 시스템 : '+(s.game??'개발 예정')+'\n\n'+LINE+'\n[ 서버 성능 ]\n\nCPU　'+(m.cpu===null?'측정 대기':m.cpu.toFixed(1)+'%')+'\n'+bar(m.cpu)+'\n\nRAM　'+mb(m.used)+' / '+(m.limit?mb(m.limit)+' MB':'한도 미확인 (MB)')+'\n'+bar(p)+'\n\n응답 속도 : '+(lastAck===null?'측정 대기':lastAck+'ms (최근 전송)')+'\nDB 응답 속도 : '+(Number.isFinite(s.dbMs)?s.dbMs+'ms':'미연결')+'\n가동 시간 : '+uptime(Math.max(0,Math.floor((now()-started)/1000)))+'\n\n'+LINE+'\n[ 운영 현황 ]\n\n전체 채팅방 : '+(s.rooms??'미연동')+'\n관리 활성화 : '+(s.manageRooms??'미연동')+'\n게임 활성화 : '+(s.gameRooms??'미연동')+'\n오늘 명령어 : '+count(c.today)+'\n전체 명령어 : '+count(c.total)+(c.persistent?'':' (현재 실행 기준)')+'\n진행 중인 보이스룸 : '+(s.voiceRooms??'미연동')+'\n\n'+LINE+'\nDUKE SYSTEM v'+VERSION;}});
 async function handle(event){const enteredAt=clock();const receivedAt=Number.isFinite(event?.receivedAt)&&event.receivedAt>=0&&event.receivedAt<=enteredAt?event.receivedAt:enteredAt;if(!event||typeof event.text!=='string'||!event.roomId||!event.userId)return false;if(allowedRooms&&!allowedRooms.has(event.roomId))return false;if(!event.text.startsWith(PREFIX))return false;let [name,...args]=event.text.slice(1).trim().split(/\s+/u);if(name==='상태')name='봇상태';const command=commands.get(name);if(!command)return false;const recognitionDelay=name==='핑'?formatRecognition(receivedAt,clock()):null;try{counter.record();const result=await command.execute({...event,args,format,receivedAt,recognitionDelay});if(typeof result==='string'&&result.length){const sentAt=clock();await send(event.roomId,result);lastAck=Math.max(0,Math.round(clock()-sentAt));}return true;}catch(error){logger.error('[DUKE] command failed',name,error?.name||'Error');return false;}}
 return {register,handle};
}
module.exports={createCore,format,PREFIX};
