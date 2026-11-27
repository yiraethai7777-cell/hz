'use strict';

// Interpret sanitized VOX 12011 roster evidence for ONLY the current bot.
// This is a receive-only role observer, not an invitation accepter.
const ROLES=Object.freeze({
  moderators:'moderator',
  speakers:'speaker',
  listeners:'listener',
});
function ownRole(packet) {
  if(packet?.method!==12011 || !packet.memberGroups ||
      typeof packet.memberGroups!=='object')return null;
  const observed=Object.entries(ROLES).filter(([group])=>
    packet.memberGroups[group]?.own==='present').map(([,role])=>role);
  // A delta may omit a member. Conflicting groups are not proof of a role.
  if(observed.length!==1)return null;
  const group=Object.keys(ROLES).find(key=>ROLES[key]===observed[0]);
  const own=packet.memberGroups[group]?.ownStates||{};
  return Object.freeze({
    role:observed[0],
    source:'vox-12011-own-roster',
    mic:typeof own.mic==='boolean'?own.mic:null,
  });
}
function roleLabel(role) {
  switch(role){
    case 'moderator':return '진행자';
    case 'speaker':return '스피커';
    case 'listener':return '리스너';
    default:return '미확인';
  }
}
module.exports={ownRole,roleLabel};
