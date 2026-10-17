"use strict";

const STOCKS = {
  "삼성전자": { symbol: "005930.KS", currency: "KRW" },
  "엔비디아": { symbol: "NVDA", currency: "USD" }
};

const LEVELS = "▁▂▃▄▅▆▇█";

function formatPrice(value, currency) {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: currency === "KRW" ? 0 : 2
  });
}

async function getStockText(name, days = 7) {
  const input = String(name || "").trim();
  const upper = input.toUpperCase();

  const stock = STOCKS[input] ||
    (/^[0-9]{6}$/.test(input)
      ? { symbol: input + ".KS", currency: "KRW" }
      : /^[0-9]{6}\.(KS|KQ)$/.test(upper)
      ? { symbol: upper, currency: "KRW" }
      : /^[A-Z][A-Z0-9.-]{0,14}$/.test(upper)
      ? {
          symbol: upper,
          currency: upper.endsWith(".KS") ||
                    upper.endsWith(".KQ") ? "KRW" : "USD"
        }
      : null);

  if (!stock) {
    throw new Error("올바른 종목 코드를 입력해 주세요.");
  }

  if (![7, 30].includes(days)) {
    throw new Error("7일 또는 30일만 지원합니다.");
  }

  const range = days === 7 ? "1mo" : "3mo";
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(stock.symbol) +
    "?range=" + range + "&interval=1d";

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error("주가 조회 실패: HTTP " + response.status);
  }

  const json = await response.json();
  const data = json.chart?.result?.[0];

  if (!data) {
    throw new Error("주가 데이터가 없습니다.");
  }

  const timestamps = data.timestamp || [];
  const closes = data.indicators?.quote?.[0]?.close || [];

  const prices = timestamps
    .map((time, i) => ({ time, price: closes[i] }))
    .filter(x => Number.isFinite(x.price) && x.price > 0);

  // 전일 대비 등락을 정확하게 계산하려면
  // 표시 기간보다 이전 거래일 데이터도 필요하다.
  const selected = prices.slice(-days);

  if (selected.length < 2) {
    throw new Error("주가 데이터가 부족합니다.");
  }

  const values = selected.map(x => x.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const graph = values.map(value => {
    const level = span === 0
      ? 3
      : Math.round((value - min) / span * 7);

    return LEVELS[level];
  }).join("");

  const last = values[values.length - 1];
  const previous = values[values.length - 2];
  const change = (last - previous) / previous * 100;

  const icon = change > 0 ? "🔴" :
               change < 0 ? "🔵" : "⚪";

  const sign = change > 0 ? "+" : "";

  const date = new Intl.DateTimeFormat("ko-KR", {
    timeZone: stock.currency === "KRW"
      ? "Asia/Seoul" : "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(selected[selected.length - 1].time * 1000));

  return (
    "📊 " + name + " 주식 현황\n\n" +
    "💰 최근 종가: " + formatPrice(last, stock.currency) +
    " " + stock.currency + "\n" +
    icon + " 전일 대비: " + sign + change.toFixed(2) + "%\n\n" +
    "📈 최근 " + selected.length + "거래일\n" +
    graph + "\n" +
    "과거 ─────────→ 최근\n\n" +
    "🔴 상승 | 🔵 하락 | ⚪ 보합\n" +
    "📅 기준일: " + date + "\n" +
    "※ 종가 기준이며 실시간 체결가는 아닙니다."
  );
}

module.exports = { getStockText };
