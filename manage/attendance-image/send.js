'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const CAPTION='출석 이미지 전송 테스트 · 예시 데이터입니다. 실제 출석·코인 기록은 변경하지 않았습니다.';
async function sendPng(client,roomId,buffer,{tempRoot=os.tmpdir()}={}){
 if(client?.connected!==true||typeof client.sendPhoto!=='function')throw Error('카카오톡 사진 전송 연결이 필요합니다.');
 const room=String(roomId);if(!/^\d+$/.test(room))throw Error('채팅방 ID 확인 실패');
 if(!Buffer.isBuffer(buffer)||buffer.length>1500000||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('올바른 PNG가 아닙니다.');
 const root=path.resolve(tempRoot),folder=await fs.mkdtemp(path.join(root,'attendance-image-'));
 const owned=path.dirname(path.resolve(folder))===root&&path.basename(folder).startsWith('attendance-image-');
 if(!owned)throw Error('임시 파일 경로 확인 실패');
 try{
  const file=path.join(folder,'attendance.png');await fs.writeFile(file,buffer,{flag:'wx',mode:0o600});
  // The existing KakaoForge path implementation waits for the LOCO COMPLETE packet.
  const result = await client.sendPhoto(room, file, {
  filename: "attendance.png",
  mime: "image/png",
  width: 1448,
  height: 1086
});
  if(!result?.complete||(typeof result.complete.status==='number'&&result.complete.status!==0))throw Error('사진 전송 완료를 확인하지 못했습니다. 테스트방을 확인해 주세요.');
  return {confirmed:true};
 }finally{await fs.rm(folder,{recursive:true,force:true});}
}
module.exports={sendPng,CAPTION};
