'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {PNG}=require('pngjs');
const {readRanking}=require('../manage/chat-ranking-image/data');
const {renderRanking,buildSvg}=require('../manage/chat-ranking-image/render');
const {sendPng}=require('../manage/attendance-image/send');
const sample={today:'2026-10-24',name:'요청자',top:[{name:'<닉&이름>',count:'9223372036854775807',rank:'1'},{name:'두번째',count:'700',rank:'2'},{name:'세번째',count:'300',rank:'3'}],me:{rank:'11',count:'50'}};
test('ranking snapshot uses room records, deterministic ties, exact BIGINT counts and own rank beyond TOP 10',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();
 try{
  await db.exec('CREATE TABLE gl_manage_chat_counts(room_id TEXT,user_id TEXT,user_name TEXT,count BIGINT)');
  for(let i=1;i<=12;i++)await db.query('INSERT INTO gl_manage_chat_counts VALUES($1,$2,$3,$4)',['100',String(i).padStart(4,'0'),'회원'+i,String(100-i)]);
  await db.query("UPDATE gl_manage_chat_counts SET count=9223372036854775807 WHERE room_id='100' AND user_id IN ('0001','0002')");
  await db.query("INSERT INTO gl_manage_chat_counts VALUES('200','9999','다른방',9223372036854775807)");
  const result=await readRanking(db,{roomId:'100',userId:'0012',userName:'현재 별명',now:new Date('2026-10-23T15:00:00Z')});
  assert.equal(result.today,'2026-10-24');assert.equal(result.top.length,10);assert.equal(result.me.rank,'12');assert.equal(result.name,'현재 별명');
  assert.equal(result.top[0].userId,'0001');assert.equal(result.top[1].userId,'0002');assert.equal(result.top[0].count,'9223372036854775807');
  const absent=await readRanking(db,{roomId:'100',userId:'9000'});assert.equal(absent.me,null);assert.equal(absent.top.length,10);
  const empty=await readRanking(db,{roomId:'300',userId:'0012'});assert.deepEqual(empty.top,[]);assert.equal(empty.me,null);
 }finally{await db.close();}
});
test('ranking renderer escapes nicknames and renders TOP 3 colors at approved dimensions',async()=>{
 const svg=buildSvg(sample);assert.ok(svg.includes('&lt;닉&amp;이름&gt;'));assert.ok(svg.includes('9,223,372,036,854,775,807회'));assert.ok(svg.includes('11위'));
 const output=await renderRanking(sample),png=PNG.sync.read(output);assert.equal(png.width,1200);assert.equal(png.height,1370);assert.ok(output.length<1500000);
 for(const [row,color]of [[0,[217,182,77]],[1,[200,205,212]],[2,[201,140,89]]]){
  const edge=((435+row*78-8)*png.width+83)*4;
  assert.deepEqual([...png.data.subarray(edge,edge+3)],color);
 }
 const empty=buildSvg({...sample,top:[],me:null});assert.ok(empty.includes('아직 채팅 기록이 없습니다.'));assert.ok(empty.includes('미집계'));
});
test('shared photo transport passes ranking dimensions and filename and cleans up',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ranking-test-'));
 try{
  const buffer=PNG.sync.write(new PNG({width:1,height:1}));
  const client={connected:true,sendPhoto:async(room,file,opts)=>{assert.equal(room,'100');assert.equal(opts.width,1200);assert.equal(opts.height,1370);assert.equal(opts.filename,'chat-ranking.png');assert.equal(path.basename(file),'chat-ranking.png');assert.deepEqual(await fs.readFile(file),buffer);return {complete:{status:0}};}};
  await sendPng(client,'100',buffer,{tempRoot:root,width:1200,height:1370,filename:'chat-ranking.png',caption:'순위'});assert.deepEqual(await fs.readdir(root),[]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('ranking upload failure falls back to text and concurrent duplicate requests do not upload twice',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../manage/chat-ranking-image/automatic.js'),'utf8');
 let release,uploads=0,started;const ready=new Promise(r=>started=r),sent=[];
 const deps={'./data':{readRanking:async()=>sample},'./render':{renderRanking:async()=>Buffer.from('png')},'../attendance-image/send':{sendPng:async()=>{uploads++;started();await new Promise(r=>release=r);throw Error('upload failed');}},'../chat-ranking':{messages:async()=>['TOP 10 글 목록']}};
 const m={exports:{}};vm.runInNewContext(source,{module:m,exports:m.exports,require:n=>deps[n],console:{error(){}},Set,String});
 const ctx={roomId:'100',userId:'200',send:async t=>sent.push(t)};
 const first=m.exports.sendRankingImage({},ctx);await ready;
 assert.equal(await m.exports.sendRankingImage({},ctx),false);assert.equal(uploads,1);
 release();assert.equal(await first,false);assert.ok(sent.some(t=>t.includes('글로 안내')));assert.ok(sent.includes('TOP 10 글 목록'));
});
