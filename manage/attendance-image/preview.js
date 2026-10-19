'use strict';
const {kstDate}=require('./data');
function fail(message,status=400){const e=Error(message);e.status=status;throw e;}
function createService({render=data=>require('./render').renderAttendance(data),deliver=(...args)=>require('./send').sendPng(...args),now=Date.now}={}){
 let busy=false,lastAttempt=null;
 return async(client,input={})=>{
  if(input.confirm!==true)fail('사진 한 장 전송을 확인해 주세요.');
  if(client?.connected!==true||typeof client.getKnownChatRooms!=='function')fail('카카오톡 연결이 필요합니다.',503);
  if(busy)fail('사진 전송 중입니다.',429);
  if(lastAttempt!==null&&now()-lastAttempt<60000)fail('60초 후 다시 시도해 주세요. 테스트방에서 먼저 사진을 확인해 주세요.',429);
  const known=await client.getKnownChatRooms();if(!Array.isArray(known))fail('채팅방 목록을 확인할 수 없습니다.',503);
  const matches=known.filter(r=>String(r.name).trim()==='테스트');
  if(!matches.length)fail('봇이 참여한 채팅방에서 테스트 방을 찾을 수 없습니다.');
  if(matches.length!==1)fail('테스트라는 이름의 방이 여러 개입니다. 방 이름을 구분해 주세요.');
  const room=String(matches[0].id);if(!/^\d+$/.test(room))fail('채팅방 ID 확인 실패');
  // Recheck after the async lookup so concurrent HTTP requests cannot both send.
  if(busy||lastAttempt!==null&&now()-lastAttempt<60000)fail('전송 중이거나 60초 대기 중입니다.',429);
  busy=true;lastAttempt=now();
  try{
   const today=kstDate(new Date(now()));
   const buffer=await render({name:'이미지 전송 테스트',today,attendanceDate:today,streak:1,total:1,reward:'30000',dates:[today]});
   const result=await deliver(client,room,buffer);if(result?.confirmed!==true)fail('사진 전송 완료를 확인하지 못했습니다.',502);
   return {confirmed:true,roomName:'테스트'};
  }finally{busy=false;}
 };
}
const sendTest=createService();
module.exports={createService,sendTest};
