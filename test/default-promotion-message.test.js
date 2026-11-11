'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const promotion=require('../promotion');
const {message,FOLD_SPACER}=require('../promotion/default-message');

function fakeDb(initial=null){
 let stored=initial;
 const calls=[];
 return {
  calls,
  async query(sql,params=[]){
   calls.push(sql);
   if(sql.startsWith('SELECT message FROM gl_bot_promotion_settings')){
    return {rowCount:stored===null?0:1,rows:stored===null?[]:[{message:stored}]};
   }
   if(sql.startsWith('INSERT INTO gl_bot_promotion_settings')){
    if(stored===null)stored=params[0];
    return {rowCount:1};
   }
   throw Error('Unexpected SQL in test: '+sql);
  }
 };
}

test('default promo is short enough for web storage and folds before details',()=>{
 assert.ok(message.length<=4000);
 assert.equal(FOLD_SPACER.length,1200);
 assert.ok(message.indexOf(FOLD_SPACER)>0);
 assert.ok(message.includes('카카오톡 매니저'));
 assert.ok(message.includes('https://open.kakao.com/o/gK32HUUi'));
});

test('seeds default promo when shared promotion has never been configured',async()=>{
 const db=fakeDb();
 assert.equal(await promotion.commonMessage(db),message);
 assert.equal(await promotion.commonMessage(db),message);
 assert.equal(db.calls.filter(q=>q.startsWith('INSERT')).length,1);
});

test('preserves custom and explicitly deleted promotional messages',async()=>{
 for(const stored of ['사용자가 작성한 문구','']){
  const db=fakeDb(stored);
  assert.equal(await promotion.commonMessage(db),stored);
  assert.equal(db.calls.filter(q=>q.startsWith('INSERT')).length,0);
 }
});
