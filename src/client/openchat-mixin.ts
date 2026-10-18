import { Long } from 'bson';
import {
  type ReactionTypeValue,
  type ReactionOptions,
  type OpenChatKickOptions,
  type OpenChatBlindOptions,
} from '../types';
import {
  normalizeIdValue,
  normalizeReactionTarget,
  normalizeOpenChatMemberTarget,
  normalizeOpenChatBlindTarget,
  normalizeLogTarget,
  assertBubbleOk,
} from '../utils';
import type { ReactionPayload } from '../net/bubble-client';
import type { KakaoForgeClient } from './client';

/**
 * OpenChat mixin interface - declares methods added to KakaoForgeClient
 */
export interface OpenChatMixin {
  openChatUnkick(chatId: number | string, userId: number | string): Promise<any>;
  sendReaction(
    chatId: number | string,
    target: any,
    reactionType: ReactionTypeValue,
    opts?: ReactionOptions
  ): Promise<any>;
  openChatKick(
    chatId: number | string,
    target: any,
    opts?: OpenChatKickOptions
  ): Promise<any>;
  openChatBlind(
    chatId: number | string,
    target: any,
    opts?: OpenChatBlindOptions
  ): Promise<any>;
}

async function sendReaction(
  this: KakaoForgeClient,
  chatId: number | string,
  target: any,
  reactionType: ReactionTypeValue,
  opts: ReactionOptions = {}
) {
  const resolvedChatId = this._resolveChatId(chatId);
  const targetInfo = normalizeReactionTarget(target);
  const logIdValue = normalizeIdValue(targetInfo?.logId ?? 0);
  if (!logIdValue || logIdValue === 0 || logIdValue === '0') {
    throw new Error('reaction target requires logId');
  }

  const typeValue = typeof reactionType === 'number' ? reactionType : parseInt(String(reactionType), 10);
  if (!Number.isFinite(typeValue)) {
    throw new Error('reactionType must be a number');
  }

  let linkIdValue: number | string | undefined;
  if (opts.linkId !== undefined && opts.linkId !== null && opts.linkId !== '') {
    linkIdValue = normalizeIdValue(opts.linkId);
  } else if (targetInfo?.linkId !== undefined && targetInfo?.linkId !== null && targetInfo?.linkId !== '') {
    linkIdValue = normalizeIdValue(targetInfo.linkId);
  }

  const roomKey = String(resolvedChatId);
  const roomInfo = this._chatRooms.get(roomKey);
  const isOpenChat = targetInfo?.isOpenChat ?? roomInfo?.isOpenChat ?? false;

  if (!linkIdValue && roomInfo?.openLinkId) {
    linkIdValue = normalizeIdValue(roomInfo.openLinkId);
  }

  if (!linkIdValue && isOpenChat) {
    await this._ensureOpenChatInfo(resolvedChatId);
    const refreshed = this._chatRooms.get(roomKey);
    if (refreshed?.openLinkId) {
      linkIdValue = normalizeIdValue(refreshed.openLinkId);
    }
  }

  if (isOpenChat && (!linkIdValue || linkIdValue === 0 || linkIdValue === '0')) {
    throw new Error('open chat reaction requires openLinkId');
  }

  const bubble = this._getBubbleClient();
  const payload: ReactionPayload = {
    logId: logIdValue,
    type: typeValue,
    reqId: opts.reqId ?? Date.now(),
  };
  if (linkIdValue && linkIdValue !== 0 && linkIdValue !== '0') {
    payload.linkId = linkIdValue;
  }

  const res = await bubble.sendReaction(resolvedChatId, payload);
  assertBubbleOk(res, '공감 전송');
  return res;
}

async function openChatKick(
  this: KakaoForgeClient,
  chatId: number | string,
  target: any,
  opts: OpenChatKickOptions = {}
) {
  if (!this._carriage) throw new Error('LOCO not connected');
  const resolvedChatId = this._resolveChatId(chatId);
  const targetInfo = normalizeOpenChatMemberTarget(target);
  if (!targetInfo?.memberId) {
    throw new Error('open chat kick requires memberId');
  }

  let linkIdValue: number | string | undefined;
  if (opts.linkId !== undefined && opts.linkId !== null && opts.linkId !== '') {
    linkIdValue = normalizeIdValue(opts.linkId);
  } else if (targetInfo.linkId !== undefined) {
    linkIdValue = normalizeIdValue(targetInfo.linkId);
  }

  const roomKey = String(resolvedChatId);
  const roomInfo = this._chatRooms.get(roomKey);
  const isOpenChat = targetInfo.isOpenChat ?? roomInfo?.isOpenChat ?? false;

  if (!linkIdValue && roomInfo?.openLinkId) {
    linkIdValue = normalizeIdValue(roomInfo.openLinkId);
  }

  if (!linkIdValue && isOpenChat) {
    await this._ensureOpenChatInfo(resolvedChatId);
    const refreshed = this._chatRooms.get(roomKey);
    if (refreshed?.openLinkId) {
      linkIdValue = normalizeIdValue(refreshed.openLinkId);
    }
  }

  if (!linkIdValue || linkIdValue === 0 || linkIdValue === '0') {
    throw new Error('open chat kick requires openLinkId');
  }

  return await this._carriage.kickMem({
    linkId: linkIdValue,
    chatId: resolvedChatId,
    memberId: normalizeIdValue(targetInfo.memberId),
    reported: !!opts.report,
  });
}

