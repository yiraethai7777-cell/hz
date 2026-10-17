"use strict";
const { getMarketPrice } = require("./prices");
const { isMarketOpen } = require("./market-hours");
const {
  tradeStock, getHoldings, getTradeHistory
} = require("./trading");
const { handleCoinCommand } = require("./coin");
const { getBalance } = require("./wallet");
const { isMember, joinGame } = require("./members");
const { searchStocks } = require("./stock-search");


async function message({text,msg,chat,isBotAccount=false}) {
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
    if (await handleCoinCommand({ text, msg, roomId, chat,isBotAccount })) return;

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
        priceKrw: market.priceKrw,
        messageId:msg.id??msg.message?.id??msg.raw?.chat?.logId??msg.logId
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
      const { getStockText } = require("./stock-text");

      const result = await getStockText(name, days);
      await chat.sendText(roomId, result);

      console.log("[HZ 주식] 텍스트 그래프 전송 성공:", name);
      return;
    }

    if (text === "!핑") await chat.sendText(roomId, "🏓 퐁!");
  } catch (err) {
    console.error("[HZ GAME] 명령어 처리 실패:", text, err);
  }

}
module.exports={message};
