'use strict';
// The Manager already checks licenses, game-mode enablement, and bot power
// before dispatch. School's fixed campus room IDs must never be used here.
const BASE_ROOM_IDS=[];
const ROOM_IDS=[];
const isAllowedRoom=room=>/^[1-9]\d{3,24}$/.test(String(room??''));
module.exports={BASE_ROOM_IDS,ROOM_IDS,isAllowedRoom};