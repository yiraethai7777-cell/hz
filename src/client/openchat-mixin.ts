import { Long } from 'bson';
import * as LosslessJSON from 'lossless-json';
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
    let list: any;
    try { list = await this._carriage.request('KLSYNC', { li }); }
    catch { return { success: true, acknowledged: true, verified: false, reason: 'list_unavailable', userId: id }; }
    if (list.status !== 0 || !Array.isArray(list.body?.kickMembers)) {
      // KLDELITEM was acknowledged. Missing or unsupported list response
      // does not establish that the target remains banned.
      return { success: true, acknowledged: true, verified: false, reason: 'list_unavailable', userId: id };
    }
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
      if (fetchedInfo &&
          String(normalizeLogTarget(fetched)) === String(logIdValue) &&
          String(normalizeIdValue(fetched?.room?.id)) === String(resolvedChatId) &&
          (!targetInfo?.memberId || String(normalizeIdValue(targetInfo.memberId)) === String(normalizeIdValue(fetchedInfo.memberId)))) {
        // Do not let an undefined field from the original target overwrite fetched data.
        targetInfo = {
          memberId: targetInfo?.memberId ?? fetchedInfo.memberId,
          linkId: targetInfo?.linkId || fetchedInfo.linkId,
          isOpenChat: targetInfo?.isOpenChat ?? fetchedInfo.isOpenChat,
          chatLogInfo: targetInfo?.chatLogInfo || fetchedInfo.chatLogInfo,
        };
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

  // Log only protocol shape, never message contents, IDs, credentials or attachments.
  let entry: any;
  try {
    const parsed: any = LosslessJSON.parse(chatLogInfo);
    entry = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : undefined;
  } catch { /* allow SDK caller-supplied data; report its shape only */ }
  const positive = (v: any) => /^[1-9]\d*$/.test(String(v ?? ''));
  const shape = {
    roomLinkMatchesCache: roomInfo?.openLinkId ? String(normalizeIdValue(roomInfo.openLinkId)) === String(linkIdValue) : null,
    authorMatches: entry ? String(entry.u) === String(memberIdValue) : null,
    logMatches: entry && logIdValue ? String(entry.l) === String(logIdValue) : null,
    sendAtPresent: positive(entry?.s),
    messageType: Number.isSafeInteger(Number(entry?.t)) ? Number(entry.t) : null,
    hasMessage: typeof entry?.m?.message === 'string',
    hasAttachment: entry?.m?.attachment != null,
    scope: Number.isSafeInteger(Number(entry?.scope)) ? Number(entry.scope) : null,
    hasThread: positive(entry?.threadId),
    report: !!opts.report,
  };
  if (shape.authorMatches === false || shape.logMatches === false) {
    throw new Error('open chat blind target identifiers disagree');
  }
  console.info('[KAKAO BLIND REQUEST]', JSON.stringify(shape));
  const startedAt = Date.now();
  const result = await this._carriage.blind({
    linkId: linkIdValue,
    chatId: resolvedChatId,
    memberId: memberIdValue,
    report: !!opts.report,
    chatLogInfo,
    category: opts.category,
  });
  const body = result?.body;
  console.info('[KAKAO BLIND RESPONSE]', JSON.stringify({
    status: result?.status == null ? null : Number(result.status),
    bodyStatus: body?.status == null ? null : Number(body.status),
    bodyKeys: ['status','success','ok','hidden','logId','targetLogId','chatLog','chatLogInfos','message','error','code'].filter(k => body && Object.prototype.hasOwnProperty.call(body,k)),
    elapsedMs: Date.now() - startedAt,
  }));
  return result;
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
