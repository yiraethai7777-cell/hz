"use strict";

async function searchStocks(keyword) {
  const query = String(keyword || "").trim();

  if (!query || query.length > 60) {
    return "사용법: !주식검색 종목명";
  }

  const url =
    "https://query1.finance.yahoo.com/v1/finance/search" +
    "?q=" + encodeURIComponent(query) +
    "&quotesCount=10&newsCount=0";

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error("종목 검색 실패: HTTP " + response.status);
  }

  const data = await response.json();

  const stocks = (data.quotes || [])
    .filter(x =>
      x.symbol &&
      ["EQUITY", "ETF"].includes(x.quoteType)
    )
    .slice(0, 10);

  if (!stocks.length) {
    return "🔎 검색된 종목이 없습니다.\n" +
      "영문 종목명이나 종목 코드로도 검색해 보세요.";
  }

  return "🔎 주식 검색: " + query + "\n\n" +
    stocks.map((stock, i) =>
      (i + 1) + ". " +
      (stock.shortname || stock.longname || stock.symbol) +
      "\n   코드: " + stock.symbol
    ).join("\n\n");
}

module.exports = { searchStocks };
