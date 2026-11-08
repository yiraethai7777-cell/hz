'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectVoiceProtocol } = require('../scripts/voice-protocol-audit');

function withTempProject(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexi-voice-audit-'));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('audit is read-only and never declares native VOX creation verified', () => {
  withTempProject({
    'src/net/carriage-client.ts': 'class CarriageClient { async request(method, payload) {} }',
    'shared/voice-room.js': 'module.exports = { handle() {} };',
  }, root => {
    const before = fs.readFileSync(path.join(root, 'src/net/carriage-client.ts'), 'utf8');
    const audit = inspectVoiceProtocol(root);
    assert.equal(audit.chatLocoRequestMethodDetected, true);
    assert.deepEqual(audit.nativeVoxSymbolsDetectedInSdk, []);
    assert.equal(audit.verifiedNativeVoiceRoomCreation, false);
    assert.equal(audit.liveProtocolReady, false);
    assert.equal(audit.networkRequestsSent, 0);
    assert.equal(
      fs.readFileSync(path.join(root, 'src/net/carriage-client.ts'), 'utf8'),
      before
    );
  });
});

test('VOX symbol references are only research hints, never proof of live support', () => {
  withTempProject({
    'src/client/client.ts': '// research reference: IVoxManager and Vox30Manager',
    'start.js': 'client.voiceRoomAdapter = bridge;',
  }, root => {
    const audit = inspectVoiceProtocol(root);
    assert.deepEqual(audit.nativeVoxSymbolsDetectedInSdk, ['IVoxManager', 'Vox30Manager']);
    assert.equal(audit.startupVoiceAdapterBindingDetected, true);
    assert.equal(audit.liveProtocolReady, false);
    assert.equal(audit.verifiedNativeVoiceRoomCreation, false);
  });
});

test('missing source files are reported without throwing or creating files', () => {
  withTempProject({}, root => {
    const audit = inspectVoiceProtocol(root);
    assert.equal(audit.filesInspected.client.found, false);
    assert.equal(audit.filesInspected.carriage.found, false);
    assert.equal(audit.chatLocoRequestMethodDetected, false);
    assert.equal(audit.networkRequestsSent, 0);
    assert.equal(fs.readdirSync(root).length, 0);
  });
});

test('real NEXI source can be audited without a network connection', () => {
  const audit = inspectVoiceProtocol(path.resolve(__dirname, '..'));
  assert.equal(audit.sourceOnly, true);
  assert.equal(audit.filesInspected.client.found, true);
  assert.equal(audit.filesInspected.controller.found, true);
  assert.equal(audit.liveProtocolReady, false);
  assert.equal(audit.networkRequestsSent, 0);
});
