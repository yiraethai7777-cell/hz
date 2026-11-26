'use strict';
const fs=require('node:fs'),path=require('node:path');
const {startKakao}=require('./duke/kakao');
const {connectDatabase}=require('./duke/database');
const authPath=process.env.KAKAO_AUTH_PATH||'/app/data/auth.json';
async function main(){
 if(process.env.KAKAO_AUTH_B64){fs.mkdirSync(path.dirname(authPath),{recursive:true});const content=Buffer.from(process.env.KAKAO_AUTH_B64,'base64');JSON.parse(content.toString('utf8'));fs.writeFileSync(authPath,content,{mode:0o600});}
 const dataDir=process.env.DUKE_DATA_DIR||'/app/data/duke-v1';
 const database=await connectDatabase({dir:dataDir,url:process.env.DUKE_DATABASE_URL});
 await startKakao({authPath,dataDir,database,website:process.env.DUKE_WEBSITE||'제작 예정',roomList:process.env.DUKE_TEST_ROOMS});
}
main().catch(e=>{console.error('[DUKE] startup failed',e?.name||'Error');process.exit(1);});
