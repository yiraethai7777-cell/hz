'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {routes,status}=require('./routes');
const assets=new Map([['/',['public-web/index.html','text/html']],['/style.css',['public-web/style.css','text/css']],['/app.js',['public-web/app.js','text/javascript']],['/admin',['admin-web/index.html','text/html']],['/admin/',['admin-web/index.html','text/html']],['/admin/admin.js',['admin-web/admin.js','text/javascript']]]);

const rate=new Map();
for(const [route,file,type] of [['/promo','index.html','text/html'],['/promo/','index.html','text/html'],['/promo/style.css','style.css','text/css'],['/promo/app.js','app.js','text/javascript']])assets.set(route,['promo-web/'+file,type]);
async function body(req){let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>16384){const e=Error('요청 크기를 초과했습니다.');e.status=413;throw e;}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{const e=Error('올바른 JSON을 입력해 주세요.');e.status=400;throw e;}}
function json(res,code,value){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function handler(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/health'){json(res,status.ready?200:503,{ready:status.ready,connected:status.connected});return;}
  if(url.pathname.startsWith('/api/')){
   const key=req.socket.remoteAddress||'unknown',now=Date.now();let bucket=rate.get(key);if(!bucket||now-bucket.start>60000){bucket={start:now,count:0};rate.set(key,bucket);}if(++bucket.count>(url.pathname==='/api/promo/qr/poll'?3000:600)){json(res,429,{error:'잠시 후 다시 시도해 주세요.'});return;}if(rate.size>10000)rate.delete(rate.keys().next().value);
   if(url.pathname.startsWith('/api/valorant/')){
    await require('../shared/valorant-optin').http(req,res,url);
    return;
   }
   let data={};if(req.method!=='GET'){
    if(!String(req.headers['content-type']||'').startsWith('application/json')){json(res,415,{error:'JSON 요청만 지원합니다.'});return;}
    data=await body(req);
    if(['/api/login','/api/promo/login','/api/promo/register'].includes(url.pathname)||url.pathname.startsWith('/api/promo/qr/')){
     const proto=req.headers['x-forwarded-proto']==='https'?'https':'http';
     if(req.headers.origin!==`${proto}://${req.headers.host}`){json(res,403,{error:'요청 출처를 확인해 주세요.'});return;}
    }
   }
   json(res,200,await routes(req,res,url,data));return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  const asset=assets.get(url.pathname);if(!asset){res.writeHead(404);res.end('Not Found');return;}
  const file=await fs.readFile(path.join(__dirname,'..',asset[0]));res.writeHead(200,{'Content-Type':asset[1]+(asset[1].startsWith('text/')?'; charset=utf-8':''),'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:file);
 }catch(e){const code=e.status|| (e.code?503:400);if(e.code)console.error('[WEB]',e.code);json(res,code,{error:e.code?'데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.':e.message||'요청 실패'});}
}
function start({client,ready,port=Number(process.env.PORT||3000),host='0.0.0.0'}={}){
 const server=http.createServer(handler);server.requestTimeout=20000;server.headersTimeout=15000;
 status.chat=client?.chat||client;
 status.client=client;
 client?.on('ready',()=>{status.connected=true;});client?.on('disconnected',()=>{status.connected=false;});
 client?.on('error',e=>{status.errors.push(new Date().toISOString()+' · '+String(e.code||e.name||'연결 오류').slice(0,80));if(status.errors.length>20)status.errors.shift();});
 Promise.resolve(ready).then(async()=>{await require('../promotion/kakao').service().start();status.ready=true;}).catch(()=>{status.ready=false;});
 server.on('error',e=>{console.error('[WEB] 서버 오류:',e.code);});server.listen(port,host,()=>console.log('[WEB] listening on port '+server.address().port));return server;
}
module.exports={handler,start};
