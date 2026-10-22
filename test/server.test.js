import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApp } from '../src/server-app.js';

async function withServer(fn) {
  const handled = [];
  const app = createApp({ appSecret: 's3', verifyToken: 'vt', handle: async m => handled.push(m) });
  const srv = app.listen(0);
  await new Promise(r => srv.once('listening', r));
  try { await fn(`http://127.0.0.1:${srv.address().port}`, handled); } finally { srv.close(); }
}

test('GET /webhook verifica token', () => withServer(async base => {
  const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '123');
  const bad = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=no&hub.challenge=123`);
  assert.equal(bad.status, 403);
}));

test('POST /webhook rechaza firma inválida y procesa la válida', () => withServer(async (base, handled) => {
  const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '111' }, messages: [{ from: '524521112222', id: 'w1', type: 'text', text: { body: 'hola' } }] } }] }] });
  const bad = await fetch(`${base}/webhook`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=00' } });
  assert.equal(bad.status, 401);
  const sig = 'sha256=' + createHmac('sha256', 's3').update(body).digest('hex');
  const ok = await fetch(`${base}/webhook`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig } });
  assert.equal(ok.status, 200);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(handled.length, 1);
  assert.equal(handled[0].text, 'hola');
}));

test('GET /health', () => withServer(async base => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
}));
