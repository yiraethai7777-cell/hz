'use strict';
// Compatibility helper: both regular and ARDEN rooms receive one immediate text.
// No progress animation, editMessage calls or artificial delays.
async function send(ctx,result){
 await ctx.send(result);
 return 'normal';
}
module.exports={send};
