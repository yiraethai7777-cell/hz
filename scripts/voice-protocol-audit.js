'use strict';

/**
 * Read-only source audit for KakaoForge VOX capabilities.
 * This tool never authenticates, opens sockets, or sends LOCO/Vox packets.
 * A symbol match is ONLY a source clue, not proof of runtime functionality.
 */
const fs = require('node:fs');
const path = require('node:path');

const FILES = Object.freeze({
  client: 'src/client/client.ts',
  carriage: 'src/net/carriage-client.ts',
  openchat: 'src/client/openchat-mixin.ts',
  startup: 'start.js',
  controller: 'shared/voice-room.js',
});

function inspectVoiceProtocol(projectRoot) {
  const root = path.resolve(projectRoot);
  const files = {};
  for (const [name, relative] of Object.entries(FILES)) {
    const filename = path.join(root, relative);
    try {
      files[name] = fs.readFileSync(filename, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      files[name] = null;
    }
  }
  const sdkSource = [files.client, files.carriage, files.openchat].filter(Boolean).join('\n');
  const startup = files.startup || '';
  const voiceSymbols = [
    'IVoxManager', 'Vox30Manager', 'joinVoiceRoomCall',
    'makeVoiceroom', 'startVoiceroom',
  ];
  const sdkVoiceSymbols = voiceSymbols.filter(symbol => sdkSource.includes(symbol));
  const startupVoiceAdapterBinding = /(?:client|bot|nexi)\.voiceRoomAdapter\s*=/.test(startup);
  const hasCarriageRequest = /\b(?:async\s+)?request\s*\(/.test(files.carriage || '');
  return {
    sourceOnly: true,
    networkRequestsSent: 0,
    filesInspected: Object.fromEntries(
      Object.entries(FILES).map(([name, file]) => [name, {
        path: file, found: files[name] !== null,
      }])
    ),
    chatLocoRequestMethodDetected: hasCarriageRequest,
    nativeVoxSymbolsDetectedInSdk: sdkVoiceSymbols,
    startupVoiceAdapterBindingDetected: startupVoiceAdapterBinding,
    verifiedNativeVoiceRoomCreation: false,
    liveProtocolReady: false,
    nextStep: sdkVoiceSymbols.length
      ? 'Review any detected SDK VOX interfaces and validate against legitimate server responses.'
      : 'Implement and independently verify VOX signalling/session handling; ordinary chat LOCO methods are insufficient evidence.',
  };
}

if (require.main === module) {
  const dir = process.argv[2] || path.resolve(__dirname, '..');
  console.log(JSON.stringify(inspectVoiceProtocol(dir), null, 2));
}

module.exports = { inspectVoiceProtocol, FILES };
