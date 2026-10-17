"use strict";

const COMMAND_GROUPS = [
  {
    title: "📅 출석 시스템",
    commands: [
      ["!출석", "오늘 출석하기"],
      ["!출석순위", "오늘 출석 1~3등 확인"]
    ]
  },
  {
    title: "🎮 게임 가입 · 코인",
    commands: [
      ["!게임가입", "게임 가입 (신규 100,000코인)"],
      ["!코인", "내 코인 잔액 확인"]
    ]
  },
  {
    title: "📈 주식 조회",
    commands: [
      ["!주식검색 종목명", "한국·미국 주식 검색"],
      ["!주식현황 종목명", "최근 7거래일 그래프"],
      ["!주식현황 종목명 30일", "최근 30거래일 그래프"]
    ]
  },
  {
    title: "💰 주식 거래",
    commands: [
      ["!주식구매 종목명 수량", "주식 매수"],
      ["!주식판매 종목명 수량", "주식 매도"],
      ["!내주식", "보유 주식 확인"],
      ["!주식거래내역", "최근 거래내역 확인"]
    ]
  },
  {
    title: "⚙️ 기본 시스템",
    commands: [
      ["!명령어", "전체 명령어 확인"],
      ["!핑", "봇 작동 확인"]
    ]
  }
];

function getCommandList() {
  const header =
    "📜 HZ BOT 명령어\n\n" +
    "━━━━━━━━━━━━━━\n";

  const fold = "\u200b".repeat(1000);

  const sections = COMMAND_GROUPS.map(group => {
    const lines = group.commands.map(([name, description]) =>
      name + "\n└ " + description
    );

    return (
      "━━━━━━━━━━━━━━\n" +
      group.title + "\n" +
      "━━━━━━━━━━━━━━\n" +
      lines.join("\n\n")
    );
  });

  return header + fold + "\n\n" + sections.join("\n\n");
}

module.exports = {
  COMMAND_GROUPS,
  getCommandList
};
