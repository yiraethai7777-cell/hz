'use strict';

// kisa-seed 1.1.0 performs PKCS#7 on binary plaintext itself.
// shared/vox30-protocol.js requires a RAW CBC cipher over PRE-PADDED blocks.
// Adapt the two contracts without silently adding two padding blocks.
const {KISA_SEED_CBC}=require('kisa-seed');
const {pkcs7Pad,pkcs7Unpad}=require('../../shared/vox30-protocol');

function seedCbcBytes() {
  function assertParams(block,key,iv) {
    if(!Buffer.isBuffer(block) || !Buffer.isBuffer(key) || !Buffer.isBuffer(iv) ||
       block.length<16 || block.length%16!==0 || key.length!==16 || iv.length!==16)
      throw Error('SEED-CBC 입력 블록 또는 키/IV 길이 오류');
  }
  return Object.freeze({
    encrypt(block,key,iv) {
      assertParams(block,key,iv);
      // The wrapper removes the caller's PKCS#7, then library adds it once.
      const plain=pkcs7Unpad(block);
      const base64=KISA_SEED_CBC.encryptBytes(key.toString('base64'),
        iv.toString('base64'),new Uint8Array(plain));
      const out=Buffer.from(base64,'base64');
      if(out.length!==block.length)throw Error('SEED-CBC 암호문 길이 불일치');
      return out;
    },
    decrypt(block,key,iv) {
      assertParams(block,key,iv);
      const bytes=KISA_SEED_CBC.decryptBytes(key.toString('base64'),
        iv.toString('base64'),block.toString('base64'));
      const plain=Buffer.from(bytes);
      const out=pkcs7Pad(plain);
      if(out.length!==block.length)throw Error('SEED-CBC 복호문 길이 불일치');
      return out;
    },
  });
}

module.exports={seedCbcBytes};
