"use strict";

const STOCKS = [
  ["삼성전자", "005930.KS"],
  ["SK하이닉스", "000660.KS"],
  ["현대차", "005380.KS"],
  ["네이버", "035420.KS"],
  ["NAVER", "035420.KS"],
  ["카카오", "035720.KS"],
  ["엔비디아", "NVDA"],
  ["NVIDIA", "NVDA"],
  ["애플", "AAPL"],
  ["Apple", "AAPL"],
  ["테슬라", "TSLA"],
  ["Tesla", "TSLA"],
  ["마이크로소프트", "MSFT"],
  ["Microsoft", "MSFT"],
  ["구글", "GOOGL"],
  ["Google", "GOOGL"],
  ["아마존", "AMZN"],
  ["Amazon", "AMZN"]
];

async function searchStocks(keyword) {
  const query = String(keyword || "").trim();

  if (!query || query.length > 60) {
    return "사용법: !주식검색 종목명";
  }

  const matched = STOCKS.filter(([name, symbol]) =>
    name.toLowerCase().includes(query.toLowerCase()) ||
    symbol.toLowerCase().includes(query.toLowerCase())
  );

  const unique = [...new Map(
    matched.map(([name, symbol]) => [symbol, { name, symbol }])
  ).values()];

  if (unique.length) {
    return "🔎 주식 검색: " + query + "\n\n" +
      unique.map((stock, i) =>
        `${i + 1}. ${stock.name}\n   코드: ${stock.symbol}`
      ).join("\n\n");
  }

  return (
    "🔎 검색 결과가 없습니다.\n\n" +
    "현재는 등록된 주요 종목만 이름으로 검색할 수 있습니다.\n" +
    "종목 코드를 알고 있다면 !주식현황 코드 로 조회해 보세요."
  );
}

module.exports = { searchStocks };
