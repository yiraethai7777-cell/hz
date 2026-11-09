/*
 * NEXI VoiceRoom / Frida Android read-only probe.
 * Attach ONLY to a test Android KakaoTalk process under your control.
 * No packets, IDs, messages, tokens or method arguments are captured.
 * Never calls a VOX method by itself or changes an original return value.
 * Tested with mocked Frida APIs; Android device integration is not yet verified.
 */
'use strict';

(function () {
  const exactNames = new Set([
    'makeVoiceroom', 'joinVoiceroom', 'leaveVoiceroom',
    'getCurrentVoiceroomInfo', 'isInIdle', 'queryVoiceRoomMemberList',
    'vRCInviteAsModerator', 'vRCAcceptModeratorInvitation',
  ]);
  const queries = ['*!*voiceroom*/is', '*!*Moderator*/is'];
  const maxHooks = 48;
  const hooked = new Set();

  function emit(kind, details) {
    const output = { source: 'NEXI_FRIDA_VOX_PROBE', event: kind,
      ...(details || {}) };
    try {
      // Do not stringify or forward Java objects, method arguments or returned values.
      send(output);
    } catch (_) {
      // Diagnostic transport is best effort: do not disrupt the app.
    }
  }
  function methodName(signature) {
    if (typeof signature !== 'string') return '';
    const beforeArgs = signature.split('(')[0].trim();
    const tokens = beforeArgs.split(/[\s.]+/);
    return tokens[tokens.length - 1] || '';
  }
  function installMethod(klassName, method) {
    const key = klassName + '#' + method;
    if (hooked.has(key) || hooked.size >= maxHooks) return;
    let klass;
    try { klass = Java.use(klassName); } catch (_) { return; }
    const bridge = klass && klass[method];
    if (!bridge || !Array.isArray(bridge.overloads) || bridge.overloads.length > 12) return;
    let count = 0;
    for (const overload of bridge.overloads) {
      try {
        // Overload-specific hook preserves the exact original argument/return contract.
        overload.implementation = function () {
          const args = Array.prototype.slice.call(arguments);
          const meta = { method, signatureArity: args.length };
          emit('enter', meta);
          try {
            const result = overload.call(this, ...args);
            emit('return', meta);
            return result;
          } catch (err) {
            emit('original_exception', meta);
            throw err;
          }
        };
        count++;
      } catch (_) { /* not hookable on this Android version */ }
    }
    if (count) {
      hooked.add(key);
      emit('installed', { method, overloads: count });
    }
  }
  if (typeof Java === 'undefined' || !Java.available) {
    emit('unavailable', { reason: 'Android Java runtime not attached' });
    return;
  }
  Java.perform(function () {
    for (const query of queries) {
      let groups;
      try { groups = Java.enumerateMethods(query); }
      catch (_) { emit('enumeration_failed', { query }); continue; }
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        for (const target of (group.classes || [])) {
          if (!target || typeof target.name !== 'string') continue;
          for (const signature of (target.methods || [])) {
            const name = methodName(signature);
            if (!exactNames.has(name)) continue;
            installMethod(target.name, name);
          }
        }
      }
    }
    emit('ready', {
      installedMethodGroups: hooked.size,
      // If 0: signatures are not accessible, renamed, or are native-only.
      status: hooked.size ? 'observing-only' : 'no-compatible-Java-methods',
    });
  });
})();
