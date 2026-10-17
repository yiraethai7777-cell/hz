'use strict';
const {getPool}=require('../shared/db');
let last=0,pending=null;
async function refresh(client){if(!client?.getChatRooms||!client?.getKnownChatRooms||Date.now()-last<30000)return;if(pending)return pending;
 pending=(async()=>{await client.getChatRooms();for(const room of client.getKnownChatRooms()){if(!/^\d{1,24}$/.test(room.id))continue;const name=String(room.name||'').slice(0,200);await getPool().query("INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object('name',$2::text,'game',false,'manage',false)) ON CONFLICT(room_id) DO UPDATE SET data=CASE WHEN $2::text<>'' THEN jsonb_set(hz_rooms.data,'{name}',to_jsonb($2::text)) ELSE hz_rooms.data END",[room.id,name]);}last=Date.now();})();try{await pending;}finally{pending=null;}
}
module.exports={refresh};
