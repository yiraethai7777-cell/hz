"use strict";

const { createClient } = require("./dist");
const { attachExtraCommands, commandLists } = require("./hz-extra-commands");
const { testConnection } = require("./hz-db");
const { initTrading } = require("./hz-trading");
const { getMarketPrice } = require("./hz-market");
const { isMarketOpen } = require("./hz-market-hours");
const {
  tradeStock, getHoldings, getTradeHistory
} = require("./hz-trading");
const { initCoinExtra, handleCoinCommand } = require("./hz-coin-extra");
const { initWallet, getBalance } = require("./hz-wallet");
const { initMembers, isMember, joinGame } = require("./hz-members");
const { getCommandList } = require("./hz-commands");
const { searchStocks } = require("./hz-stock-search");
const { initAttendance, attend, attendanceRanking } = require("./hz-attendance");

const glManage = require('./manage');
const glManageReady = process.env.DATABASE_URL
  ? glManage.init().then(() => { console.log('[GL 관리] 준비 완료'); return true; })
      .catch(err => { console.error('[GL 관리] 초기화 실패:', err); return false; })
  : Promise.resolve(false);
const glCleanupTimer = setInterval(() => {
  glManageReady.then(ok => ok && glManage.cleanup().catch(err => console.error('[GL 관리] 정리 오류:', err)));
}, 60 * 60 * 1000);
if (typeof glCleanupTimer.unref === 'function') glCleanupTimer.unref();

const client = createClient({
  authPath: process.env.KAKAO_AUTH_PATH || "./auth.json",
  debug: process.env.KAKAO_DEBUG === "1",
  autoConnect: true,
  autoReconnect: true,
});

let attendanceReady = false;

client.onReady(() => {
  console.log("[HZ NEW] 카카오톡 연결 완료");
});

client.on("error", (err) => {
  console.error("[HZ NEW] 연결 오류:", err);
});

if (process.env.DATABASE_URL) {
  testConnection().catch((err) => {
    console.error("[HZ DB] 연결 실패:", err);
  });

  initCoinExtra().catch(err => console.error("[HZ 코인] 추가 초기화 실패:", err));

  initWallet()
    .then(() => console.log("[HZ 코인] 준비 완료"))
    .catch(err => console.error("[HZ 코인] 초기화 실패:", err));

  initWallet().then(initMembers).then(() => console.log("[HZ 가입] 준비 완료"))
    .catch(err => console.error("[HZ 가입] 초기화 실패:",err));

  initTrading()
    .then(() => console.log("[HZ 주식] 준비 완료"))
    .catch(err => console.error("[HZ 주식] 초기화 실패:", err));

  initAttendance()
    .then(() => {
      attendanceReady = true;
      console.log("[HZ 출석] 준비 완료");
    })
    .catch((err) => {
      console.error("[HZ 출석] 초기화 실패:", err);
    });
} else {
  console.warn("[HZ DB] DATABASE_URL 없음");
}

