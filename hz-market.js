"use strict";

const STOCKS = {
  "삼성전자": "005930.KS",
  "엔비디아": "NVDA",
  "애플": "AAPL",
  "테슬라": "TSLA",
  "마이크로소프트": "MSFT",
  "구글": "GOOGL",
  "아마존": "AMZN",
  "SK하이닉스": "000660.KS",
  "현대차": "005380.KS",
  "네이버": "035420.KS",
  "카카오": "035720.KS"
};

function resolveSymbol(name) {
  const input = String(name || "").trim();
  const symbol = STOCKS[input] || input.toUpperCase();

  if (/^\d{6}$/.test(symbol)) return symbol + ".KS";

  if (/^\d{6}\.(KS|KQ)$/.test(symbol)) return symbol;

  if (/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) {
    return symbol;
  }

  throw new Error("올바른 종목명이나 종목 코드를 입력해 주세요.");
}

async function yahooChart(symbol) {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) +
    "?range=5d&interval=1d";

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error("시세 조회 실패: HTTP " + response.status);
  }

  const json = await response.json();
  const data = json.chart?.result?.[0];

  if (!data) {
    throw new Error("시세 데이터를 찾을 수 없습니다.");
  }

  return data;
}

async function getExchangeRate() {
  const data = await yahooChart("KRW=X");
  const rate = Number(data.meta?.regularMarketPrice);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("환율 데이터를 확인할 수 없습니다.");
  }

  return rate;
}

async function getMarketPrice(name) {
  const symbol = resolveSymbol(name);
  const data = await yahooChart(symbol);
  const meta = data.meta || {};

  const quoteTime = Number(meta.regularMarketTime);
  const now = Date.now() / 1000;

  if (!Number.isFinite(quoteTime) ||
      quoteTime <= 0 ||
      quoteTime > now + 300 ||
      now - quoteTime > 900) {
    throw new Error(
      "시세가 오래되어 거래할 수 없습니다. 잠시 후 다시 시도해 주세요."
    );
  }

  const currency = meta.currency;
  const price = Number(meta.regularMarketPrice);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("현재 주가를 확인할 수 없습니다.");
  }

  if (!["KRW", "USD"].includes(currency)) {
    throw new Error("KRW 또는 USD 종목만 거래할 수 있습니다.");
  }

  const exchangeRate =
    currency === "USD" ? await getExchangeRate() : 1;

  const priceKrw = Math.round(price * exchangeRate);

  if (!Number.isSafeInteger(priceKrw) || priceKrw <= 0) {
    throw new Error("코인 환산 가격이 올바르지 않습니다.");
  }

  const regularPeriod = meta.currentTradingPeriod?.regular;
  const regularSessionStart = Number(regularPeriod?.start);
  const regularSessionEnd = Number(regularPeriod?.end);

  if (!Number.isFinite(regularSessionStart) ||
      !Number.isFinite(regularSessionEnd) ||
      regularSessionStart <= 0 ||
      regularSessionEnd <= regularSessionStart) {
    throw new Error("거래소 운영시간을 확인할 수 없습니다.");
  }

  const currentTime = Date.now() / 1000;

  if (currentTime < regularSessionStart ||
      currentTime >= regularSessionEnd) {
    throw new Error("현재 정규 거래시간이 아닙니다.");
  }

  return {
    symbol,
    name: String(name),
    currency,
    price,
    exchangeRate,
    priceKrw,
    marketState: meta.marketState || "UNKNOWN",
    exchangeTimezone: meta.exchangeTimezoneName || ""
  };
}

module.exports = {
  resolveSymbol,
  getMarketPrice,
  getExchangeRate
};
