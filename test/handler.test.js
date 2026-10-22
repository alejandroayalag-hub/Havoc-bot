import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage, TEXTOS } from '../src/handler.js';
import { openDb, getLead, syncClientes, updateLead, recentMessages } from '../src/db.js';

const tenant = { id: 'havoc', nombre: 'HAVOC', phoneNumberId: '111', dueno: { telefono: '524521112222' }, avisoPrivacidad: 'https://havocdev.mx/aviso-privacidad.html' };
const AVISO = 'Aviso de privacidad: https://havocdev.mx/aviso-privacidad.html';

function setup({ agentFails = false } = {}) {
  const db = openDb(':memory:');
  const sent = [], notes = [], agentCalls = [];
  const deps = {
    tenants: new Map([['111', tenant]]), db, now: () => new Date('2026-10-26T15:00:00Z'),
    wa: { sendText: async (t, to, text) => sent.push({ to, text }) },
    notifier: { notify: async (...a) => notes.push(a) },
    calendars: new Map(), llm: {},
    runAgent: async args => { agentCalls.push(args); if (agentFails) throw new Error('claude 529'); return 'Hola, ¿en qué le ayudo?'; },
  };
  return { db, sent, notes, agentCalls, deps };
}
const msg = (over = {}) => ({ phoneNumberId: '111', from: '524523334444', id: 'w' + Math.random(), type: 'text', text: 'Hola', ...over });

test('mismo id dos veces → se contesta una sola vez', async () => {
  const s = setup();
  const m = msg();
  await handleMessage(m, s.deps);
  await handleMessage(m, s.deps);
  assert.equal(s.sent.length, 1);
});

test('tenant desconocido se ignora', async () => {
  const s = setup();
  await handleMessage(msg({ phoneNumberId: '999' }), s.deps);
  assert.equal(s.sent.length, 0);
});

test('dueño escribiendo → texto fijo, sin agente ni lead', async () => {
  const s = setup();
  await handleMessage(msg({ from: '524521112222' }), s.deps);
  assert.deepEqual(s.sent, [{ to: '524521112222', text: TEXTOS.dueno }]);
  assert.equal(s.agentCalls.length, 0);
  assert.equal(getLead(s.db, 'havoc', '524521112222'), undefined);
});

test('primer mensaje lleva aviso de privacidad; el segundo no', async () => {
  const s = setup();
  await handleMessage(msg(), s.deps);
  await handleMessage(msg({ text: 'quiero una app' }), s.deps);
  assert.equal(s.sent[0].text, `Hola, ¿en qué le ayudo?\n\n${AVISO}`);
  assert.equal(s.sent[1].text, 'Hola, ¿en qué le ayudo?');
  assert.deepEqual(s.agentCalls[1].history.map(m => m.content), ['Hola', `Hola, ¿en qué le ayudo?\n\n${AVISO}`, 'quiero una app']);
});

test('no-texto → texto fijo sin agente', async () => {
  const s = setup();
  await handleMessage(msg({ type: 'audio', text: null }), s.deps);
  assert.equal(s.agentCalls.length, 0);
  assert.ok(s.sent[0].text.startsWith(TEXTOS.noTexto));
});

test('cliente en lista → texto fijo + urgente una vez por conversación', async () => {
  const s = setup();
  syncClientes(s.db, 'havoc', [{ empresa: 'Gioval', telefonos: ['524523334444'] }]);
  await handleMessage(msg({ text: 'no abre el sistema' }), s.deps);
  await handleMessage(msg({ text: 'sigue sin abrir' }), s.deps);
  assert.equal(s.agentCalls.length, 0);
  assert.ok(s.sent[0].text.startsWith(TEXTOS.cliente));
  assert.equal(s.notes.length, 1);
  assert.equal(s.notes[0][1], 'urgente');
  assert.equal(s.notes[0][4], 'Gioval');
  // conversación cerrada por inactividad → vuelve a avisar
  updateLead(s.db, getLead(s.db, 'havoc', '524523334444').id, { estado: 'cerrado' });
  await handleMessage(msg({ text: 'otra vez' }), s.deps);
  assert.equal(s.notes.length, 2);
});

test('lead cerrado que vuelve a escribir se reabre', async () => {
  const s = setup();
  await handleMessage(msg(), s.deps);
  const l = getLead(s.db, 'havoc', '524523334444');
  updateLead(s.db, l.id, { estado: 'cerrado' });
  await handleMessage(msg({ text: 'otra cosa' }), s.deps);
  assert.equal(getLead(s.db, 'havoc', '524523334444').estado, 'abierto');
});

test('agente falla → texto de problema técnico + aviso de error, sin lanzar', async () => {
  const s = setup({ agentFails: true });
  await handleMessage(msg(), s.deps);
  assert.ok(s.sent[0].text.startsWith(TEXTOS.error));
  assert.equal(s.notes[0][1], 'error');
  assert.match(s.notes[0][4], /claude 529/);
  assert.equal(recentMessages(s.db, getLead(s.db, 'havoc', '524523334444').id).length, 2);
});

test('el filtro de precio se aplica a la respuesta del agente', async () => {
  const s = setup();
  s.deps.runAgent = async () => 'Una landing cuesta $8,000';
  await handleMessage(msg(), s.deps);
  assert.ok(!s.sent[0].text.includes('$8,000'));
});

test('si falla el aviso tras responder, el link de privacidad no se repite', async () => {
  const s = setup();
  syncClientes(s.db, 'havoc', [{ empresa: 'Gioval', telefonos: ['524523334444'] }]);
  s.deps.notifier.notify = async (t, kind) => { if (kind === 'urgente') throw new Error('smtp+wa caídos'); };
  await handleMessage(msg(), s.deps);
  assert.equal(s.sent.filter(x => x.text.includes('Aviso de privacidad')).length, 1);
});
