"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { Resvg } = require("@resvg/resvg-js");

const STOCKS = {
  "삼성전자": { symbol: "005930.KS", currency: "KRW" },
  "엔비디아": { symbol: "NVDA", currency: "USD" }
};

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, c => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;"
  })[c]);
}

async function getStockChart(name, days = 7) {
  const stock = STOCKS[name];

  if (!stock) {
    throw new Error("지원하지 않는 종목: " + name);
  }

  if (![7, 30].includes(days)) {
    throw new Error("그래프 기간은 7일 또는 30일만 지원합니다.");
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
  const result = json.chart?.result?.[0];

  if (!result) throw new Error("주가 데이터가 없습니다.");

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  const prices = timestamps
    .map((time, i) => ({ time, price: closes[i] }))
    .filter(x => Number.isFinite(x.price) && x.price > 0)
    .slice(-days);

  if (prices.length < 2) {
    throw new Error("그래프 데이터가 부족합니다.");
  }

  const values = prices.map(x => x.price);
  const first = values[0];
  const last = values[values.length - 1];

  const change = (last - first) / first * 100;
  const color = change >= 0 ? "#ff647e" : "#60a5fa";

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = Math.max((maxValue - minValue) * 0.1, maxValue * 0.001);
  const min = minValue - padding;
  const max = maxValue + padding;

  const width = 1000;
  const height = 560;

  const left = 100;
  const right = 920;
  const top = 165;
  const bottom = 440;

  const coordinates = prices.map((item, i) => {
    const x = left + i * (right - left) / (prices.length - 1);
    const y = bottom - (item.price - min) / (max - min) * (bottom - top);
    return { x, y };
  });

  const line = coordinates
    .map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const labels = prices
    .map((item, i) => {
      if (i !== 0 && i !== prices.length - 1 &&
          i % Math.max(1, Math.floor(prices.length / 6)) !== 0) {
        return "";
      }

      const date = new Date(item.time * 1000);
      const label = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;

      return `<text x="${coordinates[i].x}" y="480"
        text-anchor="middle" font-size="18"
        fill="#94a3b8">${label}</text>`;
    })
    .join("");

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg"
       width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#111827"/>

    <text x="75" y="65" fill="#ffffff"
          font-size="34" font-weight="bold">
      ${escapeXml(stock.symbol)}
    </text>

    <text x="75" y="115" fill="#e2e8f0" font-size="31">
      ${last.toLocaleString("en-US", { maximumFractionDigits: 2 })}
      ${stock.currency}
    </text>

    <text x="430" y="115" fill="${color}" font-size="28">
      ${change >= 0 ? "+" : ""}${change.toFixed(2)}%
    </text>

    <line x1="100" y1="440" x2="920" y2="440"
          stroke="#475569"/>

    <line x1="100" y1="302" x2="920" y2="302"
          stroke="#334155" stroke-dasharray="6 8"/>

    <line x1="100" y1="165" x2="920" y2="165"
          stroke="#334155" stroke-dasharray="6 8"/>

    <polyline points="${line}"
              fill="none" stroke="${color}"
              stroke-width="5"
              stroke-linecap="round"
              stroke-linejoin="round"/>

    ${labels}

    <text x="75" y="530" fill="#94a3b8" font-size="19">
      NEXUS | Last ${prices.length} trading sessions
    </text>
  </svg>`;

  
  const { PNG } = require("pngjs");

  const originalPng = new Resvg(svg).render().asPng();

  const decoded = PNG.sync.read(originalPng);

  const png = PNG.sync.write(decoded, {
    colorType: 2,
    inputColorType: 6,
    inputHasAlpha: true
  });


  const filename =
    "hz-stock-" + stock.symbol.replace(/[^a-zA-Z0-9]/g, "_") +
    "-" + days + "-" + Date.now() + ".png";

  const filePath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(filePath, png);

  return {
    name,
    symbol: stock.symbol,
    currency: stock.currency,
    price: last,
    change,
    days: prices.length,
    filePath,
    asOf: new Date(prices[prices.length - 1].time * 1000)
  };
}

module.exports = { getStockChart };
