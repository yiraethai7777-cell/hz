import { TalkClient, Chat, ChatMember } from 'node-kakao';

export class AdvancedManager {
  private client: TalkClient;
  
  // 금지어 목록 (기본 지정어 + 사용자 추가/삭제 가능)
  private bannedWords: Set<string> = new Set(['바보', '멍청이', '가격', '얼마', '거래', '자살']);
  
  // 공지 관리 (공지 내용 및 예약 시간 관리)
  private notices: { content: string; time?: string }[] = [
    { content: "📌 기본 공지 1: 규칙을 준수해주세요." }
  ];
  private noticeIndex: number = 0;
  private noticeInterval: NodeJS.Timeout | null = null;

  // 이벤트 봇 상태 관리
  private isEventActive: boolean = false;
  private eventHostId: string | null = null;
  private eventActiveTimer: NodeJS.Timeout | null = null;

  constructor(client: TalkClient) {
    this.client = client;
    this.initNoticeScheduler();
  }

  // 방장(OWNER) 또는 부방장(STAFF) 권한 체크
  private isStaff(member: ChatMember | undefined): boolean {
    if (!member) return false;
    const type = member.type;
    return type === 1 || type === 2 || type.toString().includes('STAFF') || type.toString().includes('OWNER');
  }

  // 메인 메시지 핸들러
  public async handleMessage(chat: Chat, sender: ChatMember | undefined, channel: any) {
    const text = chat.text ? chat.text.trim() : '';
    
    // #으로 시작하지 않는 일반 메시지 -> 클린봇 및 이벤트 챗금 검사
    if (!text.startsWith('#')) {
      await this.processCleanBotAndEventChat(chat, sender);
      return;
    }

    const args = text.slice(1).split(' ');
    const command = args[0];
    const param = args.slice(1).join(' ');

    try {
      switch (command) {
        case '핑':
          await chat.reply('퐁!');
          break;

        // ----------------------------------------------------
        // 1. #벤: 답장 또는 멘션된 유저를 대상으로 "누군가를 벤했습니다" 출력
        // ----------------------------------------------------
        case '벤': {
          if (!this.isStaff(sender)) {
            await chat.reply('❌ 방장 및 부방장만 사용할 수 있는 명령어입니다.');
            return;
          }

          // 벤 당한 사람의 닉네임/아이디 추출 (답장한 원본 메시지가 있거나 파라미터로 지정된 경우)
          let targetName = param || '알 수 없는 사용자';
          
          // 요구사항 문구: "누구를 벤 했습니다 아이디 벤 한 사람" 형식 반영
          const adminName = sender.nickname || '관리자';
          await chat.reply(`🚫 [ ${targetName} ] 님을 벤했습니다.\n(벤 집행자: ${adminName})`);
          
          // 실제 강퇴 기능 연동 지점 (채널 킥 API가 라이브러리에 있을 경우 호출)
          break;
        }

        // ----------------------------------------------------
        // 2. #금지어: 커스텀 금지어 추가, 삭제, 목록 조회
        // ----------------------------------------------------
        case '금지어': {
          const subCmd = args[1];
          const word = args[2];

          if (subCmd === '추가' && word) {
            this.bannedWords.add(word);
            await chat.reply(`✅ 금지어에 [ ${word} ]가 추가되었습니다.`);
          } else if (subCmd === '삭제' && word) {
            this.bannedWords.delete(word);
            await chat.reply(`❌ 금지어에서 [ ${word} ]가 제거되었습니다.`);
          } else {
            const list = Array.from(this.bannedWords).join(', ');
            await chat.reply(`📋 현재 등록된 금지어 목록:\n${list}`);
          }
          break;
        }

        // ----------------------------------------------------
        // 3. #공지등록 및 #공지예약 (언제 몇시 몇분에 올릴지 지정)
        // 형식: #공지예약 14:30 공지내용 OR #공지등록 내용
        // ----------------------------------------------------
        case '공지등록': {
          if (!this.isStaff(sender) || !param) return;
          this.notices.push({ content: param });
          await chat.reply(`📌 새 공지가 등록되었습니다:\n"${param}"`);
          break;
        }
        case '공지예약': {
          if (!this.isStaff(sender)) return;
          // 예: #공지예약 15:00 서버 점검 안내
          const timeStr = args[1]; // 예: 15:00
          const noticeContent = args.slice(2).join(' ');

          if (!timeStr || !noticeContent) {
            await chat.reply(`⚠️ 사용법: #공지예약 [시:분] [공지내용]\n예시) #공지예약 15:30 오후 이벤트 안내`);
            return;
          }

          this.notices.push({ content: noticeContent, time: timeStr });
          await chat.reply(`⏰ [공지 예약 완료]\n시간: ${timeStr}\n내용: ${noticeContent}`);
          break;
        }
        case '공지수정': {
          if (!this.isStaff(sender)) return;
          const index = parseInt(args[1], 10) - 1;
          const newContent = args.slice(2).join(' ');
          if (!isNaN(index) && this.notices[index] !== undefined && newContent) {
            this.notices[index].content = newContent;
            await chat.reply(`✏️ ${index + 1}번 공지가 수정되었습니다.`);
          } else {
            await chat.reply(`⚠️ 올바른 공지 번호와 내용을 입력해주세요.`);
          }
          break;
        }

        // ----------------------------------------------------
        // 4. #이벤작동 및 이벤트 챗금 시스템
        // ----------------------------------------------------
        case '이벤작동': {
          if (!this.isStaff(sender)) return;
          this.isEventActive = true;
          await chat.reply("🎉 이벤트 도우미를 시작합니다!\n지금부터 관리자/부방장 및 당첨자 외의 채팅은 제한(가리기)됩니다.");
          break;
        }
        case '이벤종료': {
          if (!this.isStaff(sender)) return;
          this.isEventActive = false;
          this.eventHostId = null;
          if (this.eventActiveTimer) clearTimeout(this.eventActiveTimer);
          await chat.reply("⏹️ 이벤트 도우미가 종료되었습니다.");
          break;
        }
        case '제비뽑기':
        case '초세기': {
          if (!this.isStaff(sender)) return;
          this.eventHostId = sender.userId.toString();
          await chat.reply(`⏱️ 부방장(${sender.nickname || '진행자'})이 초세기/제비뽑기를 시작합니다!\n멘션된 상태에서 초세기 중간에 정답을 외치세요!`);
          
          if (this.eventActiveTimer) clearTimeout(this.eventActiveTimer);
          this.eventActiveTimer = setTimeout(() => {
            this.eventHostId = null;
            chat.send("⌛ 초세기 시간이 종료되었습니다. 일반 채팅이 복구됩니다.");
          }, 15000);
          break;
        }
      }
    } catch (err) {
      console.error('[AdvancedManager Error]', err);
    }
  }

