import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifySignature, parseWebhook, createWhatsApp } from '../src/whatsapp.js';

const sig = (body, secret) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

test('verifySignature acepta firma válida y rechaza inválida o ausente', () => {
  const body = Buffer.from('{"a":1}');
  assert.equal(verifySignature(body, sig(body, 's3'), 's3'), true);
  assert.equal(verifySignature(body, sig(body, 'otro'), 's3'), false);
  assert.equal(verifySignature(body, undefined, 's3'), false);
  assert.equal(verifySignature(body, 'sha256=abc', 's3'), false);
});

const payload = (messages, statuses) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '111' }, messages, statuses } }] }],
});

test('parseWebhook aplana mensajes de texto y no-texto', () => {
  const out = parseWebhook(payload([
    { from: '5214521112222', id: 'wamid.1', type: 'text', text: { body: 'Hola' } },
    { from: '524521112222', id: 'wamid.2', type: 'image', image: { id: 'x' } },
  ]));
  assert.deepEqual(out, [
    { phoneNumberId: '111', from: '524521112222', id: 'wamid.1', type: 'text', text: 'Hola' },
    { phoneNumberId: '111', from: '524521112222', id: 'wamid.2', type: 'image', text: null },
  ]);
});

test('parseWebhook ignora statuses', () => {
  assert.deepEqual(parseWebhook(payload(undefined, [{ id: 'x', status: 'read' }])), []);
  assert.deepEqual(parseWebhook({}), []);
});

const tenant = { phoneNumberId: '111', waToken: 'tok' };

test('sendText hace POST a Graph con el body correcto', async () => {
  const calls = [];
  const wa = createWhatsApp(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({}) }; });
  await wa.sendText(tenant, '524521112222', 'hola');
  assert.equal(calls[0].url, 'https://graph.facebook.com/v21.0/111/messages');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { messaging_product: 'whatsapp', to: '524521112222', type: 'text', text: { body: 'hola' } });
});

test('sendTemplate manda plantilla es_MX con parámetros', async () => {
  let body;
  const wa = createWhatsApp(async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({}) }; });
  await wa.sendTemplate(tenant, '52', 'nuevo_lead', ['Ana', 'app']);
  assert.deepEqual(body.template, {
    name: 'nuevo_lead', language: { code: 'es_MX' },
    components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'app' }] }],
  });
});

test('error HTTP lanza con el detalle', async () => {
  const wa = createWhatsApp(async () => ({ ok: false, status: 400, text: async () => 'bad token' }));
  await assert.rejects(wa.sendText(tenant, '52', 'x'), /400.*bad token/);
});
