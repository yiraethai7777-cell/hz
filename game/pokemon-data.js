'use strict';
// Starter selection. Artwork is loaded by National Pokédex number from PokeAPI/sprites.
const rows=[
 [1,'이상해씨','풀/독','일반'],[2,'이상해풀','풀/독','희귀'],[3,'이상해꽃','풀/독','희귀'],
 [4,'파이리','불꽃','일반'],[5,'리자드','불꽃','희귀'],[6,'리자몽','불꽃/비행','희귀'],
 [7,'꼬부기','물','일반'],[8,'어니부기','물','희귀'],[9,'거북왕','물','희귀'],
 [10,'캐터피','벌레','일반'],[16,'구구','노말/비행','일반'],[19,'꼬렛','노말','일반'],
 [25,'피카츄','전기','희귀'],[26,'라이츄','전기','희귀'],[27,'모래두지','땅','일반'],
 [35,'삐삐','페어리','희귀'],[37,'식스테일','불꽃','일반'],[39,'푸린','노말/페어리','희귀'],
 [43,'뚜벅쵸','풀/독','일반'],[50,'디그다','땅','일반'],[52,'나옹','노말','일반'],
 [54,'고라파덕','물','일반'],[58,'가디','불꽃','희귀'],[63,'캐이시','에스퍼','희귀'],
 [66,'알통몬','격투','일반'],[72,'왕눈해','물/독','일반'],[74,'꼬마돌','바위/땅','일반'],
 [77,'포니타','불꽃','희귀'],[79,'야돈','물/에스퍼','일반'],[81,'코일','전기/강철','일반'],
 [92,'고오스','고스트/독','일반'],[94,'팬텀','고스트/독','희귀'],
 [95,'롱스톤','바위/땅','희귀'],[98,'크랩','물','일반'],[104,'탕구리','땅','일반'],
 [109,'또가스','독','일반'],[113,'럭키','노말','희귀'],[120,'별가사리','물','일반'],
 [123,'스라크','벌레/비행','희귀'],[127,'쁘사이저','벌레','희귀'],
 [129,'잉어킹','물','일반'],[130,'갸라도스','물/비행','희귀'],
 [131,'라프라스','물/얼음','희귀'],[133,'이브이','노말','희귀'],
 [134,'샤미드','물','희귀'],[135,'쥬피썬더','전기','희귀'],[136,'부스터','불꽃','희귀'],
 [143,'잠만보','노말','희귀'],[147,'미뇽','드래곤','희귀'],[148,'신뇽','드래곤','희귀'],
 [149,'망나뇽','드래곤/비행','희귀'],[150,'뮤츠','에스퍼','전설'],[151,'뮤','에스퍼','전설']
];
const SPECIES=Object.freeze(rows.map(([id,name,type,rarity])=>Object.freeze({id,name,type,rarity})));
const BY_ID=new Map(SPECIES.map(x=>[x.id,x]));
const BY_NAME=new Map(SPECIES.map(x=>[x.name,x]));
const RARITY_WEIGHT=Object.freeze({일반:75,희귀:23,전설:2});
const BASE_CATCH=Object.freeze({일반:0.78,희귀:0.48,전설:0.12});
function pickSpecies(random=Math.random){
 const rarityRoll=Math.min(0.999999,Math.max(0,random()))*100;
 const rarity=rarityRoll<RARITY_WEIGHT.일반?'일반':
  rarityRoll<RARITY_WEIGHT.일반+RARITY_WEIGHT.희귀?'희귀':'전설';
 const group=SPECIES.filter(x=>x.rarity===rarity);
 return group[Math.floor(Math.min(0.999999,Math.max(0,random()))*group.length)];
}
function catchChance(pokemon){
 return BASE_CATCH[pokemon.rarity];
}
function spriteUrl(number){
 if(!BY_ID.has(Number(number)))throw Error('Unknown Pokémon sprite number');
 return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/'+Number(number)+'.png';
}
function difficulty(pokemon){return pokemon.rarity==='전설'?'매우 어려움':pokemon.rarity==='희귀'?'보통':'쉬움';}
module.exports={SPECIES,BY_ID,BY_NAME,pickSpecies,catchChance,spriteUrl,difficulty};
