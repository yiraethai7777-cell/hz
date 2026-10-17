'use strict';
const readline=require('node:readline'),{Writable}=require('node:stream'),crypto=require('node:crypto'),fs=require('node:fs');
if(!process.stdin.isTTY){console.error('본인 PC의 터미널에서 직접 실행해 주세요.');process.exit(1);}
let hidden=false;
const output=new Writable({write(chunk,encoding,callback){if(!hidden)process.stdout.write(chunk);callback();}});
const rl=readline.createInterface({input:process.stdin,output,terminal:true});
const ask=prompt=>new Promise(resolve=>{process.stdout.write(prompt);hidden=true;rl.question('',answer=>{hidden=false;process.stdout.write('\n');resolve(answer);});});
(async()=>{const password=await ask('관리자 비밀번호 (12자 이상, 입력 내용은 숨김): '),again=await ask('비밀번호 확인: ');rl.close();if(password.length<12||password.length>256||password!==again)throw Error('12~256자로 동일하게 입력해 주세요.');
const file='.env.admin.local';if(fs.existsSync(file))throw Error('기존 .env.admin.local 파일을 먼저 별도로 보관해 주세요.');
const hash=require('../api/auth').hashPassword(password),secret=crypto.randomBytes(32).toString('hex');fs.writeFileSync(file,'GL_ADMIN_USERNAME=admin\nGL_ADMIN_PASSWORD_HASH='+hash+'\nGL_SESSION_SECRET='+secret+'\n',{flag:'wx',mode:0o600});console.log('완료: '+file+'의 3개 값을 Railway Variables에 직접 추가하세요. 이 파일을 GitHub나 채팅에 올리지 마세요.');})().catch(e=>{rl.close();console.error(e.message);process.exitCode=1;});
