'use strict';
// KakaoTalk long-message folding, matching the existing NEXI help output.
// Keep the title visible; show the remaining details after the native "더보기".
const FOLD='\u200b'.repeat(1200);
function fold(header,details){
 return String(header)+FOLD+'\n'+String(details);
}
module.exports={fold,FOLD};