  // ----------------------------------------------------
  // 5. 클린봇 및 이벤트 챗금 실시간 필터링
  // ----------------------------------------------------
  private async processCleanBotAndEventChat(chat: Chat, sender: ChatMember | undefined) {
    if (!chat.text) return;
    const text = chat.text;
    const isUserStaff = this.isStaff(sender);

    // [클린봇] 금지어(욕설, 패드립, 커스텀 금지어) 감지 시 즉시 가리기 (부방장/방장 제외)
    let isBannedWord = false;
    for (const word of this.bannedWords) {
      if (text.includes(word)) {
        isBannedWord = true;
        break;
      }
    }

    if (isBannedWord && !isUserStaff) {
      try {
        await chat.hide(); // 메시지 가리기 패킷
        console.log(`[CleanBot] 금지어 감지 가림 처리 완료: ${chat.logId}`);
        return;
      } catch (e) {
        console.error('[CleanBot] 메시지 가리기 실패:', e);
      }
    }

    // [이벤트 챗금] #이벤작동 중일 때 관리자/부방장 외 가리기
    // 단, 부방장이 초세기/제비뽑기를 켜고 멘션/초를 세는 도중의 정상적인 답장 규칙 예외 처리
    if (this.isEventActive && !isUserStaff) {
      // 이벤트 진행 중 권한 없는 유저의 채팅은 가리기 실행
      try {
        // 만약 부방장이 초세기를 켠 상태고 실시간 답을 요구하는 타이밍이라면 규칙 적용
        if (this.eventHostId) {
          // 초세기 중간에 엉뚱한 채팅을 치면 즉시 가리기
          await chat.hide();
        } else {
          // 일반 이벤트 대기 시간에도 관리자/당첨자 외 채팅 가리기
          await chat.hide();
        }
      } catch (err) {}
    }
  }

  // ----------------------------------------------------
  // 6. 공지 예약 및 시간 체크 스케줄러
  // ----------------------------------------------------
  private initNoticeScheduler() {
    // 1분마다 현재 시간을 체크하여 예약된 공지 시간에 일치하면 상단 공지 등록/출력
    this.noticeInterval = setInterval(async () => {
      const now = new Date();
      const currentHours = String(now.getHours()).padStart(2, '0');
      const currentMinutes = String(now.getMinutes()).padStart(2, '0');
      const currentTimeStr = `${currentHours}:${currentMinutes}`;

      // 예약된 시간이 현재 시간과 일치하는 공지 찾기
      const targetNotice = this.notices.find(n => n.time === currentTimeStr);
      if (targetNotice) {
        console.log(`[Notice Scheduler] 예약된 공지 시간 도달: ${targetNotice.content}`);
        // 오픈채팅방에 공지 알림 전송 또는 상단 공지 API 호출 실행 가능
      }
    }, 60 * 1000); // 1분 주기로 체크
  }
}
