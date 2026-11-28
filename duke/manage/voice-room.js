'use strict';

const { resolveTarget } = require('./targets');

function registerVoiceRoom(core, {
  canManage, getAdapter, watchOpen, watchEnd, fetchMessage, inspectInvitation,
}) {
  const pending = new Set();
  const register = (name, description, execute) => core.register({
    name, description, section: 'MANAGEMENT', developing: true,
    async execute(event) {
      const reply = body => event.format('VOICE', body);
      if (!canManage(event)) return reply('관리 권한이 없습니다.');
      const adapter = getAdapter();
      if (!adapter) return reply('보이스룸 연결을 사용할 수 없습니다.');
      const { roomId } = event;
      if (pending.has(roomId)) return reply('이 방의 보이스룸 요청을 처리 중입니다.');
      pending.add(roomId);
      try {
        return reply(await execute(event, adapter));
      } catch {
        return reply('보이스룸 요청을 처리하지 못했습니다. 카카오톡 앱에서 상태를 확인해 주세요.');
      } finally {
        pending.delete(roomId);
      }
    },
  });

  register('보룸시작', '보이스룸 시작 [제목]', async ({ roomId, args }, adapter) => {
    const title = args.join(' ') || '보이스룸';
    if ([...title].length > 40) return '보이스룸 제목은 40자까지 입력할 수 있습니다.';
    const watch = watchOpen(roomId);
    try {
      const result = await adapter.create({ roomId, title });
      if (result?.requestAccepted !== true) return '서버에서 보이스룸 시작 요청을 승인하지 않았습니다.';
      return await watch?.wait(result.callId)
        ? '보이스룸이 개설되었습니다.'
        : '서버가 시작 요청을 승인했습니다. 보이스룸 개설 여부는 확인되지 않았습니다.';
    } finally {
      watch?.close();
    }
  });

  register('보룸종료', '현재 방의 듀크 봇 VOX 연결 해제', async ({ roomId }, adapter) => {
    if (typeof adapter.disconnect !== 'function') return 'VOX 연결 해제 기능을 사용할 수 없습니다.';
    const result = await adapter.disconnect({ roomId });
    if (result?.localReleased === true) return '듀크 봇의 VOX 연결을 해제했습니다.\n※ 실제 보이스룸 종료 여부는 확인되지 않았습니다.';
    if (result?.noLocalSession === true) return '현재 방에 해제할 듀크 봇의 VOX 연결이 없습니다.';
    return 'VOX 연결 해제를 확인하지 못했습니다.';
  });

  register('보룸참가', '현재 방의 보이스룸에 봇 참가', async ({ roomId }, adapter) => {
    const state = await adapter.status({ roomId });
    if (!state.joinTrialAvailable) return '보이스룸 참가 검증이 진행 중입니다. 참가 시험이 비활성화되어 있습니다.';
    const invitation = await inspectInvitation(roomId);
    const result = await adapter.join({ roomId, invitation });
    return result?.requestAccepted === true
      ? '서버가 참가 요청을 승인했습니다. 참가자 목록에서 듀크 봇을 확인해 주세요.'
      : '보이스룸 참가 요청 승인을 확인하지 못했습니다.';
  });

  for (const [label, role] of [['진행자', 'moderator'], ['스피커', 'speaker']]) {
    register(label + '주기', '대상에게 보이스룸 ' + label + ' 권한 주기', async (event, adapter) => {
      if (!adapter.grantRole) return label + ' 권한 주기 요청 규격이 검증되지 않았습니다. 카카오톡 앱에서 지정해 주세요.';
      const { roomId, msg, args } = event;
      const target = await resolveTarget({ msg, args, roomId, fetchMessage });
      if (!target) return '대상을 멘션하거나 대상 메시지에 답장해 주세요.';
      const result = await adapter.grantRole({ roomId, role, targetUserId: target.id });
      return result?.requestAccepted === true
        ? label + ' 권한 요청을 보냈습니다. 참가자 목록에서 권한을 확인해 주세요.'
        : label + ' 권한 요청 승인을 확인하지 못했습니다.';
    });
    register(label + '받기', '듀크 봇에 온 보이스룸 ' + label + ' 초대 수락', async ({ roomId }, adapter) => {
      const state = await adapter.status({ roomId });
      const available = role === 'moderator' ? state.moderatorAutoAcceptAvailable : state.speakerAutoAcceptAvailable;
      if (!available) return label + ' 권한 수락 규격이 검증되지 않았습니다.';
      const result = await adapter.acceptRole({ roomId, role });
      return result?.handled
        ? label + ' 권한 수락 요청을 보냈습니다. 참가자 목록에서 권한을 확인해 주세요.'
        : '현재 수락할 수 있는 ' + label + ' 초대를 확인하지 못했습니다.';
    });
  }
}

module.exports = { registerVoiceRoom };
