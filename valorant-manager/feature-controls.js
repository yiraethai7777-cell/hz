'use strict';
// Manager room switches are enforced centrally, before this adapter is called.
const load=async()=>({features:{autoScrim:true}});
const isEnabled=()=>true;
module.exports={load,isEnabled};