'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {createProfilePhoto,validImageUrl,downloadImage}=require('../utility/profile-photo'),{createCore}=require('../core');
test('profile photo: actual file first, then original link; target, temp cleanup, and failure',async()=>{
 const actions=[];let at=10000,uploadedFile;
 const url='https://k.kakaocdn.net/dn/example/profile.jpg',data=Buffer.from([255,216,255,224,1,2,3,4]);
 const core=createCore({send:async(r,t)=>actions.push(['text',t])});
 createProfilePhoto({now:()=>at,lookup:async(r,u)=>{actions.push(['lookup',r,u]);return {name:'회원',imageUrl:url};},download:async()=>({data}),sendPhoto:async(r,f,opts)=>{uploadedFile=f;assert.deepEqual(await fs.readFile(f),data);assert.equal(opts.mime,'image/jpeg');actions.push(['photo',r]);return {complete:{status:0}};}}).register(core);
 const run=(text,extra={})=>core.handle({text,userId:'2000',roomId:'1000',msg:{room:{isOpenChat:true},...extra}});
 await run('-프사');assert.deepEqual(actions,[['lookup','1000','2000'],['photo','1000'],['text','회원님의 프사 링크\n'+url]]);
 await assert.rejects(fs.stat(uploadedFile),{code:'ENOENT'});
 at+=6000;await run('-프사 @회원',{attachmentsRaw:[{mentions:[{userId:'3000'}]}]});assert.deepEqual(actions.at(-3),['lookup','1000','3000']);
 at+=6000;await run('-프사 4000');assert.deepEqual(actions.at(-3),['lookup','1000','4000']);
});
test('photo URL allowlist, image bytes, unsafe redirect',async()=>{
 assert.equal(validImageUrl('https://k.kakaocdn.net.evil.com/p.jpg'),'');assert.equal(validImageUrl('http://k.kakaocdn.net/p.jpg'),'');
 await assert.rejects(downloadImage('https://k.kakaocdn.net/p.jpg',{fetcher:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1'}})}),/unsupported redirect/);
 await assert.rejects(downloadImage('https://k.kakaocdn.net/p.jpg',{fetcher:async()=>new Response('not image')}),/unsupported image/);
});
