'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PNG}=require('pngjs'),{renderAttendance,buildSvg,layoutName}=require('../manage/attendance-image/render');
const fixture=(name,today='2026-10-19',extra={})=>({name,today,attendanceDate:today,streak:1,total:1,reward:'30000',dates:[today],...extra});
test('renderer keeps the template dimensions, escapes text, fits names and has dynamic dates and checks',async()=>{
 const input=fixture('<닉&"이름>', '2024-02-29',{streak:100,total:1000,reward:'129000',dates:['2024-02-01','2024-02-29']});
 const svg=buildSvg(input);assert.ok(svg.includes('&lt;닉&amp;&quot;이름&gt;'));assert.doesNotMatch(svg,/N\s*E\s*X\s*U\s*S/i);assert.match(svg,/출석체크/);assert.doesNotMatch(svg,/>[^<]*(헤이즈|585)[^<]*</);assert.match(svg,/2024년 2월/);assert.match(svg,/data-date="2024-02-29" data-attended="true"/);assert.match(svg,/data-date="2024-02-28" data-attended="false"/);
 const output=PNG.sync.read(await renderAttendance(input));assert.equal(output.width,1448);assert.equal(output.height,1086);
 const name=layoutName('아주아주긴한글닉네임'.repeat(20));assert.ok(name.lines.length<=2);assert.ok(name.lines.at(-1).endsWith('…'));
 assert.throws(()=>buildSvg(fixture('x','2026-02-29')),/date/);
 assert.throws(()=>buildSvg(fixture('x','2026-10-19',{reward:'<svg>'})),/reward/);
});
test('concurrent PNG generation does not share personal text or image buffers',async()=>{
 const inputs=Array.from({length:6},(_,i)=>fixture('동시 사용자 '+i,'2026-12-31',{reward:String(30000+i*1000),total:1000+i}));
 const buffers=await Promise.all(inputs.map(renderAttendance));
 assert.equal(new Set(buffers.map(b=>crypto.createHash('sha256').update(b).digest('hex'))).size,6);
 for(const b of buffers){assert.ok(b.length<1500000);assert.equal(PNG.sync.read(b).width,1448);}
});
module.exports={fixture};
