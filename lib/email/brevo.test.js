// lib/email/brevo.test.js — stub behaviour pinned

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { sendExportEmail, escapeHtml } from './brevo.js';

let _savedKey;
beforeEach(() => { _savedKey = process.env.BREVO_API_KEY; delete process.env.BREVO_API_KEY; });
afterEach(()  => {
  if (_savedKey === undefined) delete process.env.BREVO_API_KEY;
  else process.env.BREVO_API_KEY = _savedKey;
});

test('sendExportEmail: no BREVO_API_KEY → stubbed:true, ok:true, reason mentions BREVO_API_KEY', async () => {
  delete process.env.BREVO_API_KEY;
  const r = await sendExportEmail({
    toEmail: 'a001@example.com', studentId: 'A001',
    subject: 'x', markdownBody: '# 你的個人教練 prompt\n...',
  });
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /BREVO_API_KEY/);
});

test('sendExportEmail: BREVO_API_KEY set but SDK absent → still stubbed:true (current PR-4c-2 state)', async () => {
  process.env.BREVO_API_KEY = 'fake-key-for-test';
  const r = await sendExportEmail({
    toEmail: 'a001@example.com', studentId: 'A001',
    subject: 'x', markdownBody: '# body',
  });
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /SDK not installed/);
});

test('sendExportEmail: missing toEmail → ok:false', async () => {
  const r = await sendExportEmail({ studentId: 'A001', markdownBody: 'body' });
  assert.equal(r.ok, false);
  assert.match(r.error, /toEmail/);
});

test('sendExportEmail: missing markdownBody → ok:false', async () => {
  const r = await sendExportEmail({ toEmail: 'x@y.com', studentId: 'A001' });
  assert.equal(r.ok, false);
  assert.match(r.error, /markdownBody/);
});

test('escapeHtml: encodes the 5 dangerous chars', () => {
  assert.equal(escapeHtml('<a href="x" foo=\'y\'>&'), '&lt;a href=&quot;x&quot; foo=&#39;y&#39;&gt;&amp;');
});
