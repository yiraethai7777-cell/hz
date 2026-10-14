"use strict";

// 새로운 기능을 추가할 때 이 목록만 수정하면 됩니다.
const COMMAND_GROUPS = [
  {
    title: "📅 출석 시스템",
    commands:[
      ["!출석", "오늘 출석하기"],
      ["!출석순위", "오늘 출석 1~3등 확인"]
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

  // 카카오톡 더보기 표시 유도
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