async function openChatUnkick(this: KakaoForgeClient, chatId: number | string, userId: number | string) {
  if (!this._carriage) throw new Error('LOCO not connected');
  const roomId = this._resolveChatId(chatId), id = String(userId);
  if (!/^\d{4,}$/.test(id)) throw new Error('정확한 사용자 ID가 필요합니다.');
  let room = this._chatRooms.get(String(roomId));
  if (!room?.openLinkId) { await this._ensureOpenChatInfo(roomId); room = this._chatRooms.get(String(roomId)); }
  if (!room?.openLinkId) throw new Error('오픈채팅방 링크 ID를 확인하지 못했습니다.');
  const li = Long.fromString(String(room.openLinkId)), c = Long.fromString(String(roomId)), kid = Long.fromString(id);
  const removed = await this._carriage.request('KLDELITEM', { li, c, kid });
  if (removed.status !== 0) throw new Error('KLDELITEM failed: status=' + removed.status);
  for (let attempt = 0; attempt < 3; attempt++) {
    const list = await this._carriage.request('KLSYNC', { li });
    if (list.status !== 0 || !Array.isArray(list.body?.kickMembers)) throw new Error('내보내기 목록 확인 실패');
    const stillBlocked = list.body.kickMembers.some((v: any) => String(v.userId) === id && (v.c == null || String(v.c) === String(roomId)));
    if (!stillBlocked) return { success: true, verified: true, userId: id };
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('해제 후에도 내보내기 목록에 남아 있습니다.');
}

async function openChatBlind(
  this: KakaoForgeClient,
  chatId: number | string,
  target: any,
  opts: OpenChatBlindOptions = {}
) {
  if (!this._carriage) throw new Error('LOCO not connected');
  const resolvedChatId = this._resolveChatId(chatId);
  const logIdValue = normalizeLogTarget(target);
  let targetInfo = normalizeOpenChatBlindTarget(target);
  if (logIdValue && (!targetInfo?.memberId || !targetInfo?.chatLogInfo)) {
    try {
      const fetched = await this.fetchMessage(resolvedChatId, logIdValue);
      const fetchedInfo = normalizeOpenChatBlindTarget(fetched);
      if (fetchedInfo) {
        targetInfo = { ...fetchedInfo, ...(targetInfo || {}) };
      }
    } catch (err: any) {
      if (this.debug) {
        console.error('[DBG] openChatBlind fetchMessage failed:', err instanceof Error ? err.message : String(err));
      }
    }
  }
  if (!targetInfo?.memberId) {
    throw new Error('open chat blind requires MessageEvent or raw chatLog');
  }
  const memberIdValue = normalizeIdValue(targetInfo.memberId);
  if (!memberIdValue) {
    throw new Error('open chat blind requires MessageEvent or raw chatLog');
  }

  let linkIdValue: number | string | undefined;
  if (opts.linkId !== undefined && opts.linkId !== null && opts.linkId !== '') {
    linkIdValue = normalizeIdValue(opts.linkId);
  } else if (targetInfo.linkId !== undefined) {
    linkIdValue = normalizeIdValue(targetInfo.linkId);
  }

  const roomKey = String(resolvedChatId);
  const roomInfo = this._chatRooms.get(roomKey);
  const isOpenChat = targetInfo.isOpenChat ?? roomInfo?.isOpenChat ?? false;

  if (!linkIdValue && roomInfo?.openLinkId) {
    linkIdValue = normalizeIdValue(roomInfo.openLinkId);
  }

  if (!linkIdValue && isOpenChat) {
    await this._ensureOpenChatInfo(resolvedChatId);
    const refreshed = this._chatRooms.get(roomKey);
    if (refreshed?.openLinkId) {
      linkIdValue = normalizeIdValue(refreshed.openLinkId);
    }
  }

  if (!linkIdValue || linkIdValue === 0 || linkIdValue === '0') {
    throw new Error('open chat blind requires openLinkId');
  }

  const chatLogInfo = opts.chatLogInfo ?? targetInfo.chatLogInfo;
  if (!chatLogInfo) {
    throw new Error('open chat blind requires chatLogInfo');
  }

  return await this._carriage.blind({
    linkId: linkIdValue,
    chatId: resolvedChatId,
    memberId: memberIdValue,
    report: !!opts.report,
    chatLogInfo,
    category: opts.category,
  });
}

/**
 * Apply openchat mixin to KakaoForgeClient prototype
 */
export function applyOpenChatMixin(ClientClass: typeof KakaoForgeClient) {
  ClientClass.prototype.sendReaction = sendReaction;
  ClientClass.prototype.openChatKick = openChatKick;
  ClientClass.prototype.openChatUnkick = openChatUnkick;
  ClientClass.prototype.openChatBlind = openChatBlind;
}