// 모든 명령어를 단 하나의 수신 함수에서 처리합니다.
client.onMessage(async (...args) => {
  const msg = args.length === 1 ? args[0] : args[1];
  const chat = args.length === 1 ? (client.chat || client) : args[0];
  if (!msg) return;

  const text = String(msg.message?.text ?? msg.text ?? "").trim();
  // GL_MANAGE_V2_START
  // Management sees all incoming messages, including ordinary chat.
  // Existing game and stock commands continue through the original handler.
  const glRoomId = msg.room?.id;
  if (glRoomId != null && await glManageReady) {
    try {
      const handled = await glManage.message({
        roomId: glRoomId,
        userId: msg.sender?.id ?? '',
        userName: msg.sender?.name || '알 수 없음',
        messageId: msg.id ?? msg.message?.id ?? null,
        text,
        send: body => chat.sendText(glRoomId, body)
        // Kick is deliberately not connected until KakaoForge behavior is verified.
      });
      if (handled) return;
    } catch (err) { console.error('[GL 관리] 메시지 오류:', err); }
  }
  // Attendance belongs exclusively to management, not the old game handler.
  if (/^!출석(?:확인|순위)?(?:\s|$)/.test(text)) return;
  // GL_MANAGE_V2_END
  if (!/^!(코인|코인순위|코인내역|코인송금|코인지급|코인아이디)(?:\s|$)/.test(text) && !["!핑", "!명령어", "!출석", "!출석순위", "!코인", "!게임가입"].includes(text) && !text.startsWith("!주식현황 ")
    && !text.startsWith("!주식구매 ")
    && !text.startsWith("!주식판매 ")
    && text !== "!내주식"
    && text !== "!주식거래내역" && !text.startsWith("!주식검색 ") && text !== "!주식검색") return;

  const roomId = msg.room?.id;
  if (roomId === undefined || roomId === null) {
    console.error("[HZ NEW] 방 ID 없음:", text);
    return;
  }

  try {
    if (text === "!게임가입") {
      if (msg.sender?.id == null) { await chat.sendText(roomId,"사용자 ID를 확인할 수 없습니다."); return; }
      await chat.sendText(roomId,await joinGame(roomId,msg.sender.id,msg.sender.name || "알 수 없음"));
      return;
    }
    // 주식 관련 모든 명령어는 가입 후 이용 가능.
    if (/^!(주식|내주식|주식거래내역)/.test(text)) {
      if (msg.sender?.id == null || !await isMember(roomId,msg.sender.id)) {
        await chat.sendText(roomId,"❌ 게임에 가입하지 않았습니다.\n🎮 !게임가입 명령어로 가입해 주세요.");
        return;
      }
    }
    if (await handleCoinCommand({ text, msg, roomId, chat })) return;

    if (text === "!코인") {
      const userId = msg.sender?.id;
      if (userId === undefined || userId === null) {
        await chat.sendText(roomId, "사용자 ID를 확인할 수 없습니다.");
        return;
      }

      const userName = msg.sender?.name || "알 수 없음";
      const balance = await getBalance(
        String(roomId), String(userId), String(userName)
      );

      await chat.sendText(
        roomId,
        "🪙 " + userName + "님의 코인\n" +
        "잔액: " + balance.toLocaleString("ko-KR") + "코인"
      );
      return;
    }

    if (text === "!주식검색" ||
        text.startsWith("!주식검색 ")) {
      const keyword = text.slice("!주식검색".length).trim();
      const result = await searchStocks(keyword);
      await chat.sendText(roomId, result);
      return;
    }



    if (text.startsWith("!주식구매 ") ||
        text.startsWith("!주식판매 ")) {

      const buying = text.startsWith("!주식구매 ");
      const parts = text.split(/\s+/);

      if (parts.length !== 3) {
        await chat.sendText(
          roomId,
          "사용법: !주식구매 엔비디아 1"
        );
        return;
      }

      const userId = msg.sender?.id;
      const userName = msg.sender?.name || "알 수 없음";

      if (userId == null) {
        await chat.sendText(roomId, "사용자 ID가 없습니다.");
        return;
      }

      const name = parts[1];
      const qty = Number(parts[2]);

      if (!Number.isSafeInteger(qty) ||
          qty < 1 || qty > 100000) {
        await chat.sendText(
          roomId, "수량은 1~100,000 사이의 정수여야 합니다."
        );
        return;
      }

      const market = await getMarketPrice(name);
      const hours = isMarketOpen(market.symbol);

      if (!hours.open) {
        await chat.sendText(
          roomId,
          "🔒 현재 거래할 수 없습니다.\n" +
          hours.reason
        );
        return;
      }

      const result = await tradeStock({
        roomId: String(roomId),
        userId: String(userId),
        userName,
        symbol: market.symbol,
        stockName: name,
        side: buying ? "BUY" : "SELL",
        quantity: qty,
        priceKrw: market.priceKrw
      });

      await chat.sendText(
        roomId,
        (buying ? "🔴 매수 완료" : "🔵 매도 완료") +
        "\n종목: " + name +
        "\n수량: " + qty + "주" +
        "\n1주 가격: " +
        market.priceKrw.toLocaleString("ko-KR") + "코인" +
        "\n총 거래금액: " +
        result.total.toLocaleString("ko-KR") + "코인" +
        "\n남은 코인: " +
        result.balance.toLocaleString("ko-KR") + "코인"
      );
      return;
    }

    if (text === "!내주식") {
      const userId = msg.sender?.id;
      if (userId == null) return;

      const rows = await getHoldings(
        String(roomId), String(userId)
      );

      const reply = rows.length
        ? "📊 내 보유 주식\n\n" +
          rows.map((r, i) =>
            (i + 1) + ". " + r.stock_name +
            " (" + r.symbol + ")" +
            "\n보유: " + r.quantity + "주" +
            "\n매수원금: " +
            Number(r.total_cost).toLocaleString("ko-KR") +
            "코인"
          ).join("\n\n")
        : "📊 보유한 주식이 없습니다.";

      await chat.sendText(roomId, reply);
      return;
    }

    if (text === "!주식거래내역") {
      const userId = msg.sender?.id;
      if (userId == null) return;

      const rows = await getTradeHistory(
        String(roomId), String(userId)
      );

      const reply = rows.length
        ? "📜 최근 주식 거래내역\n\n" +
          rows.map(r =>
            (r.side === "BUY" ? "🔴 매수" : "🔵 매도") +
            " | " + r.stock_name +
            " | " + r.quantity + "주" +
            " | " +
            Number(r.total_krw).toLocaleString("ko-KR") +
            "코인"
          ).join("\n")
        : "📜 주식 거래내역이 없습니다.";

      await chat.sendText(roomId, reply);
      return;
    }

    if (text.startsWith("!주식현황 ")) {
      const args = text.slice("!주식현황 ".length)
        .trim().split(/\s+/);

      const name = args[0];
      const period = args[1];

      if (args.length > 2 ||
          (period && !["7일", "30일"].includes(period))) {
        await chat.sendText(
          roomId,
          "사용법: !주식현황 삼성전자 [7일 또는 30일]"
        );
        return;
      }

      const days = period === "30일" ? 30 : 7;
      const { getStockText } = require("./hz-stock-text");

      const result = await getStockText(name, days);
      await chat.sendText(roomId, result);

      console.log("[HZ 주식] 텍스트 그래프 전송 성공:", name);
      return;
    }

    let reply;


    if (text === "!핑") {
      reply = "🏓 퐁!";
    } else if (text === "!명령어") {
      reply = commandLists["기본"];
    } else {
      const userId = msg.sender?.id;
      const userName = msg.sender?.name || "알 수 없음";
      if (text === "!출석" && (userId === undefined || userId === null)) {
        console.error("[HZ 출석] 사용자 ID 없음");
        return;
      }
      if (!attendanceReady) {
        reply = "⏳ 출석 시스템을 준비 중입니다.";
      } else if (text === "!출석") {
        reply = await attend(String(roomId), String(userId), String(userName));
      } else {
        reply = await attendanceRanking(String(roomId));
      }
    }

    await chat.sendText(roomId, reply);
    console.log("[HZ NEW] 명령어 처리 성공:", text);
  } catch (err) {
    console.error("[HZ NEW] 명령어 처리 실패:", text, err);
  }
});

attachExtraCommands(client);

console.log("[HZ NEW] 봇 시작 중...");
