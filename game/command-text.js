'use strict';
// Repair copy/paste formatting only; sender IDs and original message events are untouched.
function normalize(value){return String(value??'').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(all,hex,dec)=>{const n=parseInt(hex||dec,hex?16:10);return n===32||n===160||n>=0xac00&&n<=0xd7a3?String.fromCodePoint(n):all;}).replace(/&nbsp;/gi,' ').replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g,'').trim();}
module.exports={normalize};
