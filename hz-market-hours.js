"use strict";

function isMarketOpen(symbol, date = new Date()) {
  const korean = /\.(KS|KQ)$/.test(symbol);
  const timeZone = korean
    ? "Asia/Seoul"
    : "America/New_York";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date);

  const get = type =>
    parts.find(p => p.type === type)?.value;

  const weekday = get("weekday");
  const minutes =
    Number(get("hour")) * 60 + Number(get("minute"));

  if (["Sat", "Sun"].includes(weekday)) {
    return { open: false, reason: "주말 휴장" };
  }

  const start = korean ? 540 : 570;
  const end = korean ? 930 : 960;

  if (minutes < start || minutes >= end) {
    return {
      open: false,
      reason: "정규 거래시간이 아닙니다."
    };
  }

  return {
    open: true,
    reason: "정규 거래시간"
  };
}

module.exports = { isMarketOpen };
