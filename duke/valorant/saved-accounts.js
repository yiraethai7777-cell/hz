'use strict';
const fs=require('node:fs'),path=require('node:path');
const stats=require('./valorant-stats');
const MAX_SAVED=20;
const validUser=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v);
function createSavedAccounts({dir,onPersist=()=>{}}={}){
 const folder=dir?path.join(dir,'valorant-accounts'):null;
 if(folder)fs.mkdirSync(folder,{recursive:true,mode:0o700});
 function key(user){if(!validUser(user))throw Error('invalid user');if(!folder)throw Error('storage unavailable');return 'valorant-accounts/'+user+'.json';}
 function list(user){
  const k=key(user);
  try{
   const rows=JSON.parse(fs.readFileSync(path.join(dir,k),'utf8'));
   if(!Array.isArray(rows)||rows.length>MAX_SAVED||rows.some(row=>{const parsed=stats.parse('!발로전적 '+row?.name+'#'+row?.tag+' '+row?.region);return !parsed||parsed.error||parsed.usage||parsed.name!==row.name||parsed.tag!==row.tag||parsed.region!==row.region;}))throw Error('invalid saved account data');
   return rows;
  }catch(e){if(e.code==='ENOENT')return [];throw e;}
 }
 function save(user,target){
  const rows=list(user);
  const same=row=>row.name.normalize('NFC').toLocaleLowerCase('en-US')===target.name.normalize('NFC').toLocaleLowerCase('en-US')&&row.tag.normalize('NFC').toLocaleLowerCase('en-US')===target.tag.normalize('NFC').toLocaleLowerCase('en-US')&&row.region===target.region;
  const found=rows.findIndex(same);
  if(found>=0)return {index:found+1,count:rows.length,already:true};
  if(rows.length>=MAX_SAVED)return {full:true};
  rows.push({name:target.name,tag:target.tag,region:target.region});
  const k=key(user),file=path.join(dir,k),tmp=file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(rows),{mode:0o600});
  fs.renameSync(tmp,file);
  onPersist(k);
  return {index:rows.length,count:rows.length,already:false};
 }
 return {list,save};
}
module.exports={createSavedAccounts,MAX_SAVED};
