'use strict';
const clean=s=>String(s??'').replace(/[\x00-\x1f\x7f]/g,' ').trim();
const parseRiot=s=>{const m=/^(.{1,32}?)\s*#\s*(.{1,10})$/.exec(clean(s));return m?{name:m[1].trim(),tag:m[2].trim()}:null};
const command=s=>clean(s).split(/\s+/)[0];
const tail=s=>clean(s).slice(command(s).length).trim();
const tier=s=>clean(s).slice(0,50);
const limit=(n,a,b)=>Number.isInteger(Number(n))&&Number(n)>=a&&Number(n)<=b?Number(n):null;
module.exports={clean,parseRiot,command,tail,tier,limit};