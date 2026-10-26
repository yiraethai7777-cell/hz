"use strict";
function createRuntime({pool:suppliedPool,economyEnabled=true}={}) {
const ctx={};
const {RODS,PETS,FISH_TABLE,QUIZZES}=require('../game/data');
"use strict";
const { Pool } = require("pg");

// Shared persistent state for the separated modules.

const pool = suppliedPool || new Pool({connectionString:process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? {rejectUnauthorized:false}:false});
const QUIZ_REWARD=10000, QUIZ_SECONDS=60, FISHING_COOLDOWN_SECONDS=30, QUIZ_COOLDOWN_SECONDS=10, FISHING_WAIT_MS=0, QUIZ_XP=30, FISHING_XP=20, MAX_LEVEL=200;
const MORE="\u200b".repeat(500);
const PET_COST=10000, AUTO_COST=50000, AUTO_DURATION=600000;
const PROMO_SPAM_WINDOW_MS=10000, PROMO_SPAM_LIMIT=3;

// 등급 확률을 먼저 결정한 다음, 해당 등급 내 물고기를 가중치로 추첨한다.
// 강력한 낚시대/펫/행운 효과를 합쳐도 전설과 신화가 과도하게 나오지 않도록 상한을 둔다.

const LosslessJSON = require("lossless-json");

// Only exact stable message IDs are correlated; never guess by sender or time.

const spamState=new Map();
const kickBurst=new Map();
const pendingManualKicks=new Map(); // roomId:userId -> pending confirmation

// 깔끔한 낚시 카드: 종류별 그림 + 크기 비율 + 설명 + 보상.
// 사진 전송 메서드가 없는 KakaoForge 빌드에서는 텍스트 결과를 유지합니다.

let autoFishTimer=null,autoFishBusy=false;

// 자동 홍보: 한국시간 00:00 기준 분 단위 정렬. 각 방 상태는 PostgreSQL에 저장.

let promoTimer=null, promoTickBusy=false;

let globalClient=null,globalChat=null,globalBotId="";
// Set HZ_OWNER_ID to the exact KakaoForge sender ID of your personal account.
const OWNER_IDS = new Set(String(process.env.HZ_OWNER_IDS || process.env.HZ_OWNER_ID || "").split(/[\s,;]+/).map(x => x.trim()).filter(Boolean));

const {n,norm,nowK,dayK,sleep,id,blankRoom,fixRoom,initDb,withRoom,roomFlags,send}=require('./state')(ctx);
const {levelNeed,addXp,player,shuffle,nextQuiz,fishPick,fishValue,gameHelp,petBonus,rodLuck,awardFish,drawPet,enhancementCost,enhancementNeed,autoFishTick,quizExpiryTick,handleGame}=require('../game/features')(ctx);
const {formatMemberTemplate,isManagerType,isOwnerType,isSubManagerType,safeUserId,parseExactAttachment,exactId,attachmentRoots,rawMentions,targetFrom,resolveTarget,commandTarget,senderExactId,processMentionAlerts,deepFindUserId,replyTargetFrom,idCommandTarget,lastJoinAt,activeWarningCount,validOpenProfileLink,findOpenProfileLink,profileDiagnostic,saveOpenProfileLink,extractProfile,pickDeleteRoom,pickDeleteActor,pickDeletedText,originalMessageId,deletedMessageId,saveDeleteCache,lookupDeleteCache,manageHelp,profileObserve,addChatCount,chatInfo,chatRanking,messageFingerprint,kickMember,autoSpamCheck,handleManageStats,handleManage,promoSlot,promoTick}=require('../manage/features')(ctx);
const {attachHZBot}=require('./session')(ctx);

Object.defineProperties(ctx,{"Pool":{get:()=>Pool},
"economyEnabled":{get:()=>economyEnabled},
"pool":{get:()=>pool},
"QUIZ_REWARD":{get:()=>QUIZ_REWARD},
"QUIZ_SECONDS":{get:()=>QUIZ_SECONDS},
"FISHING_COOLDOWN_SECONDS":{get:()=>FISHING_COOLDOWN_SECONDS},
"QUIZ_COOLDOWN_SECONDS":{get:()=>QUIZ_COOLDOWN_SECONDS},
"FISHING_WAIT_MS":{get:()=>FISHING_WAIT_MS},
"QUIZ_XP":{get:()=>QUIZ_XP},
"FISHING_XP":{get:()=>FISHING_XP},
"MAX_LEVEL":{get:()=>MAX_LEVEL},
"MORE":{get:()=>MORE},
"PET_COST":{get:()=>PET_COST},
"AUTO_COST":{get:()=>AUTO_COST},
"AUTO_DURATION":{get:()=>AUTO_DURATION},
"PROMO_SPAM_WINDOW_MS":{get:()=>PROMO_SPAM_WINDOW_MS},
"PROMO_SPAM_LIMIT":{get:()=>PROMO_SPAM_LIMIT},
"RODS":{get:()=>RODS},
"PETS":{get:()=>PETS},
"FISH_TABLE":{get:()=>FISH_TABLE},
"QUIZZES":{get:()=>QUIZZES},
"n":{get:()=>n},
"norm":{get:()=>norm},
"levelNeed":{get:()=>levelNeed},
"addXp":{get:()=>addXp},
"nowK":{get:()=>nowK},
"dayK":{get:()=>dayK},
"formatMemberTemplate":{get:()=>formatMemberTemplate},
"sleep":{get:()=>sleep},
"id":{get:()=>id},
"blankRoom":{get:()=>blankRoom},
"fixRoom":{get:()=>fixRoom},
"player":{get:()=>player},
"shuffle":{get:()=>shuffle},
"nextQuiz":{get:()=>nextQuiz},
"fishPick":{get:()=>fishPick},
"fishValue":{get:()=>fishValue},
"initDb":{get:()=>initDb},
"withRoom":{get:()=>withRoom},
"roomFlags":{get:()=>roomFlags},
"isManagerType":{get:()=>isManagerType},
"isOwnerType":{get:()=>isOwnerType},
"isSubManagerType":{get:()=>isSubManagerType},
"safeUserId":{get:()=>safeUserId},
"LosslessJSON":{get:()=>LosslessJSON},
"parseExactAttachment":{get:()=>parseExactAttachment},
"exactId":{get:()=>exactId},
"attachmentRoots":{get:()=>attachmentRoots},
"rawMentions":{get:()=>rawMentions},
"targetFrom":{get:()=>targetFrom},
"resolveTarget":{get:()=>resolveTarget},
"commandTarget":{get:()=>commandTarget},
"senderExactId":{get:()=>senderExactId},
"processMentionAlerts":{get:()=>processMentionAlerts},
"deepFindUserId":{get:()=>deepFindUserId},
"replyTargetFrom":{get:()=>replyTargetFrom},
"idCommandTarget":{get:()=>idCommandTarget},
"lastJoinAt":{get:()=>lastJoinAt},
"activeWarningCount":{get:()=>activeWarningCount},
"validOpenProfileLink":{get:()=>validOpenProfileLink},
"findOpenProfileLink":{get:()=>findOpenProfileLink},
"profileDiagnostic":{get:()=>profileDiagnostic},
"saveOpenProfileLink":{get:()=>saveOpenProfileLink},
"extractProfile":{get:()=>extractProfile},
"pickDeleteRoom":{get:()=>pickDeleteRoom},
"pickDeleteActor":{get:()=>pickDeleteActor},
"pickDeletedText":{get:()=>pickDeletedText},
"originalMessageId":{get:()=>originalMessageId},
"deletedMessageId":{get:()=>deletedMessageId},
"saveDeleteCache":{get:()=>saveDeleteCache},
"lookupDeleteCache":{get:()=>lookupDeleteCache},
"gameHelp":{get:()=>gameHelp},
"manageHelp":{get:()=>manageHelp},
"send":{get:()=>send},
"profileObserve":{get:()=>profileObserve},
"addChatCount":{get:()=>addChatCount},
"chatInfo":{get:()=>chatInfo},
"chatRanking":{get:()=>chatRanking},
"spamState":{get:()=>spamState},
"kickBurst":{get:()=>kickBurst},
"pendingManualKicks":{get:()=>pendingManualKicks},
"messageFingerprint":{get:()=>messageFingerprint},
"kickMember":{get:()=>kickMember},
"autoSpamCheck":{get:()=>autoSpamCheck},
"petBonus":{get:()=>petBonus},
"rodLuck":{get:()=>rodLuck},
"awardFish":{get:()=>awardFish},
"drawPet":{get:()=>drawPet},
"enhancementCost":{get:()=>enhancementCost},
"enhancementNeed":{get:()=>enhancementNeed},
"autoFishTick":{get:()=>autoFishTick},
"quizExpiryTick":{get:()=>quizExpiryTick},
"autoFishTimer":{get:()=>autoFishTimer,set:value=>{autoFishTimer=value;}},
"autoFishBusy":{get:()=>autoFishBusy,set:value=>{autoFishBusy=value;}},
"handleGame":{get:()=>handleGame},
"handleManageStats":{get:()=>handleManageStats},
"handleManage":{get:()=>handleManage},
"promoSlot":{get:()=>promoSlot},
"promoTimer":{get:()=>promoTimer,set:value=>{promoTimer=value;}},
"promoTickBusy":{get:()=>promoTickBusy,set:value=>{promoTickBusy=value;}},
"promoTick":{get:()=>promoTick},
"globalClient":{get:()=>globalClient,set:value=>{globalClient=value;}},
"globalChat":{get:()=>globalChat,set:value=>{globalChat=value;}},
"globalBotId":{get:()=>globalBotId,set:value=>{globalBotId=value;}},
"OWNER_IDS":{get:()=>OWNER_IDS},
"attachHZBot":{get:()=>attachHZBot}});
return ctx;
}
let runtime;
async function attachModules(client){runtime ||= createRuntime();return runtime.attachHZBot(client);}
let profileWatcher;
function startProfileWatch(client){if(!runtime)return;profileWatcher ||= require('../manage/profile-watch').createWatcher(runtime,client);profileWatcher.start();}
module.exports={attachModules,createRuntime,startProfileWatch};
